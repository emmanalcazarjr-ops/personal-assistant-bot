/**
 * Natural Language Intent Classifier & Autonomous Action Router.
 *
 * Automatically detects whether any text message or forwarded item is about:
 * 1. 🥗 Food / Calorie Logging ("had 2 eggs and toast", "ate a bowl of pho")
 * 2. 📊 Food / Calorie Inquiry ("how many calories left today?", "show my meals")
 * 3. 💼 Career / Project / Curation (URLs, repos, articles, tech ideas)
 * 4. ⏰ Reminders ("remind me to deploy at 5pm", "don't forget to call mom")
 * 5. 📝 Notes ("note down: database connection string...", "remember this idea")
 * 6. ☀️ Daily Briefing ("give me my morning briefing", "what's on today?")
 * 7. 💬 General Conversation & Assistance
 */
import { hasDeepSeek } from './config.ts';
import { chatCompletion } from './deepseek.ts';
import { extractUrl } from './curation.ts';

export type UserIntent =
  | 'food_log'
  | 'food_query'
  | 'curation'
  | 'reminder'
  | 'note'
  | 'briefing'
  | 'chat';

export interface IntentResult {
  intent: UserIntent;
  confidence: number;
  extracted?: {
    food_description?: string;
    reminder_task?: string;
    reminder_time?: string;
    note_text?: string;
    note_tags?: string[];
  };
}

const INTENT_CLASSIFICATION_PROMPT = `
You are an intelligent intent router for Emman ("sir") in his personal Telegram assistant bot.
Given any user message, classify its primary intent into exactly ONE of the following:

1. "food_log" — The user is mentioning food/drinks they ate, are eating, or had (e.g. "2 eggs and coffee", "eating chicken rice", "had a protein shake and banana", "lunch was burger and fries", "ate 3 tacos").
2. "food_query" — The user is asking about their calories, calorie goal, meals logged today, or daily intake (e.g. "how many calories left?", "show my calories", "what did I eat today?", "how's my calorie intake?").
3. "curation" — The user is sharing a link, tech article, GitHub repo, tweet, project idea, tool, or career opportunity to queue for desktop Antigravity work (e.g. any URL, "check out this AI framework", "save this idea for water station").
4. "reminder" — The user is asking to set a reminder or be reminded of something at a time (e.g. "remind me to call mom at 5pm", "don't forget to push code in 20 mins", "remind me tomorrow morning to buy water").
5. "note" — The user is jotting down a quick note, snippet, idea, or bookmark (e.g. "note: database connection url is...", "take a note: redesign the hero banner", "save note #ideas new bot concept").
6. "briefing" — The user wants their morning/evening briefing, daily news update, or daily overview (e.g. "give me my briefing", "what's the briefing today?", "morning report", "what's on for today?").
7. "chat" — General greeting, personal conversation, coding question, or assistant question.

Return ONLY a strict JSON object:
{
  "intent": "food_log" | "food_query" | "curation" | "reminder" | "note" | "briefing" | "chat",
  "confidence": 0.95,
  "extracted": {
    "food_description": "cleaned food description if food_log",
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

  // 2. Clear food query patterns
  if (
    /^(how\s+many\s+calories|show(\s+me)?\s+calories|calories\s+left|my\s+calories|calorie\s+(status|check|summary|tracker)|what\s+did\s+i\s+eat)/i.test(
      lower
    )
  ) {
    return { intent: 'food_query', confidence: 0.95 };
  }

  // 3. Clear food log patterns
  if (
    /^(i\s+(just\s+)?(ate|had|consumed|drank)|ate\s+|had\s+|eating\s+|drinking\s+|for\s+(breakfast|lunch|dinner|snack)\s*(:|was|is)?|just\s+ate)/i.test(
      lower
    )
  ) {
    return {
      intent: 'food_log',
      confidence: 0.95,
      extracted: { food_description: trimmed },
    };
  }

  // 4. Clear reminder patterns
  if (
    /^(remind\s+me(\s+to)?|set\s+a\s+reminder|don't\s+forget\s+to|dont\s+forget\s+to)/i.test(
      lower
    )
  ) {
    return { intent: 'reminder', confidence: 0.9 };
  }

  // 5. Clear note patterns
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

  // 6. Clear briefing patterns
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

  // Use DeepSeek AI to automatically analyze intent
  if (hasDeepSeek()) {
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
