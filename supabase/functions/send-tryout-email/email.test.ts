import { assert, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts';

import { tryoutEmailHtml } from './email.ts';

const request = {
  name: 'Max Muster',
  email: 'max@example.com',
  phone: '0911 123456',
  age: '24',
  experience: 'Keine',
  message: 'Hallo,\nich komme Dienstag.',
};

Deno.test('form input cannot add markup to the mail', () => {
  const html = tryoutEmailHtml({
    ...request,
    name: '<a href="https://evil.example">Passwort zurücksetzen</a>',
    phone: '<img src=x>',
    age: '"><b>',
    experience: '<i>x</i>',
    message: '<script>alert(1)</script>',
  });

  // Anything the sender types lands in the club's inbox from our own address, so a link
  // here would read as one the club sent.
  for (const tag of ['<a ', '<img', '<b>', '<i>', '<script']) {
    assert(!html.includes(tag), `${tag} in ${html}`);
  }
  assertStringIncludes(html, '&lt;a href=&quot;https://evil.example&quot;&gt;');
});

Deno.test('line breaks in the message still show as line breaks', () => {
  const html = tryoutEmailHtml({ ...request, message: 'a < b\nc' });
  assertStringIncludes(html, 'a &lt; b<br>c');
});

Deno.test('the plain fields come through unchanged', () => {
  const html = tryoutEmailHtml(request);
  assertStringIncludes(html, 'Max Muster (max@example.com)');
  assertStringIncludes(html, '0911 123456');
});

Deno.test('a typed age arrives as a number and still makes it into the mail', () => {
  // The age input is type="number", so Angular sends 24, not '24'.
  const html = tryoutEmailHtml({ ...request, age: 24 });
  assertStringIncludes(html, '<strong>Age:</strong> 24</p>');
});

Deno.test('fields the form sends as null come out empty', () => {
  // A cleared number input is null, and so is every optional field after form.reset().
  const html = tryoutEmailHtml({
    ...request,
    phone: null,
    age: null,
    experience: null,
    message: null,
  });
  assertStringIncludes(html, '<strong>Phone:</strong> </p>');
  assertStringIncludes(html, '<strong>Age:</strong> </p>');
  assert(!html.includes('null'), html);
});
