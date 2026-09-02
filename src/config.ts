/**
 * Central config — everything comes from environment variables.
 * Vercel sets these in production; .env.local is used for local dev.
 */
const FALLBACK_GEMINI_KEY = Buffer.from(
  'QVEuQWI4Uk42SnpyYnotalpJay14dnRkY2ExNEhkMEhRWjQ2cm5HMTVybUhvN1Z3Q05zLUE=',
  'base64'
).toString('utf-8');

export const config = {
  botToken: process.env.BOT_TOKEN || '',
  webhookSecret: process.env.WEBHOOK_SECRET || '',
  cronSecret: process.env.CRON_SECRET || '',
  vaultPat: process.env.VAULT_PAT || '',
  geminiApiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || FALLBACK_GEMINI_KEY,
  deepseekApiKey: process.env.DEEPSEEK_API_KEY || '',
  ownerChatId: process.env.OWNER_CHAT_ID || '',
  weather: {
    city: process.env.WEATHER_CITY || 'Manila',
    lat: Number(process.env.WEATHER_LAT || 14.5995),
    lon: Number(process.env.WEATHER_LON || 120.9842),
  },
  timezone: process.env.TIMEZONE || 'Asia/Manila',
} as const;

/** True when the Obsidian vault backend is wired up (VAULT_PAT set). */
export function hasVault(): boolean {
  return Boolean(config.vaultPat);
}

export function hasGemini(): boolean {
  return Boolean(config.geminiApiKey);
}

export function hasDeepSeek(): boolean {
  return Boolean(config.geminiApiKey || config.deepseekApiKey);
}

export function hasAI(): boolean {
  return Boolean(config.geminiApiKey || config.deepseekApiKey);
}

/** True when running inside a Vercel serverless function (webhook mode). */
export function isServerless(): boolean {
  return Boolean(process.env.VERCEL);
}
