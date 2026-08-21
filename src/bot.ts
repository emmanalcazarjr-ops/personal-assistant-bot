/**
 * Rush — your personal Telegram assistant.
 * 100% natural language AI butler + automatic intent analysis (no commands required).
 * Handles Food/Calories, Career/Curation, Reminders, Notes, and Briefings autonomously.
 */
import { Bot, Keyboard } from 'grammy';
import { config, hasDeepSeek, hasVault } from './config.ts';
import * as vault from './vault.ts';
import { chatCompletion, DeepSeekError } from './deepseek.ts';
import { extractReminderTime, formatDue } from './time.ts';
import { generateBriefing } from './briefing.ts';
import {
  analyzeCurationItem,
  extractUrl,
  fetchUrlMetadata,
  formatTelegramQueueCard,
  makeCategoryKeyboard,
  type CurationCategory,
} from './curation.ts';
import {
  analyzeMealPhoto,
  analyzeMealText,
  formatDailyCalorieSummary,
  formatMealLoggedCard,
  DEFAULT_CALORIE_CAP,
} from './calories.ts';
import { classifyIntent, type IntentResult } from './intent.ts';

const BOT_USERNAME = process.env.BOT_USERNAME || 'RushDailyBot';

const NATURAL_GUIDE_TEXT = [
  '🎩 *Rush — Personal AI Butler & Antigravity Bridge*',
  '',
  'You do not need to use any commands, sir! You can simply message me naturally, and I will automatically handle the rest:',
  '',
  '🥗 *Food & Calorie Tracking (1,850 kcal cap)*',
  '• *Send a photo of your plate* ➔ I will automatically estimate portions, calculate calories/macros, and update your daily ledger.',
  '• *Type what you ate* (e.g. _"Had 2 eggs, 1 cup of white rice, and chicken breast"_) ➔ I log your nutrition and show your live progress bar.',
  '• *Ask about your intake* (e.g. _"How many calories do I have left today?"_) ➔ I will show your daily breakdown.',
  '',
  '📥 *Career & Antigravity Curation*',
  '• *Share or forward any link, tweet, repo, or idea* ➔ I triage it into Career/Projects/Ideas/Learning and sync it directly to your desktop Antigravity queue.',
  '',
  '⏰ *Reminders & Notes*',
  '• *Tell me what to remember* (e.g. _"Remind me to deploy the bot at 6pm"_ or _"Don\'t let me forget the meeting tomorrow at 9am"_).',
  '• *Jot down a quick thought* (e.g. _"Note: look into Supabase connection pooling #backend"_).',
  '',
  '☀️ *Daily Briefings*',
  '• *Ask anytime* (e.g. _"Give me my morning briefing"_ or _"What\'s the news today?"_).',
  '• I also deliver your automatic briefing at **7:00 AM** and **7:00 PM** daily.',
  '',
  '_At your service, sir._',
].join('\n');

function systemPrompt(): string {
  const today = new Intl.DateTimeFormat('en-PH', {
    timeZone: config.timezone,
    dateStyle: 'full',
  }).format(new Date());
  return [
    'You are Rush, a polished, professional yet casually courteous personal AI assistant and butler for Emman (address him as "sir").',
    'Be sharp, concise, respectful, and proactive. Use a natural professional-casual tone (e.g. "Good morning, sir", "Right away, sir", "Understood, sir").',
    'Avoid corporate fluff, jargon, or preachy language. Deliver clear, actionable value for his projects, learning, and daily tasks.',
    'If you are unsure about something, state so plainly and directly.',
    `Today is ${today}.`,
  ].join(' ');
}

function menuKeyboard() {
  return new Keyboard()
    .text('🥗 Today\'s Calories')
    .text('📥 My Queue')
    .row()
    .text('☀️ Daily Briefing')
    .text('📋 My Notes')
    .row()
    .text('⏰ My Reminders')
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
        `Good day, ${name}! 👋 I am *Rush*, your personal AI assistant and butler.`,
        '',
        'You don\'t need any commands—just talk to me naturally:',
        '• 📸 Send a food picture or type what you ate to count calories (1,850 kcal cap)',
        '• 🔗 Share/forward any link or idea to add it to your Antigravity desktop queue',
        '• ⏰ Ask me to set reminders or take notes',
        '• 💬 Ask me anything else anytime',
      ].join('\n'),
      { reply_markup: menuKeyboard(), parse_mode: 'Markdown' }
    );
    void vault.addMessage(ctx.chat.id, 'system', 'Started the assistant');
  });

  bot.command('help', async (ctx) => {
    await ctx.reply(NATURAL_GUIDE_TEXT, { parse_mode: 'Markdown' });
  });

  // ---------- Menu Button Listeners ----------
  bot.hears(/🥗 Today's Calories|calories/i, async (ctx) => {
    await showCalories(ctx);
  });
  bot.hears(/📥 My Queue|queue/i, async (ctx) => {
    await showQueue(ctx);
  });
  bot.hears(/☀️ Daily Briefing|briefing/i, async (ctx) => {
    await ctx.replyWithChatAction('typing');
    const text = await generateBriefing();
    await ctx.reply(text, { parse_mode: 'Markdown' });
  });
  bot.hears(/📋 My Notes|notes/i, async (ctx) => {
    await showNotes(ctx);
  });
  bot.hears(/⏰ My Reminders|reminders/i, async (ctx) => {
    await showReminders(ctx);
  });
  bot.hears(/❓ How to use|help/i, (ctx) =>
    ctx.reply(NATURAL_GUIDE_TEXT, { parse_mode: 'Markdown' })
  );

  // ---------- Photo Handler (Automatic Multimodal Food & Calorie Recognition) ----------
  bot.on('message:photo', async (ctx) => {
    const photos = ctx.message.photo;
    if (!photos || photos.length === 0) return;
    const photo = photos[photos.length - 1]; // Highest resolution image

    await ctx.replyWithChatAction('typing');
    try {
      const file = await ctx.api.getFile(photo.file_id);
      if (!file.file_path) throw new Error('No file path returned by Telegram');

      const downloadUrl = `https://api.telegram.org/file/bot${config.botToken}/${file.file_path}`;
      const res = await fetch(downloadUrl);
      if (!res.ok) throw new Error(`Download failed: ${res.status}`);

      const buffer = Buffer.from(await res.arrayBuffer());
      const caption = ctx.message.caption;

      const analysis = await analyzeMealPhoto(buffer, 'image/jpeg', caption);
      const result = await vault.addMealLog(
        ctx.chat.id,
        analysis,
        'photo',
        caption || 'Meal photo'
      );

      if (!result) {
        await ctx.reply('⚠️ Unable to record meal into your calorie ledger, sir.');
        return;
      }

      const card = formatMealLoggedCard(result.meal, result.daily);
      await ctx.reply(card, { parse_mode: 'Markdown' });
    } catch (err) {
      console.error('Meal photo processing error:', err);
      await ctx.reply(
        '⚠️ Failed to analyze meal photo. You can also tell me what you ate in plain text, sir.',
        { parse_mode: 'Markdown' }
      );
    }
  });

  // ---------- Inline Keyboard Callback Queries (Queue Actions) ----------
  bot.on('callback_query:data', async (ctx) => {
    const data = ctx.callbackQuery.data;
    await ctx.answerCallbackQuery().catch(() => {});

    try {
      if (data.startsWith('qcat:')) {
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
      case 'food_log': {
        const foodDesc = intentResult.extracted?.food_description || text;
        await handleMealTextLogging(ctx, foodDesc);
        break;
      }

      case 'food_query': {
        await showCalories(ctx);
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
        await ctx.reply(briefingText, { parse_mode: 'Markdown' });
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

/** 1. Show Calorie Ledger Status */
async function showCalories(ctx: any) {
  const daily = await vault.getDailyCalories();
  const text = formatDailyCalorieSummary(daily);
  await ctx.reply(text, { parse_mode: 'Markdown' });
}

/** 2. Log Food from Natural Text */
async function handleMealTextLogging(ctx: any, text: string) {
  const analysis = await analyzeMealText(text);
  const result = await vault.addMealLog(ctx.chat.id, analysis, 'text', text);
  if (!result) {
    await ctx.reply('⚠️ Failed to save meal to your calorie ledger, sir.');
    return;
  }
  const card = formatMealLoggedCard(result.meal, result.daily);
  await ctx.reply(card, { parse_mode: 'Markdown' });
}

/** 3. Show Active Antigravity Queue */
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

/** 4. Curate Link or Project Idea */
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

/** 5. Natural Reminder Handler */
async function handleNaturalReminder(ctx: any, text: string, intent: IntentResult) {
  const parsed = extractReminderTime(text);
  const taskText = parsed?.rest || intent.extracted?.reminder_task || text;
  const dueDate = parsed?.due || new Date(Date.now() + 60 * 60 * 1000); // default 1 hour if unspecified

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

/** 6. Natural Note Handler */
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

/** 7. Show Notes List */
async function showNotes(ctx: any) {
  const notes = await vault.listNotes(ctx.chat.id);
  if (notes.length === 0) {
    await ctx.reply('No notes saved yet, sir. You can tell me anything you would like to remember.');
    return;
  }
  const lines = notes.map((n, i) => `${i + 1}. \`#${n.id}\` ${n.content}`);
  await ctx.reply(`📋 *Your Notes:*\n\n${lines.join('\n')}`, { parse_mode: 'Markdown' });
}

/** 8. Show Upcoming Reminders */
async function showReminders(ctx: any) {
  const list = await vault.listUpcomingReminders(ctx.chat.id);
  if (list.length === 0) {
    await ctx.reply('No upcoming reminders, sir.');
    return;
  }
  const lines = list.map((r) => `• \`#${r.id}\` ${r.text} — _${formatDue(new Date(r.due_at))}_`);
  await ctx.reply(`⏰ *Upcoming Reminders:*\n\n${lines.join('\n')}`, { parse_mode: 'Markdown' });
}

/** 9. Conversational Butler Chat */
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
        "⚠️ My AI brain isn't switched on yet — the DEEPSEEK_API_KEY hasn't been configured.\n\nMeanwhile I can still help you with food tracking, curation, and notes, sir.";
    } else {
      console.error('chat failed:', e);
      reply = '⚠️ I hit a snag connecting to the AI brain. Give me a moment and try again, sir!';
    }
  }

  await ctx.reply(reply);
  void vault.addMessage(ctx.chat.id, 'user', text);
  void vault.addMessage(ctx.chat.id, 'assistant', reply);
}
