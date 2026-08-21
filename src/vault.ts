/**
 * Obsidian vault storage backend.
 *
 * The vault is your private git repo (emmanalcazarjr-ops/obsidian-vault).
 * This module reads/writes files inside it through the GitHub Git Data +
 * Contents APIs using a fine-grained PAT (VAULT_PAT — contents read/write
 * on obsidian-vault only).
 *
 * Layout inside the vault (all under `data/` so the public
 * portfolio sync — which only publishes `notes/` — never exposes them):
 *   data/assistant/notes/*.md            — notes as real markdown (show up in Obsidian)
 *   data/assistant/memory/<chatId>.json  — chat memory per chat
 *   data/assistant/reminders.json        — reminders
 *   data/assistant/notes-index.json      — fast search index for notes
 *   data/curation-queue/items/*.md       — rich curation items from Telegram
 *   data/curation-queue/queue.json       — queue index and state machine
 *   data/curation-queue/INBOX.md         — Obsidian action dashboard
 *
 * Exposes the same function names the bot uses, so swapping backends is a
 * one-line import change. Every call degrades gracefully on failure.
 */
import { config, hasVault } from './config.ts';
import type { CurationAnalysis, CurationCategory, QueueItem, QueueStatus } from './curation.ts';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const OWNER = process.env.VAULT_OWNER || 'emmanalcazarjr-ops';
const REPO = process.env.VAULT_REPO || 'obsidian-vault';
const BRANCH = 'main';

const NOTES_DIR = 'data/assistant/notes';
const MEMORY_DIR = 'data/assistant/memory';
const REMINDERS_PATH = 'data/assistant/reminders.json';
const NOTES_INDEX_PATH = 'data/assistant/notes-index.json';

const QUEUE_ITEMS_DIR = 'data/curation-queue/items';
const QUEUE_INDEX_PATH = 'data/curation-queue/queue.json';
const QUEUE_INBOX_PATH = 'data/curation-queue/INBOX.md';

export interface ChatMessage {
  id: number;
  chat_id: number;
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at: string;
}

export interface Reminder {
  id: string;
  chat_id: number;
  text: string;
  due_at: string;
  done: boolean;
}

export interface Note {
  id: string;
  chat_id: number;
  content: string;
  tags: string[];
  created_at: string;
}

interface MemoryFile {
  messages: { role: 'user' | 'assistant'; content: string; ts: string }[];
}
interface RemindersFile {
  reminders: Reminder[];
}
interface NotesIndexFile {
  notes: { id: string; path: string; snippet: string; tags: string[]; created_at: string }[];
}

export interface QueueIndexFile {
  last_seq: number;
  items: QueueItem[];
}

// ---------------- Local filesystem fallback / mirroring ----------------

function getLocalVaultRoot(): string {
  // If running inside personal-assistant-bot, .. is the vault root.
  // If running from repo root, . is the vault root.
  const cwd = process.cwd();
  if (cwd.endsWith('personal-assistant-bot') || cwd.endsWith('telegram-bot')) {
    return path.resolve(cwd, '..');
  }
  return cwd;
}

async function writeLocalFile(relPath: string, content: string): Promise<void> {
  try {
    const fullPath = path.join(getLocalVaultRoot(), relPath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content, 'utf-8');
  } catch {
    // Ignore local fs errors in serverless environments
  }
}

async function readLocalFile(relPath: string): Promise<string | null> {
  try {
    const fullPath = path.join(getLocalVaultRoot(), relPath);
    return await fs.readFile(fullPath, 'utf-8');
  } catch {
    return null;
  }
}

// ---------------- GitHub plumbing ----------------

function encodePath(pathStr: string): string {
  return pathStr.split('/').map(encodeURIComponent).join('/');
}

async function gh(pathStr: string, init?: RequestInit): Promise<Response> {
  return fetch(`https://api.github.com${pathStr}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${config.vaultPat}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'personal-assistant-bot',
      ...(init?.headers || {}),
    },
  });
}

async function getBranchHead(): Promise<string> {
  const r = await gh(`/repos/${OWNER}/${REPO}/git/ref/heads/${BRANCH}`);
  if (!r.ok) throw new Error(`git ref ${r.status}`);
  const j = (await r.json()) as { object: { sha: string } };
  return j.object.sha;
}

/** Read a small text file from the vault (null when it doesn't exist). */
async function readText(pathStr: string): Promise<string | null> {
  if (hasVault()) {
    try {
      const r = await gh(`/repos/${OWNER}/${REPO}/contents/${encodePath(pathStr)}?ref=${BRANCH}`, {
        headers: { Accept: 'application/vnd.github.raw' },
      });
      if (r.status === 404) return null;
      if (r.ok) return await r.text();
    } catch (e) {
      console.warn(`GitHub read failed for ${pathStr}, falling back to local:`, e);
    }
  }
  return await readLocalFile(pathStr);
}

/** Create/overwrite one file with a single commit. Throws on 409 (stale). */
async function commitFile(pathStr: string, content: string, message: string): Promise<void> {
  // Mirror to local disk
  await writeLocalFile(pathStr, content);

  if (!hasVault()) return;

  const head = await getBranchHead();

  const blobRes = await gh(`/repos/${OWNER}/${REPO}/git/blobs`, {
    method: 'POST',
    body: JSON.stringify({ content, encoding: 'utf-8' }),
  });
  if (!blobRes.ok) throw new Error(`blob ${blobRes.status}`);
  const blobSha = ((await blobRes.json()) as { sha: string }).sha;

  const treeRes = await gh(`/repos/${OWNER}/${REPO}/git/trees`, {
    method: 'POST',
    body: JSON.stringify({
      base_tree: head,
      tree: [{ path: pathStr, mode: '100644', type: 'blob', sha: blobSha }],
    }),
  });
  if (!treeRes.ok) throw new Error(`tree ${treeRes.status}`);
  const treeSha = ((await treeRes.json()) as { sha: string }).sha;

  const commitRes = await gh(`/repos/${OWNER}/${REPO}/git/commits`, {
    method: 'POST',
    body: JSON.stringify({ message, tree: treeSha, parents: [head] }),
  });
  if (!commitRes.ok) throw new Error(`commit ${commitRes.status}`);
  const commitSha = ((await commitRes.json()) as { sha: string }).sha;

  const refRes = await gh(`/repos/${OWNER}/${REPO}/git/refs/heads/${BRANCH}`, {
    method: 'PATCH',
    body: JSON.stringify({ sha: commitSha, force: false }),
  });
  if (!refRes.ok) throw new Error(`update ref ${refRes.status}`);
}

/** Delete one file via the Contents API (needs its current sha). */
async function deleteFile(pathStr: string, message: string): Promise<void> {
  try {
    const fullPath = path.join(getLocalVaultRoot(), pathStr);
    await fs.unlink(fullPath).catch(() => {});
  } catch {}

  if (!hasVault()) return;

  const meta = await gh(`/repos/${OWNER}/${REPO}/contents/${encodePath(pathStr)}?ref=${BRANCH}`);
  if (meta.status === 404) return;
  if (!meta.ok) throw new Error(`delete meta ${meta.status}`);
  const j = (await meta.json()) as { sha: string };
  const r = await gh(`/repos/${OWNER}/${REPO}/contents/${encodePath(pathStr)}`, {
    method: 'DELETE',
    body: JSON.stringify({ message, sha: j.sha }),
  });
  if (!r.ok) throw new Error(`delete ${r.status}`);
}

/**
 * Read-modify-write a JSON file with optimistic concurrency.
 * Re-reads fresh content and retries on stale/network failures.
 */
async function updateJson<T>(pathStr: string, mutate: (current: T) => T, empty: T): Promise<T> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const raw = await readText(pathStr);
      let current = empty;
      if (raw) {
        try {
          current = JSON.parse(raw) as T;
        } catch {
          current = empty;
        }
      }
      const next = mutate(current);
      await commitFile(pathStr, JSON.stringify(next, null, 2), `assistant: update ${pathStr}`);
      return next;
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('updateJson failed');
}

function memoryPath(chatId: number): string {
  return `${MEMORY_DIR}/${chatId}.json`;
}

// ---------------- chat memory ----------------

export async function addMessage(chatId: number, role: string, content: string): Promise<void> {
  try {
    await updateJson<MemoryFile>(
      memoryPath(chatId),
      (cur) => {
        const messages = [...(cur.messages || []), { role: role as 'user' | 'assistant', content, ts: new Date().toISOString() }];
        return { messages: messages.slice(-12) };
      },
      { messages: [] }
    );
  } catch (e) {
    console.error('addMessage failed:', e);
  }
}

export async function getRecentMessages(chatId: number, limit = 12): Promise<ChatMessage[]> {
  try {
    const raw = await readText(memoryPath(chatId));
    if (!raw) return [];
    const j = JSON.parse(raw) as MemoryFile;
    return (j.messages || [])
      .slice(-limit)
      .map((m) => ({
        id: 0,
        chat_id: chatId,
        role: m.role,
        content: m.content,
        created_at: m.ts,
      }));
  } catch (e) {
    console.error('getRecentMessages failed:', e);
    return [];
  }
}

export async function clearMemory(chatId: number): Promise<void> {
  try {
    await commitFile(memoryPath(chatId), JSON.stringify({ messages: [] }, null, 2), 'assistant: clear memory');
  } catch (e) {
    console.error('clearMemory failed:', e);
  }
}

/** Chats that have talked to the bot (fallback briefing targets). */
export async function getActiveChatIds(_days = 30): Promise<number[]> {
  if (hasVault()) {
    try {
      const r = await gh(`/repos/${OWNER}/${REPO}/contents/${encodePath(MEMORY_DIR)}?ref=${BRANCH}`);
      if (r.status === 404) return [];
      if (r.ok) {
        const j = (await r.json()) as { name: string }[];
        return j
          .map((f) => Number(f.name.replace('.json', '')))
          .filter((n) => Number.isFinite(n));
      }
    } catch (e) {
      console.error('getActiveChatIds failed:', e);
    }
  }
  return [];
}

// ---------------- notes ----------------

export async function addNote(chatId: number, content: string, tags: string[]): Promise<Note | null> {
  try {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const slug =
      content
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 50) || 'note';
    const filePath = `${NOTES_DIR}/${id}-${slug}.md`;
    const created = new Date().toISOString();
    const md = [
      '---',
      `created: ${created}`,
      'tags:',
      ...(tags.length ? tags.map((t) => `  - "${t}"`) : ['  - inbox']),
      '---',
      '',
      content,
      '',
    ].join('\n');

    await commitFile(filePath, md, `assistant: add note ${id}`);
    await updateJson<NotesIndexFile>(
      NOTES_INDEX_PATH,
      (cur) => ({
        notes: [
          { id, path: filePath, snippet: content.slice(0, 120), tags, created_at: created },
          ...(cur.notes || []),
        ].slice(0, 500),
      }),
      { notes: [] }
    );
    return { id, chat_id: chatId, content, tags, created_at: created };
  } catch (e) {
    console.error('addNote failed:', e);
    return null;
  }
}

export async function listNotes(chatId: number, query?: string, limit = 10): Promise<Note[]> {
  try {
    const raw = await readText(NOTES_INDEX_PATH);
    if (!raw) return [];
    const j = JSON.parse(raw) as NotesIndexFile;
    const q = query?.toLowerCase();
    let notes = j.notes || [];
    if (q) {
      notes = notes.filter(
        (n) => n.snippet.toLowerCase().includes(q) || n.tags.some((t) => t.toLowerCase().includes(q))
      );
    }
    return notes.slice(0, limit).map((n) => ({
      id: n.id,
      chat_id: chatId,
      content: n.snippet,
      tags: n.tags,
      created_at: n.created_at,
    }));
  } catch (e) {
    console.error('listNotes failed:', e);
    return [];
  }
}

export async function deleteNote(chatId: number, id: string): Promise<boolean> {
  try {
    const raw = await readText(NOTES_INDEX_PATH);
    if (!raw) return false;
    const j = JSON.parse(raw) as NotesIndexFile;
    const target = (j.notes || []).find((n) => n.id === id);
    if (!target) return false;
    await deleteFile(target.path, `assistant: delete note ${id}`);
    await updateJson<NotesIndexFile>(
      NOTES_INDEX_PATH,
      (cur) => ({ notes: (cur.notes || []).filter((n) => n.id !== id) }),
      { notes: [] }
    );
    return true;
  } catch (e) {
    console.error('deleteNote failed:', e);
    return false;
  }
}

// ---------------- reminders ----------------

export async function addReminder(chatId: number, text: string, dueAt: Date): Promise<Reminder | null> {
  try {
    let created: Reminder | null = null;
    await updateJson<RemindersFile>(
      REMINDERS_PATH,
      (cur) => {
        const list = cur.reminders || [];
        const row: Reminder = {
          id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
          chat_id: chatId,
          text,
          due_at: dueAt.toISOString(),
          done: false,
        };
        created = row;
        return { reminders: [...list, row] };
      },
      { reminders: [] }
    );
    return created;
  } catch (e) {
    console.error('addReminder failed:', e);
    return null;
  }
}

export async function listUpcomingReminders(chatId: number, limit = 10): Promise<Reminder[]> {
  try {
    const raw = await readText(REMINDERS_PATH);
    if (!raw) return [];
    const j = JSON.parse(raw) as RemindersFile;
    const now = new Date().toISOString();
    return (j.reminders || [])
      .filter((r) => r.chat_id === chatId && !r.done && r.due_at >= now)
      .sort((a, b) => a.due_at.localeCompare(b.due_at))
      .slice(0, limit);
  } catch (e) {
    console.error('listUpcomingReminders failed:', e);
    return [];
  }
}

export async function getDueReminders(): Promise<Reminder[]> {
  try {
    const raw = await readText(REMINDERS_PATH);
    if (!raw) return [];
    const j = JSON.parse(raw) as RemindersFile;
    const now = new Date().toISOString();
    return (j.reminders || []).filter((r) => !r.done && r.due_at <= now);
  } catch (e) {
    console.error('getDueReminders failed:', e);
    return [];
  }
}

export async function markReminderDone(id: string): Promise<boolean> {
  try {
    await updateJson<RemindersFile>(
      REMINDERS_PATH,
      (cur) => ({
        reminders: (cur.reminders || []).map((r) => (r.id === id ? { ...r, done: true } : r)),
      }),
      { reminders: [] }
    );
    return true;
  } catch (e) {
    console.error('markReminderDone failed:', e);
    return false;
  }
}

// ---------------- Curation Queue (Antigravity Bridge) ----------------

export function renderInboxMarkdown(items: QueueItem[]): string {
  const pending = items.filter((i) => i.status === 'pending' || i.status === 'in_progress');
  const done = items.filter((i) => i.status === 'done' || i.status === 'archived').slice(0, 15);

  const careerItems = pending.filter((i) => i.category === 'career');
  const projectItems = pending.filter((i) => i.category === 'project');
  const ideaItems = pending.filter((i) => i.category === 'idea');
  const learningItems = pending.filter((i) => i.category === 'learning');
  const referenceItems = pending.filter((i) => i.category === 'reference');

  const renderSection = (list: QueueItem[]) => {
    if (list.length === 0) return `*No active items in this category.*`;
    return list
      .map((item) => {
        const prioBadge = item.priority === 'high' ? '🔴 **High**' : item.priority === 'medium' ? '🟡 Medium' : '🟢 Low';
        const urlPart = item.url ? ` ([link](${item.url}))` : '';
        const targetBadge = `\`[${item.target_project}]\``;
        const whyPart = item.why_it_matters ? `\n   - 🎯 **Why:** ${item.why_it_matters}` : '';
        const actionPart = item.antigravity_action ? `\n   - 🛠 **Antigravity Action:** \`${item.antigravity_action}\`` : '';
        return `- [ ] **[#${item.short_id}]** **${item.title}** ${targetBadge} — ${prioBadge}${urlPart}${whyPart}${actionPart}`;
      })
      .join('\n');
  };

  const renderDoneSection = (list: QueueItem[]) => {
    if (list.length === 0) return `*No completed items yet.*`;
    return list
      .map((item) => `- [x] ~~**[#${item.short_id}]** ${item.title} \`[${item.target_project}]\`~~`)
      .join('\n');
  };

  return [
    `# 📥 Antigravity Curation Queue & Action Board`,
    ``,
    `> **Mobile-to-Desktop Stream**: Items curated from Telegram mobile browsing. Ready for execution in Antigravity.`,
    `> Last updated: ${new Date().toISOString()}`,
    ``,
    `---`,
    ``,
    `## 💼 Career & Portfolio (${careerItems.length})`,
    renderSection(careerItems),
    ``,
    `## 🚀 Active Projects (${projectItems.length})`,
    renderSection(projectItems),
    ``,
    `## 💡 New Project & MVP Ideas (${ideaItems.length})`,
    renderSection(ideaItems),
    ``,
    `## 📚 Skills & Deep-Dive Learning (${learningItems.length})`,
    renderSection(learningItems),
    ``,
    `## 📌 References & Tools (${referenceItems.length})`,
    renderSection(referenceItems),
    ``,
    `---`,
    ``,
    `## ✅ Recently Completed / Archived (${done.length})`,
    renderDoneSection(done),
    ``,
  ].join('\n');
}

/** Add a new curated item to the queue, write individual markdown item and update INBOX.md */
export async function addQueueItem(
  chatId: number,
  analysis: CurationAnalysis,
  rawInput: string,
  url?: string,
  sourceType: 'url' | 'text' | 'forward' = 'text'
): Promise<QueueItem | null> {
  try {
    const created = new Date().toISOString();
    const dateStr = created.slice(0, 10);
    const id = 'q_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

    let createdItem: QueueItem | null = null;

    await updateJson<QueueIndexFile>(
      QUEUE_INDEX_PATH,
      (cur) => {
        const nextSeq = (cur.last_seq || 100) + 1;
        const shortId = `Q-${nextSeq}`;
        const item: QueueItem = {
          ...analysis,
          id,
          short_id: shortId,
          chat_id: chatId,
          url,
          source_type: sourceType,
          status: 'pending',
          raw_input: rawInput,
          created_at: created,
        };
        createdItem = item;
        const allItems = [item, ...(cur.items || [])];
        return {
          last_seq: nextSeq,
          items: allItems,
        };
      },
      { last_seq: 100, items: [] }
    );

    if (!createdItem) return null;

    const item: QueueItem = createdItem;
    const slug = (item.title || 'item')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);

    const itemFilePath = `${QUEUE_ITEMS_DIR}/${dateStr}-${item.short_id}-${slug}.md`;
    const itemMarkdown = [
      '---',
      `id: "${item.id}"`,
      `short_id: "${item.short_id}"`,
      `title: "${item.title.replace(/"/g, '\\"')}"`,
      `category: "${item.category}"`,
      `target_project: "${item.target_project}"`,
      `priority: "${item.priority}"`,
      `status: "${item.status}"`,
      `created_at: "${item.created_at}"`,
      item.url ? `url: "${item.url}"` : null,
      'tags:',
      `  - "curation-queue"`,
      `  - "${item.category}"`,
      `  - "${item.target_project}"`,
      '---',
      '',
      `# ${item.title}`,
      '',
      `**Category:** ${item.category.toUpperCase()} | **Target:** \`${item.target_project}\` | **Priority:** ${item.priority.toUpperCase()}`,
      item.url ? `**Source URL:** [${item.url}](${item.url})` : '',
      '',
      `## 💡 Key Takeaways`,
      ...item.takeaways.map((t) => `- ${t}`),
      '',
      `## 🎯 Why This Matters to Emman`,
      item.why_it_matters,
      '',
      `## 🛠 Antigravity Action Item`,
      `- [ ] **${item.antigravity_action}**`,
      '',
      `## 📝 Raw Captured Input`,
      '```',
      item.raw_input,
      '```',
      '',
    ]
      .filter((l) => l !== null)
      .join('\n');

    await commitFile(itemFilePath, itemMarkdown, `assistant: add queue item ${item.short_id}`);

    // Update INBOX.md dashboard
    const allItems = await listQueueItems();
    const inboxMd = renderInboxMarkdown(allItems);
    await commitFile(QUEUE_INBOX_PATH, inboxMd, `assistant: refresh INBOX.md`);

    return item;
  } catch (e) {
    console.error('addQueueItem failed:', e);
    return null;
  }
}

/** List all queue items with optional status filter */
export async function listQueueItems(statusFilter?: QueueStatus | 'all', limit = 50): Promise<QueueItem[]> {
  try {
    const raw = await readText(QUEUE_INDEX_PATH);
    if (!raw) return [];
    const j = JSON.parse(raw) as QueueIndexFile;
    const items = j.items || [];
    if (!statusFilter || statusFilter === 'all') {
      return items.slice(0, limit);
    }
    return items.filter((i) => i.status === statusFilter).slice(0, limit);
  } catch (e) {
    console.error('listQueueItems failed:', e);
    return [];
  }
}

/** Get a specific queue item by its short_id (e.g. Q-101 or 101) or full id */
export async function getQueueItem(idOrShortId: string): Promise<QueueItem | null> {
  try {
    const items = await listQueueItems('all', 500);
    const cleanId = idOrShortId.trim().toLowerCase();
    return (
      items.find(
        (i) =>
          i.id.toLowerCase() === cleanId ||
          i.short_id.toLowerCase() === cleanId ||
          i.short_id.toLowerCase().replace('q-', '') === cleanId
      ) || null
    );
  } catch (e) {
    console.error('getQueueItem failed:', e);
    return null;
  }
}

/** Update the status of a queue item (pending, in_progress, done, archived) */
export async function updateQueueItemStatus(
  idOrShortId: string,
  newStatus: QueueStatus
): Promise<QueueItem | null> {
  try {
    let updatedItem: QueueItem | null = null;
    const cleanId = idOrShortId.trim().toLowerCase();

    await updateJson<QueueIndexFile>(
      QUEUE_INDEX_PATH,
      (cur) => {
        const items = (cur.items || []).map((item) => {
          if (
            item.id.toLowerCase() === cleanId ||
            item.short_id.toLowerCase() === cleanId ||
            item.short_id.toLowerCase().replace('q-', '') === cleanId
          ) {
            const updated: QueueItem = {
              ...item,
              status: newStatus,
              updated_at: new Date().toISOString(),
              completed_at: newStatus === 'done' ? new Date().toISOString() : item.completed_at,
            };
            updatedItem = updated;
            return updated;
          }
          return item;
        });
        return { ...cur, items };
      },
      { last_seq: 100, items: [] }
    );

    if (updatedItem) {
      const allItems = await listQueueItems();
      const inboxMd = renderInboxMarkdown(allItems);
      await commitFile(QUEUE_INBOX_PATH, inboxMd, `assistant: update item status ${idOrShortId}`);
    }

    return updatedItem;
  } catch (e) {
    console.error('updateQueueItemStatus failed:', e);
    return null;
  }
}

/** Update category or target project of a queue item */
export async function updateQueueItemCategory(
  idOrShortId: string,
  newCategory: CurationCategory,
  newTarget?: string
): Promise<QueueItem | null> {
  try {
    let updatedItem: QueueItem | null = null;
    const cleanId = idOrShortId.trim().toLowerCase();

    await updateJson<QueueIndexFile>(
      QUEUE_INDEX_PATH,
      (cur) => {
        const items = (cur.items || []).map((item) => {
          if (
            item.id.toLowerCase() === cleanId ||
            item.short_id.toLowerCase() === cleanId ||
            item.short_id.toLowerCase().replace('q-', '') === cleanId
          ) {
            const updated: QueueItem = {
              ...item,
              category: newCategory,
              target_project: newTarget || item.target_project,
              updated_at: new Date().toISOString(),
            };
            updatedItem = updated;
            return updated;
          }
          return item;
        });
        return { ...cur, items };
      },
      { last_seq: 100, items: [] }
    );

    if (updatedItem) {
      const allItems = await listQueueItems();
      const inboxMd = renderInboxMarkdown(allItems);
      await commitFile(QUEUE_INBOX_PATH, inboxMd, `assistant: update item category ${idOrShortId}`);
    }

    return updatedItem;
  } catch (e) {
    console.error('updateQueueItemCategory failed:', e);
    return null;
  }
}
