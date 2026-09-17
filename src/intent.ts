/**
 * Natural Language Intent Classifier & Autonomous Action Router.
 *
 * Automatically routes messages to:
 * 1. ⚡ AI Coding Challenge ("what should I code today?", "suggest a project based on AI news")
 * 2. 🚀 Starter Boilerplate ("generate the boilerplate", "give me the starter code")
 * 3. 🔥 GitHub Contribution Streak ("how's my GitHub streak?", "did I push code today?")
 * 4. 💼 Career / Project / Curation (URLs, repos, articles, tech ideas)
 * 5. ⏰ Reminders ("remind me to deploy at 5pm", "don't forget to push code")
 * 6. 📝 Notes ("note down: database connection string...", "save idea")
 * 7. ☀️ Daily Briefing ("give me my morning briefing", "what's the briefing today?")
 * 8. 💬 General Butler Chat & Technical Co-Pilot
 */
import { hasDeepSeek, hasGemini } from './config.ts';
import { chatCompletion } from './deepseek.ts';
import { extractUrl } from './curation.ts';

export type UserIntent =
  | 'coding_challenge'
  | 'generate_boilerplate'
  | 'github_streak'
  | 'curation'
  | 'reminder'
  | 'note'
  | 'briefing'
  | 'chat';

export interface IntentResult {
  intent: UserIntent;
  confidence: number;
  extracted?: {
    challenge_topic?: string;
    reminder_task?: string;
    reminder_time?: string;
    note_text?: string;
    note_tags?: string[];
  };
}

const INTENT_CLASSIFICATION_PROMPT = `
You are an intelligent intent router for Emman ("sir") in his personal Telegram assistant and AI coding butler bot.
Given any user message, classify its primary intent into exactly ONE of the following:

1. "coding_challenge" — The user is asking for today's AI coding micro-project, a coding challenge, or a project suggestion based on AI news (e.g. "what should I code today?", "suggest a daily coding task", "give me an AI challenge", "what's the daily build?").
2. "generate_boilerplate" — The user wants the starter code, template, or boilerplate for a coding challenge (e.g. "generate the boilerplate", "give me starter code", "show boilerplate", "scaffold this project").
3. "github_streak" — The user is inquiring about their GitHub commit streak, daily commits, or contribution activity (e.g. "how's my github streak?", "did I push code today?", "github status", "check my commits").
4. "curation" — The user is sharing a link, tech article, GitHub repo, tweet, project idea, tool, or career opportunity to queue for desktop Antigravity work (e.g. any URL, "check out this framework", "save this idea for water station").
5. "reminder" — The user is asking to set a reminder or be reminded of something at a time (e.g. "remind me to push code at 5pm", "don't forget to review PR in 20 mins").
6. "note" — The user is jotting down a quick note, snippet, idea, or bookmark (e.g. "note: database connection url is...", "take a note: redesign the hero banner", "save note #ideas new bot concept").
7. "briefing" — The user wants their morning/evening briefing, daily overview, or status report (e.g. "give me my briefing", "what's the briefing today?", "morning report", "what's on for today?").
8. "chat" — General greeting, technical question, programming help, architectural advice, or conversational butler chat.

Return ONLY a strict JSON object:
{
  "intent": "coding_challenge" | "generate_boilerplate" | "github_streak" | "curation" | "reminder" | "note" | "briefing" | "chat",
  "confidence": 0.95,
  "extracted": {
    "challenge_topic": "topic if specific challenge requested",
    "reminder_task": "task description if reminder",
    "reminder_time": "time string if reminder",
    "note_text": "cleaned note if note",
    "note_tags": ["tag1", "tag2"]
  }
}
`;

/** Fast heuristic regex matcher to avoid AI latency for obvious messages */
export function fastHeuristicIntent(text: string, isForward = false): IntentResult | null {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();

  // 1. URLs or forwards are always curation
  if (extractUrl(trimmed) || isForward) {
    return { intent: 'curation', confidence: 1.0 };
  }

  // 2. Clear Coding Challenge patterns
  if (
    /^(what\s+should\s+i\s+code|suggest\s+.*(code|coding|project|task|challenge)|daily\s+coding|give\s+me\s+.*(coding|project|challenge)|coding\s+(challenge|task|idea)|ai\s+coding\s+task|micro\s*project)/i.test(
      lower
    ) ||
    /^(what\s+to\s+code|today'?s?\s+(coding|challenge|project))/i.test(lower)
  ) {
    return { intent: 'coding_challenge', confidence: 0.95 };
  }

  // 3. Clear Boilerplate Generation patterns
  if (
    /^(generate\s+(the\s+)?(boilerplate|starter|template|code)|(give|show|send)(\s+me)?\s+(the\s+)?(boilerplate|starter\s+code|template)|starter\s+code|scaffold(\s+code)?)/i.test(
      lower
    )
  ) {
    return { intent: 'generate_boilerplate', confidence: 0.95 };
  }

  // 4. Clear GitHub Streak patterns
  if (
    /^(how('?s|\s+is)\s+my\s+(github\s+)?streak|github\s+streak|my\s+github\s+streak|did\s+i\s+(commit|push)\s+(code\s+)?today|commit\s+streak|check\s+my\s+commits?|github\s+status)/i.test(
      lower
    )
  ) {
    return { intent: 'github_streak', confidence: 0.95 };
  }

  // 5. Clear reminder patterns
  if (
    /^(remind\s+me(\s+to)?|set\s+a\s+reminder|don't\s+forget\s+to|dont\s+forget\s+to)/i.test(
      lower
    )
  ) {
    return { intent: 'reminder', confidence: 0.9 };
  }

  // 6. Clear note patterns
  if (/^(note(\s+down)?\s*:?|take\s+a\s+note\s*:?|save\s+note\s*:?)/i.test(lower)) {
    const content = trimmed.replace(/^(note(\s+down)?\s*:?|take\s+a\s+note\s*:?|save\s+note\s*:?)\s*/i, '');
    const tags = content.split(/\s+/).filter((w) => /^#/.test(w)).map((w) => w.replace(/^#+/, ''));
    const cleanContent = content.split(/\s+/).filter((w) => !/^#/.test(w)).join(' ');
    return {
      intent: 'note',
      confidence: 0.95,
      extracted: { note_text: cleanContent || content, note_tags: tags },
    };
  }

  // 7. Clear briefing patterns
  if (
    /^(daily\s+briefing|give\s+me\s+.*briefing|.*morning\s+briefing|.*evening\s+briefing|what('?s|\s+is)\s+.*briefing|briefing\s+please|status\s+report)/i.test(
      lower
    ) ||
    /^(briefing|what'?s\s+on\s+today|morning\s+report|daily\s+update)/i.test(lower)
  ) {
    return { intent: 'briefing', confidence: 0.95 };
  }

  return null;
}

/** Classify user message intent using AI with heuristic fast-path */
export async function classifyIntent(text: string, isForward = false): Promise<IntentResult> {
  // Try fast regex heuristic first
  const fast = fastHeuristicIntent(text, isForward);
  if (fast && fast.confidence >= 0.9) {
    return fast;
  }

  // Use Gemini/AI to automatically analyze intent
  if (hasDeepSeek() || hasGemini()) {
    try {
      const raw = await chatCompletion([
        { role: 'system', content: INTENT_CLASSIFICATION_PROMPT.trim() },
        { role: 'user', content: `Message from sir: "${text}"` },
      ]);

      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as IntentResult;
        if (parsed.intent) {
          return parsed;
        }
      }
    } catch (err) {
      console.warn('AI intent classification failed, falling back to chat:', err);
    }
  }

  // Default to chat
  return { intent: 'chat', confidence: 0.5 };
}
