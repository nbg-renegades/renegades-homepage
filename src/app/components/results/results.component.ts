import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  OnDestroy,
} from '@angular/core';
import { NgClass } from '@angular/common';
import { ActivatedRoute, Params, RouterLink } from '@angular/router';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { catchError, of, switchMap } from 'rxjs';
import { TranslatePipe } from '../../pipes/translate.pipe';
import { LocalePathPipe } from '../../pipes/locale-path.pipe';
import { MetaService } from '../../services/meta.service';
import { LanguageService } from '../../services/language.service';
import { ResultsService, type ResultsTeam } from '../../services/results.service';
import { ResultsLiveService, type LiveState } from '../../services/results-live.service';
import { SITE_ORIGIN } from '../../i18n/locale';
import { GamedayListComponent } from './gameday-list.component';
import { LiveTickerComponent } from './live-ticker.component';
import { StandingsTableComponent } from './standings-table.component';
import { TABS, tabFromParam, teamBySlug, type Tab } from './results.config';
import { clubToday, formatUpdatedAt } from './results.format';

/**
 * The results section: schedule, league table and live ticker, all from our own database.
 *
 * This used to embed a third-party widget in an iframe and negotiate its height and theme over
 * `postMessage`. That is gone, and with it the request every visitor's browser made to a personal
 * GitHub Pages account each time they opened the page. Everything here is server-rendered from
 * Postgres, so the results are in the HTML rather than behind a frame — indexable, and readable
 * without JavaScript — and no visitor's browser ever talks to LeagueSphere. Only the scheduled
 * sync function does that.
 *
 * The data is fetched with `HttpClient`, so it is fetched during server rendering too. Angular's
 * transfer cache then replays it on hydration, and the browser makes no request of its own for
 * what the server already delivered.
 */
@Component({
  selector: 'app-results',
  standalone: true,
  imports: [
    TranslatePipe,
    RouterLink,
    NgClass,
    LocalePathPipe,
    GamedayListComponent,
    StandingsTableComponent,
    LiveTickerComponent,
  ],
  templateUrl: './results.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ResultsComponent implements OnDestroy {
  #meta = inject(MetaService);
  #route = inject(ActivatedRoute);
  #language = inject(LanguageService);
  #results = inject(ResultsService);
  #live = inject(ResultsLiveService);

  readonly tabs: readonly Tab[] = TABS;

  readonly #params = toSignal(this.#route.params, { initialValue: {} as Params });

  readonly team = computed(() => teamBySlug(this.#params()['team']));
  readonly tab = computed<Tab>(() => tabFromParam(this.#params()['tab']));

  // ── Data ───────────────────────────────────────────────────────────────────

  /**
   * Each tab fetches only what it shows.
   *
   * Tabs are separate URLs, so a visitor only ever sees one of them per page load; fetching the
   * others' data would be a request per view that nobody reads. `null` means "not this tab".
   */
  readonly #scheduleWanted = computed(() => (this.tab() === 'spielplan' ? this.team() : null));
  readonly #standingsWanted = computed(() => (this.tab() === 'tabelle' ? this.team() : null));
  readonly #liveWanted = computed(() => (this.tab() === 'live' ? this.team() : null));

  /**
   * `undefined` means still loading or not this tab, and `null` means the request failed, which
   * the template tells apart — an empty array is a legitimate answer ("no gamedays yet") and must
   * not read as an error.
   */
  readonly gamedays = toSignal(
    toObservable(this.#scheduleWanted).pipe(
      switchMap((team) => team === null
        ? of(undefined)
        : this.#results.gamedays(team.teamId).pipe(catchError(() => of(null)))),
    ),
    { initialValue: undefined },
  );

  readonly standings = toSignal(
    toObservable(this.#standingsWanted).pipe(
      switchMap((team) => team === null
        ? of(undefined)
        : this.#results.standings(team.leagueKey, team.season).pipe(catchError(() => of(null)))),
    ),
    { initialValue: undefined },
  );

  /**
   * Today in the club's zone, resolved once per render.
   *
   * Deliberately not recomputed on a timer: a page open across midnight showing the gameday it was
   * opened on is correct, and swapping the content under a visitor at 00:00 would not be.
   */
  readonly #today = clubToday();

  /**
   * Today's games, updating over Realtime while the live tab is open.
   *
   * Subscribing opens the channel and unsubscribing closes it, so switching tab or leaving the
   * page tears it down — `toSignal` unsubscribes when the component is destroyed.
   */
  readonly liveState = toSignal(
    toObservable(this.#liveWanted).pipe(
      switchMap((team) => team === null
        ? of(null)
        : this.#live.liveState(team.teamId, this.#today)),
    ),
    { initialValue: null as LiveState | null },
  );

  readonly teams = toSignal(
    this.#results.teams$.pipe(catchError(() => of(new Map<number, ResultsTeam>()))),
    { initialValue: new Map<number, ResultsTeam>() },
  );

  readonly #lastUpdatedAt = toSignal(
    this.#results.lastUpdatedAt().pipe(catchError(() => of(null))),
    { initialValue: null },
  );

  readonly updatedAtLabel = computed(() => {
    const at = this.#lastUpdatedAt();
    return at === null ? null : formatUpdatedAt(at, this.#language.getCurrentLang());
  });

  readonly scheduleFailed = computed(() => this.gamedays() === null);
  readonly standingsFailed = computed(() => this.standings() === null);

  /** The tab's dot turns red only while something is actually being played. */
  readonly hasLiveGame = computed(() =>
    (this.liveState()?.games ?? []).some((view) => view.live !== null && !view.live.finished)
  );

  // ── Meta ───────────────────────────────────────────────────────────────────

  readonly #updateMeta = effect(() => {
    const team = this.team();
    const tab = this.tab();
    this.#meta.updateMeta({
      titleKey: 'meta.results.title',
      descriptionKey: 'meta.results.description',
      path: `/ergebnisse/${team.slug}/${tab}`,
    });
  });

  /**
   * `SportsEvent` for the fixtures still to be played.
   *
   * Upcoming only: a schema.org event in the past is noise, and Google's own guidance is to mark
   * up what a visitor could still attend. A gameday rather than a game, because that is what has a
   * start time and a place — an individual game's kickoff shifts all day.
   */
  readonly #upcomingJsonLd = effect(() => {
    const gamedays = this.gamedays();
    const team = this.team();
    if (gamedays === undefined || gamedays === null) return;

    const upcoming = gamedays
      .filter((gameday) => gameday.phase !== 'past')
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 10);

    if (upcoming.length === 0) {
      this.#meta.removeJsonLd('results-events');
      return;
    }

    this.#meta.setJsonLd('results-events', upcoming.map((gameday) => ({
      '@context': 'https://schema.org',
      '@type': 'SportsEvent',
      name: `${gameday.leagueDisplay} — ${gameday.name}`,
      startDate: gameday.startTime === null
        ? gameday.date
        : `${gameday.date}T${gameday.startTime}:00`,
      eventStatus: 'https://schema.org/EventScheduled',
      // Only ever a real address: the sync stores null for "tba" and the like.
      ...(gameday.address === null ? {} : {
        location: { '@type': 'Place', name: gameday.address, address: gameday.address },
      }),
      competitor: {
        '@type': 'SportsTeam',
        name: 'Nürnberg Renegades',
        url: `${SITE_ORIGIN}/ergebnisse/${team.slug}/spielplan`,
      },
    })));
  });

  ngOnDestroy(): void {
    // Page-scoped, so it must not follow the visitor onto the next route.
    this.#meta.removeJsonLd('results-events');
  }
}
