import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { catchError, of, switchMap } from 'rxjs';
import { ResultsService } from '../../services/results.service';
import { TranslatePipe } from '../../pipes/translate.pipe';

/**
 * The play-by-play of one game.
 *
 * Fetched only once the card is expanded: a gameday holds three or four of our games and each has
 * around twenty plays, so loading every one up front would multiply the page for something most
 * visitors never open.
 *
 * Two things to know about the content. Every string comes from LeagueSphere and is rendered as
 * text — never through `innerHTML`, which is how the widget this replaces did it. And the list is
 * coarser than that widget's: `/api/snapshot/` groups a touchdown with its conversion under one
 * sequence, so a converted touchdown is one row reading `Touchdown: #3, 1-Extra-Punkt: #8` rather
 * than two. The finer detail only ever existed on a HTML page we no longer read.
 */
@Component({
  selector: 'app-play-by-play',
  standalone: true,
  imports: [TranslatePipe],
  template: `
    @if (events() === undefined) {
      <p class="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
        {{ 'results.playByPlay.loading' | translate }}
      </p>
    } @else if (events()!.length === 0) {
      <p class="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
        {{ 'results.playByPlay.empty' | translate }}
      </p>
    } @else {
      <table class="w-full text-sm">
        <caption class="sr-only">{{ 'results.playByPlay.caption' | translate }}</caption>
        <thead class="sr-only">
          <tr>
            <th scope="col">{{ 'results.playByPlay.team' | translate }}</th>
            <th scope="col">{{ 'results.playByPlay.event' | translate }}</th>
            <th scope="col">{{ 'results.playByPlay.score' | translate }}</th>
          </tr>
        </thead>
        <tbody>
          @for (group of halves(); track group.half) {
            <tr class="bg-secondary-dark/60 dark:bg-white/5">
              <th
                scope="colgroup"
                colspan="3"
                class="px-4 py-1.5 text-left text-xs font-semibold uppercase tracking-wide
                       text-gray-500 dark:text-gray-400"
              >
                {{ (group.half === 1 ? 'results.playByPlay.firstHalf' : 'results.playByPlay.secondHalf') | translate }}
              </th>
            </tr>
            @for (event of group.events; track event.side + '-' + event.seq) {
              <!--
                A deleted play is marked by the strikethrough alone. It used to also carry
                opacity-50, which halved the contrast of text that is already grey and failed
                WCAG AA on every such row — and the strikethrough was doing the work anyway.
              -->
              <tr class="border-t border-gray-100 dark:border-white/5">
                <td class="px-4 py-1.5 w-24 align-top text-xs text-gray-500 dark:text-gray-400">
                  {{ event.side === 'home' ? homeName() : awayName() }}
                </td>
                <td
                  class="py-1.5 pr-2 align-top"
                  [class.line-through]="event.isDeleted"
                  [class.italic]="event.isMarker"
                  [class.text-gray-500]="event.isMarker"
                  [class.dark:text-gray-400]="event.isMarker"
                >{{ event.text }}</td>
                <td class="px-4 py-1.5 w-20 align-top text-right tabular-nums font-semibold">
                  @if (event.points > 0 && !event.isDeleted) {
                    {{ event.scoreHome }}:{{ event.scoreAway }}
                  }
                </td>
              </tr>
            }
          }
        </tbody>
      </table>
      @if (hasDeleted()) {
        <p class="px-4 py-2 text-xs text-gray-500 dark:text-gray-400">
          {{ 'results.playByPlay.deletedNote' | translate }}
        </p>
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlayByPlayComponent {
  #results = inject(ResultsService);

  readonly gameId = input.required<number>();
  readonly homeName = input<string>('');
  readonly awayName = input<string>('');

  /** `undefined` while in flight, so the template can tell loading from genuinely empty. */
  readonly events = toSignal(
    toObservable(this.gameId).pipe(
      switchMap((id) => this.#results.events(id).pipe(catchError(() => of([])))),
    ),
    { initialValue: undefined },
  );

  /** Grouped so each half gets a heading, which is how a match report reads. */
  readonly halves = computed(() => {
    const all = this.events() ?? [];
    return ([1, 2] as const)
      .map((half) => ({ half, events: all.filter((event) => event.half === half) }))
      .filter((group) => group.events.length > 0);
  });

  readonly hasDeleted = computed(() => (this.events() ?? []).some((event) => event.isDeleted));
}
