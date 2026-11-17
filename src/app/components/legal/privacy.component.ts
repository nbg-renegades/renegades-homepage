import { Component, OnInit, computed, inject, ChangeDetectionStrategy } from '@angular/core';
import { MetaService } from '../../services/meta.service';
import { LanguageService } from '../../services/language.service';
import { CookieSettingsComponent } from '../cookie-settings/cookie-settings.component';
import { privacyContent as de } from '../../i18n/de/privacy-content';
import { privacyContent as en } from '../../i18n/en/privacy-content';

@Component({
  selector: 'app-privacy',
  standalone: true,
  imports: [CookieSettingsComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './privacy.component.html'
})
export class PrivacyComponent implements OnInit {
  #meta = inject(MetaService);
  #language = inject(LanguageService);

  readonly content = computed(() => (this.#language.currentLang() === 'en' ? en : de));

  ngOnInit(): void {
    this.#meta.updateMeta({
      titleKey: 'meta.privacy.title',
      descriptionKey: 'meta.privacy.description',
      path: '/datenschutz'
    });
  }
}