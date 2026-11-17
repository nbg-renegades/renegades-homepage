import { inject, PLATFORM_ID, Service } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { environment } from '../../environments/environment';

declare global {
  interface Window {
    grecaptcha: {
      ready: (callback: () => void) => void;
      execute: (siteKey: string, options: { action: string }) => Promise<string>;
    };
  }
}

@Service()
export class RecaptchaService {
  private readonly siteKey = environment.recaptcha.siteKey;
  private loaded = false;
  private loadPromise: Promise<void> | null = null;
  #platformId = inject(PLATFORM_ID);

  /**
   * Called on first interaction with a form so the script is warm by submit time.
   * Deliberately not called from the constructor: that contacted Google for every
   * visitor who merely opened a page containing a form.
   */
  preload(): void {
    if (isPlatformBrowser(this.#platformId)) {
      void this.loadScript();
    }
  }

  private loadScript(): Promise<void> {
    if (this.loadPromise) return this.loadPromise;

    this.loadPromise = new Promise((resolve) => {
      if (this.loaded) {
        resolve();
        return;
      }

      const script = document.createElement('script');
      script.src = `https://www.google.com/recaptcha/api.js?render=${this.siteKey}`;
      script.async = true;
      script.defer = true;

      script.onload = () => {
        this.loaded = true;
        resolve();
      };

      document.head.appendChild(script);
    });

    return this.loadPromise;
  }

  async executeRecaptcha(action: string): Promise<string> {
    if (!isPlatformBrowser(this.#platformId)) {
      return '';
    }

    await this.loadScript();

    return new Promise((resolve, reject) => {
      window.grecaptcha.ready(async () => {
        try {
          const token = await window.grecaptcha.execute(this.siteKey, { action });
          resolve(token);
        } catch (error) {
          console.error('reCAPTCHA execution failed:', error);
          reject(error);
        }
      });
    });
  }
}
