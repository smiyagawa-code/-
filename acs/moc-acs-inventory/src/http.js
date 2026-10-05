// 書き込み系の API（AI チャット・保存）の共通チェック。
// 他のサイトからログイン中のブラウザ経由で呼ばれるのを防ぐ（JSON 以外・別サイト発は拒否）
export function isSameOriginJson(request) {
  const type = request.headers.get('content-type') || '';
  if (!type.toLowerCase().startsWith('application/json')) return false;
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin') return false;
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return false;
  return true;
}

export function forbiddenCrossSite() {
  return Response.json({ error: 'この呼び出しは受け付けられません。' }, { status: 403 });
}
