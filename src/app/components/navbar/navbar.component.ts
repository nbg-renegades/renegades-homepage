import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { TranslatePipe } from '../../pipes/translate.pipe';
import { LanguageSwitcherComponent } from '../language-switcher/language-switcher.component';
import { LocalePathPipe } from '../../pipes/locale-path.pipe';

@Component({
  selector: 'app-navbar',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, TranslatePipe, LanguageSwitcherComponent, LocalePathPipe],
  templateUrl: './navbar.component.html',
  styleUrl: './navbar.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class NavbarComponent {
  isDarkMode = input(false);
  toggleTheme = output<void>();
  
  readonly isMenuOpen = signal(false);
  #lastToggle = -Infinity;

  toggleMenu() {
    // Taps made while the page is still loading are replayed together once it has hydrated
    // (withEventReplay in app.config.ts). Someone who tapped twice because nothing happened
    // would otherwise see the menu open and shut again in the same instant.
    const now = performance.now();
    if (now - this.#lastToggle < 300) return;
    this.#lastToggle = now;
    this.isMenuOpen.update(state => !state);
  }

  closeMenu() {
    this.isMenuOpen.set(false);
  }
}