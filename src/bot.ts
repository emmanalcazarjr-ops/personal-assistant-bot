/**
 * Rush — your personal Telegram assistant.
 * grammY bot with all commands + plain-text AI chat with memory + Antigravity Curation Queue.
 * One bot instance; webhook mode on Vercel, long polling in local dev.
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

const BOT_USERNAME = process.env.BOT_USERNAME || 'rushrush0406bot';

const HELP_TEXT = [
  '*Rush — your personal assistant & Antigravity bridge*',
  '',
  '📥 *Curation Queue (Mobile -> Antigravity Desktop)*',
  '• *Share/Forward any link or post* — I\'ll scrape it, classify it (Career/Projects/Ideas/Learning), extract action items, and sync it to your Obsidian vault queue.',
  '• `/curate <link or note>` — explicitly curate an item.',
  '• `/queue` or `/q` — view pending items in your queue.',
  '• `/qdone <id>` — mark a queue item as done (e.g. `/qdone 101`).',
  '',
  '💬 *Chat & Notes*',
  '• *Plain message* — AI chat with memory.',
  '• `/note <text>` — save a quick note (#tags supported).',
  '• `/notes [search]` — list or search your notes.',
  '• `/delnote <id>` — delete a note.',
  '',
  '⏰ *Reminders & Briefing*',
  '• `/remind <task> at <time>` — set natural language reminder.',
  '• `/reminders` — show upcoming reminders.',
  '• `/done <id>` — mark reminder done.',
  '• `/briefing` — get your daily briefing.',
  '• `/forget` — clear chat memory.',
  '• `/status` — check AI + vault status.',
  '',
  '_Built with grammY · DeepSeek · Obsidian Vault · Antigravity_',
].join('\n');

const REMIND_USAGE = [
  '⏰ *Set a reminder:*',
  '',
  '`/remind <task> at <time>`',
  '',
  'Examples:',
  '• `/remind water the plants at 6pm`',
  '• `/remind stretch in 30 minutes`',
  '• `/remind call mom tomorrow 8am`',
  '• `/remind submit report friday 5pm`',
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
    .text('📥 My Queue')
    .text('📝 Save a note')
    .row()
    .text('📋 My notes')
    .text('⏰ Set reminder')
    .row()
    .text('☀️ Daily briefing')
    .text('❓ Help')
    .resized();
}

export function createBot(): Bot {
  const bot = new Bot(config.botToken);
  bot.catch((err) => console.error('bot error:', err));

  // ---------- /start ----------
  bot.command('start', async (ctx) => {
    const name = ctx.from?.first_name || 'there';
    await ctx.reply(
      [
        `Hey ${name}! 👋 I'm *Rush*, your personal assistant and Antigravity bridge.`,
        '',
        '📱 *Doomscroll Curation*: Whenever you find an interesting article, repo, tweet, or idea on your phone, just send or forward it to me. I will analyze whether it belongs to your **career** or **projects** and queue it for your next Antigravity session.',
        '',
        '💬 You can also chat, save quick notes, set reminders, and ask for daily briefings.',
        '',
        'Use `/help` to see all commands.',
      ].join('\n'),
      { reply_markup: menuKeyboard(), parse_mode: 'Markdown' }
    );
    void vault.addMessage(ctx.chat.id, 'system', 'Started the assistant');
  });

  // ---------- /help ----------
  bot.command('help', async (ctx) => {
    await ctx.reply(HELP_TEXT, { parse_mode: 'Markdown' });
  });

  // ---------- /status ----------
  bot.command('status', async (ctx) => {
    const ai = hasDeepSeek() ? '✅ DeepSeek AI connected' : '❌ DeepSeek AI not configured';
    const vaultStatus = hasVault()
      ? '✅ Obsidian vault connected (GitHub API)'
      : '📁 Local Vault Mode (saving to workspace)';
    const pendingItems = await vault.listQueueItems('pending', 50);
    await ctx.reply(
      `*Status*\n\n${ai}\n${vaultStatus}\n📥 *Curation Queue:* ${pendingItems.length} pending item(s)`,
      { parse_mode: 'Markdown' }
    );
  });

  // ---------- /id ----------
  bot.command('id', async (ctx) => {
    await ctx.reply(`This chat's id is \`${ctx.chat.id}\``, { parse_mode: 'Markdown' });
  });

  // ---------- Curation Queue Commands ----------

  // Explicit curation command
  bot.command(['curate', 'save'], async (ctx) => {
    const text = (ctx.match as string)?.trim();
    if (!text) {
      await ctx.reply('Send what you want to curate, e.g.:\n`/curate https://github.com/... Next.js auth patterns`', {
        parse_mode: 'Markdown',
      });
      return;
    }
    await handleCuration(ctx, text);
  });

  // View active queue
  bot.command(['queue', 'q'], async (ctx) => {
    await showQueue(ctx);
  });

  // Mark queue item as done
  bot.command(['qdone', 'qcomplete'], async (ctx) => {
    const id = (ctx.match as string)?.trim();
    if (!id) {
      await ctx.reply('Usage: `/qdone <id>` (e.g. `/qdone 101` or `/qdone Q-101`)', { parse_mode: 'Markdown' });
      return;
    }
    const updated = await vault.updateQueueItemStatus(id, 'done');
    if (!updated) {
      await ctx.reply(`Couldn't find item \`#${id}\`. Check your queue with \`/queue\`.`, { parse_mode: 'Markdown' });
      return;
    }
    await ctx.reply(`✅ *Marked [#${updated.short_id}] as Done!*\n\n~~${updated.title}~~\nUpdated in Obsidian vault.`, {
      parse_mode: 'Markdown',
    });
  });

  // ---------- notes ----------
  bot.command('note', async (ctx) => {
    const raw = (ctx.match as string)?.trim();
    if (!raw) {
      await ctx.reply('Send me the note like: `/note Buy milk and eggs #groceries`', {
        parse_mode: 'Markdown',
      });
      return;
    }
    const tags = raw.split(/\s+/).filter((w) => /^#/.test(w)).map((w) => w.replace(/^#+/, ''));
    const content = raw.split(/\s+/).filter((w) => !/^#/.test(w)).join(' ').trim() || raw;
    const note = await vault.addNote(ctx.chat.id, content, tags);
    if (!note) {
      await ctx.reply('⚠️ Couldn\'t save the note.');
      return;
    }
    const tagLine = tags.length ? `\n\n_Tags:_ ${tags.map((t) => `#${t}`).join(' ')}` : '';
    await ctx.reply(`📝 *Saved note #${note.id}*${tagLine}\n\n${content}`, { parse_mode: 'Markdown' });
  });

  bot.command('notes', async (ctx) => {
    const q = (ctx.match as string)?.trim() || undefined;
    const notes = await vault.listNotes(ctx.chat.id, q);
    if (notes.length === 0) {
      await ctx.reply(q ? `Nothing found for “${q}”.` : 'No notes yet. Save one with `/note <text>`!');
      return;
    }
    const lines = notes.map((n, i) => {
      const tagLine = n.tags.length ? ` _(${n.tags.map((t) => `#${t}`).join(' ')})_` : '';
      return `${i + 1}. \`#${n.id}\` ${n.content}${tagLine}`;
    });
    await ctx.reply(`*${q ? `Notes matching “${q}”` : 'Your notes'}*\n\n${lines.join('\n')}`, {
      parse_mode: 'Markdown',
    });
  });

  bot.command('delnote', async (ctx) => {
    const id = String((ctx.match as string)?.trim() || '');
    if (!id) {
      await ctx.reply('Usage: `/delnote <note id>` — find ids with `/notes`.');
      return;
    }
    const ok = await vault.deleteNote(ctx.chat.id, id);
    await ctx.reply(ok ? `🗑 Deleted note #${id}.` : `Couldn't delete #${id} — check the id with /notes.`);
  });

  // ---------- reminders ----------
  bot.command('remind', async (ctx) => {
    const raw = (ctx.match as string)?.trim();
    if (!raw) {
      await ctx.reply(REMIND_USAGE, { parse_mode: 'Markdown' });
      return;
    }
    const parsed = extractReminderTime(raw);
    if (!parsed) {
      await ctx.reply(
        "I couldn't work out the time. Try e.g. `/remind water plants at 6pm`, `/remind stretch in 30 minutes`, `/remind call mom tomorrow 8am`.",
        { parse_mode: 'Markdown' }
      );
      return;
    }
    if (!parsed.rest) {
      await ctx.reply('What should I remind you about? e.g. `/remind water the plants at 6pm`');
      return;
    }
    if (parsed.due.getTime() <= Date.now()) {
      await ctx.reply('⏰ That time already passed — try a future time!');
      return;
    }
    const reminder = await vault.addReminder(ctx.chat.id, parsed.rest, parsed.due);
    if (!reminder) {
      await ctx.reply('⚠️ Couldn\'t save the reminder.');
      return;
    }
    await ctx.reply(
      `✅ Got it — I'll remind you to *${parsed.rest}* on ${formatDue(parsed.due)}.\n_(reminder id ${reminder.id})_`,
      { parse_mode: 'Markdown' }
    );
  });

  bot.command('reminders', async (ctx) => {
    const list = await vault.listUpcomingReminders(ctx.chat.id);
    if (list.length === 0) {
      await ctx.reply('No upcoming reminders. Set one with `/remind <task> at <time>`!');
      return;
    }
    const lines = list.map((r) => `• \`#${r.id}\` ${r.text} — _${formatDue(new Date(r.due_at))}_`);
    await ctx.reply(`📌 *Upcoming reminders*\n\n${lines.join('\n')}`, { parse_mode: 'Markdown' });
  });

  bot.command('done', async (ctx) => {
    const id = String((ctx.match as string)?.trim() || '');
    if (!id) {
      await ctx.reply('Usage: `/done <reminder id>` — find ids with `/reminders`.');
      return;
    }
    const ok = await vault.markReminderDone(id);
    await ctx.reply(ok ? `✅ Marked reminder #${id} as done.` : `Couldn't find reminder #${id}.`);
  });

  // ---------- briefing ----------
  bot.command('briefing', async (ctx) => {
    await ctx.replyWithChatAction('typing');
    const text = await generateBriefing();
    await ctx.reply(text, { parse_mode: 'Markdown' });
  });

  // ---------- memory ----------
  bot.command('forget', async (ctx) => {
    await vault.clearMemory(ctx.chat.id);
    await ctx.reply('🧹 Done — I\'ve forgotten our conversation. Fresh start!');
  });

  // ---------- menu button handlers ----------
  bot.hears('📥 My Queue', async (ctx) => {
    await showQueue(ctx);
  });
  bot.hears('📝 Save a note', (ctx) =>
    ctx.reply('Send me the note like: `/note Buy milk and eggs #groceries`')
  );
  bot.hears('📋 My notes', async (ctx) => {
    const notes = await vault.listNotes(ctx.chat.id);
    await ctx.reply(
      notes.length === 0
        ? 'No notes yet. Save one with `/note <text>`!'
        : `*Your notes*\n\n${notes
            .map((n, i) => `${i + 1}. \`#${n.id}\` ${n.content}`)
            .join('\n')}`,
      { parse_mode: 'Markdown' }
    );
  });
  bot.hears('⏰ Set reminder', (ctx) => ctx.reply(REMIND_USAGE, { parse_mode: 'Markdown' }));
  bot.hears('☀️ Daily briefing', async (ctx) => {
    await ctx.replyWithChatAction('typing');
    const text = await generateBriefing();
    await ctx.reply(text, { parse_mode: 'Markdown' });
  });
  bot.hears('❓ Help', (ctx) => ctx.reply(HELP_TEXT, { parse_mode: 'Markdown' }));

  // ---------- Inline Keyboard Callback Queries ----------
  bot.on('callback_query:data', async (ctx) => {
    const data = ctx.callbackQuery.data;
    await ctx.answerCallbackQuery();

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
        );
      }
    } else if (data.startsWith('qdone:')) {
      const itemId = data.split(':')[1];
      const updated = await vault.updateQueueItemStatus(itemId, 'done');
      if (updated) {
        await ctx.editMessageText(
          `✅ *[#${updated.short_id}] Marked as Done!*\n\n~~${updated.title}~~\n\n_Completed and updated in Obsidian._`,
          { parse_mode: 'Markdown' }
        );
      }
    } else if (data.startsWith('qdel:')) {
      const itemId = data.split(':')[1];
      const updated = await vault.updateQueueItemStatus(itemId, 'archived');
      if (updated) {
        await ctx.editMessageText(`🗑 *[#${updated.short_id}] Archived and removed from queue.*`, {
          parse_mode: 'Markdown',
        });
      }
    }
  });

  // ---------- Message Handler (Auto-Curation or Chat) ----------
  bot.on('message:text', async (ctx) => {
    const text = ctx.message.text.trim();
    if (!text) return;

    // Check if message is a URL or forwarded article/tweet/post
    const url = extractUrl(text);
    const isForward = Boolean((ctx.message as any).forward_origin || (ctx.message as any).forward_from || (ctx.message as any).forward_from_chat);

    // If message contains a URL, automatically trigger the Curation Engine
    if (url) {
      await handleCuration(ctx, text, url, isForward ? 'forward' : 'url');
      return;
    }

    // In groups, stay quiet unless mentioned or replying to the bot
    if (ctx.chat.type !== 'private') {
      const mentioned = text.toLowerCase().includes('@' + BOT_USERNAME.toLowerCase());
      const replyingToBot = ctx.message.reply_to_message?.from?.is_bot === true;
      if (!mentioned && !replyingToBot) return;
    }

    // Normal plain chat with memory
    await ctx.replyWithChatAction('typing');

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
          "⚠️ My AI brain isn't switched on yet — the DEEPSEEK_API_KEY hasn't been configured.\n\nMeanwhile I can still help with `/queue`, `/note`, `/remind`, `/reminders` and `/briefing`.";
      } else {
        console.error('chat failed:', e);
        reply = '⚠️ I hit a snag talking to the AI brain. Give me a few seconds and try again!';
      }
    }

    await ctx.reply(reply);
    void vault.addMessage(ctx.chat.id, 'user', text);
    void vault.addMessage(ctx.chat.id, 'assistant', reply);
  });

  return bot;
}

/** Helper to display the pending queue */
async function showQueue(ctx: any) {
  const items = await vault.listQueueItems('pending', 15);
  if (items.length === 0) {
    await ctx.reply(
      '📥 *Your Antigravity Curation Queue is empty!*\n\nShare any link, tweet, article, or project idea to add it to your queue.',
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
    `📥 *Antigravity Curation Queue (${items.length} pending)*\n\n${lines.join('\n\n')}\n\n_Use \`/qdone <id>\` to mark done, or open Antigravity on desktop to execute!_`,
    { parse_mode: 'Markdown' }
  );
}

/** Core curation pipeline runner */
async function handleCuration(
  ctx: any,
  rawText: string,
  urlOverride?: string,
  sourceType: 'url' | 'text' | 'forward' = 'text'
) {
  await ctx.replyWithChatAction('typing');

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
    await ctx.reply('⚠️ Failed to save queue item to vault.');
    return;
  }

  const cardText = formatTelegramQueueCard(queueItem);
  await ctx.reply(cardText, {
    parse_mode: 'Markdown',
    reply_markup: makeCategoryKeyboard(queueItem.short_id),
  });
}
