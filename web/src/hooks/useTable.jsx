import { useState, useMemo } from 'react';

// generic search + sort + multi-select for a list of row objects
export function useTable(rows, { searchKeys = [], initialSort = null } = {}) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState(initialSort); // { key, dir }
  const [selected, setSelected] = useState(new Set());
  const [filters, setFilters] = useState({}); // { key: value }

  const filtered = useMemo(() => {
    let out = rows;
    const q = query.trim().toLowerCase();
    if (q) {
      out = out.filter((r) => searchKeys.some((k) =>
        String(r[k] ?? '').toLowerCase().includes(q)));
    }
    for (const [k, v] of Object.entries(filters)) {
      if (v === '' || v == null) continue;
      out = out.filter((r) => String(r[k] ?? '') === String(v));
    }
    if (sort?.key) {
      out = [...out].sort((a, b) => {
        const av = a[sort.key], bv = b[sort.key];
        if (av == null) return 1;
        if (bv == null) return -1;
        const cmp = typeof av === 'number' && typeof bv === 'number'
          ? av - bv
          : String(av).localeCompare(String(bv), 'zh');
        return sort.dir === 'desc' ? -cmp : cmp;
      });
    }
    return out;
  }, [rows, query, sort, filters, searchKeys]);

  const toggleSort = (key) => {
    setSort((s) => s?.key === key
      ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: 'asc' });
  };

  const toggleSelect = (id) => setSelected((s) => {
    const n = new Set(s);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });
  const toggleSelectAll = () => setSelected((s) =>
    s.size === filtered.length ? new Set() : new Set(filtered.map((r) => r.id)));
  const clearSelection = () => setSelected(new Set());

  return {
    query, setQuery, sort, toggleSort, filtered,
    filters, setFilters,
    selected, toggleSelect, toggleSelectAll, clearSelection,
    allSelected: filtered.length > 0 && selected.size === filtered.length,
  };
}

export function SortTh({ label, k, table, className = '' }) {
  const active = table.sort?.key === k;
  const arrow = active ? (table.sort.dir === 'asc' ? ' ▲' : ' ▼') : '';
  return <th className={className} onClick={() => table.toggleSort(k)}>{label}{arrow}</th>;
}
