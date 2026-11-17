import { inject, PLATFORM_ID, signal, Service } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs/operators';
import { StorageService } from './storage.service';
import { Lang, langFromPath } from '../i18n/locale';

/**
 * The URL decides the language: `/…` is German, `/en/…` is English.
 *
 * Cookies and Accept-Language deliberately no longer switch the content — serving two
 * languages from one URL meant Google could only ever index one of them. The cookie is
 * still written so the switcher can remember a visitor's choice for future sessions.
 */
@Service()
export class LanguageService {
  #localStorage = inject(StorageService);
  #platformId = inject(PLATFORM_ID);
  #router = inject(Router);

  private readonly currentLangSignal = signal<Lang>(langFromPath(this.#localStorage.getPathname()));
  readonly currentLang = this.currentLangSignal.asReadonly();

  constructor() {
    if (isPlatformBrowser(this.#platformId)) {
      // Client-side navigation between /team and /en/team has to move the language with it.
      this.#router.events
        .pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd))
        .subscribe(event => this.#applyLang(langFromPath(event.urlAfterRedirects)));
    }
  }

  getCurrentLang(): Lang {
    return this.currentLangSignal();
  }

  #applyLang(lang: Lang): void {
    if (this.currentLangSignal() === lang) return;
    this.currentLangSignal.set(lang);
    this.#localStorage.setItem('preferredLanguage', lang);
    this.#localStorage.setCookie('preferredLanguage', lang);
  }
}
