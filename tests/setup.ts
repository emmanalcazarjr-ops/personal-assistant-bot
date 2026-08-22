// Deterministic offline environment for all tests.
// Runs before src modules load (src/config.ts snapshots env at import time).
delete process.env.DEEPSEEK_API_KEY;
delete process.env.GEMINI_API_KEY;
delete process.env.BOT_TOKEN;
delete process.env.VAULT_PAT;
delete process.env.WEBHOOK_SECRET;
delete process.env.CRON_SECRET;
