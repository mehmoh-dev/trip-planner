import nodemailer from 'nodemailer';
import type { Trip } from './db';
import { env } from './env';

/**
 * Gmail notification layer using an App Password over SMTP.
 * All credentials come from the environment; nothing is hardcoded.
 */

export function isMailConfigured(): boolean {
  return Boolean(env('GMAIL_USER') && env('GMAIL_APP_PASSWORD'));
}

export class MailNotConfiguredError extends Error {
  constructor() {
    super('Email is not configured. Set GMAIL_USER and GMAIL_APP_PASSWORD.');
    this.name = 'MailNotConfiguredError';
  }
}

function getTransporter() {
  if (!isMailConfigured()) throw new MailNotConfiguredError();
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: env('GMAIL_USER'),
      pass: env('GMAIL_APP_PASSWORD'),
    },
  });
}

const siteName = () => env('PUBLIC_SITE_NAME') || 'AI Trip Planner';

export type SendResult = { sent: number; failed: number; total: number };

/**
 * Sends one email per recipient (each as an undisclosed BCC-style individual
 * send so recipients don't see each other). Returns a delivery summary.
 */
export async function sendToMany(
  recipients: string[],
  subject: string,
  html: string,
  text: string
): Promise<SendResult> {
  const transporter = getTransporter();
  const from = `${siteName()} <${env('GMAIL_USER')}>`;
  let sent = 0;
  let failed = 0;

  // Send sequentially in small batches to stay within Gmail limits.
  for (const to of recipients) {
    try {
      await transporter.sendMail({ from, to, subject, html, text });
      sent++;
    } catch {
      failed++;
    }
  }
  return { sent, failed, total: recipients.length };
}

function currencyFmt(price: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(price);
  } catch {
    return `${currency} ${price.toFixed(2)}`;
  }
}

/** Builds the "new trip" announcement email from live trip data. */
export function buildTripEmail(trip: Trip): { subject: string; html: string; text: string } {
  const price = currencyFmt(Number(trip.price) || 0, trip.currency || 'USD');
  const dates =
    trip.start_date && trip.end_date
      ? `${trip.start_date} to ${trip.end_date}`
      : 'Flexible dates';

  const itinerary = Array.isArray(trip.itinerary) ? (trip.itinerary as any[]) : [];
  const itineraryHtml = itinerary
    .map(
      (d: any) =>
        `<li><strong>Day ${d.day ?? ''}: ${escapeHtml(d.title ?? '')}</strong>${
          Array.isArray(d.activities) && d.activities.length
            ? `<br/><span style="color:#555">${escapeHtml(d.activities.join(' • '))}</span>`
            : ''
        }</li>`
    )
    .join('');

  const bookings = Array.isArray(trip.booking_suggestions)
    ? (trip.booking_suggestions as string[])
    : [];
  const bookingsHtml = bookings.map((b) => `<li>${escapeHtml(b)}</li>`).join('');

  const subject = `New trip: ${trip.title} — ${trip.destination} (${price})`;

  const html = `
  <div style="font-family:Inter,Arial,sans-serif;max-width:600px;margin:auto;color:#111">
    <h2 style="margin:0 0 4px">${escapeHtml(trip.title)}</h2>
    <p style="margin:0 0 12px;color:#555">${escapeHtml(trip.destination)} · ${escapeHtml(dates)} · ${escapeHtml(
      String(trip.travelers)
    )} traveler(s)</p>
    <p style="font-size:20px;font-weight:700;color:#3245ff;margin:0 0 12px">${price} per person</p>
    ${trip.summary ? `<p>${escapeHtml(trip.summary)}</p>` : ''}
    ${itineraryHtml ? `<h3>Itinerary</h3><ul>${itineraryHtml}</ul>` : ''}
    ${bookingsHtml ? `<h3>Booking suggestions</h3><ul>${bookingsHtml}</ul>` : ''}
    <hr style="border:none;border-top:1px solid #eee;margin:20px 0"/>
    <p style="color:#888;font-size:12px">You are receiving this because you subscribed to ${escapeHtml(
      siteName()
    )} trip updates.</p>
  </div>`;

  const textLines = [
    trip.title,
    `${trip.destination} · ${dates} · ${trip.travelers} traveler(s)`,
    `${price} per person`,
    trip.summary || '',
    ...itinerary.map(
      (d: any) =>
        `Day ${d.day ?? ''}: ${d.title ?? ''}${
          Array.isArray(d.activities) ? ' - ' + d.activities.join(', ') : ''
        }`
    ),
    ...(bookings.length ? ['Booking suggestions:', ...bookings.map((b) => `- ${b}`)] : []),
  ].filter(Boolean);

  return { subject, html, text: textLines.join('\n') };
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
