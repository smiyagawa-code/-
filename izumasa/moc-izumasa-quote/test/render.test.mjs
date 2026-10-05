// 実際に画面を組み立ててみるテスト（ブラウザの代わりに簡易な DOM を使う）。
// 全タブ・全依頼・拠点を切り替えても、undefined / NaN / 表示できません が出ないことを見る。
import test from 'node:test';
import assert from 'node:assert/strict';
import { getDemoData, SITES, _REQUESTS } from '../src/data.js';

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

test('全依頼 × 全タブ × 拠点で画面が壊れない', async () => {
  const els = new Map();
  const errors = [];
  let lastBody = null;
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
  globalThis.fetch = async (url, init) => {
    const u = new URL(String(url), 'https://x.test');
    if (u.pathname === '/api/data') {
      lastBody = init?.body ? JSON.parse(init.body) : {};
      return { ok: true, json: async () => JSON.parse(JSON.stringify(getDemoData({ folder: lastBody.folder, site: lastBody.site, edits: lastBody.edits }))) };
    }
    return { ok: true, json: async () => ({ ai: true, db: false }) };
  };
  const origError = console.error;
  console.error = (...a) => errors.push(a.map(String).join(' '));
  try {
    await import('../public/app.js');
    await globalThis.__dashboardReady;
    assert.equal(lastBody.folder, 'all');
    const tabs = getDemoData().tabs.map((t) => t.id);
    for (const site of SITES.map((s) => s.id)) {
      els.get('sitePick').fire('change', { target: { value: site } });
      await tick();
      for (const folder of ['all', ..._REQUESTS.map((r) => r.id)]) {
        els.get('folders').fire('click', { target: { closest: () => ({ dataset: { folder } }) } });
        await tick();
        assert.equal(lastBody.folder, folder);
        assert.equal(lastBody.site, site);
        for (const tab of tabs) {
          els.get('tabs').fire('click', { target: { closest: () => ({ dataset: { tab } }) } });
          const html = `${els.get('panel').innerHTML} ${els.get('folders').innerHTML} ${els.get('tabs').innerHTML}`;
          for (const bad of ['undefined', 'NaN', 'Infinity', '表示できません', '[object Object]', '>null<', 'null<']) {
            assert.ok(!html.includes(bad), `${site}/${folder}/${tab}: 画面に「${bad}」が出ている`);
          }
          assert.ok(els.get('panel').innerHTML.includes('<article'), `${site}/${folder}/${tab}: 中身が空`);
        }
      }
    }
    // 手直し: 掛率の変更 → サーバーに edits が送られ、表に反映される
    els.get('sitePick').fire('change', { target: { value: 'fukuoka' } });
    await tick();
    els.get('folders').fire('click', { target: { closest: () => ({ dataset: { folder: 'q01' } }) } });
    await tick();
    els.get('tabs').fire('click', { target: { closest: () => ({ dataset: { tab: 'pricing' } }) } });
    els.get('panel').fire('change', { target: { dataset: { line: 'l1', field: 'rate' }, value: '0.5' } });
    await tick();
    assert.equal(lastBody.edits.q01.lines.l1.rate, 0.5);
    assert.ok(els.get('panel').innerHTML.includes('手入力（表は 0.56）'), '掛率の手入力が表に出る');
    // 確認済み → 要確認が減る
    els.get('tabs').fire('click', { target: { closest: () => ({ dataset: { tab: 'lines' } }) } });
    const before = (els.get('panel').innerHTML.match(/確認済みにする/g) || []).length;
    els.get('panel').fire('click', { target: { closest: (sel) => (sel === '[data-resolve]' ? { dataset: { resolve: 'l3' } } : null) } });
    await tick();
    const after = (els.get('panel').innerHTML.match(/確認済みにする/g) || []).length;
    assert.equal(after, before - 1);
    // 行の追加
    els.get('panel').fire('submit', { preventDefault() {}, target: { closest: () => ({ elements: { itemId: { value: 'iv14' }, qty: { value: '100' }, note: { value: '' } } }) } });
    await tick();
    assert.equal(lastBody.edits.q01.added[0].item, 'iv14');
    assert.ok(els.get('panel').innerHTML.includes('IV 14sq'));
    // 見積書: 空白行の追加と削除
    els.get('tabs').fire('click', { target: { closest: () => ({ dataset: { tab: 'sheet' } }) } });
    els.get('panel').fire('click', { target: { closest: (sel) => (sel === '[data-extra-add]' ? { dataset: { extraAdd: 'blank' } } : null) } });
    await tick();
    assert.ok(els.get('panel').innerHTML.includes('class="blank"'));
    els.get('panel').fire('click', { target: { closest: (sel) => (sel === '[data-remove-extra]' ? { dataset: { removeExtra: 'x1' } } : null) } });
    await tick();
    assert.ok(!els.get('panel').innerHTML.includes('class="blank"'));
  } finally {
    console.error = origError;
  }
  assert.deepEqual(errors, [], `組み立て中のエラー: ${errors.join(' / ')}`);
  assert.ok(els.get('sitePick').innerHTML.includes('<option'), '拠点の選択肢が出ていない');
});

const tick = () => new Promise((r) => setTimeout(r, 5));
