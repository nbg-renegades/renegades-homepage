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
} from './mappers.ts';
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
   * Replaces a game's play-by-play.
   *
   * Deleted and rewritten rather than upserted, because upstream can *remove* an entry: a
   * mis-entered play is corrected by deleting it, and an upsert would leave the stale row
   * behind for ever. Scoped to one game at a time so a failure cannot empty the table.
   */
  async replaceGameEvents(gameId: number, rows: readonly GameEventRow[]): Promise<void> {
    await this.deleteWhere('results_game_events', `game_id=eq.${gameId}`);
    await this.upsert('results_game_events', rows, 'game_id,half,side,seq');
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

  async saveLiveGames(rows: readonly LiveGameRow[]): Promise<void> {
    await this.upsert('results_live_games', withTimestamp(rows), 'game_id');
  }

  /** Clears live rows for games that are no longer today's. Keeps the table tiny. */
  async pruneLiveGames(keepGameIds: readonly number[]): Promise<void> {
    const filter = keepGameIds.length === 0
      ? 'game_id=gte.0'
      : `game_id=not.in.(${keepGameIds.join(',')})`;
    await this.deleteWhere('results_live_games', filter);
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
  async recordSuccess(
    source: string,
    at: Date,
    etag: string | null,
    callsLastHour: number,
  ): Promise<void> {
    await this.upsert('results_sync_state', [{
      source,
      etag,
      last_attempt_at: at.toISOString(),
      last_ok_at: at.toISOString(),
      last_error: null,
      calls_last_hour: callsLastHour,
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
  liveticker: 'liveticker',
  leagueSnapshot: (key: string, season: string) => `snapshot:league:${key}:${season}`,
  leagueTable: (key: string, season: string) => `league-table:${key}:${season}`,
} as const;

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
