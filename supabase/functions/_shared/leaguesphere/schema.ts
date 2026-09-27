/**
 * Validation for every LeagueSphere response we read.
 *
 * LeagueSphere is a third party. A release there can rename a field, change a type or
 * drop a key, and the rule (hard constraint 4) is that such a change must never reach
 * our tables: it is reported and the last good data stays. So nothing is trusted here —
 * each parser returns either a typed value or a list of paths that failed, and the sync
 * function writes only on success.
 *
 * Hand-rolled rather than zod on purpose: the shapes are few and stable, and this keeps
 * the function's cold start free of a dependency fetch.
 *
 * Deliberately permissive where upstream is genuinely open-ended, and strict where we
 * depend on the value:
 *  - `Gameinfo.status` is free text (`Geplant`, `2. Halbzeit`, `beendet`, …), so it is
 *    validated as a non-empty string and interpreted in `mappers.ts`, never as an enum.
 *  - Gameday `status` may be `""`; `Gameday.STATUS_CHOICES` upstream holds only DRAFT,
 *    PUBLISHED, IN_PROGRESS and COMPLETED, so `""` is a value no status filter selects.
 *  - Unknown extra keys are ignored. Upstream adding a field must not break us.
 */

/** Accumulates the paths that failed, so an error names the field instead of just failing. */
export class Validation {
  readonly #errors: string[] = [];

  error(path: string, message: string): void {
    this.#errors.push(`${path}: ${message}`);
  }

  get errors(): readonly string[] {
    return this.#errors;
  }

  get ok(): boolean {
    return this.#errors.length === 0;
  }
}

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: readonly string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(v: Validation, path: string, value: unknown): string | null {
  if (typeof value !== 'string') {
    v.error(path, `expected string, got ${typeof value}`);
    return null;
  }
  return value;
}

/** A string that must carry meaning (never `""`). */
function nonEmptyStr(v: Validation, path: string, value: unknown): string | null {
  const s = str(v, path, value);
  if (s === null) return null;
  if (s.length === 0) {
    v.error(path, 'expected a non-empty string');
    return null;
  }
  return s;
}

function int(v: Validation, path: string, value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    v.error(path, `expected integer, got ${JSON.stringify(value)}`);
    return null;
  }
  return value;
}

/** An integer that upstream leaves NULL until a score or a team is known. */
function nullableInt(v: Validation, path: string, value: unknown): number | null {
  if (value === null || value === undefined) return null;
  return int(v, path, value);
}

function nullableStr(v: Validation, path: string, value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return str(v, path, value);
}

function bool(v: Validation, path: string, value: unknown): boolean | null {
  if (typeof value !== 'boolean') {
    v.error(path, `expected boolean, got ${typeof value}`);
    return null;
  }
  return value;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isoDate(v: Validation, path: string, value: unknown): string | null {
  const s = str(v, path, value);
  if (s === null) return null;
  if (!DATE_PATTERN.test(s)) {
    v.error(path, `expected YYYY-MM-DD, got ${JSON.stringify(s)}`);
    return null;
  }
  return s;
}

function array(v: Validation, path: string, value: unknown): unknown[] | null {
  if (!Array.isArray(value)) {
    v.error(path, `expected array, got ${typeof value}`);
    return null;
  }
  return value;
}

function record(v: Validation, path: string, value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) {
    v.error(path, `expected object, got ${Array.isArray(value) ? 'array' : typeof value}`);
    return null;
  }
  return value;
}

// ── Upstream types ───────────────────────────────────────────────────────────
// These mirror `/api/snapshot/` exactly and must not leak outside this directory.

/** One side of a game. `pa` is points *against*; own points scored are `fh + sh`. */
export interface UpstreamGameResult {
  readonly team_id: number | null;
  readonly team_name: string | null;
  readonly fh: number | null;
  readonly sh: number | null;
  readonly pa: number | null;
  readonly isHome: boolean;
}

/**
 * One play-by-play entry, grouped by `sequence` the way upstream serialises it.
 *
 * A scoring play arrives as one entry carrying the players who scored:
 * `{sequence, td: 3, pat1: null}` is a touchdown by #3 with a failed 1-point try.
 * A possession change arrives as `{sequence, cop: true, name: 'Interception'}`.
 *
 * Player numbers are values, and **#0 is a real player number**, so presence must be
 * tested against null rather than truthiness.
 */
export interface UpstreamLogEntry {
  readonly sequence: number;
  readonly cop?: boolean;
  readonly name?: string;
  readonly isDeleted?: boolean;
  /** `td`, `pat1`, `pat2`, `OT` and free-form event names such as `Safety (+2)`. */
  readonly players: Readonly<Record<string, number | null>>;
}

export interface UpstreamLogHalf {
  readonly score: number;
  readonly entries: readonly UpstreamLogEntry[];
}

export interface UpstreamLogSide {
  readonly id: number | null;
  readonly name: string | null;
  readonly score: number;
  readonly firsthalf: UpstreamLogHalf;
  readonly secondhalf: UpstreamLogHalf;
}

export interface UpstreamGameLog {
  readonly gameId: number;
  readonly home: UpstreamLogSide;
  readonly away: UpstreamLogSide;
}

export interface UpstreamGame {
  readonly id: number;
  readonly gameday: number;
  readonly scheduled: string | null;
  readonly field: number | null;
  readonly stage: string | null;
  readonly standing: string | null;
  /** Free text: `Geplant`, `1. Halbzeit`, `2. Halbzeit`, `beendet`, … */
  readonly status: string;
  readonly results: readonly UpstreamGameResult[];
  readonly log: UpstreamGameLog | null;
}

export interface UpstreamGameday {
  readonly id: number;
  readonly name: string;
  readonly date: string;
  readonly start: string | null;
  readonly league: number | null;
  readonly league_display: string;
  readonly season: number | null;
  readonly season_display: string;
  readonly address: string | null;
  /** May be `""`, which no `status` filter can select. */
  readonly status: string;
  readonly games: readonly UpstreamGame[];
}

export interface UpstreamSnapshot {
  readonly generated_at: string;
  readonly etag: string | null;
  readonly gamedays: readonly UpstreamGameday[];
}

/** One `/api/liveticker/` tick. `time` is a full UTC ISO instant, not a clock time. */
export interface UpstreamTick {
  readonly text: string;
  readonly team: 'home' | 'away' | null;
  readonly time: string;
}

export interface UpstreamLiveGame {
  readonly gameId: number;
  readonly status: string;
  readonly home: { readonly name: string; readonly score: number };
  readonly away: { readonly name: string; readonly score: number };
  readonly ticks: readonly UpstreamTick[];
}

/** One row of `/api/league-table/<league>/<season>/`. */
export interface UpstreamStandingRow {
  readonly team_id: number;
  readonly team__description: string;
  /** Group name within the league, e.g. `Gruppe 1`, or `Initial` for unplayed teams. */
  readonly standing: string;
  readonly wins: number;
  readonly draws: number;
  readonly losses: number;
  readonly games_played: number;
  readonly pf: number;
  readonly pa: number;
  readonly diff: number;
  readonly win_points: number;
  readonly win_quotient: number;
}

export interface UpstreamLeagueTable {
  readonly league: { readonly slug: string; readonly name: string };
  readonly season: { readonly slug: string; readonly name: string };
  readonly standing: readonly UpstreamStandingRow[];
}

// ── Parsers ──────────────────────────────────────────────────────────────────

function parseLogEntry(v: Validation, path: string, raw: unknown): UpstreamLogEntry | null {
  const obj = record(v, path, raw);
  if (obj === null) return null;

  const sequence = int(v, `${path}.sequence`, obj['sequence']);
  if (sequence === null) return null;

  const players: Record<string, number | null> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key === 'sequence' || key === 'cop' || key === 'name' || key === 'isDeleted') continue;
    if (value === null) {
      // A failed attempt: the event happened, nobody is credited, it scores nothing.
      players[key] = null;
      continue;
    }
    const player = int(v, `${path}.${key}`, value);
    if (player === null) return null;
    players[key] = player;
  }

  return {
    sequence,
    cop: obj['cop'] === undefined ? undefined : (bool(v, `${path}.cop`, obj['cop']) ?? undefined),
    name: obj['name'] === undefined ? undefined : (nullableStr(v, `${path}.name`, obj['name']) ?? undefined),
    isDeleted: obj['isDeleted'] === undefined
      ? undefined
      : (bool(v, `${path}.isDeleted`, obj['isDeleted']) ?? undefined),
    players,
  };
}

function parseLogHalf(v: Validation, path: string, raw: unknown): UpstreamLogHalf | null {
  const obj = record(v, path, raw);
  if (obj === null) return null;
  const score = int(v, `${path}.score`, obj['score']);
  const rawEntries = array(v, `${path}.entries`, obj['entries']);
  if (score === null || rawEntries === null) return null;

  const entries: UpstreamLogEntry[] = [];
  for (const [i, rawEntry] of rawEntries.entries()) {
    const entry = parseLogEntry(v, `${path}.entries[${i}]`, rawEntry);
    if (entry === null) return null;
    entries.push(entry);
  }
  return { score, entries };
}

function parseLogSide(v: Validation, path: string, raw: unknown): UpstreamLogSide | null {
  const obj = record(v, path, raw);
  if (obj === null) return null;
  const score = int(v, `${path}.score`, obj['score']);
  const firsthalf = parseLogHalf(v, `${path}.firsthalf`, obj['firsthalf']);
  const secondhalf = parseLogHalf(v, `${path}.secondhalf`, obj['secondhalf']);
  if (score === null || firsthalf === null || secondhalf === null) return null;
  return {
    id: nullableInt(v, `${path}.id`, obj['id']),
    name: nullableStr(v, `${path}.name`, obj['name']),
    score,
    firsthalf,
    secondhalf,
  };
}

function parseGameLog(v: Validation, path: string, raw: unknown): UpstreamGameLog | null {
  const obj = record(v, path, raw);
  if (obj === null) return null;
  const gameId = int(v, `${path}.gameId`, obj['gameId']);
  const home = parseLogSide(v, `${path}.home`, obj['home']);
  const away = parseLogSide(v, `${path}.away`, obj['away']);
  if (gameId === null || home === null || away === null) return null;
  return { gameId, home, away };
}

function parseGameResult(v: Validation, path: string, raw: unknown): UpstreamGameResult | null {
  const obj = record(v, path, raw);
  if (obj === null) return null;
  const isHome = bool(v, `${path}.isHome`, obj['isHome']);
  if (isHome === null) return null;
  return {
    team_id: nullableInt(v, `${path}.team_id`, obj['team_id']),
    team_name: nullableStr(v, `${path}.team_name`, obj['team_name']),
    fh: nullableInt(v, `${path}.fh`, obj['fh']),
    sh: nullableInt(v, `${path}.sh`, obj['sh']),
    pa: nullableInt(v, `${path}.pa`, obj['pa']),
    isHome,
  };
}

function parseGame(v: Validation, path: string, raw: unknown): UpstreamGame | null {
  const obj = record(v, path, raw);
  if (obj === null) return null;

  const id = int(v, `${path}.id`, obj['id']);
  const gameday = int(v, `${path}.gameday`, obj['gameday']);
  // Free text upstream, so only "is a meaningful string" is asserted here.
  const status = nonEmptyStr(v, `${path}.status`, obj['status']);
  const rawResults = array(v, `${path}.results`, obj['results']);
  if (id === null || gameday === null || status === null || rawResults === null) return null;

  const results: UpstreamGameResult[] = [];
  for (const [i, rawResult] of rawResults.entries()) {
    const result = parseGameResult(v, `${path}.results[${i}]`, rawResult);
    if (result === null) return null;
    results.push(result);
  }

  // `log` is present only with `include=logs`; absent is normal, malformed is not.
  let log: UpstreamGameLog | null = null;
  if (obj['log'] !== undefined && obj['log'] !== null) {
    log = parseGameLog(v, `${path}.log`, obj['log']);
    if (log === null) return null;
  }

  return {
    id,
    gameday,
    scheduled: nullableStr(v, `${path}.scheduled`, obj['scheduled']),
    field: nullableInt(v, `${path}.field`, obj['field']),
    stage: nullableStr(v, `${path}.stage`, obj['stage']),
    standing: nullableStr(v, `${path}.standing`, obj['standing']),
    status,
    results,
    log,
  };
}

function parseGameday(v: Validation, path: string, raw: unknown): UpstreamGameday | null {
  const obj = record(v, path, raw);
  if (obj === null) return null;

  const id = int(v, `${path}.id`, obj['id']);
  const date = isoDate(v, `${path}.date`, obj['date']);
  const name = str(v, `${path}.name`, obj['name']);
  const leagueDisplay = str(v, `${path}.league_display`, obj['league_display']);
  const seasonDisplay = str(v, `${path}.season_display`, obj['season_display']);
  // `""` is a legitimate status, so this is `str` and not `nonEmptyStr`.
  const status = str(v, `${path}.status`, obj['status']);
  if (
    id === null || date === null || name === null ||
    leagueDisplay === null || seasonDisplay === null || status === null
  ) {
    return null;
  }

  // Without `include=games` there is no `games` key at all; treat that as empty.
  const games: UpstreamGame[] = [];
  if (obj['games'] !== undefined && obj['games'] !== null) {
    const rawGames = array(v, `${path}.games`, obj['games']);
    if (rawGames === null) return null;
    for (const [i, rawGame] of rawGames.entries()) {
      const game = parseGame(v, `${path}.games[${i}]`, rawGame);
      if (game === null) return null;
      games.push(game);
    }
  }

  return {
    id,
    name,
    date,
    start: nullableStr(v, `${path}.start`, obj['start']),
    league: nullableInt(v, `${path}.league`, obj['league']),
    league_display: leagueDisplay,
    season: nullableInt(v, `${path}.season`, obj['season']),
    season_display: seasonDisplay,
    address: nullableStr(v, `${path}.address`, obj['address']),
    status,
    games,
  };
}

export function parseSnapshot(raw: unknown): ParseResult<UpstreamSnapshot> {
  const v = new Validation();
  const obj = record(v, 'snapshot', raw);
  if (obj === null) return { ok: false, errors: v.errors };

  const generatedAt = nonEmptyStr(v, 'snapshot.generated_at', obj['generated_at']);
  const rawGamedays = array(v, 'snapshot.gamedays', obj['gamedays']);
  if (generatedAt === null || rawGamedays === null) return { ok: false, errors: v.errors };

  const gamedays: UpstreamGameday[] = [];
  for (const [i, rawGameday] of rawGamedays.entries()) {
    const gameday = parseGameday(v, `snapshot.gamedays[${i}]`, rawGameday);
    if (gameday === null) return { ok: false, errors: v.errors };
    gamedays.push(gameday);
  }

  if (!v.ok) return { ok: false, errors: v.errors };
  return {
    ok: true,
    value: { generated_at: generatedAt, etag: nullableStr(v, 'snapshot.etag', obj['etag']), gamedays },
  };
}

function parseTick(v: Validation, path: string, raw: unknown): UpstreamTick | null {
  const obj = record(v, path, raw);
  if (obj === null) return null;
  const text = str(v, `${path}.text`, obj['text']);
  const time = nonEmptyStr(v, `${path}.time`, obj['time']);
  if (text === null || time === null) return null;

  const rawTeam = obj['team'];
  let team: 'home' | 'away' | null = null;
  if (rawTeam !== null && rawTeam !== undefined) {
    if (rawTeam !== 'home' && rawTeam !== 'away') {
      v.error(`${path}.team`, `expected 'home', 'away' or null, got ${JSON.stringify(rawTeam)}`);
      return null;
    }
    team = rawTeam;
  }
  return { text, team, time };
}

function parseLiveSide(
  v: Validation,
  path: string,
  raw: unknown,
): { name: string; score: number } | null {
  const obj = record(v, path, raw);
  if (obj === null) return null;
  const name = str(v, `${path}.name`, obj['name']);
  const score = int(v, `${path}.score`, obj['score']);
  if (name === null || score === null) return null;
  return { name, score };
}

export function parseLiveticker(raw: unknown): ParseResult<readonly UpstreamLiveGame[]> {
  const v = new Validation();
  const rawGames = array(v, 'liveticker', raw);
  if (rawGames === null) return { ok: false, errors: v.errors };

  const games: UpstreamLiveGame[] = [];
  for (const [i, rawGame] of rawGames.entries()) {
    const path = `liveticker[${i}]`;
    const obj = record(v, path, rawGame);
    if (obj === null) return { ok: false, errors: v.errors };

    const gameId = int(v, `${path}.gameId`, obj['gameId']);
    const status = nonEmptyStr(v, `${path}.status`, obj['status']);
    const home = parseLiveSide(v, `${path}.home`, obj['home']);
    const away = parseLiveSide(v, `${path}.away`, obj['away']);
    const rawTicks = array(v, `${path}.ticks`, obj['ticks']);
    if (gameId === null || status === null || home === null || away === null || rawTicks === null) {
      return { ok: false, errors: v.errors };
    }

    const ticks: UpstreamTick[] = [];
    for (const [j, rawTick] of rawTicks.entries()) {
      const tick = parseTick(v, `${path}.ticks[${j}]`, rawTick);
      if (tick === null) return { ok: false, errors: v.errors };
      ticks.push(tick);
    }
    games.push({ gameId, status, home, away, ticks });
  }

  if (!v.ok) return { ok: false, errors: v.errors };
  return { ok: true, value: games };
}

/** `pf`, `pa`, `diff`, `win_points` and `win_quotient` arrive as JSON floats. */
function num(v: Validation, path: string, value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    v.error(path, `expected finite number, got ${JSON.stringify(value)}`);
    return null;
  }
  return value;
}

export function parseLeagueTable(raw: unknown): ParseResult<UpstreamLeagueTable> {
  const v = new Validation();
  const obj = record(v, 'leagueTable', raw);
  if (obj === null) return { ok: false, errors: v.errors };

  const league = record(v, 'leagueTable.league', obj['league']);
  const season = record(v, 'leagueTable.season', obj['season']);
  const rawRows = array(v, 'leagueTable.standing', obj['standing']);
  if (league === null || season === null || rawRows === null) return { ok: false, errors: v.errors };

  const leagueSlug = nonEmptyStr(v, 'leagueTable.league.slug', league['slug']);
  const leagueName = nonEmptyStr(v, 'leagueTable.league.name', league['name']);
  const seasonSlug = nonEmptyStr(v, 'leagueTable.season.slug', season['slug']);
  const seasonName = nonEmptyStr(v, 'leagueTable.season.name', season['name']);
  if (leagueSlug === null || leagueName === null || seasonSlug === null || seasonName === null) {
    return { ok: false, errors: v.errors };
  }

  const standing: UpstreamStandingRow[] = [];
  for (const [i, rawRow] of rawRows.entries()) {
    const path = `leagueTable.standing[${i}]`;
    const row = record(v, path, rawRow);
    if (row === null) return { ok: false, errors: v.errors };

    const teamId = int(v, `${path}.team_id`, row['team_id']);
    const description = nonEmptyStr(v, `${path}.team__description`, row['team__description']);
    const group = str(v, `${path}.standing`, row['standing']);
    const wins = int(v, `${path}.wins`, row['wins']);
    const draws = int(v, `${path}.draws`, row['draws']);
    const losses = int(v, `${path}.losses`, row['losses']);
    const gamesPlayed = int(v, `${path}.games_played`, row['games_played']);
    const pf = num(v, `${path}.pf`, row['pf']);
    const pa = num(v, `${path}.pa`, row['pa']);
    const diff = num(v, `${path}.diff`, row['diff']);
    const winPoints = num(v, `${path}.win_points`, row['win_points']);
    const winQuotient = num(v, `${path}.win_quotient`, row['win_quotient']);
    if (
      teamId === null || description === null || group === null || wins === null ||
      draws === null || losses === null || gamesPlayed === null || pf === null ||
      pa === null || diff === null || winPoints === null || winQuotient === null
    ) {
      return { ok: false, errors: v.errors };
    }

    standing.push({
      team_id: teamId,
      team__description: description,
      standing: group,
      wins,
      draws,
      losses,
      games_played: gamesPlayed,
      pf,
      pa,
      diff,
      win_points: winPoints,
      win_quotient: winQuotient,
    });
  }

  if (!v.ok) return { ok: false, errors: v.errors };
  return {
    ok: true,
    value: {
      league: { slug: leagueSlug, name: leagueName },
      season: { slug: seasonSlug, name: seasonName },
      standing,
    },
  };
}
