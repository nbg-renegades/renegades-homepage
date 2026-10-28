import { Injectable, inject } from '@angular/core';
import { SupabaseService } from './supabase.service';

export type MembershipType = 'adult' | 'youth' | 'support';

/**
 * Monthly fees in euros, as printed on the Mitgliedsantrag. The membership function has its
 * own copy for the notification mail; change both when the Vorstand changes the form.
 */
export const MEMBERSHIP_FEES: Record<MembershipType, number> = {
  adult: 18,
  youth: 15,
  support: 5,
};
export const ADMISSION_FEE = 20;

export interface MembershipApplication {
  membership_type: MembershipType;
  name: string;
  firstname: string;
  birthday: string;
  birthplace: string;
  nationality: string;
  street: string;
  plz_town: string;
  tel: string;
  fax: string;
  mobile: string;
  email: string;
  joindate_month: string;
  joindate_year: string;
  sepa_account_holder_name: string;
  sepa_account_holder_firstname: string;
  sepa_iban: string;
  sepa_bic: string;
  sepa_bank: string;
  recaptchaToken: string;
}

@Injectable({
  providedIn: 'root'
})
export class MembershipService {
  #supabaseService = inject(SupabaseService);

  async submitMembershipApplication(application: MembershipApplication) {
    const supabase = await this.#supabaseService.getClient();
    const { error: functionError } = await supabase.functions.invoke('send-membership-application', {
      body: { application }
    });

    if (functionError) {
      console.error('Error sending membership application:', functionError);
      throw functionError;
    }

    return application;
  }
}