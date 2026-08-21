// Cron job: Process due reminders using native fetch
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const BOT_TOKEN = process.env.BOT_TOKEN || '';

async function run() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !BOT_TOKEN) {
    console.log('Environment variables not configured. Exiting cleanly.');
    process.exit(0);
  }

  const now = new Date().toISOString();
  const url = `${SUPABASE_URL}/rest/v1/reminders?done=eq.false&due_at=lte.${encodeURIComponent(now)}`;

  try {
    const res = await fetch(url, {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
    });

    if (!res.ok) {
      console.log('Reminders table query returned status:', res.status);
      process.exit(0);
    }

    const reminders = await res.json();
    if (!Array.isArray(reminders) || reminders.length === 0) {
      console.log('✅ No pending reminders due at this time.');
      process.exit(0);
    }

    for (const rem of reminders) {
      const text = `⏰ *Reminder, Sir!*\n\n📌 ${rem.text}\n\n_Stay sharp, sir._`;
      try {
        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: rem.chat_id,
            text,
            parse_mode: 'Markdown',
          }),
        });

        await fetch(`${SUPABASE_URL}/rest/v1/reminders?id=eq.${rem.id}`, {
          method: 'PATCH',
          headers: {
            apikey: SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ done: true }),
        });
        console.log(`Delivered reminder ${rem.id} to chat ${rem.chat_id}`);
      } catch (err) {
        console.error(`Failed to deliver reminder ${rem.id}:`, err);
      }
    }
  } catch (err) {
    console.error('Error in reminders runner:', err);
  }
}

run().catch((err) => {
  console.error('Uncaught error:', err);
  process.exit(0);
});
