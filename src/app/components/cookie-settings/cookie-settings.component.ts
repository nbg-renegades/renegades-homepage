import { Component, OnInit, ChangeDetectionStrategy } from '@angular/core';

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
  consent: CookieConsent = {
    necessary: true,
    preferences: false,
    maps: false
  };

  constructor(private cookieConsentService: CookieConsentService) {}

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