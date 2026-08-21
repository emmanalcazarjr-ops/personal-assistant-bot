# Rush — Personal Telegram Assistant & Antigravity Curation Bridge 🤖

Your own AI assistant inside Telegram and mobile bridge to Antigravity: doomscroll & link curation, AI triage into active projects / career goals, chat with memory, quick notes, reminders, and daily briefings.

Built with **grammY + DeepSeek + Antigravity**, storage is **your Obsidian vault** (a private git repo), and it's deployed on **Vercel** with **GitHub Actions** as the free cron scheduler.

## Features

| Feature | How |
|---|---|
| 📥 **Doomscroll & Link Curation** | Share/forward any URL, tweet, repo, job posting, or idea on your phone. Scrapes content, analyzes relevance via AI, extracts takeaways + action item, and queues it for Antigravity desktop. |
| 💼 **AI Triage & Categorization** | Automatically routes items to: 💼 `Career & Portfolio`, 🚀 `Active Projects` (water-station, portfolio, report-generator, chatbot-api), 💡 `New MVP Ideas`, or 📚 `Learning`. |
| 💻 **Antigravity Desktop Bridge** | View and execute tasks with `.agents/skills/curation-queue/` or `npm run queue`. 1-click execution in your codebase. |
| 💬 **AI chat with memory** | Plain messages go to DeepSeek (`deepseek-chat`) with the last ~12 turns of chat history. `/forget` clears it. |
| 📝 **Notes → Obsidian** | `/note Buy milk #groceries` writes a real markdown file into your vault at `data/assistant/notes/`. `/notes [search]`, `/delnote <id>`. |
| ⏰ **Reminders** | `/remind water plants at 6pm`, `/remind stretch in 30 minutes`, `/remind call mom tomorrow 8am`. Natural-language times. Stored in `data/assistant/reminders.json`. |
| ☀️ **Daily briefing** | Weather (Open-Meteo, no key) + top tech/AI headlines (Hacker News) + portfolio view counter, wrapped into a warm brief by DeepSeek. |
| 🔐 **Private by design** | The vault repo is private; data lives under `data/`, never in the published `notes/` folder. |

## Commands

```
/start                 welcome + menu
/help                  all commands
/queue, /q             view pending items in curation queue
/curate <link/note>    explicitly curate and analyze an item
/qdone <id>            mark a queue item as done (e.g. /qdone 101)
/note <text>           save a note into the vault (#tags supported)
/notes [query]         list or search notes
/delnote <id>          delete a note
/remind <task> at <t>  set a reminder
/reminders             upcoming reminders
/done <id>             mark a reminder done
/briefing              daily briefing on demand
/forget                clear chat memory
/status                AI + vault status
/id                    show chat id
```

## Architecture

```
Telegram ──webhook──▶ /api/webhook ──▶ grammY bot ──▶ DeepSeek / Gemini AI
     ▲                                        │
     │                                        ├─▶ Web Scraper (URL metadata/text)
     │                                        │
     │                                        └─▶ GitHub API ──▶ obsidian-vault (private repo)
     └──◀── GitHub Actions cron ──▶ /api/cron-reminders (10m)          │
          (07:00 daily)        ──▶ /api/cron-briefing                 ▼
                                                              Obsidian Vault Sync
                                                                      │
                                                                      ▼
                                                          Desktop Antigravity IDE
                                                        (.agents/skills/curation-queue)
```

### Vault file layout

```
data/
├── curation-queue/
│   ├── INBOX.md              ← Obsidian Kanban / task board with checkboxes
│   ├── queue.json            ← state machine & item metadata
│   └── items/*.md            ← detailed note per curated item
├── assistant/
│   ├── notes/*.md            ← notes as real markdown (visible in Obsidian)
│   ├── notes-index.json      ← fast search index for /notes
│   ├── reminders.json        ← reminders (JSON)
│   └── memory/<chatId>.json  ← chat memory per chat
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

### 4. CLI Queue Commands
```bash
npm run queue                # list pending queue items
npm run queue:all            # list all items (including completed)
npm run queue:view 101       # view details of #Q-101
npm run queue:done 101       # mark #Q-101 done
```

### 5. Deploy to Vercel
```bash
vercel --prod
```
Set environment variables in Vercel: `BOT_TOKEN`, `WEBHOOK_SECRET`, `CRON_SECRET`, `VAULT_PAT`, `DEEPSEEK_API_KEY`, and optionally `OWNER_CHAT_ID`.

### 6. Wire the webhook
```bash
npm run set-webhook
npm run get-webhook   # verify
```
