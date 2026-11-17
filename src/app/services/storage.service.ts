import { Injectable, inject, REQUEST } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { PLATFORM_ID } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class StorageService {
  private platformId = inject<Object>(PLATFORM_ID);

  #request = inject(REQUEST, { optional: true });

  getItem(key: string): string | null {
    if (isPlatformBrowser(this.platformId)) {
      try {
        return localStorage.getItem(key);
      } catch (e) {
        console.warn('localStorage not available:', e);
        return null;
      }
    }
    return null;
  }

  setItem(key: string, value: string): void {
    if (isPlatformBrowser(this.platformId)) {
      try {
        localStorage.setItem(key, value);
      } catch (e) {
        console.warn('localStorage not available:', e);
      }
    }
  }

  removeItem(key: string): void {
    if (isPlatformBrowser(this.platformId)) {
      try {
        localStorage.removeItem(key);
      } catch (e) {
        console.warn('localStorage not available:', e);
      }
    }
  }

  getRequestHeader(name: string): string | null {
    return this.#request?.headers?.get(name) ?? null;
  }

  /** Current request path — `location.pathname` in the browser, the request URL during SSR. */
  getPathname(): string {
    if (isPlatformBrowser(this.platformId)) {
      return window.location.pathname;
    }

    const url = this.#request?.url;
    if (!url) {
      return '/';
    }

    try {
      return new URL(url).pathname;
    } catch {
      return '/';
    }
  }

  getQueryParam(name: string): string | null {
    if (isPlatformBrowser(this.platformId)) {
      return new URLSearchParams(window.location.search).get(name);
    }

    const url = this.#request?.url;
    if (!url) {
      return null;
    }

    try {
      return new URL(url).searchParams.get(name);
    } catch {
      return null;
    }
  }

  getCookie(name: string): string | null {
    if (isPlatformBrowser(this.platformId)) {
      return this.#readCookieHeader(document.cookie, name);
    }

    const cookieHeader = this.#request?.headers?.get('cookie');
    if (!cookieHeader) {
      return null;
    }

    return this.#readCookieHeader(cookieHeader, name);
  }

  setCookie(name: string, value: string, maxAgeSeconds = 60 * 60 * 24 * 365): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; path=/; max-age=${maxAgeSeconds}; samesite=lax`;
  }

  #readCookieHeader(cookieHeader: string, name: string): string | null {
    const target = `${encodeURIComponent(name)}=`;
    const found = cookieHeader
      .split(';')
      .map(part => part.trim())
      .find(part => part.startsWith(target));

    return found ? decodeURIComponent(found.slice(target.length)) : null;
  }
}
