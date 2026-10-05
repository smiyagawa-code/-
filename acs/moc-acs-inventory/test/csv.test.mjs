// 内示 CSV を本当に読んで計算し直せるか（明日のデモで「内示をここに置く」に落とす見本 3 本で確かめる）
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import worker from '../src/index.js';
import { getAiData, getDemoData, parseNaishiCsv } from '../src/data.js';

const read = (name) => fs.readFileSync(new URL(`../public/sample/${name}`, import.meta.url), 'utf8');
const NOW = read('内示_今回_2026-09-25.csv');
const PREV = read('内示_前回_2026-08-28.csv');
const EDIT = read('内示_今回_修正版.csv');

test('見本 CSV 3 本が読める（3 行・エラーなし）', () => {
  for (const t of [NOW, PREV, EDIT]) {
    const p = parseNaishiCsv(t);
    assert.equal(p.rows.length, 3);
    assert.deepEqual(p.errors, []);
  }
});

test('列名のゆれ・BOM・CRLF・引用符つきの備考も読める', () => {
  const t = '﻿案件名,台数,希望納期,オプション,コメント\r\n"組立セル AS-500 導入",3,2026/10/15,"ライトカーテン仕様 4段","前倒し, 至急"\r\n';
  const p = parseNaishiCsv(t);
  assert.deepEqual(p.errors, []);
  assert.equal(p.rows.length, 1);
  assert.equal(p.rows[0].qty, 3);
  assert.equal(p.rows[0].due, '2026-10-15');
  assert.deepEqual(p.rows[0].options, ['ライトカーテン仕様 4段']);
  assert.equal(p.rows[0].note, '前倒し, 至急');
});

test('読めない CSV は理由つきで断る', () => {
  assert.deepEqual(parseNaishiCsv('').rows, []);
  assert.match(parseNaishiCsv('a,b\n1,2\n').errors.join(), /列「案件」がありません/);
  const bad = parseNaishiCsv('案件,数量,納入希望日\n組立セル AS-500 導入,たくさん,2026-10-15\n');
  assert.equal(bad.rows.length, 0);
  assert.match(bad.errors.join(), /数量「たくさん」が読めません/);
});

test('今回の CSV を置くと、既定の画面と同じ部品・やることになる（置かなくても同じ内示）', () => {
  const a = getDemoData(), b = getDemoData({ csv: NOW });
  const strip = (d) => d.parts.map((p) => [p.code, p.needSep, p.short, p.order, p.eta, p.late, p.status].join());
  assert.deepEqual(strip(b), strip(a));
  assert.equal(b.todos.length, a.todos.length);
  assert.deepEqual(b.csv.matched.map((m) => m.folderId), ['f01', 'f02', 'f03']);
  assert.deepEqual(b.csv.unmatched, []);
  assert.ok(b.folders.filter((f) => f.fromCsv).length === 3);
});

test('前回の CSV を置くと「変わった点なし」になる', () => {
  const d = getDemoData({ csv: PREV });
  assert.equal(d.changes.length, 0);
  assert.ok(d.folders.filter((f) => !f.pending).every((f) => f.status === '変更なし'));
});

test('修正版の CSV を置くと数字が変わる（組立セル 3台・第2工場 11/7・クリーン仕様 取消撤回）', () => {
  const d = getDemoData({ csv: EDIT });
  const f02 = getDemoData({ csv: EDIT, folder: 'f02' });
  assert.ok(f02.changes.some((c) => c.kind === '増えた' && c.title === '2台 → 3台'));
  const lc = f02.parts.find((p) => p.code === 'AS-06-148');
  assert.equal(lc.needSep, 6, '「ライトカーテン仕様 4段」でもライトカーテンの部品が付く');
  const f01 = getDemoData({ csv: EDIT, folder: 'f01' });
  assert.ok(f01.changes.some((c) => c.kind === '前倒し' && /11\/14 → 11\/7/.test(c.title)));
  const f03 = getDemoData({ csv: EDIT, folder: 'f03' });
  assert.equal(f03.changes.length, 0, '1台 → 1台 は変わった点なし');
  assert.equal(f03.todos.filter((t) => t.kind === '社内で決める').length, 0, '取消撤回なので余る物なし');
  assert.ok(d.todos.length !== getDemoData().todos.length);
});

test('CSV を置いたときも AI は画面と同じ数字を見る', () => {
  for (const csv of [NOW, EDIT, PREV]) {
    for (const folder of ['all', 'f01', 'f02', 'f03']) {
      const d = getDemoData({ csv, folder });
      const ai = getAiData({ csv, folder });
      const aiParts = new Map(ai.案件.flatMap((a) => (a.部品 || []).map((p) => [`${a.案件}/${p.型番}`, p])));
      for (const r of d.parts) {
        const p = aiParts.get(`${r.folderName}/${r.code}`);
        assert.ok(p, `${r.code} が AI にない`);
        assert.equal(p.今回いる数_個, r.needSep);
        assert.equal(p.足りない数_個, r.short);
        assert.deepEqual(p.なぜ, r.why);
      }
    }
  }
});

test('CSV の案件名のゆれ: 機種で当てはめる。知らない行は「部品表がない」として返す', () => {
  const t = '案件,機種,数量,納入希望日\n組立セル（名前違い）,AS-500,2,2026-10-15\n新規の装置,ZZ-1,1,2026-12-01\n';
  const d = getDemoData({ csv: t });
  assert.deepEqual(d.csv.matched.map((m) => m.folderId), ['f02']);
  assert.deepEqual(d.csv.unmatched.map((u) => u.name), ['新規の装置']);
});

test('長すぎる CSV・形の違うものは無視して既定に戻す', () => {
  assert.equal(getDemoData({ csv: 'x'.repeat(30000) }).csv, null);
  assert.equal(getDemoData({ csv: 123 }).csv, null);
});

const loggedIn = { access: { getIdentity: async () => ({ email: 'sales@thomas-gr.com' }) } };
const env = { ASSETS: { fetch: async () => new Response('x') } };
const post = (body, headers = {}) => new Request('https://moc-test.example.workers.dev/api/data', {
  method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://moc-test.example.workers.dev', 'sec-fetch-site': 'same-origin', ...headers }, body: JSON.stringify(body),
});

test('/api/data に CSV を POST すると計算し直した結果が返る。別サイトからは拒否', async () => {
  const ok = await worker.fetch(post({ folder: 'f02', csv: EDIT }), env, loggedIn);
  assert.equal(ok.status, 200);
  const body = await ok.json();
  assert.equal(body.selectedFolder, 'f02');
  assert.ok(body.changes.some((c) => c.title === '2台 → 3台'));
  assert.deepEqual(body.csvErrors, []);

  const bad = await worker.fetch(post({ csv: 'a,b\n1,2\n' }), env, loggedIn);
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /読めませんでした/);

  const big = await worker.fetch(post({ csv: 'x'.repeat(30000) }), env, loggedIn);
  assert.equal(big.status, 400);

  const cross = await worker.fetch(post({ csv: EDIT }, { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' }), env, loggedIn);
  assert.equal(cross.status, 403);

  const noAuth = await worker.fetch(post({ csv: EDIT }), env, {});
  assert.equal(noAuth.status, 403, 'ログインしていなければ CSV も受け付けない');
});
