/** What a form field can arrive as: a number input sends a number, a reset form sends null. */
export type FormValue = string | number | null | undefined;

/**
 * Escapes text for an HTML mail body. Everything a visitor types into a form goes into a mail
 * the club receives from its own address, so unescaped it could carry links or fake content.
 *
 * Takes more than strings because the browser does not send only strings, and a field that
 * threw here would fail the whole request. A missing value comes out empty.
 */
export function escapeHtml(value: FormValue): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** Escapes a multi-line text and keeps its line breaks. */
export function escapeMultiline(value: FormValue): string {
  return escapeHtml(value).replace(/\n/g, '<br>');
}
