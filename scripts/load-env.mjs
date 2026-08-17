import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Tiny .env loader (no dependency). Loads .env.local into process.env
 * without overwriting variables that are already set.
 */
export function loadEnv(file = '.env.local') {
  const path = resolve(file);
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}
