// 公開後の確認: ログインしていない人がURLを開いたとき、Access のログイン画面に飛ばされるか。
// 使い方: npm run verify -- https://moc-xxx.thomas-gr.workers.dev
const url = process.argv[2];
if (!url || !/^https:\/\//.test(url)) {
  console.error('使い方: npm run verify -- https://<モック名>.<サブドメイン>.workers.dev');
  process.exit(2);
}

// 画面と API の両方を、ログインしていない状態で開いてみる
const base = new URL(url);
let ok = true;
for (const path of ['/', '/api/data', '/api/me']) {
  const target = new URL(path, base);
  const res = await fetch(target, { redirect: 'manual' });
  const result = judge(res);
  console.log(`${result.ok ? 'OK' : 'NG'}: ${target.pathname} — ${result.message}`);
  ok &&= result.ok;
}
if (!ok) {
  console.error('\nお客様に URL を送らないでください。管理者に「全 Worker の Access 保護」（初期設定 A-3）を確認してもらってください。');
}
process.exit(ok ? 0 : 1);

function judge(res) {
  const location = res.headers.get('location') || '';
  let host = '';
  try { host = new URL(location, base).hostname; } catch { /* 空のまま */ }
  if ([301, 302, 303, 307].includes(res.status) && host.endsWith('.cloudflareaccess.com')) {
    return { ok: true, message: `Access のログイン画面へ移動します（${res.status}）` };
  }
  if (res.status === 401) {
    return { ok: false, message: 'パスワード方式の保護です（Access ではありません）。このひな形のモックではありません' };
  }
  if (res.status === 403) {
    return { ok: false, message: 'Access が掛かっていません（中身は見えませんが、誰もログインできません）' };
  }
  return { ok: false, message: `想定外の応答です（HTTP ${res.status}）。誰でも見られる状態の可能性があります。すぐ管理者に連絡してください` };
}
