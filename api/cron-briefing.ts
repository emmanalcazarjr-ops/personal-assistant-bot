/**
 * Cron processor: sends the daily briefing.
 * Called by the GitHub Actions workflow at 07:00 Asia/Manila.
 * Protected by CRON_SECRET (Authorization: Bearer <secret>).
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { config } from '../src/config.ts';
import { createBot } from '../src/bot.ts';
import { getActiveChatIds } from '../src/vault.ts';
import { generateBriefing } from '../src/briefing.ts';

export default async function cronBriefing(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.end('method not allowed');
    return;
  }
  const auth = (req.headers['authorization'] || '') as string;
  if (auth !== `Bearer ${config.cronSecret}`) {
    res.statusCode = 401;
    res.end('unauthorized');
    return;
  }

  const bot = createBot();
  const text = await generateBriefing();

  const targets: number[] = config.ownerChatId
    ? [Number(config.ownerChatId)]
    : await getActiveChatIds();

  let sent = 0;
  for (const chatId of targets) {
    try {
      await bot.api.sendMessage(chatId, text, { parse_mode: 'Markdown' });
      sent++;
    } catch (e) {
      console.error('briefing send failed', chatId, e);
    }
  }

  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ ok: true, sent, targets: targets.length }));
}
