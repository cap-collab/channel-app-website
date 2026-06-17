/**
 * Load prod env for one-off admin scripts. Use `.env.prod` (NOT `.env.local`,
 * which is unreliable for prod scripts). Import this FIRST, before any module
 * that reads process.env at top level (e.g. firebase-admin).
 *
 *   import './lib/load-env';            // side-effect import, must be first
 *   import { getAdminDb } from '../src/lib/firebase-admin';
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';

const file = resolve(process.cwd(), '.env.prod');
for (const line of readFileSync(file, 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (!m) continue;
  let val = m[2].trim();
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    val = val.slice(1, -1);
  }
  process.env[m[1]] = val;
}
