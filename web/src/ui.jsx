import { createContext, useContext, useState, useCallback, useMemo, useRef, useEffect } from 'react';

/* ---------------- Toast ---------------- */
const ToastCtx = createContext(null);
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((msg, type = 'info') => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, msg, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }, []);
  const value = useMemo(() => ({
    info: (m) => push(m, 'info'),
    success: (m) => push(m, 'success'),
    error: (m) => push(m, 'error'),
  }), [push]);
  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div className="toast-wrap">
        {toasts.map((t) => <div key={t.id} className={`toast ${t.type}`}>{t.msg}</div>)}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

/* ---------------- Modal ---------------- */
export function Modal({ title, children, onClose, footer, wide }) {
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="close-x" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

/* ---------------- ActionMenu (dropdown) ----------------
   items: [{ label, onClick, danger?, disabled?, title?, hidden? }]
   The popover is position:fixed (positioned from the button's rect) so it is never
   clipped by the table's overflow:auto container. */
export function ActionMenu({ items = [], label = '操作 ▾' }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const btnRef = useRef(null);
  const popRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const place = () => {
      const r = btnRef.current?.getBoundingClientRect();
      if (r) setPos({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) });
    };
    place();
    const onDoc = (e) => {
      if (!popRef.current?.contains(e.target) && !btnRef.current?.contains(e.target)) setOpen(false);
    };
    const close = () => setOpen(false);
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  const visible = items.filter((it) => !it.hidden);
  return (
    <div className="action-menu">
      <button ref={btnRef} className="btn sm" onClick={() => setOpen((o) => !o)}>{label}</button>
      {open && pos && (
        <div ref={popRef} className="action-menu-pop" style={{ position: 'fixed', top: pos.top, right: pos.right }}>
          {visible.map((it, i) => (
            <button key={i} className={`action-menu-item ${it.danger ? 'danger' : ''}`} disabled={it.disabled}
              title={it.title || ''} onClick={() => { setOpen(false); it.onClick?.(); }}>
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------- Confirm ---------------- */
export function useConfirm() {
  const [state, setState] = useState(null);
  const confirm = useCallback((message) =>
    new Promise((resolve) => setState({ message, resolve })), []);
  const node = state ? (
    <Modal title="确认操作" onClose={() => { state.resolve(false); setState(null); }}
      footer={<>
        <button className="btn" onClick={() => { state.resolve(false); setState(null); }}>取消</button>
        <button className="btn danger" onClick={() => { state.resolve(true); setState(null); }}>确认</button>
      </>}>
      <p>{state.message}</p>
    </Modal>
  ) : null;
  return [confirm, node];
}

/* ---------------- helpers ---------------- */
export async function copyText(text, toast) {
  try {
    await navigator.clipboard.writeText(text);
    toast?.success('已复制');
  } catch {
    // fallback
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); document.body.removeChild(ta);
    toast?.success('已复制');
  }
}

export function fmtBytes(b) {
  if (b == null) return '-';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0, n = Number(b);
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
}

// Whole app renders times in UTC+8 (北京时间) regardless of the viewer's browser
// timezone. China has no DST, so a fixed +8h offset on the epoch is exact — we
// read the shifted date's UTC fields to get UTC+8 wall-clock parts.
const TZ_OFFSET_MS = 8 * 3600000;
function wall8(ms) {
  return new Date(Number(ms) + TZ_OFFSET_MS); // read via getUTC* for UTC+8 parts
}
const pad2 = (n) => String(n).padStart(2, '0');

export function fmtDate(ms) {
  if (!ms) return '-';
  const d = wall8(ms);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

export function fmtDateTime(ms) {
  if (!ms) return '-';
  const d = wall8(ms);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

export function daysLeft(ms) {
  if (!ms) return null;
  return Math.ceil((Number(ms) - Date.now()) / 86400000);
}

// value for <input type="datetime-local">, showing UTC+8 wall clock
export function toDatetimeLocal(ms) {
  if (!ms) return '';
  const d = wall8(ms);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}T${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}
// interpret the datetime-local string as UTC+8 wall clock -> epoch ms
export function fromDatetimeLocal(v) {
  if (!v) return null;
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return new Date(v).getTime();
  const [, y, mo, d, h, mi] = m.map(Number);
  return Date.UTC(y, mo - 1, d, h, mi) - TZ_OFFSET_MS;
}
