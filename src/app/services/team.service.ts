import { inject, signal, computed, Service } from '@angular/core';
import { HttpClient } from '@angular/common/http';

export interface TeamMember {
  name: string;
  role?: string;
  image_url?: string;
  number?: string;
  position?: string;
  member_type: 'staff' | 'player';
  created_at?: string;
  updated_at?: string;
}

@Service()
export class TeamService {
  #http = inject(HttpClient);
  #teamMembers = signal<TeamMember[]>([]);

  staff = computed(() => 
    this.#teamMembers().filter(member => member.member_type === 'staff')
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
  );

  players = computed(() => 
    this.#teamMembers().filter(member => member.member_type === 'player')
      .sort((a, b) => +(a?.number || 0) - +(b?.number || 0))
  );

  async loadTeamMembers() {
    try {
      const response = await this.#http.get<{ teamMembers: TeamMember[] }>('/assets/data/team-members.json').toPromise();
      
      if (!response?.teamMembers) throw new Error('No data received');

      this.#teamMembers.set(response.teamMembers);
    } catch (error) {
      console.error('Error in loadTeamMembers:', error);
      throw error;
    }
  }
}