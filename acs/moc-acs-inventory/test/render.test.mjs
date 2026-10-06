// 実際に画面を組み立ててみるテスト（ブラウザの代わりに簡易な DOM を使う）。
// 全タブ・全フォルダを切り替えても、undefined / NaN / 表示できません が出ないことを見る。
import test from 'node:test';
import assert from 'node:assert/strict';
import { getDemoData, _FOLDERS } from '../src/data.js';

function fakeElement(id) {
  const handlers = {};
  return {
    id, innerHTML: '', textContent: '', hidden: false, scrollTop: 0, scrollHeight: 0, dataset: {}, style: {}, value: '',
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener(type, fn) { handlers[type] = fn; }, fire(type, ev) { handlers[type]?.(ev); },
    removeAttribute() {}, remove() {}, append() {}, closest() { return null; },
    querySelectorAll() { return []; }, getBoundingClientRect() { return { left: 0, bottom: 0 }; }, scrollIntoView() {},
  };
}

test('全フォルダ × 全タブで画面が壊れない', async () => {
  const els = new Map();
  const errors = [];
  // 画面側の保存（public/store.js）は localStorage を使う。Node では無いので偽物を置く
  const mem = new Map();
  globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k), key: (i) => [...mem.keys()][i] ?? null, get length() { return mem.size; } };
  globalThis.document = {
    title: '',
    getElementById: (id) => { if (!els.has(id)) els.set(id, fakeElement(id)); return els.get(id); },
    querySelector: () => fakeElement('q'),
    querySelectorAll: () => [],
    createElement: () => fakeElement('new'),
    addEventListener() {},
  };
  globalThis.location = { hash: '' };
  globalThis.history = { replaceState() {} };
  globalThis.fetch = async (url) => {
    const u = new URL(String(url), 'https://x.test');
    if (u.pathname === '/api/data') {
      return { ok: true, json: async () => JSON.parse(JSON.stringify(getDemoData({ base: u.searchParams.get('base') || undefined, folder: u.searchParams.get('folder') || undefined }))) };
    }
    return { ok: true, json: async () => ({ ai: true, db: false }) };
  };
  const origError = console.error;
  console.error = (...a) => errors.push(a.map(String).join(' '));
  try {
    await import('../public/app.js');
    await globalThis.__dashboardReady;
    const tabs = getDemoData().tabs.map((t) => t.id);
    assert.equal(tabs.length, 3);
    for (const folder of ['all', ..._FOLDERS.map((f) => f.id)]) {
      els.get('folders').fire('click', { target: { closest: () => ({ dataset: { folder } }) } });
      await new Promise((r) => setTimeout(r, 5));
      for (const tab of tabs) {
        els.get('tabs').fire('click', { target: { closest: () => ({ dataset: { tab } }) } });
        const html = `${els.get('panel').innerHTML} ${els.get('folders').innerHTML} ${els.get('tabs').innerHTML}`;
        for (const bad of ['undefined', 'NaN', 'Infinity', '表示できません', '[object Object]', 'null', 'リードタイム', '基準日', '発注残']) {
          assert.ok(!html.includes(bad), `${folder}/${tab}: 画面に「${bad}」が出ている`);
        }
        assert.ok(els.get('panel').innerHTML.includes('<article'), `${folder}/${tab}: 中身が空`);
      }
    }
  } finally {
    console.error = origError;
  }
  assert.deepEqual(errors, [], `組み立て中のエラー: ${errors.join(' / ')}`);
  assert.ok(els.get('scopeName').textContent, '範囲の名前が出ていない');
});
