/**
 * The live tab's data, and the Realtime channel behind it.
 *
 * Shape of the thing: an observable that emits the current state of today's games and then
 * re-emits whenever Postgres tells us something changed. Subscribing opens a Realtime channel;
 * unsubscribing closes it. No polling anywhere, and no timers to leak.
 *
 * **Server-side this degrades to a single fetch.** `supabase-js` cannot be loaded during SSR —
 * it pulls in `ws`, which needs `node:net`, and the Netlify Deno edge runtime has none of it. So
 * the server renders the stored state and stops; the browser opens the channel on hydration.
 * That is also exactly the fallback when Realtime is unavailable in the browser, which is why
 * `status` is part of the state rather than an error: a visitor with a blocked WebSocket still
 * sees the score, just without it moving.
 *
 * **Why a refetch rather than applying the payload.** A change event tells us a row moved; the
 * rows involved are a handful, and refetching them is one small query that cannot drift out of
 * sync with what the page shows. Reconstructing state from `INSERT`/`UPDATE`/`DELETE` payloads
 * would have to handle a dropped event correctly, and a dropped event during a game is precisely
 * when being wrong matters.
 */

import { Injectable, NgZone, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import {
  Observable,
  combineLatest,
  debounceTime,
  from,
  map,
  merge,
  of,
  startWith,
  switchMap,
  catchError,
} from 'rxjs';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { SupabaseService } from './supabase.service';
import { ResultsService, type LiveGame, type LiveTick, type ResultsGame } from './results.service';

/** Whether the numbers on screen are moving by themselves. */
export type LiveStatus =
  /** Rendered from the database, not updating. The server always reports this. */
  | 'static'
  /** Subscribed; changes arrive as they happen. */
  | 'live'
  /** The browser could not open the channel. The data is still correct, just not moving. */
  | 'unavailable';

export interface LiveGameView {
  readonly game: ResultsGame;
  readonly live: LiveGame | null;
  readonly ticks: readonly LiveTick[];
}

export interface LiveState {
  readonly status: LiveStatus;
  readonly games: readonly LiveGameView[];
  /** The newest tick across every game, for "last update". */
  readonly lastTickAt: string | null;
}

/**
 * Realtime delivers a burst of rows per sync — a score and its ticks arrive together — and each
 * one would otherwise trigger its own refetch.
 */
const REFETCH_DEBOUNCE_MS = 250;

@Injectable({ providedIn: 'root' })
export class ResultsLiveService {
  #platformId = inject(PLATFORM_ID);
  #supabase = inject(SupabaseService);
  #results = inject(ResultsService);
  #zone = inject(NgZone);

  /**
   * Today's games for one team, kept current.
   *
   * `today` is passed in rather than read from the clock here so the server and the browser agree
   * on which day it is — they are in different time zones, and a gameday that had just finished
   * would otherwise reappear as today's for two hours every night.
   */
  liveState(teamId: number, today: string): Observable<LiveState> {
    const fetchOnce = () => this.#fetchState(teamId, today);

    if (!isPlatformBrowser(this.#platformId)) {
      // Server: render what is stored and stop. `static` is honest — nothing is subscribed.
      return fetchOnce().pipe(map((state) => ({ ...state, status: 'static' as LiveStatus })));
    }

    return new Observable<LiveState>((subscriber) => {
      let channel: RealtimeChannel | undefined;
      let closed = false;

      // A plain fetch first, so the tab shows the stored state immediately rather than waiting
      // for a WebSocket handshake that may never complete.
      const changes = new Observable<LiveStatus>((statusSubscriber) => {
        statusSubscriber.next('static');

        // Outside the Angular zone, and this is not an optimisation.
        //
        // zone.js counts an open WebSocket and its timers as pending work, so a subscribed
        // channel keeps `ApplicationRef.isStable()` false for as long as the tab is open.
        // Angular waits for stability to finish hydrating, so with the channel inside the zone
        // hydration never completed and the console filled with NG0506. Emissions step back
        // into the zone, which is what actually needs change detection.
        this.#zone.runOutsideAngular(() => {
          this.#supabase.getClient().then((client) => {
            if (closed) return;

            const signal = (status: LiveStatus) =>
              this.#zone.run(() => statusSubscriber.next(status));

            channel = client
              .channel(`results-live-${teamId}`)
              // No row filter: both tables only ever hold today's games — the sync prunes them —
              // so the table is already the scope, and a filter would be one more thing to keep
              // in step with the sync.
              .on('postgres_changes', { event: '*', schema: 'public', table: 'results_live_games' },
                () => signal('live'))
              .on('postgres_changes', { event: '*', schema: 'public', table: 'results_live_ticks' },
                () => signal('live'))
              .subscribe((status) => {
                if (closed) return;
                if (status === 'SUBSCRIBED') signal('live');
                // CHANNEL_ERROR, TIMED_OUT and CLOSED all mean the same thing to a visitor: the
                // score is correct but will not move on its own.
                else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                  signal('unavailable');
                }
              });
          }).catch(() => {
            if (!closed) this.#zone.run(() => statusSubscriber.next('unavailable'));
          });
        });

        return () => {
          closed = true;
          if (channel !== undefined) void channel.unsubscribe();
        };
      });

      // Refetch on every signal from the channel, including the first, and carry the status
      // alongside so the indicator reflects the connection rather than the data.
      const inner = changes.pipe(
        debounceTime(REFETCH_DEBOUNCE_MS),
        startWith('static' as LiveStatus),
        switchMap((status) => fetchOnce().pipe(map((state) => ({ ...state, status })))),
      ).subscribe(subscriber);

      return () => {
        closed = true;
        inner.unsubscribe();
      };
    });
  }

  /** One round of reads: today's games, their live scores, their ticks. */
  #fetchState(teamId: number, today: string): Observable<LiveState> {
    return this.#results.todaysGames(teamId, today).pipe(
      switchMap((games) => {
        if (games.length === 0) {
          return of<LiveState>({ status: 'static', games: [], lastTickAt: null });
        }
        const ids = games.map((game) => game.id);
        return combineLatest([
          this.#results.liveGames(ids).pipe(catchError(() => of([] as readonly LiveGame[]))),
          this.#results.liveTicks(ids).pipe(catchError(() => of([] as readonly LiveTick[]))),
        ]).pipe(
          map(([live, ticks]) => buildState(games, live, ticks)),
        );
      }),
      catchError(() => of<LiveState>({ status: 'static', games: [], lastTickAt: null })),
    );
  }
}

function buildState(
  games: readonly ResultsGame[],
  live: readonly LiveGame[],
  ticks: readonly LiveTick[],
): LiveState {
  const liveById = new Map(live.map((row) => [row.gameId, row]));

  const views: LiveGameView[] = games.map((game) => ({
    game,
    live: liveById.get(game.id) ?? null,
    // Newest first, which is how a ticker reads.
    ticks: ticks
      .filter((tick) => tick.gameId === game.id)
      .slice()
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)),
  }));

  let lastTickAt: string | null = null;
  for (const tick of ticks) {
    if (lastTickAt === null || tick.occurredAt > lastTickAt) lastTickAt = tick.occurredAt;
  }

  return { status: 'static', games: views, lastTickAt };
}

/** True while a game has started and has not finished. Drives the "live" dot. */
export function isInProgress(view: LiveGameView): boolean {
  if (view.live !== null) return !view.live.finished;
  return !view.game.finished && view.ticks.length > 0;
}
