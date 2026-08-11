import { db } from './db.js';
import { DEFAULT_TEMPLATES } from './services/subscription/defaultTemplates.js';

// Seed the built-in default subscription templates.
// Idempotent per client_type: any client family that has no default template yet
// gets one inserted, so upgrading an existing install picks up newly-added
// defaults (e.g. Surge / Loon / QuantumultX) without duplicating existing ones.
export function seedTemplates() {
  const now = Date.now();
  const ins = db.prepare(
    'INSERT INTO templates (name, client_type, content, is_default, created_at, updated_at) VALUES (?,?,?,?,?,?)'
  );
  const hasDefault = db.prepare('SELECT 1 FROM templates WHERE client_type = ? AND is_default = 1 LIMIT 1');

  let added = 0;
  for (const [clientType, { name, content }] of Object.entries(DEFAULT_TEMPLATES)) {
    if (hasDefault.get(clientType)) continue;
    ins.run(name, clientType, content, 1, now, now);
    added++;
  }
  if (added) console.log(`[init] seeded ${added} default subscription template(s)`);
}
