/**
 * DeepSeek chat completions client (OpenAI-compatible API).
 * Fails loudly so callers can fall back to a friendly message.
 */
import { config } from './config.ts';

const API_URL = 'https://api.deepseek.com/chat/completions';
const TIMEOUT_MS = 45_000;

export interface DeepSeekMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export class DeepSeekError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeepSeekError';
  }
}

export async function chatCompletion(messages: DeepSeekMessage[]): Promise<string> {
  if (!config.deepseekApiKey) {
    throw new DeepSeekError('DEEPSEEK_API_KEY is not set');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.deepseekApiKey}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages,
        temperature: 0.7,
        max_tokens: 600,
        stream: false,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new DeepSeekError(`DeepSeek API ${res.status}: ${text.slice(0, 200)}`);
    }

    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = json.choices?.[0]?.message?.content?.trim();
    if (!content) throw new DeepSeekError('Empty response from DeepSeek');
    return content;
  } catch (e) {
    if (e instanceof DeepSeekError) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    if (e instanceof Error && e.name === 'AbortError') {
      throw new DeepSeekError('DeepSeek request timed out');
    }
    throw new DeepSeekError(`DeepSeek request failed: ${msg}`);
  } finally {
    clearTimeout(timer);
  }
}

/** Short one-line summarizer used by the briefing composer. */
export async function summarize(prompt: string, maxTokens = 400): Promise<string> {
  return chatCompletion([
    {
      role: 'system',
      content:
        'You write crisp, friendly summaries. Plain language only, no jargon. Match the user tone.',
    },
    { role: 'user', content: prompt },
  ]);
}
