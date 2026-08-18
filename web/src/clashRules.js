// Surgical parse/splice of a Clash template's top-level `rules:` block. Only the
// contiguous run of "- ..." list items is ever touched, so everything else in the
// YAML — proxy-groups, rule-providers, comments, anchors — is preserved exactly.
// Pure (no DOM), so it can be unit-exercised with plain node.

// Split "TYPE,VALUE,POLICY[,opt]" into normalized field form.
// MATCH has no value: parts = [TYPE, POLICY]. Everything else: [TYPE, VALUE, POLICY, ...opts].
export function partsToFields(parts) {
  const type = parts[0] || '';
  if (type === 'MATCH' || type === 'FINAL') {
    return { type, value: '', policy: parts[1] || '', options: '' };
  }
  return {
    type,
    value: parts[1] || '',
    policy: parts[2] || '',
    options: parts.slice(3).join(','),
  };
}

// Interior empty fields are preserved (positional) so "TYPE,,POLICY" survives a
// round-trip without the value/policy columns shifting; only trailing empties are
// trimmed.
function stripTrailingEmpty(parts) {
  const p = [...parts];
  while (p.length && (p[p.length - 1] == null || String(p[p.length - 1]) === '')) p.pop();
  return p;
}
export function fieldsToParts({ type, value, policy, options }) {
  if (type === 'MATCH' || type === 'FINAL') return stripTrailingEmpty([type, policy ?? '']);
  const opts = (options || '').split(',').map((s) => s.trim()).filter(Boolean);
  return stripTrailingEmpty([type ?? '', value ?? '', policy ?? '', ...opts]);
}

// Locate the rules block. Returns { found, indent, itemIndent, start, end, rules }
// where rules = [{ parts:string[] }] and [start,end) bounds the block lines
// (start = the "rules:" line, end = exclusive, past the last list item).
export function parseClashRules(content) {
  const lines = String(content).split('\n');
  let ri = -1, indent = '';
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)rules:\s*(\[\s*\])?\s*$/);
    if (m) { ri = i; indent = m[1]; break; }
  }
  if (ri === -1) return { found: false, rules: [] };

  const rules = [];
  let end = ri + 1;
  let itemIndent = null;
  for (let i = ri + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*$/.test(line)) continue;                 // blank: skip, don't end the block yet
    const im = line.match(/^(\s*)-\s+(.*)$/);
    if (!im || im[1].length <= indent.length) break;  // dedent / non-item → block ends
    if (itemIndent === null) itemIndent = im[1];
    const body = im[2].trim().replace(/\s+#.*$/, '');  // drop trailing inline comment
    const clean = body.replace(/^['"]|['"]$/g, '');    // strip wrapping quotes
    rules.push({ parts: clean.split(',').map((s) => s.trim()) });
    end = i + 1;
  }
  return { found: true, indent, itemIndent: itemIndent ?? indent + '  ', start: ri, end, rules };
}

// Rebuild the block from a rules array and splice it back into content, leaving
// the rest untouched. rules = [{ parts:string[] }].
export function spliceClashRules(content, rules) {
  const parsed = parseClashRules(content);
  const lines = String(content).split('\n');
  const ind = parsed.found ? parsed.itemIndent : '  ';
  const body = rules
    .map((r) => r.parts.map((p) => String(p).trim()))   // keep positions (interior empties matter)
    .filter((parts) => parts.length > 0 && parts[0] !== '') // drop rows with no rule type
    .map((parts) => `${ind}- ${parts.join(',')}`);

  if (!parsed.found) {
    return content.replace(/\s*$/, '') + '\nrules:\n' + body.join('\n') + '\n';
  }
  const before = lines.slice(0, parsed.start + 1);
  before[before.length - 1] = before[before.length - 1].replace(/rules:\s*(\[\s*\])?\s*$/, 'rules:');
  const after = lines.slice(parsed.end);
  return [...before, ...body, ...after].join('\n');
}

// Best-effort list of selectable policies: proxy-group names in the template plus
// the built-in DIRECT/REJECT. Used to populate the policy datalist.
export function extractPolicies(content) {
  const names = new Set();
  const lines = String(content).split('\n');
  for (const line of lines) {
    const m = line.match(/^\s*-?\s*name:\s*(.+?)\s*$/);
    if (m) names.add(m[1].replace(/^['"]|['"]$/g, ''));
  }
  names.add('DIRECT'); names.add('REJECT');
  return [...names];
}
