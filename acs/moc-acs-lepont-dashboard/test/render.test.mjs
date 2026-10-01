// 実際に画面を組み立ててみるテスト（ブラウザの代わりに簡易な DOM を使う）。
// data.js の宣言が「テストは通るが画面が壊れる」状態になっていないかを、公開前に見つける。
import test from 'node:test';
import assert from 'node:assert/strict';
import { getDemoData } from '../src/data.js';

function fakeElement(id) {
  return {
    id, innerHTML: '', textContent: '', hidden: false, scrollTop: 0, scrollHeight: 0, dataset: {},
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener() {}, removeAttribute() {}, remove() {}, append() {}, closest() { return null; },
    querySelectorAll() { return []; }, getBoundingClientRect() { return { width: 0, height: 0 }; },
  };
}

test('画面を組み立てても壊れない（undefined・NaN・表示できません が出ない）', async () => {
  const els = new Map();
  const errors = [];
  globalThis.document = {
    title: '',
    getElementById: (id) => { if (!els.has(id)) els.set(id, fakeElement(id)); return els.get(id); },
    querySelector: () => fakeElement('q'),
    querySelectorAll: () => [],
    createElement: () => fakeElement('new'),
  };
  globalThis.fetch = async (url) => ({
    ok: true,
    json: async () => (String(url).includes('/api/data') ? JSON.parse(JSON.stringify(getDemoData())) : { ai: true, db: false }),
  });
  const origError = console.error;
  console.error = (...a) => errors.push(a.map(String).join(' '));
  try {
    await import('../public/app.js');
    await globalThis.__dashboardReady;
  } finally {
    console.error = origError;
  }

  assert.deepEqual(errors, [], `組み立て中のエラー: ${errors.join(' / ')}`);
  const html = [...els.values()].map((e) => `${e.innerHTML} ${e.textContent}`).join('\n');
  for (const bad of ['undefined', 'NaN', 'Infinity', '表示できません', '[object Object]']) {
    assert.ok(!html.includes(bad), `画面に「${bad}」が出ている。src/data.js を確認`);
  }
  const d = getDemoData();
  for (const s of d.sections) for (const c of s.cards) assert.ok(html.includes(c.title), `カード「${c.title}」が表示されていない`);
  assert.ok(els.get('kpis').innerHTML.includes('kpi'), '上部の数字が出ていない');
});
