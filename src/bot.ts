/**
 * Rush — your personal Telegram assistant.
 * grammY bot with all commands + plain-text AI chat with memory.
 * One bot instance; webhook mode on Vercel, long polling in local dev.
 */
import { Bot, Context, Keyboard } from 'grammy';
import { config, hasDeepSeek, hasVault } from './config.ts';
import * as vault from './vault.ts';
import { chatCompletion, DeepSeekError } from './deepseek.ts';
import { extractReminderTime, formatDue } from './time.ts';
import { generateBriefing } from './briefing.ts';

const BOT_USERNAME = process.env.BOT_USERNAME || 'rushrush0406bot';

const HELP_TEXT = [
  '*Rush — your personal assistant*',
  '',
  '💬 *Chat* — just send any message and I\'ll answer (I remember our chat).',
  '📝 */note <text>* — save a quick note (add #tags).',
  '📋 */notes [search]* — list or search your notes.',
  '🗑 */delnote <id>* — delete a note.',
  '⏰ */remind <task> at <time>* — e.g. `/remind water plants at 6pm`, `/remind stretch in 30 minutes`, `/remind call mom tomorrow 8am`.',
  '📌 */reminders* — show upcoming reminders.',
  '✅ */done <id>* — mark a reminder done.',
  '☀️ */briefing* — get your daily briefing right now.',
  '🧹 */forget* — clear my memory of this chat.',
  'ℹ️ */status* — check AI + vault status.',
  '',
  '_Built with grammY · DeepSeek · Obsidian vault_',
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
    'You are Rush, a friendly personal AI assistant running on Telegram.',
    'Be warm, concise and practical. Use plain language — no jargon, no buzzwords.',
    'You help with questions, ideas, planning, writing and quick research from your own knowledge.',
    'If you are unsure about something, say so honestly instead of guessing.',
    `Today is ${today}.`,
  ].join(' ');
}

function menuKeyboard() {
  return new Keyboard()
    .text('📝 Save a note')
    .text('📋 My notes')
    .row()
    .text('⏰ Set reminder')
    .text('☀️ Daily briefing')
    .row()
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
        `Hey ${name}! 👋 I'm *Rush*, your personal assistant.`,
        '',
        'I can chat with you (and remember our conversation), save notes, set reminders, and give you a daily briefing.',
        '',
        'Just type a message to chat, or use the buttons below. `/help` shows every command.',
      ].join('\n'),
      { reply_markup: menuKeyboard() }
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
    const vaultStatus = hasVault() ? '✅ Obsidian vault connected' : '❌ Obsidian vault not connected (missing VAULT_PAT)';
    await ctx.reply(`*Status*\n\n${ai}\n${vaultStatus}`);
  });

  // ---------- /id ----------
  bot.command('id', async (ctx) => {
    await ctx.reply(`This chat's id is \`${ctx.chat.id}\``);
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
      await ctx.reply('⚠️ Couldn\'t save the note — the Obsidian vault isn\'t connected yet (VAULT_PAT missing).');
      return;
    }
    const tagLine = tags.length ? `\n\n_Tags:_ ${tags.map((t) => `#${t}`).join(' ')}` : '';
    await ctx.reply(`📝 *Saved note #${note.id}*${tagLine}\n\n${content}`);
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
      await ctx.reply('⚠️ Couldn\'t save the reminder — the Obsidian vault isn\'t connected yet (VAULT_PAT missing).');
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

  // ---------- menu buttons ----------
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

  // ---------- plain chat with memory ----------
  bot.on('message:text', async (ctx) => {
    const text = ctx.message.text.trim();
    if (!text) return;

    // In groups, stay quiet unless mentioned or replying to the bot
    if (ctx.chat.type !== 'private') {
      const mentioned = text.toLowerCase().includes('@' + BOT_USERNAME.toLowerCase());
      const replyingToBot = ctx.message.reply_to_message?.from?.is_bot === true;
      if (!mentioned && !replyingToBot) return;
    }

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
          "⚠️ My AI brain isn't switched on yet — the DEEPSEEK_API_KEY hasn't been configured.\n\nMeanwhile I can still help with `/note`, `/remind`, `/reminders` and `/briefing`.";
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
