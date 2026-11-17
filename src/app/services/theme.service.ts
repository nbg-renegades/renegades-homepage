import { computed, DOCUMENT, effect, inject, PLATFORM_ID, signal, Service } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { StorageService } from './storage.service';

export type Theme = 'light' | 'dark';

const THEME_STORAGE_KEY = 'preferredTheme';

@Service()
export class ThemeService {
  #storageService = inject(StorageService);
  #document = inject(DOCUMENT);
  #platformId = inject(PLATFORM_ID);

  readonly isDarkMode = signal(false);
  readonly theme = computed<Theme>(() => (this.isDarkMode() ? 'dark' : 'light'));

  constructor() {
    const savedTheme =
      this.#storageService.getCookie(THEME_STORAGE_KEY) ??
      this.#storageService.getItem(THEME_STORAGE_KEY);

    if (savedTheme === 'dark') {
      this.isDarkMode.set(true);
    } else if (savedTheme === 'light') {
      this.isDarkMode.set(false);
    } else {
      const themeHint = this.#storageService.getRequestHeader('sec-ch-prefers-color-scheme');
      if (themeHint === 'dark') {
        this.isDarkMode.set(true);
      } else if (
        isPlatformBrowser(this.#platformId) &&
        window.matchMedia('(prefers-color-scheme: dark)').matches
      ) {
        this.isDarkMode.set(true);
      }
    }

    effect(() => {
      const theme = this.theme();
      this.#document.documentElement.classList.toggle('dark', theme === 'dark');
      this.#storageService.setItem(THEME_STORAGE_KEY, theme);
      this.#storageService.setCookie(THEME_STORAGE_KEY, theme);
    });
  }

  toggle(): void {
    this.isDarkMode.update((current) => !current);
  }
}
