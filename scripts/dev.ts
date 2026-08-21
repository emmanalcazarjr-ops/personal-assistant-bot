/**
 * Local development runner: long polling (no webhook needed).
 *   npm install
 *   cp .env.example .env.local  (fill in BOT_TOKEN etc.)
 *   npm run dev
 */
// @ts-expect-error -- plain JS helper, no type declarations
import { loadEnv } from './load-env.mjs';
loadEnv();

const { createBot } = await import('../src/bot.ts');
const bot = createBot();

try {
  await bot.api.setMyCommands([
    { command: 'start', description: 'Welcome + menu' },
    { command: 'help', description: 'Show all commands' },
    { command: 'calories', description: 'Check today\'s calories & macros (1850 kcal cap)' },
    { command: 'eat', description: 'Log meal description, e.g. /eat 2 eggs and rice' },
    { command: 'setcap', description: 'Update daily calorie cap (default 1850)' },
    { command: 'queue', description: 'View Antigravity curation queue' },
    { command: 'curate', description: 'Curate link or idea for Antigravity' },
    { command: 'qdone', description: 'Mark curation queue item done' },
    { command: 'note', description: 'Save a note (add #tags)' },
    { command: 'notes', description: 'List or search notes' },
    { command: 'delnote', description: 'Delete a note by id' },
    { command: 'remind', description: 'Set a reminder, e.g. /remind task at 6pm' },
    { command: 'reminders', description: 'Show upcoming reminders' },
    { command: 'done', description: 'Mark a reminder done' },
    { command: 'briefing', description: 'Get your daily briefing now' },
    { command: 'forget', description: 'Clear chat memory' },
    { command: 'status', description: 'Check AI + storage status' },
    { command: 'id', description: 'Show this chat id' },
  ]);
  console.log('✅ Menu commands registered');
} catch (e) {
  console.warn('setMyCommands failed (bot token missing?):', e);
}

bot.start({ onStart: (me) => console.log(`✅ Rush is polling as @${me.username} — press Ctrl+C to stop`) });

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.once(sig, () => bot.stop());
}
