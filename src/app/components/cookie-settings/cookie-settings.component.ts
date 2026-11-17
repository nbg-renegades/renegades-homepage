import { Component, OnInit, ChangeDetectionStrategy, inject } from '@angular/core';

import { FormsModule } from '@angular/forms';
import { CookieConsentService, CookieConsent } from '../../services/cookie-consent.service';
import { TranslatePipe } from '../../pipes/translate.pipe';

@Component({
  selector: 'app-cookie-settings',
  standalone: true,
  imports: [FormsModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './cookie-settings.component.html'
})
export class CookieSettingsComponent implements OnInit {
  private cookieConsentService = inject(CookieConsentService);

  consent: CookieConsent = {
    necessary: true,
    preferences: false,
    maps: false
  };

  ngOnInit() {
    const savedConsent = this.cookieConsentService.getConsent();
    if (savedConsent) {
      this.consent = { ...savedConsent };
    }
  }

  updateSettings(key: keyof CookieConsent) {
    if (key !== 'necessary') { // Don't allow changing necessary cookies
      this.cookieConsentService.updateConsent(this.consent);
    }
  }
}