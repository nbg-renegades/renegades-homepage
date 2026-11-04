import { escapeHtml, escapeMultiline } from '../_shared/html.ts';

export interface ContactMessage {
  name: string;
  email: string;
  subject: string;
  message: string;
}

export function contactEmailHtml(message: ContactMessage): string {
  return `
    <h2>New Contact Form Submission</h2>
    <p><strong>From:</strong> ${escapeHtml(message.name)} (${escapeHtml(message.email)})</p>
    <p><strong>Subject:</strong> ${escapeHtml(message.subject)}</p>
    <p><strong>Message:</strong></p>
    <p>${escapeMultiline(message.message)}</p>
  `;
}
