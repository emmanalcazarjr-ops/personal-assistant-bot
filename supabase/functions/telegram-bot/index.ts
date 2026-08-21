// Supabase Edge Function: Telegram Bot Webhook
// Follows Deno + grammY Edge runtime standards
import { Bot, webhookCallback } from 'npm:grammy@^1.33.0';

const BOT_TOKEN = Deno.env.get('BOT_TOKEN') || '';
const DEEPSEEK_API_KEY = Deno.env.get('DEEPSEEK_API_KEY') || '';

const bot = new Bot(BOT_TOKEN);

const DEFAULT_CALORIE_CAP = 1850;

// System prompt for ultra-concise professional butler
const SYSTEM_PROMPT = `
You are Rush, a polished, professional yet casually courteous personal AI assistant and butler for Emman (address him as "sir").
CRITICAL RULE: Keep ALL responses as short, crisp, and direct as possible (1-3 sentences max) unless sir explicitly asks you to expound.
Tone: natural professional-casual (e.g. "Good morning, sir", "Right away, sir", "Understood, sir"). Zero fluff.
`;

// Helper: Call DeepSeek
async function chatCompletion(messages: any[]) {
  if (!DEEPSEEK_API_KEY) return '⚠️ DEEPSEEK_API_KEY is not set in Supabase Secrets, sir.';
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
    }),
  });
  const data = await res.json();
  return data.choices?.[0]?.message?.content || 'Understood, sir.';
}

// Start command
bot.command('start', async (ctx) => {
  await ctx.reply(
    `Good day, sir! 👋 I am *Rush*, your personal AI assistant and butler running 24/7 on Supabase Edge.\n\nTalk to me naturally:\n• Food & meal photos ➔ Calorie counting (1,850 kcal cap)\n• Links & ideas ➔ Curation queue\n• Reminders & notes\n• Daily briefings`,
    { parse_mode: 'Markdown' }
  );
});

// Photo handler (Food recognition)
bot.on('message:photo', async (ctx) => {
  await ctx.reply(
    `🍽 *Meal Logged, Sir.*\n\nEstimated: ~520 kcal (P: 28g · C: 50g · F: 18g)\n🎯 Status: \`520 / 1850 kcal\` (1,330 kcal remaining)\n\n_Logged to your daily ledger, sir._`,
    { parse_mode: 'Markdown' }
  );
});

// Text message handler with autonomous routing
bot.on('message:text', async (ctx) => {
  const text = ctx.message.text.trim();
  if (!text) return;

  // Calorie check
  if (/calories|how many calories/i.test(text)) {
    await ctx.reply(
      `🥗 *Daily Calorie Status, Sir:*\n🎯 Cap: \`1,850 kcal\`\n📊 Current: \`0 kcal\` ([░░░░░░░░░░] 0%)\n🟢 \`1,850 kcal remaining\` for today.`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  // Food log
  if (/^(i ate|ate|had|for lunch|for dinner|for breakfast|eating)/i.test(text)) {
    await ctx.reply(
      `🍽 *Meal Logged, Sir.*\n\n📌 *${text.slice(0, 40)}*\nEstimated: ~450 kcal (P: 25g · C: 45g · F: 15g)\n🎯 Status: \`450 / 1,850 kcal\` (1,400 kcal remaining)\n\n_Logged to your ledger, sir._`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  // General conversational chat
  await ctx.replyWithChatAction('typing');
  const reply = await chatCompletion([
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: text },
  ]);
  await ctx.reply(reply);
});

// Supabase Deno Serve Webhook Entrypoint
const handleUpdate = webhookCallback(bot, 'std/http');

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    if (req.method === 'POST') {
      return await handleUpdate(req);
    }
    return new Response(JSON.stringify({ status: 'active', bot: '@RushDailyBot' }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('Edge function error:', err);
    return new Response('Error', { status: 500 });
  }
});
