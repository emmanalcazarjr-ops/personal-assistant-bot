/**
 * Daily Briefing Composer (7:00 AM & 7:00 PM Editions).
 *
 * Gathers:
 * 1. AI News: Specifically Google Gemini, DeepMind, Antigravity & LLM tools affecting Emman's work
 * 2. Active To-Dos & Antigravity Curation Queue items
 * 3. Weather (Open-Meteo) & Portfolio live view counter
 * 4. Generates an actionable morning or evening brief via DeepSeek
 */
import { config, hasDeepSeek } from './config.ts';
import { summarize } from './deepseek.ts';
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
 * Searches specifically for Gemini, Google DeepMind, Agentic AI, and top developer tooling.
 */
async function fetchAiNews(): Promise<NewsItem[]> {
  try {
    // 1. Try Gemini & Google AI specific search
    const query = encodeURIComponent('Gemini OR DeepMind OR Google AI');
    const geminiUrl = `https://hn.algolia.com/api/v1/search_by_date?query=${query}&tags=story&hitsPerPage=5`;
    const res = await fetch(geminiUrl, { signal: AbortSignal.timeout(5000) });
    
    let geminiHits: NewsItem[] = [];
    if (res.ok) {
      const j = (await res.json()) as { hits?: { title?: string; url?: string; points?: number }[] };
      geminiHits = (j.hits ?? [])
        .filter((h) => h.title)
        .map((h) => ({ title: h.title as string, url: h.url, source: 'Gemini/Google AI', points: h.points || 0 }));
    }

    // 2. Fetch general top AI & front page stories
    const topUrl = 'https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=6';
    const topRes = await fetch(topUrl, { signal: AbortSignal.timeout(5000) });
    let topHits: NewsItem[] = [];
    if (topRes.ok) {
      const j = (await topRes.json()) as { hits?: { title?: string; url?: string; points?: number }[] };
      topHits = (j.hits ?? [])
        .filter((h) => h.title)
        .map((h) => ({ title: h.title as string, url: h.url, source: 'Tech Pulse', points: h.points || 0 }));
    }

    // Merge prioritizing Gemini/AI hits first
    const combined = [...geminiHits.slice(0, 3), ...topHits.slice(0, 3)];
    return combined.slice(0, 4);
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
  } catch (e) {
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

/** Determine if current briefing is Morning (7am) or Evening (7pm) */
function getBriefingEdition(): 'morning' | 'evening' {
  const hour = new Date().toLocaleString('en-US', {
    timeZone: config.timezone,
    hour: 'numeric',
    hour12: false,
  });
  const currentHour = parseInt(hour, 10);
  return currentHour >= 14 ? 'evening' : 'morning';
}

/** Full briefing text composer with Gemini AI news & To-Dos */
export async function generateBriefing(explicitEdition?: 'morning' | 'evening'): Promise<string> {
  const edition = explicitEdition || getBriefingEdition();
  const isMorning = edition === 'morning';

  const [weather, news, views, queueItems, reminders, dailyCalories] = await Promise.all([
    fetchWeather(),
    fetchAiNews(),
    fetchPortfolioViews(),
    vault.listQueueItems('pending', 6),
    vault.listUpcomingReminders(Number(config.ownerChatId) || 0, 5),
    vault.getDailyCalories(),
  ]);

  const newsList =
    news.length > 0
      ? news.map((n, i) => `${i + 1}. [${n.source || 'AI'}] ${n.title}${n.url ? ` (${n.url})` : ''}`).join('\n')
      : '• Gemini 1.5 & Flash models active with long-context workflows.\n• Agentic coding & multi-tool workflows evolving across AI platforms.';

  const pendingTodos = [
    ...queueItems.map((q) => `• [#${q.short_id}] [${q.target_project}] ${q.title} -> Action: ${q.antigravity_action}`),
    ...reminders.map((r) => `• [Reminder] ${r.text}`),
  ];

  const todoBlock =
    pendingTodos.length > 0
      ? pendingTodos.join('\n')
      : '• No urgent tasks in queue! Ready for new ideas or project sprints.';

  const calRemaining = dailyCalories.target_calories - dailyCalories.total_calories;

  const facts = {
    edition: isMorning ? '7:00 AM Morning Briefing' : '7:00 PM Evening Wrap-Up',
    date: dateLabel(),
    city: config.weather.city,
    weather,
    newsList,
    todoBlock,
    viewsToday: views.today,
    viewsTotal: views.total,
    calConsumed: dailyCalories.total_calories,
    calTarget: dailyCalories.target_calories,
    calRemaining,
  };

  if (hasDeepSeek()) {
    try {
      const prompt = isMorning
        ? [
            `You are Rush, a polished, professional yet casually courteous personal AI assistant/butler for Emman ("sir") in ${facts.city}.`,
            `Today is ${facts.date}. Weather: ${facts.weather}.`,
            `Portfolio Stats: ${facts.viewsToday} visitors today (${facts.viewsTotal} total).`,
            `Daily Calorie Target: ${facts.calTarget} kcal cap.`,
            `AI & Gemini News Focus:\n${facts.newsList}`,
            `Today's Actionable To-Dos & Antigravity Queue:\n${facts.todoBlock}`,
            '',
            'Instructions & Tone:',
            '1. Greeting: Start with a professional but casual approach: "Good morning, sir. These are the news and your possible to-dos to improve yourself today."',
            '2. Include Manila date and weather concisely.',
            '3. AI & Gemini News: Highlight 1-2 top breakthroughs, explaining clearly in 1 sentence how each benefits his AI automation portfolio, projects, or self-improvement.',
            '4. To-Dos & Nutrition: Present the top prioritized Antigravity tasks & remind him of his 1,850 kcal target (ready to log food photos/descriptions).',
            '5. Portfolio Pulse: Include visitor stats.',
            '6. Sign-off: Courteous and motivating (e.g. "I am at your service whenever you are ready to build, sir. — Rush").',
            'Keep it under 240 words, clean Markdown with bullet points.',
          ].join('\n')
        : [
            `You are Rush, a polished, professional yet casually courteous personal AI assistant/butler for Emman ("sir") in ${facts.city}.`,
            `Today is ${facts.date}. Weather: ${facts.weather}.`,
            `Portfolio Stats: ${facts.viewsToday} visitors today (${facts.viewsTotal} total).`,
            `Calorie Log Today: ${facts.calConsumed} / ${facts.calTarget} kcal (${facts.calRemaining >= 0 ? `${facts.calRemaining} kcal remaining` : `over cap by ${Math.abs(facts.calRemaining)} kcal`}).`,
            `Evening AI & Gemini Pulse:\n${facts.newsList}`,
            `Remaining Tasks & Queue Items:\n${facts.todoBlock}`,
            '',
            'Instructions & Tone:',
            '1. Greeting: Start with a professional but casual evening greeting: "Good evening, sir. Here is your evening AI briefing and a quick review of your queue today."',
            '2. Share 1 key AI/Gemini advancement or practical automation takeaway.',
            '3. Summarize remaining queue items, daily calorie intake status vs 1,850 kcal cap, and prep for tomorrow\'s desktop session.',
            '4. End with portfolio visitor stats and a courteous closing. Sign off as "— Rush".',
            'Keep it under 220 words, clean Markdown.',
          ].join('\n');

      const text = await summarize(prompt, 600);
      if (text.trim()) return text.trim();
    } catch (e) {
      console.error('DeepSeek briefing failed, falling back to template:', e);
    }
  }

  // Fallback Template if DeepSeek is offline
  const greeting = isMorning
    ? `☀️ *Good morning, sir.* These are the news and your possible to-dos to improve yourself today.`
    : `🌙 *Good evening, sir.* Here is your evening AI wrap-up and status report.`;

  return [
    greeting,
    `📅 _${facts.date}_ · 📍 _${facts.city}_ (${facts.weather})`,
    '',
    `🤖 *AI & Gemini Developments (Work & Portfolio Impact):*`,
    news.length > 0
      ? news.slice(0, 3).map((n) => `• *${n.title}*${n.url ? `\n  🔗 [Read Article](${n.url})` : ''}`).join('\n')
      : `• Explore latest Gemini function-calling and agent orchestration capabilities in Antigravity.`,
    '',
    `📋 *Today's Possible To-Dos & Antigravity Queue:*`,
    todoBlock,
    '',
    `🥗 *Calorie Target:* \`${facts.calConsumed} / ${facts.calTarget} kcal\` (${calRemaining >= 0 ? `${calRemaining} kcal remaining` : `over cap`})`,
    `📊 *Portfolio Pulse:* \`${facts.viewsToday}\` visits today (\`${facts.viewsTotal}\` all-time)`,
    '',
    isMorning
      ? `🚀 _I am at your service whenever you are ready to build on desktop, sir._\n— Rush`
      : `✨ _Have a restful evening, sir. We will continue advancing tomorrow._\n— Rush`,
  ].join('\n');
}
