import { mergeApplicationConfig, ApplicationConfig } from '@angular/core';
import { provideServerRendering, withRoutes, RenderMode, ServerRoute } from '@angular/ssr';
import { appConfig } from './app.config';

const pagePaths = [
  '',
  'team',
  'sponsoring',
  'shop',
  'impressum',
  'datenschutz',
  'ergebnisse',
  'ergebnisse/:team',
  'ergebnisse/:team/:tab',
  'contact',
  'faq',
  'club',
  'training',
  '404',
];

// Both locales render per request; `/en/...` mirrors the German tree one-for-one.
const serverRoutes: ServerRoute[] = pagePaths.flatMap(path => [
  { path, renderMode: RenderMode.Server } as ServerRoute,
  { path: path ? `en/${path}` : 'en', renderMode: RenderMode.Server } as ServerRoute,
]);

// Unmatched URLs render the 404 component; server.ts rewrites the status to 404.
serverRoutes.push({ path: '**', renderMode: RenderMode.Server });

const serverConfig: ApplicationConfig = {
  providers: [
    provideServerRendering(withRoutes(serverRoutes)),
  ],
};

export const config = mergeApplicationConfig(appConfig, serverConfig);
