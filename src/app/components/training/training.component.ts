import { Component, computed, signal, OnInit, inject, ChangeDetectionStrategy } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';

import { TryoutFormComponent } from './tryout-form.component';
import { TranslatePipe } from '../../pipes/translate.pipe';
import { CookieConsentService } from '../../services/cookie-consent.service';
import { MetaService } from '../../services/meta.service';

@Component({
  selector: 'app-training',
  standalone: true,
  imports: [NgTemplateOutlet, TryoutFormComponent, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './training.component.html'
})
export class TrainingComponent implements OnInit {
  private cookieConsentService = inject(CookieConsentService);

  private currentMonth = signal(new Date().getMonth() + 1); // 1-12

  isOffSeason = computed(() => {
    // Off-season is November (11) through March (3)
    const month = this.currentMonth();
    return month >= 11 || month <= 3;
  });

  private meta = inject(MetaService);

  ngOnInit(): void {
    this.meta.updateMeta({
      titleKey: 'meta.training.title',
      descriptionKey: 'meta.training.description',
      path: '/training',
      image: 'https://www.nuernberg-renegades.de/assets/images/training.jpg',
      imageAlt: 'Flag football training session'
    });
  }

  showMap(): boolean {
    const consent = this.cookieConsentService.getConsent();
    return consent?.maps ?? false;
  }

  acceptCookies() {
    this.cookieConsentService.acceptAll();
  }
}