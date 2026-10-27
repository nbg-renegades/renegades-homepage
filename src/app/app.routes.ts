import { Routes } from '@angular/router';
import { EN_PREFIX } from './i18n/locale';

/**
 * Language-neutral page tree. Mounted twice: at the root for German and under `/en`
 * for English, so every page has one indexable URL per language. Redirects inside are
 * relative on purpose — they resolve within whichever locale they are mounted in.
 */
const pages: Routes = [
  {
    path: '',
    loadComponent: () => import('./components/home/home.component').then(m => m.HomeComponent)
  },
  {
    path: 'team',
    loadComponent: () => import('./components/team/team.component').then(m => m.TeamComponent)
  },
  {
    path: 'club',
    loadComponent: () => import('./components/club/club.component').then(m => m.ClubComponent)
  },
  {
    path: 'training',
    loadComponent: () => import('./components/training/training.component').then(m => m.TrainingComponent)
  },
  {
    path: 'sponsoring',
    loadComponent: () => import('./components/sponsoring/sponsoring.component').then(m => m.SponsoringComponent)
  },
  {
    path: 'shop',
    loadComponent: () => import('./components/shop/shop.component').then(m => m.ShopComponent)
  },
  {
    path: 'ergebnisse',
    children: [
      {
        path: '',
        loadComponent: () => import('./components/results/results.component').then(m => m.ResultsComponent)
      },
      {
        path: ':team',
        loadComponent: () => import('./components/results/results.component').then(m => m.ResultsComponent)
      },
      {
        path: ':team/:tab',
        loadComponent: () => import('./components/results/results.component').then(m => m.ResultsComponent)
      }
    ]
  },
  {
    path: 'contact',
    loadComponent: () => import('./components/contact/contact.component').then(m => m.ContactComponent)
  },
  {
    path: 'faq',
    loadComponent: () => import('./components/faq/faq.component').then(m => m.FaqComponent)
  },
  {
    path: 'impressum',
    loadComponent: () => import('./components/legal/impressum.component').then(m => m.ImpressumComponent)
  },
  {
    path: 'datenschutz',
    loadComponent: () => import('./components/legal/privacy.component').then(m => m.PrivacyComponent)
  },
  {
    path: '404',
    loadComponent: () => import('./components/not-found/not-found.component').then(m => m.NotFoundComponent)
  }
];

export const routes: Routes = [
  { path: EN_PREFIX.slice(1), children: pages },
  ...pages,
  {
    // The client router has to resolve unmatched URLs too, or hydration finds no
    // component for the server-rendered 404 markup and wipes the page. Angular renders
    // this with a 200; server.ts rewrites the status so it never becomes a soft 404.
    path: '**',
    loadComponent: () => import('./components/not-found/not-found.component').then(m => m.NotFoundComponent)
  }
];
