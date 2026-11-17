import { Component, OnInit, inject, ChangeDetectionStrategy } from '@angular/core';

import { TranslatePipe } from '../../pipes/translate.pipe';
import { MembershipFormComponent } from './membership-form.component';
import { MetaService } from '../../services/meta.service';

@Component({
  selector: 'app-club',
  standalone: true,
  imports: [TranslatePipe, MembershipFormComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './club.component.html'
})
export class ClubComponent implements OnInit {
  private meta = inject(MetaService);

  ngOnInit(): void {
    this.meta.updateMeta({
      titleKey: 'meta.club.title',
      descriptionKey: 'meta.club.description',
      path: '/club'
    });
  }
}