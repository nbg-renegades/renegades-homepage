import { inject, signal, Service } from '@angular/core';
import { StorageService } from './storage.service';

export interface CookieConsent {
  necessary: boolean; // Always true, required cookies
  preferences: boolean; // For language, theme, etc.
  maps: boolean; // For Google Maps integration
}

@Service()
export class CookieConsentService {
  readonly #COOKIE_CONSENT_KEY = 'cookie-consent';
  readonly #consent = signal<CookieConsent | null>(null);
  readonly #localStorage = inject(StorageService);

  constructor() {
    this.loadConsent();
  }

  private loadConsent() {
    const savedConsent = this.#localStorage.getItem(this.#COOKIE_CONSENT_KEY);
    if (savedConsent) {
      this.#consent.set(JSON.parse(savedConsent));
    }
  }

  updateConsent(consent: CookieConsent) {
    this.#localStorage.setItem(this.#COOKIE_CONSENT_KEY, JSON.stringify(consent));
    this.#consent.set(consent);
  }

  hasConsent(): boolean {
    return this.#consent() !== null;
  }

  getConsent(): CookieConsent | null {
    return this.#consent();
  }

  acceptAll() {
    this.updateConsent({
      necessary: true,
      preferences: true,
      maps: true
    });
  }

  acceptNecessaryOnly() {
    this.updateConsent({
      necessary: true,
      preferences: false,
      maps: false
    });
  }
}