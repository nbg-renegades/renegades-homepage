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
