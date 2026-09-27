import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { LanguageService } from '../../services/language.service';
import { TranslatePipe } from '../../pipes/translate.pipe';
import type { ResultsTeam } from '../../services/results.service';
import { isInProgress, type LiveGameView, type LiveState } from '../../services/results-live.service';
import { TeamLogoComponent } from './team-logo.component';
import { formatTickTime, formatUpdatedAt } from './results.format';

/**
 * Today's games, with the score moving as it happens.
 *
 * Presentational only: the channel, the refetching and the connection state all live in
 * `ResultsLiveService`. This renders whatever state it is handed, which is what makes the
 * degraded case free — a visitor whose WebSocket never connects gets the same markup, built from
 * the stored rows, with the indicator saying so instead of claiming to be live.
 *
 * Every tick is upstream text and is rendered as text.
 */
@Component({
  selector: 'app-live-ticker',
  standalone: true,
  imports: [TranslatePipe, TeamLogoComponent],
  template: `
    @if (state().games.length === 0) {
      <div class="py-10 text-center">
        <p class="text-gray-500 dark:text-gray-400">{{ 'results.live.noGames' | translate }}</p>
      </div>
    } @else {
      <!--
        aria-live so a screen reader hears the score change without the visitor going looking for
        it. "polite" rather than "assertive": a score is worth announcing at the next pause, not
        worth interrupting whatever is being read.
      -->
      <div class="space-y-4" aria-live="polite">
        @for (view of state().games; track view.game.id) {
          <article class="rounded-lg border border-gray-200 dark:border-white/10
                          bg-secondary dark:bg-dark-surface overflow-hidden">
            <header class="px-4 py-3 flex items-center gap-3">
              <span class="flex-1 min-w-0 flex items-center gap-2">
                <app-team-logo
                  [logoUrl]="logoFor(view.game.homeTeamId)"
                  [name]="nameFor(view.game.homeTeamId, view.game.homeName)"
                  [size]="24"
                />
                <span class="truncate font-medium">
                  {{ nameFor(view.game.homeTeamId, view.game.homeName) }}
                </span>
              </span>

              <span class="shrink-0 text-xl font-bold tabular-nums">{{ scoreOf(view) }}</span>

              <span class="flex-1 min-w-0 flex items-center gap-2 justify-end text-right">
                <span class="truncate font-medium">
                  {{ nameFor(view.game.awayTeamId, view.game.awayName) }}
                </span>
                <app-team-logo
                  [logoUrl]="logoFor(view.game.awayTeamId)"
                  [name]="nameFor(view.game.awayTeamId, view.game.awayName)"
                  [size]="24"
                />
              </span>
            </header>

            <p class="px-4 pb-3 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
              @if (running(view)) {
                <!--
                  The same dot the tab uses, so "live" means one thing on this page. It pulses
                  only when something is actually running, and the word beside it carries the
                  meaning for anyone who cannot see the colour.
                -->
                <span class="inline-block w-2 h-2 rounded-full bg-red-600 animate-pulse" aria-hidden="true"></span>
                <span class="font-semibold text-red-600 dark:text-red-500">
                  {{ 'results.live.inProgress' | translate }}
                </span>
              } @else if (view.live?.finished === true || view.game.finished) {
                <span>{{ 'results.live.finished' | translate }}</span>
              } @else {
                <span>{{ 'results.live.scheduled' | translate }}{{ view.game.scheduled === null ? '' : ' · ' + view.game.scheduled }}</span>
              }
            </p>

            @if (view.ticks.length > 0) {
              <ul class="border-t border-gray-200 dark:border-white/10 divide-y
                         divide-gray-100 dark:divide-white/5">
                @for (tick of visibleTicks(view); track tick.occurredAt + tick.text) {
                  <li class="px-4 py-2 flex items-baseline gap-3 text-sm">
                    <span class="w-10 shrink-0 text-xs text-gray-500 dark:text-gray-400 tabular-nums">
                      {{ time(tick.occurredAt) }}
                    </span>
                    <span class="w-14 shrink-0 text-xs text-gray-500 dark:text-gray-400 truncate">
                      @if (tick.side !== null) {
                        {{ tick.side === 'home'
                            ? shortFor(view.game.homeTeamId, view.game.homeName)
                            : shortFor(view.game.awayTeamId, view.game.awayName) }}
                      }
                    </span>
                    <span
                      class="flex-1 min-w-0"
                      [class.italic]="tick.isMarker"
                      [class.text-gray-500]="tick.isMarker"
                      [class.dark:text-gray-400]="tick.isMarker"
                    >{{ tick.text }}</span>
                    @if (tick.points > 0) {
                      <span class="shrink-0 text-xs font-semibold tabular-nums">
                        +{{ tick.points }}
                      </span>
                    }
                  </li>
                }
              </ul>
            }
          </article>
        }
      </div>

      <p class="mt-6 text-center text-xs text-gray-500 dark:text-gray-400">
        @switch (state().status) {
          @case ('live') { {{ 'results.live.connected' | translate }} }
          @case ('unavailable') { {{ 'results.live.unavailable' | translate }} }
          @default { {{ 'results.live.notLive' | translate }} }
        }
        @if (lastTickLabel() !== null) {
          <span aria-hidden="true"> · </span>{{ 'results.live.lastUpdate' | translate }}: {{ lastTickLabel() }}
        }
      </p>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LiveTickerComponent {
  #language = inject(LanguageService);

  readonly state = input.required<LiveState>();
  readonly teams = input<ReadonlyMap<number, ResultsTeam>>(new Map());

  /** Most recent first, and capped: a full game is around forty ticks. */
  private static readonly VISIBLE_TICKS = 25;

  visibleTicks(view: LiveGameView) {
    return view.ticks.slice(0, LiveTickerComponent.VISIBLE_TICKS);
  }

  running(view: LiveGameView): boolean {
    return isInProgress(view);
  }

  /**
   * The live score where there is one, otherwise the stored result.
   *
   * A game that has not started has neither, and shows a dash rather than 0:0 — which would read
   * as a scoreless draw.
   */
  scoreOf(view: LiveGameView): string {
    if (view.live !== null) return `${view.live.homeScore}:${view.live.awayScore}`;
    if (view.game.homeScore !== null && view.game.awayScore !== null) {
      return `${view.game.homeScore}:${view.game.awayScore}`;
    }
    return '–';
  }

  nameFor(teamId: number | null, fallback: string | null): string {
    const known = teamId === null ? undefined : this.teams().get(teamId);
    return known?.name ?? fallback ?? '—';
  }

  shortFor(teamId: number | null, fallback: string | null): string {
    const known = teamId === null ? undefined : this.teams().get(teamId);
    return known?.shortName ?? fallback ?? known?.name ?? '';
  }

  logoFor(teamId: number | null): string | null {
    return (teamId === null ? undefined : this.teams().get(teamId)?.logoUrl) ?? null;
  }

  time(instant: string): string {
    return formatTickTime(instant, this.#language.getCurrentLang());
  }

  readonly lastTickLabel = computed(() => {
    const at = this.state().lastTickAt;
    return at === null ? null : formatUpdatedAt(at, this.#language.getCurrentLang());
  });
}
