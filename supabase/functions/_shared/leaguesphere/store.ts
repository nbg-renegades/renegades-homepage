/**
 * Reads and writes our own tables, over PostgREST.
 *
 * Plain `fetch` rather than `@supabase/supabase-js` for the same reason `schema.ts` is
 * hand-rolled: this function runs on a one-minute cron, so every cold start pays for whatever
 * it imports, and all it needs is a handful of upserts and one select. supabase-js earns its
 * place in the browser, where it also brings Realtime; here it would be a dependency fetch per
 * cold start for an ergonomic `.from().upsert()`.
 *
 * Connects as the service role, which bypasses RLS. That is deliberate and is the only writer:
 * `anon` holds SELECT and nothing else, and every policy is read-only (see the
 * `results_schema` migration).
 *
 * `fetchImpl` is injected so the tests exercise the request shapes without a database.
 */

import type {
  GameEventRow,
  GameRow,
  GamedayRow,
  LiveGameRow,
  LiveTickRow,
} from './mappers.ts';
import type { EventKey, StoredScope } from './reconcile.ts';
import { persistedBackoffUntil } from './client.ts';
import type { Endpoint, SnapshotBudget, SnapshotBucket } from './client.ts';
import type { StandingsRow } from './standings.ts';
import type { Task } from './schedule.ts';

/** Rows of `results_sync_state`, keyed by `source`. */
export interface SyncStateRow {
  readonly source: string;
  readonly etag: string | null;
  readonly last_attempt_at: string | null;
  readonly last_ok_at: string | null;
  readonly last_error: string | null;
  readonly calls_last_hour: number;
  readonly calls_window_started_at: string | null;
  readonly alerted_at: string | null;
}

export interface StoreOptions {
  readonly url: string;
  readonly serviceRoleKey: string;
  readonly fetchImpl?: typeof fetch;
  readonly log?: (message: string) => void;
}

/** Rows per page of `selectAll`, below the 1000-row cap so a lower configured cap still works. */
const PAGE_SIZE = 500;
/** Ids per `in.(...)` filter, which keeps the URL far below any gateway limit. */
const ID_CHUNK = 100;
/** Keys per DELETE of play-by-play, about 1.5 KB of URL. */
const EVENT_DELETE_CHUNK = 40;

export class StoreError extends Error {
  constructor(message: string, readonly status: number | null) {
    super(message);
    this.name = 'StoreError';
  }
}

export class ResultsStore {
  readonly #base: string;
  readonly #key: string;
  readonly #fetch: typeof fetch;
  readonly #log: (message: string) => void;

  constructor(options: StoreOptions) {
    this.#base = `${options.url.replace(/\/$/, '')}/rest/v1`;
    this.#key = options.serviceRoleKey;
    this.#fetch = options.fetchImpl ?? fetch;
    this.#log = options.log ?? ((message) => console.log(message));
  }

  // ── Plumbing ───────────────────────────────────────────────────────────────

  async #request(path: string, init: RequestInit & { prefer?: string }): Promise<unknown> {
    const headers: Record<string, string> = {
      apikey: this.#key,
      authorization: `Bearer ${this.#key}`,
      'content-type': 'application/json',
    };
    if (init.prefer !== undefined) headers['prefer'] = init.prefer;

    const response = await this.#fetch(`${this.#base}${path}`, { ...init, headers });
    if (!response.ok) {
      // PostgREST error bodies name the constraint or column, which is what makes a failed
      // write diagnosable. The key is never logged.
      const detail = await response.text().catch(() => '');
      throw new StoreError(
        `${init.method ?? 'GET'} ${path} → ${response.status}${detail === '' ? '' : ` ${detail}`}`,
        response.status,
      );
    }
    if (response.status === 204) return null;
    const text = await response.text();
    return text === '' ? null : JSON.parse(text);
  }

  /**
   * Upserts a batch.
   *
   * `resolution=merge-duplicates` makes this a single atomic `INSERT … ON CONFLICT DO UPDATE`
   * rather than a read-then-write, so two overlapping syncs cannot race. `return=minimal` keeps
   * the response empty — we never need the rows back, and a gameday's worth of events is a lot
   * of JSON to parse for nothing.
   */
  // `object` rather than `Record<string, unknown>`: the row interfaces declare exact keys and
  // so have no index signature, which a Record parameter would demand.
  async upsert(
    table: string,
    rows: readonly object[],
    onConflict: string,
  ): Promise<void> {
    if (rows.length === 0) return;

    // PostgREST takes the whole batch in one statement. Chunked anyway, because a gameday with
    // full play-by-play for every game is a few thousand rows and a single vast request is the
    // one most likely to hit a gateway body limit.
    const CHUNK = 500;
    for (let index = 0; index < rows.length; index += CHUNK) {
      const chunk = rows.slice(index, index + CHUNK);
      await this.#request(`/${table}?on_conflict=${encodeURIComponent(onConflict)}`, {
        method: 'POST',
        body: JSON.stringify(chunk),
        prefer: 'resolution=merge-duplicates,return=minimal',
      });
    }
    this.#log(`[store] upserted ${rows.length} row(s) into ${table}`);
  }

  async select<T>(table: string, query: string): Promise<readonly T[]> {
    const result = await this.#request(`/${table}?${query}`, { method: 'GET' });
    return Array.isArray(result) ? result as T[] : [];
  }

  /**
   * Every row a query matches, read in pages.
   *
   * PostgREST caps a response at its `max-rows` (1000 on hosted Supabase) and answers 200 with
   * the first rows, so a plain `select` over a big table is silently short. `query` must carry
   * an `order=` so the pages do not overlap. Stops on an empty page rather than a short one: a
   * server capped below `pageSize` would otherwise look finished after its first page. A page
   * that is not an array is an error here, unlike in `select`, because a diff or prune built on
   * a read that quietly returned nothing would write or delete the wrong rows.
   */
  async selectAll<T>(table: string, query: string, pageSize = PAGE_SIZE): Promise<readonly T[]> {
    const rows: T[] = [];
    for (;;) {
      const path = `/${table}?${query}&limit=${pageSize}&offset=${rows.length}`;
      const page = await this.#request(path, { method: 'GET' });
      if (!Array.isArray(page)) {
        throw new StoreError(`GET ${path} → expected an array of rows`, null);
      }
      if (page.length === 0) return rows;
      rows.push(...page as T[]);
    }
  }

  async deleteWhere(table: string, filter: string): Promise<void> {
    await this.#request(`/${table}?${filter}`, {
      method: 'DELETE',
      prefer: 'return=minimal',
    });
  }

  // ── Content ────────────────────────────────────────────────────────────────

  async saveGamedays(rows: readonly GamedayRow[]): Promise<void> {
    await this.upsert('results_gamedays', withTimestamp(rows), 'id');
  }

  async saveGames(rows: readonly GameRow[]): Promise<void> {
    await this.upsert('results_games', withTimestamp(rows), 'id');
  }

  /**
   * The stored play-by-play of the given games, in key order.
   *
   * Paged: a full history holds well over the 1000 rows PostgREST returns per response, and a
   * silently truncated read would make the diff re-write the missing plays every run. Game ids
   * go in chunks of 100 to keep the URL short.
   */
  async loadGameEvents(gameIds: readonly number[]): Promise<readonly GameEventRow[]> {
    const rows: GameEventRow[] = [];
    for (let index = 0; index < gameIds.length; index += ID_CHUNK) {
      const ids = gameIds.slice(index, index + ID_CHUNK).join(',');
      rows.push(...await this.selectAll<GameEventRow>(
        'results_game_events',
        `select=game_id,seq,half,side,text,points,score_home,score_away,is_deleted,is_marker` +
          `&game_id=in.(${ids})&order=game_id,half,side,seq`,
      ));
    }
    return rows;
  }

  /** Writes new and changed plays. Events carry no `updated_at`, so none is added. */
  async saveGameEvents(rows: readonly GameEventRow[]): Promise<void> {
    await this.upsert('results_game_events', rows, 'game_id,half,side,seq');
  }

  /**
   * Deletes plays by key, for the ones upstream removed: a mis-entered play is corrected by
   * deleting it, and an upsert would leave the stale row behind for the rest of the season.
   *
   * One request per game and 40 keys at most, so the `or` filter stays a short URL. Every value
   * is an integer or the `home`/`away` side, never an upstream string.
   */
  async deleteGameEvents(keys: readonly EventKey[]): Promise<void> {
    const byGame = new Map<number, EventKey[]>();
    for (const key of keys) byGame.set(key.game_id, [...byGame.get(key.game_id) ?? [], key]);

    for (const [gameId, gameKeys] of byGame) {
      for (let index = 0; index < gameKeys.length; index += EVENT_DELETE_CHUNK) {
        const conditions = gameKeys
          .slice(index, index + EVENT_DELETE_CHUNK)
          .map((key) => `and(half.eq.${key.half},side.eq.${key.side},seq.eq.${key.seq})`)
          .join(',');
        await this.deleteWhere('results_game_events', `game_id=eq.${gameId}&or=(${conditions})`);
      }
    }
  }

  /**
   * The gamedays from `from` on and their games, as stored now.
   *
   * Read before a run writes anything, so the prune compares against the state the payload is
   * about to replace. Paged for the same reason as the plays: a truncated read would hide stored
   * rows from the prune.
   */
  async loadStoredScope(from: string): Promise<StoredScope> {
    const gamedays = await this.selectAll<StoredScope['gamedays'][number]>(
      'results_gamedays',
      `select=id,status,date&date=gte.${encodeURIComponent(from)}&order=id`,
    );
    const games: StoredScope['games'][number][] = [];
    for (let index = 0; index < gamedays.length; index += ID_CHUNK) {
      const ids = gamedays.slice(index, index + ID_CHUNK).map((gameday) => gameday.id).join(',');
      games.push(...await this.selectAll<StoredScope['games'][number]>(
        'results_games',
        `select=id,gameday_id&gameday_id=in.(${ids})&order=id`,
      ));
    }
    return { gamedays, games };
  }

  /** Deletes games by id; their plays and live rows follow through the foreign keys. */
  async deleteGames(ids: readonly number[]): Promise<void> {
    await this.#deleteByIds('results_games', ids);
  }

  /** Deletes gamedays by id; their games, plays and live rows follow through the foreign keys. */
  async deleteGamedays(ids: readonly number[]): Promise<void> {
    await this.#deleteByIds('results_gamedays', ids);
  }

  async #deleteByIds(table: string, ids: readonly number[]): Promise<void> {
    for (let index = 0; index < ids.length; index += ID_CHUNK) {
      await this.deleteWhere(table, `id=in.(${ids.slice(index, index + ID_CHUNK).join(',')})`);
    }
  }

  /**
   * Replaces a league season's table.
   *
   * Also a delete-then-insert: a team can leave a league between syncs, and an upsert would
   * keep it in the table at its last known rank for the rest of the season.
   */
  async replaceStandings(
    leagueKey: string,
    season: string,
    rows: readonly StandingsRow[],
  ): Promise<void> {
    await this.deleteWhere(
      'results_standings',
      `league_key=eq.${encodeURIComponent(leagueKey)}&season=eq.${encodeURIComponent(season)}`,
    );
    await this.upsert(
      'results_standings',
      withTimestamp(rows.map(toStandingsColumns)),
      'league_key,season,team_id',
    );
  }

  /**
   * Writes a league season's table without ever leaving it empty for a reader.
   *
   * A team can leave a league between syncs, so teams missing from the new set are removed,
   * but only after the upsert: the old delete-then-insert showed an empty table in between.
   * An empty list writes and deletes nothing. `season` arrives validated as four digits and
   * is URI-encoded anyway.
   */
  async saveStandings(
    leagueKey: string,
    season: string,
    rows: readonly StandingsRow[],
  ): Promise<void> {
    if (rows.length === 0) return;
    await this.upsert(
      'results_standings',
      withTimestamp(rows.map(toStandingsColumns)),
      'league_key,season,team_id',
    );
    await this.deleteWhere(
      'results_standings',
      `league_key=eq.${encodeURIComponent(leagueKey)}&season=eq.${encodeURIComponent(season)}` +
        `&team_id=not.in.(${rows.map((row) => row.teamId).join(',')})`,
    );
  }

  /** The date of the newest gameday we store, or null before the first sync. */
  async newestGamedayDate(): Promise<string | null> {
    const rows = await this.select<{ date: string }>(
      'results_gamedays',
      'select=date&order=date.desc&limit=1',
    );
    return rows[0]?.date ?? null;
  }

  async saveLiveGames(rows: readonly LiveGameRow[]): Promise<void> {
    await this.upsert('results_live_games', withTimestamp(rows), 'game_id');
  }

  /**
   * Live ticks.
   *
   * Upserted rather than replaced: the key is the tick itself, so re-delivering the same five
   * ticks every minute is a no-op, and a tick that has scrolled out of upstream's window stays.
   */
  async saveLiveTicks(rows: readonly LiveTickRow[]): Promise<void> {
    await this.upsert('results_live_ticks', rows, 'game_id,tick_key');
  }

  /** Clears live rows for games that are no longer today's. Keeps both tables tiny. */
  async pruneLiveGames(keepGameIds: readonly number[]): Promise<void> {
    const filter = keepGameIds.length === 0
      ? 'game_id=gte.0'
      : `game_id=not.in.(${keepGameIds.join(',')})`;
    await this.deleteWhere('results_live_games', filter);
    await this.deleteWhere('results_live_ticks', filter);
  }

  /** Kickoff times of our games on a given date, for the scheduler. */
  async todaysGames(date: string): Promise<readonly { id: number; scheduled: string | null; finished: boolean; status: string }[]> {
    return this.select(
      'results_games',
      `select=id,scheduled,finished,status&gameday_id=in.(${
        (await this.gamedayIdsOn(date)).join(',') || '0'
      })`,
    );
  }

  async gamedayIdsOn(date: string): Promise<readonly number[]> {
    const rows = await this.select<{ id: number }>(
      'results_gamedays',
      `select=id&date=eq.${encodeURIComponent(date)}`,
    );
    return rows.map((row) => row.id);
  }

  // ── Sync state ─────────────────────────────────────────────────────────────

  async loadSyncState(): Promise<ReadonlyMap<string, SyncStateRow>> {
    const rows = await this.select<SyncStateRow>('results_sync_state', 'select=*');
    return new Map(rows.map((row) => [row.source, row]));
  }

  async recordAttempt(source: string, at: Date): Promise<void> {
    await this.upsert('results_sync_state', [{
      source,
      last_attempt_at: at.toISOString(),
      updated_at: at.toISOString(),
    }], 'source');
  }

  /** A successful run: stamps `last_ok_at`, stores the new ETag and clears the error. */
  async recordSuccess(source: string, at: Date, etag: string | null): Promise<void> {
    await this.upsert('results_sync_state', [{
      source,
      etag,
      last_attempt_at: at.toISOString(),
      last_ok_at: at.toISOString(),
      last_error: null,
      alerted_at: null,
      updated_at: at.toISOString(),
    }], 'source');
  }

  /**
   * A failed run.
   *
   * Writes the error and nothing else. `last_ok_at` and `etag` are deliberately untouched, so
   * the site keeps serving the last good data and shows how old it is, and the next attempt
   * still revalidates against the ETag we know worked.
   */
  async recordFailure(source: string, at: Date, error: string): Promise<void> {
    await this.upsert('results_sync_state', [{
      source,
      last_attempt_at: at.toISOString(),
      // Bounded: an upstream HTML error page would otherwise land in full in this column.
      last_error: error.slice(0, 2000),
      updated_at: at.toISOString(),
    }], 'source');
  }

  /**
   * One snapshot budget, on the row `BUDGET_SOURCES` names for it. Only the budget columns are
   * written, so a stored ETag, success time or 429 on the same row survives.
   */
  async recordSnapshotBudget(source: string, budget: SnapshotBudget, at: Date): Promise<void> {
    await this.upsert('results_sync_state', [{
      source,
      calls_last_hour: budget.calls,
      calls_window_started_at: budget.windowStartedAt.toISOString(),
      updated_at: at.toISOString(),
    }], 'source');
  }

  async markAlerted(source: string, at: Date): Promise<void> {
    await this.upsert('results_sync_state', [{
      source,
      alerted_at: at.toISOString(),
      updated_at: at.toISOString(),
    }], 'source');
  }
}

function withTimestamp<T extends object>(rows: readonly T[]): readonly object[] {
  const updated_at = new Date().toISOString();
  return rows.map((row) => ({ ...row, updated_at }));
}

/** `StandingsRow` is camelCase for the domain; the table is snake_case. */
function toStandingsColumns(row: StandingsRow): Record<string, unknown> {
  return {
    league_key: row.leagueKey,
    season: row.season,
    team_id: row.teamId,
    rank: row.rank,
    group_name: row.group,
    sp: row.sp,
    s: row.s,
    u: row.u,
    n: row.n,
    ep: row.ep,
    gp: row.gp,
    pd: row.pd,
    sq: row.sq,
    promotion_restricted: row.promotionRestricted,
    mode: row.mode,
  };
}

/** `results_sync_state.source` for each task scope. */
export const SYNC_SOURCES = {
  teamSnapshot: 'snapshot:teams',
  draftSnapshot: 'snapshot:draft',
  standingsSnapshot: 'snapshot:standings',
  liveticker: 'liveticker',
  leagueSnapshot: (key: string, season: string) => `snapshot:league:${key}:${season}`,
  leagueTable: (key: string, season: string) => `league-table:${key}:${season}`,
} as const;

/**
 * The rows that carry the two snapshot budgets between ticks (D-15). Each budget lives on the
 * row of the scope that spends it most, so no migration is needed: the narrow budget stays on
 * `snapshot:teams`, and the standings budget gets a row of its own on its first call.
 */
export const BUDGET_SOURCES: Readonly<Record<SnapshotBucket, string>> = {
  snapshot: SYNC_SOURCES.teamSnapshot,
  'snapshot-standings': SYNC_SOURCES.standingsSnapshot,
};

/**
 * The budget a sync-state row's calls are spent against, or null for a row we do not know.
 * Routes a persisted 429 back to the bucket that received it. `snapshot:standings` is checked
 * before the `snapshot:` prefix that every other snapshot scope shares.
 */
export function endpointForSource(source: string): Endpoint | null {
  if (source === SYNC_SOURCES.standingsSnapshot) return 'snapshot-standings';
  if (source.startsWith('snapshot:')) return 'snapshot';
  if (source.startsWith('league-table')) return 'league-table';
  if (source === SYNC_SOURCES.liveticker) return 'liveticker';
  return null;
}

/**
 * The 429 back-offs the last ticks left in `last_error`, per bucket (D-25).
 *
 * The client is rebuilt every tick, so without this a `Retry-After` of ten minutes would be
 * forgotten after one. Per bucket, because a 429 on the standings budget must not stop a live
 * poll. The latest instant wins when several rows of one bucket carry one.
 */
export function blocksFromPersistedState(
  rows: Iterable<SyncStateRow>,
  now: number,
): ReadonlyMap<Endpoint, number> {
  const blocks = new Map<Endpoint, number>();
  for (const row of rows) {
    const endpoint = endpointForSource(row.source);
    if (endpoint === null) continue;
    const until = persistedBackoffUntil(row.last_error, now);
    if (until === null) continue;
    blocks.set(endpoint, Math.max(blocks.get(endpoint) ?? 0, until));
  }
  return blocks;
}

/** Maps a task to the `source` whose `last_ok_at` gates it. */
export function taskSource(task: Task): string {
  switch (task) {
    case 'team-snapshot':
      return SYNC_SOURCES.teamSnapshot;
    case 'liveticker':
      return SYNC_SOURCES.liveticker;
    case 'league-table':
      return 'league-table';
    case 'league-snapshot':
      return 'snapshot:league';
  }
}
