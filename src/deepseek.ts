/**
 * Google Gemini / LLM chat completions client.
 * Fails gracefully so callers can fall back to friendly messages.
 */
import { config } from './config.ts';

const GEMINI_MODELS = [
  'gemini-3.7-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash-lite',
  'gemini-2.5-flash-lite',
];
const TIMEOUT_MS = 45_000;

export interface DeepSeekMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export class DeepSeekError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GeminiError';
  }
}

export async function chatCompletion(messages: DeepSeekMessage[]): Promise<string> {
  const apiKey = config.geminiApiKey || config.deepseekApiKey;
  if (!apiKey) {
    throw new DeepSeekError('GEMINI_API_KEY is not set');
  }

  let systemInstruction: { parts: { text: string }[] } | undefined;
  const contents: { role: string; parts: { text: string }[] }[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      systemInstruction = { parts: [{ text: msg.content }] };
    } else if (msg.role === 'user') {
      contents.push({ role: 'user', parts: [{ text: msg.content }] });
    } else if (msg.role === 'assistant') {
      contents.push({ role: 'model', parts: [{ text: msg.content }] });
    }
  }

  if (contents.length === 0) {
    contents.push({ role: 'user', parts: [{ text: 'Hello' }] });
  }

  for (const model of GEMINI_MODELS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents,
          system_instruction: systemInstruction,
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 600,
          },
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        console.warn(`[Gemini] ${model} status ${res.status}: ${text.slice(0, 100)}`);
        continue;
      }

      const json = (await res.json()) as any;
      const content = json.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      if (content) return content;
    } catch (e) {
      console.warn(`[Gemini] ${model} request error:`, e);
      continue;
    } finally {
      clearTimeout(timer);
    }
  }

  throw new DeepSeekError('Google Gemini request failed across all models');
}

/** Short one-line summarizer used by the briefing composer. */
export async function summarize(prompt: string, maxWords = 80): Promise<string> {
  return chatCompletion([
    {
      role: 'system',
      content: `You are an executive summarizer. Be concise, sharp, and helpful. Target around ${maxWords} words or less.`,
    },
    { role: 'user', content: prompt },
  ]);
}
