// 画面共通の小道具
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
export function fmt(v) {
  return typeof v === 'number' ? v.toLocaleString('ja-JP') : String(v ?? '');
}
