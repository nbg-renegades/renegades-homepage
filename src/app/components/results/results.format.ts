/**
 * Date and score formatting for the results section.
 *
 * `Intl` directly rather than Angular's `DatePipe`: the app registers no Angular locale data, so
 * `DatePipe` would fall back to English month and weekday names on the German pages. `Intl` is
 * available unchanged on the server and in the browser, so SSR and hydration produce identical
 * text — a mismatch there would make Angular discard the server-rendered markup.
 */

import type { Lang } from '../../i18n/locale';

const LOCALES: Readonly<Record<Lang, string>> = { de: 'de-DE', en: 'en-GB' };

/** Formatters are expensive to build and are reused for every row. */
const cache = new Map<string, Intl.DateTimeFormat>();

function formatter(lang: Lang, options: Intl.DateTimeFormatOptions, key: string): Intl.DateTimeFormat {
  const cacheKey = `${lang}:${key}`;
  let found = cache.get(cacheKey);
  if (found === undefined) {
    found = new Intl.DateTimeFormat(LOCALES[lang], options);
    cache.set(cacheKey, found);
  }
  return found;
}

/**
 * Parses a `YYYY-MM-DD` gameday date.
 *
 * Read as UTC noon, not local midnight. A date-only string parsed as local midnight shifts a day
 * backwards in any negative-offset zone, and noon is far enough from both boundaries that no
 * visitor ever sees the day before.
 */
function parseDate(date: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (match === null) return null;
  const parsed = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** `Sa., 20.06.2026` in German, `Sat, 20/06/2026` in English. */
export function formatGamedayDate(date: string, lang: Lang): string {
  const parsed = parseDate(date);
  if (parsed === null) return date;
  return formatter(lang, {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
  }, 'gameday').format(parsed);
}

/** `20. Juni` — for a heading where the year is already obvious. */
export function formatGamedayDateShort(date: string, lang: Lang): string {
  const parsed = parseDate(date);
  if (parsed === null) return date;
  return formatter(lang, { day: 'numeric', month: 'long', timeZone: 'UTC' }, 'short').format(parsed);
}

/**
 * The "Stand: …" timestamp, from a full ISO instant.
 *
 * Rendered in the club's zone rather than the visitor's, so the time shown matches the time the
 * gameday was actually played in and reads the same on the server as in the browser.
 */
export function formatUpdatedAt(instant: string, lang: Lang): string {
  const parsed = new Date(instant);
  if (Number.isNaN(parsed.getTime())) return instant;
  return formatter(lang, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Berlin',
  }, 'updated').format(parsed);
}

/** A score, or an en dash when the game has not been played. */
export function formatScore(home: number | null, away: number | null): string {
  if (home === null || away === null) return '–';
  return `${home}:${away}`;
}

/**
 * The league quotient, at the three decimals the published tables use.
 *
 * Fixed rather than trimmed, so the column stays aligned: `0.500` and not `0.5`.
 */
export function formatQuotient(quotient: number, lang: Lang): string {
  return new Intl.NumberFormat(LOCALES[lang], {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  }).format(quotient);
}

/** A goal difference, always signed, because that is how a table reads. */
export function formatDiff(diff: number): string {
  return diff > 0 ? `+${diff}` : String(diff);
}

/**
 * Initials for a club with no logo, e.g. "Wolfpack Oberammergau" → "WO".
 *
 * Eight of the clubs our teams meet have no logo, so this is a normal state rather than an edge
 * case, and it has to look deliberate.
 */
export function teamInitials(name: string): string {
  const words = name
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 0 && !/^\d+$/.test(word));
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}
