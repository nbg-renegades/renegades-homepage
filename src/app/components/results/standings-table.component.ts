import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { LanguageService } from '../../services/language.service';
import { TranslatePipe } from '../../pipes/translate.pipe';
import type { ResultsTeam, StandingsEntry } from '../../services/results.service';
import { TeamLogoComponent } from './team-logo.component';
import { formatDiff, formatQuotient } from './results.format';

/**
 * The league table, exactly as the league publishes it.
 *
 * Deliberately not recomputed here or in the sync: the two leagues our teams play in do not share
 * a ruleset, and only one of them can be reproduced from public data. FF BL divides win points by
 * games played; DKB DFFL divides by a fixed 30 and weights a win by the opponent's league, using
 * configuration no public endpoint exposes. So these numbers are upstream's, and the sync's own
 * calculation only ever runs as a cross-check.
 *
 * The greyed rows are one shade darker than they look like they should be: `text-gray-400` on
 * white is 2.5:1, which fails WCAG AA, and axe flagged all twenty of them. `text-gray-500` in
 * light and `text-gray-400` in dark still read as clearly de-emphasised while staying legible —
 * and the `*` marker means the greying was never the only signal anyway.
 *
 * Column headings stay German-abbreviated in both languages (Sp, S, U, N, EP, GP, SQ) because
 * that is what the official tables use and what anyone comparing the two expects; each has a
 * spelled-out `title` and an `abbr`, so the meaning is one hover or one screen reader away.
 */
@Component({
  selector: 'app-standings-table',
  standalone: true,
  imports: [TranslatePipe, TeamLogoComponent],
  template: `
    @if (groups().length === 0) {
      <p class="py-10 text-center text-gray-500 dark:text-gray-400">
        {{ 'results.standings.empty' | translate }}
      </p>
    }

    @for (group of groups(); track group.name) {
      <section class="mb-8">
        @if (groups().length > 1) {
          <h2 class="text-lg font-bold mb-3">{{ group.name }}</h2>
        }

        <div class="overflow-x-auto -mx-4 px-4">
          <table class="w-full min-w-[34rem] text-sm border-collapse">
            <caption class="sr-only">{{ 'results.standings.caption' | translate }}</caption>
            <thead>
              <tr class="border-b border-gray-200 dark:border-white/10 text-left">
                <th scope="col" class="py-2 pr-2 w-8 text-right font-semibold">#</th>
                <th scope="col" class="py-2 px-2 font-semibold">
                  {{ 'results.standings.team' | translate }}
                </th>
                @for (column of columns; track column.key) {
                  <th
                    scope="col"
                    class="py-2 px-1.5 text-right font-semibold tabular-nums whitespace-nowrap"
                  >
                    <abbr
                      class="no-underline"
                      [title]="('results.standings.' + column.key) | translate"
                    >{{ column.label }}</abbr>
                  </th>
                }
              </tr>
            </thead>
            <tbody>
              @for (row of group.rows; track row.teamId) {
                <tr
                  class="border-b border-gray-100 dark:border-white/5"
                  [class.bg-accent]="isOurs(row.teamId)"
                  [class.bg-opacity-10]="isOurs(row.teamId)"
                  [class.dark:bg-white]="isOurs(row.teamId)"
                  [class.dark:bg-opacity-5]="isOurs(row.teamId)"
                  [class.text-gray-500]="row.promotionRestricted"
                  [class.dark:text-gray-400]="row.promotionRestricted"
                >
                  <td class="py-2 pr-2 text-right tabular-nums">{{ row.rank }}</td>
                  <td class="py-2 px-2">
                    <span class="flex items-center gap-2 min-w-0">
                      <app-team-logo
                        [logoUrl]="logoFor(row.teamId)"
                        [name]="nameFor(row.teamId)"
                        [size]="20"
                      />
                      <span class="truncate" [class.font-semibold]="isOurs(row.teamId)">
                        {{ nameFor(row.teamId) }}
                      </span>
                      @if (row.promotionRestricted) {
                        <!--
                          A marker as well as the grey, because colour alone is not a signal a
                          colour-blind or high-contrast visitor can read.
                        -->
                        <abbr
                          class="no-underline text-xs shrink-0"
                          [title]="'results.standings.promotionRestrictedTitle' | translate"
                        >*</abbr>
                      }
                    </span>
                  </td>
                  <td class="py-2 px-1.5 text-right tabular-nums">{{ row.played }}</td>
                  <td class="py-2 px-1.5 text-right tabular-nums">{{ row.won }}</td>
                  <td class="py-2 px-1.5 text-right tabular-nums">{{ row.drawn }}</td>
                  <td class="py-2 px-1.5 text-right tabular-nums">{{ row.lost }}</td>
                  <td class="py-2 px-1.5 text-right tabular-nums">{{ row.pointsFor }}</td>
                  <td class="py-2 px-1.5 text-right tabular-nums">{{ row.pointsAgainst }}</td>
                  <td class="py-2 px-1.5 text-right tabular-nums">{{ diff(row.pointsDiff) }}</td>
                  <td class="py-2 px-1.5 text-right tabular-nums font-semibold">
                    {{ quotient(row.quotient) }}
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>

        @if (group.hasRestricted) {
          <p class="mt-2 text-xs text-gray-500 dark:text-gray-400">
            * {{ 'results.standings.promotionRestrictedNote' | translate }}
          </p>
        }
      </section>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StandingsTableComponent {
  #language = inject(LanguageService);

  readonly entries = input.required<readonly StandingsEntry[]>();
  readonly teamId = input.required<number>();
  readonly teams = input<ReadonlyMap<number, ResultsTeam>>(new Map());

  /** The abbreviation is the column label; the translation key spells it out. */
  readonly columns = [
    { key: 'played', label: 'Sp' },
    { key: 'won', label: 'S' },
    { key: 'drawn', label: 'U' },
    { key: 'lost', label: 'N' },
    { key: 'pointsFor', label: 'EP' },
    { key: 'pointsAgainst', label: 'GP' },
    { key: 'pointsDiff', label: '+/-' },
    { key: 'quotient', label: 'SQ' },
  ] as const;

  /**
   * Split by the group upstream assigns, preserving the published order within each.
   *
   * Both our leagues are a single group today, so the heading is suppressed when there is only
   * one — but DKB DFFL is configured upstream to be groupable, and a season that splits would
   * otherwise render as one nonsensical merged table.
   */
  readonly groups = computed(() => {
    const byName = new Map<string, StandingsEntry[]>();
    for (const entry of this.entries()) {
      const rows = byName.get(entry.group);
      if (rows === undefined) byName.set(entry.group, [entry]);
      else rows.push(entry);
    }
    return [...byName].map(([name, rows]) => ({
      name,
      rows,
      hasRestricted: rows.some((row) => row.promotionRestricted),
    }));
  });

  isOurs(teamId: number): boolean {
    return teamId === this.teamId();
  }

  nameFor(teamId: number): string {
    return this.teams().get(teamId)?.name ?? String(teamId);
  }

  logoFor(teamId: number): string | null {
    return this.teams().get(teamId)?.logoUrl ?? null;
  }

  quotient(value: number): string {
    return formatQuotient(value, this.#language.getCurrentLang());
  }

  diff(value: number): string {
    return formatDiff(value);
  }
}
