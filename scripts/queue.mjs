#!/usr/bin/env node
/**
 * CLI Helper to list, inspect, and manage Curation Queue items from terminal.
 * Usage:
 *   node scripts/queue.mjs list [all|pending|done]
 *   node scripts/queue.mjs view <id>
 *   node scripts/queue.mjs done <id>
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VAULT_ROOT = path.resolve(__dirname, '..', '..');
const QUEUE_FILE = path.join(VAULT_ROOT, 'data', 'curation-queue', 'queue.json');
const INBOX_FILE = path.join(VAULT_ROOT, 'data', 'curation-queue', 'INBOX.md');

async function loadQueue() {
  try {
    const raw = await fs.readFile(QUEUE_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return { last_seq: 100, items: [] };
  }
}

async function saveQueue(data) {
  await fs.mkdir(path.dirname(QUEUE_FILE), { recursive: true });
  await fs.writeFile(QUEUE_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

const [cmd, arg1, ...rest] = process.argv.slice(2);

async function main() {
  const data = await loadQueue();
  const items = data.items || [];

  switch (cmd) {
    case 'list':
    case 'ls':
    case undefined: {
      const filter = arg1 || 'pending';
      const filtered = filter === 'all' ? items : items.filter((i) => i.status === filter);

      console.log(`\n📥 Antigravity Curation Queue (${filter.toUpperCase()}: ${filtered.length} items)\n`);
      if (filtered.length === 0) {
        console.log('   (No items found)');
      } else {
        filtered.forEach((item, idx) => {
          const prio = item.priority === 'high' ? '🔴 HIGH' : item.priority === 'medium' ? '🟡 MED' : '🟢 LOW';
          const cat = item.category.toUpperCase();
          console.log(`   [#${item.short_id}] [${prio}] [${cat} -> ${item.target_project}]`);
          console.log(`     📌 ${item.title}`);
          console.log(`     👉 Action: ${item.antigravity_action}`);
          if (item.url) console.log(`     🔗 ${item.url}`);
          console.log('');
        });
      }
      break;
    }

    case 'view':
    case 'show': {
      if (!arg1) {
        console.error('Error: Please provide an ID (e.g. Q-101 or 101)');
        process.exit(1);
      }
      const clean = arg1.toLowerCase().replace('q-', '');
      const item = items.find(
        (i) => i.id.toLowerCase() === arg1.toLowerCase() || i.short_id.toLowerCase().replace('q-', '') === clean
      );
      if (!item) {
        console.error(`Item not found for ID: ${arg1}`);
        process.exit(1);
      }
      console.log(`\n========================================`);
      console.log(`[#${item.short_id}] ${item.title}`);
      console.log(`========================================`);
      console.log(`Category:       ${item.category.toUpperCase()}`);
      console.log(`Target Project: ${item.target_project}`);
      console.log(`Priority:       ${item.priority.toUpperCase()}`);
      console.log(`Status:         ${item.status.toUpperCase()}`);
      if (item.url) console.log(`Source URL:     ${item.url}`);
      console.log(`Created At:     ${item.created_at}`);
      console.log(`\n💡 Key Takeaways:`);
      item.takeaways?.forEach((t) => console.log(`  - ${t}`));
      console.log(`\n🎯 Why It Matters:`);
      console.log(`  ${item.why_it_matters}`);
      console.log(`\n🛠 Antigravity Action:`);
      console.log(`  ${item.antigravity_action}`);
      console.log(`\n📝 Raw Input:`);
      console.log(`  ${item.raw_input}`);
      console.log(`========================================\n`);
      break;
    }

    case 'done':
    case 'complete': {
      if (!arg1) {
        console.error('Error: Please provide an ID (e.g. Q-101 or 101)');
        process.exit(1);
      }
      const clean = arg1.toLowerCase().replace('q-', '');
      let found = false;
      const updated = items.map((i) => {
        if (i.id.toLowerCase() === arg1.toLowerCase() || i.short_id.toLowerCase().replace('q-', '') === clean) {
          found = true;
          return { ...i, status: 'done', completed_at: new Date().toISOString() };
        }
        return i;
      });

      if (!found) {
        console.error(`Item not found for ID: ${arg1}`);
        process.exit(1);
      }

      await saveQueue({ ...data, items: updated });
      console.log(`✅ Marked #${arg1} as DONE in queue.json`);
      break;
    }

    default:
      console.log(`Usage:`);
      console.log(`  node scripts/queue.mjs list [pending|done|all]`);
      console.log(`  node scripts/queue.mjs view <id>`);
      console.log(`  node scripts/queue.mjs done <id>`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
