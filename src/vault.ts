/**
 * Obsidian vault storage backend.
 *
 * The vault is your private git repo (emmanalcazarjr-ops/obsidian-vault).
 * This module reads/writes files inside it through the GitHub Git Data +
 * Contents APIs using a fine-grained PAT (VAULT_PAT — contents read/write
 * on obsidian-vault only).
 *
 * Layout inside the vault (all under `data/assistant/` so the public
 * portfolio sync — which only publishes `notes/` — never exposes them):
 *   data/assistant/notes/*.md            — notes as real markdown (show up in Obsidian)
 *   data/assistant/memory/<chatId>.json  — chat memory per chat
 *   data/assistant/reminders.json        — reminders
 *   data/assistant/notes-index.json      — fast search index for notes
 *
 * Exposes the same function names the bot uses, so swapping backends is a
 * one-line import change. Every call degrades gracefully on failure.
 */
import { config, hasVault } from './config.ts';

const OWNER = process.env.VAULT_OWNER || 'emmanalcazarjr-ops';
const REPO = process.env.VAULT_REPO || 'obsidian-vault';
const BRANCH = 'main';

const NOTES_DIR = 'data/assistant/notes';
const MEMORY_DIR = 'data/assistant/memory';
const REMINDERS_PATH = 'data/assistant/reminders.json';
const NOTES_INDEX_PATH = 'data/assistant/notes-index.json';

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

// ---------------- GitHub plumbing ----------------

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

async function gh(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`https://api.github.com${path}`, {
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
async function readText(path: string): Promise<string | null> {
  const r = await gh(`/repos/${OWNER}/${REPO}/contents/${encodePath(path)}?ref=${BRANCH}`, {
    headers: { Accept: 'application/vnd.github.raw' },
  });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`read ${path} ${r.status}`);
  return r.text();
}

/** Create/overwrite one file with a single commit. Throws on 409 (stale). */
async function commitFile(path: string, content: string, message: string): Promise<void> {
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
      tree: [{ path, mode: '100644', type: 'blob', sha: blobSha }],
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
async function deleteFile(path: string, message: string): Promise<void> {
  const meta = await gh(`/repos/${OWNER}/${REPO}/contents/${encodePath(path)}?ref=${BRANCH}`);
  if (meta.status === 404) return;
  if (!meta.ok) throw new Error(`delete meta ${meta.status}`);
  const j = (await meta.json()) as { sha: string };
  const r = await gh(`/repos/${OWNER}/${REPO}/contents/${encodePath(path)}`, {
    method: 'DELETE',
    body: JSON.stringify({ message, sha: j.sha }),
  });
  if (!r.ok) throw new Error(`delete ${r.status}`);
}

/**
 * Read-modify-write a JSON file with optimistic concurrency.
 * Re-reads fresh content and retries on stale/network failures.
 */
async function updateJson<T>(path: string, mutate: (current: T) => T, empty: T): Promise<T> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const raw = await readText(path);
      let current = empty;
      if (raw) {
        try {
          current = JSON.parse(raw) as T;
        } catch {
          current = empty;
        }
      }
      const next = mutate(current);
      await commitFile(path, JSON.stringify(next, null, 2), `assistant: update ${path}`);
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
  if (!hasVault()) return;
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
  if (!hasVault()) return [];
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
  if (!hasVault()) return;
  try {
    await commitFile(memoryPath(chatId), JSON.stringify({ messages: [] }, null, 2), 'assistant: clear memory');
  } catch (e) {
    console.error('clearMemory failed:', e);
  }
}

/** Chats that have talked to the bot (fallback briefing targets). */
export async function getActiveChatIds(_days = 30): Promise<number[]> {
  if (!hasVault()) return [];
  try {
    const r = await gh(`/repos/${OWNER}/${REPO}/contents/${encodePath(MEMORY_DIR)}?ref=${BRANCH}`);
    if (r.status === 404) return [];
    if (!r.ok) return [];
    const j = (await r.json()) as { name: string }[];
    return j
      .map((f) => Number(f.name.replace('.json', '')))
      .filter((n) => Number.isFinite(n));
  } catch (e) {
    console.error('getActiveChatIds failed:', e);
    return [];
  }
}

// ---------------- notes ----------------

export async function addNote(chatId: number, content: string, tags: string[]): Promise<Note | null> {
  if (!hasVault()) return null;
  try {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const slug =
      content
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 50) || 'note';
    const path = `${NOTES_DIR}/${id}-${slug}.md`;
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

    await commitFile(path, md, `assistant: add note ${id}`);
    await updateJson<NotesIndexFile>(
      NOTES_INDEX_PATH,
      (cur) => ({
        notes: [
          { id, path, snippet: content.slice(0, 120), tags, created_at: created },
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
  if (!hasVault()) return [];
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
  if (!hasVault()) return false;
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
  if (!hasVault()) return null;
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
  if (!hasVault()) return [];
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
  if (!hasVault()) return [];
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
  if (!hasVault()) return false;
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
