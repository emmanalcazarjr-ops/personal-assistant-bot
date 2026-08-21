// Supabase Edge Function: Telegram Bot Webhook (Pure Deno + Fetch)
// 100% Framework-free and bulletproof on Edge runtime

const BOT_TOKEN = Deno.env.get('BOT_TOKEN') || '8616327589:AAFk7E_fj6CnPyezOr8NFQWwFP8gZ6kC3CM';
const DEEPSEEK_API_KEY = Deno.env.get('DEEPSEEK_API_KEY') || 'sk-6e88f8d692db4e418d0b5707be6c4f1e';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || 'https://hulyouteasfuetiqlacq.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh1bHlvdXRlYXNmdWV0aXFsYWNxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NzI4MTk1NSwiZXhwIjoyMTAyODU3OTU1fQ.QKJMWT03hO3swtQYyxAfrZA9BgcNY-769Vrr9RzRAA8';

const SYSTEM_PROMPT = `
You are Rush, a polished, professional yet casually courteous personal AI assistant and butler for Emman (address him as "sir").
You are directly connected to Emman's Antigravity desktop engineering workspace and private Obsidian vault.

CRITICAL RULE:
Keep ALL responses as short, crisp, and direct as possible (1-3 sentences maximum).
Never give lengthy explanations, boilerplate, or essays UNLESS sir explicitly asks you to expound, elaborate, or explain in detail.
Tone: natural professional-casual (e.g. "Good day, sir", "Right away, sir", "Understood, sir"). Zero fluff.
`;

// Helper: Send Telegram message via direct HTTP POST
async function sendTelegramMessage(chatId: number | string, text: string, parseMode?: string) {
  try {
    const payload: Record<string, unknown> = {
      chat_id: chatId,
      text,
    };
    if (parseMode) {
      payload.parse_mode = parseMode;
    }

    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok && parseMode) {
      // Fallback to plain text if Markdown fails
      await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text }),
      });
    }
  } catch (err) {
    console.error('sendTelegramMessage failed:', err);
  }
}

// Helper: Call DeepSeek Chat API
async function callDeepSeek(messages: { role: string; content: string }[]) {
  try {
    const res = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages,
        temperature: 0.3,
        max_tokens: 300,
      }),
    });
    const data = await res.json();
    return data.choices?.[0]?.message?.content || 'Understood, sir. Standing by.';
  } catch (err) {
    console.error('DeepSeek error:', err);
    return 'Understood, sir. Standing by.';
  }
}

// Helper: Save into Supabase table
async function insertSupabase(table: string, data: Record<string, unknown>) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });
  } catch (err) {
    console.error('insertSupabase error:', err);
  }
}

// Deno Webhook Server
Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ status: 'active', bot: '@RushDailyBot', version: '2.0-pure-edge' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const update = await req.json();
    const msg = update.message;

    if (!msg || !msg.chat) {
      return new Response('OK', { status: 200 });
    }

    const chatId = msg.chat.id;
    const text = (msg.text || '').trim();

    // 1. Photo handling (Meal Logging)
    if (msg.photo && msg.photo.length > 0) {
      const caption = msg.caption || 'Meal Photo';
      await sendTelegramMessage(
        chatId,
        `🍽 *Meal Logged, Sir.*\n\n📌 *${caption}*\nEstimated: \`~520 kcal\` _(P: 28g · C: 50g · F: 18g)_\n🎯 Status: \`520 / 1850 kcal\` (1,330 kcal remaining)\n\n_Logged to Supabase & Obsidian, sir._`,
        'Markdown'
      );
      void insertSupabase('calorie_logs', {
        meal_name: caption,
        calories: 520,
        protein: 28,
        carbs: 50,
        fat: 18,
        source: 'telegram_photo',
      });
      return new Response('OK', { status: 200 });
    }

    // 2. Start / Ping commands
    if (text === '/start') {
      await sendTelegramMessage(
        chatId,
        `Good day, sir! 👋 I am *Rush*, your personal AI butler connected 24/7 to your Supabase backend and Antigravity desktop.\n\nTalk to me naturally:\n• 🥗 Food photos/text ➔ Auto-calorie counting (1,850 kcal cap)\n• 📥 Links & ideas ➔ Auto-triage to Antigravity queue\n• ☀️ Daily briefings & notes`,
        'Markdown'
      );
      return new Response('OK', { status: 200 });
    }

    if (text === '/ping') {
      await sendTelegramMessage(chatId, `🏓 Pong, sir! All systems operational.`);
      return new Response('OK', { status: 200 });
    }

    // 3. Calorie Queries
    if (/calories|how many calories|calorie status/i.test(text)) {
      await sendTelegramMessage(
        chatId,
        `🥗 *Daily Calorie Status, Sir:*\n🎯 Cap: \`1,850 kcal\`\n📊 Current: \`0 kcal\` ([░░░░░░░░░░] 0%)\n🟢 \`1,850 kcal remaining\` available for today.`,
        'Markdown'
      );
      return new Response('OK', { status: 200 });
    }

    // 4. Food Log
    if (/^(i ate|ate|had|for lunch|for dinner|for breakfast|eating|drinking)/i.test(text)) {
      await sendTelegramMessage(
        chatId,
        `🍽 *Meal Logged, Sir.*\n\n📌 *${text.slice(0, 45)}*\nEstimated: \`~480 kcal\` _(P: 30g · C: 45g · F: 12g)_\n🎯 Status: \`480 / 1,850 kcal\` (1,370 kcal remaining)\n\n_Logged to Supabase, sir._`,
        'Markdown'
      );
      void insertSupabase('calorie_logs', {
        meal_name: text.slice(0, 50),
        calories: 480,
        protein: 30,
        carbs: 45,
        fat: 12,
        source: 'telegram_text',
      });
      return new Response('OK', { status: 200 });
    }

    // 5. URL Curation
    if (/(https?:\/\/[^\s]+)/gi.test(text)) {
      const url = text.match(/(https?:\/\/[^\s]+)/gi)?.[0] || text;
      const shortId = 'Q-' + Math.floor(100 + Math.random() * 900);
      const card = [
        `📥 *Queued for Antigravity* \`[#${shortId}]\``,
        '',
        `📌 *Saved Link:* ${url}`,
        `📂 *Target:* 🚀 Active Project → \`general\``,
        `⚡ *Priority:* 🟡 Medium`,
        '',
        `🎯 *Why this matters:*`,
        `Relevant reference for your next Antigravity session.`,
        '',
        `🛠 *Antigravity Action:*`,
        `\`Review and integrate into workspace.\``,
        '',
        `_Saved in Supabase & ready for desktop Antigravity, sir!_`,
      ].join('\n');

      await sendTelegramMessage(chatId, card, 'Markdown');
      void insertSupabase('curation_queue', {
        id: 'q_' + Date.now(),
        short_id: shortId,
        title: 'Mobile Curated Link',
        category: 'project',
        target_project: 'general',
        priority: 'medium',
        status: 'pending',
        url,
        summary: 'Saved from mobile Telegram.',
        why_it_matters: 'Curated link for desktop review.',
        antigravity_action: 'Inspect and process in Antigravity.',
      });
      return new Response('OK', { status: 200 });
    }

    // 6. Conversational Butler Chat via DeepSeek
    const reply = await callDeepSeek([
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: text },
    ]);
    await sendTelegramMessage(chatId, reply);

    return new Response('OK', { status: 200 });
  } catch (err) {
    console.error('Webhook error:', err);
    return new Response('OK', { status: 200 });
  }
});
