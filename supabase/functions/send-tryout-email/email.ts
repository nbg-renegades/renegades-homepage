import { escapeHtml, escapeMultiline, type FormValue } from '../_shared/html.ts';

/**
 * As the form sends it, not as the frontend's interface claims: the age input is
 * `type="number"`, so Angular sends a number, and an optional field the form has reset is null.
 */
export interface TryoutRequest {
  name: string;
  email: string;
  phone: FormValue;
  age: FormValue;
  experience: FormValue;
  message: FormValue;
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
