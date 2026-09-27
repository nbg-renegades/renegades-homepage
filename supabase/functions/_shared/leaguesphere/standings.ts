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

import { belongsToLeagueSeason, type LeagueSeasonConfig } from './config.ts';
import type { UpstreamGameday, UpstreamLeagueTable } from './schema.ts';

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

// ── Cross-check ──────────────────────────────────────────────────────────────

export interface StandingsDifference {
  readonly teamId: number;
  readonly field: string;
  readonly ours: number;
  readonly official: number;
}

/**
 * Compares our computation against the published table, field by field.
 *
 * The quotient is compared with a tolerance because the published tables round to 3 decimal
 * places and we keep 4. Quotient differences are reported separately from the rest: for DKB
 * DFFL they are expected and permanent, whereas a difference in games, wins or points means
 * our data is actually incomplete and needs looking at.
 */
export interface StandingsCheck {
  readonly leagueKey: string;
  readonly season: string;
  /** Teams we have that the published table does not, and vice versa. */
  readonly onlyOurs: readonly number[];
  readonly onlyOfficial: readonly number[];
  /** Differences in games, W/D/L or points — always worth investigating. */
  readonly recordDifferences: readonly StandingsDifference[];
  /** Quotient-only differences, expected where the league's ruleset is not public. */
  readonly quotientDifferences: readonly StandingsDifference[];
}

const QUOTIENT_TOLERANCE = 0.0006;

export function diffStandings(
  config: LeagueSeasonConfig,
  ours: readonly ComputedRow[],
  official: readonly StandingsRow[],
): StandingsCheck {
  const officialById = new Map(official.map((row) => [row.teamId, row]));
  const ourIds = new Set(ours.map((row) => row.teamId));

  const recordDifferences: StandingsDifference[] = [];
  const quotientDifferences: StandingsDifference[] = [];

  for (const row of ours) {
    const other = officialById.get(row.teamId);
    if (other === undefined) continue;

    const fields: readonly [string, number, number][] = [
      ['sp', row.sp, other.sp],
      ['s', row.s, other.s],
      ['u', row.u, other.u],
      ['n', row.n, other.n],
      ['ep', row.ep, other.ep],
      ['gp', row.gp, other.gp],
      ['pd', row.pd, other.pd],
    ];
    for (const [field, mine, theirs] of fields) {
      if (mine !== theirs) {
        recordDifferences.push({ teamId: row.teamId, field, ours: mine, official: theirs });
      }
    }
    if (Math.abs(row.sq - other.sq) > QUOTIENT_TOLERANCE) {
      quotientDifferences.push({ teamId: row.teamId, field: 'sq', ours: row.sq, official: other.sq });
    }
  }

  return {
    leagueKey: config.key,
    season: config.season,
    onlyOurs: ours.filter((row) => !officialById.has(row.teamId)).map((row) => row.teamId),
    onlyOfficial: official.filter((row) => !ourIds.has(row.teamId)).map((row) => row.teamId),
    recordDifferences,
    quotientDifferences,
  };
}

/** One-line summary for the function logs and `sync_state.last_error`. */
export function summariseCheck(check: StandingsCheck): string {
  const parts = [
    `${check.leagueKey}/${check.season}`,
    `record_diffs=${check.recordDifferences.length}`,
    `quotient_diffs=${check.quotientDifferences.length}`,
  ];
  if (check.onlyOurs.length > 0) parts.push(`only_ours=${check.onlyOurs.join(',')}`);
  if (check.onlyOfficial.length > 0) parts.push(`only_official=${check.onlyOfficial.join(',')}`);
  return parts.join(' ');
}
