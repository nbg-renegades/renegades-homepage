
import { Component, OnInit, inject, ChangeDetectionStrategy } from '@angular/core';

import { TranslatePipe } from '../../pipes/translate.pipe';
import { MetaService } from '../../services/meta.service';

@Component({
  selector: 'app-impressum',
  standalone: true,
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './impressum.component.html'
})
export class ImpressumComponent implements OnInit {
  private meta = inject(MetaService);

  ngOnInit(): void {
    this.meta.updateMeta({
      titleKey: 'meta.impressum.title',
      descriptionKey: 'meta.impressum.description',
      path: '/impressum'
    });
  }
}