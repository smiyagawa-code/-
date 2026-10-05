// AI ダッシュボードの画面を、/api/data の宣言（src/data.js の getDemoData）から組み立てる。
// ふつうは src/data.js だけ直せばよく、このファイルは触らなくてよい。
import { SERIES, CALM, spark, stacked, bars, lines, legend, fmt, esc } from './charts.js';
import { setupChat, ask } from './chat.js';

const ACCENT = { orange: SERIES[0], blue: SERIES[1], green: SERIES[2], yellow: SERIES[3], red: '#D0342C' };
let aiReady = false;

// テスト（test/render.test.mjs）が待てるように、組み立て完了の Promise を残す
globalThis.__dashboardReady = init().catch((err) => {
  console.error('dashboard', err);
  text('kpis', '画面を組み立てられませんでした。src/data.js を確認してください。');
});

async function init() {
  const res = await fetch('/api/data');
  if (!res.ok) {
    document.getElementById('kpis').textContent = 'データを読み込めませんでした。ページを再読み込みしてください。';
    return;
  }
  const d = await res.json();
  document.title = d.title || document.title;
  text('title', d.title);
  text('subtitle', d.subtitle);
  text('period', d.period);
  text('footNote', d.footNote || '数字はすべて架空のデモデータです。');

  safe(() => renderKpis(d.kpis || []), 'kpis');
  safe(() => renderInsights(d.insights || []), 'insights');
  safe(() => renderSections(d.sections || []), 'sections');

  const me = await fetch('/api/me').then((r) => r.json()).catch(() => ({}));
  aiReady = Boolean(me.ai);
  if (me.db) document.getElementById('formLink')?.removeAttribute('hidden');
  if (aiReady) setupChat(Array.isArray(d.examples) ? d.examples : []);
  else {
    document.getElementById('chat').remove();
    document.querySelector('.layout').classList.add('no-chat');
    document.querySelectorAll('.insight').forEach((b) => { b.disabled = true; });
    text('insightHint', '');
  }
}

function renderKpis(kpis) {
  document.getElementById('kpis').innerHTML = kpis.map((k) => {
    const value = esc(typeof k.value === 'number' ? k.value.toLocaleString('ja-JP') : k.value);
    let pill = k.sub ? `<span class="pill flat">${esc(k.sub)}</span>` : '';
    if (typeof k.delta === 'number') {
      const good = k.worseWhenUp ? k.delta <= 0 : k.delta >= 0;
      const arrow = k.delta > 0 ? '▲' : k.delta < 0 ? '▼' : '■';
      pill = `<span class="pill ${good ? 'good' : 'bad'}">${arrow} ${esc(k.deltaLabel || '')} ${k.delta >= 0 ? '+' : ''}${esc(k.delta)}${esc(k.deltaUnit || '%')}</span>`;
    }
    const sp = Array.isArray(k.spark) && k.spark.length > 1 ? spark(k.spark, Boolean(k.sparkBars)) : '';
    return `<div class="kpi"><div class="kpi-label">${esc(k.label)}</div>` +
      `<div class="kpi-row"><div class="kpi-value">${value}<small>${esc(k.unit || '')}</small></div>${sp}</div>${pill}</div>`;
  }).join('');
}

function renderInsights(items) {
  const wrap = document.getElementById('insightsWrap');
  if (!items.length) { wrap.remove(); return; }
  const el = document.getElementById('insights');
  el.innerHTML = items.map((it, i) =>
    `<button type="button" class="insight" data-i="${i}" style="--accent:${ACCENT[it.accent] || SERIES[i % SERIES.length]}">` +
    `<span class="tag">${esc(it.tag)}</span><span class="head">${esc(it.head)}</span>` +
    `<span class="fig">${esc(it.fig)}<small>${esc(it.unit || '')}</small></span><span class="go">AI に詳しく聞く →</span></button>`).join('');
  el.addEventListener('click', (e) => {
    const b = e.target.closest('.insight');
    if (!b || b.disabled || !aiReady) return;
    ask(items[Number(b.dataset.i)].question);
  });
}

// 区画 → カード。半分サイズのカードが続くと2列に並べる
function renderSections(sections) {
  const board = document.getElementById('sections');
  const nav = document.getElementById('tabs');
  nav.innerHTML = sections.map((s) => `<a href="#sec-${esc(s.id)}">${esc(s.title)}</a>`).join('');
  let n = 0;
  const jobs = [];
  board.innerHTML = sections.map((s) => {
    let html = `<section id="sec-${esc(s.id)}" class="section"><h2 class="section-title">${esc(s.title)}</h2>`;
    const cards = s.cards || [];
    for (let i = 0; i < cards.length; i++) {
      const c = cards[i];
      if (c.size === 'half') {
        const pair = [c];
        if (cards[i + 1]?.size === 'half') pair.push(cards[++i]);
        html += `<div class="grid2">${pair.map((p) => card(p, `c${n++}`, jobs)).join('')}</div>`;
      } else {
        html += card(c, `c${n++}`, jobs);
      }
    }
    return `${html}</section>`;
  }).join('');
  // 1枚のグラフが失敗しても、ほかは表示する（失敗したカードには理由を出す）
  jobs.forEach(({ id, run }) => {
    try { run(); } catch (err) {
      console.error('chart', id, err);
      const el = document.getElementById(id);
      if (el) el.innerHTML = '<p class="card-note">このグラフは表示できません。src/data.js の宣言を確認してください。</p>';
    }
  });
}

function card(c, id, jobs) {
  const half = c.size === 'half';
  const w = half ? 460 : 900;
  const ch = c.chart || {};
  let legendHtml = '';
  let body = '';
  const colorsFor = (n) => (Array.isArray(ch.colors) ? ch.colors.map((c, i) => color(c, SERIES[i % SERIES.length])) : SERIES.slice(0, n));

  if (ch.type === 'stacked') {
    const colors = colorsFor(ch.keys.length);
    legendHtml = `<div class="legend ${half ? 'legend-block' : ''}" id="${id}-lg"></div>`;
    body = `<div id="${id}" class="chart" role="img" aria-label="${esc(c.title)}"></div>`;
    jobs.push({ id, run: () => {
      legend(`${id}-lg`, ch.keys, colors);
      stacked(id, { labels: ch.labels, keys: ch.keys, rows: ch.rows, unit: ch.unit || '', colors, max: ch.max, w, total: ch.total, digits: ch.digits ?? 0 });
    } });
  } else if (ch.type === 'line') {
    const anyHi = ch.series.some((s) => s.highlight);
    let k = 0;
    const series = ch.series.map((s, i) => ({ ...s, color: s.color ? color(s.color, SERIES[i % SERIES.length]) : (anyHi ? (s.highlight ? SERIES[0] : CALM[k++ % CALM.length]) : SERIES[i % SERIES.length]), width: s.highlight ? 3 : undefined }));
    if (series.length > 1) legendHtml = `<div class="legend ${half ? 'legend-block' : ''}" id="${id}-lg"></div>`;
    body = `<div id="${id}" class="chart" role="img" aria-label="${esc(c.title)}"></div>`;
    jobs.push({ id, run: () => {
      if (series.length > 1) legend(`${id}-lg`, series.map((s) => s.name), series.map((s) => s.color));
      lines(id, { labels: ch.labels, series, unit: ch.unit || '', min: ch.min ?? 0, max: ch.max, w, area: ch.area ?? series.length === 1, marks: ch.marks || [], ref: ch.ref });
    } });
  } else if (ch.type === 'bars') {
    body = `<div id="${id}" class="chart" role="img" aria-label="${esc(c.title)}"></div>`;
    jobs.push({ id, run: () => bars(id, {
      labels: ch.labels, values: ch.values, unit: ch.unit || '', w, color: color(ch.color, SERIES[1]), max: ch.max,
      notes: ch.notes, notesUnit: ch.notesUnit ?? '%', warnNote: (v) => ch.warnBelow != null && v != null && v < ch.warnBelow,
    }) });
  } else if (ch.type === 'hbars') {
    const max = Math.max(...ch.rows.map((r) => r.value));
    body = `<div class="funnel">${ch.rows.map((r, i) =>
      `<div class="f-row"><span class="f-name">${esc(r.name)}</span>` +
      `<div class="f-track"><div class="f-bar" style="width:${(r.value / max) * 100}%;background:${r.highlight ? SERIES[0] : CALM[Math.min(i, CALM.length - 1)]};animation-delay:${i * 80}ms"></div></div>` +
      `<span class="f-val"><b>${esc(fmt(r.value))}</b>${esc(r.unit || ch.unit || '')}${r.sub ? `<small>${esc(r.sub)}</small>` : ''}</span></div>`).join('')}</div>`;
  } else if (ch.type === 'table') {
    const hot = new Set(ch.hot || []);
    body = `<div class="table-wrap"><table class="rank"><thead><tr>${ch.columns.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>` +
      ch.rows.map((r, i) => `<tr class="${hot.has(i) ? 'hot' : ''}">${r.map((v) => `<td>${esc(typeof v === 'number' ? fmt(v) : v)}</td>`).join('')}</tr>`).join('') +
      '</tbody></table></div>';
  } else if (ch.type === 'cards') {
    body = `<div class="opps">${ch.items.map((it, i) =>
      `<div class="opp" style="--accent:${SERIES[i % SERIES.length]}">` +
      `<div class="opp-count"><b>${esc(fmt(it.count))}</b><small>${esc(it.unit || '')}</small></div>` +
      `<div class="opp-body"><p class="opp-need">${esc(it.title)}</p>${it.meta ? `<p class="opp-meta">${esc(it.meta)}</p>` : ''}</div>` +
      `${it.badge ? `<div class="opp-product">${esc(it.badge)}</div>` : ''}</div>`).join('')}</div>`;
  }

  const head = `<header class="card-head"><div><h3>${esc(c.title)}</h3>${c.takeaway ? `<p class="takeaway">${bold(c.takeaway)}</p>` : ''}</div>${half ? '' : legendHtml}</header>`;
  return `<article class="card">${head}${half ? legendHtml : ''}${body}${c.note ? `<p class="card-note">${esc(c.note)}</p>` : ''}</article>`;
}

// データに書かれた色は、#rgb / #rrggbb / rgb(a)(...) だけ通す（HTML に混ぜられないように）
function color(v, fallback) {
  return typeof v === 'string' && /^(#[0-9a-fA-F]{3,8}|rgba?\([\d\s.,%]+\))$/.test(v) ? v : fallback;
}

function safe(fn, where) {
  try { fn(); } catch (err) { console.error('dashboard', where, err); }
}

function bold(s) { return esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>'); }
function text(id, v) { const el = document.getElementById(id); if (el && v != null) el.textContent = v; }
