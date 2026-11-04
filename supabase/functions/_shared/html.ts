/**
 * Escapes text for an HTML mail body. Everything a visitor types into a form goes into a mail
 * the club receives from its own address, so unescaped it could carry links or fake content.
 */
export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** Escapes a multi-line text and keeps its line breaks. */
export function escapeMultiline(value: string): string {
  return escapeHtml(value).replace(/\n/g, '<br>');
}
