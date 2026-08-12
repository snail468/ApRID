// Node post-processing used both when importing airport nodes and when
// assembling a user's subscription.
//
// filter shape (stored as JSON on airport / user):
// {
//   include: "关键词1|关键词2",   // regex, keep only names matching
//   exclude: "过期|剩余|官网",     // regex, drop names matching
//   protocols: ["vmess","trojan"],// keep only these types (empty = all)
//   prefix: "🇭🇰香港",            // add prefix to every node name
//   rename: [ {from:"HK", to:"香港"} ], // sequential name replacements
//   maxLatency: 200,              // ms; drop nodes slower than this. 0 = only
//                                 // drop timed-out nodes; undefined = no limit.
// }

function toRegExp(pattern) {
  if (!pattern) return null;
  try {
    return new RegExp(pattern, 'i');
  } catch {
    return null;
  }
}

export function filterNodes(nodes, filter = {}) {
  const inc = toRegExp(filter.include);
  const exc = toRegExp(filter.exclude);
  const protos = Array.isArray(filter.protocols) ? filter.protocols.filter(Boolean) : [];
  const exProtos = Array.isArray(filter.excludeProtocols) ? filter.excludeProtocols.filter(Boolean) : [];
  // latency ceiling: undefined/'' = off; 0 = drop only timed-out nodes;
  // >0 = drop timed-out nodes and any measured latency above the ceiling.
  const hasMax = filter.maxLatency !== undefined && filter.maxLatency !== null && filter.maxLatency !== '';
  const maxLat = hasMax ? Number(filter.maxLatency) : null;
  return nodes.filter((n) => {
    if (protos.length && !protos.includes(n.type)) return false;
    if (exProtos.length && exProtos.includes(n.type)) return false;
    if (inc && !inc.test(n.name)) return false;
    if (exc && exc.test(n.name)) return false;
    if (hasMax && !Number.isNaN(maxLat)) {
      const lat = n.latency;
      // untested nodes (null/undefined) are kept — we can't judge them
      if (lat != null) {
        if (lat < 0) return false;              // timed out → always dropped
        if (maxLat > 0 && lat > maxLat) return false; // over the ceiling
      }
    }
    return true;
  });
}

export function renameNodes(nodes, filter = {}) {
  const rules = Array.isArray(filter.rename) ? filter.rename : [];
  const prefix = filter.prefix || '';
  return nodes.map((n) => {
    let name = n.name;
    for (const r of rules) {
      if (!r.from) continue;
      try {
        name = name.replace(new RegExp(r.from, 'g'), r.to ?? '');
      } catch {
        name = name.split(r.from).join(r.to ?? '');
      }
    }
    if (prefix) name = `${prefix}${name}`;
    return { ...n, name };
  });
}

// ensure names are unique within one airport by numbering duplicates:
// "香港", "香港", "香港" -> "香港", "香港 2", "香港 3"
export function dedupWithinGroup(nodes) {
  const seen = new Map();
  return nodes.map((n) => {
    const c = (seen.get(n.name) || 0) + 1;
    seen.set(n.name, c);
    return c === 1 ? n : { ...n, name: `${n.name} ${c}` };
  });
}

// unique prefixing across airports so two airports' "香港" don't collide.
// prefixMap: { airportId: "A-" }
export function applyGlobalPrefix(nodes, prefix) {
  if (!prefix) return nodes;
  return nodes.map((n) => ({ ...n, name: `${prefix}${n.name}` }));
}

// full pipeline for a single airport's nodes
export function processAirportNodes(nodes, filter = {}) {
  let out = filterNodes(nodes, filter);
  out = renameNodes(out, filter);
  out = dedupWithinGroup(out);
  return out;
}
