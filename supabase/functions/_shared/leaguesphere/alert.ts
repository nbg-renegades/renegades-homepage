/**
 * Tells a human when the results data has gone stale.
 *
 * Reuses the Resend setup the site's three form functions already use, so there is no new
 * service. The recipients are its own, `RESULTS_ALERT_EMAILS`, and deliberately not the forms'
 * `NOTIFICATION_EMAILS`: a stale sync is for whoever runs the site, not for the people who
 * answer contact requests. There is no fallback to those, so an unset secret sends nothing.
 *
 * A stale results page is not an outage: the site keeps serving the last good data and shows how
 * old it is. So this is a nudge, not a page — it is rate-limited to one mail per incident by
 * `results_sync_state.alerted_at`, and a failure to send is logged and swallowed rather than
 * failing the sync. Alerting must never be the reason the data stops updating.
 */

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

/** The verified sender the site's other functions already use. */
const FROM = 'Nürnberg Renegades <noreply@nuernberg-renegades.de>';

export interface StaleAlert {
  readonly lastOkAt: Date;
  readonly ageMs: number;
  readonly duringGameday: boolean;
  readonly lastError: string | null;
}

export interface AlertOptions {
  readonly fetchImpl?: typeof fetch;
  readonly log?: (message: string) => void;
}

/** True when a mail was accepted by Resend. */
export async function sendStaleDataAlert(
  alert: StaleAlert,
  options: AlertOptions = {},
): Promise<boolean> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const log = options.log ?? ((message: string) => console.log(message));

  const apiKey = Deno.env.get('RESEND_API_KEY');
  const recipients = (Deno.env.get('RESULTS_ALERT_EMAILS') ?? '')
    .split(',')
    .map((address) => address.trim())
    .filter((address) => address !== '');

  if (apiKey === undefined || apiKey === '' || recipients.length === 0) {
    // Worth saying out loud, because it means nobody is being told.
    log('[alert] RESEND_API_KEY or RESULTS_ALERT_EMAILS missing; not sending the stale-data alert');
    return false;
  }

  const hours = (alert.ageMs / 3_600_000).toFixed(1);
  const subject = alert.duringGameday
    ? `Renegades Ergebnisse: keine Aktualisierung seit ${hours} h — heute ist Spieltag`
    : `Renegades Ergebnisse: keine Aktualisierung seit ${hours} h`;

  // Plain text on purpose: there is no upstream content to render here, and nothing to escape.
  const lines = [
    'Die Ergebnis-Synchronisation mit LeagueSphere war zuletzt erfolgreich um',
    `  ${alert.lastOkAt.toISOString()} (vor ${hours} Stunden).`,
    '',
    alert.duringGameday
      ? 'Heute ist ein Spieltag, daher ist das ungewöhnlich lange.'
      : 'Heute ist kein Spieltag.',
    '',
    'Die Website zeigt weiterhin die letzten gültigen Daten mit dem Stand von oben.',
    '',
    alert.lastError === null
      ? 'Es ist kein Fehler gespeichert — die Funktion wurde vermutlich nicht ausgeführt.'
      : `Letzter gespeicherter Fehler:\n  ${alert.lastError}`,
    '',
    'Nachsehen: results_sync_state in Supabase, und die Logs der Edge Function',
    'sync-leaguesphere.',
  ];

  try {
    const response = await fetchImpl(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM,
        to: recipients,
        subject,
        text: lines.join('\n'),
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      // The body can echo request details, so only the status is logged.
      log(`[alert] Resend refused the stale-data alert: HTTP ${response.status}`);
      return false;
    }

    log(`[alert] stale-data alert sent to ${recipients.length} recipient(s)`);
    return true;
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    log(`[alert] could not send the stale-data alert: ${message}`);
    return false;
  }
}
