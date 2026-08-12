import { db, getSetting, setSetting } from './db.js';
import { DEFAULT_TEMPLATES } from './services/subscription/defaultTemplates.js';

// Bump this whenever the built-in DEFAULT_TEMPLATES content changes so existing
// installs re-sync their is_default templates to the new version.
//   v1 → initial 5-client defaults
//   v2 → round-3 rewrite: preserve standard ACL4SSR split routing per client
//   v3 → fix ProxyGroup loop: 节点选择 no longer references 全球直连 (use DIRECT)
const DEFAULT_TEMPLATES_VERSION = 3;

// Seed / refresh the built-in default subscription templates.
// - Inserts a default for any client family that has none yet (idempotent).
// - When DEFAULT_TEMPLATES_VERSION increases, refreshes the *content* of the
//   existing is_default rows so upgrades pick up template fixes. Only rows we
//   own (is_default = 1) are touched — user-created templates are never changed.
export function seedTemplates() {
  const now = Date.now();
  const ins = db.prepare(
    'INSERT INTO templates (name, client_type, content, is_default, created_at, updated_at) VALUES (?,?,?,?,?,?)'
  );
  const getDefault = db.prepare('SELECT id FROM templates WHERE client_type = ? AND is_default = 1 LIMIT 1');
  const upd = db.prepare('UPDATE templates SET name = ?, content = ?, updated_at = ? WHERE id = ?');

  const storedVersion = Number(getSetting('default_templates_version', 0)) || 0;
  const needRefresh = storedVersion < DEFAULT_TEMPLATES_VERSION;

  let added = 0;
  let refreshed = 0;
  for (const [clientType, { name, content }] of Object.entries(DEFAULT_TEMPLATES)) {
    const existing = getDefault.get(clientType);
    if (!existing) {
      ins.run(name, clientType, content, 1, now, now);
      added++;
    } else if (needRefresh) {
      upd.run(name, content, now, existing.id);
      refreshed++;
    }
  }

  if (needRefresh) setSetting('default_templates_version', DEFAULT_TEMPLATES_VERSION);
  if (added || refreshed) {
    console.log(`[init] default subscription templates: +${added} new, ${refreshed} refreshed`);
  }
}
