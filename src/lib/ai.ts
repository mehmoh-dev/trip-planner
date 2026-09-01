/**
 * AI itinerary generation via the Google Gemini REST API.
 *
 * Model and key come from the environment (GEMINI_MODEL, GEMINI_API_KEY).
 * If the AI call is unavailable or fails, a deterministic fallback itinerary
 * is generated so the planner always returns something usable.
 */
import { env } from './env';

export type ItineraryDay = {
  day: number;
  title: string;
  activities: string[];
};

export type TripPreferences = {
  destination: string;
  startDate?: string | null;
  endDate?: string | null;
  travelers?: number;
  budget?: number | null;
  currency?: string;
  interests?: string; // free text, e.g. "food, hiking, museums"
  pace?: string; // relaxed | balanced | packed
};

export type GeneratedItinerary = {
  title: string;
  summary: string;
  days: ItineraryDay[];
  bookingSuggestions: string[];
  estimatedPrice: number;
  currency: string;
  source: 'gemini' | 'fallback';
};

function daysBetween(start?: string | null, end?: string | null): number {
  if (!start || !end) return 3;
  const s = new Date(start).getTime();
  const e = new Date(end).getTime();
  if (isNaN(s) || isNaN(e) || e < s) return 3;
  const diff = Math.round((e - s) / (1000 * 60 * 60 * 24)) + 1;
  return Math.min(Math.max(diff, 1), 14);
}

export function isAiConfigured(): boolean {
  return Boolean(env('GEMINI_API_KEY'));
}

export async function generateItinerary(prefs: TripPreferences): Promise<GeneratedItinerary> {
  const numDays = daysBetween(prefs.startDate, prefs.endDate);
  const currency = prefs.currency || 'USD';

  if (isAiConfigured()) {
    try {
      return await callGemini(prefs, numDays, currency);
    } catch (err) {
      console.error('Gemini generation failed, using fallback:', err);
    }
  }
  return fallbackItinerary(prefs, numDays, currency);
}

async function callGemini(
  prefs: TripPreferences,
  numDays: number,
  currency: string
): Promise<GeneratedItinerary> {
  const model = env('GEMINI_MODEL') || 'gemini-2.5-flash';
  const key = env('GEMINI_API_KEY') as string;
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model
  )}:generateContent`;

  const travelers = prefs.travelers ?? 1;
  const prompt = [
    `You are an expert travel planner. Create a personalized ${numDays}-day trip itinerary.`,
    `Destination: ${prefs.destination}.`,
    prefs.startDate && prefs.endDate ? `Dates: ${prefs.startDate} to ${prefs.endDate}.` : '',
    `Travelers: ${travelers}.`,
    prefs.budget ? `Budget: about ${prefs.budget} ${currency} per person.` : '',
    prefs.interests ? `Interests: ${prefs.interests}.` : '',
    prefs.pace ? `Preferred pace: ${prefs.pace}.` : '',
    `Estimate a realistic total price PER PERSON in ${currency} covering typical accommodation, activities and local transport (exclude international flights).`,
    `Return concise, practical activities. Include 3-6 booking suggestions (hotels, tours, transport, passes).`,
  ]
    .filter(Boolean)
    .join(' ');

  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.8,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          summary: { type: 'string' },
          estimatedPricePerPerson: { type: 'number' },
          currency: { type: 'string' },
          days: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                day: { type: 'integer' },
                title: { type: 'string' },
                activities: { type: 'array', items: { type: 'string' } },
              },
              required: ['day', 'title', 'activities'],
            },
          },
          bookingSuggestions: { type: 'array', items: { type: 'string' } },
        },
        required: ['title', 'summary', 'days', 'bookingSuggestions', 'estimatedPricePerPerson'],
      },
    },
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Gemini API ${res.status}: ${detail.slice(0, 200)}`);
  }

  const data = (await res.json()) as any;
  const textPart = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!textPart) throw new Error('Gemini returned no content');

  const parsed = JSON.parse(textPart);
  const days: ItineraryDay[] = Array.isArray(parsed.days)
    ? parsed.days.map((d: any, i: number) => ({
        day: Number(d.day) || i + 1,
        title: String(d.title || `Day ${i + 1}`),
        activities: Array.isArray(d.activities) ? d.activities.map(String) : [],
      }))
    : [];

  const price = Number(parsed.estimatedPricePerPerson);

  return {
    title: String(parsed.title || `${prefs.destination} adventure`),
    summary: String(parsed.summary || ''),
    days: days.length ? days : fallbackItinerary(prefs, numDays, currency).days,
    bookingSuggestions: Array.isArray(parsed.bookingSuggestions)
      ? parsed.bookingSuggestions.map(String)
      : [],
    estimatedPrice: isFinite(price) && price > 0 ? Math.round(price) : estimatePrice(numDays, prefs.budget),
    currency: String(parsed.currency || currency),
    source: 'gemini',
  };
}

function estimatePrice(numDays: number, budget?: number | null): number {
  if (budget && budget > 0) return Math.round(budget);
  // Rough default: ~150 currency units per day.
  return numDays * 150;
}

function fallbackItinerary(
  prefs: TripPreferences,
  numDays: number,
  currency: string
): GeneratedItinerary {
  const interests = (prefs.interests || 'sightseeing, local food, culture')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const templates = [
    (d: number) => ['Arrival and hotel check-in', `Explore central ${prefs.destination}`, 'Welcome dinner at a local restaurant'],
    (d: number) => [`Guided tour of ${prefs.destination} highlights`, interests[0] ? `Activity: ${interests[0]}` : 'Local market visit', 'Relaxed evening walk'],
    (d: number) => ['Day trip to a nearby attraction', interests[1] ? `Activity: ${interests[1]}` : 'Scenic viewpoint', 'Try regional cuisine'],
    (d: number) => ['Museum or cultural site', 'Shopping for souvenirs', 'Sunset spot'],
    (d: number) => ['Free morning / optional excursion', interests[2] ? `Activity: ${interests[2]}` : 'Cafe hopping', 'Farewell dinner'],
  ];

  const days: ItineraryDay[] = Array.from({ length: numDays }, (_, i) => {
    const isLast = i === numDays - 1;
    const activities = isLast
      ? ['Leisure morning', 'Last-minute shopping', 'Departure']
      : templates[Math.min(i, templates.length - 1)](i + 1);
    return {
      day: i + 1,
      title: isLast ? 'Departure day' : i === 0 ? 'Arrival & orientation' : `Discover ${prefs.destination}`,
      activities,
    };
  });

  return {
    title: `${numDays}-day ${prefs.destination} trip`,
    summary: `A personalized ${numDays}-day plan for ${prefs.destination}${
      interests.length ? ` focused on ${interests.join(', ')}` : ''
    }.`,
    days,
    bookingSuggestions: [
      `Book a centrally located hotel in ${prefs.destination}`,
      'Reserve a guided city tour for day 2',
      'Get a public transport day pass',
      'Book popular restaurants in advance',
    ],
    estimatedPrice: estimatePrice(numDays, prefs.budget),
    currency,
    source: 'fallback',
  };
}
