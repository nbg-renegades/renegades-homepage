import { Component, ChangeDetectionStrategy, input } from '@angular/core';


/**
 * Responsive Image Component
 * Automatically generates srcset for modern image formats (AVIF, WebP, JPEG)
 * with responsive sizes for multiple breakpoints.
 *
 * Intended for larger, opaque content images (e.g. player/team photos) with
 * 640w+ variants. Not suited for small icons/logos needing transparency or
 * sub-640px sizes — use a plain <picture> with dedicated small variants instead.
 *
 * Usage:
 * <app-responsive-image
 *   [src]="'players/' + playerId"
 *   [alt]="'Player name'"
 *   [sizes]="'(max-width: 768px) 100vw, 50vw'"
 *   [priority]="true"
 *   [imageClass]="'w-full h-auto'"
 * ></app-responsive-image>
 */
@Component({
  selector: 'app-responsive-image',
  standalone: true,
  imports: [],
  template: `
    <picture>
      <!-- AVIF format (best compression) -->
      <source
        [srcset]="generateSrcset('avif')"
        [sizes]="sizes()"
        type="image/avif"
      />
      <!-- WebP format (good compression) -->
      <source
        [srcset]="generateSrcset('webp')"
        [sizes]="sizes()"
        type="image/webp"
      />
      <!-- JPEG fallback -->
      <img
        [src]="fallbackSrc"
        [alt]="alt()"
        [class]="imageClass()"
        [attr.loading]="priority() ? 'eager' : 'lazy'"
        [attr.fetchpriority]="priority() ? 'high' : 'auto'"
        decoding="async"
        [srcset]="generateSrcset('jpg')"
        [sizes]="sizes()"
      />
    </picture>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ResponsiveImageComponent {
  readonly src = input.required<string>(); // Image name without extension (e.g., 'logo-avatar')
  readonly alt = input<string>('Image');
  readonly sizes = input<string>('(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw');
  readonly imageClass = input<string>('w-full h-auto');
  readonly basePath = input<string>('/assets/images/optimized'); // Path to optimized images
  readonly priority = input(false);

  // Responsive breakpoints — use a conservative set to avoid 404s for missing sizes.
  // We always generate a `-full` version; smaller breakpoint (640) covers mobile.
  private breakpoints = [640];

  get fallbackSrc(): string {
    return `${this.basePath()}/${this.src()}-full.jpg`;
  }

  /**
   * Generate srcset string for given format
   * Example output: "/assets/images/optimized/logo-640w.avif 640w, /assets/images/optimized/logo-1024w.avif 1024w"
   */
  generateSrcset(format: 'avif' | 'webp' | 'jpg'): string {
    const srcsets = this.breakpoints
      .map(bp => `${this.basePath()}/${this.src()}-${bp}w.${format} ${bp}w`)
      .filter(Boolean)
      .join(', ');

    // Add full-size version as a fallback
    return srcsets ? `${srcsets}, ${this.basePath()}/${this.src()}-full.${format} 2000w` : `${this.basePath()}/${this.src()}-full.${format} 2000w`;
  }
}
