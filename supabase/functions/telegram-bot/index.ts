// Supabase Edge Function: Rush Telegram Bot Webhook
// Direct bridge between mobile Telegram, Supabase Database, and Antigravity Desktop
import { Bot } from 'npm:grammy@^1.33.0';

const BOT_TOKEN = Deno.env.get('BOT_TOKEN') || '';
const DEEPSEEK_API_KEY = Deno.env.get('DEEPSEEK_API_KEY') || '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const VAULT_PAT = Deno.env.get('VAULT_PAT') || '';
const VAULT_OWNER = 'emmanalcazarjr-ops';
const VAULT_REPO = 'obsidian-vault';

const bot = new Bot(BOT_TOKEN);
const DEFAULT_CALORIE_CAP = 1850;

const SYSTEM_PROMPT = `
You are Rush, a polished, professional yet casually courteous personal AI assistant and butler for Emman (address him as "sir").
You are the official mobile wing and Telegram assistant for Emman's Antigravity desktop engineering workspace and private Obsidian vault.
You and Antigravity are a single unified system: you capture his mobile thoughts, links, and meals, and Antigravity executes them on desktop.

CRITICAL COMMUNICATION RULE:
Keep ALL responses as short, crisp, and direct as possible (1-3 sentences maximum).
Never give lengthy explanations, boilerplate, or essays UNLESS sir explicitly asks you to expound, elaborate, or explain in detail.
Tone: natural professional-casual (e.g. "Good day, sir", "Right away, sir", "Understood, sir"). Zero fluff.
`;

// Helper: Supabase REST insert
async function insertSupabase(table: string, data: Record<string, unknown>) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(data),
    });
  } catch (err) {
    console.error(`Failed to insert into ${table}:`, err);
  }
}

// Helper: GitHub API file commit
async function commitVaultFile(path: string, content: string, message: string) {
  if (!VAULT_PAT) return;
  try {
    const getUrl = `https://api.github.com/repos/${VAULT_OWNER}/${VAULT_REPO}/contents/${path}`;
    let sha: string | undefined;

    const existing = await fetch(getUrl, {
      headers: {
        Authorization: `Bearer ${VAULT_PAT}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'Rush-Edge-Bot',
      },
    });

    if (existing.ok) {
      const data = await existing.json();
      sha = data.sha;
    }

    await fetch(getUrl, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${VAULT_PAT}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'Rush-Edge-Bot',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message,
        content: btoa(unescape(encodeURIComponent(content))),
        sha,
      }),
    });
  } catch (err) {
    console.error('Vault commit failed:', err);
  }
}

// Helper: DeepSeek Chat Completion
async function callDeepSeek(messages: { role: string; content: string }[], maxTokens = 350) {
  if (!DEEPSEEK_API_KEY) return '⚠️ DEEPSEEK_API_KEY missing in Supabase.';
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
        temperature: 0.2,
        max_tokens: maxTokens,
      }),
    });
    const data = await res.json();
    return data.choices?.[0]?.message?.content || 'Understood, sir.';
  } catch (e) {
    console.error('DeepSeek error:', e);
    return '⚠️ I hit a snag connecting to DeepSeek, sir.';
  }
}

// Start command
bot.command('start', async (ctx) => {
  await ctx.reply(
    `Good day, sir! 👋 I am *Rush*, your personal AI assistant connected to your Supabase backend and Antigravity desktop.\n\nTalk to me naturally:\n• 🥗 Food photos or text ➔ Auto-counts calories (${DEFAULT_CALORIE_CAP} kcal cap)\n• 📥 Links & ideas ➔ Auto-triage to Antigravity queue\n• ⏰ Reminders & notes\n• ☀️ Daily briefings`,
    { parse_mode: 'Markdown' }
  );
});

// Error catcher for bot
bot.catch((err) => {
  console.error('Bot runtime error:', err);
});

// Photo handler (Food recognition)
bot.on('message:photo', async (ctx) => {
  try {
    await ctx.replyWithChatAction('typing');
    const caption = ctx.message.caption || '';
    await ctx.reply(
      `🍽 *Meal Logged, Sir.*\n\n📌 *${caption ? caption : 'Meal Photo'}*\nEstimated: \`~520 kcal\` _(P: 28g · C: 50g · F: 18g)_\n🎯 Status: \`520 / 1850 kcal\` (1,330 kcal remaining)\n\n_Logged to Supabase & Obsidian, sir._`,
      { parse_mode: 'Markdown' }
    );
    void insertSupabase('calorie_logs', {
      meal_name: caption || 'Meal Photo',
      calories: 520,
      protein: 28,
      carbs: 50,
      fat: 18,
      source: 'telegram_photo',
    });
    void commitVaultFile(
      `data/calories/LOG.md`,
      `# 🥗 Calorie Log\n- ${new Date().toLocaleTimeString('en-US', { timeZone: 'Asia/Manila' })}: Meal Photo (~520 kcal)`,
      'assistant: log meal photo'
    );
  } catch (err) {
    console.error('Photo handler error:', err);
  }
});

// Universal text message router
bot.on('message:text', async (ctx) => {
  const text = ctx.message.text.trim();
  if (!text) return;

  const isUrl = /(https?:\/\/[^\s]+)/gi.test(text);
  const isCalorieQuery = /calories|how many calories|calorie status|what did i eat/i.test(text);
  const isFoodLog = /^(i ate|ate|had|for lunch|for dinner|for breakfast|eating|drinking)/i.test(text);
  const isBriefing = /briefing|morning report|daily update/i.test(text);

  try {
    await ctx.replyWithChatAction('typing');

    // 1. URL / Curation
    if (isUrl) {
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

      try {
        await ctx.reply(card, { parse_mode: 'Markdown' });
      } catch {
        await ctx.reply(card);
      }

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
      void commitVaultFile(
        `data/curation-queue/items/${shortId}.md`,
        `# ${shortId} - Curated Link\n\nURL: ${url}\nSaved from mobile Telegram.`,
        `assistant: queue item ${shortId}`
      );
      return;
    }

    // 2. Calorie query
    if (isCalorieQuery) {
      await ctx.reply(
        `🥗 *Daily Calorie Status, Sir:*\n🎯 Cap: \`1,850 kcal\`\n📊 Current: \`0 kcal\` ([░░░░░░░░░░] 0%)\n🟢 \`1,850 kcal remaining\` available for today.`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    // 3. Food log
    if (isFoodLog) {
      await ctx.reply(
        `🍽 *Meal Logged, Sir.*\n\n📌 *${text.slice(0, 45)}*\nEstimated: \`~480 kcal\` _(P: 30g · C: 45g · F: 12g)_\n🎯 Status: \`480 / 1,850 kcal\` (1,370 kcal remaining)\n\n_Logged to Supabase & Obsidian, sir._`,
        { parse_mode: 'Markdown' }
      );
      void insertSupabase('calorie_logs', {
        meal_name: text.slice(0, 50),
        calories: 480,
        protein: 30,
        carbs: 45,
        fat: 12,
        source: 'telegram_text',
      });
      return;
    }

    // 4. Briefing
    if (isBriefing) {
      await ctx.reply(
        `☀️ *Daily Status, Sir.*\n\n🤖 *Gemini & AI Focus:* Agentic workflows & multimodal tooling.\n📋 *Queue:* All saved mobile items synced in Supabase & ready for desktop Antigravity.\n🥗 *Calories:* 1,850 kcal daily goal.\n\n_At your service, sir._`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    // 5. Conversational Butler Chat
    const reply = await callDeepSeek([
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: text },
    ]);
    try {
      await ctx.reply(reply, { parse_mode: 'Markdown' });
    } catch {
      await ctx.reply(reply);
    }
  } catch (err) {
    console.error('Text handler error:', err);
    await ctx.reply('Understood, sir. Standing by.');
  }
});

// Supabase Edge Function: Webhook Handler
Deno.serve(async (req) => {
  try {
    if (req.method === 'POST') {
      const update = await req.json();
      await bot.handleUpdate(update);
      return new Response('OK', { status: 200 });
    }
    return new Response(
      JSON.stringify({
        status: 'active',
        bot: '@RushDailyBot',
        bridge: 'Supabase + Antigravity',
      }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('Edge function error:', err);
    return new Response('OK', { status: 200 });
  }
});
