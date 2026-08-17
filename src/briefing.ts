/**
 * Daily briefing composer.
 * Gathers: weather (Open-Meteo, no key), top tech/AI news (Hacker News),
 * and your portfolio's public view counter. DeepSeek turns it into a warm
 * morning brief; if the AI brain is off, a plain template is used.
 */
import { config, hasDeepSeek } from './config.ts';
import { summarize } from './deepseek.ts';

const WMO: Record<number, string> = {
  0: 'clear sky',
  1: 'mainly clear',
  2: 'partly cloudy',
  3: 'overcast',
  45: 'fog',
  48: 'rime fog',
  51: 'light drizzle',
  53: 'moderate drizzle',
  55: 'dense drizzle',
  56: 'freezing drizzle',
  57: 'dense freezing drizzle',
  61: 'light rain',
  63: 'moderate rain',
  65: 'heavy rain',
  66: 'freezing rain',
  67: 'heavy freezing rain',
  71: 'light snow',
  73: 'moderate snow',
  75: 'heavy snow',
  77: 'snow grains',
  80: 'light showers',
  81: 'moderate showers',
  82: 'violent showers',
  85: 'light snow showers',
  86: 'heavy snow showers',
  95: 'thunderstorm',
  96: 'thunderstorm with hail',
  99: 'thunderstorm with heavy hail',
};

export interface NewsItem {
  title: string;
  url?: string;
}

const PORTFOLIO_VIEWS_URL = 'https://portfolio-elalcazarjr.vercel.app/api/views';

async function fetchWeather(): Promise<string> {
  try {
    const url =
      'https://api.open-meteo.com/v1/forecast' +
      `?latitude=${config.weather.lat}&longitude=${config.weather.lon}` +
      '&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m' +
      '&daily=temperature_2m_max,temperature_2m_min' +
      `&timezone=${encodeURIComponent(config.timezone)}&forecast_days=1`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`weather ${res.status}`);
    const j = (await res.json()) as {
      current?: { temperature_2m?: number; apparent_temperature?: number; weather_code?: number; wind_speed_10m?: number };
      daily?: { temperature_2m_max?: number[]; temperature_2m_min?: number[] };
    };
    const c = j.current ?? {};
    const d = j.daily ?? {};
    const code = c.weather_code ?? 0;
    const parts = [
      `${WMO[code] ?? 'fair weather'}`,
      `~${Math.round(c.temperature_2m ?? 0)}°C`,
      `high ${Math.round(d.temperature_2m_max?.[0] ?? 0)}° / low ${Math.round(d.temperature_2m_min?.[0] ?? 0)}°`,
    ];
    if (c.wind_speed_10m && c.wind_speed_10m > 15) parts.push(`wind ${Math.round(c.wind_speed_10m)} km/h`);
    return parts.join(', ');
  } catch (e) {
    console.error('weather failed:', e);
    return 'weather unavailable right now';
  }
}

async function fetchNews(): Promise<NewsItem[]> {
  try {
    const res = await fetch(
      'https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=6',
      { signal: AbortSignal.timeout(15000) }
    );
    if (!res.ok) throw new Error(`news ${res.status}`);
    const j = (await res.json()) as { hits?: { title?: string; url?: string }[] };
    return (j.hits ?? [])
      .filter((h) => h.title)
      .slice(0, 5)
      .map((h) => ({ title: h.title as string, url: h.url }));
  } catch (e) {
    console.error('news failed:', e);
    return [];
  }
}

async function fetchPortfolioViews(): Promise<{ today: number; total: number }> {
  try {
    const res = await fetch(PORTFOLIO_VIEWS_URL, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`views ${res.status}`);
    const j = (await res.json()) as { total?: number; today?: number };
    return { today: Number(j.today) || 0, total: Number(j.total) || 0 };
  } catch (e) {
    console.error('views failed:', e);
    return { today: 0, total: 0 };
  }
}

function dateLabel(): string {
  return new Intl.DateTimeFormat('en-PH', {
    timeZone: config.timezone,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(new Date());
}

/** Full briefing text. Fails soft: always returns something sendable. */
export async function generateBriefing(): Promise<string> {
  const [weather, news, views] = await Promise.all([
    fetchWeather(),
    fetchNews(),
    fetchPortfolioViews(),
  ]);

  const newsBlock =
    news.length > 0
      ? news.map((n, i) => `${i + 1}. ${n.title}${n.url ? ` — ${n.url}` : ''}`).join('\n')
      : 'No headlines found this morning.';

  const facts = {
    date: dateLabel(),
    city: config.weather.city,
    weather,
    newsBlock,
    viewsToday: views.today,
    viewsTotal: views.total,
  };

  if (hasDeepSeek()) {
    try {
      const prompt = [
        `Today is ${facts.date}. Write a short, warm morning briefing for a busy person in ${facts.city}.`,
        `Weather: ${facts.weather}.`,
        `Top tech/AI headlines:\n${facts.newsBlock}`,
        `Personal stat: their portfolio got ${facts.viewsToday} visits today (${facts.viewsTotal} total).`,
        'Keep it under 200 words, plain language (no jargon), short bullet points, end with one encouraging line. Sign it "— Rush".',
      ].join('\n');
      const text = await summarize(prompt, 500);
      if (text.trim()) return text.trim();
    } catch (e) {
      console.error('briefing AI failed, using template:', e);
    }
  }

  // No-AI fallback template
  return [
    `☀️ *Morning brief — ${facts.date}*`,
    '',
    `🌤 Weather (${facts.city}): ${facts.weather}`,
    '',
    `📰 Tech & AI headlines:\n${facts.newsBlock}`,
    '',
    `📊 Your portfolio: ${facts.viewsToday} visits today (${facts.viewsTotal} total).`,
    '',
    'Have a great day! — Rush',
  ].join('\n');
}
