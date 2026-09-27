/**
 * Club-local time.
 *
 * LeagueSphere sends dates and times with no zone: a gameday is `2026-06-20` and a kickoff is
 * `10:00:00`, both meaning German wall-clock time. Supabase Edge Functions run in UTC. Reading
 * those naive values as UTC is wrong by one or two hours depending on the season, which is
 * enough to matter twice:
 *
 *  - **"Today"**. Between midnight and 02:00 German time the UTC date is still yesterday, so a
 *    UTC-derived "today" would look at the previous gameday — and a gameday that has just
 *    finished would reappear as upcoming.
 *  - **The pre-kickoff window.** A 10:00 kickoff is 08:00Z in summer. Treating it as 10:00Z
 *    puts it two hours later than it is, which is exactly the length of the window that is
 *    supposed to open before it, so the faster gameday cadence would never start early.
 *
 * Everything here works off `Intl`, which Deno backs with the full IANA database, so DST is
 * handled by definition rather than by an offset constant that goes stale every March.
 */

/** Both our teams play in Germany, so one zone covers every fixture. */
export const CLUB_TIME_ZONE = 'Europe/Berlin';

const PARTS_FORMAT = new Intl.DateTimeFormat('en-US', {
  timeZone: CLUB_TIME_ZONE,
  hour12: false,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

interface Parts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

function clubParts(instant: Date): Parts {
  const parts: Record<string, string> = {};
  for (const part of PARTS_FORMAT.formatToParts(instant)) {
    if (part.type !== 'literal') parts[part.type] = part.value;
  }
  return {
    year: Number(parts['year']),
    month: Number(parts['month']),
    day: Number(parts['day']),
    // `hour12: false` still renders midnight as 24 in some ICU versions.
    hour: Number(parts['hour']) % 24,
    minute: Number(parts['minute']),
    second: Number(parts['second']),
  };
}

/** The club-local date of an instant, as `YYYY-MM-DD` — the form every gameday date uses. */
export function clubToday(now: Date): string {
  const { year, month, day } = clubParts(now);
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** The club-local wall clock of an instant, as `HH:MM`. */
export function clubClock(now: Date): string {
  const { hour, minute } = clubParts(now);
  return `${pad(hour)}:${pad(minute)}`;
}

/** How far club time is ahead of UTC at a given instant, in milliseconds. */
function clubOffsetMs(instant: Date): number {
  const { year, month, day, hour, minute, second } = clubParts(instant);
  const asIfUtc = Date.UTC(year, month - 1, day, hour, minute, second, instant.getUTCMilliseconds());
  return asIfUtc - instant.getTime();
}

/**
 * The UTC instant of a naive club-local date and time.
 *
 * The offset depends on the instant, and the instant is what we are solving for, so this
 * converges on it: assume the naive value is UTC, look up the offset there, correct, then check
 * whether the corrected instant falls under a different offset. The second pass only changes
 * anything within an hour or two of a DST boundary, which is exactly when it matters.
 *
 * Returns null for an unparseable time rather than an invalid Date, so a caller cannot
 * accidentally compare against NaN — every comparison with NaN is false, which would look like
 * "not in the gameday window" and silently disable the live cadence.
 */
export function clubInstant(date: string, time: string | null): Date | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (dateMatch === null) return null;

  const [year, month, day] = dateMatch.slice(1).map(Number);

  let hour = 0;
  let minute = 0;
  let second = 0;
  if (time !== null && time !== '') {
    const timeMatch = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(time.trim());
    if (timeMatch === null) return null;
    hour = Number(timeMatch[1]);
    minute = Number(timeMatch[2]);
    second = Number(timeMatch[3] ?? '0');
    if (hour > 23 || minute > 59 || second > 59) return null;
  }

  const naiveUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  let instant = new Date(naiveUtc - clubOffsetMs(new Date(naiveUtc)));
  // One correction pass for the DST boundaries, where the first guess lands under the old offset.
  instant = new Date(naiveUtc - clubOffsetMs(instant));
  return instant;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
