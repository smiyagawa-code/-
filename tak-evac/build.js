// TAKイーヴァック様 初回商談資料  生成スクリプト（node build.js）
const path = require("path");
const pptxgen = require("pptxgenjs");
const t = require("./thomas-pptx");
const { C, F, LAYOUT } = t;

const ASSETS = path.join(__dirname, "assets");
const pres = new pptxgen();
pres.layout = "LAYOUT_WIDE";
const M = LAYOUT.margin, W = LAYOUT.contentW;

// 1. 表紙
const s1 = t.addCoverSlide(pres, ASSETS, {
  companyName: "株式会社TAKイーヴァック",
  projectName: "定型業務・調達業務の効率化に向けて",
  slideTitle: "初回お打ち合わせ資料",
  date: "2026年10月1日（木）",
  author: "thomas株式会社"
});
s1.addNotes("【4つの不：不信】まずは延期のご連絡へのお礼から。本日は売り込みではなく、お話を伺う場であることを冒頭で伝える。");

// 2. 本日の進め方
const s2 = t.addContentSlide(pres, ASSETS, { title: "本日の進め方", subtitle: "約60分のお時間をいただきます" });
t.addCard(pres, s2, {
  x: M, y: 1.40, w: 5.30, h: 1.35, accentColor: C.navy, headerColor: C.navy,
  header: " 本日の目的 ", bodyFontSize: 13,
  body: "調達業務・定型業務の現状とお困りごとをお伺いし、弊社でお手伝いできる点を一緒に整理すること"
});
t.addCard(pres, s2, {
  x: M + 5.44, y: 1.40, w: 5.30, h: 1.35, accentColor: C.orange, bgColor: C.sectionFill, headerColor: C.orange,
  header: " 本日のゴール ", bodyFontSize: 13,
  body: "次回までに詳しく確認するテーマと、ご同席いただく方を決めること"
});
t.addStyledTable(pres, s2, {
  y: 3.05, colW: [0.8, 7.94, 2.0], rowH: 0.52,
  headers: ["No.", "内容", "目安"],
  rows: [
    ["1", "ご挨拶・本日の目的", "5分"],
    ["2", "thomasのご紹介", "10分"],
    [{ text: "3", options: { bold: true, color: C.orange } }, { text: "現状とお困りごとのお伺い（本日の中心）", options: { bold: true, color: C.orange } }, { text: "30分", options: { bold: true, color: C.orange } }],
    ["4", "お手伝いできることのイメージ", "10分"],
    ["5", "今後の進め方", "5分"]
  ]
});
s2.addNotes("【不要】説明よりお伺いに時間を割くことを明示。時間配分の確認で「途中退席の予定はないか」も確認する。");

// 3. thomasについて
const s3 = t.addContentSlide(pres, ASSETS, { title: "thomasについて", subtitle: "会社概要" });
t.addStyledTable(pres, s3, {
  y: 1.40, w: 6.10, colW: [1.50, 4.60], rowH: 0.50,
  headers: ["項目", "内容"],
  rows: [
    ["会社名", "thomas株式会社（thomas Inc.）"],
    ["創業", "2018年6月"],
    ["拠点", "東京本社（六本木）／福岡支社／京都支社"],
    ["主な事業", "システム開発／SaaSソリューション提供／MVNO提供"],
    ["資本金", "1億2,656万円（資本準備金含む）"],
    ["社員数", "単体53名（アルバイト含む）、グループ計70名"]
  ]
});
const sx = M + 6.35, sw = W - 6.35;
[
  { h: " 200社以上のご支援 ", b: "業種・業態を問わず、スタートアップから大手上場企業までご支援しています" },
  { h: " 業務整理から定着まで一貫 ", b: "業務分析・要件定義から設計・構築、導入後の定着までを一つのチームで担います" },
  { h: " 全社員がAI資格を保有 ", b: "生成AIを自社業務でも活用し、その知見をご提案に活かしています" }
].forEach((p, i) => {
  t.addCard(pres, s3, { x: sx, y: 1.40 + i * 1.18, w: sw, h: 1.05, accentColor: C.orange, headerColor: C.navy, header: p.h, body: p.b });
});
s3.addNotes("【不信】『この会社に任せて大丈夫か』を崩すパート。10分以内に収め、事例は相手の関心が出てから補足する。");

// 4. 提供サービス
const s4 = t.addContentSlide(pres, ASSETS, { title: "thomasがご提供するサービス", subtitle: "ご状況に合わせて組み合わせてご提案します" });
const svc = [
  { h: " 業務自動化（RPA） ", b: "請求書作成・データ連携など、毎日・毎月発生する定型作業をロボットが代行します" },
  { h: " 議事録AI ", b: "会議・通話の録音から、文字起こし・要約までを自動化します" },
  { h: " 与信管理DX ", b: "帝国データバンクの与信情報を取得し、評点に変化があればチャットで自動通知します" },
  { h: " Smart CRM ", b: "Salesforceを基盤にした顧客・案件管理。導入から定着までの支援を利用料に含みます" },
  { h: " AIデータ統合・経営ダッシュボード ", b: "社内に散らばったデータを整理し、生成AIで分析・見える化します" },
  { h: " 業務改善コンサルティング ", b: "業務の棚卸し・要件定義から構築まで、一気通貫でご支援します" }
];
const cw = (W - 0.30) / 3, ch = 2.55;
svc.forEach((p, i) => {
  const col = i % 3, row = Math.floor(i / 3);
  t.addCard(pres, s4, {
    x: M + col * (cw + 0.15), y: 1.40 + row * (ch + 0.15), w: cw, h: ch,
    accentColor: i < 3 ? C.orange : C.navy, headerColor: C.navy, header: p.h, body: p.b, bodyFontSize: 12
  });
});
s4.addNotes("一覧は流す程度に。上段3つ（RPA・議事録AI・与信）が調達・定型業務と関係しやすい想定。");

// 5. よくあるお困りごと（仮説）
const s5 = t.addContentSlide(pres, ASSETS, { title: "調達業務でよく伺うお困りごと", subtitle: "設備工事業で一般的に見られる例です。貴社の実際のご状況を本日お伺いさせてください" });
const pains = [
  { h: " 見積の収集・比較 ", b: "複数の業者から届く見積書（PDF・紙・Excel）を、比較表に手で転記している" },
  { h: " 発注書・帳票の作成 ", b: "発注書・注文請書などを作成し、基幹システムにも同じ内容を入力している" },
  { h: " 工事ごとの調達状況 ", b: "どの現場で何を・いつまでに手配済みかが、担当者のExcelやメールに分散している" },
  { h: " 取引先の与信確認 ", b: "協力会社・仕入先の経営状況の確認が、新規取引時の一度きりになっている" }
];
const pw = (W - 0.45) / 4;
pains.forEach((p, i) => {
  t.addCard(pres, s5, { x: M + i * (pw + 0.15), y: 1.50, w: pw, h: 2.90, accentColor: C.amberBar, bgColor: C.amberBg, headerColor: C.amber, header: p.h, body: p.b, bodyFontSize: 12.5 });
});
s5.addShape(pres.shapes.RECTANGLE, { x: M, y: 4.75, w: W, h: 1.10, fill: { color: C.white }, line: { color: C.navy, width: 1 } });
s5.addText([
  { text: "当てはまるもの・当てはまらないもの、", options: { breakLine: true } },
  { text: "ほかにお困りのことがあれば、お聞かせください", options: { bold: true, color: C.navy } }
], { x: M, y: 4.75, w: W, h: 1.10, fontFace: F.jp, fontSize: 16, color: C.text, align: "center", valign: "middle", margin: 0 });
s5.addNotes("【不要】ここが本日の山場。4つはあくまで仮説。『どれが一番近いですか』と聞き、外れたら素直に修正する。");

// 6. お手伝いできることのイメージ
const s6 = t.addContentSlide(pres, ASSETS, { title: "お手伝いできることのイメージ", subtitle: "お困りごとと、考えられる対応の例" });
t.addStyledTable(pres, s6, {
  y: 1.40, colW: [2.60, 5.64, 2.50], rowH: 0.78,
  headers: ["お困りごとの例", "考えられる対応", "関連サービス"],
  rows: [
    ["見積の収集・比較", "見積書の内容を読み取り、比較表へ自動で反映する", "RPA／AI"],
    ["発注書・帳票の作成", "決まった手順の作成・転記・システム入力をロボットが代行する", "RPA"],
    ["工事ごとの調達状況", "現場・発注・納期の情報を一か所に集め、状況を一覧で見られるようにする", "Smart CRM／ダッシュボード"],
    ["取引先の与信確認", "取引先の与信情報を定期取得し、変化があれば担当者へ通知する", "与信管理DX"],
    ["業者・社内との打合せ記録", "会議の録音から議事録と要約を自動で作成する", "議事録AI"]
  ]
});
s6.addText("※ 実際に適用できるか、どの程度の効果があるかは、業務の詳細を確認したうえでご提案いたします", {
  x: M, y: 6.25, w: W, h: 0.35, fontFace: F.jp, fontSize: 11, color: C.textMute, margin: 0
});
s6.addNotes("【不適】反応があった行だけ深掘り。効果・金額はこの場で約束しない。");

// 7. 本日お伺いしたいこと
const s7 = t.addContentSlide(pres, ASSETS, { title: "本日お伺いしたいこと", subtitle: "差し支えない範囲でお聞かせください" });
const qs = [
  ["調達業務の流れ", "見積依頼から発注・納品・支払いまでの流れと、関わる部署・人数"],
  ["手間がかかっている作業", "転記・集計・確認など、繰り返し発生している作業"],
  ["お使いのシステム", "基幹システム・Excel・メールなど、現在の道具とその使い分け"],
  ["優先したいこと", "まず解決したいことと、いつ頃までに変えたいか"],
  ["ご検討の進め方", "このようなご相談を進める際の、社内のご相談先やご判断の流れ"]
];
qs.forEach((q, i) => {
  const y = 1.40 + i * 1.02;
  s7.addShape(pres.shapes.OVAL, { x: M, y: y + 0.12, w: 0.62, h: 0.62, fill: { color: C.navy }, line: { color: C.navy } });
  s7.addText(String(i + 1), { x: M, y: y + 0.12, w: 0.62, h: 0.62, fontFace: F.jp, fontSize: 20, bold: true, color: C.white, align: "center", valign: "middle", margin: 0 });
  s7.addText(q[0], { x: M + 0.85, y, w: 3.10, h: 0.86, fontFace: F.jp, fontSize: 17, bold: true, color: C.navy, valign: "middle", margin: 0 });
  s7.addText(q[1], { x: M + 4.00, y, w: W - 4.00, h: 0.86, fontFace: F.jp, fontSize: 14, color: C.text, valign: "middle", margin: 0 });
  if (i < qs.length - 1) s7.addShape(pres.shapes.LINE, { x: M, y: y + 0.96, w: W, h: 0, line: { color: C.border, width: 0.75 } });
});
s7.addNotes("【不急】④で『いつまでに』を必ず聞く。【決裁】⑤で決裁者・親会社承認の要否をさりげなく確認。");

// 8. 今後の進め方
const s8 = t.addContentSlide(pres, ASSETS, { title: "今後の進め方（案）", subtitle: "小さく確かめながら進めます" });
const steps = [
  { title: "本日のお伺い", body: "現状とお困りごとを伺い、テーマの候補を挙げる" },
  { title: "業務の詳細確認", body: "実務ご担当者様も交え、対象業務の流れと手間を確認する" },
  { title: "ご提案", body: "効果が見込める業務を選び、進め方と概算をご提示する" },
  { title: "小さく試す", body: "デモや一部業務での検証で、使えるかを確かめる" }
];
const stc = [[C.blueBar, C.navy], [C.amberBar, C.amber], [C.greenBar, C.green], [C.redBar, C.red]];
const stw = (W - 0.45) / 4;
steps.forEach((st, i) => {
  t.addStepCard(pres, s8, { x: M + i * (stw + 0.15), y: 1.40, w: stw, h: 2.40, num: i + 1, color: stc[i][0], headColor: stc[i][1], title: st.title, body: st.body, bodyFontSize: 13 });
});
s8.addShape(pres.shapes.RECTANGLE, { x: M, y: 4.15, w: W, h: 1.70, fill: { color: C.sectionFill }, line: { color: C.orange, width: 1 } });
s8.addText("本日決めたいこと", { x: M + 0.30, y: 4.30, w: W - 0.6, h: 0.40, fontFace: F.jp, fontSize: 15, bold: true, color: C.orange, margin: 0 });
s8.addText([
  { text: "・次回、詳しく確認するテーマ", options: { breakLine: true } },
  { text: "・次回の日程と、ご同席いただく方（実務ご担当者様など）" }
], { x: M + 0.30, y: 4.75, w: W - 0.6, h: 0.95, fontFace: F.jp, fontSize: 15, color: C.text, valign: "top", paraSpaceAfter: 4, margin: 0 });
s8.addNotes("ゴールの確認：次回の日程・テーマ・ご同席者（実務担当者）をこの場で決める。お客様と『戦友』として一緒に社内へ進める姿勢を伝える。");

// 9. クロージング
const s9 = t.addClosingSlide(pres, ASSETS, { subMessage: "thomas株式会社　宮川 晋之介" });

pres.writeFile({ fileName: path.join(__dirname, "TAKイーヴァック様_初回お打ち合わせ資料.pptx") })
  .then(f => console.log("written:", f));
