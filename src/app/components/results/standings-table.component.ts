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

        <!--
          No horizontal scroll on a phone. The table has ten columns; at 390px that meant SQ —
          the quotient the whole table is ordered by — sat off-screen behind a sideways scroll
          nothing hinted at. Below "sm" only rank, club, games and quotient are columns, and the
          rest appear as a line under the club name, so every number is still on the page.
        -->
        <div class="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
          <table class="w-full text-sm border-collapse">
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
                    [class.hidden]="!column.onMobile"
                    [class.sm:table-cell]="!column.onMobile"
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
                  <td class="py-2 pr-2 align-top text-right tabular-nums">{{ row.rank }}</td>
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
                    <!-- The columns that are hidden at this width, as one compact line. -->
                    <span class="sm:hidden block mt-0.5 ml-7 text-xs tabular-nums
                                 text-gray-500 dark:text-gray-400">
                      {{ detailLine(row) }}
                    </span>
                  </td>
                  @for (column of columns; track column.key) {
                    <td
                      class="py-2 px-1.5 align-top text-right tabular-nums"
                      [class.font-semibold]="column.key === 'quotient'"
                      [class.hidden]="!column.onMobile"
                      [class.sm:table-cell]="!column.onMobile"
                    >{{ column.value(row) }}</td>
                  }
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

  /**
   * The columns, each with its own accessor so a heading and its cells cannot drift apart.
   *
   * The abbreviation is the label and the translation key spells it out. `onMobile` marks the
   * two that stay columns on a narrow screen: games played, and the quotient the table is
   * ordered by. The rest move into `detailLine`.
   */
  readonly columns: readonly {
    key: string;
    label: string;
    onMobile: boolean;
    value: (row: StandingsEntry) => string | number;
  }[] = [
    { key: 'played', label: 'Sp', onMobile: true, value: (row) => row.played },
    { key: 'won', label: 'S', onMobile: false, value: (row) => row.won },
    { key: 'drawn', label: 'U', onMobile: false, value: (row) => row.drawn },
    { key: 'lost', label: 'N', onMobile: false, value: (row) => row.lost },
    { key: 'pointsFor', label: 'EP', onMobile: false, value: (row) => row.pointsFor },
    { key: 'pointsAgainst', label: 'GP', onMobile: false, value: (row) => row.pointsAgainst },
    { key: 'pointsDiff', label: '+/-', onMobile: false, value: (row) => formatDiff(row.pointsDiff) },
    { key: 'quotient', label: 'SQ', onMobile: true, value: (row) => this.quotient(row.quotient) },
  ];

  /**
   * Everything the narrow layout drops, in one line: `18 S · 0 U · 5 N · 855:322 · +533`.
   *
   * The same abbreviations the column headings use, so the two readings agree.
   */
  detailLine(row: StandingsEntry): string {
    return `${row.won} S · ${row.drawn} U · ${row.lost} N · ` +
      `${row.pointsFor}:${row.pointsAgainst} · ${formatDiff(row.pointsDiff)}`;
  }

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
