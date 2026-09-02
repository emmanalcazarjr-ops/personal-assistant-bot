/**
 * Daily Briefing Composer (7:00 AM & 7:00 PM Editions).
 *
 * Gathers:
 * 1. Weather (Open-Meteo for Manila)
 * 2. AI News: Gemini, Google DeepMind, Agentic AI, and top developer tooling
 * 3. Daily Catholic Gospel & 1-sentence reflection (Morning)
 * 4. Calorie intake & macros vs 1,850 kcal daily cap
 * 5. Active Antigravity Curation Queue to-dos & Reminders
 * 6. Formatted in bulletproof Telegram HTML.
 */
import { config, hasGemini } from './config.ts';
import { chatCompletion } from './gemini.ts';
import * as vault from './vault.ts';

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
  source?: string;
  points?: number;
}

const PORTFOLIO_VIEWS_URL = 'https://portfolio-elalcazarjr.vercel.app/api/views';

function escapeHtml(str: string): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function renderProgressBar(current: number, target: number = 1850): string {
  const pct = Math.min(100, Math.max(0, Math.round((current / target) * 100)));
  const filled = Math.round((pct / 100) * 10);
  const empty = 10 - filled;
  return `<code>[${'■'.repeat(filled)}${'□'.repeat(empty)}]</code> ${pct}%`;
}

async function fetchWeather(): Promise<string> {
  try {
    const url =
      'https://api.open-meteo.com/v1/forecast' +
      `?latitude=${config.weather.lat}&longitude=${config.weather.lon}` +
      '&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m' +
      '&daily=temperature_2m_max,temperature_2m_min' +
      `&timezone=${encodeURIComponent(config.timezone)}&forecast_days=1`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
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

/**
 * Fetch Gemini-focused and LLM developer news from Hacker News.
 */
async function fetchAiNews(): Promise<NewsItem[]> {
  try {
    const query = encodeURIComponent('Gemini OR DeepMind OR "Agentic AI"');
    const geminiUrl = `https://hn.algolia.com/api/v1/search_by_date?query=${query}&tags=story&hitsPerPage=5`;
    const res = await fetch(geminiUrl, { signal: AbortSignal.timeout(5000) });

    let geminiHits: NewsItem[] = [];
    if (res.ok) {
      const j = (await res.json()) as { hits?: { title?: string; url?: string; points?: number }[] };
      geminiHits = (j.hits ?? [])
        .filter((h) => h.title)
        .map((h) => ({ title: h.title as string, url: h.url, source: 'Gemini / AI', points: h.points || 0 }));
    }

    const topUrl = 'https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=6';
    const topRes = await fetch(topUrl, { signal: AbortSignal.timeout(5000) });
    let topHits: NewsItem[] = [];
    if (topRes.ok) {
      const j = (await topRes.json()) as { hits?: { title?: string; url?: string; points?: number }[] };
      topHits = (j.hits ?? [])
        .filter((h) => h.title)
        .map((h) => ({ title: h.title as string, url: h.url, source: 'Tech Pulse', points: h.points || 0 }));
    }

    const combined = [...geminiHits.slice(0, 3), ...topHits.slice(0, 3)];
    return combined.slice(0, 3);
  } catch (e) {
    console.error('AI news fetch failed:', e);
    return [];
  }
}

async function fetchPortfolioViews(): Promise<{ today: number; total: number }> {
  try {
    const res = await fetch(PORTFOLIO_VIEWS_URL, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`views ${res.status}`);
    const j = (await res.json()) as { total?: number; today?: number };
    return { today: Number(j.today) || 0, total: Number(j.total) || 0 };
  } catch {
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

/** Short Gospel Reflection and Daily Prayer via Google Gemini */
async function fetchGospelReflection(dateStr: string): Promise<{ verse: string; reflection: string; prayer: string }> {
  if (hasGemini()) {
    try {
      const prompt = `You are a Catholic spiritual director. Provide a short Catholic Gospel verse for today (${dateStr}), a concise 1-sentence traditional spiritual reflection on faith, gratitude, love, and living with virtue, and a brief 1-sentence morning prayer.
Format as strict JSON without markdown formatting:
{"verse": "Book Chapter:Verse - 'Brief verse quote'", "reflection": "1 concise sentence spiritual reflection.", "prayer": "1 concise sentence morning prayer."}`;

      const res = await chatCompletion([
        { role: 'system', content: 'You are a Catholic spiritual director. Return valid JSON only.' },
        { role: 'user', content: prompt },
      ]);
      const clean = res.replace(/```json/g, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(clean);
      if (parsed.verse && parsed.reflection && parsed.prayer) return parsed;
    } catch (e) {
      console.error('Gospel reflection fetch failed:', e);
    }
  }
  return {
    verse: 'Matthew 5:16 — "Let your light shine before others, that they may see your good deeds and glorify your Father in heaven."',
    reflection: 'Live today with kindness, integrity, and faith, trusting in God’s grace through every moment.',
    prayer: 'Lord, grant me peace in my heart, wisdom in my actions, and the grace to walk in Your light today. Amen.',
  };
}

/** Full briefing text composer in Telegram HTML format */
export async function generateBriefing(explicitEdition?: 'morning' | 'evening'): Promise<string> {
  const isMorning = explicitEdition === 'morning' || (!explicitEdition && new Date().getHours() < 14);

  const [weather, news, views, queueItems, reminders, dailyCalories, gospel] = await Promise.all([
    fetchWeather(),
    fetchAiNews(),
    fetchPortfolioViews(),
    vault.listQueueItems('pending', 5),
    vault.listUpcomingReminders(Number(config.ownerChatId) || 0, 4),
    vault.getDailyCalories(),
    isMorning ? fetchGospelReflection(dateLabel()) : Promise.resolve(null),
  ]);

  const calRemaining = Math.max(0, dailyCalories.target_calories - dailyCalories.total_calories);

  const pendingTodos: string[] = [
    ...queueItems.map((q) => `• <b>[#${escapeHtml(q.short_id)}]</b> ${escapeHtml(q.title)} ➔ <code>${escapeHtml(q.antigravity_action)}</code>`),
    ...reminders.map((r) => `• ⏰ <b>[Reminder]</b> ${escapeHtml(r.text)}`),
  ];

  const todoBlock =
    pendingTodos.length > 0
      ? pendingTodos.join('\n')
      : '• <i>No urgent tasks in queue! Ready for new ideas or project sprints.</i>';

  const sections: string[] = [];

  if (isMorning) {
    // 7:00 AM Morning Executive Edition
    sections.push(
      `☀️ <b>Good morning, sir.</b>`,
      `Here is your morning briefing and strategic plan for today.`,
      '',
      `📅 <i>${escapeHtml(dateLabel())}</i> · 📍 <i>${escapeHtml(config.weather.city)}</i> (${escapeHtml(weather)})`,
      ''
    );

    if (gospel) {
      sections.push(
        `✝️ <b>Daily Gospel &amp; Reflection</b>`,
        `📖 <b>${escapeHtml(gospel.verse)}</b>`,
        `<i>${escapeHtml(gospel.reflection)}</i>`,
        `🙏 <b>Prayer:</b> <i>${escapeHtml(gospel.prayer)}</i>`,
        ''
      );
    }

    sections.push(
      `🤖 <b>AI &amp; Industry Pulse</b>`,
      news.length > 0
        ? news.map((n) => `• <b>${escapeHtml(n.title)}</b>${n.url ? `\n  🔗 <a href="${n.url}">Read Article</a>` : ''}`).join('\n')
        : '• <i>Gemini 2.5 &amp; Agentic workflows evolving across developer platforms.</i>',
      '',
      `📋 <b>Active To-Dos &amp; Antigravity Queue</b>`,
      todoBlock,
      '',
      `🥗 <b>Calorie Target:</b> <code>1,850 kcal cap</code>`,
      renderProgressBar(dailyCalories.total_calories, dailyCalories.target_calories),
      `📊 <b>Portfolio Pulse:</b> <code>${views.today}</code> today · <code>${views.total}</code> total`,
      '',
      `🚀 <i>I am at your service whenever you are ready to build on desktop, sir.</i>\n— <b>Rush</b>`
    );
  } else {
    // 7:00 PM Evening Wrap-Up Edition
    sections.push(
      `🌙 <b>Good evening, sir.</b>`,
      `Here is your end-of-day summary and nutrition ledger wrap-up.`,
      '',
      `📅 <i>${escapeHtml(dateLabel())}</i> · 📍 <i>${escapeHtml(config.weather.city)}</i> (${escapeHtml(weather)})`,
      '',
      `🥗 <b>Day's Calorie Intake &amp; Macros</b>`,
      renderProgressBar(dailyCalories.total_calories, dailyCalories.target_calories),
      `• <b>Total:</b> <code>${dailyCalories.total_calories} / ${dailyCalories.target_calories} kcal</code> (${calRemaining} kcal remaining)`,
      `• <b>Protein:</b> <code>${dailyCalories.total_protein_g}g</code> · <b>Carbs:</b> <code>${dailyCalories.total_carbs_g}g</code> · <b>Fat:</b> <code>${dailyCalories.total_fat_g}g</code>`,
      '',
      `🤖 <b>Evening AI Brief</b>`,
      news.length > 0
        ? news.map((n) => `• <b>${escapeHtml(n.title)}</b>${n.url ? `\n  🔗 <a href="${n.url}">Read Article</a>` : ''}`).join('\n')
        : '• <i>Latest developer tools and AI models running smoothly.</i>',
      '',
      `📋 <b>Workspace Tasks &amp; Queue</b>`,
      todoBlock,
      '',
      `📊 <b>Portfolio Pulse:</b> <code>${views.today}</code> views today`,
      '',
      `✨ <i>Have a restful evening, sir. We will continue advancing tomorrow.</i>\n— <b>Rush</b>`
    );
  }

  return sections.join('\n');
}
