import { assert, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts';

import { contactEmailHtml } from './email.ts';

const message = {
  name: 'Max Muster',
  email: 'max@example.com',
  subject: 'Training',
  message: 'Hallo,\nwann ist Training?',
};

Deno.test('form input cannot add markup to the mail', () => {
  const html = contactEmailHtml({
    ...message,
    name: '<a href="https://evil.example">Passwort zurücksetzen</a>',
    subject: '<img src=x>',
    message: '<script>alert(1)</script>',
  });

  // Anything the sender types lands in the club's inbox from our own address, so a link
  // here would read as one the club sent.
  assert(!html.includes('<a '), html);
  assert(!html.includes('<img'), html);
  assert(!html.includes('<script'), html);
  assertStringIncludes(html, '&lt;a href=&quot;https://evil.example&quot;&gt;');
});

Deno.test('line breaks in the message still show as line breaks', () => {
  const html = contactEmailHtml({ ...message, message: 'a < b\nc' });
  assertStringIncludes(html, 'a &lt; b<br>c');
});

Deno.test('the plain fields come through unchanged', () => {
  const html = contactEmailHtml(message);
  assertStringIncludes(html, 'Max Muster (max@example.com)');
  assertStringIncludes(html, 'Training');
});
