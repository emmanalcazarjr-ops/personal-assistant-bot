/** Show current webhook info.  npm run get-webhook */
import { loadEnv } from './load-env.mjs';
loadEnv();

const token = process.env.BOT_TOKEN;
if (!token) {
  console.error('Missing BOT_TOKEN in .env.local');
  process.exit(1);
}
const res = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
console.log(JSON.stringify(await res.json(), null, 2));
