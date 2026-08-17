/**
 * Point Telegram at your deployed webhook.
 *   npm run set-webhook   (reads BOT_TOKEN, WEBHOOK_URL, WEBHOOK_SECRET from .env.local)
 */
import { loadEnv } from './load-env.mjs';
loadEnv();

const token = process.env.BOT_TOKEN;
const url = process.env.WEBHOOK_URL;
const secret = process.env.WEBHOOK_SECRET;

if (!token || !url) {
  console.error('Missing BOT_TOKEN or WEBHOOK_URL in .env.local');
  console.error('  WEBHOOK_URL should look like https://your-app.vercel.app/api/webhook');
  process.exit(1);
}

const body = {
  url,
  allowed_updates: ['message', 'callback_query'],
};
if (secret) body.secret_token = secret;

const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
console.log(JSON.stringify(await res.json(), null, 2));
