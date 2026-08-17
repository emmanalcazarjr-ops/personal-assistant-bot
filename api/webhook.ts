/**
 * Telegram webhook entrypoint (Vercel function).
 * URL: https://<your-app>.vercel.app/api/webhook
 * Set via scripts/set-webhook.mjs with a secret token.
 */
import { webhookCallback } from 'grammy';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createBot } from '../src/bot.ts';
import { config } from '../src/config.ts';

const bot = createBot();

const handler = webhookCallback(bot, 'http', {
  secretToken: config.webhookSecret || undefined,
});

export default async function webhook(req: IncomingMessage, res: ServerResponse) {
  try {
    await handler(req, res);
  } catch (e) {
    console.error('webhook error:', e);
    if (!res.writableEnded) {
      res.statusCode = 500;
      res.end('internal error');
    }
  }
}
