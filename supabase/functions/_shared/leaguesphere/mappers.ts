/**
 * Upstream JSON → table rows. Pure: no clock, no network, no database.
 *
 * This is also the boundary where upstream's vocabulary stops. Everything past here speaks in
 * our column names, so the rest of the system never has to know that `pa` means points
 * against, that a game's status is German free text, or that `""` is a gameday status.
 */

import {
  belongsToLeagueSeason,
  isTrackedTeam,
  normaliseAddress,
  TEAM_IDS,
  type LeagueSeasonConfig,
  type TeamId,
} from './config.ts';
import {
  buildPlayByPlay,
  checkSideScores,
  type ScoredEvent,
} from './scoring.ts';
import type {
  UpstreamGame,
  UpstreamGameday,
  UpstreamLiveGame,
} from './schema.ts';
import { FINISHED_STATUS } from './standings.ts';

// ── Rows ─────────────────────────────────────────────────────────────────────

export interface GamedayRow {
  readonly id: number;
  readonly date: string;
  readonly start: string | null;
  readonly name: string;
  readonly league_display: string;
  readonly address: string | null;
  readonly status: string;
  readonly phase: GamedayPhase;
}

export interface GameRow {
  readonly id: number;
  readonly gameday_id: number;
  readonly scheduled: string | null;
  readonly field: number | null;
  readonly stage: string | null;
  readonly standing: string | null;
  readonly status: string;
  readonly finished: boolean;
  readonly home_team_id: number | null;
  readonly away_team_id: number | null;
  readonly home_name: string | null;
  readonly away_name: string | null;
  readonly home_score: number | null;
  readonly away_score: number | null;
  readonly home_ht: number | null;
  readonly away_ht: number | null;
}

export interface GameEventRow {
  readonly game_id: number;
  readonly seq: number;
  readonly half: 1 | 2;
  readonly side: 'home' | 'away';
  readonly text: string;
  readonly points: number;
  readonly score_home: number;
  readonly score_away: number;
  readonly is_deleted: boolean;
  readonly is_marker: boolean;
}

export interface LiveGameRow {
  readonly game_id: number;
  readonly home_score: number;
  readonly away_score: number;
  readonly last_tick_at: string | null;
  readonly finished: boolean;
}

/**
 * Where a gameday stands relative to today, from our teams' point of view.
 *
 * Derived rather than taken from upstream's `status`, which describes editorial state
 * (DRAFT/PUBLISHED) and not progress. `past` means there is nothing left to play.
 */
export type GamedayPhase = 'past' | 'today' | 'upcoming';

// ── Gamedays and games ───────────────────────────────────────────────────────

/**
 * Whether one of our teams appears in a game.
 *
 * Checked against `results`, which carries team assignments as soon as the fixture exists —
 * before any score. A gameday reaches us because *some* team of ours plays there, but most of
 * its games are between other clubs.
 */
export function involvesTrackedTeam(game: UpstreamGame): boolean {
  return game.results.some((result) => isTrackedTeam(result.team_id));
}

export function trackedTeamsInGameday(gameday: UpstreamGameday): readonly TeamId[] {
  const found = new Set<TeamId>();
  for (const game of gameday.games) {
    for (const result of game.results) {
      if (isTrackedTeam(result.team_id)) found.add(result.team_id);
    }
  }
  return TEAM_IDS.filter((id) => found.has(id));
}

export function isFinished(game: UpstreamGame): boolean {
  return game.status === FINISHED_STATUS;
}

/**
 * Classifies a gameday.
 *
 * A date in the past is `past` regardless of game statuses — a gameday can be left with games
 * still marked `2. Halbzeit` months later, and treating those as live would show a permanent
 * fake live game. Conversely a gameday dated today whose games are all finished is already
 * `past`, so it moves out of the live tab as soon as the last whistle goes.
 */
export function classifyGameday(gameday: UpstreamGameday, today: string): GamedayPhase {
  if (gameday.date < today) return 'past';
  if (gameday.date > today) return 'upcoming';

  const ours = gameday.games.filter(involvesTrackedTeam);
  const relevant = ours.length > 0 ? ours : gameday.games;
  if (relevant.length > 0 && relevant.every(isFinished)) return 'past';
  return 'today';
}

export function toGamedayRow(gameday: UpstreamGameday, today: string): GamedayRow {
  return {
    id: gameday.id,
    date: gameday.date,
    // Upstream serialises `start` as `HH:MM`, but an empty string appears too.
    start: emptyToNull(gameday.start),
    name: gameday.name,
    league_display: gameday.league_display,
    address: normaliseAddress(gameday.address),
    status: gameday.status,
    phase: classifyGameday(gameday, today),
  };
}

/**
 * Maps a game, resolving the two sides by `isHome`.
 *
 * `isHome` is used rather than array position: the order of `results` is not contractual, and
 * the halftime and final scores upstream reports are keyed by side. A team's own score is
 * `fh + sh`, which is also its opponent's `pa` — computing it from `fh + sh` keeps the row
 * self-consistent when one of the two is missing.
 */
export function toGameRow(game: UpstreamGame): GameRow {
  const home = game.results.find((result) => result.isHome) ?? null;
  const away = game.results.find((result) => !result.isHome) ?? null;

  return {
    id: game.id,
    gameday_id: game.gameday,
    scheduled: emptyToNull(game.scheduled),
    field: game.field,
    stage: emptyToNull(game.stage),
    standing: emptyToNull(game.standing),
    status: game.status,
    finished: isFinished(game),
    home_team_id: home?.team_id ?? null,
    away_team_id: away?.team_id ?? null,
    home_name: emptyToNull(home?.team_name ?? null),
    away_name: emptyToNull(away?.team_name ?? null),
    home_score: totalScore(home),
    away_score: totalScore(away),
    home_ht: home?.fh ?? null,
    away_ht: away?.fh ?? null,
  };
}

/**
 * A side's total, or null while unplayed.
 *
 * Null rather than 0 on purpose: upstream's `final_score` reports `{home: 0, away: 0}` for a
 * fixture nobody has played, and a stored 0 : 0 is indistinguishable from a real scoreless
 * draw. Null lets the UI show the kickoff time instead of a score.
 */
function totalScore(result: { fh: number | null; sh: number | null } | null): number | null {
  if (result === null) return null;
  if (result.fh === null && result.sh === null) return null;
  return (result.fh ?? 0) + (result.sh ?? 0);
}

function emptyToNull(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

// ── Play-by-play ─────────────────────────────────────────────────────────────

export function toGameEventRows(game: UpstreamGame): readonly GameEventRow[] {
  if (game.log === null) return [];
  return buildPlayByPlay(game.log.home, game.log.away).map((event) => toEventRow(game.id, event));
}

function toEventRow(gameId: number, event: ScoredEvent): GameEventRow {
  return {
    game_id: gameId,
    seq: event.seq,
    half: event.half,
    side: event.side,
    text: event.text,
    points: event.points,
    score_home: event.scoreHome,
    score_away: event.scoreAway,
    is_deleted: event.isDeleted,
    is_marker: event.isMarker,
  };
}

/**
 * Half scores where our arithmetic and upstream's disagree.
 *
 * Reported, never fatal: an unrecognised event costs one wrong play-by-play line, which is a
 * far better outcome than refusing to update the whole results page. The official score in
 * `games` comes from `fh`/`sh` and is unaffected either way.
 */
export interface ScoreDisagreement {
  readonly gameId: number;
  readonly side: 'home' | 'away';
  readonly half: 1 | 2;
  readonly reported: number;
  readonly computed: number;
}

export function findScoreDisagreements(game: UpstreamGame): readonly ScoreDisagreement[] {
  if (game.log === null) return [];
  const found: ScoreDisagreement[] = [];
  for (const [side, data] of [['home', game.log.home], ['away', game.log.away]] as const) {
    for (const check of checkSideScores(data)) {
      found.push({ gameId: game.id, side, ...check });
    }
  }
  return found;
}

// ── Live games ───────────────────────────────────────────────────────────────

/**
 * Maps a live game, keeping only the ones we actually store.
 *
 * The unfiltered liveticker returns whatever is running anywhere on the platform — on the day
 * these fixtures were recorded, U16 games between clubs we have nothing to do with. `knownGameIds`
 * is the set of games we hold for today, so nothing else can create rows.
 */
export function toLiveGameRows(
  live: readonly UpstreamLiveGame[],
  knownGameIds: ReadonlySet<number>,
): readonly LiveGameRow[] {
  return live
    .filter((game) => knownGameIds.has(game.gameId))
    .map((game) => ({
      game_id: game.gameId,
      // Upstream reports the score directly, so it is not re-derived from the ticks. With the
      // default 5-tick window a derived score would be wrong anyway.
      home_score: game.home.score,
      away_score: game.away.score,
      last_tick_at: latestTickTime(game),
      finished: game.status === FINISHED_STATUS,
    }));
}

/** The newest tick's instant. Ticks arrive newest-first, but that is not relied on. */
function latestTickTime(game: UpstreamLiveGame): string | null {
  let latest: string | null = null;
  let latestMs = Number.NEGATIVE_INFINITY;
  for (const tick of game.ticks) {
    const ms = Date.parse(tick.time);
    if (Number.isNaN(ms)) continue;
    if (ms > latestMs) {
      latestMs = ms;
      latest = tick.time;
    }
  }
  return latest;
}

// ── Selecting what to store ──────────────────────────────────────────────────

export interface MappedSnapshot {
  readonly gamedays: readonly GamedayRow[];
  readonly games: readonly GameRow[];
  readonly events: readonly GameEventRow[];
  readonly disagreements: readonly ScoreDisagreement[];
}

/**
 * Maps a team-scoped snapshot into the rows behind the schedule and live tabs.
 *
 * Only games involving our teams are kept. A gameday of 12 games typically has 3 or 4 of
 * ours, and storing the rest would multiply the data for rows nothing ever reads — hard
 * constraint 6 asks for the stored data to stay small. League tables are unaffected: they
 * come from `/api/league-table/`, not from these rows.
 */
export function mapTeamSnapshot(
  gamedays: readonly UpstreamGameday[],
  today: string,
): MappedSnapshot {
  const gamedayRows: GamedayRow[] = [];
  const gameRows: GameRow[] = [];
  const eventRows: GameEventRow[] = [];
  const disagreements: ScoreDisagreement[] = [];

  for (const gameday of gamedays) {
    const ours = gameday.games.filter(involvesTrackedTeam);
    // A gameday can reach us for a team we no longer track; it then has nothing to show.
    if (ours.length === 0) continue;

    gamedayRows.push(toGamedayRow(gameday, today));
    for (const game of ours) {
      gameRows.push(toGameRow(game));
      eventRows.push(...toGameEventRows(game));
      disagreements.push(...findScoreDisagreements(game));
    }
  }

  return { gamedays: gamedayRows, games: gameRows, events: eventRows, disagreements };
}

/**
 * The gamedays of one league season, for the standings cross-check.
 *
 * Takes a league-scoped snapshot: scoped by team it would only hold gamedays our teams
 * attended, and every other club in the table would be short of games.
 */
export function selectLeagueSeasonGamedays(
  config: LeagueSeasonConfig,
  gamedays: readonly UpstreamGameday[],
): readonly UpstreamGameday[] {
  return gamedays.filter((gameday) => belongsToLeagueSeason(config, gameday));
}

/** Games of our teams that are scheduled for today — the only ones the live tab may poll. */
export function todaysTrackedGameIds(
  gamedays: readonly UpstreamGameday[],
  today: string,
): ReadonlySet<number> {
  const ids = new Set<number>();
  for (const gameday of gamedays) {
    if (gameday.date !== today) continue;
    for (const game of gameday.games) {
      if (involvesTrackedTeam(game)) ids.add(game.id);
    }
  }
  return ids;
}
