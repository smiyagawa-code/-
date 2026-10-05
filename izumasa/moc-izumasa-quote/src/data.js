// 架空データと計算（唯一の置き場）。画面（/api/data）と AI（/api/chat）は、どちらも同じ build() の結果だけを使う。
// 顧客の本物のデータは入れない。依頼元・件名・数量・単価・メーカー名・担当者名はすべて架空。
// 商品の区分（CV／CVT／IV／EM-IE／CVV／VVF／弱電線）と業務の流れだけは、公開情報と商談で伺った内容に合わせた。
//
// 見せたいこと（イズマサ様 9/9 お打ち合わせでいただいたご要望）
//  ① 依頼書（内訳明細書 PDF・メール本文・FAX）から明細を読み取り、人が判断すべき行に「要確認」を出す
//     （芯数の記載なし／「〃」で前行を参照／サイズが不鮮明／同一品目が別ページに分かれている→合算／件名がファイル名にない）
//  ② 単価の算出根拠を画面で追える（ベース単価 × 掛率 → 端数処理。拠点・在庫／直送・価格ランクで掛率が変わる）
//  ③ 商品群でまとめて決めつつ、行ごとに掛率・単価を手で上書きできる。拾えなかった品目を後から足せる
//  ④ 見積書は Excel 様式（自社ロゴ付き）。ケーブル 1 行ごとの注記、任意の空白行、備考欄、数量の内訳（◯m×◯本）
//  ⑤ メーカー単価表（約 20 社・うち毎月更新 10 社）の OCR 取込と、今月の差分
//
// 仕込んだ気づき（test/insights.test.mjs で守る）
//  A. みなと浄水場: CV 14sq-3C が 2 ページ目と 4 ページ目に分かれていて、合算すると 300m
//  B. みなと浄水場: 「CV 8 ×60m」は芯数の記載がなく 3C と推定（要確認）。次の行「〃 -2C」は前行から CV 8sq-2C と推定（要確認）
//  C. 細物の端数: EM-IE 2.0sq は 73.1 円（小数第 1 位まで）、EM-IE 5.5sq は 100 円を超えるので 181 円（切上）。倉庫棟の EM-IE 1.6mm（ランク B）は 52.8 円
//  D. 北陽電線の 10 月版単価表で CV 系が +3.3%。9 月版のまま出すと CV 38sq-3C は 95 円/m 安く出してしまう
//  E. 高台配水池: CVT 100sq 350m は在庫品でないので直送。概算 1,100kg 超の重量物なので受け取り可否の注記を自動で付ける
//  F. 同じ CV 14sq-3C でも、福岡支店と大阪本社で掛率が違う（0.56 と 0.54）

export const DEFAULT_SITE = 'fukuoka';
export const SITES = [
  { id: 'fukuoka', name: '福岡支店' },
  { id: 'osaka', name: '大阪本社' },
];
const OUR_NAME = '株式会社イズマサ 福岡支店 営業部';
const OUR_PERSON = '営業部 浦田'; // 架空の担当（文面の差出人）
const TODAY = '2026-10-05';

// ---------- 商品群（掛率の単位） ----------
// pricing: 'rate' = 建値 × 掛率 ／ 'table' = A単価・B単価の表で決まる（弱電線）
export const GROUPS = [
  { id: 'CV', name: '600V CVケーブル', pricing: 'rate' },
  { id: 'CVT', name: '600V CVTケーブル', pricing: 'rate' },
  { id: 'IV', name: '600V IV電線', pricing: 'rate' },
  { id: 'EM-IE', name: 'EM-IE（エコ電線）', pricing: 'rate' },
  { id: 'CVV', name: '制御用 CVVケーブル', pricing: 'rate' },
  { id: 'VVF', name: 'VVFケーブル', pricing: 'rate' },
  { id: 'LV', name: '弱電線（通信・計装）', pricing: 'table' },
];

// 掛率（売価 ÷ 建値）: 商品群 × 納品方式（在庫／直送）× 拠点。価格ランク B は −0.03
// 拠点ごとに運用が違う（同じ商品でも拠点ごとにコードが分かれている）ことを、掛率の違いで表す
const RATES = {
  fukuoka: { CV: [0.56, 0.50], CVT: [0.55, 0.49], IV: [0.60, 0.54], 'EM-IE': [0.58, 0.52], CVV: [0.57, 0.51], VVF: [0.62, 0.55] },
  osaka: { CV: [0.54, 0.48], CVT: [0.53, 0.47], IV: [0.58, 0.52], 'EM-IE': [0.56, 0.50], CVV: [0.55, 0.49], VVF: [0.60, 0.53] },
};
const RANK_B_DELTA = -0.03;

// メーカー（架空）と単価表の更新サイクル
export const MAKERS = [
  { id: 'hokuyo', name: '北陽電線', cycle: '毎月', last: '2026-10-01', edition: '10月版', status: '取込済み・差分あり', items: 46, changed: 9 },
  { id: 'nishinihon', name: '西日本電線工業', cycle: '毎月', last: '2026-10-01', edition: '10月版', status: '取込済み', items: 38, changed: 0 },
  { id: 'towa', name: '東和ケーブル', cycle: '毎月', last: '2026-09-02', edition: '9月版', status: '10月版 未着（催促中）', items: 52, changed: 0 },
  { id: 'suminoe', name: '住之江電線', cycle: '毎月', last: '2026-10-02', edition: '10月版', status: 'OCR 要確認 2 件', items: 41, changed: 3 },
  { id: 'kyutsu', name: '九州通信線材', cycle: '3か月', last: '2026-09-01', edition: '2026 下期版', status: '取込済み', items: 27, changed: 0 },
  { id: 'setouchi', name: '瀬戸内電線', cycle: '毎月', last: '2026-10-01', edition: '10月版', status: '取込済み', items: 33, changed: 2 },
  { id: 'hakata', name: '博多電線製作所', cycle: '毎月', last: '2026-10-03', edition: '10月版', status: '取込済み', items: 29, changed: 1 },
  { id: 'chugoku', name: '中国電材', cycle: '毎月', last: '2026-10-01', edition: '10月版', status: '取込済み', items: 35, changed: 4 },
  { id: 'nanbu', name: '南部ケーブル', cycle: '毎月', last: '2026-09-01', edition: '9月版', status: '10月版 未着', items: 24, changed: 0 },
  { id: 'kinki', name: '近畿電線', cycle: '毎月', last: '2026-10-01', edition: '10月版', status: '取込済み', items: 40, changed: 5 },
  { id: 'hokuriku', name: '北陸電線', cycle: '毎月', last: '2026-10-02', edition: '10月版', status: '取込済み', items: 31, changed: 2 },
  { id: 'tokai', name: '東海ケーブル', cycle: '2〜3か月', last: '2026-08-01', edition: '8月版', status: '取込済み', items: 22, changed: 0 },
  { id: 'sanin', name: '山陰電線', cycle: '半年', last: '2026-07-01', edition: '2026 下期版', status: '取込済み', items: 18, changed: 0 },
  { id: 'shikoku', name: '四国電線', cycle: '半年', last: '2026-07-01', edition: '2026 下期版', status: '取込済み', items: 20, changed: 0 },
  { id: 'kita', name: '北海電線', cycle: '1年', last: '2026-04-01', edition: '2026 年版', status: '取込済み', items: 26, changed: 0 },
  { id: 'tohoku', name: '東北ケーブル', cycle: '1年', last: '2026-04-01', edition: '2026 年版', status: '取込済み', items: 19, changed: 0 },
  { id: 'kanto', name: '関東電線工業', cycle: '2〜3か月', last: '2026-09-01', edition: '9月版', status: '取込済み', items: 30, changed: 0 },
  { id: 'nagoya', name: '名古屋線材', cycle: '2〜3か月', last: '2026-09-01', edition: '9月版', status: '取込済み', items: 15, changed: 0 },
  { id: 'osakaw', name: '大阪ワイヤー', cycle: '半年', last: '2026-07-01', edition: '2026 下期版', status: '取込済み', items: 12, changed: 0 },
  { id: 'ryukyu', name: '琉球電線', cycle: '1年', last: '2026-04-01', edition: '2026 年版', status: '取込済み', items: 11, changed: 0 },
];
const MAKER = Object.fromEntries(MAKERS.map((m) => [m.id, m]));

// 商品カタログ（架空）。[id, 群, 品名, サイズ・芯数, メーカー, 建値_円/m（最新版）, 前版の建値, 在庫品か, 概算重量_kg/m, 細物か]
// 弱電線（LV）は建値ではなく A単価・B単価（priceA / priceB）
const ITEMS = [
  ['cv8-3', 'CV', 'CV', '8sq-3C', 'hokuyo', 1470, 1420, true, 0.42, false],
  ['cv8-2', 'CV', 'CV', '8sq-2C', 'hokuyo', 1040, 1010, true, 0.31, false],
  ['cv14-3', 'CV', 'CV', '14sq-3C', 'hokuyo', 2250, 2180, true, 0.68, false],
  ['cv22-3', 'CV', 'CV', '22sq-3C', 'hokuyo', 3300, 3200, true, 0.98, false],
  ['cv38-3', 'CV', 'CV', '38sq-3C', 'hokuyo', 5320, 5150, true, 1.58, false],
  ['cvt60', 'CVT', 'CVT', '60sq', 'nishinihon', 9800, 9800, false, 2.35, false],
  ['cvt100', 'CVT', 'CVT', '100sq', 'nishinihon', 15600, 15600, false, 3.42, false],
  ['iv2', 'IV', 'IV', '2.0sq', 'suminoe', 118, 118, true, 0.03, false],
  ['iv5.5', 'IV', 'IV', '5.5sq', 'suminoe', 290, 290, true, 0.07, false],
  ['iv14', 'IV', 'IV', '14sq', 'suminoe', 690, 690, true, 0.16, false],
  ['em1.6', 'EM-IE', 'EM-IE', '1.6mm', 'setouchi', 96, 96, true, 0.025, true],
  ['em2', 'EM-IE', 'EM-IE', '2.0sq', 'setouchi', 126, 126, true, 0.03, true],
  ['em5.5', 'EM-IE', 'EM-IE', '5.5sq', 'setouchi', 312, 312, true, 0.07, true],
  ['em8', 'EM-IE', 'EM-IE', '8sq', 'setouchi', 455, 455, true, 0.1, false],
  ['cvv1.25-7', 'CVV', 'CVV', '1.25sq-7C', 'towa', 640, 640, true, 0.17, false],
  ['cvv1.25-10', 'CVV', 'CVV', '1.25sq-10C', 'towa', 860, 860, false, 0.22, false],
  ['cvv2-12', 'CVV', 'CVV', '2sq-12C', 'towa', 1480, 1480, true, 0.36, false],
  ['vvf1.6-2', 'VVF', 'VVF', '1.6mm-2C', 'hakata', 165, 165, true, 0.05, false],
  ['vvf2.0-3', 'VVF', 'VVF', '2.0mm-3C', 'hakata', 320, 320, true, 0.09, false],
  ['cpev0.9-10', 'LV', 'CPEV', '0.9mm-10P', 'kyutsu', null, null, true, 0.21, true, 540, 505],
  ['cpev0.65-5', 'LV', 'CPEV', '0.65mm-5P', 'kyutsu', null, null, true, 0.08, true, 168, 157],
  ['fcpev0.9-5', 'LV', 'FCPEV', '0.9mm-5P', 'kyutsu', null, null, true, 0.14, true, 420, 392],
];
const ITEM = Object.fromEntries(ITEMS.map(([id, group, name, spec, maker, price, prevPrice, stocked, kgPerM, thin, priceA, priceB]) =>
  [id, { id, group, name, spec, label: `${name} ${spec}`, maker, price, prevPrice, stocked, kgPerM, thin, priceA, priceB }]));

// 基準在庫（m）。販売管理システムの在庫一覧から作る想定（架空）。拠点ごと
const STOCK = {
  fukuoka: { 'cv8-3': 800, 'cv8-2': 200, 'cv14-3': 500, 'cv22-3': 300, 'cv38-3': 200, iv2: 3000, 'iv5.5': 1200, iv14: 600, 'em1.6': 2000, em2: 2500, 'em5.5': 900, em8: 400, 'cvv1.25-7': 300, 'cvv2-12': 200, 'vvf1.6-2': 4000, 'vvf2.0-3': 1500, 'cpev0.9-10': 800, 'cpev0.65-5': 500, 'fcpev0.9-5': 300 },
  osaka: { 'cv8-3': 1200, 'cv8-2': 400, 'cv14-3': 900, 'cv22-3': 500, 'cv38-3': 400, iv2: 5000, 'iv5.5': 2000, iv14: 800, 'em1.6': 3000, em2: 4000, 'em5.5': 1500, em8: 600, 'cvv1.25-7': 500, 'cvv2-12': 300, 'vvf1.6-2': 6000, 'vvf2.0-3': 2500, 'cpev0.9-10': 1000, 'cpev0.65-5': 800, 'fcpev0.9-5': 500 },
};

// ---------- 見積依頼（フォルダ）。lines は依頼書から AI が読み取った行（架空） ----------
// line: { id, item, qty, read: 読み取った原文, from: 出どころ, page, breakdown?: 内訳表記, alert?: 要確認の内容, guess?: 推定した内容, note?: 行の注記 }
const REQUESTS = [
  {
    id: 'q01', no: 'Q-2610-018', title: 'みなと浄水場 電気設備更新工事', client: '九州電設工業株式会社', person: '工務部 吉田',
    kind: '公共案件の内訳明細書（PDF 4 ページ）', received: '2026-10-02', due: '2026-10-08', status: 'reading',
    source: 'メール添付「内訳書.pdf」（ファイル名に件名なし）',
    titleFrom: '図面の図枠「工事件名」欄から読み取り', titleAlert: 'ファイル名に件名がないため、図枠の工事件名を転記。依頼メールの件名「見積依頼の件」とは一致しないので確認',
    rank: 'A',
    lines: [
      { id: 'l1', item: 'cv38-3', qty: 240, read: 'CV 38sq-3C　240m', from: '内訳書 2 ページ目 行 4', page: 2 },
      { id: 'l2', item: 'cv14-3', qty: 180, read: 'CV 14sq-3C　180m', from: '内訳書 2 ページ目 行 5', page: 2 },
      { id: 'l3', item: 'cv8-3', qty: 60, read: 'CV 8　×60m', from: '内訳書 3 ページ目 行 2', page: 3, alert: '芯数の記載がありません。通常よく使う 3C で読み取りました（2C・4C の可能性あり）', guess: '芯数 3C と推定' },
      { id: 'l4', item: 'cv8-2', qty: 40, read: '〃 -2C　×40m', from: '内訳書 3 ページ目 行 3', page: 3, alert: '「〃」は前の行（CV 8）を指すと判断し、CV 8sq-2C で読み取りました', guess: '前行から CV 8sq と推定' },
      { id: 'l5', item: 'cv14-3', qty: 120, read: 'CV 14sq-3C　120m', from: '内訳書 4 ページ目 行 1', page: 4, merge: 'l2' },
      { id: 'l6', item: 'em5.5', qty: 600, read: 'EM-IE 5.5sq　600m', from: '内訳書 4 ページ目 行 3', page: 4 },
      { id: 'l7', item: 'em2', qty: 1200, read: 'EM-IE 2.0sq　1,200m', from: '内訳書 4 ページ目 行 4', page: 4 },
      { id: 'l8', item: 'cvv2-12', qty: 150, read: 'CVV 2sq-12C　150m', from: '内訳書 4 ページ目 行 6', page: 4 },
      { id: 'l9', item: 'cvv1.25-7', qty: 80, read: 'CVV 1.25sq -?C　80m', from: '内訳書 4 ページ目 行 7', page: 4, alert: '芯数が読み取れません（印字がかすれ）。候補は 7C か 10C。7C で仮に読み取りました', guess: '芯数 7C と仮置き' },
      { id: 'l10', item: 'fcpev0.9-5', qty: 200, read: 'FCPEV 0.9-5P　200m', from: '内訳書 4 ページ目 行 9', page: 4 },
    ],
  },
  {
    id: 'q02', no: 'Q-2610-021', title: '倉庫棟 増築に伴う電気工事', client: '福博電気株式会社', person: '営業 中村',
    kind: 'メール本文の依頼（添付なし）', received: '2026-10-03', due: '2026-10-07', status: 'pricing',
    source: 'メール本文（件名「Re: 見積のお願い（倉庫棟 増築）」）',
    titleFrom: '依頼メールの件名から転記', titleAlert: '',
    rank: 'B',
    lines: [
      { id: 'l1', item: 'iv5.5', qty: 300, read: 'IV 5.5sq 緑　100m×3本', from: 'メール本文 2 行目', breakdown: '100m×3本', note: '100m巻' },
      { id: 'l2', item: 'vvf2.0-3', qty: 500, read: 'VVF 2.0-3C　100m×5巻', from: 'メール本文 3 行目', breakdown: '100m×5巻', note: '100m巻' },
      { id: 'l3', item: 'em1.6', qty: 300, read: 'EM-IE 1.6mm　300m', from: 'メール本文 4 行目' },
      { id: 'l4', item: 'iv2', qty: 500, read: 'IV 2.0sq 黒　500m', from: 'メール本文 5 行目' },
    ],
  },
  {
    id: 'q03', no: 'Q-2610-019', title: '高台配水池 ポンプ更新工事', client: '西部施設工業株式会社', person: '電気部 田中',
    kind: 'FAX の手書き依頼（スキャン PDF 1 ページ）', received: '2026-10-02', due: '2026-10-09', status: 'reading',
    source: 'FAX（スキャン PDF「fax_1002.pdf」）',
    titleFrom: 'FAX 本文の見出しから転記', titleAlert: '',
    rank: 'A',
    lines: [
      { id: 'l1', item: 'cvt100', qty: 350, read: 'CVT 100sq　350m', from: 'FAX 行 1', note: '直送（メーカー出荷）・ドラム巻' },
      { id: 'l2', item: 'cvt60', qty: 120, read: 'CVT 60sq　120m', from: 'FAX 行 2' },
      { id: 'l3', item: 'cv22-3', qty: 90, read: 'CV 22(38?)sq-3C　90m', from: 'FAX 行 3', alert: 'サイズの手書きが不鮮明です（22 か 38）。22sq で仮に読み取りました', guess: 'サイズ 22sq と仮置き' },
      { id: 'l4', item: 'cpev0.9-10', qty: 500, read: 'CPEV 0.9-10P　500m', from: 'FAX 行 4' },
    ],
  },
  {
    id: 'q04', no: 'Q-2609-087', title: '住吉第二工場 動力盤改修', client: '西部施設工業株式会社', person: '電気部 田中',
    kind: 'Excel の依頼書', received: '2026-09-26', due: '2026-09-30', status: 'answered', answered: '2026-09-30', approvedBy: '営業所長 大野', shareUrl: 'https://quote.example/share/Q-2609-087',
    source: 'メール添付「見積依頼.xlsx」',
    titleFrom: 'Excel のタイトル行から転記', titleAlert: '',
    rank: 'A',
    lines: [
      { id: 'l1', item: 'cv14-3', qty: 200, read: 'CV 14sq-3C　200m', from: 'Excel 行 2' },
      { id: 'l2', item: 'iv2', qty: 500, read: 'IV 2.0sq　500m', from: 'Excel 行 3' },
      { id: 'l3', item: 'vvf1.6-2', qty: 1000, read: 'VVF 1.6-2C　1,000m', from: 'Excel 行 4', breakdown: '100m×10巻' },
    ],
  },
  {
    id: 'q05', no: 'Q-2610-022', title: '（件名 未確定）箱崎物流センター 新築電気工事', client: '博多電工株式会社', person: '工事部 井上',
    kind: '図面 PDF のみ（内訳なし）', received: '2026-10-05', due: '', status: 'received',
    source: 'メール添付「E-02.pdf」（図面 2 枚）',
    titleFrom: '図面の図枠に「箱崎物流センター 新築電気工事」と読める', titleAlert: '内訳明細書がなく、図面のみ。数量の拾い出しが必要なため、依頼元に内訳書の有無を確認する',
    rank: 'A',
    pending: '図面のみ受領。内訳明細書がないため読み取りを保留。依頼元に「内訳書の有無」「対象範囲（幹線のみか）」を確認中',
    lines: [],
  },
];

export const STATUS_LABEL = { reading: '読み取り済み・要確認あり', pricing: '単価確定待ち', answered: '回答済み', received: '受領（読み取り保留）' };

export const RULES = [
  { key: 'base', name: 'ベース単価', formula: 'メーカー単価表（最新版）の建値。弱電線・細物の一部は建値ではなく A単価・B単価の表で決まる' },
  { key: 'rate', name: '掛率', formula: '商品群 × 納品方式（在庫／直送）× 拠点 の表。価格ランク B は掛率 −0.03' },
  { key: 'calc', name: '算出単価', formula: '建値 × 掛率 → 端数処理（弱電線は A単価／B単価をそのまま）' },
  { key: 'round', name: '端数処理', formula: '小数点以下は切上。細物（EM-IE 5.5sq 以下・弱電線）は小数第 1 位まで切上。ただし 100 円/m を超えるときは小数点以下切上' },
  { key: 'override', name: '個別の上書き', formula: '掛率か単価を人が変えたら、その値を使い、根拠に「手入力」と残す' },
  { key: 'qty', name: '数量', formula: '同一品目が複数ページ・複数行に分かれていたら合算。内訳（◯m×◯本）は見積書に表記を残す' },
  { key: 'route', name: '納品方式の既定', formula: '在庫品は「在庫」（在庫が足りなくても補填して出荷。変更は人が行う）。在庫品でないものは「直送」' },
  { key: 'amount', name: '金額', formula: '算出単価 × 数量。合計は明細の合計（空白行・注記行は数えない）' },
];

// ---------- 計算（ここだけ） ----------
function build({ site = DEFAULT_SITE, edits = {} } = {}) {
  const requests = REQUESTS.map((r) => buildRequest(r, site, edits[r.id] || {}));
  return { site, siteName: SITES.find((s) => s.id === site).name, requests };
}

function buildRequest(r, site, e) {
  const lineEdits = e.lines || {};
  const added = (e.added || []).map((a, i) => ({ id: `a${i + 1}`, item: a.item, qty: a.qty, read: `${ITEM[a.item].label}　${fmtQty(a.qty)}m`, from: '手入力で追加（読み取り漏れ）', added: true, note: a.note || '' }));
  const raw = [...r.lines, ...added];
  // 同一品目の合算（merge で指定された行を親に足す）
  const merged = raw.filter((l) => !l.merge).map((l) => {
    const parts = raw.filter((x) => x.merge === l.id);
    if (!parts.length) return { ...l, qtyParts: null };
    return { ...l, qty: l.qty + sum(parts.map((p) => p.qty)), qtyParts: [l, ...parts].map((p) => ({ qty: p.qty, from: p.from })), mergedFrom: parts.map((p) => p.from) };
  });
  const lines = merged.map((l) => priceLine(l, r, site, lineEdits[l.id] || {}));
  const extras = (e.extras || []).map((x, i) => ({ ...x, id: `x${i + 1}` }));
  const alerts = [
    ...(r.titleAlert ? [{ kind: '件名', text: r.titleAlert, lineId: '' }] : []),
    ...lines.filter((l) => l.alert && !l.resolved).map((l) => ({ kind: '明細', text: `${l.label}: ${l.alert}`, lineId: l.id })),
    ...lines.filter((l) => l.qtyParts).map((l) => ({ kind: '合算', text: `${l.label}: ${l.qtyParts.map((p) => `${fmtQty(p.qty)}m（${p.from}）`).join(' ＋ ')} ＝ ${fmtQty(l.qty)}m に合算しました`, lineId: l.id })),
    ...lines.filter((l) => l.stocked && l.route === 'stock' && l.stock < l.qty).map((l) => ({ kind: '在庫', text: `${l.label}: 基準在庫 ${fmtQty(l.stock)}m に対し ${fmtQty(l.qty)}m。不足分は補填して出荷する前提で「在庫」の単価です（直送に変えるときは人が切り替え）`, lineId: l.id })),
    ...lines.filter((l) => l.priceChanged).map((l) => ({ kind: '単価表', text: `${l.label}: ${MAKER[l.maker].name} ${MAKER[l.maker].edition}で建値が ${fmtYen(l.prevPrice)} → ${fmtYen(l.price)} 円（${l.priceChangePct > 0 ? '+' : ''}${l.priceChangePct}%）に変わっています。前版のままなら ${fmtYen(l.unitPrev)} 円/m と ${fmtYen(Math.abs(l.unit - l.unitPrev))} 円の差`, lineId: l.id })),
    ...lines.filter((l) => l.heavy).map((l) => ({ kind: '重量物', text: `${l.label}: 概算 ${fmtQty(l.weightKg)}kg（${l.kgPerM}kg/m × ${fmtQty(l.qty)}m）。ドラム巻の重量物なので、受け取り可否（荷受け設備・車両）の注記を見積書に付けています`, lineId: l.id })),
  ];
  const total = sum(lines.map((l) => l.amount));
  const sheet = buildSheet(r, lines, extras, total);
  const mail = buildMail(r, lines, total, alerts);
  return { ...r, lines, extras, alerts, total, sheet, mail, statusLabel: STATUS_LABEL[r.status] };
}

function priceLine(l, r, site, ed) {
  const it = ITEM[l.item];
  const group = GROUPS.find((g) => g.id === it.group);
  const qty = Number.isInteger(ed.qty) && ed.qty > 0 ? ed.qty : l.qty;
  const stock = STOCK[site][it.id] ?? 0;
  const routeDefault = it.stocked ? 'stock' : 'direct';
  const route = ed.route === 'stock' || ed.route === 'direct' ? ed.route : routeDefault;
  const rank = ed.rank === 'A' || ed.rank === 'B' ? ed.rank : r.rank;
  const basis = {};
  let rateTable = null, rate = null, unit, unitPrev, raw, rawPrev, roundLabel;
  if (group.pricing === 'table') {
    raw = rank === 'A' ? it.priceA : it.priceB;
    rawPrev = raw;
    basis.base = `${group.name}は掛率ではなく単価表: ${rank}単価 ${fmtYen(raw)} 円/m（${MAKER[it.maker].name} ${MAKER[it.maker].edition}）`;
  } else {
    rateTable = round3(RATES[site][it.group][route === 'stock' ? 0 : 1] + (rank === 'B' ? RANK_B_DELTA : 0));
    rate = typeof ed.rate === 'number' && ed.rate >= 0.3 && ed.rate <= 1 ? round3(ed.rate) : rateTable;
    raw = it.price * rate;
    rawPrev = it.prevPrice * rate;
    basis.base = `建値 ${fmtYen(it.price)} 円/m（${MAKER[it.maker].name} ${MAKER[it.maker].edition}）`;
    basis.rate = `掛率 ${fmt3(rateTable)}（${group.name} × ${route === 'stock' ? '在庫' : '直送'} × ${SITES.find((s) => s.id === site).name}${rank === 'B' ? '、価格ランク B −0.03' : ''}）${rate !== rateTable ? ` → 手入力で ${fmt3(rate)} に変更` : ''}`;
    basis.calc = `${fmtYen(it.price)} × ${fmt3(rate)} ＝ ${fmtDec(raw)}`;
  }
  const rounded = roundUnit(raw, it);
  roundLabel = rounded.label;
  const roundedPrev = roundUnit(rawPrev, it);
  const override = typeof ed.unit === 'number' && ed.unit > 0 ? round1(ed.unit) : null;
  unit = override ?? rounded.value;
  unitPrev = roundedPrev.value;
  basis.round = group.pricing === 'table' ? `端数処理なし（単価表の値をそのまま）` : `端数処理: ${fmtDec(raw)} → ${fmtYen(rounded.value)} 円（${roundLabel}）`;
  if (override != null) basis.override = `単価を手入力で ${fmtYen(override)} 円/m に上書き（計算値 ${fmtYen(rounded.value)} 円）`;
  basis.amount = `${fmtYen(unit)} 円 × ${fmtQty(qty)}m ＝ ${fmtYen(unit * qty)} 円`;
  const amount = Math.round(unit * qty);
  const weightKg = Math.round(it.kgPerM * qty);
  const heavy = weightKg >= 500;
  const note = typeof ed.note === 'string' ? ed.note.slice(0, 100) : (l.note || '');
  const resolved = ed.resolved === true;
  return {
    id: l.id, item: it.id, label: it.label, name: it.name, spec: it.spec, group: it.group, groupName: group.name, pricing: group.pricing,
    maker: it.maker, makerName: MAKER[it.maker].name, edition: MAKER[it.maker].edition,
    qty, qtyParts: l.qtyParts || null, breakdown: l.breakdown || '', read: l.read, from: l.from, page: l.page || null, added: Boolean(l.added),
    alert: l.alert || '', guess: l.guess || '', resolved,
    stocked: it.stocked, stock, route, routeLabel: route === 'stock' ? '在庫' : '直送', routeDefault, rank,
    price: it.price, prevPrice: it.prevPrice, priceChanged: it.price !== it.prevPrice, priceChangePct: it.prevPrice ? Math.round(((it.price - it.prevPrice) / it.prevPrice) * 1000) / 10 : 0,
    rateTable, rate, rateEdited: rate != null && rate !== rateTable, raw: round2(raw), roundLabel, unit, unitPrev, unitEdited: override != null, thin: it.thin,
    amount, kgPerM: it.kgPerM, weightKg, heavy, note, basis,
  };
}

// 端数処理（決まり v1 の 4）
function roundUnit(raw, it) {
  if (it.group === 'LV') return { value: raw, label: '単価表の値' };
  if (it.thin && raw <= 100) return { value: Math.ceil(raw * 10) / 10, label: '細物: 小数第 1 位まで切上' };
  if (it.thin) return { value: Math.ceil(raw), label: '細物だが 100 円/m 超: 小数点以下切上' };
  return { value: Math.ceil(raw), label: '小数点以下切上' };
}

// 見積書（Excel 様式の行）。明細 → 行ごとの注記 → 任意の空白行・重量・送料の補助行
function buildSheet(r, lines, extras, total) {
  const rows = [];
  for (const l of lines) {
    rows.push({ kind: 'item', lineId: l.id, name: l.label, qty: l.qty, qtyLabel: `${fmtQty(l.qty)}${l.breakdown ? `（${l.breakdown}）` : ''}`, unitLabel: 'm', unit: l.unit, amount: l.amount, remark: l.note, route: l.routeLabel });
    if (l.heavy) rows.push({ kind: 'note', lineId: l.id, text: `※ ${l.label} はドラム巻の重量物（概算 ${fmtQty(l.weightKg)}kg）です。荷受け設備（フォークリフト等）の有無と受け取り可否をご確認ください` });
    if (l.route === 'direct') rows.push({ kind: 'note', lineId: l.id, text: `※ ${l.label} はメーカー直送（納期 ${l.group === 'CVT' ? '約 3 週間' : '約 2 週間'}）。送料は別途` });
    for (const x of extras.filter((x) => x.after === l.id)) rows.push(extraRow(x, l));
  }
  for (const x of extras.filter((x) => !x.after || !lines.some((l) => l.id === x.after))) rows.push(extraRow(x, null));
  return {
    no: r.no, date: r.status === 'answered' ? r.answered : TODAY, validUntil: addDays(r.status === 'answered' ? r.answered : TODAY, 30),
    to: `${r.client} ${r.person} 様`, title: r.title, from: OUR_NAME, person: OUR_PERSON, logo: '株式会社イズマサ',
    rows, subtotal: total, tax: Math.floor(total * 0.1), total: total + Math.floor(total * 0.1),
    terms: ['納期: 在庫品は 2〜3 営業日、直送品はメーカー納期によります', '有効期限: 見積日より 30 日', '銅建値の変動により単価を見直す場合があります'],
    workflow: r.status === 'answered'
      ? [{ step: '下書き', done: true }, { step: '承認依頼', done: true }, { step: `承認（${r.approvedBy}）`, done: true }, { step: '送付・リンク共有', done: true }]
      : [{ step: '下書き', done: true }, { step: '承認依頼', done: false }, { step: '承認', done: false }, { step: '送付・リンク共有', done: false }],
  };
}

function extraRow(x, l) {
  if (x.kind === 'weight') {
    const kg = l ? l.weightKg : 0;
    return { kind: 'note', extraId: x.id, text: l ? `概算重量: 約 ${fmtQty(kg)}kg（${l.kgPerM}kg/m × ${fmtQty(l.qty)}m）。ドラムサイズは在庫の巻きにより変わるため、実際の巻きで再確認` : '概算重量: 対象の行を選んでください' };
  }
  if (x.kind === 'shipping') return { kind: 'note', extraId: x.id, text: `送料: 直送分はメーカー運賃実費（別途）。在庫出荷分は ${fmtYen(20000)} 円以上で無料` };
  if (x.kind === 'blank') return { kind: 'blank', extraId: x.id, text: typeof x.text === 'string' ? x.text.slice(0, 120) : '' };
  return { kind: 'note', extraId: x.id, text: typeof x.text === 'string' ? x.text.slice(0, 120) : '' };
}

// 回答メールの下書き（数字は表の値をそのまま差し込む）
function buildMail(r, lines, total, alerts) {
  const checks = alerts.filter((a) => a.kind === '明細' || a.kind === '件名');
  const body = [
    `${r.client}\n${r.person} 様`,
    `いつもお世話になっております。${OUR_NAME} ${OUR_PERSON}です。`,
    `「${r.title}」のお見積り（${r.no}）をお送りします。明細 ${lines.length} 行、合計 ${fmtYen(total)} 円（税別）です。`,
    checks.length ? `なお、下記の点はこちらで仮に判断していますので、ご確認をお願いいたします。\n${checks.map((c) => `・${c.text}`).join('\n')}` : '',
    'ご不明な点がございましたら、お気軽にお申し付けください。',
  ].filter(Boolean).join('\n\n');
  return { subject: `【お見積り】${r.title}（${r.no}）`, body };
}

// ---------- 画面向け ----------
export function getDemoData({ folder = 'all', site = DEFAULT_SITE, edits } = {}) {
  site = normalizeSite(site);
  edits = normalizeEdits(edits);
  const b = build({ site, edits });
  const selected = b.requests.find((r) => r.id === folder) || null;
  const scope = selected ? [selected] : b.requests;
  const active = b.requests.filter((r) => r.lines.length);
  const alertCount = scope.reduce((s, r) => s + r.alerts.filter((a) => a.kind === '明細' || a.kind === '件名').length, 0);
  return {
    title: 'イズマサ様 見積回答モック',
    subtitle: '依頼書を置くと明細を読み取り、人が判断する行に「要確認」を出します。単価は決まりどおりに計算し、根拠を行ごとに追えます。AI は読み取りと文面の下書きだけで、単価は計算しません。',
    site, siteName: b.siteName, siteOptions: SITES, today: md(TODAY),
    siteNote: site === DEFAULT_SITE
      ? '拠点は福岡支店です。掛率は福岡支店の運用（商品群 × 在庫／直送）で計算しています。'
      : `拠点を ${b.siteName} に切り替えています。同じ商品でも掛率が福岡支店と違うので、単価が変わります。`,
    footNote: '依頼元・件名・数量・単価・メーカー名・担当者名はすべて架空のデモデータです。単価は「計算の決まり v1」のとおり機械的に計算し、AI は計算しません。',
    selectedFolder: selected ? selected.id : 'all',
    defaultTab: 'lines',
    tabs: [
      { id: 'lines', label: '読み取り結果', count: alertCount },
      { id: 'pricing', label: '単価と根拠', count: scope.reduce((s, r) => s + r.lines.length, 0) },
      { id: 'sheet', label: '見積書', count: selected ? 1 : active.length },
      { id: 'lists', label: '単価表の管理', count: MAKERS.filter((m) => /未着|要確認|差分/.test(m.status)).length },
      { id: 'rules', label: '計算の決まり', count: RULES.length },
    ],
    folders: b.requests.map((r) => ({
      id: r.id, no: r.no, title: r.title, client: r.client, kind: r.kind, received: md(r.received), due: r.due ? md(r.due) : '', status: r.status, statusLabel: r.statusLabel,
      alerts: r.alerts.filter((a) => a.kind === '明細' || a.kind === '件名').length, lines: r.lines.length, total: r.total, pending: r.pending || '',
    })),
    summary: {
      requests: b.requests.length, open: b.requests.filter((r) => r.status !== 'answered').length, alerts: alertCount,
      dueSoon: b.requests.filter((r) => r.due && r.status !== 'answered' && r.due <= addDays(TODAY, 3)).length,
      listsPending: MAKERS.filter((m) => /未着|要確認/.test(m.status)).length,
    },
    requests: scope.map((r) => ({
      id: r.id, no: r.no, title: r.title, titleFrom: r.titleFrom, titleAlert: r.titleAlert, client: r.client, person: r.person, kind: r.kind, source: r.source,
      received: md(r.received), due: r.due ? md(r.due) : '', status: r.status, statusLabel: r.statusLabel, rank: r.rank, pending: r.pending || '',
      answered: r.answered ? md(r.answered) : '', approvedBy: r.approvedBy || '', shareUrl: r.shareUrl || '',
      lines: r.lines.map(lineRow), extras: r.extras, alerts: r.alerts, total: r.total, sheet: r.sheet, mail: r.mail,
    })),
    items: ITEMS.map(([id]) => ({ id, label: ITEM[id].label, group: ITEM[id].group, stocked: ITEM[id].stocked })),
    makers: MAKERS.map((m) => ({ ...m, last: md(m.last), next: nextUpdate(m) })),
    priceDiff: ITEMS.filter(([id]) => ITEM[id].price !== ITEM[id].prevPrice).map(([id]) => ({ item: ITEM[id].label, maker: MAKER[ITEM[id].maker].name, edition: MAKER[ITEM[id].maker].edition, prev: ITEM[id].prevPrice, price: ITEM[id].price, pct: Math.round(((ITEM[id].price - ITEM[id].prevPrice) / ITEM[id].prevPrice) * 1000) / 10 })),
    rates: Object.entries(RATES[site]).map(([g, [s, d]]) => ({ group: g, groupName: GROUPS.find((x) => x.id === g).name, stock: s, direct: d, stockB: round3(s + RANK_B_DELTA), directB: round3(d + RANK_B_DELTA) })),
    rules: RULES,
    examples: suggestQuestions(selected, b.requests),
    aiNote: 'AI は、この画面の表に出ている数字をそのまま読み上げるだけで、単価の計算や予測はしません。',
  };
}

// 画面の表に出す短い端数処理の表示（長い説明は根拠ツールチップに出る）
const ROUND_SHORT = { '小数点以下切上': '切上', '細物: 小数第 1 位まで切上': '細物: 小数第1位', '細物だが 100 円/m 超: 小数点以下切上': '細物・100円超: 切上', '単価表の値': '表の値' };

function lineRow(l) {
  return {
    id: l.id, item: l.item, label: l.label, name: l.name, spec: l.spec, group: l.group, groupName: l.groupName, pricing: l.pricing, makerName: l.makerName, edition: l.edition,
    qty: l.qty, qtyParts: l.qtyParts, breakdown: l.breakdown, read: l.read, from: l.from, page: l.page, added: l.added,
    alert: l.alert, guess: l.guess, resolved: l.resolved,
    stocked: l.stocked, stock: l.stock, route: l.route, routeLabel: l.routeLabel, routeDefault: l.routeDefault, rank: l.rank,
    price: l.price, prevPrice: l.prevPrice, priceChanged: l.priceChanged, priceChangePct: l.priceChangePct,
    rateTable: l.rateTable, rate: l.rate, rateEdited: l.rateEdited, raw: l.raw, roundLabel: l.roundLabel, roundShort: ROUND_SHORT[l.roundLabel] || l.roundLabel, unit: l.unit, unitPrev: l.unitPrev, unitEdited: l.unitEdited, thin: l.thin,
    amount: l.amount, weightKg: l.weightKg, heavy: l.heavy, note: l.note, basis: Object.values(l.basis).filter(Boolean),
  };
}

// おすすめ質問は、選択中の依頼の表に実在する品目・数字から作る（固定文を出さない）
function suggestQuestions(selected, requests) {
  const q = [];
  if (!selected) {
    q.push('回答期限が近い依頼から順に、要確認の件数と合計金額を読み上げてください');
    q.push('単価表が 10 月版に変わって単価が上がった品目は、どの依頼に入っていますか');
    q.push('要確認の行を依頼ごとに一言ずつまとめてください');
    return q;
  }
  if (selected.pending) {
    q.push(`「${selected.title}」で、依頼元に確認する文面を作ってください`);
    return q;
  }
  const alertLine = selected.lines.find((l) => l.alert && !l.resolved);
  const merged = selected.lines.find((l) => l.qtyParts);
  const thin = selected.lines.find((l) => l.thin && l.pricing === 'rate');
  const changed = selected.lines.find((l) => l.priceChanged);
  const heavy = selected.lines.find((l) => l.heavy);
  const first = selected.lines[0];
  if (alertLine) q.push(`${alertLine.label} の要確認の点を、依頼元に確認する文面にしてください`);
  if (merged) q.push(`${merged.label} が ${fmtQty(merged.qty)}m になっている理由を教えてください`);
  if (changed) q.push(`${changed.label} の単価 ${fmtYen(changed.unit)} 円の根拠を、式のとおりに説明してください`);
  else if (first) q.push(`${first.label} の単価 ${fmtYen(first.unit)} 円の根拠を、式のとおりに説明してください`);
  if (thin) q.push(`${thin.label} の単価が ${fmtYen(thin.unit)} 円になる端数処理を説明してください`);
  if (heavy) q.push(`${heavy.label} の見積書に付ける注意書きを教えてください`);
  if (selected.status === 'answered') q.push('この見積の承認と送付の記録を教えてください');
  if (!q.length) q.push('この依頼で注意すべき点を、表の数字をもとに教えてください');
  void requests;
  return q.slice(0, 4);
}

// ---------- AI 向け（画面と同じ build() の結果。選択中の依頼だけを渡す） ----------
export function getAiData({ folder = 'all', site = DEFAULT_SITE, edits } = {}) {
  site = normalizeSite(site);
  edits = normalizeEdits(edits);
  const b = build({ site, edits });
  const selected = b.requests.find((r) => r.id === folder) || null;
  const scope = selected ? [selected] : b.requests;
  const lineRowAi = (l) => ({
    品目: l.label, 商品群: l.groupName, メーカー: l.makerName, 単価表の版: l.edition,
    読み取った原文: l.read, 出どころ: l.from, ...(l.qtyParts ? { 合算の内訳: l.qtyParts.map((p) => `${p.qty}m（${p.from}）`) } : {}), ...(l.breakdown ? { 数量の内訳: l.breakdown } : {}),
    数量_m: l.qty, ...(l.alert && !l.resolved ? { 要確認: l.alert, 推定: l.guess } : {}), ...(l.resolved ? { 要確認: '確認済み' } : {}),
    納品方式: l.routeLabel, 価格ランク: l.rank, 基準在庫_m: l.stock, 在庫品: l.stocked,
    ...(l.pricing === 'rate' ? { 建値_円: l.price, 掛率: l.rate, ...(l.rateEdited ? { 掛率は手入力: true } : {}) } : { 単価表: `${l.rank}単価` }),
    算出単価_円: l.unit, ...(l.unitEdited ? { 単価は手入力: true } : {}), 端数処理: l.roundLabel, 金額_円: l.amount,
    ...(l.priceChanged ? { 建値の変化: `${l.prevPrice} → ${l.price} 円（${l.priceChangePct}%）。前版なら単価 ${l.unitPrev} 円` } : {}),
    ...(l.heavy ? { 概算重量_kg: l.weightKg, 重量物: true } : {}), ...(l.note ? { 備考: l.note } : {}),
    根拠: Object.values(l.basis).filter(Boolean),
  });
  return {
    context: `電線・ケーブル商社（イズマサ様）の見積回答のデモ。依頼書（内訳明細書 PDF・メール本文・FAX・Excel）から AI が明細を読み取り、単価は「計算の決まり v1」で機械的に算出した結果。拠点 ${b.siteName}、今日 ${TODAY}。${selected ? `利用者がいま開いている依頼: 「${selected.title}」（${selected.no}）。質問の「この依頼」「この見積」はこれを指す。ほかの依頼のことは聞かれたときだけ答える。` : '利用者は「全依頼」を開いている。'}`,
    note: 'すべて架空データ。数字は下の表の値をそのまま使い、新しい数字を計算しない（掛け算も足し算もしない）。表に無い品目・数字は出さない。根拠を聞かれたら「根拠」の文をそのまま示す。',
    計算の決まり_v1: Object.fromEntries(RULES.map((r) => [r.name, r.formula])),
    掛率表: Object.fromEntries(Object.entries(RATES[site]).map(([g, [s, d]]) => [GROUPS.find((x) => x.id === g).name, { 在庫: s, 直送: d, 価格ランクB: `−0.03` }])),
    依頼: scope.map((r) => r.pending
      ? { 依頼: r.title, 見積番号: r.no, 依頼元: r.client, 受領: r.received, 状態: r.pending, 件名の出どころ: r.titleFrom, 件名の要確認: r.titleAlert }
      : {
        依頼: r.title, 見積番号: r.no, 依頼元: `${r.client} ${r.person}`, 依頼の形: r.kind, 受領: r.received, 回答期限: r.due, 状態: r.statusLabel, 価格ランク: r.rank,
        件名の出どころ: r.titleFrom, ...(r.titleAlert ? { 件名の要確認: r.titleAlert } : {}),
        ...(r.status === 'answered' ? { 回答日: r.answered, 承認者: r.approvedBy, 共有リンク: r.shareUrl } : {}),
        要確認: r.alerts.map((a) => `[${a.kind}] ${a.text}`),
        明細: r.lines.map(lineRowAi),
        合計_円_税別: r.total,
        見積書の注記: r.sheet.rows.filter((x) => x.kind === 'note').map((x) => x.text),
        回答メールの下書き: { 件名: r.mail.subject },
      }),
    単価表の更新: { 今月の差分: ITEMS.filter(([id]) => ITEM[id].price !== ITEM[id].prevPrice).map(([id]) => `${ITEM[id].label}: ${ITEM[id].prevPrice} → ${ITEM[id].price} 円（${MAKER[ITEM[id].maker].name} ${MAKER[ITEM[id].maker].edition}）`), 未着または要確認のメーカー: MAKERS.filter((m) => /未着|要確認/.test(m.status)).map((m) => `${m.name}: ${m.status}`) },
  };
}

// テスト用に計算結果をそのまま出す
export function _build(opts) { return build({ site: normalizeSite(opts?.site), edits: normalizeEdits(opts?.edits) }); }
export { REQUESTS as _REQUESTS, ITEM as _ITEM, RATES as _RATES, roundUnit as _roundUnit };

// ---------- 入力の正規化（画面から来る値は信用しない） ----------
function normalizeSite(s) { return SITES.some((x) => x.id === s) ? s : DEFAULT_SITE; }
function normalizeEdits(e) {
  if (!e || typeof e !== 'object' || Array.isArray(e)) return {};
  const out = {};
  for (const r of REQUESTS) {
    const src = e[r.id];
    if (!src || typeof src !== 'object') continue;
    const lines = {};
    for (const [id, v] of Object.entries(src.lines || {})) {
      if (!/^[al]\d{1,2}$/.test(id) || !v || typeof v !== 'object') continue;
      const o = {};
      if (v.route === 'stock' || v.route === 'direct') o.route = v.route;
      if (v.rank === 'A' || v.rank === 'B') o.rank = v.rank;
      if (typeof v.rate === 'number' && Number.isFinite(v.rate) && v.rate >= 0.3 && v.rate <= 1) o.rate = v.rate;
      if (typeof v.unit === 'number' && Number.isFinite(v.unit) && v.unit > 0 && v.unit < 1e6) o.unit = v.unit;
      if (Number.isInteger(v.qty) && v.qty > 0 && v.qty < 1e6) o.qty = v.qty;
      if (typeof v.note === 'string') o.note = v.note.slice(0, 100);
      if (v.resolved === true) o.resolved = true;
      if (Object.keys(o).length) lines[id] = o;
    }
    const added = (Array.isArray(src.added) ? src.added : []).filter((a) => a && ITEM[a.item] && Number.isInteger(a.qty) && a.qty > 0 && a.qty < 1e6).slice(0, 10)
      .map((a) => ({ item: a.item, qty: a.qty, note: typeof a.note === 'string' ? a.note.slice(0, 100) : '' }));
    const extras = (Array.isArray(src.extras) ? src.extras : []).filter((x) => x && ['blank', 'weight', 'shipping', 'note'].includes(x.kind)).slice(0, 10)
      .map((x) => ({ kind: x.kind, after: typeof x.after === 'string' && /^[al]\d{1,2}$/.test(x.after) ? x.after : '', text: typeof x.text === 'string' ? x.text.slice(0, 120) : '' }));
    if (Object.keys(lines).length || added.length || extras.length) out[r.id] = { lines, added, extras };
  }
  return out;
}

// ---------- 小道具 ----------
function sum(a) { return a.reduce((s, v) => s + v, 0); }
function round1(v) { return Math.round(v * 10) / 10; }
function round2(v) { return Math.round(v * 100) / 100; }
function round3(v) { return Math.round(v * 1000) / 1000; }
function fmt3(v) { return v.toFixed(2).replace(/0$/, '').replace(/\.$/, '.0'); }
function fmtYen(v) { return Number(v).toLocaleString('ja-JP', { maximumFractionDigits: 1 }); }
function fmtDec(v) { return (Math.round(v * 100) / 100).toLocaleString('ja-JP', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function fmtQty(v) { return Number(v).toLocaleString('ja-JP'); }
function md(s) { return s ? `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}` : ''; }
function addDays(s, d) { const t = new Date(`${s}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + d); return t.toISOString().slice(0, 10); }
function nextUpdate(m) {
  const months = { 毎月: 1, '2〜3か月': 3, '3か月': 3, 半年: 6, '1年': 12 }[m.cycle] || 1;
  const t = new Date(`${m.last}T00:00:00Z`); t.setUTCMonth(t.getUTCMonth() + months);
  return md(t.toISOString().slice(0, 10));
}
