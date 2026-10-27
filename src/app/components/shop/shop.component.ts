import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MetaService } from '../../services/meta.service';
import { TranslatePipe } from '../../pipes/translate.pipe';

interface TeamShop {
  key: string;
  url: string;
}

/**
 * Links out to the team shops. Neither vendor offers a documented embed, and framing them
 * would pull their trackers and cookie banners into our page, so we only link.
 */
@Component({
  selector: 'app-shop',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './shop.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ShopComponent {
  #meta = inject(MetaService);

  readonly shops: TeamShop[] = [
    { key: 'owayo', url: 'https://www.owayo.de/shop/Nuernberg_Renegades' },
    { key: 'harwy', url: 'https://harwy.ch/teamshop/renegades/' },
  ];

  constructor() {
    this.#meta.updateMeta({
      titleKey: 'meta.shop.title',
      descriptionKey: 'meta.shop.description',
      path: '/shop'
    });
  }
}
