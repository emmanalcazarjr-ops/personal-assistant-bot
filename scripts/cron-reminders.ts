// Cron job: Process due reminders
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const BOT_TOKEN = process.env.BOT_TOKEN || '';

async function run() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !BOT_TOKEN) {
    console.log('Environment variables not configured for reminders. Exiting cleanly.');
    process.exit(0);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const now = new Date().toISOString();

  // Find due reminders
  const { data: reminders, error } = await supabase
    .from('reminders')
    .select('*')
    .eq('done', false)
    .lte('due_at', now);

  if (error) {
    console.error('Error fetching reminders:', error.message);
    process.exit(0);
  }

  if (!reminders || reminders.length === 0) {
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
      await supabase.from('reminders').update({ done: true }).eq('id', rem.id);
      console.log(`Delivered reminder ${rem.id} to chat ${rem.chat_id}`);
    } catch (err) {
      console.error(`Failed to deliver reminder ${rem.id}:`, err);
    }
  }
}

run().catch((err) => {
  console.error('Cron reminders runner caught:', err);
  process.exit(0);
});
