import {
  assert,
  assertEquals,
  assertNotEquals,
} from 'https://deno.land/std@0.224.0/assert/mod.ts';

import { parseLiveticker, parseSnapshot, type UpstreamLogEntry } from './schema.ts';
import {
  buildLiveEvents,
  buildPlayByPlay,
  checkSideScores,
  dedupeTicks,
  deriveLiveScore,
  isGameFinishedTick,
  logEntryPoints,
  logEntryText,
  tickPoints,
} from './scoring.ts';
import { loadFixture } from './__fixtures__/load.ts';

function entry(partial: Partial<UpstreamLogEntry> & { sequence: number }): UpstreamLogEntry {
  return { players: {}, ...partial };
}

// ── The oracle ───────────────────────────────────────────────────────────────

/**
 * Our points table and LeagueSphere's are independent implementations of the same rulebook,
 * so every half score upstream reports is a free assertion about ours. This is the test that
 * found `Safety (+2)`.
 *
 * The committed fixtures yield 144 halves: only `snapshot.teams-159-287.json` carries logs,
 * the two league-scoped ones were recorded with `include=games` because standings need no
 * play-by-play. The same check over the full untrimmed recording covered 1500 halves and
 * also matched completely; 52 of those 1500 fail without the `Safety (+2)` rule.
 */
Deno.test('every recorded half score is reproduced from its log', async () => {
  const fixtures = [
    'snapshot.teams-159-287.json',
    'snapshot.league-ffbl-2026.json',
    'snapshot.league-dffl-2026.json',
  ];

  let checked = 0;
  const failures: string[] = [];

  for (const name of fixtures) {
    const parsed = parseSnapshot(await loadFixture(name));
    assert(parsed.ok, `${name} must parse: ${parsed.ok ? '' : parsed.errors.join('; ')}`);

    for (const gameday of parsed.value.gamedays) {
      for (const game of gameday.games) {
        if (game.log === null) continue;
        for (const side of [game.log.home, game.log.away]) {
          for (const mismatch of checkSideScores(side)) {
            failures.push(
              `${name} gameday=${gameday.id} game=${game.id} half=${mismatch.half} ` +
                `reported=${mismatch.reported} computed=${mismatch.computed}`,
            );
          }
          checked += 2;
        }
      }
    }
  }

  assertEquals(failures, [], `half-score mismatches:\n${failures.join('\n')}`);
  // Guards against the fixtures being emptied or the loop silently skipping everything.
  assertEquals(checked, 144, 'the committed fixtures should yield 144 halves');
});

// ── Points per log entry ─────────────────────────────────────────────────────

Deno.test('a touchdown is six points', () => {
  assertEquals(logEntryPoints(entry({ sequence: 1, players: { td: 12 } })), 6);
});

Deno.test('a successful 1-point conversion adds one, a failed one adds nothing', () => {
  assertEquals(logEntryPoints(entry({ sequence: 1, players: { td: 3, pat1: 8 } })), 7);
  assertEquals(logEntryPoints(entry({ sequence: 1, players: { td: 3, pat1: null } })), 6);
});

Deno.test('a successful 2-point conversion adds two, a failed one adds nothing', () => {
  assertEquals(logEntryPoints(entry({ sequence: 1, players: { td: 3, pat2: 19 } })), 8);
  assertEquals(logEntryPoints(entry({ sequence: 1, players: { td: 3, pat2: null } })), 6);
});

Deno.test('Safety (+2) is two points — the reference misses it entirely', () => {
  assertEquals(logEntryPoints(entry({ sequence: 6, players: { 'Safety (+2)': 24 } })), 2);
});

Deno.test('player #0 scores like any other player', () => {
  // `{"sequence": 15, "td": 0, "pat2": null}` is in the recorded data. A truthiness check on
  // the player number would score this 0 and put every later running score out by six.
  assertEquals(logEntryPoints(entry({ sequence: 15, players: { td: 0, pat2: null } })), 6);
  assertEquals(logEntryPoints(entry({ sequence: 15, players: { td: 0, pat1: 0 } })), 7);
});

Deno.test('a deleted entry scores nothing, however much it contains', () => {
  assertEquals(
    logEntryPoints(entry({ sequence: 12, isDeleted: true, players: { td: 8, pat1: 3 } })),
    0,
  );
});

Deno.test('a change of possession scores nothing', () => {
  assertEquals(logEntryPoints(entry({ sequence: 1, cop: true, name: 'Interception' })), 0);
  assertEquals(logEntryPoints(entry({ sequence: 1, cop: true, name: 'Turnover' })), 0);
});

Deno.test('an unknown event scores nothing rather than throwing', () => {
  assertEquals(logEntryPoints(entry({ sequence: 1, players: { 'Rouge (+1)': 4 } })), 0);
});

// ── Play-by-play text ────────────────────────────────────────────────────────

Deno.test('a failed attempt reads the same as the liveticker writes it', () => {
  assertEquals(
    logEntryText(entry({ sequence: 8, players: { td: 3, pat1: null } })),
    'Touchdown: #3, 1-Extra-Punkt: -',
  );
});

Deno.test('a possession change is labelled by its own name', () => {
  assertEquals(logEntryText(entry({ sequence: 1, cop: true, name: 'Interception' })), 'Interception');
});

// ── Running score ───────────────────────────────────────────────────────────

Deno.test('the running score follows a real game to its official result', async () => {
  const parsed = parseSnapshot(await loadFixture('snapshot.teams-159-287.json'));
  assert(parsed.ok);

  // Gameday 645, game 7374: LLions 52 : 32 Nürnberg, with two failed 1-point tries, two
  // failed 2-point tries and one deleted touchdown among the entries.
  const gameday = parsed.value.gamedays.find((g) => g.id === 645);
  assert(gameday !== undefined);
  const game = gameday.games.find((g) => g.id === 7374);
  assert(game !== undefined && game.log !== null);

  const events = buildPlayByPlay(game.log.home, game.log.away);
  const last = events.at(-1);
  assert(last !== undefined);
  assertEquals(last.scoreHome, 52);
  assertEquals(last.scoreAway, 32);

  // The deleted entry appears as a row but never moves the score.
  const deleted = events.filter((e) => e.isDeleted);
  assertEquals(deleted.length, 1);
  assertEquals(deleted[0].points, 0);
});

Deno.test('the play-by-play runs oldest first, first half before second', async () => {
  const parsed = parseSnapshot(await loadFixture('snapshot.teams-159-287.json'));
  assert(parsed.ok);
  const game = parsed.value.gamedays
    .find((g) => g.id === 645)?.games.find((g) => g.id === 7374);
  assert(game?.log != null);

  const events = buildPlayByPlay(game.log.home, game.log.away);
  const halves = events.map((e) => e.half);
  assertEquals(halves, [...halves].sort((a, b) => a - b), 'halves must not interleave');

  for (const half of [1, 2] as const) {
    const seqs = events.filter((e) => e.half === half).map((e) => e.seq);
    assertEquals(seqs, [...seqs].sort((a, b) => a - b), `half ${half} must ascend by sequence`);
  }

  // The score never decreases.
  let previous = 0;
  for (const event of events) {
    const total = event.scoreHome + event.scoreAway;
    assert(total >= previous, 'running total must be monotonic');
    previous = total;
  }
});

// ── Liveticker ───────────────────────────────────────────────────────────────

Deno.test('tick text maps to points, including failed attempts', () => {
  assertEquals(tickPoints('Touchdown: #75'), 6);
  assertEquals(tickPoints('Touchdown'), 6);
  assertEquals(tickPoints('1-Extra-Punkt: #92'), 1);
  assertEquals(tickPoints('1-Extra-Punkt: -'), 0);
  assertEquals(tickPoints('2-Extra-Punkte: #19'), 2);
  assertEquals(tickPoints('2-Extra-Punkte: -'), 0);
  assertEquals(tickPoints('Ballabgabe'), 0);
  assertEquals(tickPoints('Auszeit - 2:24'), 0);
  assertEquals(tickPoints('Spielzeit - 10:00'), 0);
  assertEquals(tickPoints('Spiel beendet'), 0);
  assertEquals(tickPoints('Halbzeit'), 0);
});

Deno.test('ticks are de-duplicated by text and time together', () => {
  const ticks = [
    { text: 'Touchdown: #7', team: 'home' as const, time: '2026-09-27T11:40:10.009392+00:00' },
    { text: 'Touchdown: #7', team: 'home' as const, time: '2026-09-27T11:40:10.009392+00:00' },
    // Same play text, different instant: a second touchdown by the same player, kept.
    { text: 'Touchdown: #7', team: 'home' as const, time: '2026-09-27T11:52:03.000000+00:00' },
  ];
  const unique = dedupeTicks(ticks);
  assertEquals(unique.length, 2);
  assertNotEquals(unique[0].time, unique[1].time);
});

Deno.test('overlapping polls of the 5-tick window collapse to one history', async () => {
  const games = parseLiveticker(await loadFixture('liveticker.default-5-ticks.json'));
  assert(games.ok);
  const ticks = games.value[0].ticks;

  // Two consecutive polls that share four of five ticks.
  const merged = dedupeTicks([...ticks, ...ticks.slice(1)]);
  assertEquals(merged.length, ticks.length);
});

Deno.test('"Spiel beendet" is detected as the finishing tick', async () => {
  const games = parseLiveticker(await loadFixture('liveticker.default-5-ticks.json'));
  assert(games.ok);

  for (const game of games.value) {
    const finished = game.ticks.filter(isGameFinishedTick);
    assertEquals(finished.length, 1, `game ${game.gameId} should carry one finishing tick`);
    assertEquals(finished[0].team, null, 'the finishing tick belongs to neither side');
  }
});

Deno.test('a full tick history reproduces the score upstream reports', async () => {
  const games = parseLiveticker(await loadFixture('liveticker.get-all-ticks-for.json'));
  assert(games.ok);

  for (const game of games.value) {
    const derived = deriveLiveScore(game.ticks);
    assertEquals(
      derived,
      { home: game.home.score, away: game.away.score },
      `game ${game.gameId}: derived score must match the reported score`,
    );
  }
});

Deno.test('the running score is withheld unless the whole history was requested', async () => {
  const games = parseLiveticker(await loadFixture('liveticker.default-5-ticks.json'));
  assert(games.ok);
  const ticks = games.value[0].ticks;

  const partial = buildLiveEvents(ticks, { hasFullHistory: false });
  assert(partial.every((e) => e.scoreHome === null && e.scoreAway === null));

  const full = buildLiveEvents(ticks, { hasFullHistory: true });
  assert(full.every((e) => e.scoreHome !== null && e.scoreAway !== null));
});

Deno.test('live events run oldest first', async () => {
  const games = parseLiveticker(await loadFixture('liveticker.get-all-ticks-for.json'));
  assert(games.ok);
  const events = buildLiveEvents(games.value[0].ticks, { hasFullHistory: true });

  assertEquals(events[0].text, 'Spiel gestartet');
  assertEquals(events.at(-1)?.text, 'Spiel beendet');

  const times = events.map((e) => Date.parse(e.time));
  assertEquals(times, [...times].sort((a, b) => a - b));
});

Deno.test('a marker tick never moves the score', () => {
  const events = buildLiveEvents(
    [
      { text: 'Spiel beendet', team: null, time: '2026-09-27T11:42:48.715832+00:00' },
      { text: 'Touchdown: #75', team: 'home', time: '2026-09-27T11:40:10.009392+00:00' },
    ],
    { hasFullHistory: true },
  );

  assertEquals(events[0].text, 'Touchdown: #75');
  assertEquals(events[0].scoreHome, 6);
  assertEquals(events[1].text, 'Spiel beendet');
  assertEquals(events[1].points, 0);
  assertEquals(events[1].scoreHome, 6);
  assert(events[1].isMarker);
});
