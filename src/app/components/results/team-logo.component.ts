import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { teamInitials } from './results.format';

/**
 * A club's logo, or its initials when there is none.
 *
 * The fallback is not an edge case: LeagueSphere exposes no logos at all through its API, so
 * every one here is a file the club collected by hand, and eight of the clubs our teams meet have
 * none. So the initials have to look like a designed state rather than a broken image.
 *
 * `onError` covers the other way this fails — a logo file that is referenced but missing from the
 * deploy. Without it the browser shows its own broken-image glyph, which looks like a bug.
 */
@Component({
  selector: 'app-team-logo',
  standalone: true,
  template: `
    @if (logoUrl() !== null && !failed()) {
      <img
        [src]="logoUrl()"
        [alt]="''"
        [width]="size()"
        [height]="size()"
        class="object-contain shrink-0"
        [style.width.px]="size()"
        [style.height.px]="size()"
        loading="lazy"
        decoding="async"
        (error)="failed.set(true)"
      />
    } @else {
      <!--
        aria-hidden because the club's name is always rendered as text next to this, so a screen
        reader announcing the initials as well would just repeat it.
      -->
      <span
        aria-hidden="true"
        class="shrink-0 inline-flex items-center justify-center rounded-full
               bg-secondary-dark dark:bg-dark-surface
               text-gray-600 dark:text-gray-300 font-semibold leading-none"
        [style.width.px]="size()"
        [style.height.px]="size()"
        [style.font-size.px]="fontSize()"
      >{{ initials() }}</span>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TeamLogoComponent {
  readonly logoUrl = input<string | null>(null);
  readonly name = input<string>('');
  readonly size = input<number>(24);

  /** Set when the file 404s, so the initials take over instead of a broken-image glyph. */
  readonly failed = signal(false);

  readonly initials = computed(() => teamInitials(this.name()));

  /** Two characters have to fit inside the circle at every size this is used at. */
  readonly fontSize = computed(() => Math.max(9, Math.round(this.size() * 0.42)));
}
