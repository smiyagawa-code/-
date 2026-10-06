// 画面共通の小道具
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
export function fmt(v) {
  return typeof v === 'number' ? v.toLocaleString('ja-JP') : String(v ?? '');
}

// 複数の内示 CSV（列は同じ）を 1 つにまとめる。案件名が同じ行は後のものに置き換える
export function mergeCsv(sources) {
  const header = parseCsv(sources[0].csvText)[0] || [];
  const nameCol = header.indexOf('案件');
  const rows = new Map();
  for (const src of sources) {
    for (const r of parseCsv(src.csvText).slice(1)) {
      if (!r.some((c) => c.trim())) continue;
      rows.set(nameCol >= 0 ? (r[nameCol] || '').trim() || `_${rows.size}` : `_${rows.size}`, r);
    }
  }
  const cell = (v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return [header, ...rows.values()].map((r) => r.map((c) => cell(String(c ?? ''))).join(',')).join('\n');
}
export function parseCsv(text) {
  const out = []; let row = []; let cur = ''; let q = false;
  const t = String(text || '').replace(/^\uFEFF/, '');
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) { if (ch === '"') { if (t[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; continue; }
    if (ch === '"') q = true;
    else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && t[i + 1] === '\n') i++; row.push(cur); out.push(row); row = []; cur = ''; }
    else cur += ch;
  }
  if (cur !== '' || row.length) { row.push(cur); out.push(row); }
  return out;
}

