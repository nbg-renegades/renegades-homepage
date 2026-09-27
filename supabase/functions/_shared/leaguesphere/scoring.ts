/**
 * Event → points, and the running score.
 *
 * The same play reaches us in two different shapes and both are handled here:
 *
 *  - `/api/snapshot/` `include=logs` gives entries grouped by `sequence`, where the event is
 *    a *key* and the scoring player is its value: `{sequence: 8, td: 3, pat1: null}`.
 *  - `/api/liveticker/` gives flat German text: `"Touchdown: #3"`, `"1-Extra-Punkt: -"`.
 *
 * The points table below was not taken from the reference widget. It was derived, then checked
 * against the half-time and full-time scores LeagueSphere reports itself: over the full
 * recording of both teams' games, **1500 half-scores with 0 mismatches**. The reference is
 * missing `Safety (+2)`, which appears 68 times in our own games and breaks 52 of those 1500.
 * `scoring.test.ts` re-runs that check on every build against the committed fixtures, which
 * carry 144 of those halves.
 */

import type { UpstreamLogEntry, UpstreamLogSide, UpstreamTick } from './schema.ts';

export const TOUCHDOWN_POINTS = 6;
export const EXTRA_POINT_1 = 1;
export const EXTRA_POINT_2 = 2;
export const SAFETY_POINTS = 2;

/**
 * Points per snapshot-log event key.
 *
 * A key being *present* means the play was attempted; its value being non-null means it
 * succeeded and names the player. So `{td: 3, pat1: null}` is a touchdown plus a missed
 * 1-point conversion: 6, not 7.
 */
const LOG_EVENT_POINTS: Readonly<Record<string, number>> = {
  td: TOUCHDOWN_POINTS,
  pat1: EXTRA_POINT_1,
  pat2: EXTRA_POINT_2,
  'Safety (+2)': SAFETY_POINTS,
};

/**
 * Points for one grouped log entry.
 *
 * Two rules that are easy to get wrong:
 *  - `isDeleted` entries score nothing at all. A deleted touchdown is how a mis-entered play
 *    is corrected upstream; counting it puts every later running score out by six.
 *  - **Player #0 exists** (`{sequence: 15, td: 0, pat2: null}` is in the recorded data), so
 *    success is `value !== null`, never a truthiness test. `if (entry.pat1)` silently drops
 *    every conversion scored by #0.
 */
export function logEntryPoints(entry: UpstreamLogEntry): number {
  if (entry.isDeleted === true) return 0;
  // A change of possession carries its event in `name`, not as a scoring key.
  if (entry.cop === true) return 0;

  let points = 0;
  for (const [event, player] of Object.entries(entry.players)) {
    if (player === null) continue;
    points += LOG_EVENT_POINTS[event] ?? 0;
  }
  return points;
}

/** True for an entry that only marks a change of possession (`Turnover`, `Interception`). */
export function isMarkerEntry(entry: UpstreamLogEntry): boolean {
  return entry.cop === true;
}

/** Points a side scored in one half, from its log alone. */
export function halfPoints(entries: readonly UpstreamLogEntry[]): number {
  return entries.reduce((sum, entry) => sum + logEntryPoints(entry), 0);
}

/**
 * Checks a side's log against the scores upstream reports for it.
 *
 * This is the integration's smoke alarm. Our points table and upstream's are independent
 * implementations of the same rulebook, so a disagreement means upstream introduced an event
 * we score as 0. The sync records the mismatch rather than failing the whole run — a new
 * event type should cost us one wrong play-by-play line, not the entire results page.
 */
export interface HalfScoreCheck {
  readonly half: 1 | 2;
  readonly reported: number;
  readonly computed: number;
}

export function checkSideScores(side: UpstreamLogSide): readonly HalfScoreCheck[] {
  const checks: HalfScoreCheck[] = [];
  const halves: readonly [1 | 2, { score: number; entries: readonly UpstreamLogEntry[] }][] = [
    [1, side.firsthalf],
    [2, side.secondhalf],
  ];
  for (const [half, data] of halves) {
    const computed = halfPoints(data.entries);
    if (computed !== data.score) {
      checks.push({ half, reported: data.score, computed });
    }
  }
  return checks;
}

// ── Play-by-play ─────────────────────────────────────────────────────────────

export type Side = 'home' | 'away';

/** One row of the play-by-play, with the score as it stood after the play. */
export interface ScoredEvent {
  readonly seq: number;
  readonly half: 1 | 2;
  readonly side: Side;
  readonly text: string;
  readonly points: number;
  readonly scoreHome: number;
  readonly scoreAway: number;
  readonly isDeleted: boolean;
  readonly isMarker: boolean;
}

/** German labels for the play-by-play, matching the wording upstream uses in the liveticker. */
const LOG_EVENT_LABELS: Readonly<Record<string, string>> = {
  td: 'Touchdown',
  pat1: '1-Extra-Punkt',
  pat2: '2-Extra-Punkte',
  OT: 'Overtime',
};

function eventLabel(event: string): string {
  return LOG_EVENT_LABELS[event] ?? event;
}

/**
 * Renders one grouped entry as display text, e.g. `Touchdown: #3, 1-Extra-Punkt: -`.
 *
 * A null player becomes `-`, which is exactly how the liveticker writes a failed attempt, so
 * the snapshot-derived and live-derived play-by-play read identically.
 */
export function logEntryText(entry: UpstreamLogEntry): string {
  if (entry.cop === true) return entry.name ?? 'Ballabgabe';

  const parts: string[] = [];
  // Touchdown first, then the conversion, then anything else, so the line reads in play order
  // rather than in object-key order.
  const order = ['td', 'pat1', 'pat2', 'OT'];
  const keys = Object.keys(entry.players).sort((a, b) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a.localeCompare(b);
  });
  for (const key of keys) {
    const player = entry.players[key];
    parts.push(`${eventLabel(key)}: ${player === null ? '-' : `#${player}`}`);
  }
  return parts.join(', ');
}

/**
 * Builds the play-by-play for a finished or running game from the snapshot log.
 *
 * Upstream serialises entries newest-first within each half; the running score only makes
 * sense oldest-first, so both halves are reversed and the first half is emitted before the
 * second. Deleted entries are kept as rows (the UI strikes them through) but contribute no
 * points, so the score column stays consistent with the official result.
 */
export function buildPlayByPlay(
  home: UpstreamLogSide,
  away: UpstreamLogSide,
): readonly ScoredEvent[] {
  interface Pending {
    readonly side: Side;
    readonly half: 1 | 2;
    readonly entry: UpstreamLogEntry;
  }

  const pending: Pending[] = [];
  const sides: readonly [Side, UpstreamLogSide][] = [['home', home], ['away', away]];
  for (const [side, data] of sides) {
    for (const entry of [...data.firsthalf.entries].reverse()) {
      pending.push({ side, half: 1, entry });
    }
    for (const entry of [...data.secondhalf.entries].reverse()) {
      pending.push({ side, half: 2, entry });
    }
  }

  // `sequence` is shared across both sides of a game, so it orders the two logs into one
  // stream. Halves are ordered first because sequences restart per game, not per half.
  pending.sort((a, b) => (a.half - b.half) || (a.entry.sequence - b.entry.sequence));

  const events: ScoredEvent[] = [];
  let scoreHome = 0;
  let scoreAway = 0;
  for (const { side, half, entry } of pending) {
    const points = logEntryPoints(entry);
    if (side === 'home') scoreHome += points;
    else scoreAway += points;
    events.push({
      seq: entry.sequence,
      half,
      side,
      text: logEntryText(entry),
      points,
      scoreHome,
      scoreAway,
      isDeleted: entry.isDeleted === true,
      isMarker: entry.cop === true,
    });
  }
  return events;
}

// ── Liveticker ───────────────────────────────────────────────────────────────

/**
 * Points for one liveticker tick.
 *
 * The text form encodes a failed attempt as a trailing `: -`, which upstream produces when an
 * Extra-Punkt event has no player. Anything unrecognised scores 0 — clock updates, time-outs,
 * penalties and possession changes all arrive on this channel too.
 */
export function tickPoints(text: string): number {
  if (text.startsWith('Touchdown')) return TOUCHDOWN_POINTS;
  if (text.startsWith('2-Extra-Punkte')) return failedAttempt(text) ? 0 : EXTRA_POINT_2;
  if (text.startsWith('1-Extra-Punkt')) return failedAttempt(text) ? 0 : EXTRA_POINT_1;
  if (text.startsWith('Safety')) return SAFETY_POINTS;
  return 0;
}

function failedAttempt(text: string): boolean {
  return /:\s*-\s*$/.test(text);
}

/** The tick that ends a game. Upstream sends it with `team: null`. */
export const GAME_FINISHED_TICK = 'Spiel beendet';

export function isGameFinishedTick(tick: UpstreamTick): boolean {
  return tick.text.trim() === GAME_FINISHED_TICK;
}

/** Ticks that mark a phase boundary rather than a play. */
const MARKER_PREFIXES: readonly string[] = [
  'Spiel gestartet',
  'Spiel beendet',
  'Halbzeit',
  '1. Halbzeit',
  '2. Halbzeit',
  'Overtime',
];

export function isMarkerTick(tick: UpstreamTick): boolean {
  return tick.team === null || MARKER_PREFIXES.some((prefix) => tick.text.startsWith(prefix));
}

/**
 * De-duplicates ticks by `text|time`.
 *
 * Two independent reasons this is needed. The liveticker is cached for 60 s upstream and we
 * poll every minute, so the same tick is delivered repeatedly; and the default response
 * carries only the 5 newest ticks, so consecutive polls overlap heavily. `time` is a full UTC
 * instant rather than a clock reading, so `text|time` is unique per play even when the same
 * event happens twice in a game.
 */
export function tickKey(tick: UpstreamTick): string {
  return `${tick.text}|${tick.time}`;
}

export function dedupeTicks(ticks: readonly UpstreamTick[]): readonly UpstreamTick[] {
  const seen = new Set<string>();
  const unique: UpstreamTick[] = [];
  for (const tick of ticks) {
    const key = tickKey(tick);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(tick);
  }
  return unique;
}

/**
 * Turns a live game's ticks into play-by-play rows with a running score.
 *
 * Upstream orders ticks newest-first. A running score can only be accumulated oldest-first,
 * and it is only meaningful when we hold the whole history — with the default 5-tick response
 * the first tick we see is mid-game, so the totals would start from zero and be wrong.
 * `hasFullHistory` (set when the request used `getAllTicksFor`) decides whether the score
 * column is populated at all; the stored game score is shown instead when it is not.
 */
export interface LiveEvent {
  readonly seq: number;
  readonly side: Side | null;
  readonly text: string;
  readonly time: string;
  readonly points: number;
  readonly scoreHome: number | null;
  readonly scoreAway: number | null;
  readonly isMarker: boolean;
}

export function buildLiveEvents(
  ticks: readonly UpstreamTick[],
  options: { readonly hasFullHistory: boolean },
): readonly LiveEvent[] {
  const oldestFirst = [...dedupeTicks(ticks)].reverse();
  const events: LiveEvent[] = [];
  let scoreHome = 0;
  let scoreAway = 0;

  for (const [index, tick] of oldestFirst.entries()) {
    const points = tickPoints(tick.text);
    // A marker tick has no team, so it can never move the score even if its text matched.
    const scoring = tick.team !== null ? points : 0;
    if (tick.team === 'home') scoreHome += scoring;
    else if (tick.team === 'away') scoreAway += scoring;

    events.push({
      seq: index + 1,
      side: tick.team,
      text: tick.text,
      time: tick.time,
      points: scoring,
      scoreHome: options.hasFullHistory ? scoreHome : null,
      scoreAway: options.hasFullHistory ? scoreAway : null,
      isMarker: isMarkerTick(tick),
    });
  }
  return events;
}

/** Score derived from a full tick history, for cross-checking the score upstream reports. */
export function deriveLiveScore(
  ticks: readonly UpstreamTick[],
): { readonly home: number; readonly away: number } {
  let home = 0;
  let away = 0;
  for (const tick of dedupeTicks(ticks)) {
    if (tick.team === null) continue;
    const points = tickPoints(tick.text);
    if (tick.team === 'home') home += points;
    else away += points;
  }
  return { home, away };
}
