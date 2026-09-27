import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class SupabaseService {
  private platformId = inject(PLATFORM_ID);
  private _client: SupabaseClient | null = null;
  private _loading: Promise<SupabaseClient> | null = null;

  /**
   * Loads the Supabase client on demand, in the browser only.
   *
   * The import has to stay dynamic and type-only at the top: a static import puts
   * @supabase/supabase-js into the SSR chunk of every route that injects this service,
   * and its transitive `ws` dependency needs node:net/tls/fs, which the Netlify Deno
   * edge runtime does not provide. Angular's server router silently drops routes whose
   * loadComponent() rejects, so those routes 404 in production while rendering fine
   * under Node locally.
   */
  async getClient(): Promise<SupabaseClient> {
    if (this._client) return this._client;

    if (!isPlatformBrowser(this.platformId)) {
      throw new Error('Supabase client is not available during server-side rendering');
    }
    if (!environment.supabase.url || !environment.supabase.key) {
      throw new Error('Missing Supabase configuration. Please check your environment variables.');
    }

    this._loading ??= import('@supabase/supabase-js').then(({ createClient }) => {
      this._client = createClient(environment.supabase.url, environment.supabase.key, {
        // Nobody logs in on this site: the forms post anonymously and the results tables are
        // read with the public anon key. Leaving auth persistence on made supabase-js contend
        // for a Navigator LockManager lock ("lock:sb-…-auth-token") that immediately failed and
        // logged an error on every page with a Supabase client, and kept a refresh timer alive
        // for a session that never exists.
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
      return this._client;
    });

    return this._loading;
  }
}
