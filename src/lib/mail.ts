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
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(price);
  } catch {
    return `${currency} ${Math.round(price)}`;
  }
}

// Shared email palette (kept in sync with the site).
const MAIL = {
  ink: '#14282f',
  soft: '#33525d',
  muted: '#6d8189',
  teal: '#0f766e',
  accent: '#c1502c',
  sand: '#faf7f1',
  line: '#e7e0d4',
};

/** Wraps content in a clean, email-client-safe shell with header + footer. */
function shell(previewText: string, bodyInner: string): string {
  const name = siteName();
  return `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;background:${MAIL.sand};font-family:Arial,Helvetica,sans-serif;color:${MAIL.ink};">
<span style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(previewText)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${MAIL.sand};padding:28px 12px;">
  <tr><td align="center">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:560px;max-width:100%;background:#ffffff;border:1px solid ${MAIL.line};border-radius:16px;overflow:hidden;">
      <tr><td style="background:${MAIL.teal};padding:20px 28px;">
        <span style="color:#ffffff;font-family:Georgia,'Times New Roman',serif;font-size:20px;font-weight:bold;">${escapeHtml(name)}</span>
      </td></tr>
      <tr><td style="padding:28px;">${bodyInner}</td></tr>
      <tr><td style="padding:18px 28px;border-top:1px solid ${MAIL.line};background:#fbfaf7;">
        <p style="margin:0;color:${MAIL.muted};font-size:12px;line-height:1.5;">
          You're receiving this because you subscribed to ${escapeHtml(name)} trip updates.<br/>
          Not interested anymore? Just reply and let us know.
        </p>
      </td></tr>
    </table>
    <p style="color:${MAIL.muted};font-size:11px;margin:16px 0 0;">© ${new Date().getFullYear()} ${escapeHtml(name)}</p>
  </td></tr>
</table></body></html>`;
}

/** Builds the "new trip" announcement email from live trip data. */
export function buildTripEmail(trip: Trip): { subject: string; html: string; text: string } {
  const price = currencyFmt(Number(trip.price) || 0, trip.currency || 'USD');
  const dates = trip.start_date && trip.end_date ? `${trip.start_date} – ${trip.end_date}` : 'Flexible dates';

  const itinerary = Array.isArray(trip.itinerary) ? (trip.itinerary as any[]) : [];
  const itineraryHtml = itinerary
    .map(
      (d: any) => `
      <tr><td style="padding:10px 0;border-bottom:1px solid ${MAIL.line};">
        <span style="display:inline-block;min-width:54px;color:${MAIL.accent};font-size:11px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;">Day ${escapeHtml(String(d.day ?? ''))}</span>
        <span style="font-weight:bold;color:${MAIL.ink};">${escapeHtml(d.title ?? '')}</span>
        ${Array.isArray(d.activities) && d.activities.length ? `<div style="color:${MAIL.soft};font-size:14px;margin-top:4px;">${escapeHtml(d.activities.join(' · '))}</div>` : ''}
      </td></tr>`
    )
    .join('');

  const bookings = Array.isArray(trip.booking_suggestions) ? (trip.booking_suggestions as string[]) : [];
  const bookingsHtml = bookings
    .map((b) => `<li style="margin-bottom:6px;color:${MAIL.soft};">${escapeHtml(b)}</li>`)
    .join('');

  const subject = `New trip: ${trip.title} — ${trip.destination}`;

  const inner = `
    <p style="margin:0 0 6px;color:${MAIL.teal};font-size:12px;font-weight:bold;letter-spacing:1.5px;text-transform:uppercase;">New trip published</p>
    <h1 style="margin:0 0 8px;font-family:Georgia,'Times New Roman',serif;font-size:26px;font-weight:normal;color:${MAIL.ink};">${escapeHtml(trip.title)}</h1>
    <p style="margin:0 0 18px;color:${MAIL.muted};font-size:14px;">${escapeHtml(trip.destination)} &nbsp;·&nbsp; ${escapeHtml(dates)} &nbsp;·&nbsp; ${escapeHtml(String(trip.travelers))} traveler(s)</p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px;">
      <tr><td style="background:${MAIL.sand};border:1px solid ${MAIL.line};border-radius:12px;padding:14px 18px;">
        <span style="color:${MAIL.muted};font-size:12px;">From</span>
        <span style="font-family:Georgia,serif;font-size:24px;color:${MAIL.accent};font-weight:bold;">&nbsp;${price}</span>
        <span style="color:${MAIL.muted};font-size:12px;"> per person</span>
      </td></tr>
    </table>
    ${trip.summary ? `<p style="margin:0 0 22px;color:${MAIL.soft};font-size:15px;line-height:1.6;">${escapeHtml(trip.summary)}</p>` : ''}
    ${itineraryHtml ? `<h2 style="font-family:Georgia,serif;font-size:18px;font-weight:normal;margin:0 0 8px;color:${MAIL.ink};">Your day-by-day plan</h2><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${itineraryHtml}</table>` : ''}
    ${bookingsHtml ? `<h2 style="font-family:Georgia,serif;font-size:18px;font-weight:normal;margin:24px 0 8px;color:${MAIL.ink};">Where to book</h2><ul style="margin:0;padding-left:18px;font-size:14px;">${bookingsHtml}</ul>` : ''}
  `;

  const textLines = [
    `New trip: ${trip.title}`,
    `${trip.destination} · ${dates} · ${trip.travelers} traveler(s)`,
    `From ${price} per person`,
    '',
    trip.summary || '',
    '',
    ...itinerary.map((d: any) => `Day ${d.day ?? ''}: ${d.title ?? ''}${Array.isArray(d.activities) ? ' — ' + d.activities.join(', ') : ''}`),
    ...(bookings.length ? ['', 'Where to book:', ...bookings.map((b) => `- ${b}`)] : []),
  ].filter((l) => l !== undefined);

  return { subject, html: shell(`${trip.title} — ${trip.destination}, from ${price}`, inner), text: textLines.join('\n') };
}

/** Friendly confirmation email sent when someone subscribes. */
export function buildWelcomeEmail(): { subject: string; html: string; text: string } {
  const name = siteName();
  const subject = `You're on the list — welcome to ${name}`;
  const inner = `
    <p style="margin:0 0 6px;color:${MAIL.teal};font-size:12px;font-weight:bold;letter-spacing:1.5px;text-transform:uppercase;">Welcome aboard</p>
    <h1 style="margin:0 0 12px;font-family:Georgia,serif;font-size:26px;font-weight:normal;color:${MAIL.ink};">Thanks for subscribing!</h1>
    <p style="margin:0 0 16px;color:${MAIL.soft};font-size:15px;line-height:1.6;">
      You'll be the first to hear whenever we publish a new trip — complete with a day-by-day
      itinerary, an honest price, and tips on where to book.
    </p>
    <p style="margin:0 0 22px;color:${MAIL.soft};font-size:15px;line-height:1.6;">
      In the meantime, why not plan something of your own? It takes about a minute.
    </p>
    <a href="#" style="display:inline-block;background:${MAIL.accent};color:#ffffff;text-decoration:none;font-weight:bold;font-size:15px;padding:12px 22px;border-radius:10px;">Plan a trip</a>
  `;
  const text = `Thanks for subscribing to ${name}!\n\nYou'll be the first to hear whenever we publish a new trip — with a day-by-day itinerary, an honest price, and where to book.\n\nIn the meantime, plan something of your own. It only takes a minute.`;
  return { subject, html: shell(`Welcome to ${name}`, inner), text };
}

/** Sends a single email (best-effort). Returns success. */
export async function sendOne(to: string, subject: string, html: string, text: string): Promise<boolean> {
  try {
    const transporter = getTransporter();
    await transporter.sendMail({ from: `${siteName()} <${env('GMAIL_USER')}>`, to, subject, html, text });
    return true;
  } catch {
    return false;
  }
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
