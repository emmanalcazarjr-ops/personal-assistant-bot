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
    { command: 'start', description: 'Welcome & Interactive Menu' },
    { command: 'help', description: 'How to use Rush (natural language guide)' },
  ]);
  console.log('✅ Menu commands registered');
} catch (e) {
  console.warn('setMyCommands failed (bot token missing?):', e);
}

bot.start({ onStart: (me) => console.log(`✅ Rush is polling as @${me.username} — press Ctrl+C to stop`) });

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.once(sig, () => bot.stop());
}
