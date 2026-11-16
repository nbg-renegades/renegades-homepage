import { AngularAppEngine, createRequestHandler } from '@angular/ssr';
import { getContext } from '@netlify/angular-runtime/context.mjs';

let angularAppEngine: AngularAppEngine | undefined;

/**
 * Nothing this handler returns may be stored by a shared cache.
 *
 * Netlify's edge cached the apex->www redirect under a key that ignored the host, then
 * replayed it on the www host — where "redirect to www" is a redirect to itself, so `/`
 * and `/team` served 301 loops until the cache was purged. SSR HTML is per-request
 * anyway (theme cookie, locale path), so it must never be shared-cached.
 */
const NO_STORE = 'private, no-store, must-revalidate';

/**
 * Netlify adds `x-forwarded-for` to every request it hands the SSR function. Since
 * @angular/ssr 20.3.25, an untrusted `x-forwarded-*` header makes AngularAppEngine skip
 * server rendering and serve the client-side shell, so it has to be trusted explicitly.
 * Netlify's own runtime 4 trusts exactly this list.
 */
const NETLIFY_PROXY_HEADERS = ['x-forwarded-for'];

/** Matches the marker MetaService emits for pages that need a non-200 status. */
const RENDER_STATUS_PATTERN = /<meta name="x-render-status" content="(\d{3})">/;

function redirect(location: string): Response {
  return new Response(null, {
    status: 301,
    headers: { location, 'cache-control': NO_STORE },
  });
}

/**
 * Language used to be a `?lang=` query parameter on the same URL, which Google could not
 * index as two pages. Those URLs are indexed and linked, so move them onto the locale
 * paths instead of dropping the equity: `?lang=en` -> `/en/...`, `?lang=de` -> `/...`.
 *
 * Netlify re-appends the original query string to the Location header of a redirect, so
 * the redirect must explicitly strip `lang` and can no longer rely on a path-only change.
 */
function legacyLangRedirect(request: Request): Response | null {
  const url = new URL(request.url);
  const lang = url.searchParams.get('lang');
  if (lang !== 'de' && lang !== 'en') {
    return null;
  }

  const isEnglishPath = url.pathname === '/en' || url.pathname.startsWith('/en/');
  let pathname = url.pathname;
  if (lang === 'en' && !isEnglishPath) {
    pathname = url.pathname === '/' ? '/en' : `/en${url.pathname}`;
  } else if (lang === 'de' && isEnglishPath) {
    pathname = url.pathname.slice('/en'.length) || '/';
  }

  const hadLangQuery = url.searchParams.has('lang');
  const pathChanged = pathname !== url.pathname;
  if (!hadLangQuery || (!pathChanged && !url.searchParams.get('lang'))) {
    return null;
  }

  url.pathname = pathname;
  url.searchParams.delete('lang');
  return redirect(url.toString());
}

/**
 * Renders the /404 page for an unmatched URL and serves it with a real 404 status, in the
 * language of the URL that was asked for. Angular renders the page with a 200, so the
 * status is applied here — a pretty page behind a 200 is a soft 404 and gets indexed.
 */
async function renderNotFound(request: Request, context: unknown): Promise<Response> {
  const url = new URL(request.url);
  const isEnglish = url.pathname === '/en' || url.pathname.startsWith('/en/');
  const notFoundUrl = new URL(isEnglish ? '/en/404' : '/404', url.origin);

  const rendered = await angularAppEngine?.handle(
    new Request(notFoundUrl, { headers: request.headers }),
    context as never,
  );

  if (!rendered) {
    return new Response('Not found', { status: 404, headers: { 'cache-control': NO_STORE } });
  }

  const headers = new Headers(rendered.headers);
  headers.set('cache-control', NO_STORE);
  return new Response(rendered.body, { status: 404, headers });
}

export async function netlifyAppEngineHandler(request: Request): Promise<Response> {
  const redirectResponse = legacyLangRedirect(request);
  if (redirectResponse) {
    return redirectResponse;
  }

  angularAppEngine ??= new AngularAppEngine({ trustProxyHeaders: NETLIFY_PROXY_HEADERS });
  const context = getContext();
  const result = await angularAppEngine.handle(request, context);
  if (!result) {
    // Angular drops routes whose loadComponent() rejects at runtime, so a genuine
    // 404 and a route that failed to load are indistinguishable here. Log the URL
    // so the difference shows up in the Netlify function logs instead of silently
    // serving 404s for real pages.
    console.warn(`[ssr] no route matched: ${new URL(request.url).pathname}`);
    return renderNotFound(request, context);
  }

  const headers = new Headers(result.headers);
  headers.set('cache-control', NO_STORE);
  return applyRenderStatus(result, headers);
}

/**
 * Angular renders every page with a 200, including the catch-all 404 route, so a page
 * that wants a different status says so with an `x-render-status` meta tag. Apply it as
 * the real HTTP status and strip the tag — a pretty 404 served with a 200 is a soft 404
 * and gets indexed like a real page.
 */
async function applyRenderStatus(result: Response, headers: Headers): Promise<Response> {
  const html = await result.text();
  const match = html.match(RENDER_STATUS_PATTERN);
  if (!match) {
    return new Response(html, { status: result.status, statusText: result.statusText, headers });
  }

  return new Response(html.replace(RENDER_STATUS_PATTERN, ''), {
    status: Number(match[1]),
    headers,
  });
}

export const reqHandler = createRequestHandler(netlifyAppEngineHandler);
