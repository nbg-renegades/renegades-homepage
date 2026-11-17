import { inject, Service } from '@angular/core';
import { SupabaseService } from './supabase.service';

export interface ContactMessage {
  name: string;
  email: string;
  subject: string;
  message: string;
  recaptchaToken: string;
}

@Service()
export class ContactService {
  #supabaseService = inject(SupabaseService);

  async submitContactForm(message: ContactMessage) {
    const supabase = await this.#supabaseService.getClient();
    const { error: functionError } = await supabase.functions.invoke('send-contact-email', {
      body: { message }
    });

    if (functionError) {
      console.error('Error sending email:', functionError);
      throw functionError;
    }

    return message;
  }
}