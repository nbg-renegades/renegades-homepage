import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { LanguageService } from '../../services/language.service';
import { TranslatePipe } from '../../pipes/translate.pipe';
import { outcomeFor, type ResultsGame, type ResultsTeam } from '../../services/results.service';
import { PlayByPlayComponent } from './play-by-play.component';
import { TeamLogoComponent } from './team-logo.component';
import { formatScore } from './results.format';

/**
 * One game: both sides, the score, and the play-by-play behind a toggle.
 *
 * The outcome colour is relative to the team whose page this is, which is why `teamId` is an
 * input rather than something the game row could carry — the same game is a win on one team's
 * page and a loss on the other's.
 */
@Component({
  selector: 'app-game-card',
  standalone: true,
  imports: [TranslatePipe, TeamLogoComponent, PlayByPlayComponent],
  template: `
    <div
      class="rounded-lg border overflow-hidden transition-colors"
      [class]="outcomeClasses()"
    >
      <!--
        A button rather than a clickable div: this is a disclosure, so it has to be reachable by
        keyboard and announce its state. "aria-expanded" and "aria-controls" do that.
      -->
      <button
        type="button"
        class="w-full text-left px-3 py-2.5 flex items-center gap-3
               focus:outline-none focus-visible:ring-2 focus-visible:ring-accent
               dark:focus-visible:ring-[var(--brand-amber)]"
        [attr.aria-expanded]="expanded()"
        [attr.aria-controls]="detailId()"
        (click)="toggle()"
      >
        <span class="w-11 shrink-0 self-start sm:self-auto pt-0.5 sm:pt-0
                     text-xs text-gray-500 dark:text-gray-400 tabular-nums">
          {{ game().scheduled ?? '' }}
        </span>

        <!--
          Two layouts, not one responsive one, because the content differs rather than just the
          placement: side by side a game reads "35:13", stacked it reads as two rows each with its
          own score. At 390px a single row truncated both clubs to "Nürnb…" and "Augs…", which is
          the one thing a result must never do.
        -->

        <!-- Narrow: one row per team. -->
        <span class="sm:hidden flex-1 min-w-0 flex flex-col gap-1">
          <span class="flex items-center gap-2">
            <app-team-logo [logoUrl]="homeLogo()" [name]="homeLabel()" [size]="20" />
            <span class="flex-1 min-w-0 truncate" [class.font-semibold]="isOurs(game().homeTeamId)">
              {{ homeLabel() }}
            </span>
            <span class="shrink-0 tabular-nums font-bold">{{ game().homeScore ?? '' }}</span>
          </span>
          <span class="flex items-center gap-2">
            <app-team-logo [logoUrl]="awayLogo()" [name]="awayLabel()" [size]="20" />
            <span class="flex-1 min-w-0 truncate" [class.font-semibold]="isOurs(game().awayTeamId)">
              {{ awayLabel() }}
            </span>
            <span class="shrink-0 tabular-nums font-bold">{{ game().awayScore ?? '' }}</span>
          </span>
        </span>

        <!-- Wide: the familiar single line. -->
        <span class="hidden sm:flex flex-1 min-w-0 items-center gap-2">
          <app-team-logo [logoUrl]="homeLogo()" [name]="homeLabel()" [size]="22" />
          <span class="truncate" [class.font-semibold]="isOurs(game().homeTeamId)">
            {{ homeLabel() }}
          </span>
        </span>

        <span class="hidden sm:inline shrink-0 tabular-nums font-bold px-1">{{ score() }}</span>

        <span class="hidden sm:flex flex-1 min-w-0 items-center gap-2 justify-end text-right">
          <span class="truncate" [class.font-semibold]="isOurs(game().awayTeamId)">
            {{ awayLabel() }}
          </span>
          <app-team-logo [logoUrl]="awayLogo()" [name]="awayLabel()" [size]="22" />
        </span>

        <svg
          class="w-4 h-4 shrink-0 text-gray-400 transition-transform"
          [class.rotate-180]="expanded()"
          viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"
        >
          <path
            fill-rule="evenodd"
            d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
            clip-rule="evenodd"
          />
        </svg>
      </button>

      @if (expanded()) {
        <div [id]="detailId()" class="border-t border-gray-200 dark:border-white/10">
          @if (halftime() !== null) {
            <p class="px-4 pt-2 text-xs text-gray-500 dark:text-gray-400">
              {{ 'results.game.halftime' | translate }}: {{ halftime() }}
            </p>
          }
          @if (game().stage !== null || game().group !== null || game().field !== null) {
            <p class="px-4 pt-1 text-xs text-gray-500 dark:text-gray-400">
              {{ meta() }}
            </p>
          }
          <app-play-by-play
            [gameId]="game().id"
            [homeName]="homeShort()"
            [awayName]="awayShort()"
          />
        </div>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GameCardComponent {
  #language = inject(LanguageService);

  readonly game = input.required<ResultsGame>();
  readonly teamId = input.required<number>();
  readonly teams = input<ReadonlyMap<number, ResultsTeam>>(new Map());

  readonly expanded = signal(false);

  readonly detailId = computed(() => `game-detail-${this.game().id}`);

  toggle(): void {
    this.expanded.update((open) => !open);
  }

  isOurs(teamId: number | null): boolean {
    return teamId !== null && teamId === this.teamId();
  }

  /**
   * The club's full name where we know it, otherwise the short form upstream sent.
   *
   * Upstream only ever gives abbreviations like "Nürn" or "LLions", so this is what turns a game
   * row into something readable. An unknown club still renders rather than showing a blank.
   */
  readonly homeLabel = computed(() => this.label(this.game().homeTeamId, this.game().homeName));
  readonly awayLabel = computed(() => this.label(this.game().awayTeamId, this.game().awayName));

  private label(teamId: number | null, fallback: string | null): string {
    const known = teamId === null ? undefined : this.teams().get(teamId);
    return known?.name ?? fallback ?? '—';
  }

  /**
   * The short form for the play-by-play, where the team is repeated on every row and the full
   * name would wrap each one onto two lines on a phone. Both clubs are named in full directly
   * above, so the abbreviation is unambiguous there.
   */
  readonly homeShort = computed(() => this.short(this.game().homeTeamId, this.game().homeName));
  readonly awayShort = computed(() => this.short(this.game().awayTeamId, this.game().awayName));

  private short(teamId: number | null, fallback: string | null): string {
    const known = teamId === null ? undefined : this.teams().get(teamId);
    return known?.shortName ?? fallback ?? known?.name ?? '—';
  }

  readonly homeLogo = computed(() => this.logo(this.game().homeTeamId));
  readonly awayLogo = computed(() => this.logo(this.game().awayTeamId));

  private logo(teamId: number | null): string | null {
    return (teamId === null ? undefined : this.teams().get(teamId)?.logoUrl) ?? null;
  }

  readonly score = computed(() => formatScore(this.game().homeScore, this.game().awayScore));

  readonly halftime = computed(() => {
    const { homeHalftime, awayHalftime } = this.game();
    if (homeHalftime === null || awayHalftime === null) return null;
    return `${homeHalftime}:${awayHalftime}`;
  });

  /** Stage, group and field, whichever of them upstream filled in. */
  readonly meta = computed(() => {
    const game = this.game();
    const parts: string[] = [];
    if (game.stage !== null) parts.push(game.stage);
    if (game.group !== null) parts.push(game.group);
    if (game.field !== null) parts.push(`${this.#language.getCurrentLang() === 'de' ? 'Feld' : 'Field'} ${game.field}`);
    return parts.join(' · ');
  });

  /**
   * A left border in the outcome's colour, rather than a tinted background.
   *
   * A win/loss tint behind the whole card fights the dark theme and makes the score harder to
   * read; a 4px edge carries the same information and leaves the text on the normal surface.
   * The colours are paired with the score text, never the only signal — the score itself says
   * what happened.
   */
  readonly outcomeClasses = computed(() => {
    const base = 'bg-secondary dark:bg-dark-surface border-gray-200 dark:border-white/10';
    switch (outcomeFor(this.game(), this.teamId())) {
      case 'win':
        return `${base} border-l-4 border-l-green-600 dark:border-l-green-500`;
      case 'loss':
        return `${base} border-l-4 border-l-red-600 dark:border-l-red-500`;
      case 'draw':
        return `${base} border-l-4 border-l-gray-400 dark:border-l-gray-500`;
      default:
        return base;
    }
  });
}
