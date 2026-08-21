/**
 * AI Curation & Scraping Engine for Telegram -> Antigravity Queue.
 *
 * Scrapes metadata/text from shared links, analyzes relevance to Emman's
 * career and active projects using DeepSeek/LLM, and structures actionable tasks
 * for upcoming Antigravity desktop sessions.
 */
import { chatCompletion } from './deepseek.ts';
import { InlineKeyboard } from 'grammy';

export type CurationCategory = 'career' | 'project' | 'idea' | 'learning' | 'reference';
export type CurationPriority = 'high' | 'medium' | 'low';
export type QueueStatus = 'pending' | 'in_progress' | 'done' | 'archived';

export interface UrlMetadata {
  url: string;
  title?: string;
  description?: string;
  siteName?: string;
  textSnippet?: string;
}

export interface CurationAnalysis {
  title: string;
  category: CurationCategory;
  target_project: string;
  priority: CurationPriority;
  summary: string;
  takeaways: string[];
  why_it_matters: string;
  antigravity_action: string;
}

export interface QueueItem extends CurationAnalysis {
  id: string;
  short_id: string;
  chat_id: number;
  url?: string;
  source_type: 'url' | 'text' | 'forward';
  status: QueueStatus;
  raw_input: string;
  created_at: string;
  updated_at?: string;
  completed_at?: string;
}

const URL_REGEX = /(https?:\/\/[^\s]+)/gi;

/** Extract first valid URL from message text, if any. */
export function extractUrl(text: string): string | null {
  const matches = text.match(URL_REGEX);
  if (!matches || matches.length === 0) return null;
  return matches[0].replace(/[)\]>,."']+$/, '');
}

/** Extract all URLs from message text. */
export function extractAllUrls(text: string): string[] {
  const matches = text.match(URL_REGEX);
  if (!matches) return [];
  return matches.map((m) => m.replace(/[)\]>,."']+$/, ''));
}

/** Clean HTML tags and decode common entities. */
function stripHtml(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Fetch URL title, OpenGraph description, and readable text snippet. */
export async function fetchUrlMetadata(url: string): Promise<UrlMetadata | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 (AntigravityCuration/1.0)',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: controller.signal,
      redirect: 'follow',
    });

    if (!res.ok) {
      return { url, title: url };
    }

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('text') && !contentType.includes('html')) {
      return { url, title: url };
    }

    const html = await res.text();

    // Extract OpenGraph / Twitter / Standard Title
    const ogTitle = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i)?.[1];
    const twitterTitle = html.match(/<meta[^>]*name=["']twitter:title["'][^>]*content=["']([^"']+)["']/i)?.[1];
    const docTitle = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1];
    const title = ogTitle || twitterTitle || docTitle || url;

    // Extract Description
    const ogDesc = html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i)?.[1];
    const twitterDesc = html.match(/<meta[^>]*name=["']twitter:description["'][^>]*content=["']([^"']+)["']/i)?.[1];
    const metaDesc = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i)?.[1];
    const description = ogDesc || twitterDesc || metaDesc || '';

    // Extract Site Name
    const siteName = html.match(/<meta[^>]*property=["']og:site_name["'][^>]*content=["']([^"']+)["']/i)?.[1];

    // Extract readable body text snippet
    const bodyText = stripHtml(html).slice(0, 1500);

    return {
      url,
      title: title.trim(),
      description: description.trim(),
      siteName: siteName?.trim(),
      textSnippet: bodyText,
    };
  } catch (err) {
    console.warn(`fetchUrlMetadata failed for ${url}:`, err);
    return { url, title: url };
  } finally {
    clearTimeout(timer);
  }
}

/** Fallback rule-based analysis if AI key is unavailable or fails */
function fallbackAnalysis(rawText: string, urlMeta?: UrlMetadata | null): CurationAnalysis {
  const text = (urlMeta?.title ? `${urlMeta.title} ${urlMeta.description || ''} ${rawText}` : rawText).toLowerCase();
  
  let category: CurationCategory = 'idea';
  let target = 'general';
  let priority: CurationPriority = 'medium';

  if (text.includes('job') || text.includes('hiring') || text.includes('career') || text.includes('resume') || text.includes('interview') || text.includes('salary')) {
    category = 'career';
    target = 'portfolio';
    priority = 'high';
  } else if (text.includes('water') || text.includes('refill') || text.includes('station') || text.includes('order bot')) {
    category = 'project';
    target = 'water-station-telegram-bot';
    priority = 'high';
  } else if (text.includes('report') || text.includes('analytics') || text.includes('pdf')) {
    category = 'project';
    target = 'automated-report-generator';
  } else if (text.includes('portfolio') || text.includes('next.js') || text.includes('tailwind') || text.includes('webgl')) {
    category = 'project';
    target = 'portfolio';
  } else if (text.includes('chatbot') || text.includes('butler') || text.includes('rush')) {
    category = 'project';
    target = 'chatbot-api';
  } else if (text.includes('learn') || text.includes('tutorial') || text.includes('guide') || text.includes('course') || text.includes('agent')) {
    category = 'learning';
    target = 'ai-engineering';
  }

  const title = urlMeta?.title && urlMeta.title !== urlMeta.url 
    ? urlMeta.title.slice(0, 80)
    : rawText.split('\n')[0].slice(0, 80) || 'New Curation Item';

  return {
    title,
    category,
    target_project: target,
    priority,
    summary: urlMeta?.description || rawText.slice(0, 200),
    takeaways: [
      urlMeta?.description ? urlMeta.description.slice(0, 140) : 'Saved during mobile doomscrolling for review.',
      'Review link/notes in next Antigravity session.',
    ],
    why_it_matters: `Relevant to your work on ${target} and AI Automation positioning.`,
    antigravity_action: `Inspect details, evaluate implementation in ${target}, or save to vault.`,
  };
}

const SYSTEM_PROMPT = `
You are an expert AI Curation & Triage Agent for Emman Alcazar Jr.
Emman is a Licensed Electronics Engineer & AI Automation Developer building intelligent systems.

Emman's Active Projects:
1. "water-station-telegram-bot": Telegram ordering & operator dispatch system for water refilling stations (grammY + Node + Supabase).
2. "portfolio": Next.js 14 + Tailwind + WebGL ink trail + Supabase leads & live views (portfolio-elalcazarjr.vercel.app).
3. "automated-report-generator": FastAPI + DeepSeek AI reporting tool for business insights.
4. "chatbot-api": Rush AI Butler API (FastAPI + DeepSeek + Supabase persistent memory).
5. "shared-backend": Central Supabase DB for all apps.
6. "obsidian-vault": Private AI knowledge base & notes.

Emman's Career Goals:
- Target roles: AI Automation Specialist, AI Solutions Engineer, Full-Stack AI/ML Developer.
- Core strengths: Fast practical execution, clean UX, automation workflows (n8n, Telegram bots, APIs), low-jargon communication.

Your task:
Analyze whatever Emman shares while browsing/doomscrolling (link, tweet, article, idea, repo, job posting) and classify it.
Output ONLY a strict JSON object with these exact keys:
{
  "title": "Crisp 4-8 word title",
  "category": "career" | "project" | "idea" | "learning" | "reference",
  "target_project": "water-station-telegram-bot" | "portfolio" | "automated-report-generator" | "chatbot-api" | "shared-backend" | "obsidian-vault" | "new-mvp" | "general",
  "priority": "high" | "medium" | "low",
  "summary": "1-2 sentence core summary (plain language, no fluff)",
  "takeaways": ["Bullet 1 with concrete insight", "Bullet 2 with key takeaway"],
  "why_it_matters": "1 concise sentence on why this is valuable for Emman's portfolio, active projects, or career",
  "antigravity_action": "1 concrete instruction of what Antigravity should build, research, or update during the next desktop session"
}
`;

/** Analyze message and URL metadata with LLM to produce structured curation */
export async function analyzeCurationItem(
  rawText: string,
  urlMeta?: UrlMetadata | null
): Promise<CurationAnalysis> {
  const contentPieces: string[] = [];
  if (rawText.trim()) contentPieces.push(`User Message/Note: ${rawText}`);
  if (urlMeta?.url) contentPieces.push(`Source URL: ${urlMeta.url}`);
  if (urlMeta?.title) contentPieces.push(`Page Title: ${urlMeta.title}`);
  if (urlMeta?.description) contentPieces.push(`Page Description: ${urlMeta.description}`);
  if (urlMeta?.textSnippet) contentPieces.push(`Page Content Snippet:\n${urlMeta.textSnippet.slice(0, 1000)}`);

  const prompt = contentPieces.join('\n\n');

  try {
    const rawResponse = await chatCompletion([
      { role: 'system', content: SYSTEM_PROMPT.trim() },
      { role: 'user', content: `Please curate and categorize this item:\n\n${prompt}` },
    ]);

    // Parse JSON block from LLM output
    const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in LLM response');
    }

    const parsed = JSON.parse(jsonMatch[0]) as Partial<CurationAnalysis>;

    const validCategories: CurationCategory[] = ['career', 'project', 'idea', 'learning', 'reference'];
    const validPriorities: CurationPriority[] = ['high', 'medium', 'low'];

    return {
      title: parsed.title?.trim() || urlMeta?.title || rawText.slice(0, 60),
      category: validCategories.includes(parsed.category as CurationCategory)
        ? (parsed.category as CurationCategory)
        : 'idea',
      target_project: parsed.target_project?.trim() || 'general',
      priority: validPriorities.includes(parsed.priority as CurationPriority)
        ? (parsed.priority as CurationPriority)
        : 'medium',
      summary: parsed.summary?.trim() || 'Saved item from mobile.',
      takeaways: Array.isArray(parsed.takeaways) && parsed.takeaways.length > 0
        ? parsed.takeaways.map((t) => String(t).trim())
        : [parsed.summary || 'Review in Antigravity session'],
      why_it_matters: parsed.why_it_matters?.trim() || 'Relevant to your ongoing development and goals.',
      antigravity_action: parsed.antigravity_action?.trim() || 'Review item and determine next steps in Antigravity.',
    };
  } catch (err) {
    console.warn('AI analysis failed, using fallback:', err);
    return fallbackAnalysis(rawText, urlMeta);
  }
}

const CATEGORY_EMOJI: Record<CurationCategory, string> = {
  career: '💼 Career & Portfolio',
  project: '🚀 Active Project',
  idea: '💡 New MVP / Idea',
  learning: '📚 Skill & Learning',
  reference: '📌 Reference & Tool',
};

const PRIORITY_EMOJI: Record<CurationPriority, string> = {
  high: '🔴 High',
  medium: '🟡 Medium',
  low: '🟢 Low',
};

/** Format Telegram Markdown response card */
export function formatTelegramQueueCard(item: QueueItem): string {
  const catLabel = CATEGORY_EMOJI[item.category] || item.category;
  const prioLabel = PRIORITY_EMOJI[item.priority] || item.priority;
  const takeawaysList = item.takeaways.map((t) => `• ${t}`).join('\n');
  const urlLine = item.url ? `\n🔗 *Link:* ${item.url}` : '';

  return [
    `📥 *Queued for Antigravity* \`[#${item.short_id}]\``,
    '',
    `📌 *${item.title}*`,
    `📂 *Target:* ${catLabel} → \`${item.target_project}\``,
    `⚡ *Priority:* ${prioLabel}`,
    urlLine,
    '',
    `💡 *Key Takeaways:*`,
    takeawaysList,
    '',
    `🎯 *Why this matters:*`,
    item.why_it_matters,
    '',
    `🛠 *Antigravity Action:*`,
    `\`${item.antigravity_action}\``,
    '',
    `_Synced to Obsidian vault & ready for your next desktop session!_`,
  ]
    .filter((line) => line !== undefined)
    .join('\n');
}

/** Create InlineKeyboard for 1-tap category override or quick action */
export function makeCategoryKeyboard(itemId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('💼 Career', `qcat:${itemId}:career`)
    .text('🚀 Project', `qcat:${itemId}:project`)
    .row()
    .text('💡 New Idea', `qcat:${itemId}:idea`)
    .text('📚 Learning', `qcat:${itemId}:learning`)
    .row()
    .text('✅ Mark Done', `qdone:${itemId}`)
    .text('🗑 Delete', `qdel:${itemId}`);
}
