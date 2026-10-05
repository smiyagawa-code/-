// グラフの部品（SVG を手書き・外部ライブラリなし）。マウスを当てると列が光り、数字が出る。
// 色は dataviz の検証を通した5色（固定順）。CALM は強調しない線用。
export const SERIES = ['#EB6311', '#2a78d6', '#1baf7a', '#eda100', '#9085e9'];
export const CALM = ['#0B2A59', '#3C5A86', '#8A9BB5', '#5E7090'];

export function spark(values, asBars) {
  const w = 110, h = 40, p = 3;
  const max = Math.max(...values), min = Math.min(...values);
  const x = (i) => p + (i * (w - p * 2)) / (values.length - 1);
  const y = (v) => h - p - ((v - min) / (max - min || 1)) * (h - p * 2);
  if (asBars) {
    const bw = (w - p * 2) / values.length - 2;
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" aria-hidden="true">${values.map((v, i) =>
      `<rect x="${p + i * ((w - p * 2) / values.length)}" y="${y(v)}" width="${bw}" height="${h - p - y(v) + 1}" rx="1.5" fill="rgba(255,255,255,${i === values.length - 1 ? 0.95 : 0.35})"/>`).join('')}</svg>`;
  }
  const pts = values.map((v, i) => `${x(i)},${y(v)}`).join(' ');
  const id = `g${Math.random().toString(36).slice(2, 8)}`;
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" aria-hidden="true">` +
    `<defs><linearGradient id="${id}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#FF8A3D" stop-opacity=".45"/><stop offset="1" stop-color="#FF8A3D" stop-opacity="0"/></linearGradient></defs>` +
    `<polygon points="${x(0)},${h} ${pts} ${x(values.length - 1)},${h}" fill="url(#${id})"/>` +
    `<polyline points="${pts}" fill="none" stroke="#FF8A3D" stroke-width="2" stroke-linejoin="round"/>` +
    `<circle cx="${x(values.length - 1)}" cy="${y(values.at(-1))}" r="3" fill="#fff"/></svg>`;
}


// ---------- グラフ（SVG・ホバーで数字） ----------
const H = 260, L = 44, R = 14, T = 16, B = 30;

function frame(w, n, min, max, digits = 0) {
  const step = (w - L - R) / n;
  const y = (v) => H - B - ((v - min) / (max - min)) * (H - B - T);
  let svg = '';
  for (let k = 0; k <= 4; k++) {
    const v = min + ((max - min) / 4) * k;
    svg += `<line class="${k === 0 ? 'base' : 'grid'}" x1="${L}" x2="${w - R}" y1="${y(v)}" y2="${y(v)}"/>` +
      `<text x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${esc(fmt(v, digits))}</text>`;
  }
  return { step, y, svg, cx: (i) => L + step * i + step / 2 };
}

function xAxis(labels, f) {
  // 狭いグラフでは1か月おき（重なり防止）。最後の月は必ず出す
  const every = f.step < 42 ? 2 : 1;
  return labels.map((l, i) => ((i % every === 0 || i === labels.length - 1) && !(every === 2 && i === labels.length - 2)
    ? `<text x="${f.cx(i)}" y="${H - 9}" text-anchor="middle">${esc(l)}</text>` : '')).join('');
}

export function stacked(id, { labels, keys, rows, unit, colors, max, w = 900, total, digits = 0, extraTip }) {
  const top = max ?? niceMax(Math.max(...rows.map((r) => keys.reduce((s, k) => s + r[k], 0))));
  const f = frame(w, labels.length, 0, top);
  const bw = Math.min(46, f.step * 0.64);
  let svg = f.svg;
  rows.forEach((r, i) => {
    const x = f.cx(i) - bw / 2;
    let acc = 0;
    keys.forEach((k, ki) => {
      const y0 = f.y(acc), y1 = f.y(acc + r[k]);
      const h = Math.max(0, y0 - y1 - 2); // 2px の隙間で区切る
      svg += `<rect class="bar" style="animation-delay:${i * 30}ms" x="${x}" y="${y1}" width="${bw}" height="${h}" rx="${ki === keys.length - 1 ? 4 : 1.5}" fill="${colors[ki % colors.length]}"/>`;
      acc += r[k];
    });
    if (total) svg += `<text class="val" x="${f.cx(i)}" y="${f.y(acc) - 7}" text-anchor="middle">${esc(fmt(acc))}</text>`;
  });
  mount(id, w, svg + xAxis(labels, f), f, labels, (i) => [
    ...keys.map((k, ki) => [k, `${fmt(rows[i][k], digits)}${unit}`, colors[ki % colors.length]]).reverse(),
    ...(total ? [['合計', `${fmt(keys.reduce((s, k) => s + rows[i][k], 0))}${unit}`]] : []),
    ...(extraTip ? extraTip(i) : []),
  ]);
}

export function bars(id, { labels, values, unit, w = 460, color, notes, notesUnit = '%', warnNote, tip, max }) {
  const f = frame(w, labels.length, 0, max ?? niceMax(Math.max(...values.filter(Number.isFinite))));
  const bw = Math.min(30, f.step * 0.56);
  let svg = f.svg;
  values.forEach((v, i) => {
    if (!v) return;
    svg += `<rect class="bar" style="animation-delay:${i * 30}ms" x="${f.cx(i) - bw / 2}" y="${f.y(v)}" width="${bw}" height="${f.y(0) - f.y(v)}" rx="4" fill="${color}"/>`;
    const note = notes?.[i];
    if (note != null) svg += `<text class="${warnNote?.(note) ? 'warn' : 'val'}" x="${f.cx(i)}" y="${f.y(v) - 7}" text-anchor="middle">${esc(note)}${esc(notesUnit)}</text>`;
  });
  mount(id, w, svg + xAxis(labels, f), f, labels, tip ?? ((i) => [['', `${fmt(values[i])}${unit}`, color]]));
}

export function lines(id, { labels, series, unit, min = 0, max, w = 900, area, marks = [], tip, ref }) {
  const all = series.flatMap((s) => s.values).filter((v) => v != null);
  const f = frame(w, labels.length, min, max ?? niceMax(Math.max(...all)));
  let svg = f.svg;
  if (ref) svg += `<line x1="${L}" x2="${w - R}" y1="${f.y(ref.v)}" y2="${f.y(ref.v)}" stroke="#D0342C" stroke-dasharray="4 4" stroke-width="1.5"/><text class="warn" x="${w - R}" y="${f.y(ref.v) - 6}" text-anchor="end">${esc(ref.text)}</text>`;
  series.forEach((s, si) => {
    const pts = s.values.map((v, i) => (v == null ? null : [f.cx(i), f.y(v)])).filter(Boolean);
    const line = pts.map((p) => p.join(',')).join(' ');
    if (area && series.length === 1 && pts.length > 0) {
      const gid = `a${id}`;
      svg += `<defs><linearGradient id="${gid}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${s.color}" stop-opacity=".22"/><stop offset="1" stop-color="${s.color}" stop-opacity="0"/></linearGradient></defs>` +
        `<polygon class="area" points="${pts[0][0]},${f.y(min)} ${line} ${pts.at(-1)[0]},${f.y(min)}" fill="url(#${gid})"/>`;
    }
    svg += `<polyline class="line" fill="none" stroke="${s.color}" stroke-width="${s.width ?? 2.5}" stroke-linejoin="round" stroke-linecap="round" points="${line}"/>`;
    pts.forEach((p) => { svg += `<circle class="dot" cx="${p[0]}" cy="${p[1]}" r="3.2" fill="#fff" stroke="${s.color}" stroke-width="2"/>`; });
    marks.filter((mk) => (mk.series ?? 0) === si).forEach((mk) => {
      const v = s.values[mk.i];
      if (!Number.isFinite(v)) return; // 値のない点には印を付けない
      const anchor = mk.i >= labels.length - 2 ? 'end' : 'middle';
      svg += `<circle cx="${f.cx(mk.i)}" cy="${f.y(v)}" r="5" fill="${s.color}" stroke="#fff" stroke-width="2"/>` +
        `<text class="${mk.warn ? 'warn' : 'val'}" x="${f.cx(mk.i) + (anchor === 'end' ? 4 : 0)}" y="${mk.below ? f.y(v) + 20 : f.y(v) - 11}" text-anchor="${anchor}">${esc(mk.text)}</text>`;
    });
  });
  mount(id, w, svg + xAxis(labels, f), f, labels, tip ?? ((i) => series.map((s) => [s.name, s.values[i] == null ? '—' : `${fmt(s.values[i], 1)}${unit}`, s.color])));
}

function label2(l) {
  const m = /^(\d{2})\/(\d{1,2})$/.exec(String(l));
  return m ? `20${m[1]}年${Number(m[2])}月` : String(l);
}

// 列ごとの透明な当たり判定を置き、ホバーで列を薄く塗って数字を出す
function mount(id, w, inner, f, labels, rowsAt) {
  let hl = '', hits = '';
  labels.forEach((_, i) => {
    const x = L + f.step * i;
    hl += `<rect class="col-hl" data-i="${i}" x="${x + 2}" y="${T - 6}" width="${f.step - 4}" height="${H - B - T + 6}" rx="6"/>`;
    hits += `<rect class="hit" data-i="${i}" x="${x}" y="0" width="${f.step}" height="${H}"/>`;
  });
  const el = document.getElementById(id);
  el.innerHTML = `<svg viewBox="0 0 ${w} ${H}">${hl}${inner}${hits}</svg>`;
  const tip = document.getElementById('tooltip');
  const show = (e) => {
    const i = Number(e.target.dataset.i);
    el.querySelectorAll('.col-hl').forEach((r) => r.classList.toggle('on', Number(r.dataset.i) === i));
    tip.innerHTML = `<div class="t-title">${esc(label2(labels[i]))}</div>` + rowsAt(i).map(([name, value, color]) =>
      `<div class="t-row">${color ? `<i style="background:${color}"></i>` : ''}<span>${esc(name)}</span><b>${esc(value)}</b></div>`).join('');
    tip.hidden = false;
    const pad = 14;
    let x = e.clientX + pad, y = e.clientY + pad;
    const r = tip.getBoundingClientRect();
    if (x + r.width > innerWidth - 8) x = e.clientX - r.width - pad;
    if (y + r.height > innerHeight - 8) y = e.clientY - r.height - pad;
    tip.style.left = `${x}px`; tip.style.top = `${y}px`;
  };
  el.querySelectorAll('.hit').forEach((h) => { h.addEventListener('mousemove', show); });
  el.addEventListener('mouseleave', () => { tip.hidden = true; el.querySelectorAll('.col-hl').forEach((r) => r.classList.remove('on')); });
}

export function legend(id, names, colors) {
  document.getElementById(id).innerHTML = names
    .map((n, i) => `<span><i style="background:${colors[i % colors.length]}"></i>${esc(n)}</span>`).join('');
}


export function niceMax(v) {
  if (!Number.isFinite(v) || v <= 0) return 1; // 全部0・マイナス・数字以外でも NaN にしない
  const p = 10 ** Math.floor(Math.log10(v));
  return Math.ceil((v * 1.12) / p) * p;
}
export function round1(v) { return Math.round(v * 10) / 10; }
export function fmt(v, digits = 0) {
  if (typeof v !== 'number') return String(v);
  return v.toLocaleString('ja-JP', { maximumFractionDigits: Number.isInteger(v) ? 0 : Math.max(digits, 1), minimumFractionDigits: 0 });
}


export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
