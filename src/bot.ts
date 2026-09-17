/**
 * Rush — your personal Telegram assistant & AI Coding Butler.
 * 100% natural language AI co-pilot + automatic intent analysis (no commands required).
 * Handles Daily AI Coding Micro-Projects, GitHub Streaks, Curation, Reminders, Notes, and Briefings.
 */
import { Bot, Keyboard, InlineKeyboard } from 'grammy';
import { config, hasDeepSeek, hasGemini, hasVault } from './config.ts';
import * as vault from './vault.ts';
import { chatCompletion, DeepSeekError } from './deepseek.ts';
import { extractReminderTime, formatDue } from './time.ts';
import { generateBriefing, fetchAiNews } from './briefing.ts';
import {
  analyzeCurationItem,
  extractUrl,
  fetchUrlMetadata,
  formatTelegramQueueCard,
  makeCategoryKeyboard,
  type CurationCategory,
} from './curation.ts';
import {
  generateDailyCodingChallenge,
  formatCodingChallengeCard,
  formatBoilerplateCard,
  type CodingChallenge,
} from './coding-challenge.ts';
import {
  fetchGitHubStreak,
  formatStreakCard,
  createGitHubGist,
} from './github-streak.ts';
import { classifyIntent, type IntentResult } from './intent.ts';

const BOT_USERNAME = process.env.BOT_USERNAME || 'RushDailyBot';

// Cache latest active challenge in memory
let cachedChallenge: CodingChallenge | null = null;

const NATURAL_GUIDE_TEXT = [
  '🎩 <b>Rush — Personal AI Butler & Daily Coding Co-Pilot</b>',
  '',
  'You do not need to use any commands, sir! You can simply message me naturally:',
  '',
  '⚡ <b>Daily AI Coding Micro-Projects</b>',
  '• <i>"What should I code today?"</i> or tap <b>⚡ Daily Coding Task</b> ➔ I generate 1 high-leverage 15–30 min coding challenge grounded in trending AI news.',
  '• <i>"Generate the boilerplate"</i> ➔ I emit clean, runnable starter code with setup commands.',
  '',
  '🔥 <b>GitHub Contribution Streak Watchdog</b>',
  '• <i>"How\'s my GitHub streak?"</i> or tap <b>🔥 GitHub Streak</b> ➔ Live GitHub API verification of today\'s commit count and active streak.',
  '• At <b>7:00 PM</b>, I verify your daily commits and alert you if code hasn\'t been pushed yet.',
  '',
  '📥 <b>Career & Antigravity Curation</b>',
  '• Share/forward any link, tweet, repo, or idea ➔ I triage it and sync it directly to your desktop Antigravity queue.',
  '',
  '⏰ <b>Reminders & Notes</b>',
  '• <i>"Remind me to push code at 5pm"</i> or <i>"Note down: new agent pattern #ai"</i>.',
  '',
  '☀️ <b>Daily Briefings</b>',
  '• Morning (7:00 AM) AI news & micro-project + Evening (7:00 PM) streak watchdog.',
  '',
  '<i>At your service, sir.</i>',
].join('\n');

function systemPrompt(): string {
  const today = new Intl.DateTimeFormat('en-PH', {
    timeZone: config.timezone,
    dateStyle: 'full',
  }).format(new Date());
  return [
    'You are Rush, a sharp, executive AI butler and expert coding co-pilot for Emman (address him as "sir").',
    'CRITICAL RULE: Keep ALL responses as short, crisp, and direct as possible (1-3 sentences or direct cards/snippets).',
    'Do NOT provide lengthy explanations, lists, or essays UNLESS sir explicitly asks you to expound, elaborate, or explain in detail.',
    'Use a natural professional-casual tone (e.g. "Good morning, sir", "Right away, sir", "Understood, sir"). Zero corporate fluff.',
    'If you are unsure about something, state so plainly in one sentence.',
    `Today is ${today}.`,
  ].join(' ');
}

function menuKeyboard() {
  return new Keyboard()
    .text('⚡ Daily Coding Task')
    .text('🔥 GitHub Streak')
    .row()
    .text('📥 My Queue')
    .text('☀️ Daily Briefing')
    .row()
    .text('📋 My Notes')
    .text('⏰ My Reminders')
    .row()
    .text('❓ How to use')
    .resized();
}

export function createBot(): Bot {
  const bot = new Bot(config.botToken);
  bot.catch((err) => console.error('bot error:', err));

  // Optional start command for new chats
  bot.command('start', async (ctx) => {
    const name = ctx.from?.first_name || 'sir';
    await ctx.reply(
      [
        `Good day, ${name}! 👋 I am <b>Rush</b>, your personal AI butler and daily coding co-pilot.`,
        '',
        'Everything is 100% natural language:',
        '• ⚡ Ask <i>"What should I code today?"</i> for daily AI micro-projects',
        '• 🔥 Ask <i>"How\'s my streak?"</i> to monitor your GitHub commit momentum',
        '• 🔗 Share/forward any link to queue it for desktop Antigravity work',
        '• ⏰ Ask me to set reminders or take notes',
      ].join('\n'),
      { reply_markup: menuKeyboard(), parse_mode: 'HTML' }
    );
    void vault.addMessage(ctx.chat.id, 'system', 'Started the assistant');
  });

  bot.command('help', async (ctx) => {
    await ctx.reply(NATURAL_GUIDE_TEXT, { parse_mode: 'HTML' });
  });

  // ---------- Menu Button Listeners ----------
  bot.hears(/⚡ Daily Coding Task|daily\s+coding|coding\s+challenge/i, async (ctx) => {
    await handleCodingChallenge(ctx);
  });
  bot.hears(/🔥 GitHub Streak|github\s+streak|my\s+streak/i, async (ctx) => {
    await showGitHubStreak(ctx);
  });
  bot.hears(/📥 My Queue|queue/i, async (ctx) => {
    await showQueue(ctx);
  });
  bot.hears(/☀️ Daily Briefing|briefing/i, async (ctx) => {
    await ctx.replyWithChatAction('typing');
    const text = await generateBriefing();
    await ctx.reply(text, { parse_mode: 'HTML' });
  });
  bot.hears(/📋 My Notes|notes/i, async (ctx) => {
    await showNotes(ctx);
  });
  bot.hears(/⏰ My Reminders|reminders/i, async (ctx) => {
    await showReminders(ctx);
  });
  bot.hears(/❓ How to use|help/i, (ctx) =>
    ctx.reply(NATURAL_GUIDE_TEXT, { parse_mode: 'HTML' })
  );

  // ---------- Inline Keyboard Callback Queries ----------
  bot.on('callback_query:data', async (ctx) => {
    const data = ctx.callbackQuery.data;
    await ctx.answerCallbackQuery().catch(() => {});

    try {
      if (data === 'gen_boilerplate') {
        await ctx.replyWithChatAction('typing');
        if (!cachedChallenge) {
          const news = await fetchAiNews();
          cachedChallenge = await generateDailyCodingChallenge(news.map((n) => n.title));
        }
        const card = formatBoilerplateCard(cachedChallenge);
        const scaffoldKeyboard = new InlineKeyboard()
          .text('🌐 Create GitHub Gist', 'scaffold_gist');
        await ctx.reply(card, { parse_mode: 'HTML', reply_markup: scaffoldKeyboard });
      } else if (data === 'scaffold_gist') {
        await ctx.replyWithChatAction('typing');
        if (!cachedChallenge) {
          await ctx.reply('No active coding challenge found to scaffold, sir.');
          return;
        }
        const gistUrl = await createGitHubGist(
          cachedChallenge.boilerplate.filename,
          cachedChallenge.boilerplate.code,
          `Rush AI Daily Challenge: ${cachedChallenge.title}`
        );
        if (gistUrl) {
          await ctx.reply(`✅ <b>GitHub Gist Scaffolded!</b>\n\n🔗 <a href="${gistUrl}">View on GitHub</a>\n\nClone and run: <code>${cachedChallenge.boilerplate.runCommand}</code>`, { parse_mode: 'HTML' });
        } else {
          await ctx.reply('⚠️ Unable to create GitHub Gist. Make sure GITHUB_TOKEN / VAULT_PAT has gist permissions, sir.');
        }
      } else if (data.startsWith('qcat:')) {
        const parts = data.split(':');
        const itemId = parts[1];
        const newCategory = parts[2] as CurationCategory;
        const updated = await vault.updateQueueItemCategory(itemId, newCategory);
        if (updated) {
          await ctx.editMessageText(
            formatTelegramQueueCard(updated) + `\n\n_Updated category to ${newCategory.toUpperCase()}._`,
            {
              parse_mode: 'Markdown',
              reply_markup: makeCategoryKeyboard(updated.short_id),
            }
          ).catch(() => {});
        }
      } else if (data.startsWith('qdone:')) {
        const itemId = data.split(':')[1];
        const updated = await vault.updateQueueItemStatus(itemId, 'done');
        if (updated) {
          await ctx.editMessageText(
            `✅ *[#${updated.short_id}] Marked as Done!*\n\n~~${updated.title}~~\n\n_Completed and updated in Obsidian._`,
            { parse_mode: 'Markdown' }
          ).catch(() => {});
        }
      } else if (data.startsWith('qdel:')) {
        const itemId = data.split(':')[1];
        const updated = await vault.updateQueueItemStatus(itemId, 'archived');
        if (updated) {
          await ctx.editMessageText(`🗑 *[#${updated.short_id}] Archived and removed from queue.*`, {
            parse_mode: 'Markdown',
          }).catch(() => {});
        }
      }
    } catch (e) {
      console.warn('Callback error handled:', e);
    }
  });

  // ---------- Universal Natural Language Message Router ----------
  bot.on('message:text', async (ctx) => {
    const text = ctx.message.text.trim();
    if (!text) return;

    // Check if message is a forwarded article/tweet/post
    const isForward = Boolean(
      (ctx.message as any).forward_origin ||
        (ctx.message as any).forward_from ||
        (ctx.message as any).forward_from_chat
    );

    // In groups, stay quiet unless mentioned or replying to the bot
    if (ctx.chat.type !== 'private') {
      const mentioned = text.toLowerCase().includes('@' + BOT_USERNAME.toLowerCase());
      const replyingToBot = ctx.message.reply_to_message?.from?.is_bot === true;
      if (!mentioned && !replyingToBot) return;
    }

    await ctx.replyWithChatAction('typing');

    // Automatically classify intent using AI & heuristics
    const intentResult: IntentResult = await classifyIntent(text, isForward);

    switch (intentResult.intent) {
      case 'coding_challenge': {
        await handleCodingChallenge(ctx);
        break;
      }

      case 'generate_boilerplate': {
        await handleGenerateBoilerplate(ctx);
        break;
      }

      case 'github_streak': {
        await showGitHubStreak(ctx);
        break;
      }

      case 'curation': {
        await handleCuration(ctx, text, undefined, isForward ? 'forward' : 'url');
        break;
      }

      case 'reminder': {
        await handleNaturalReminder(ctx, text, intentResult);
        break;
      }

      case 'note': {
        await handleNaturalNote(ctx, text, intentResult);
        break;
      }

      case 'briefing': {
        const briefingText = await generateBriefing();
        await ctx.reply(briefingText, { parse_mode: 'HTML' });
        break;
      }

      case 'chat':
      default: {
        await handleConversationalChat(ctx, text);
        break;
      }
    }
  });

  return bot;
}

/** 1. Handle Daily AI Coding Challenge */
async function handleCodingChallenge(ctx: any) {
  await ctx.replyWithChatAction('typing');
  const news = await fetchAiNews();
  cachedChallenge = await generateDailyCodingChallenge(news.map((n) => n.title));
  const card = formatCodingChallengeCard(cachedChallenge);

  const keyboard = new InlineKeyboard()
    .text('🚀 Generate Starter Boilerplate', 'gen_boilerplate');

  await ctx.reply(card, { parse_mode: 'HTML', reply_markup: keyboard });
}

/** 2. Handle Starter Boilerplate Generation */
async function handleGenerateBoilerplate(ctx: any) {
  await ctx.replyWithChatAction('typing');
  if (!cachedChallenge) {
    const news = await fetchAiNews();
    cachedChallenge = await generateDailyCodingChallenge(news.map((n) => n.title));
  }
  const card = formatBoilerplateCard(cachedChallenge);
  const scaffoldKeyboard = new InlineKeyboard()
    .text('🌐 Create GitHub Gist', 'scaffold_gist');
  await ctx.reply(card, { parse_mode: 'HTML', reply_markup: scaffoldKeyboard });
}

/** 3. Show GitHub Streak Status */
async function showGitHubStreak(ctx: any) {
  await ctx.replyWithChatAction('typing');
  const streak = await fetchGitHubStreak();
  const card = formatStreakCard(streak);
  await ctx.reply(card, { parse_mode: 'HTML' });
}

/** 4. Show Active Antigravity Queue */
async function showQueue(ctx: any) {
  const items = await vault.listQueueItems('pending', 15);
  if (items.length === 0) {
    await ctx.reply(
      '📥 *Your Antigravity Curation Queue is empty, sir.*\n\nShare any link, tweet, article, or project idea to add it to your queue.',
      { parse_mode: 'Markdown' }
    );
    return;
  }

  const categoryEmoji: Record<string, string> = {
    career: '💼',
    project: '🚀',
    idea: '💡',
    learning: '📚',
    reference: '📌',
  };

  const lines = items.map((item, idx) => {
    const icon = categoryEmoji[item.category] || '📌';
    const prio = item.priority === 'high' ? '🔴' : item.priority === 'medium' ? '🟡' : '🟢';
    return `${idx + 1}. \`[#${item.short_id}]\` ${icon} *${item.title}* (${item.target_project}) ${prio}\n   👉 _${item.antigravity_action}_`;
  });

  await ctx.reply(
    `📥 *Antigravity Curation Queue (${items.length} pending)*\n\n${lines.join('\n\n')}\n\n_Open Antigravity on desktop whenever you are ready to execute, sir!_`,
    { parse_mode: 'Markdown' }
  );
}

/** 5. Curate Link or Project Idea */
async function handleCuration(
  ctx: any,
  rawText: string,
  urlOverride?: string,
  sourceType: 'url' | 'text' | 'forward' = 'text'
) {
  const detectedUrl = urlOverride || extractUrl(rawText);
  let urlMeta = null;

  if (detectedUrl) {
    urlMeta = await fetchUrlMetadata(detectedUrl);
  }

  const analysis = await analyzeCurationItem(rawText, urlMeta);
  const queueItem = await vault.addQueueItem(
    ctx.chat.id,
    analysis,
    rawText,
    detectedUrl || undefined,
    detectedUrl ? (sourceType === 'forward' ? 'forward' : 'url') : 'text'
  );

  if (!queueItem) {
    await ctx.reply('⚠️ Failed to save queue item to vault, sir.');
    return;
  }

  const cardText = formatTelegramQueueCard(queueItem);
  await ctx.reply(cardText, {
    parse_mode: 'Markdown',
    reply_markup: makeCategoryKeyboard(queueItem.short_id),
  });
}

/** 6. Natural Reminder Handler */
async function handleNaturalReminder(ctx: any, text: string, intent: IntentResult) {
  const parsed = extractReminderTime(text);
  const taskText = parsed?.rest || intent.extracted?.reminder_task || text;
  const dueDate = parsed?.due || new Date(Date.now() + 60 * 60 * 1000);

  const reminder = await vault.addReminder(ctx.chat.id, taskText, dueDate);
  if (!reminder) {
    await ctx.reply('⚠️ Couldn\'t save the reminder, sir.');
    return;
  }

  await ctx.reply(
    `⏰ *Understood, sir.* I have scheduled a reminder for you:\n\n📌 *${taskText}*\n🗓 Due: _${formatDue(dueDate)}_`,
    { parse_mode: 'Markdown' }
  );
}

/** 7. Natural Note Handler */
async function handleNaturalNote(ctx: any, text: string, intent: IntentResult) {
  const noteContent = intent.extracted?.note_text || text;
  const tags = intent.extracted?.note_tags || [];
  const note = await vault.addNote(ctx.chat.id, noteContent, tags);
  if (!note) {
    await ctx.reply('⚠️ Couldn\'t save the note, sir.');
    return;
  }
  const tagLine = tags.length ? `\n\n_Tags:_ ${tags.map((t) => `#${t}`).join(' ')}` : '';
  await ctx.reply(`📝 *Saved to your notes, sir.*\n\n${noteContent}${tagLine}`, {
    parse_mode: 'Markdown',
  });
}

/** 8. Show Notes List */
async function showNotes(ctx: any) {
  const notes = await vault.listNotes(ctx.chat.id);
  if (notes.length === 0) {
    await ctx.reply('No notes saved yet, sir. You can tell me anything you would like to remember.');
    return;
  }
  const lines = notes.map((n, i) => `${i + 1}. \`#${n.id}\` ${n.content}`);
  await ctx.reply(`📋 *Your Notes:*\n\n${lines.join('\n')}`, { parse_mode: 'Markdown' });
}

/** 9. Show Upcoming Reminders */
async function showReminders(ctx: any) {
  const list = await vault.listUpcomingReminders(ctx.chat.id);
  if (list.length === 0) {
    await ctx.reply('No upcoming reminders, sir.');
    return;
  }
  const lines = list.map((r) => `• \`#${r.id}\` ${r.text} — _${formatDue(new Date(r.due_at))}_`);
  await ctx.reply(`⏰ *Upcoming Reminders:*\n\n${lines.join('\n')}`, { parse_mode: 'Markdown' });
}

/** 10. Conversational Butler Chat */
async function handleConversationalChat(ctx: any, text: string) {
  const history = await vault.getRecentMessages(ctx.chat.id, 12);
  const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
    { role: 'system', content: systemPrompt() },
    ...history.map((h) => ({ role: h.role as 'user' | 'assistant', content: h.content })),
    { role: 'user', content: text },
  ];

  let reply: string;
  try {
    reply = await chatCompletion(messages);
  } catch (e) {
    if (e instanceof DeepSeekError && e.message.includes('not set')) {
      reply =
        "⚠️ My AI brain isn't switched on yet — the GEMINI_API_KEY hasn't been configured.\n\nMeanwhile I can still help you with coding challenges, GitHub streaks, curation, and notes, sir.";
    } else {
      console.error('chat failed:', e);
      reply = '⚠️ I hit a snag connecting to the AI brain. Give me a moment and try again, sir!';
    }
  }

  await ctx.reply(reply);
  void vault.addMessage(ctx.chat.id, 'user', text);
  void vault.addMessage(ctx.chat.id, 'assistant', reply);
}
