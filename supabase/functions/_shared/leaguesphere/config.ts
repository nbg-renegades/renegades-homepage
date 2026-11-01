/**
 * What we sync: the two club teams, and how upstream's league names map onto ours.
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
 * Our league key for each upstream league slug in the snapshot's `standings`.
 *
 * Upstream slugs are set by hand and differ from our keys: the 1st team's league is `dffl`
 * upstream, but the frontend reads `dkb-dffl`, so the key must not change. A league whose slug
 * is missing here is not shown. The season is not configured: it comes from the snapshot.
 */
export const LEAGUE_KEY_BY_SLUG: Readonly<Record<string, string>> = {
  dffl: 'dkb-dffl',
  'ff-bl': 'ff-bl',
};

/**
 * Second teams, which cannot be promoted and are greyed out in the table. Upstream does not
 * expose this. Keyed `<league_key>:<season>`; the 2026 FF BL entries are Munich Spatzen 4,
 * Erding Bulls II and Regensburg Phoenix III.
 */
export const PROMOTION_RESTRICTED: Readonly<Record<string, readonly number[]>> = {
  'ff-bl:2026': [254, 492, 505],
};

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
