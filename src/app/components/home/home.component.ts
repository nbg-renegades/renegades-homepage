import { Component, signal, OnInit, inject, PLATFORM_ID } from '@angular/core';
import { DOCUMENT, isPlatformServer } from '@angular/common';
import { LocalePathPipe } from '../../pipes/locale-path.pipe';

import { RouterLink } from '@angular/router';
import { TranslatePipe } from '../../pipes/translate.pipe';
import { MetaService } from '../../services/meta.service';
import { ADMISSION_FEE, MEMBERSHIP_FEES, MembershipType } from '../../services/membership.service';

interface Feature {
  titleKey: string;
  descriptionKey: string;
}

/** Matches the media queries and sources in home.component.css. */
const HERO_PRELOADS = [
  { href: '/assets/images/optimized/hero-flag-football-640w.avif', media: '(max-width: 768px)' },
  { href: '/assets/images/optimized/hero-flag-football-full.avif', media: '(min-width: 769px)' },
];

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [RouterLink, TranslatePipe, LocalePathPipe],
  templateUrl: './home.component.html',
  styleUrl: './home.component.css'
})
export class HomeComponent implements OnInit {
  private meta = inject(MetaService);
  private doc = inject(DOCUMENT);
  private isServer = isPlatformServer(inject(PLATFORM_ID));

  aboutUsKey = signal('home.about.description');
  
  features = signal<Feature[]>([
    {
      titleKey: 'home.features.community.title',
      descriptionKey: 'home.features.community.description'
    },
    {
      titleKey: 'home.features.development.title',
      descriptionKey: 'home.features.development.description'
    },
    {
      titleKey: 'home.features.competition.title',
      descriptionKey: 'home.features.competition.description'
    }
  ]);

  readonly memberships = (Object.keys(MEMBERSHIP_FEES) as MembershipType[]).map((type) => ({
    type,
    fee: MEMBERSHIP_FEES[type],
  }));
  readonly admissionFee = String(ADMISSION_FEE);

  ngOnInit(): void {
    this.meta.updateMeta({
      titleKey: 'meta.home.title',
      descriptionKey: 'meta.home.description',
      path: '/',
      image: 'https://www.nuernberg-renegades.de/assets/images/og-image.jpg',
      imageAlt: 'Nürnberg Renegades flag football team'
    });
    this.preloadHero();
  }

  /**
   * The hero lives in this component's lazy-loaded stylesheet, so the preload scanner can't
   * find it on its own. Injected during SSR rather than from index.html, so the other routes
   * don't download an image they never render.
   */
  private preloadHero(): void {
    if (!this.isServer) return;

    for (const { href, media } of HERO_PRELOADS) {
      const link = this.doc.createElement('link');
      // setAttribute throughout: the SSR DOM doesn't reflect `as` from the property.
      link.setAttribute('rel', 'preload');
      link.setAttribute('as', 'image');
      link.setAttribute('href', href);
      link.setAttribute('media', media);
      link.setAttribute('fetchpriority', 'high');
      this.doc.head.appendChild(link);
    }
  }
}