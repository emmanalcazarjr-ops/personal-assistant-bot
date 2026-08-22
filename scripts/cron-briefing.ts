// Cron job: Send 7am & 7pm Daily Briefing
import { generateBriefing } from '../src/briefing.ts';

// SECURITY: credentials come from the environment / GitHub Actions secrets only.
const BOT_TOKEN = process.env.BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';

async function run() {
  if (!BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log('BOT_TOKEN or TELEGRAM_CHAT_ID missing. Exiting cleanly.');
    process.exit(0);
  }

  // Determine morning vs evening Manila time
  const hourManila = parseInt(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Manila',
      hour: 'numeric',
      hour12: false,
    }).format(new Date()),
    10
  );

  const isMorning = hourManila < 14;
  console.log(`Generating ${isMorning ? 'morning (7 AM)' : 'evening (7 PM)'} briefing for chat ${TELEGRAM_CHAT_ID}...`);

  const briefingText = await generateBriefing(isMorning ? 'morning' : 'evening');

  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: Number(TELEGRAM_CHAT_ID),
      text: briefingText,
      parse_mode: 'Markdown',
    }),
  });

  const data = (await res.json()) as { ok?: boolean };
  console.log('Telegram delivery result:', data.ok ? 'SUCCESS' : JSON.stringify(data));
}

run().catch((err) => {
  console.error('Briefing cron runner error:', err);
  process.exit(0);
});
