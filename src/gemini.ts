/**
 * Google Gemini API Client with automatic multi-model fallback.
 * Uses native fetch with zero external dependencies.
 */
import { config } from './config.ts';

const GEMINI_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-1.5-flash',
] as const;

const TIMEOUT_MS = 45_000;

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export class GeminiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GeminiError';
  }
}

/**
 * Standard chat completion matching existing signature across the bot.
 * Extracts system prompt into systemInstruction and maps assistant -> model.
 */
export async function chatCompletion(messages: ChatMessage[]): Promise<string> {
  const apiKey = config.geminiApiKey;
  if (!apiKey) {
    throw new GeminiError('GEMINI_API_KEY is not set');
  }

  // Extract system message if present
  const systemMessages = messages.filter((m) => m.role === 'system');
  const systemText = systemMessages.map((m) => m.content).join('\n\n');

  // Convert conversation turns to Gemini contents format
  const conversationMessages = messages.filter((m) => m.role !== 'system');
  const contents = conversationMessages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  // Fallback if no user messages provided
  if (contents.length === 0) {
    contents.push({ role: 'user', parts: [{ text: systemText || 'Hello' }] });
  }

  let lastError: Error | null = null;

  for (const model of GEMINI_MODELS) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

      const body: Record<string, unknown> = {
        contents,
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 1000,
        },
      };

      if (systemText) {
        body.systemInstruction = {
          parts: [{ text: systemText }],
        };
      }

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      }).finally(() => clearTimeout(timer));

      if (!res.ok) {
        const errorText = await res.text().catch(() => '');
        // If 404 (model not found) or 429 (rate limit), continue to next fallback model
        if (res.status === 404 || res.status === 429 || res.status >= 500) {
          lastError = new GeminiError(`Model ${model} returned ${res.status}: ${errorText.slice(0, 150)}`);
          continue;
        }
        throw new GeminiError(`Gemini API ${res.status}: ${errorText.slice(0, 200)}`);
      }

      const json = (await res.json()) as {
        candidates?: {
          content?: {
            parts?: { text?: string }[];
          };
        }[];
      };

      const reply = json.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      if (reply) {
        return reply;
      }

      lastError = new GeminiError(`Empty response candidate from ${model}`);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      // Continue to next model on network/timeout/abort errors
      continue;
    }
  }

  throw lastError || new GeminiError('All Gemini models failed to generate content');
}
