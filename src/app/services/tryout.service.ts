import { inject, Service } from '@angular/core';
import { SupabaseService } from './supabase.service';

export interface TryoutRequest {
  name: string;
  email: string;
  phone: string;
  age: string;
  experience: string;
  message: string;
  recaptchaToken: string;
}

@Service()
export class TryoutService {
  #supabaseService = inject(SupabaseService);

  async submitTryoutForm(request: TryoutRequest) {
    const supabase = await this.#supabaseService.getClient();
    const { error: functionError } = await supabase.functions.invoke('send-tryout-email', {
      body: { request }
    });

    if (functionError) {
      console.error('Error sending tryout email:', functionError);
      throw functionError;
    }

    return request;
  }
}