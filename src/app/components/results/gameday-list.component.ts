import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { LanguageService } from '../../services/language.service';
import { TranslatePipe } from '../../pipes/translate.pipe';
import type { ResultsGameday, ResultsTeam } from '../../services/results.service';
import { GameCardComponent } from './game-card.component';
import { PAST_GAMEDAYS_VISIBLE } from './results.config';
import { formatGamedayDate } from './results.format';

/**
 * The schedule: what is coming, then what has already been played.
 *
 * Upcoming first and in ascending order, because the next fixture is the thing a visitor came
 * for. Past gamedays descend from the most recent and collapse after three — a full season is
 * sixteen or more, and the older ones are archive rather than news.
 */
@Component({
  selector: 'app-gameday-list',
  standalone: true,
  imports: [TranslatePipe, GameCardComponent, NgTemplateOutlet],
  template: `
    @if (gamedays().length === 0) {
      <p class="py-10 text-center text-gray-500 dark:text-gray-400">
        {{ 'results.schedule.empty' | translate }}
      </p>
    }

    @if (upcoming().length > 0) {
      <section class="mb-10">
        <h2 class="text-xl font-bold mb-4">{{ 'results.schedule.upcoming' | translate }}</h2>
        @for (gameday of upcoming(); track gameday.id) {
          <ng-container [ngTemplateOutlet]="card" [ngTemplateOutletContext]="{ gameday }" />
        }
      </section>
    }

    @if (past().length > 0) {
      <section>
        <h2 class="text-xl font-bold mb-4">{{ 'results.schedule.past' | translate }}</h2>
        @for (gameday of visiblePast(); track gameday.id) {
          <ng-container [ngTemplateOutlet]="card" [ngTemplateOutletContext]="{ gameday }" />
        }

        @if (hiddenCount() > 0) {
          <button
            type="button"
            class="w-full mt-2 py-2.5 rounded-lg text-sm font-semibold
                   text-accent dark:text-[var(--brand-amber)]
                   bg-secondary-dark dark:bg-dark-surface
                   hover:bg-gray-200 dark:hover:bg-white/10 transition-colors
                   focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            (click)="showAllPast.set(true)"
          >
            {{ 'results.schedule.showMore' | translate: { count: hiddenCount().toString() } }}
          </button>
        }
      </section>
    }

    <!--
      One template for both sections: an upcoming and a played gameday differ only in what the
      score cells contain, and duplicating the markup is how the two drift apart.
    -->
    <ng-template #card let-gameday="gameday">
      <article class="mb-5">
        <header class="mb-2">
          <div class="flex flex-wrap items-baseline gap-x-2">
            <h3 class="font-semibold">{{ formatDate(gameday.date) }}</h3>
            <span class="text-sm text-gray-500 dark:text-gray-400">{{ gameday.leagueDisplay }}</span>
            @if (gameday.phase === 'today') {
              <span
                class="text-xs font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded
                       bg-accent text-white dark:bg-[var(--brand-amber)] dark:text-primary"
              >{{ 'results.schedule.today' | translate }}</span>
            }
          </div>
          <p class="text-sm text-gray-500 dark:text-gray-400">
            {{ gameday.name }}
            <!-- The sync already turned "tba" and "Adresse folgt" into null, so a value here is real. -->
            @if (gameday.address !== null) {
              <span aria-hidden="true"> · </span>{{ gameday.address }}
            }
          </p>
        </header>

        <div class="space-y-2">
          @for (game of gameday.games; track game.id) {
            <app-game-card [game]="game" [teamId]="teamId()" [teams]="teams()" />
          }
        </div>
      </article>
    </ng-template>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GamedayListComponent {
  #language = inject(LanguageService);

  readonly gamedays = input.required<readonly ResultsGameday[]>();
  readonly teamId = input.required<number>();
  readonly teams = input<ReadonlyMap<number, ResultsTeam>>(new Map());

  readonly showAllPast = signal(false);

  /** Today counts as upcoming while anything is still to be played. */
  readonly upcoming = computed(() =>
    this.gamedays()
      .filter((gameday) => gameday.phase !== 'past')
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date)),
  );

  readonly past = computed(() =>
    this.gamedays()
      .filter((gameday) => gameday.phase === 'past')
      .slice()
      .sort((a, b) => b.date.localeCompare(a.date)),
  );

  readonly visiblePast = computed(() =>
    this.showAllPast() ? this.past() : this.past().slice(0, PAST_GAMEDAYS_VISIBLE),
  );

  readonly hiddenCount = computed(() => this.past().length - this.visiblePast().length);

  formatDate(date: string): string {
    return formatGamedayDate(date, this.#language.getCurrentLang());
  }
}
