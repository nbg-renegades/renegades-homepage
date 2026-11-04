/**
 * What to write, given what is already stored.
 *
 * Pure: no I/O and no clock, so every rule here is a plain function of its inputs and is tested
 * as one. `store.ts` executes the answer; `sync-leaguesphere/index.ts` wires the two together.
 *
 * Play-by-play is written as a diff rather than deleted and re-inserted per game. A diff leaves
 * a game that did not change completely alone, which matters more than the saved bytes:
 * `results_game_events` is in the `supabase_realtime` publication, so delete-then-insert sent
 * every subscriber a DELETE and an INSERT for every play of every game on every run, and a
 * history reaching back to 2023 would have multiplied that by three.
 *
 * Gamedays and games are deliberately *not* diffed. The site's "Stand:" timestamp is the newest
 * `results_gamedays.updated_at`, so they are upserted on every successful run to keep it moving.
 */

import { involvesTrackedTeam } from './mappers.ts';
import type { GameEventRow } from './mappers.ts';
import type { UpstreamGame, UpstreamGameday } from './schema.ts';

/** The primary key of `results_game_events`. */
export type EventKey = Pick<GameEventRow, 'game_id' | 'half' | 'side' | 'seq'>;

export interface EventDiff {
  /** Plays that are new or differ from what is stored. */
  readonly upsert: readonly GameEventRow[];
  /** Stored plays upstream no longer has: a mis-entered play is corrected by deleting it. */
  readonly remove: readonly EventKey[];
}

/** Every column except the key. A play is unchanged exactly when all of these match. */
const VALUE_COLUMNS = [
  'text',
  'points',
  'score_home',
  'score_away',
  'is_deleted',
  'is_marker',
] as const;

function keyOf(row: EventKey): string {
  return `${row.game_id}|${row.half}|${row.side}|${row.seq}`;
}

export function diffEvents(
  existing: readonly GameEventRow[],
  desired: readonly GameEventRow[],
): EventDiff {
  const stored = new Map(existing.map((row) => [keyOf(row), row]));
  const wanted = new Set(desired.map(keyOf));

  const upsert = desired.filter((row) => {
    const old = stored.get(keyOf(row));
    return old === undefined || VALUE_COLUMNS.some((column) => old[column] !== row[column]);
  });
  const remove = existing
    .filter((row) => !wanted.has(keyOf(row)))
    .map(({ game_id, half, side, seq }) => ({ game_id, half, side, seq }));

  return { upsert, remove };
}

/**
 * The games whose play-by-play takes part in the diff: ours, and delivered with a log.
 *
 * A game with `log: null` carries no information about its plays, so its stored plays stay. A
 * game with an empty log does: upstream says there are none, and the stored ones go. That is why
 * this tests the payload and not the mapped rows, which are `[]` in both cases.
 *
 * Keyed by game id with the later copy winning, for the reason given in `mapTeamSnapshot`: the
 * two snapshot scopes are meant to be disjoint, but one game in both would otherwise appear
 * twice in a single write.
 */
export function gamesWithLogs(gamedays: readonly UpstreamGameday[]): readonly UpstreamGame[] {
  const games = new Map<number, UpstreamGame>();
  for (const gameday of gamedays) {
    for (const game of gameday.games) {
      if (involvesTrackedTeam(game) && game.log !== null) games.set(game.id, game);
    }
  }
  return [...games.values()];
}

// ── Scopes ───────────────────────────────────────────────────────────────────

/** The two snapshot calls: everything but drafts, then `status=DRAFT`. */
export type ScopeKind = 'main' | 'draft';

/**
 * What a scope told us this run. Only `fresh` is evidence of absence: `unchanged` (a 304) says
 * nothing has changed since the last 200, and `unknown` (429, cap, error, rejected payload)
 * says nothing at all.
 */
export type ScopeOutcome = 'fresh' | 'unchanged' | 'unknown';

export interface ScopeResult {
  readonly outcome: ScopeOutcome;
  /** Every gameday id the scope's payload held; empty unless `fresh`. */
  readonly gamedayIds: readonly number[];
}

/**
 * Whether the live tables may be pruned to today's games.
 *
 * Today's game ids come from this run's fresh payloads. When the main scope was a 304 and only
 * the draft scope answered, they come out empty, and an empty keep list clears every live row,
 * including a running game's, until the liveticker refills it. Only a fresh main scope sees
 * today's games, so only then is the list trustworthy.
 */
export function livePruneAllowed(scopes: Readonly<Record<ScopeKind, ScopeResult>>): boolean {
  return scopes.main.outcome === 'fresh';
}

// ── Pruning ──────────────────────────────────────────────────────────────────

/** What is stored for the synced window, read before this run writes anything. */
export interface StoredScope {
  readonly gamedays: readonly { readonly id: number; readonly status: string; readonly date: string }[];
  readonly games: readonly { readonly id: number; readonly gameday_id: number }[];
}

export interface PruneInput {
  /** Gamedays dated before this are outside the synced window and never touched. */
  readonly historyFrom: string;
  readonly stored: StoredScope;
  readonly scopes: Readonly<Record<ScopeKind, ScopeResult>>;
  /** What the fresh payloads map to: the gamedays and games the site should hold. */
  readonly kept: { readonly gamedayIds: readonly number[]; readonly gameIds: readonly number[] };
  readonly maxGamedays: number;
}

export interface PrunePlan {
  readonly gamedayIds: readonly number[];
  /** Games to delete on their own; the games of a deleted gameday go with it by cascade. */
  readonly gameIds: readonly number[];
  /** Why nothing is pruned although something looked prunable, or null. */
  readonly skipped: string | null;
}

/** One run deleting more gamedays than this is a bad payload, not a clean-up. */
export const MAX_PRUNED_GAMEDAYS_PER_RUN = 10;

const NOTHING: PrunePlan = { gamedayIds: [], gameIds: [], skipped: null };

/**
 * Which stored games and gamedays upstream no longer has.
 *
 * Deleting is the one irreversible thing the sync does, and an outage, a truncated payload or a
 * half-failed run must never empty the site, so every rule errs towards keeping:
 *
 * 1. A stored gameday belongs to the scope that can see it: `DRAFT` to the draft call, the rest
 *    to the main call.
 * 2. It is only a candidate if its date is on or after `historyFrom`, its own scope was `fresh`
 *    this run, and the other scope is not `unknown`. With the other one unknown, a gameday that
 *    moved between DRAFT and published cannot be told from a deleted one. A 304 on the other
 *    scope is fine: a move would have changed its ETag.
 * 3. A candidate goes when no fresh scope delivered it with a tracked game (`kept`). That covers
 *    a deleted gameday, one re-published under a new id, and one that lost our teams.
 * 4. The main scope returning no gamedays at all while main-owned gamedays are stored is an
 *    outage until proven otherwise: nothing is pruned and the reason is reported. The draft
 *    scope is empty in normal operation, so it never trips this.
 * 5. A stored game goes when its gameday is kept and the game is nowhere in `kept`, which also
 *    removes the old row when a game is re-published under a new id. A game that moved to
 *    another kept gameday is in `kept` and survives. The games of a deleted gameday are not
 *    listed: the foreign key cascade removes them with their plays and live rows.
 * 6. More than `maxGamedays` gamedays in one run deletes nothing and reports it.
 */
export function planPrune(input: PruneInput): PrunePlan {
  const { historyFrom, stored, scopes, kept, maxGamedays } = input;
  const keptGamedays = new Set(kept.gamedayIds);
  const keptGames = new Set(kept.gameIds);

  const inWindow = stored.gamedays.filter((gameday) => gameday.date >= historyFrom);
  const ownedBy = (gameday: { readonly status: string }): ScopeKind =>
    gameday.status === 'DRAFT' ? 'draft' : 'main';

  const mainOwned = inWindow.filter((gameday) => ownedBy(gameday) === 'main');
  if (
    scopes.main.outcome === 'fresh' && scopes.main.gamedayIds.length === 0 && mainOwned.length > 0
  ) {
    return {
      ...NOTHING,
      skipped: `the main scope returned no gamedays while ${mainOwned.length} are stored`,
    };
  }

  const gamedayIds = inWindow
    .filter((gameday) => {
      const own = ownedBy(gameday);
      const other = own === 'main' ? 'draft' : 'main';
      return scopes[own].outcome === 'fresh' && scopes[other].outcome !== 'unknown' &&
        !keptGamedays.has(gameday.id);
    })
    .map((gameday) => gameday.id)
    .sort((a, b) => a - b);

  if (gamedayIds.length > maxGamedays) {
    return {
      ...NOTHING,
      skipped: `${gamedayIds.length} gamedays would be deleted, more than the ${maxGamedays} ` +
        `allowed per run`,
    };
  }

  const gameIds = stored.games
    .filter((game) => keptGamedays.has(game.gameday_id) && !keptGames.has(game.id))
    .map((game) => game.id)
    .sort((a, b) => a - b);

  return { gamedayIds, gameIds, skipped: null };
}
