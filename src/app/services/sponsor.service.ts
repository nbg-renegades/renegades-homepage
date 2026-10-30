import { Injectable, inject, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';

export interface Sponsor {
  id: string;
  name: string;
  logo_url?: string;
  logo_url_dark?: string;
  description?: string;
  website?: string;
  active: boolean;
  priority: number;
  created_at?: string;
  updated_at?: string;
}

@Injectable({
  providedIn: 'root'
})
export class SponsorService {
  #http = inject(HttpClient);
  #sponsors = signal<Sponsor[]>([]);

  activeSponsors = computed(() => 
    this.#sponsors()
      .filter(sponsor => sponsor.active)
      .sort((a, b) => {
        // First sort by priority
        if (a.priority !== b.priority) {
          return a.priority - b.priority;
        }
        // Then by creation date
        return new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime();
      })
  );

  async loadSponsors() {
    try {
      const response = await this.#http.get<{ sponsors: Sponsor[] }>('/assets/data/sponsors.json').toPromise();
      
      if (!response?.sponsors) throw new Error('No data received');

      this.#sponsors.set(response.sponsors);
    } catch (error) {
      console.error('Error loading sponsors:', error);
    }
  }
}