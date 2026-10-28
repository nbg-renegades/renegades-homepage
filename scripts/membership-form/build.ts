/**
 * Turns the Vorstand's Mitgliedsantrag into the fillable template the membership function uses.
 *
 * The form is maintained in Word and exported to PDF, and that export has no form fields. This
 * adds them at fixed positions, so a new revision of the form is a rerun instead of an afternoon
 * in Acrobat:
 *
 *   deno run --config supabase/functions/deno.json --allow-read --allow-write \
 *     scripts/membership-form/build.ts
 *
 * It needs the functions' deno.json because the repo root's package.json makes Deno look for
 * pdf-lib in node_modules instead of resolving the npm: specifier itself.
 *
 * The positions below are measured against Mitgliedsantrag_26-10.source.pdf. If the Word layout
 * changes, re-measure them (pdfjs `getTextContent()` gives every label's baseline), rebuild, and
 * fill a test copy to check every value lands on its line. Field names are what
 * `send-membership-application/pdf.ts` fills by, and its test fails if one goes missing.
 */

import { PDFDocument, PDFPage, rgb, TextAlignment } from 'npm:pdf-lib@1.17.1';

const SOURCE = new URL('./Mitgliedsantrag_26-10.source.pdf', import.meta.url);
const TARGET = new URL('../../src/assets/forms/Mitgliedsantrag_26-10.pdf', import.meta.url);

interface Field {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Paints over what is underneath, e.g. the dotted date line, which would otherwise show through. */
  opaque?: boolean;
  align?: TextAlignment;
  fontSize?: number;
}

/** A text field sitting on the line of a label whose baseline is at `baseline`. */
function line(name: string, x: number, width: number, baseline: number): Field {
  return { name, x, y: baseline - 3, width, height: 15 };
}

/**
 * One centred single-character field per printed box, `${name}_1` … `${name}_n`, plus a plain
 * `name` field across the whole row for a value with more characters than there are boxes.
 *
 * `bars` are the x positions pdfjs reports for the "I" glyphs the form uses as dividers; the
 * visible stroke is the middle of the glyph. The boxes are not all the same width (the IBAN's
 * third is 4pt wider), which is why this is not a single comb field: its cells are uniform,
 * and the drift left characters pressed against a bar, where a 1 reads as part of it.
 */
function boxes(name: string, start: number, bars: number[], barWidth: number, baseline: number) {
  const strokes = [start, ...bars.map((x) => x + barWidth / 2)];
  const cells = strokes.slice(1).map((end, i): Field => ({
    ...line(`${name}_${i + 1}`, strokes[i], end - strokes[i], baseline),
    align: TextAlignment.Center,
    fontSize: 11,
  }));
  // To the far edge of the last divider, so the opaque row field covers it completely.
  const end = bars[bars.length - 1] + barWidth;
  // Opaque, or the dividers would run through the text; the filler removes it when unused.
  return [{ ...line(name, start, end - start, baseline), fontSize: 11, opaque: true }, ...cells];
}

const BIC_BARS = [391.4, 406.7, 422.2, 437.4, 452.9, 468.2, 483.7, 498.9, 516.0, 531.2, 546.7];
const IBAN_BARS = [
  104.3, 124.0, 147.6, 167.3, 187.1, 206.8, 226.6, 246.3, 266.1, 285.9, 305.4,
  325.1, 344.9, 364.6, 384.4, 404.2, 423.7, 443.7, 463.4, 482.9, 502.7, 522.5,
];

/** The □ in front of each membership type; filled with an X. */
function typeBox(name: string, baseline: number): Field {
  return {
    name,
    x: 61.2,
    y: baseline - 1,
    width: 11.3,
    height: 11,
    align: TextAlignment.Center,
  };
}

// Baselines of the left-hand labels (Name:, geb. am:, …); the right column shares them.
const ROWS = { name: 573.7, birth: 552.9, job: 532.6, street: 512.4, tel: 492.1, mobile: 472.6 };
const LEFT = { x: 102, width: 176 };
const RIGHT = { x: 363, width: 192 };

const FIELDS: Field[] = [
  typeBox('membership_adult', 702.2),
  typeBox('membership_youth', 680.5),
  typeBox('membership_support', 659.0),

  line('name', LEFT.x, LEFT.width, ROWS.name),
  line('firstname', RIGHT.x, RIGHT.width, ROWS.name),
  line('birthday', LEFT.x, LEFT.width, ROWS.birth),
  line('birthplace', RIGHT.x, RIGHT.width, ROWS.birth),
  line('profession', LEFT.x, LEFT.width, ROWS.job),
  line('nationality', RIGHT.x, RIGHT.width, ROWS.job),
  line('street', LEFT.x, LEFT.width, ROWS.street),
  line('plz_town', RIGHT.x, RIGHT.width, ROWS.street),
  line('tel', LEFT.x, LEFT.width, ROWS.tel),
  line('fax', RIGHT.x, RIGHT.width, ROWS.tel),
  line('mobile', LEFT.x, LEFT.width, ROWS.mobile),
  line('email', RIGHT.x, RIGHT.width, ROWS.mobile),

  // "zum 01 ............ , 20……": the month goes over the dots, the year's last two digits
  // over the ellipsis after "20".
  { ...line('joindate_month', 228, 58, 403.9), opaque: true, align: TextAlignment.Center },
  { ...line('joindate_year', 307, 22, 403.9), opaque: true },

  // "Kontoinhaber: (Vorname) ____ (Nachname) ____". The previous template had these two the
  // other way round, so the surname was printed in the first-name slot.
  line('sepa_account_holder_firstname', 173, 148, 283.6),
  line('sepa_account_holder_name', 376, 179, 283.6),
  line('sepa_bank', 124, 228, 260.6),
  // 11 boxes for the BIC, 22 for a German IBAN; each row starts just after its label.
  ...boxes('sepa_bic', 377.5, BIC_BARS, 3.1, 260.6),
  ...boxes('sepa_iban', 86, IBAN_BARS, 3.9, 234.1),
];

const pdf = await PDFDocument.load(await Deno.readFile(SOURCE));
const page: PDFPage = pdf.getPage(0);
const form = pdf.getForm();

for (const f of FIELDS) {
  const field = form.createTextField(f.name);
  field.addToPage(page, {
    x: f.x,
    y: f.y,
    width: f.width,
    height: f.height,
    textColor: rgb(0, 0, 0),
    // pdf-lib defaults to a white box with a black border; the form already draws its lines.
    // The colour has to go too: a border of width 0 is still drawn, as a hairline.
    backgroundColor: f.opaque ? rgb(1, 1, 1) : undefined,
    borderColor: undefined,
    borderWidth: 0,
  });
  field.setFontSize(f.fontSize ?? 12);
  if (f.align !== undefined) field.setAlignment(f.align);
}

await Deno.writeFile(TARGET, await pdf.save());
console.log(`wrote ${FIELDS.length} fields to ${TARGET.pathname}`);
