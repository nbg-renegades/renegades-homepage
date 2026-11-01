import { assert, assertEquals, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts';

import {
  carriedSnapshotBudget,
  DEFAULT_RETRY_AFTER_MS,
  LeagueSphereClient,
  MAX_RETRY_AFTER_MS,
  NARROW_SNAPSHOT_CAP_PER_HOUR,
  parseRetryAfter,
  persistedBackoffUntil,
  quoteEtag,
  STANDINGS_SNAPSHOT_CAP_PER_HOUR,
  throttledError,
  unquoteEtag,
  UPSTREAM_SNAPSHOT_LIMIT_PER_HOUR,
  UPSTREAM_SNAPSHOT_REBUILD_LIMIT_PER_HOUR,
} from './client.ts';

/** A fetch stand-in that records what it was asked for and replays canned responses. */
function stubFetch(responses: readonly Response[]) {
  const calls: { url: string; headers: Headers }[] = [];
  let index = 0;
  const impl = ((input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(input),
      headers: new Headers(init?.headers ?? {}),
    });
    const response = responses[Math.min(index, responses.length - 1)];
    index += 1;
    // A Response body can only be read once, and a canned response is replayed for every
    // call that runs past the end of the list, so hand out a copy and keep the original.
    return Promise.resolve(response.clone());
  }) as typeof fetch;
  return { impl, calls };
}

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

function clientWith(responses: readonly Response[], overrides: Record<string, unknown> = {}) {
  const { impl, calls } = stubFetch(responses);
  let now = 1_700_000_000_000;
  const client = new LeagueSphereClient({
    fetchImpl: impl,
    now: () => now,
    log: () => {},
    ...overrides,
  });
  return { client, calls, advance: (ms: number) => { now += ms; }, nowRef: () => now };
}

// ── Request shape ────────────────────────────────────────────────────────────

Deno.test('the snapshot request omits status entirely unless asked', async () => {
  const { client, calls } = clientWith([json({ gamedays: [] })]);
  await client.snapshot({ teamIds: [159, 287], include: ['games', 'logs'] });

  const url = new URL(calls[0].url);
  assertEquals(url.pathname, '/api/snapshot/');
  assertEquals(url.searchParams.getAll('team'), ['159', '287']);
  assertEquals(url.searchParams.get('include'), 'games,logs');
  // Omitting `status` is the only way to receive gamedays whose status is "".
  assertEquals(url.searchParams.has('status'), false);
});

Deno.test('every snapshot part can be requested, always in the same order', async () => {
  const { client, calls } = clientWith([json({ gamedays: [] })]);
  await client.snapshot({
    teamIds: [159],
    include: ['live', 'standings', 'teams', 'logs', 'games'],
  });
  await client.snapshot({ teamIds: [159], include: ['games'] });

  assertEquals(
    new URL(calls[0].url).searchParams.get('include'),
    'games,logs,teams,standings,live',
  );
  assertEquals(new URL(calls[1].url).searchParams.get('include'), 'games');
});

Deno.test('year, date_from and date_to are sent as given', async () => {
  const { client, calls } = clientWith([json({ gamedays: [] })]);
  await client.snapshot({
    teamIds: [159],
    year: 2026,
    dateFrom: '2023-01-01',
    dateTo: '2023-12-31',
    include: ['games'],
  });
  await client.snapshot({ teamIds: [159], include: ['games'] });

  const sent = new URL(calls[0].url).searchParams;
  assertEquals(sent.get('year'), '2026');
  assertEquals(sent.get('date_from'), '2023-01-01');
  assertEquals(sent.get('date_to'), '2023-12-31');

  const absent = new URL(calls[1].url).searchParams;
  assertEquals(absent.has('year'), false);
  assertEquals(absent.has('date_from'), false);
  assertEquals(absent.has('date_to'), false);
});

Deno.test('the two-call draft strategy sends exactly one status=DRAFT', async () => {
  const { client, calls } = clientWith([json({ gamedays: [] })]);

  await client.snapshot({ teamIds: [159, 287], include: ['games'] });
  await client.snapshot({ teamIds: [159, 287], statuses: ['DRAFT'], include: ['games'] });

  assertEquals(new URL(calls[0].url).searchParams.has('status'), false);
  assertEquals(new URL(calls[1].url).searchParams.getAll('status'), ['DRAFT']);
});

Deno.test('league and season are sent as primary keys', async () => {
  const { client, calls } = clientWith([json({ gamedays: [] })]);
  await client.snapshot({ leaguePk: 18, seasonPk: 6, include: ['games'] });

  const params = new URL(calls[0].url).searchParams;
  assertEquals(params.get('league'), '18');
  // A year here is a 400 upstream: season 2026 is primary key 6.
  assertEquals(params.get('season'), '6');
});

Deno.test('the liveticker asks for full history only when game ids are given', async () => {
  const { client, calls } = clientWith([json([])]);

  await client.liveticker();
  assertEquals(new URL(calls[0].url).searchParams.has('getAllTicksFor'), false);

  await client.liveticker({ allTicksForGameIds: [9149, 9150] });
  assertEquals(new URL(calls[1].url).searchParams.get('getAllTicksFor'), '9149,9150');
});

Deno.test('the league table uses the slug, which differs from our config key', async () => {
  const { client, calls } = clientWith([json({ standing: [] })]);
  await client.leagueTable('dffl', '2026');
  assertEquals(new URL(calls[0].url).pathname, '/api/league-table/dffl/2026/');
});

// ── Conditional requests ─────────────────────────────────────────────────────

Deno.test('a stored ETag is sent back quoted', async () => {
  const { client, calls } = clientWith([json({ gamedays: [] })]);
  // Snapshot bodies carry the ETag unquoted; the header form needs the quotes.
  await client.snapshot({
    teamIds: [159],
    include: ['games'],
    etag: '3066857c232b9f85c81f4f3fa5701d27',
  });
  assertEquals(calls[0].headers.get('if-none-match'), '"3066857c232b9f85c81f4f3fa5701d27"');
});

Deno.test('an already-quoted ETag is not double-quoted', () => {
  assertEquals(quoteEtag('"abc"'), '"abc"');
  assertEquals(quoteEtag('abc'), '"abc"');
  assertEquals(quoteEtag('W/"abc"'), 'W/"abc"');
  assertEquals(unquoteEtag('"abc"'), 'abc');
  assertEquals(unquoteEtag('W/"abc"'), 'abc');
  assertEquals(unquoteEtag(null), null);
});

Deno.test('no If-None-Match is sent on a first call', async () => {
  const { client, calls } = clientWith([json({ gamedays: [] })]);
  await client.snapshot({ teamIds: [159], include: ['games'] });
  assertEquals(calls[0].headers.has('if-none-match'), false);

  await client.snapshot({ teamIds: [159], include: ['games'], etag: '' });
  assertEquals(calls[1].headers.has('if-none-match'), false);
});

Deno.test('a 304 reports not-modified and carries no body to parse', async () => {
  const { client } = clientWith([new Response(null, { status: 304 })]);
  const result = await client.snapshot({ teamIds: [159], include: ['games'], etag: 'abc' });
  assertEquals(result.kind, 'not-modified');
});

Deno.test('a 200 returns the body and the new ETag', async () => {
  const { client } = clientWith([
    json({ gamedays: [] }, { headers: { 'content-type': 'application/json', etag: '"fresh"' } }),
  ]);
  const result = await client.snapshot({ teamIds: [159], include: ['games'] });
  assert(result.kind === 'ok');
  assertEquals(result.etag, '"fresh"');
  assertEquals(result.body, { gamedays: [] });
});

// ── Throttling ───────────────────────────────────────────────────────────────

Deno.test('a 429 is reported with the Retry-After it carries', async () => {
  const { client } = clientWith([
    new Response('', { status: 429, headers: { 'retry-after': '120' } }),
  ]);
  const result = await client.snapshot({ teamIds: [159], include: ['games'] });
  assert(result.kind === 'throttled');
  assertEquals(result.retryAfterMs, 120_000);
});

Deno.test('a 429 blocks only its own budget until the back-off expires', async () => {
  // A deliberate change from "a 429 blocks everything" (D-25). Upstream's per-IP anonymous
  // limit is shared, but the strict buckets are charged separately, so at worst each bucket
  // meets one 429 of its own; stopping the liveticker for a standings 429 would cost a game.
  const { client, calls, advance } = clientWith([
    new Response('', { status: 429, headers: { 'retry-after': '600' } }),
    json({ gamedays: [] }),
  ]);

  const first = await client.snapshot({ teamIds: [159], include: ['standings'] });
  assertEquals(first.kind, 'throttled');
  assertEquals(calls.length, 1);

  assertEquals((await client.snapshot({ teamIds: [159], include: ['games'] })).kind, 'ok');
  assertEquals((await client.liveticker()).kind, 'ok');
  assertEquals(calls.length, 3);

  const during = await client.snapshot({ teamIds: [159], include: ['standings'] });
  assertEquals(during.kind, 'capped');
  assertEquals(calls.length, 3, 'no request may leave while its bucket is blocked');

  advance(600_000);
  assertEquals((await client.snapshot({ teamIds: [159], include: ['standings'] })).kind, 'ok');
  assertEquals(calls.length, 4);
});

Deno.test('a 429 on a narrow call leaves the liveticker open', async () => {
  const { client, calls } = clientWith([
    new Response('', { status: 429, headers: { 'retry-after': '60' } }),
    json([]),
  ]);

  assertEquals((await client.snapshot({ teamIds: [159], include: ['games'] })).kind, 'throttled');
  assertEquals((await client.snapshot({ teamIds: [159], include: ['games'] })).kind, 'capped');
  assertEquals((await client.liveticker()).kind, 'ok');
  assertEquals(calls.length, 2);
});

Deno.test('a 429 is recorded in a form the next tick can read back', () => {
  const now = 1_700_000_000_000;
  const stored = throttledError(120_000, now);
  assertEquals(stored, `429 retry-after-ms=120000 until=${new Date(now + 120_000).toISOString()}`);

  assertEquals(persistedBackoffUntil(stored, now), now + 120_000);
  assertEquals(persistedBackoffUntil(stored, now + 120_001), null);

  assertEquals(persistedBackoffUntil(null, now), null);
  assertEquals(persistedBackoffUntil('HTTP 500 — upstream down', now), null);
  assertEquals(persistedBackoffUntil('429 retry-after-ms=x until=y', now), null);
  // The text older versions wrote carries no instant to anchor on.
  assertEquals(persistedBackoffUntil('429, retrying after 60000ms', now), null);

  // A corrupted row can never block for longer than the one-hour ceiling.
  const tenHours = throttledError(36_000_000, now);
  assertEquals(persistedBackoffUntil(tenHours, now), now + MAX_RETRY_AFTER_MS);
});

Deno.test('a back-off carried over from the last tick blocks only its bucket', async () => {
  const { client, calls, nowRef } = clientWith([json({ gamedays: [] })]);
  client.ledger.blockUntil('snapshot', nowRef() + 60_000);

  assertEquals((await client.snapshot({ teamIds: [159], include: ['games'] })).kind, 'capped');
  assertEquals((await client.liveticker()).kind, 'ok');
  assertEquals(calls.length, 1);
});

Deno.test('Retry-After is read as seconds or as a date, with a sane fallback', () => {
  const now = 1_700_000_000_000;
  assertEquals(parseRetryAfter('30', now), 30_000);
  assertEquals(parseRetryAfter('  30  ', now), 30_000);
  assertEquals(parseRetryAfter(new Date(now + 90_000).toUTCString(), now), 90_000);

  // Missing, nonsense, past and absurd values must never produce a tight retry loop.
  assertEquals(parseRetryAfter(null, now), DEFAULT_RETRY_AFTER_MS);
  assertEquals(parseRetryAfter('soon', now), DEFAULT_RETRY_AFTER_MS);
  assertEquals(parseRetryAfter('0', now), DEFAULT_RETRY_AFTER_MS);
  assertEquals(parseRetryAfter(new Date(now - 60_000).toUTCString(), now), DEFAULT_RETRY_AFTER_MS);
  assertEquals(parseRetryAfter('999999999', now), MAX_RETRY_AFTER_MS);
});

Deno.test('the snapshot budget is enforced before upstream has to refuse us', async () => {
  const { client, calls } = clientWith([json({ gamedays: [] })], { narrowCapPerHour: 3 });

  for (let i = 0; i < 3; i += 1) {
    assertEquals((await client.snapshot({ teamIds: [159], include: ['games'] })).kind, 'ok');
  }

  const capped = await client.snapshot({ teamIds: [159], include: ['games'] });
  assert(capped.kind === 'capped');
  assertStringIncludes(capped.reason, '3/3');
  assertEquals(calls.length, 3, 'the fourth call must not reach the network');
});

Deno.test('a standings request spends the standings budget, not the narrow one', async () => {
  const { client } = clientWith([json({ gamedays: [] })]);

  await client.snapshot({ teamIds: [159], include: ['standings'] });
  await client.snapshot({ teamIds: [159], include: ['games', 'standings'] });

  assertEquals(client.ledger.callsInLastHour('snapshot-standings'), 2);
  assertEquals(client.ledger.callsInLastHour('snapshot'), 0);
});

Deno.test('the two budgets cap independently', async () => {
  const { client, calls } = clientWith([json({ gamedays: [] })], { standingsCapPerHour: 2 });

  assertEquals((await client.snapshot({ teamIds: [159], include: ['standings'] })).kind, 'ok');
  assertEquals((await client.snapshot({ teamIds: [159], include: ['standings'] })).kind, 'ok');

  const capped = await client.snapshot({ teamIds: [159], include: ['standings'] });
  assert(capped.kind === 'capped');
  assertStringIncludes(capped.reason, '2/2');

  assertEquals((await client.snapshot({ teamIds: [159], include: ['games'] })).kind, 'ok');
  assertEquals(calls.length, 3);
});

Deno.test("the default caps stay well inside upstream's limits", async () => {
  assertEquals(NARROW_SNAPSHOT_CAP_PER_HOUR, 300);
  assert(NARROW_SNAPSHOT_CAP_PER_HOUR <= UPSTREAM_SNAPSHOT_REBUILD_LIMIT_PER_HOUR / 2);
  assertEquals(UPSTREAM_SNAPSHOT_REBUILD_LIMIT_PER_HOUR, 600);
  assertEquals(STANDINGS_SNAPSHOT_CAP_PER_HOUR, 20);
  assert(STANDINGS_SNAPSHOT_CAP_PER_HOUR < UPSTREAM_SNAPSHOT_LIMIT_PER_HOUR);

  const { client, nowRef } = clientWith([json({ gamedays: [] })]);
  client.ledger.seed('snapshot', NARROW_SNAPSHOT_CAP_PER_HOUR, nowRef() - 60_000);
  client.ledger.seed('snapshot-standings', STANDINGS_SNAPSHOT_CAP_PER_HOUR, nowRef() - 60_000);

  assertEquals((await client.snapshot({ teamIds: [159], include: ['games'] })).kind, 'capped');
  assertEquals((await client.snapshot({ teamIds: [159], include: ['standings'] })).kind, 'capped');
});

Deno.test('an hour of gameday traffic fits both budgets with a live poll every minute', async () => {
  const { client, advance } = clientWith([json({ gamedays: [] })]);
  const results: string[] = [];

  for (let minute = 0; minute < 60; minute += 1) {
    // The future live poll: one narrow call a minute.
    results.push((await client.snapshot({ teamIds: [159], include: ['live'] })).kind);
    if (minute % 10 === 0) {
      // The team snapshot (published and draft) and the standings, every ten minutes.
      results.push((await client.snapshot({ teamIds: [159], include: ['games', 'logs'] })).kind);
      results.push(
        (await client.snapshot({ teamIds: [159], statuses: ['DRAFT'], include: ['games'] })).kind,
      );
      results.push((await client.snapshot({ teamIds: [159], include: ['standings'] })).kind);
    }
    // The hour ends with the last poll; moving the clock past it would age the first out.
    if (minute < 59) advance(60_000);
  }

  assertEquals(results.filter((kind) => kind === 'capped'), []);
  assertEquals(client.ledger.callsInLastHour('snapshot'), 72);
  assertEquals(client.ledger.callsInLastHour('snapshot-standings'), 6);
});

Deno.test('the budget is a rolling hour, and the liveticker does not share it', async () => {
  const { client, calls, advance } = clientWith([json({ gamedays: [] })], { narrowCapPerHour: 1 });

  assertEquals((await client.snapshot({ teamIds: [159], include: ['games'] })).kind, 'ok');
  assertEquals((await client.snapshot({ teamIds: [159], include: ['games'] })).kind, 'capped');

  // The liveticker has its own, far higher allowance upstream.
  assertEquals((await client.liveticker()).kind, 'ok');

  advance(3_600_001);
  assertEquals((await client.snapshot({ teamIds: [159], include: ['games'] })).kind, 'ok');
  assertEquals(calls.length, 3);
});

Deno.test('a new tick can seed the budget from what Postgres recorded', async () => {
  const { client, nowRef } = clientWith([json({ gamedays: [] })], { narrowCapPerHour: 5 });
  client.ledger.seed('snapshot', 5, nowRef() - 60_000);

  const result = await client.snapshot({ teamIds: [159], include: ['games'] });
  assertEquals(result.kind, 'capped');
});

Deno.test('a seeded budget runs out an hour after its window opened', async () => {
  // The regression: seeded calls were stamped "now", so a budget seeded at the cap never aged
  // and the snapshot sync stayed capped from 28 September on.
  const { client, calls, advance, nowRef } = clientWith([json({ gamedays: [] })], {
    narrowCapPerHour: 5,
  });
  const windowStartedAt = nowRef() - 59 * 60_000;
  client.ledger.seed('snapshot', 5, windowStartedAt);
  assertEquals((await client.snapshot({ teamIds: [159], include: ['games'] })).kind, 'capped');

  advance(60_000);
  assertEquals((await client.snapshot({ teamIds: [159], include: ['games'] })).kind, 'ok');
  assertEquals(calls.length, 1);
});

Deno.test('the recorded budget carries over while its window is open', () => {
  const now = new Date('2026-09-30T10:00:00Z');
  const budget = carriedSnapshotBudget(12, '2026-09-30T09:15:00Z', now);
  assertEquals(budget.calls, 12);
  assertEquals(budget.windowStartedAt.toISOString(), '2026-09-30T09:15:00.000Z');
});

Deno.test('the recorded budget starts over once its window has run an hour', () => {
  const now = new Date('2026-09-30T10:00:00Z');
  const budget = carriedSnapshotBudget(30, '2026-09-30T09:00:00Z', now);
  assertEquals(budget.calls, 0);
  assertEquals(budget.windowStartedAt, now);
});

Deno.test('a budget recorded without a window is not trusted to still be open', () => {
  // How every row looked before the window was recorded: 30 calls and no start, forever.
  const now = new Date('2026-09-30T10:00:00Z');
  assertEquals(carriedSnapshotBudget(30, null, now), { calls: 0, windowStartedAt: now });
});

// ── Failures ─────────────────────────────────────────────────────────────────

Deno.test('a 400 is an error and keeps the body, which upstream makes useful', async () => {
  const { client } = clientWith([
    new Response(JSON.stringify({ season: 'unknown Season ids: [2026]' }), { status: 400 }),
  ]);
  const result = await client.snapshot({ leaguePk: 18, seasonPk: 2026, include: ['games'] });
  assert(result.kind === 'error');
  assertEquals(result.status, 400);
  assertStringIncludes(result.message, 'unknown Season ids');
});

Deno.test('a 404 from the league table is an error, not an empty table', async () => {
  const { client } = clientWith([
    new Response(JSON.stringify({ detail: 'Unknown league or season.' }), { status: 404 }),
  ]);
  const result = await client.leagueTable('dkb-dffl', '2026');
  assert(result.kind === 'error');
  assertEquals(result.status, 404);
});

Deno.test('a transport failure is an error rather than a throw', async () => {
  const impl = (() => Promise.reject(new TypeError('connection refused'))) as typeof fetch;
  const client = new LeagueSphereClient({ fetchImpl: impl, log: () => {} });

  const result = await client.liveticker();
  assert(result.kind === 'error');
  assertEquals(result.status, null);
  assertStringIncludes(result.message, 'connection refused');
});

Deno.test('a body that is not JSON is an error rather than a crash', async () => {
  const { client } = clientWith([
    new Response('<html>gateway timeout</html>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    }),
  ]);
  const result = await client.snapshot({ teamIds: [159], include: ['games'] });
  assert(result.kind === 'error');
  assertStringIncludes(result.message, 'not JSON');
});

Deno.test('a request that outlives the timeout is aborted', async () => {
  const impl = ((_input: string | URL | Request, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'TimeoutError')));
    })) as typeof fetch;

  const client = new LeagueSphereClient({ fetchImpl: impl, timeoutMs: 10, log: () => {} });
  const result = await client.liveticker();
  assert(result.kind === 'error');
  assertStringIncludes(result.message, 'TimeoutError');
});

Deno.test('logs record the path, status and duration but never a header', async () => {
  const lines: string[] = [];
  const { impl } = stubFetch([json({ gamedays: [] })]);
  const client = new LeagueSphereClient({ fetchImpl: impl, log: (m) => lines.push(m) });

  await client.snapshot({ teamIds: [159], include: ['games'], etag: 'secret-looking-etag' });

  assertEquals(lines.length, 1);
  assertStringIncludes(lines[0], '/api/snapshot/');
  assertStringIncludes(lines[0], '200');
  assert(!lines[0].includes('secret-looking-etag'), 'headers must not be logged');
});
