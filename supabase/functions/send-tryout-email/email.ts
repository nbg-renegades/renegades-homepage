import { escapeHtml, escapeMultiline } from '../_shared/html.ts';

export interface TryoutRequest {
  name: string;
  email: string;
  phone: string;
  age: string;
  experience: string;
  message: string;
}

export function tryoutEmailHtml(request: TryoutRequest): string {
  return `
    <h2>New Tryout Request</h2>
    <p><strong>From:</strong> ${escapeHtml(request.name)} (${escapeHtml(request.email)})</p>
    <p><strong>Phone:</strong> ${escapeHtml(request.phone)}</p>
    <p><strong>Age:</strong> ${escapeHtml(request.age)}</p>
    <p><strong>Experience:</strong> ${escapeHtml(request.experience)}</p>
    <p><strong>Message:</strong></p>
    <p>${escapeMultiline(request.message)}</p>
  `;
}
