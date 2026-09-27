/**
 * What we sync, and the identifiers each upstream endpoint wants for it.
 *
 * Three different identifier systems name the same league season, which is the single
 * most error-prone thing about this integration:
 *
 *  - `/api/snapshot/` filters on **primary keys** (`league=18`, `season=6`). A year is not
 *    a season id: `season=2026` is rejected with
 *    `400 {"season":"unknown Season ids: [2026]"}`.
 *  - Gamedays come back carrying only `league_display` ("FF BL", "DKB DFFL"), so matching a
 *    gameday to a league season is done on that string plus the year in `date`.
 *  - `/api/league-table/` takes **slugs**, and they do not match our own config keys: the
 *    1st team's league is `dffl`, while `dkb-dffl` returns
 *    `404 {"detail":"Unknown league or season."}`.
 *
 * All values below were verified against the live API on 2026-09-27; the recordings are in
 * `__fixtures__/`.
 */

/** The two club teams in scope. Upstream returns only short names, so we own the display ones. */
export const TEAMS = {
  159: { slug: '1-mannschaft', name: '1. Mannschaft' },
  287: { slug: '2-mannschaft', name: '2. Mannschaft' },
} as const;

export type TeamId = keyof typeof TEAMS;

export const TEAM_IDS: readonly TeamId[] = Object.keys(TEAMS).map(Number) as TeamId[];

export function isTrackedTeam(teamId: number | null): teamId is TeamId {
  return teamId !== null && teamId in TEAMS;
}

/**
 * How a league season's standings are obtained.
 *
 * `official` stores `/api/league-table/` verbatim. That is the only way to match the
 * published table for leagues whose ruleset we cannot see: DKB DFFL divides win points by a
 * fixed 30 rather than by games played, and weights wins by the opponent's league, using
 * `LeagueRuleset` fields and per-team point adjustments that no public endpoint exposes.
 * Our own computation still runs on every sync as a cross-check and its differences are
 * recorded — for FF BL it reproduces the published table exactly, all 23 teams.
 */
export type StandingsSource = 'official';

export interface LeagueSeasonConfig {
  /** Our stable key. Appears in URLs and in the `standings` table; do not rename casually. */
  readonly key: string;
  readonly season: string;
  /** Primary keys for `/api/snapshot/`. */
  readonly leaguePk: number;
  readonly seasonPk: number;
  /** The only league identifier a gameday carries. Used to match gamedays to this season. */
  readonly leagueDisplay: string;
  /** Slug for `/api/league-table/<slug>/<season>/`. Often differs from `key`. */
  readonly tableSlug: string;
  /** Shown in the UI. */
  readonly name: string;
  /** Playoff or relegation gamedays that must not count towards the regular-season table. */
  readonly excludeGamedayIds: readonly number[];
  /** Second teams, which cannot be promoted. Greyed out in the table. */
  readonly promotionRestricted: readonly number[];
  readonly standingsSource: StandingsSource;
}

/**
 * Only the league seasons our teams actually play in.
 *
 * The reference widget's config also listed `rl-bayern` and `dffl2` for 2026. Neither has
 * any 2026 gameday for teams 159/287: no gameday upstream carries
 * `league_display == "RL Bayern"` at all, and `DFFL2` appears only in 2023. They are left
 * out rather than shipped as two permanently empty tables; adding a season back is one
 * entry here.
 */
export const LEAGUE_SEASONS: readonly LeagueSeasonConfig[] = [
  {
    key: 'dkb-dffl',
    season: '2026',
    leaguePk: 7,
    seasonPk: 6,
    leagueDisplay: 'DKB DFFL',
    tableSlug: 'dffl',
    name: 'DKB DFFL 2026',
    // 2026-07-23 and 2026-07-24: the playoff gamedays. Upstream excludes them too — with
    // them counted every team shows more games than the published table.
    excludeGamedayIds: [887, 888],
    promotionRestricted: [],
    standingsSource: 'official',
  },
  {
    key: 'ff-bl',
    season: '2026',
    leaguePk: 18,
    seasonPk: 6,
    leagueDisplay: 'FF BL',
    tableSlug: 'ff-bl',
    name: 'FF BL 2026',
    excludeGamedayIds: [],
    // Munich Spatzen 4, Erding Bulls II, Regensburg Phoenix III.
    promotionRestricted: [254, 492, 505],
    standingsSource: 'official',
  },
] as const;

export function findLeagueSeason(key: string, season: string): LeagueSeasonConfig | undefined {
  return LEAGUE_SEASONS.find((entry) => entry.key === key && entry.season === season);
}

/**
 * Matches a gameday to a league season the way the reference did: on `league_display` plus
 * the year in `date`, minus the exclusions. Doing it this way means a gameday published
 * upstream mid-season starts counting on the next sync with no config change.
 */
export function belongsToLeagueSeason(
  config: LeagueSeasonConfig,
  gameday: { readonly id: number; readonly date: string; readonly league_display: string },
): boolean {
  return gameday.league_display === config.leagueDisplay &&
    gameday.date.slice(0, 4) === config.season &&
    !config.excludeGamedayIds.includes(gameday.id);
}

/**
 * Addresses upstream uses to mean "not decided yet". Stored as NULL so the UI can simply
 * omit the line instead of printing a placeholder.
 *
 * Matched on the whole value, lower-cased and trimmed, plus a prefix rule for the "Adresse
 * folgt…" family, which appears both bare and as "Adresse folgt in der Einladung". City-only
 * values like "Königsbrunn" are real addresses and must survive.
 */
const ADDRESS_PLACEHOLDERS: readonly string[] = ['', 'tba', 'tbd', 'n/a', '-', '?'];
const ADDRESS_PLACEHOLDER_PREFIXES: readonly string[] = ['adresse folgt', 'address follows'];

export function normaliseAddress(address: string | null): string | null {
  if (address === null) return null;
  const trimmed = address.trim();
  const lower = trimmed.toLowerCase();
  if (ADDRESS_PLACEHOLDERS.includes(lower)) return null;
  if (ADDRESS_PLACEHOLDER_PREFIXES.some((prefix) => lower.startsWith(prefix))) return null;
  return trimmed;
}
