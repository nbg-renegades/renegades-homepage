/**
 * Standings: the table we store, and the cross-check that guards it.
 *
 * Two functions that must not be confused:
 *
 *  - `mapOfficialTable` turns `/api/league-table/` into the rows we store and display. This
 *    is the source of truth, because it is the table the league publishes.
 *  - `computeStandings` is our own port of the reference rules (SQ → PD → EP). It is *not*
 *    displayed. It runs on every sync and `diffStandings` reports where it disagrees, which
 *    is how we notice that a gameday is missing, an exclusion is stale, or upstream changed
 *    a rule.
 *
 * Why the official table rather than our computation, given we own the domain logic
 * elsewhere: the two configured leagues do not share a ruleset, and only one of them is
 * reproducible from public data.
 *
 *   FF BL 2026     win_points = 2·S + U,  quotient = win_points / (2 · games_played)
 *                  → our computation reproduces the published table exactly, 23/23 teams.
 *   DKB DFFL 2026  quotient = win_points / 30 — a fixed divisor, not games played — and
 *                  win_points weights a win by the opponent's league. We reproduce games,
 *                  W/D/L, points for and points against exactly (16/16 teams), but not the
 *                  quotient, and therefore not the order.
 *
 * The divisor, the per-league point weights, the per-team point adjustments and the tie-break
 * chain live in LeagueSphere's `LeagueRuleset` and `LeagueSeasonConfig`, none of which any
 * public endpoint exposes. Recomputing DKB DFFL would mean hard-coding inferred constants
 * that drift silently the moment the league changes them — and being wrong about the 1st
 * team's table is worse than depending on upstream for it.
 */

import {
  belongsToLeagueSeason,
  LEAGUE_KEY_BY_SLUG,
  type LeagueSeasonConfig,
  PROMOTION_RESTRICTED,
} from './config.ts';
import type { UpstreamGameday, UpstreamLeagueTable, UpstreamStandingsBlock } from './schema.ts';

/** The game status upstream uses for a finished game. */
export const FINISHED_STATUS = 'beendet';

/** A row of the `standings` table. */
export interface StandingsRow {
  readonly leagueKey: string;
  readonly season: string;
  readonly teamId: number;
  readonly rank: number;
  /** Group within the league, e.g. `Gruppe 1`. `Initial` upstream means "registered, no games". */
  readonly group: string;
  /** Spiele, Siege, Unentschieden, Niederlagen. */
  readonly sp: number;
  readonly s: number;
  readonly u: number;
  readonly n: number;
  /** Eigene Punkte (scored) and Gegenpunkte (conceded). */
  readonly ep: number;
  readonly gp: number;
  readonly pd: number;
  readonly sq: number;
  readonly promotionRestricted: boolean;
  readonly mode: 'official';
}

/**
 * Maps the published table onto our rows.
 *
 * Rank is the position in the response, which is already sorted by the league's own
 * tie-break chain — re-sorting here would replace that chain with a guess at it. Teams with
 * no games (`standing: 'Initial'`) are dropped: they carry no information and would otherwise
 * pad the bottom of every table with zeroes.
 */
export function mapOfficialTable(
  config: LeagueSeasonConfig,
  table: UpstreamLeagueTable,
): readonly StandingsRow[] {
  const played = table.standing.filter((row) => row.games_played > 0);
  return played.map((row, index) => ({
    leagueKey: config.key,
    season: config.season,
    teamId: row.team_id,
    rank: index + 1,
    group: row.standing,
    sp: row.games_played,
    s: row.wins,
    u: row.draws,
    n: row.losses,
    ep: row.pf,
    gp: row.pa,
    pd: row.diff,
    sq: row.win_quotient,
    promotionRestricted: config.promotionRestricted.includes(row.team_id),
    mode: 'official',
  }));
}

/**
 * Maps the snapshot's `standings` onto our rows, keeping upstream's own rank and group.
 *
 * Rank and group are never taken from array order. Teams with no games are dropped, because
 * ranks restart in every group (the `Initial` group of FF BL ranks its four unplayed teams
 * 1 to 4) and the stored key has no group, so they would collide with the real ranks. The
 * first row of a team within one league season wins. A league whose slug is not in
 * `LEAGUE_KEY_BY_SLUG` is skipped.
 */
export function mapSnapshotStandings(
  blocks: readonly UpstreamStandingsBlock[],
): readonly StandingsRow[] {
  const rows: StandingsRow[] = [];
  for (const block of blocks) {
    const leagueKey = LEAGUE_KEY_BY_SLUG[block.league.slug];
    if (leagueKey === undefined) continue;

    const season = block.season.slug;
    const restricted = PROMOTION_RESTRICTED[`${leagueKey}:${season}`] ?? [];
    const seen = new Set<number>();
    for (const row of block.rows) {
      if (row.games_played === 0 || seen.has(row.team_id)) continue;
      seen.add(row.team_id);
      rows.push({
        leagueKey,
        season,
        teamId: row.team_id,
        rank: row.rank,
        group: row.group,
        sp: row.games_played,
        s: row.wins,
        u: row.draws,
        n: row.losses,
        ep: row.pf,
        gp: row.pa,
        pd: row.diff,
        sq: row.win_quotient,
        promotionRestricted: restricted.includes(row.team_id),
        mode: 'official',
      });
    }
  }
  return rows;
}

/**
 * The year whose tables to ask for: that of the newest stored gameday, else of `today`.
 *
 * Not the clock alone. In January the new season is not published yet, so the calendar year
 * would ask for an empty table while the last season is still the one to show (D-18).
 */
export function standingsYear(newestGamedayDate: string | null, today: string): number {
  return Number((newestGamedayDate ?? today).slice(0, 4));
}

/** One league season's table, ready to store. */
export interface StandingsTable {
  readonly leagueKey: string;
  readonly season: string;
  readonly rows: readonly StandingsRow[];
}

export type StandingsOutcome =
  | { readonly kind: 'kept' }
  | { readonly kind: 'write'; readonly tables: readonly StandingsTable[] };

/**
 * Keep the stored tables or write new ones (D-27).
 *
 * No rows is a valid answer, for example a new season nobody has played in yet. It keeps the
 * last good tables and still counts as a success, so the task is not due again every minute
 * against the 20-an-hour budget. Otherwise one table per league season, in order of first
 * appearance.
 */
export function standingsOutcome(rows: readonly StandingsRow[]): StandingsOutcome {
  if (rows.length === 0) return { kind: 'kept' };

  const tables = new Map<string, { leagueKey: string; season: string; rows: StandingsRow[] }>();
  for (const row of rows) {
    const id = `${row.leagueKey}:${row.season}`;
    const table = tables.get(id) ?? { leagueKey: row.leagueKey, season: row.season, rows: [] };
    table.rows.push(row);
    tables.set(id, table);
  }
  return { kind: 'write', tables: [...tables.values()] };
}

// ── Our own computation, used only to cross-check ─────────────────────────────

export interface ComputedRow {
  readonly teamId: number;
  /** The short name upstream puts on a game result, e.g. `Nürn`. */
  readonly teamName: string;
  readonly sp: number;
  readonly s: number;
  readonly u: number;
  readonly n: number;
  readonly ep: number;
  readonly gp: number;
  readonly pd: number;
  readonly sq: number;
}

/**
 * Computes a league-season table from gamedays, porting the reference's rules.
 *
 * Two corrections to that port, both established by comparing against the published table:
 *
 *  - **Only finished games count.** The reference skips a game when `final_score == null`, but
 *    `/api/snapshot/` always returns an object — `{home: 0, away: 0}` while unplayed — so that
 *    guard never fires. Three abandoned games left in `2. Halbzeit` with scores entered were
 *    being counted, which is what kept FF BL at 18/23 teams instead of 23/23.
 *  - **`pa` is points against.** The winner is the side with the *lower* `pa`, a team's own
 *    points scored are its opponent's `pa`, and its conceded points are its own `pa`.
 *
 * The caller must pass gamedays from a **league**-scoped snapshot. Scoped by team, the
 * response only contains gamedays our teams attended, so every other club in the league is
 * short of games and the table is quietly wrong.
 */
export function computeStandings(
  config: LeagueSeasonConfig,
  gamedays: readonly UpstreamGameday[],
): readonly ComputedRow[] {
  interface Tally {
    teamName: string;
    sp: number;
    s: number;
    u: number;
    n: number;
    ep: number;
    gp: number;
  }

  const tallies = new Map<number, Tally>();

  for (const gameday of gamedays) {
    if (!belongsToLeagueSeason(config, gameday)) continue;

    for (const game of gameday.games) {
      if (game.status !== FINISHED_STATUS) continue;
      if (game.results.length < 2) continue;

      const [first, second] = game.results;
      // A placeholder fixture has rows but no teams or scores yet.
      if (first.pa === null || second.pa === null) continue;
      if (first.team_id === null || second.team_id === null) continue;

      for (const [self, opponent] of [[first, second], [second, first]] as const) {
        const teamId = self.team_id;
        const selfPa = self.pa;
        const opponentPa = opponent.pa;
        if (teamId === null || selfPa === null || opponentPa === null) continue;

        let tally = tallies.get(teamId);
        if (tally === undefined) {
          tally = { teamName: self.team_name ?? String(teamId), sp: 0, s: 0, u: 0, n: 0, ep: 0, gp: 0 };
          tallies.set(teamId, tally);
        }

        tally.sp += 1;
        tally.ep += opponentPa; // our points scored = what the opponent conceded
        tally.gp += selfPa; // our points conceded
        if (selfPa < opponentPa) tally.s += 1;
        else if (selfPa === opponentPa) tally.u += 1;
        else tally.n += 1;
      }
    }
  }

  const rows: ComputedRow[] = [];
  for (const [teamId, tally] of tallies) {
    rows.push({
      teamId,
      teamName: tally.teamName,
      sp: tally.sp,
      s: tally.s,
      u: tally.u,
      n: tally.n,
      ep: tally.ep,
      gp: tally.gp,
      pd: tally.ep - tally.gp,
      // A win is 2, a draw 1, out of 2 per game played. Rounded to 4 places, matching the
      // reference; the published tables round to 3, which `diffStandings` allows for.
      sq: round((2 * tally.s + tally.u) / (2 * tally.sp), 4),
    });
  }

  rows.sort((a, b) => (b.sq - a.sq) || (b.pd - a.pd) || (b.ep - a.ep));
  return rows;
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
