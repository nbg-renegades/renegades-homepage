/**
 * Standings: the table we store, read from the snapshot's `standings`.
 *
 * We display the table the league publishes and never compute one ourselves, because the two
 * configured leagues do not share a ruleset and only one of them is reproducible from public
 * data.
 *
 *   FF BL 2026     win_points = 2·S + U,  quotient = win_points / (2 · games_played).
 *   DKB DFFL 2026  quotient = win_points / 30 — a fixed divisor, not games played — and
 *                  win_points weights a win by the opponent's league.
 *
 * The divisor, the per-league point weights, the per-team point adjustments and the tie-break
 * chain live in LeagueSphere's `LeagueRuleset` and `LeagueSeasonConfig`, none of which any
 * public endpoint exposes. Recomputing DKB DFFL would mean hard-coding inferred constants
 * that drift silently the moment the league changes them — and being wrong about the 1st
 * team's table is worse than depending on upstream for it.
 */

import { LEAGUE_KEY_BY_SLUG, PROMOTION_RESTRICTED } from './config.ts';
import type { UpstreamStandingsBlock } from './schema.ts';

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
