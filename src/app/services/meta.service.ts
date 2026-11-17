import { inject, Service } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { Meta, Title } from '@angular/platform-browser';
import { LanguageService } from './language.service';
import { translations } from '../i18n/translations';
import { LANGS, Lang, SITE_ORIGIN, localizedUrl } from '../i18n/locale';

export interface PageMeta {
  /** Translation key for the page title, e.g. 'meta.team.title'. */
  titleKey: string;
  /** Translation key for the meta description. */
  descriptionKey: string;
  /** Language-neutral path, e.g. '/team'. The canonical and hreflang URLs are derived from it. */
  path: string;
  image?: string;
  imageAlt?: string;
  type?: 'website' | 'article';
  /** Keeps the page out of the index while still following its links (404, thank-you pages). */
  noindex?: boolean;
  /**
   * HTTP status the page should be served with. Angular always renders 200, so this is
   * emitted as a meta tag that server.ts reads, applies as the real status, and strips
   * from the HTML before responding.
   */
  status?: number;
}

/** Internal handshake between a page component and server.ts. Never reaches the browser. */
export const RENDER_STATUS_META = 'x-render-status';

const OG_LOCALES: Record<Lang, string> = { de: 'de_DE', en: 'en_US' };

@Service()
export class MetaService {
  private meta = inject(Meta);
  private title = inject(Title);
  private doc = inject(DOCUMENT);
  private language = inject(LanguageService);

  private setLinkTag(rel: string, href: string, hreflang?: string): void {
    const selector = hreflang
      ? `link[rel="${rel}"][hreflang="${hreflang}"]`
      : `link[rel="${rel}"]:not([hreflang])`;
    let el = this.doc.head.querySelector<HTMLLinkElement>(selector);
    if (!el) {
      el = this.doc.createElement('link');
      el.setAttribute('rel', rel);
      if (hreflang) el.setAttribute('hreflang', hreflang);
      this.doc.head.appendChild(el);
    }
    el.setAttribute('href', href);
  }

  private translate(key: string, lang: Lang): string {
    return (translations[lang] as Record<string, string>)?.[key] ?? key;
  }

  updateMeta(data: PageMeta): void {
    const lang = this.language.getCurrentLang();
    const title = this.translate(data.titleKey, lang);
    const description = this.translate(data.descriptionKey, lang);
    const canonical = localizedUrl(data.path, lang);

    this.title.setTitle(title);
    this.meta.updateTag({ name: 'description', content: description });

    if (data.status && data.status !== 200) {
      this.meta.updateTag({ name: RENDER_STATUS_META, content: String(data.status) });
    } else {
      this.meta.removeTag(`name="${RENDER_STATUS_META}"`);
    }

    // Restore the indexable default when navigating away from a noindex page.
    this.meta.updateTag({
      name: 'robots',
      content: data.noindex
        ? 'noindex, follow'
        : 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1',
    });

    // Open Graph
    this.meta.updateTag({ property: 'og:title', content: title });
    this.meta.updateTag({ property: 'og:description', content: description });
    this.meta.updateTag({ property: 'og:url', content: canonical });
    this.meta.updateTag({ property: 'og:locale', content: OG_LOCALES[lang] });
    this.meta.updateTag({
      property: 'og:locale:alternate',
      content: OG_LOCALES[lang === 'de' ? 'en' : 'de'],
    });

    if (data.image) {
      this.meta.updateTag({ property: 'og:image', content: data.image });
      this.meta.updateTag({ name: 'twitter:image', content: data.image });
    }

    if (data.imageAlt) {
      this.meta.updateTag({ property: 'og:image:alt', content: data.imageAlt });
    }

    if (data.type) {
      this.meta.updateTag({ property: 'og:type', content: data.type });
    }

    // Self-referencing canonical per locale, plus a reciprocal hreflang cluster.
    // Both alternates must return 200 and point back at each other, or Google drops the pair.
    this.setLinkTag('canonical', canonical);
    for (const alternate of LANGS) {
      this.setLinkTag('alternate', localizedUrl(data.path, alternate), alternate);
    }
    this.setLinkTag('alternate', localizedUrl(data.path, 'de'), 'x-default');

    // Twitter Card
    this.meta.updateTag({ name: 'twitter:title', content: title });
    this.meta.updateTag({ name: 'twitter:description', content: description });
    this.meta.updateTag({ name: 'twitter:url', content: canonical });
  }

  setDefault(): void {
    this.updateMeta({
      titleKey: 'meta.home.title',
      descriptionKey: 'meta.home.description',
      path: '/',
      image: `${SITE_ORIGIN}/assets/images/og-image.jpg`,
    });
  }

  /** Injects/replaces a page-scoped JSON-LD script tag, identified by id. */
  setJsonLd(id: string, data: unknown): void {
    this.removeJsonLd(id);
    const script = this.doc.createElement('script');
    script.type = 'application/ld+json';
    script.id = id;
    script.text = JSON.stringify(data);
    this.doc.head.appendChild(script);
  }

  removeJsonLd(id: string): void {
    this.doc.getElementById(id)?.remove();
  }
}
