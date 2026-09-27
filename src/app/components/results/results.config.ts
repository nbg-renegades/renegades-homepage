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

/**
 * Which tabs render from our own database instead of the embedded widget.
 *
 * The switch is per tab so the native schedule and table can go live while the live ticker is
 * still being built, and so either can be turned back off on its own if a real gameday shows up
 * something the fixtures did not. Both of these go away with the iframe in the final cutover.
 */
export const NATIVE_TABS: Readonly<Record<Tab, boolean>> = {
  spielplan: true,
  tabelle: true,
  live: false,
};

/**
 * Overrides the flag from the URL, for checking either version against the other on the real
 * site: `?native=spielplan,tabelle`, `?native=all` or `?native=none`.
 *
 * Read-only and cosmetic — it decides which of two renderings of the same data a visitor sees
 * and nothing else, so it needs no guarding beyond being ignored when it is not recognised.
 */
export function isNative(tab: Tab, override: string | null | undefined): boolean {
  if (override === null || override === undefined || override === '') return NATIVE_TABS[tab];
  if (override === 'all') return true;
  if (override === 'none') return false;
  return override.split(',').map((part) => part.trim()).includes(tab);
}

/** How many past gamedays are shown before the rest collapse behind "show more". */
export const PAST_GAMEDAYS_VISIBLE = 3;

/** Logos live outside `assets/images`, which is the pipeline for 640w+ photographs. */
export const LOGO_BASE_PATH = '/assets/logos';
