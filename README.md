# Rush — Personal Telegram Assistant 🤖

Your own AI assistant inside Telegram: chat with memory, quick notes, reminders,
and a daily briefing. Built with **grammY + DeepSeek**, storage is **your
Obsidian vault** (a private git repo), and it's deployed on **Vercel** with
**GitHub Actions** as the free cron scheduler.

## Features

| Feature | How |
|---|---|
| 💬 **AI chat with memory** | Plain messages go to DeepSeek (`deepseek-chat`) with the last ~12 turns of chat history. `/forget` clears it. |
| 📝 **Notes → Obsidian** | `/note Buy milk #groceries` writes a real markdown file into your vault at `data/assistant/notes/` — it shows up in Obsidian (and stays private; the public portfolio sync only publishes `notes/`). `/notes [search]`, `/delnote <id>`. |
| ⏰ **Reminders** | `/remind water plants at 6pm`, `/remind stretch in 30 minutes`, `/remind call mom tomorrow 8am`. Natural-language times. Stored in `data/assistant/reminders.json` in the vault. |
| ☀️ **Daily briefing** | Weather (Open-Meteo, no key) + top tech/AI headlines (Hacker News) + your portfolio's public view counter, wrapped into a warm brief by DeepSeek. |
| 🔐 **Private by design** | The vault repo is private; assistant data lives under `data/assistant/`, never in the published `notes/` folder. Cron endpoints require `CRON_SECRET`. |

## Commands

```
/start          welcome + menu
/help           all commands
/note <text>    save a note into the vault (#tags supported)
/notes [query]  list or search notes
/delnote <id>   delete a note
/remind <task> at <time>   set a reminder
/reminders      upcoming reminders
/done <id>      mark a reminder done
/briefing       daily briefing on demand
/forget         clear chat memory
/status         AI + vault status
/id             show chat id
```

## Architecture

```
Telegram ──webhook──▶ /api/webhook ──▶ grammY bot ──▶ DeepSeek API
     ▲                                        │
     │                                        └─▶ GitHub API ──▶ obsidian-vault (private repo)
     └──◀── GitHub Actions cron ──▶ /api/cron-reminders (every 10 min)
          (07:00 daily)        ──▶ /api/cron-briefing
                                                      │
                                          Obsidian app syncs down
                                          (Obsidian Git plugin pull)
```

- **Vercel** hosts the bot as serverless functions. Webhooks only — no long polling in production.
- **Your Obsidian vault** (`emmanalcazarjr-ops/obsidian-vault`) is the database. The bot writes/reads files via the GitHub Git Data + Contents APIs with a fine-grained PAT.
- **GitHub Actions** (free) is the scheduler: `cron-reminders.yml` every 10 minutes, `cron-briefing.yml` at 07:00 Asia/Manila.

### Vault file layout

```
data/assistant/
├── notes/*.md            ← notes as real markdown (visible in Obsidian)
├── notes-index.json      ← fast search index for /notes
├── reminders.json        ← reminders (JSON)
└── memory/<chatId>.json  ← chat memory per chat
```

## Setup

### 1. Bot token
Create a bot with [@BotFather](https://t.me/BotFather) → `/newbot` → copy the token.

### 2. Vault PAT (the only credential you create)
1. Go to https://github.com/settings/personal-access-tokens/new
2. **Repository access:** Only select repositories → `emmanalcazarjr-ops/obsidian-vault`
3. **Permissions → Contents:** Read and write (Metadata is auto-added)
4. Copy the token — it starts with `github_pat_`

### 3. Local dev
```bash
npm install
cp .env.example .env.local   # fill in BOT_TOKEN, VAULT_PAT, DEEPSEEK_API_KEY
npm run dev                  # long polling — talk to the bot right away
```

### 4. Deploy to Vercel
```bash
vercel --prod
```
Set environment variables in the Vercel project: `BOT_TOKEN`, `WEBHOOK_SECRET`,
`CRON_SECRET`, `VAULT_PAT`, `DEEPSEEK_API_KEY`, and optionally `OWNER_CHAT_ID`
(your Telegram chat id — get it with `/id`).

### 5. Wire the webhook
```bash
# in .env.local: WEBHOOK_URL=https://<your-app>.vercel.app/api/webhook
npm run set-webhook
npm run get-webhook   # verify
```

### 6. Cron via GitHub Actions
Add repo **secrets** / **variables**:
- Secret `CRON_SECRET` — same value as the Vercel env var.
- Variable `APP_URL` — `https://<your-app>.vercel.app`.

The two workflows under `.github/workflows/` take care of reminders and briefings.

## Obsidian sync tips

- Enable the **Obsidian Git** plugin's *"Pull changes before push"* so cloud
  commits from the assistant merge cleanly with your local edits.
- Open the `AI` folder as a vault (it already is one) and the assistant's notes
  will appear under `data/assistant/notes/`.

## Notes

- DeepSeek keys: create one at https://platform.deepseek.com (cheap).
- Chat memory keeps the last 12 turns per chat; `/forget` deletes them.
- Briefing weather defaults to Manila — override with `WEATHER_LAT` / `WEATHER_LON` / `WEATHER_CITY` / `TIMEZONE`.
- There is no separate database — the vault *is* the database.
