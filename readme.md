# Nürnberg Renegades e.V. Website

Official website for the Nürnberg Renegades Flag Football Club.

[![Deployment Status](https://api.netlify.com/api/v1/badges/7159a5d4-71cc-4595-b0e3-c312174ba716/deploy-status)](https://app.netlify.com/sites/renegades-relaunch/deploys)

## Stack

| Layer | Technology |
| --- | --- |
| Framework | Angular 20 with SSR |
| Styling | TailwindCSS |
| Database | Supabase — Postgres for the results section, plus Edge Functions for the forms and the results sync |
| Email | Resend (via Supabase Edge Functions) |
| Hosting | Netlify (Edge Functions + CDN) |
| Fonts | Manrope + Sora, self-hosted from `src/assets/fonts` (no Google Fonts request) |
| Analytics | None. No tracking or analytics service is embedded. |
| i18n | Custom `TranslatePipe` + `LanguageService`, DE at `/`, EN at `/en` (URL decides the language) |

## Architecture

### Rendering strategy

The app uses full Angular SSR (no build-time prerendering) configured in `src/app/app.config.server.ts` — every route renders on the server per request:

| Route | Mode |
| --- | --- |
| `/` | Server |
| `/team` | Server |
| `/club` | Server |
| `/training` | Server |
| `/ergebnisse`, `/ergebnisse/:team`, `/ergebnisse/:team/:tab` | Server — the results are fetched during rendering, so they are in the HTML |
| `/sponsoring` | Server |
| `/contact` | Server |
| `/faq` | Server |
| `/impressum` | Server |
| `/datenschutz` | Server |
| `/en/*` (same tree, English) | Server |

### Locale URLs

German is served from the root, English from an `/en` prefix — `/training` and `/en/training` are
separate, indexable URLs, each with a self-referencing canonical and a reciprocal hreflang pair.
The URL is the only source of truth for the active language: cookies and `Accept-Language` no
longer swap the content, because two languages on one URL meant Google could index only one of
them. `src/app/i18n/locale.ts` holds the scheme, `LocalePathPipe` keeps `routerLink`s inside the
active locale, and `server.ts` 301-redirects the legacy `?lang=` URLs onto the new paths.

All routes render on the server for every request (`RenderMode.Server`) rather than being prerendered at build time. This is required because the theme preference is resolved from request cookies and headers (`Sec-CH-Prefers-Color-Scheme`) so the very first response is already in the visitor's theme — something build-time prerendering can't do per-request.

### Build output

```text
dist/demo/
├── browser/          # Static assets (served from CDN)
│   ├── index.csr.html     # CSR shell, used as fallback
│   ├── llms.txt            # AI-agent discovery file
│   ├── robots.txt / sitemap.xml
│   └── *.js / *.css       # Hashed asset bundles
└── server/           # SSR server bundle (deployed as Netlify Edge Function)
    ├── server.mjs         # Entry point — handles every request
    └── main.server.mjs    # Angular server bootstrap
```

### Request flow on Netlify

```text
Browser request
    │
    ├── Any page route (/, /team, /club, /training, /ergebnisse, /faq, ...)
    │       └── Netlify Edge Function (server.mjs) → SSR HTML → browser hydrates
    │
    └── Static assets (*.js, *.css, images, llms.txt, robots.txt, sitemap.xml)
            └── Netlify CDN
```

### Key SSR files

| File | Purpose |
| --- | --- |
| `server.ts` | Exports `netlifyAppEngineHandler`/`reqHandler` — invoked by the Netlify Edge Function runtime, not a standalone listener |
| `src/main.server.ts` | Server bootstrap entry point |
| `src/app/app.config.ts` | Shared `ApplicationConfig` (providers used on both client and server) |
| `src/app/app.config.server.ts` | Server-only providers: route render modes |
| `netlify.toml` | Netlify build config + `@netlify/angular-runtime` plugin |

## Project structure

```text
├── src/
│   ├── app/
│   │   ├── components/
│   │   │   ├── club/              # Club membership form
│   │   │   ├── contact/           # Contact form
│   │   │   ├── cookie-consent/    # GDPR cookie banner
│   │   │   ├── cookie-settings/   # Cookie preference page
│   │   │   ├── faq/               # FAQ page with FAQPage JSON-LD schema
│   │   │   ├── footer/
│   │   │   ├── home/
│   │   │   ├── language-switcher/
│   │   │   ├── legal/             # Impressum + Datenschutz
│   │   │   ├── navbar/
│   │   │   ├── responsive-image/
│   │   │   ├── results/           # Schedule, league table and live ticker
│   │   │   │                      #   results.component      container, tabs, JSON-LD
│   │   │   │                      #   gameday-list           past/upcoming, "show more"
│   │   │   │                      #   game-card              one game, play-by-play toggle
│   │   │   │                      #   play-by-play           the structured log
│   │   │   │                      #   standings-table        the published table
│   │   │   │                      #   live-ticker            today's games, over Realtime
│   │   │   │                      #   team-logo              logo, or initials
│   │   │   │                      #   results.config/.format
│   │   │   ├── sponsoring/
│   │   │   ├── team/
│   │   │   └── training/          # Training info + tryout form
│   │   ├── services/
│   │   │   ├── contact.service.ts
│   │   │   ├── cookie-consent.service.ts
│   │   │   ├── language.service.ts   # Language comes from the URL (/ = de, /en = en)
│   │   │   ├── membership.service.ts
│   │   │   ├── meta.service.ts       # Per-locale canonical + hreflang, meta tags, JSON-LD
│   │   │   ├── recaptcha.service.ts
│   │   │   ├── results.service.ts       # Reads the results_* tables over PostgREST
│   │   │   ├── results-live.service.ts  # Realtime channel for the live tab (browser only)
│   │   │   ├── sponsor.service.ts    # Reads src/assets/data/sponsors.json
│   │   │   ├── storage.service.ts    # localStorage + cookie wrapper (SSR-safe)
│   │   │   ├── supabase.service.ts
│   │   │   ├── team.service.ts       # Reads src/assets/data/team-members.json
│   │   │   └── tryout.service.ts
│   │   ├── i18n/                  # Translation dictionaries (DE/EN)
│   │   ├── pipes/
│   │   ├── app.component.ts
│   │   ├── app.config.ts          # Shared providers
│   │   ├── app.config.server.ts   # Server providers + render modes
│   │   └── app.routes.ts
│   ├── assets/
│   │   ├── data/                  # team-members.json, sponsors.json, results-teams.json
│   │   ├── logos/                 # Club logos for the results section (96px webp/svg)
│   │   └── images/
│   ├── environments/
│   │   └── environment.ts         # Only environment file — ships to prod as-is
│   ├── llms.txt                    # AI-agent discovery file
│   └── global_styles.css
├── scripts/
│   ├── optimize-images.js
│   └── results-parity/            # Fixture upstream, gameday replay, parity checks
├── supabase/
│   ├── config.toml                # Project ref + per-function settings (committed)
│   └── functions/
│       ├── _shared/leaguesphere/         # Client, schema, mappers, scoring, standings,
│       │                                 #   schedule, time, store — pure and tested
│       ├── send-contact-email/           # Contact form → Resend
│       ├── send-membership-application/  # Membership form → Resend
│       ├── send-tryout-email/            # Tryout request → Resend
│       └── sync-leaguesphere/            # Scheduled results sync (cron-only)
├── server.ts                      # SSR server entry
├── netlify.toml
└── tailwind.config.js
```

## Development

### Prerequisites

- Node.js 22+
- pnpm — the package manager for this repo, pinned via `packageManager` in `package.json`,
  so `corepack enable` is enough. Do not run `npm install` or `yarn`: a stray
  `package-lock.json` or `yarn.lock` would make Netlify pick the wrong installer.
- Angular CLI 20 is a devDependency; run it as `pnpm ng` instead of installing it globally.

### Setup

```bash
corepack enable
pnpm install
```

pnpm 12 reads its settings from `pnpm-workspace.yaml`, not from a `pnpm` key in
`package.json`. Two entries there matter:

- **`allowBuilds`** — dependency build scripts do not run unless allow-listed, and an
  unlisted one fails the install with `ERR_PNPM_IGNORED_BUILDS` rather than passing
  silently. The native packages this project needs are listed: `sharp` and `cwebp-bin`
  for image optimization, `esbuild`, `lmdb`, `msgpackr-extract` and `@parcel/watcher` for
  the Angular build. A new dependency with a postinstall step has to be added there too.
- **`minimumReleaseAge: 7200`** — 7200 minutes is 5 days. A version published more
  recently than that is not installed, which gives a compromised release time to be
  caught and pulled from the registry. Because the setting is explicit, pnpm also turns
  on `minimumReleaseAgeStrict`, so an update with no old-enough version in range fails
  instead of quietly installing a too-new one. To take a fresh release deliberately, add
  the specific `name@version` to `minimumReleaseAgeExclude`.

No `.env` file is needed. The Supabase URL, Supabase anon key and reCAPTCHA site key are
public values that end up in the browser bundle regardless, so they are committed in
`src/environments/environment.ts` and used for both development and production.

`angular.json` has no `fileReplacements`, so `environment.ts` is the only environment file
and whatever it contains is what ships. There used to be an `environment.prod.ts` reading
`import.meta.env.VITE_*`; nothing imported it and no `fileReplacements` entry ever swapped
it in, so the Netlify variables it named had no effect. Angular does not substitute
`import.meta.env` either, so wiring it up would have thrown at runtime rather than
working. Do not reintroduce that pattern without adding a build-time `define`.

Genuine secrets — the Resend API key, the reCAPTCHA *secret* key, notification recipients —
are never in the frontend. They live as Supabase Edge Function secrets (see below).

### Running locally

```bash
# Dev server with SSR + hydration (Angular's dev middleware renders and hydrates each request)
ng serve
# → http://localhost:4200
```

`server.ts` only exports handler functions (`netlifyAppEngineHandler`, `reqHandler`) for the Netlify Edge Function runtime — running `node dist/demo/server/server.mjs` directly does **not** start a listener; it just loads the module and exits. To verify SSR/hydration locally, use `ng serve` and check the browser console: in development mode Angular logs hydration diagnostics (e.g. `Angular hydrated N component(s) ... 0 component(s) were skipped`), which are stripped in production builds.

### Build

```bash
ng build              # Development build
ng build --configuration production  # Production build
```

Output in `dist/demo/`. Every route renders per request via SSR — the build produces no prerendered route HTML (`Prerendered 0 static routes`).

## Deployment

### Netlify

Push to the connected branch. The `@netlify/angular-runtime` plugin takes care of everything:

1. Recognizes `netlifyAppEngineHandler` in `server.ts`
2. Runs `ng build`
3. Deploys `dist/demo/server/server.mjs` as a Netlify Edge Function — it handles every page request (full SSR, no prerendering)
4. Static assets (JS/CSS bundles, images, `robots.txt`, `sitemap.xml`, `llms.txt`) are served from CDN

No environment variables need to be set in the Netlify dashboard. Everything the browser
bundle needs is committed in `src/environments/environment.ts`. Any `VITE_*` variables
still configured there are leftovers and are not read by the build.

### Supabase

Project `renegades-eu` (`ekmdcqcjvodsnaqpsgun`), region `eu-central-1` (Frankfurt).
**Shared with the performance app — read [Shared project](#shared-project) first.**

```bash
supabase link --project-ref ekmdcqcjvodsnaqpsgun

# Deploy Edge Functions. Always by name: the project also holds seven functions
# belonging to the performance app, and a bulk delete would take them with it.
supabase functions deploy send-contact-email
supabase functions deploy send-membership-application
supabase functions deploy send-tryout-email
supabase functions deploy sync-leaguesphere

# Set Edge Function secrets. These are project-wide, not per-function, so a name
# collision with the performance app's secrets would break one app or the other.
supabase secrets set RESEND_API_KEY=your-resend-api-key
supabase secrets set NOTIFICATION_EMAILS=email1@example.com,email2@example.com
# Who hears about a stale results sync. Separate from the forms' recipients.
supabase secrets set RESULTS_ALERT_EMAILS=it@nuernberg-renegades.de
supabase secrets set RECAPTCHA_SECRET_KEY=your-recaptcha-secret-key
supabase secrets set HOMEPAGE_ALLOWED_ORIGINS=https://www.nuernberg-renegades.de,https://nuernberg-renegades.de,https://*.netlify.app

# The results sync. Must match the results_sync_cron_secret in Vault, or every
# call the cron job makes is rejected with 403.
supabase secrets set RESULTS_SYNC_CRON_SECRET=<a long random string>
```

`sync-leaguesphere` is not reachable from a browser and must not become so. `verify_jwt` keeps
the gateway from passing anonymous calls through, but the anon key is public and ships in this
bundle, so the real gate is the `x-cron-secret` header — which lives only in Vault and in the
function's own secrets. Without it, anyone could burn the hourly upstream budget and leave the
results page stale.

The cron job reads its credentials from Vault at call time, so no secret appears in a migration,
in `cron.job`, or in `cron.job_run_details`. Create them once, in the SQL editor:

```sql
select vault.create_secret(
  'https://ekmdcqcjvodsnaqpsgun.supabase.co/functions/v1/sync-leaguesphere',
  'results_sync_function_url', 'Endpoint the results sync cron job calls');
select vault.create_secret('<service role key>',
  'results_sync_service_key', 'Bearer token for the results sync cron job');
select vault.create_secret('<the same random string as above>',
  'results_sync_cron_secret', 'Shared secret proving a sync request came from cron');
```

Until all three exist the job logs a warning each minute and does nothing, which is the intended
unconfigured state rather than an error.

`HOMEPAGE_ALLOWED_ORIGINS` is the CORS allow list for this site's three functions
(`supabase/functions/_shared/cors.ts`). Unset, it falls back to the production origins
above plus `localhost`, which is the correct value anyway — set it only to change that
list. It is **not** called `ALLOWED_ORIGINS`, because the performance app already owns a
project-wide secret under that name holding *its* origins; sharing one would have each
app's functions rejecting the other app's site.

Never run `supabase db push` or `supabase db reset` from this repo. This project's schema
belongs to the performance app (see below), and pushing from here would try to reconcile
its migration history against a directory that no longer exists.

### Shared project

Since the performance app moved off Lovable Cloud in September 2026, `renegades-eu` backs
two applications:

| | This site ([`nbg-renegades/renegades-homepage`](https://github.com/nbg-renegades/renegades-homepage)) | Performance app ([`nbg-renegades/renegades-performance`](https://github.com/nbg-renegades/renegades-performance)) |
|---|---|---|
| Tables | `heartbeat`, `results_*` (seven) | `profiles`, `user_roles`, `player_positions`, `performance_entries` |
| Edge functions | the three `send-*` above, plus `sync-leaguesphere` | `create-user`, `delete-user`, `get-dashboard-stats`, `get-performance-averages`, `get-performance-benchmarks`, `get-player-neighborhood`, `reset-user-password` |
| Secrets | `RESEND_API_KEY`, `NOTIFICATION_EMAILS`, `RECAPTCHA_SECRET_KEY`, `HOMEPAGE_ALLOWED_ORIGINS`, `RESULTS_SYNC_CRON_SECRET`, `RESULTS_ALERT_EMAILS` | `ALLOWED_ORIGINS` |
| Auth users | none; the forms are anonymous | club members, with real personal data |

Three consequences:

- **The performance repo owns the schema.** `supabase/migrations/` lives there, including this
  site's `heartbeat` migration and the three that create the `results_*` tables, the RLS policies,
  the grants and the pg_cron job. This repo has no migrations directory. Any schema change for
  either app goes through a pull request there, and `supabase db push` is run from there — never
  from here.
- **The API keys are shared.** Both apps authenticate with the project's legacy `eyJ…`
  keys — this site's is committed in `src/environments/environment.ts`, and the keepalive
  uses the `SUPABASE_ANON_KEY` repository secret. Rotating them, or disabling them under
  *Settings → API Keys*, breaks the performance app as well. Moving to the new
  `sb_publishable_`/`sb_secret_` keys has to happen in both repos in the same change.
- **The Free tier's quotas are shared**, so both apps pause and run out together. The
  performance app's nightly database backup gives the project a second daily touch,
  independent of the keepalive below.

### Keepalive

Supabase pauses a Free-plan project after roughly 7 days without *database* activity, and
a paused project stops resolving in DNS — which is what took all three forms down in
September 2026 with `FunctionsFetchError: Failed to send a request to the Edge Function`.
Because the site only uses Supabase to host Edge Functions, Postgres is otherwise never
touched and the inactivity clock never resets on its own.

`.github/workflows/supabase-keepalive.yml` reads one row from `public.heartbeat` daily to
supply that activity. It needs a `SUPABASE_ANON_KEY` repository secret, and it fails loudly
rather than silently if the project is paused or the key is rotated.

The results sync now writes to `results_sync_state` every minute, which is database activity in
its own right, so the keepalive is technically redundant. It stays anyway: the sync is exactly
what stops if LeagueSphere is unreachable for a week, a secret is rotated or the cron job is
unscheduled — precisely when the project would drift towards a pause with nobody watching. One
read a day costs nothing and fails loudly.

`public.heartbeat` exists solely for the keepalive above and is read by nothing in the
application. The `results_*` tables are the site's real data and are described under
[Results](#results). Team roster, sponsor data and the results teams' names and logos live in
`src/assets/data/`; the database holds only what the sync writes.

Row Level Security still matters, even though this site performs no database reads or
writes of its own: the project now also holds the performance app's tables, with club
members' personal data in them, and this site's committed anon key can reach the same
REST endpoint. `heartbeat` has a world-readable `select` policy and grants writes to
nobody; every performance table requires `auth.uid()`, so the anon key sees nothing there.
Keep it that way — a policy loosened in the performance repo is a policy this key inherits.

### reCAPTCHA

1. Create a reCAPTCHA v3 site at [Google reCAPTCHA Admin](https://www.google.com/recaptcha/admin)
2. Add your domain(s) to the allowed list
3. Put the site key in `src/environments/environment.ts` (it is public and ships in the
   bundle) and set `RECAPTCHA_SECRET_KEY` as a Supabase Edge Function secret. There is no
   `VITE_RECAPTCHA_SITE_KEY` — that variable was never wired up, see the note in
   `environment.ts`.

## Results

`/ergebnisse/:team/:tab` shows the schedule, the league table and a live ticker for both teams,
rendered server-side from our own Postgres. It used to be a third-party widget in an iframe; see
[Third parties and privacy](#third-parties-and-privacy) for why that mattered.

### How the data gets here

```text
pg_cron (every minute)
    └─ pg_net ──► Edge Function `sync-leaguesphere`
                    │  reads leaguesphere.app, validates, maps
                    ▼
                  Postgres: results_gamedays, results_games, results_game_events,
                            results_standings, results_live_games, results_live_ticks,
                            results_sync_state
                    │                                   │
                    │ PostgREST (anon, SELECT only)     │ Realtime
                    ▼                                   ▼
                  Angular SSR ─────────────────► the live tab in the browser
```

The function decides on each tick what is actually due, so most minutes it does nothing: hourly
when there is no gameday, every ten minutes inside one, and the liveticker every minute while a
gameday is running. `/api/snapshot/` allows 60 requests an hour per IP and the client holds
itself to 30.

**Nothing upstream is trusted.** Every response is validated against a schema before anything is
written. On a mismatch the sync records the error and writes nothing, so the site keeps serving
the last good data with a visible "Stand:" timestamp rather than being emptied by a bad deploy at
the other end.

### Things that will bite you

- **`league` and `season` in `/api/snapshot/` are primary keys, not names.** `season=2026` is a
  400; the 2026 season is id `6`. The league ids are in
  `supabase/functions/_shared/leaguesphere/config.ts`.
- **`/api/league-table/` takes slugs, and they are not our config keys.** The first team's league
  is `dffl`; `dkb-dffl` is a 404.
- **`final_score` is never null** — it is `{home: 0, away: 0}` for a game nobody has played. Use
  `status === 'beendet'`.
- **`pa` is points *against*.** A team's own score is `fh + sh`, which is its opponent's `pa`.
- **Player number 0 exists.** Test event presence against null, never truthiness.
- **Gameday dates and kickoff times carry no timezone** and mean German wall-clock time.
  `_shared/leaguesphere/time.ts` resolves them; do not compare them against a UTC clock.

### Standings come from upstream, not from us

`results_standings` stores `/api/league-table/` verbatim. The sync also computes the table itself
on every run and logs the differences, but those numbers are never displayed.

The reason is that the two leagues do not share a ruleset. FF BL divides win points by games
played and our own computation reproduces the published table exactly, all 23 teams. DKB DFFL
divides by a fixed 30 and weights a win by the opponent's league, using configuration no public
endpoint exposes — we reproduce its games, W/D/L and points for and against exactly, but not its
quotient. Publishing our own figures there would mean publishing wrong ones.

### Adding a league season

Add an entry to `LEAGUE_SEASONS` in `supabase/functions/_shared/leaguesphere/config.ts`:

```ts
{
  key: 'ff-bl',              // ours; appears in results_standings.league_key
  season: '2027',
  leaguePk: 18,              // /api/snapshot/?league=
  seasonPk: 7,               // /api/snapshot/?season=  — a PK, not a year
  leagueDisplay: 'FF BL',    // the only league name a gameday carries
  tableSlug: 'ff-bl',        // /api/league-table/<slug>/<season>/
  name: 'FF BL 2027',
  excludeGamedayIds: [],     // playoff gamedays that must not count
  promotionRestricted: [],   // second teams, greyed out in the table
  standingsSource: 'official',
}
```

Then map the team to it in `src/app/components/results/results.config.ts`. Find the primary keys
by fetching one gameday of that league and reading its `league` and `season` fields. Deploy the
function afterwards — the config ships inside it.

### Team names and logos

Club-maintained, in this repo, not in the database:

- `src/assets/data/results-teams.json` — `{ id, name, short_name?, logo? }` per club, keyed by
  LeagueSphere's team id.
- `src/assets/logos/<team id>.webp` (or `.svg`) — 96px, which is twice the largest size they
  render at.

LeagueSphere exposes only short forms ("Nürn", "LLions") and no logos at all, so both are ours.
A club with no logo falls back to its initials, which is a normal state — eight of the clubs our
teams meet have none. Keep the logos out of `src/assets/images`: that pipeline is built for 640w+
photographs and will generate responsive variants nobody needs.

### Reading the sync state

`results_sync_state` has one row per upstream scope and is **not readable with the anon key** —
it holds upstream error strings. Query it from the SQL editor or with the service role:

```sql
select source, last_ok_at, last_error, calls_last_hour, calls_window_started_at
from results_sync_state order by source;
```

The snapshot budget (30 calls an hour) is shared by every snapshot scope, so it lives on the
`snapshot:teams` row only: the calls spent and when their one-hour window opened. A run whose
outcome reads `snapshot budget spent` is waiting for that window to close. If one still does
more than an hour after `calls_window_started_at`, the budget is not draining, which is a bug.

`last_ok_at` null or old with a `last_error` set means the site is serving stale data and saying
so. A `schema mismatch` there is the interesting case: LeagueSphere changed shape, and the
message names the exact field. The function logs every upstream call with its status and duration
under *Edge Functions → sync-leaguesphere → Logs*.

If `last_ok_at` goes past two hours during a gameday, or 26 hours otherwise, the function emails
`RESULTS_ALERT_EMAILS` through the same Resend setup the forms use — once per incident. It does
not fall back to the forms' `NOTIFICATION_EMAILS`: if the secret is unset, no alert goes out.

### Working on it without touching the real API

`scripts/results-parity/` has the tooling, and its readme has the full recipe:

- `fixture-upstream.ts` serves the recorded fixtures as if they were LeagueSphere, so UI work
  never spends the 60-an-hour snapshot budget.
- `replay-live.ts` replays a recorded gameday tick by tick, which is the only way to exercise the
  live tab outside an actual gameday.
- `compare-widget.py` and `compare-playbyplay.py` check our data against the old widget's
  snapshot.

The domain logic has Deno tests driven by recorded fixtures:

```bash
cd supabase/functions && deno task test
```


## Third parties and privacy

The privacy policy makes concrete promises about what this site does and does not load.
They are easy to break by accident, so they are written down here.

**Nothing loads from a third party on page view.** Verify with the browser network panel after
a change. What talks to someone else, and when:

| What | When it loads | Gate |
| --- | --- | --- |
| Google reCAPTCHA | Only on the three pages with a form, and only once the visitor focuses the form (`(focusin)` → `RecaptchaService.preload()`) | Art. 6(1)(f), no consent prompt |
| Google Maps | Only on `/training` | Consent category `maps` |
| Resend | Only on form submit, and only server-side | — |
| Supabase (our own Postgres, Frankfurt) | On form submit, **and on every `/ergebnisse` view** to read the results | Art. 6(1)(f) |

`/ergebnisse` is the exception to "nothing but our own origin", and it is deliberate: the results
come from our database rather than being baked into the bundle. It is a processor we already use,
in Frankfurt, under a Art. 28 agreement, and the privacy policy says so.

This replaced something worse. The results pages used to embed
`claudiost.github.io/renegades-scores/widget.html` in an iframe, so every visitor's IP went to
GitHub Pages — a personal account, in the US — on every view, undisclosed and with no consent
gate. Removing the iframe removed that. **Do not reintroduce an embed here**; the results render
natively and server-side now.

**LeagueSphere is never contacted by a visitor's browser.** Only the scheduled
`sync-leaguesphere` Edge Function talks to it. That is a hard constraint, not an implementation
detail: the upstream API is rate-limited per IP and its CORS allow-list is empty, so a
browser-side fetch would be both rude and broken.

Do not move the reCAPTCHA load back into `RecaptchaService`'s constructor: the service is
`providedIn: 'root'`, so that contacted Google for every visitor who merely opened a page
containing a form.

**Fonts are self-hosted.** Manrope and Sora live in `src/assets/fonts` as variable woff2
files (one per family per subset, latin and latin-ext only) and are declared in
`src/fonts.css`. Do not reintroduce a `fonts.googleapis.com` link — that transmits every
visitor's IP to Google before any consent. To add a weight or subset, fetch the Google
Fonts CSS with a modern browser User-Agent, download the woff2 files it references and
extend `src/fonts.css`; the weight range in the existing `@font-face` rules covers 400–800
(Manrope) and 600–800 (Sora) from a single file each.

**No analytics.** There is deliberately no analytics or tracking service. Umami was
removed; if one is ever added it needs a consent category, a privacy-policy section and a
new row in the recipients table.

**Where the policy lives.** The text is structured content in
`src/app/i18n/{de,en}/privacy-content.ts`, rendered generically by
`privacy.component.html`. Both languages must be updated together. Change the `updated`
field when the substance changes.

## Features

- Two teams: 1st team in the 1. DFFL, 2nd team in the Bayernliga
- Results section rendered server-side from our own database: schedule with play-by-play,
  league tables, and a live ticker that updates over Realtime without polling
- Multilingual (DE at `/`, EN at `/en`) with per-locale canonical + hreflang; SSR-aware theme preference (`Sec-CH-Prefers-Color-Scheme`)
- Dark / Light mode
- FAQ page with `FAQPage` JSON-LD schema
- `llms.txt` for AI-agent discoverability
- GDPR-compliant cookie consent
- Fully responsive
- reCAPTCHA v3 on all forms
- Contact form with email notifications
- Club membership form
- Tryout request form
- Full server-side rendering (SSR) on every request for SEO and personalization
- Lazy-loaded routes

## License

MIT License — Copyright (c) 2025 Nürnberg Renegades e.V.
