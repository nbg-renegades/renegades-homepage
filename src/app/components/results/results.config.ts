/**
 * What the results section shows, and which parts of it are native yet.
 *
 * Kept separate from the sync function's own config on purpose: that one lives in
 * `supabase/functions/_shared/leaguesphere/config.ts` and speaks LeagueSphere's language
 * (primary keys, table slugs, `league_display` strings). Nothing in the browser needs any of
 * that — the site reads our own tables, so all it needs is which league table belongs to which
 * team.
 */

/** The two teams, as they appear in the URL. */
export type TeamSlug = '1-mannschaft' | '2-mannschaft';

export type Tab = 'spielplan' | 'tabelle' | 'live';

export const TABS: readonly Tab[] = ['spielplan', 'tabelle', 'live'];

export interface TeamConfig {
  readonly slug: TeamSlug;
  /** LeagueSphere's team id, which is what our tables are keyed on. */
  readonly teamId: number;
  /** The league season whose table this team appears in. */
  readonly leagueKey: string;
  readonly season: string;
}

export const TEAMS: readonly TeamConfig[] = [
  { slug: '1-mannschaft', teamId: 159, leagueKey: 'dkb-dffl', season: '2026' },
  { slug: '2-mannschaft', teamId: 287, leagueKey: 'ff-bl', season: '2026' },
];

export function teamBySlug(slug: string | null | undefined): TeamConfig {
  return TEAMS.find((team) => team.slug === slug) ?? TEAMS[0];
}

export function tabFromParam(param: string | null | undefined): Tab {
  return TABS.includes(param as Tab) ? param as Tab : 'spielplan';
}

/** How many past gamedays are shown before the rest collapse behind "show more". */
export const PAST_GAMEDAYS_VISIBLE = 3;

/** Logos live outside `assets/images`, which is the pipeline for 640w+ photographs. */
export const LOGO_BASE_PATH = '/assets/logos';
