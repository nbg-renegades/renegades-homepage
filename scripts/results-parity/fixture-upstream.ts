/**
 * Serves the recorded fixtures as if they were LeagueSphere.
 *
 * For working on the results pages without touching the real API: it has a 60-requests-an-hour
 * budget for the snapshot, it is a third party we are a guest on, and — as on 2026-09-27 — it is
 * sometimes simply down. Point the sync at this instead and the database fills with the same real
 * data every time.
 *
 *   deno run --allow-net --allow-read scripts/results-parity/fixture-upstream.ts [--port 8788]
 *
 *   LEAGUESPHERE_BASE_URL=http://localhost:8788 \
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… RESULTS_SYNC_CRON_SECRET=… \
 *     deno run --allow-net --allow-env --allow-read supabase/functions/sync-leaguesphere/index.ts
 *
 * For a gameday that *moves*, use `replay-live.ts` instead — this one is static.
 */

const FIXTURES = new URL(
  '../../supabase/functions/_shared/leaguesphere/__fixtures__/',
  import.meta.url,
);

const port = Number(
  Deno.args[Deno.args.indexOf('--port') + 1] ?? (Deno.args.includes('--port') ? 8788 : 8788),
);

async function fixture(name: string): Promise<unknown> {
  return JSON.parse(await Deno.readTextFile(new URL(name, FIXTURES)));
}

console.log(`serving recorded LeagueSphere fixtures on http://localhost:${port}`);

Deno.serve({ port }, async (req) => {
  const url = new URL(req.url);

  if (url.pathname === '/api/snapshot/') {
    const league = url.searchParams.get('league');
    // League-scoped calls are the standings cross-check; team-scoped is the schedule.
    if (league === '18') return json(await fixture('snapshot.league-ffbl-2026.json'));
    if (league === '7') return json(await fixture('snapshot.league-dffl-2026.json'));
    // The drafts call: real, and legitimately empty for our teams.
    if (url.searchParams.getAll('status').includes('DRAFT')) {
      return json(await fixture('snapshot.status-draft-empty.json'));
    }
    return json(await fixture('snapshot.teams-159-287.json'));
  }

  if (url.pathname.startsWith('/api/league-table/')) {
    const slug = url.pathname.split('/')[3];
    if (slug === 'ff-bl') return json(await fixture('league-table.ff-bl-2026.json'));
    if (slug === 'dffl') return json(await fixture('league-table.dffl-2026.json'));
    return new Response(JSON.stringify({ detail: 'Unknown league or season.' }), { status: 404 });
  }

  if (url.pathname === '/api/liveticker/') {
    // The full-history recording, which is what the live tab needs for a running score.
    return json(await fixture('liveticker.get-all-ticks-for.json'));
  }

  return new Response('not found', { status: 404 });
});

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      'content-type': 'application/json',
      // Stable per payload, so the sync's If-None-Match path is exercised too.
      etag: `"fixture-${hash(JSON.stringify(body))}"`,
    },
  });
}

function hash(value: string): string {
  let h = 0;
  for (let i = 0; i < value.length; i += 1) h = (Math.imul(31, h) + value.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}
