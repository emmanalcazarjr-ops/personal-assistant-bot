// Supabase Edge Function: Telegram Bot Webhook (Pure Deno + Fetch + Real-time Calorie Engine)
// 100% Dynamic data fetched from Supabase database

const BOT_TOKEN = Deno.env.get('BOT_TOKEN') || '8616327589:AAFk7E_fj6CnPyezOr8NFQWwFP8gZ6kC3CM';
const DEEPSEEK_API_KEY = Deno.env.get('DEEPSEEK_API_KEY') || 'sk-6e88f8d692db4e418d0b5707be6c4f1e';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || 'https://hulyouteasfuetiqlacq.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh1bHlvdXRlYXNmdWV0aXFsYWNxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NzI4MTk1NSwiZXhwIjoyMTAyODU3OTU1fQ.QKJMWT03hO3swtQYyxAfrZA9BgcNY-769Vrr9RzRAA8';
const DEFAULT_CALORIE_CAP = 1850;

const SYSTEM_PROMPT = `
You are Rush, a polished, professional yet casually courteous personal AI assistant and butler for Emman (address him as "sir").
You are directly connected to Emman's Antigravity desktop engineering workspace and Supabase database.

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

// Helper: Get today's live total calories and macros from Supabase
async function getLiveDailyNutrition(): Promise<{ totalKcal: number; totalP: number; totalC: number; totalF: number; count: number }> {
  try {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/calorie_logs?log_date=eq.${today}&select=calories,protein,carbs,fat`,
      {
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
      }
    );

    if (!res.ok) return { totalKcal: 0, totalP: 0, totalC: 0, totalF: 0, count: 0 };
    const rows: { calories: number; protein?: number; carbs?: number; fat?: number }[] = await res.json();
    const totalKcal = rows.reduce((s, r) => s + (Number(r.calories) || 0), 0);
    const totalP = rows.reduce((s, r) => s + (Number(r.protein) || 0), 0);
    const totalC = rows.reduce((s, r) => s + (Number(r.carbs) || 0), 0);
    const totalF = rows.reduce((s, r) => s + (Number(r.fat) || 0), 0);
    return { totalKcal, totalP, totalC, totalF, count: rows.length };
  } catch (err) {
    console.error('getLiveDailyNutrition error:', err);
    return { totalKcal: 0, totalP: 0, totalC: 0, totalF: 0, count: 0 };
  }
}

// Helper: Generate visual progress bar
function renderProgressBar(current: number, target = DEFAULT_CALORIE_CAP): string {
  const pct = Math.min(100, Math.round((current / target) * 100));
  const filled = Math.round(pct / 10);
  const bar = '█'.repeat(filled) + '░'.repeat(10 - filled);
  return `\`[${bar}]\` **${current.toLocaleString()} / ${target.toLocaleString()} kcal** (${pct}%)`;
}

// Helper: Estimate meal calories & macros via DeepSeek AI
async function estimateMealNutrition(description: string): Promise<{ meal: string; calories: number; protein: number; carbs: number; fat: number }> {
  try {
    const res = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          {
            role: 'system',
            content: `You are an expert nutritionist. Estimate realistic calories and macronutrients for the meal description.
Return ONLY valid JSON matching this exact structure with no extra markdown:
{"meal": "Short clean meal name", "calories": 450, "protein": 25, "carbs": 45, "fat": 15}`,
          },
          { role: 'user', content: description },
        ],
        temperature: 0.1,
      }),
    });

    const data = await res.json();
    const raw = data.choices?.[0]?.message?.content || '{}';
    const clean = raw.replace(/```json/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(clean);
    return {
      meal: parsed.meal || description.slice(0, 40),
      calories: Number(parsed.calories) || 450,
      protein: Number(parsed.protein) || 20,
      carbs: Number(parsed.carbs) || 40,
      fat: Number(parsed.fat) || 15,
    };
  } catch {
    return { meal: description.slice(0, 40), calories: 450, protein: 20, carbs: 40, fat: 15 };
  }
}

// Helper: DeepSeek general chat
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
  } catch {
    return 'Understood, sir. Standing by.';
  }
}

// Helper: Insert record into Supabase table
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
      return new Response(
        JSON.stringify({ status: 'active', bot: '@RushDailyBot', engine: 'live-supabase-nutrition' }),
        { headers: { 'Content-Type': 'application/json' } }
      );
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
      const estimated = await estimateMealNutrition(caption);
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());

      // Save to database
      await insertSupabase('calorie_logs', {
        meal_name: estimated.meal,
        calories: estimated.calories,
        protein: estimated.protein,
        carbs: estimated.carbs,
        fat: estimated.fat,
        source: 'telegram_photo',
        log_date: today,
      });

      // Query live cumulative totals
      const live = await getLiveDailyNutrition();
      const remaining = Math.max(0, DEFAULT_CALORIE_CAP - live.totalKcal);

      const reply = [
        `🍽 *Meal Logged, Sir.*`,
        '',
        `📌 *${estimated.meal}*`,
        `➕ *+${estimated.calories} kcal* _(P: ${estimated.protein}g · C: ${estimated.carbs}g · F: ${estimated.fat}g)_`,
        '',
        `📊 *Daily Progress:*`,
        renderProgressBar(live.totalKcal, DEFAULT_CALORIE_CAP),
        `🟢 *${remaining.toLocaleString()} kcal remaining* for today.`,
      ].join('\n');

      await sendTelegramMessage(chatId, reply, 'Markdown');
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

    // 3. Calorie Queries (e.g. "How many calories left?", "Calories today", "What did I eat?")
    if (/calories|how many calories|calorie status|what did i eat|my kcal/i.test(text)) {
      const live = await getLiveDailyNutrition();
      const remaining = Math.max(0, DEFAULT_CALORIE_CAP - live.totalKcal);

      const reply = [
        `🥗 *Today's Live Calorie Status, Sir:*`,
        '',
        renderProgressBar(live.totalKcal, DEFAULT_CALORIE_CAP),
        '',
        `🥩 *Protein:* \`${live.totalP}g\`  ·  🍞 *Carbs:* \`${live.totalC}g\`  ·  🥑 *Fat:* \`${live.totalF}g\``,
        `🎯 *Remaining Allowance:* \`${remaining.toLocaleString()} kcal\` (from 1,850 kcal cap)`,
        `📝 *Total Meals Logged Today:* \`${live.count}\``,
      ].join('\n');

      await sendTelegramMessage(chatId, reply, 'Markdown');
      return new Response('OK', { status: 200 });
    }

    // 4. Food Logging (e.g. "I ate 2 eggs and rice", "Had a chicken breast and salad")
    if (/^(i ate|ate|had|for lunch|for dinner|for breakfast|eating|drinking|snack:|meal:)/i.test(text)) {
      const estimated = await estimateMealNutrition(text);
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());

      // Save to database
      await insertSupabase('calorie_logs', {
        meal_name: estimated.meal,
        calories: estimated.calories,
        protein: estimated.protein,
        carbs: estimated.carbs,
        fat: estimated.fat,
        source: 'telegram_text',
        log_date: today,
      });

      // Query live cumulative totals
      const live = await getLiveDailyNutrition();
      const remaining = Math.max(0, DEFAULT_CALORIE_CAP - live.totalKcal);

      const reply = [
        `🍽 *Meal Logged, Sir.*`,
        '',
        `📌 *${estimated.meal}*`,
        `➕ *+${estimated.calories} kcal* _(P: ${estimated.protein}g · C: ${estimated.carbs}g · F: ${estimated.fat}g)_`,
        '',
        `📊 *Daily Progress:*`,
        renderProgressBar(live.totalKcal, DEFAULT_CALORIE_CAP),
        `🟢 *${remaining.toLocaleString()} kcal remaining* for today.`,
      ].join('\n');

      await sendTelegramMessage(chatId, reply, 'Markdown');
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
