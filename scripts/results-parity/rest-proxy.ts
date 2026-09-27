// Local only: Supabase serves PostgREST under /rest/v1, a bare PostgREST container serves it at
// the root. Strips the prefix so the function can run unmodified against the test database.
const TARGET = 'http://localhost:55433';
Deno.serve({ port: 55434 }, async (req) => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/rest\/v1/, '') + url.search;
  const res = await fetch(`${TARGET}${path}`, {
    method: req.method,
    headers: req.headers,
    body: req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.text(),
  });
  return new Response(res.body, { status: res.status, headers: res.headers });
});
