/**
 * Cron processor: sends due reminders and marks them done.
 * Called by the GitHub Actions workflow every 10 minutes.
 * Protected by CRON_SECRET (Authorization: Bearer <secret>).
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { config } from '../src/config.ts';
import { createBot } from '../src/bot.ts';
import { getDueReminders, markReminderDone } from '../src/vault.ts';

export default async function cronReminders(req: IncomingMessage, res: ServerResponse) {
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
  const due = await getDueReminders();
  let sent = 0;
  const failed: string[] = [];

  for (const r of due) {
    try {
      await bot.api.sendMessage(r.chat_id, `⏰ *Reminder:* ${r.text}`, {
        parse_mode: 'Markdown',
      });
      await markReminderDone(r.id);
      sent++;
    } catch (e) {
      console.error('reminder send failed', r.id, e);
      failed.push(r.id);
    }
  }

  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ ok: true, sent, total: due.length, failed }));
}
