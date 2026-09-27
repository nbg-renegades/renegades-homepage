import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';

import { clubClock, clubInstant, clubToday } from './time.ts';

// ── Which day is it ──────────────────────────────────────────────────────────

Deno.test('the club date is the German date, not the UTC one', () => {
  // 22:30Z on 19 June is already 00:30 on 20 June in Germany (CEST, UTC+2). Deriving "today"
  // from UTC here would look at the wrong gameday for two hours every night.
  assertEquals(clubToday(new Date('2026-06-19T22:30:00Z')), '2026-06-20');
  assertEquals(clubClock(new Date('2026-06-19T22:30:00Z')), '00:30');

  // And in winter (CET, UTC+1) the boundary is 23:00Z.
  assertEquals(clubToday(new Date('2026-01-19T23:30:00Z')), '2026-01-20');
  assertEquals(clubToday(new Date('2026-01-19T22:30:00Z')), '2026-01-19');
});

Deno.test('midnight club time reads as 00:00, never 24:00', () => {
  assertEquals(clubClock(new Date('2026-06-19T22:00:00Z')), '00:00');
  assertEquals(clubToday(new Date('2026-06-19T22:00:00Z')), '2026-06-20');
});

// ── Kickoff times ────────────────────────────────────────────────────────────

Deno.test('a summer kickoff is two hours ahead of UTC', () => {
  // CEST: 10:00 in Nürnberg is 08:00Z.
  assertEquals(clubInstant('2026-06-20', '10:00:00')?.toISOString(), '2026-06-20T08:00:00.000Z');
  assertEquals(clubInstant('2026-06-20', '11:10:00')?.toISOString(), '2026-06-20T09:10:00.000Z');
});

Deno.test('a winter kickoff is one hour ahead of UTC', () => {
  // CET: 10:00 is 09:00Z.
  assertEquals(clubInstant('2026-01-20', '10:00:00')?.toISOString(), '2026-01-20T09:00:00.000Z');
});

Deno.test('seconds are optional and a missing time means midnight', () => {
  assertEquals(clubInstant('2026-06-20', '10:00')?.toISOString(), '2026-06-20T08:00:00.000Z');
  assertEquals(clubInstant('2026-06-20', null)?.toISOString(), '2026-06-19T22:00:00.000Z');
  assertEquals(clubInstant('2026-06-20', '')?.toISOString(), '2026-06-19T22:00:00.000Z');
});

// ── Daylight saving ──────────────────────────────────────────────────────────

/**
 * Germany springs forward at 02:00 on the last Sunday in March 2026 (29 March) and falls back
 * on the last Sunday in October (25 October). These are the days a fixed offset gets wrong, and
 * the reason the offset is looked up per instant.
 */
Deno.test('the spring-forward day is handled on both sides of the change', () => {
  // 01:30 is still CET (UTC+1) → 00:30Z.
  assertEquals(clubInstant('2026-03-29', '01:30:00')?.toISOString(), '2026-03-29T00:30:00.000Z');
  // 10:00 is already CEST (UTC+2) → 08:00Z, a kickoff time on a real gameday.
  assertEquals(clubInstant('2026-03-29', '10:00:00')?.toISOString(), '2026-03-29T08:00:00.000Z');
});

Deno.test('the autumn fall-back day is handled on both sides of the change', () => {
  // 01:30 occurs twice; either reading is a valid instant, and both must be that morning.
  const ambiguous = clubInstant('2026-10-25', '01:30:00');
  assert(ambiguous !== null);
  assert(
    ambiguous.toISOString() === '2026-10-24T23:30:00.000Z' ||
      ambiguous.toISOString() === '2026-10-25T00:30:00.000Z',
    `unexpected instant for an ambiguous local time: ${ambiguous.toISOString()}`,
  );

  // 10:00 is unambiguously CET (UTC+1) → 09:00Z.
  assertEquals(clubInstant('2026-10-25', '10:00:00')?.toISOString(), '2026-10-25T09:00:00.000Z');
});

Deno.test('a time that does not exist on the spring-forward day still yields an instant', () => {
  // 02:30 is skipped entirely in 2026. It must not produce NaN: every comparison against NaN
  // is false, which would read as "not in the gameday window" and silently disable the live
  // cadence for a whole day.
  const skipped = clubInstant('2026-03-29', '02:30:00');
  assert(skipped !== null);
  assert(!Number.isNaN(skipped.getTime()));
});

// ── Round trips and rejection ────────────────────────────────────────────────

Deno.test('a club instant round-trips back to the date and clock it came from', () => {
  for (const [date, time] of [
    ['2026-06-20', '10:00'],
    ['2026-01-20', '14:45'],
    ['2026-03-29', '10:00'],
    ['2026-10-25', '10:00'],
    ['2026-12-31', '23:59'],
  ] as const) {
    const instant = clubInstant(date, time);
    assert(instant !== null, `${date} ${time} should parse`);
    assertEquals(clubToday(instant), date, `${date} ${time} round-trip date`);
    assertEquals(clubClock(instant), time, `${date} ${time} round-trip clock`);
  }
});

Deno.test('malformed input is rejected as null rather than an invalid date', () => {
  assertEquals(clubInstant('20.06.2026', '10:00'), null);
  assertEquals(clubInstant('2026-6-20', '10:00'), null);
  assertEquals(clubInstant('', '10:00'), null);
  assertEquals(clubInstant('2026-06-20', 'kickoff'), null);
  assertEquals(clubInstant('2026-06-20', '25:00'), null);
  assertEquals(clubInstant('2026-06-20', '10:75'), null);
});
