import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  OnDestroy,
  OnInit,
  PLATFORM_ID,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { isPlatformBrowser, NgClass } from '@angular/common';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { ActivatedRoute, Params, RouterLink } from '@angular/router';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { catchError, of, switchMap } from 'rxjs';
import { TranslatePipe } from '../../pipes/translate.pipe';
import { LocalePathPipe } from '../../pipes/locale-path.pipe';
import { MetaService } from '../../services/meta.service';
import { ThemeService } from '../../services/theme.service';
import { LanguageService } from '../../services/language.service';
import { ResultsService, type ResultsTeam } from '../../services/results.service';
import { SITE_ORIGIN } from '../../i18n/locale';
import { GamedayListComponent } from './gameday-list.component';
import { StandingsTableComponent } from './standings-table.component';
import {
  isNative,
  TABS,
  tabFromParam,
  teamBySlug,
  type Tab,
} from './results.config';
import { formatUpdatedAt } from './results.format';

const WIDGET_ORIGIN = 'https://claudiost.github.io';
const WIDGET_BASE = 'https://claudiost.github.io/renegades-scores/widget.html';
const MIN_HEIGHT = 400;
// Accent per theme, mirroring the `accent` / `--brand-amber` tokens of the site.
const WIDGET_ACCENT_LIGHT = '8a5d00';
const WIDGET_ACCENT_DARK = 'ffc03a';

/**
 * The results section.
 *
 * Mid-migration: the schedule and the table render from our own database, the live tab still
 * embeds the old third-party widget. `isNative()` decides per tab, so either side can be switched
 * back without a deploy (`?native=none`), and everything to do with the iframe — the origin
 * constants, the height and theme `postMessage` handshake — goes away with the last tab.
 *
 * The data is fetched with `HttpClient`, which means it is fetched during server rendering too and
 * arrives in the HTML. Angular's transfer cache then replays it on hydration, so the browser makes
 * no request of its own for the same data.
 */
@Component({
  selector: 'app-results',
  standalone: true,
  imports: [
    TranslatePipe,
    RouterLink,
    NgClass,
    LocalePathPipe,
    GamedayListComponent,
    StandingsTableComponent,
  ],
  templateUrl: './results.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ResultsComponent implements OnInit, OnDestroy {
  #meta = inject(MetaService);
  #sanitizer = inject(DomSanitizer);
  #platformId = inject(PLATFORM_ID);
  #route = inject(ActivatedRoute);
  #theme = inject(ThemeService);
  #language = inject(LanguageService);
  #results = inject(ResultsService);

  readonly tabs: readonly Tab[] = TABS;

  readonly #params = toSignal(this.#route.params, { initialValue: {} as Params });
  readonly #query = toSignal(this.#route.queryParams, { initialValue: {} as Params });

  readonly team = computed(() => teamBySlug(this.#params()['team']));
  readonly tab = computed<Tab>(() => tabFromParam(this.#params()['tab']));

  /** Which rendering this tab gets: ours, or the embedded widget. */
  readonly native = computed(() => isNative(this.tab(), this.#query()['native']));

  // ── Data ───────────────────────────────────────────────────────────────────

  /**
   * Each tab fetches only what it shows, and nothing at all while the widget is on screen.
   *
   * Tabs are separate URLs, so a visitor only ever sees one of them per page load; fetching the
   * other's data would be a request per view that nobody reads. `null` here means "not wanted",
   * which is distinct from a request that failed.
   */
  readonly #scheduleWanted = computed(() =>
    this.native() && this.tab() !== 'tabelle' ? this.team() : null
  );

  readonly #standingsWanted = computed(() =>
    this.native() && this.tab() === 'tabelle' ? this.team() : null
  );

  /**
   * `undefined` means still loading or not wanted, and `null` means the request failed, which the
   * template tells apart — an empty array is a legitimate answer ("no gamedays yet") and must not
   * read as an error.
   */
  readonly gamedays = toSignal(
    toObservable(this.#scheduleWanted).pipe(
      switchMap((team) => team === null
        ? of(undefined)
        : this.#results.gamedays(team.teamId).pipe(catchError(() => of(null)))),
    ),
    { initialValue: undefined },
  );

  readonly standings = toSignal(
    toObservable(this.#standingsWanted).pipe(
      switchMap((team) => team === null
        ? of(undefined)
        : this.#results.standings(team.leagueKey, team.season).pipe(catchError(() => of(null)))),
    ),
    { initialValue: undefined },
  );

  readonly teams = toSignal(
    toObservable(this.native).pipe(
      switchMap((native) => native
        ? this.#results.teams$.pipe(catchError(() => of(new Map<number, ResultsTeam>())))
        : of(new Map<number, ResultsTeam>())),
    ),
    { initialValue: new Map<number, ResultsTeam>() },
  );

  readonly #lastUpdatedAt = toSignal(
    toObservable(this.native).pipe(
      switchMap((native) => native
        ? this.#results.lastUpdatedAt().pipe(catchError(() => of(null)))
        : of(null)),
    ),
    { initialValue: null },
  );

  readonly updatedAtLabel = computed(() => {
    const at = this.#lastUpdatedAt();
    return at === null ? null : formatUpdatedAt(at, this.#language.getCurrentLang());
  });

  readonly scheduleFailed = computed(() => this.gamedays() === null);
  readonly standingsFailed = computed(() => this.standings() === null);

  // ── The widget, for whatever is not native yet ─────────────────────────────

  readonly iframeHeight = signal(MIN_HEIGHT);

  readonly iframeUrl = computed<SafeResourceUrl | null>(() => {
    if (this.native()) return null;

    const view = this.tab() === 'tabelle' ? 'table' : this.tab() === 'live' ? 'live' : 'spielplan';
    const id = this.team().teamId;
    // Read untracked: theme changes are pushed via postMessage instead of reloading the iframe.
    const theme = untracked(() => this.#theme.theme());
    return this.#sanitizer.bypassSecurityTrustResourceUrl(
      `${WIDGET_BASE}?t=${id}&view=${view}&color=${WIDGET_ACCENT_LIGHT}&color_dark=${WIDGET_ACCENT_DARK}&theme=${theme}`,
    );
  });

  readonly iframeRef = viewChild<ElementRef<HTMLIFrameElement>>('widgetIframe');

  readonly #syncWidgetTheme = effect(() => {
    const theme = this.#theme.theme();
    this.iframeRef()?.nativeElement.contentWindow?.postMessage(
      { type: 'setTheme', theme },
      WIDGET_ORIGIN,
    );
  });

  readonly #resetHeight = effect(() => {
    this.iframeUrl(); // track URL changes (team or tab switch)
    untracked(() => this.iframeHeight.set(MIN_HEIGHT));
  });

  // ── Meta ───────────────────────────────────────────────────────────────────

  readonly #updateMeta = effect(() => {
    const team = this.team();
    const tab = this.tab();
    this.#meta.updateMeta({
      titleKey: 'meta.results.title',
      descriptionKey: 'meta.results.description',
      path: `/ergebnisse/${team.slug}/${tab}`,
    });
  });

  /**
   * `SportsEvent` for the fixtures still to be played.
   *
   * Upcoming only: a schema.org event in the past is noise, and Google's own guidance is to mark
   * up what a visitor could still attend. A gameday rather than a game, because that is what has
   * a start time and a place — an individual game's kickoff shifts all day.
   */
  readonly #upcomingJsonLd = effect(() => {
    const gamedays = this.gamedays();
    const team = this.team();
    if (gamedays === undefined || gamedays === null) return;

    const upcoming = gamedays
      .filter((gameday) => gameday.phase !== 'past')
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 10);

    if (upcoming.length === 0) {
      this.#meta.removeJsonLd('results-events');
      return;
    }

    this.#meta.setJsonLd('results-events', upcoming.map((gameday) => ({
      '@context': 'https://schema.org',
      '@type': 'SportsEvent',
      name: `${gameday.leagueDisplay} — ${gameday.name}`,
      startDate: gameday.startTime === null
        ? gameday.date
        : `${gameday.date}T${gameday.startTime}:00`,
      eventStatus: 'https://schema.org/EventScheduled',
      // Only ever a real address: the sync stores null for "tba" and the like.
      ...(gameday.address === null ? {} : {
        location: { '@type': 'Place', name: gameday.address, address: gameday.address },
      }),
      competitor: {
        '@type': 'SportsTeam',
        name: 'Nürnberg Renegades',
        url: `${SITE_ORIGIN}/ergebnisse/${team.slug}/spielplan`,
      },
    })));
  });

  // ── postMessage plumbing for the widget ────────────────────────────────────

  readonly #messageHandler = (event: MessageEvent) => {
    if (event.origin !== WIDGET_ORIGIN) return;
    const { type, height } = event.data ?? {};
    if (type !== 'iframeHeight' || typeof height !== 'number') return;
    if (event.source === this.iframeRef()?.nativeElement.contentWindow) {
      this.iframeHeight.set(Math.max(height, MIN_HEIGHT));
    }
  };

  ngOnInit(): void {
    if (isPlatformBrowser(this.#platformId)) {
      window.addEventListener('message', this.#messageHandler);
    }
  }

  ngOnDestroy(): void {
    if (isPlatformBrowser(this.#platformId)) {
      window.removeEventListener('message', this.#messageHandler);
    }
    this.#meta.removeJsonLd('results-events');
  }
}
