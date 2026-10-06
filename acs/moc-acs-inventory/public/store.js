// 画面側の保存（ブラウザの localStorage）。今日のデモ用。同じブラウザで開けば第三者も同じ内容を見られる。
// 後で /api/records（D1）に差し替えられるよう、ここだけを通す。
const PREFIX = 'moc-acs:';

export function load(key, fallback) {
  try { const v = localStorage.getItem(PREFIX + key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
}
export function save(key, value) {
  try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch { /* 保存できない環境では画面だけ動く */ }
}
// 履歴（いつ・誰が・何を）を末尾に足す。最大 500 件
export function appendLog(key, entry) {
  const log = load(key, []);
  log.push({ at: new Date().toISOString(), who: load('me', '担当者'), ...entry });
  save(key, log.slice(-500));
  return log;
}
export function clearAll() {
  try { Object.keys(localStorage).filter((k) => k.startsWith(PREFIX)).forEach((k) => localStorage.removeItem(k)); } catch { /* 無視 */ }
}
