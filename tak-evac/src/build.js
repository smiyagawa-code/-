// TAKイーヴァック様 初回お打ち合わせ資料  生成スクリプト
// 実行：src/ で `node build.js` → ../outputs/ に PPTX を出力（骨子は ../outline.md）
const path = require("path");
const pptxgen = require("pptxgenjs");
const t = require("./thomas-pptx");
const { C, F } = t;

const ASSETS = path.join(__dirname, "assets");
const OUT = path.join(__dirname, "..", "outputs", "TAKイーヴァック様_初回お打ち合わせ資料.pptx");
const pres = new pptxgen();
pres.layout = "LAYOUT_WIDE";

const M = 1.33, W = 10.74;
const TXT = { fontFace: F.jp, color: C.text, margin: 0 };

// 見出し（28pt）＋補足（15pt）＋ロゴ
function page(title, sub) {
  const s = pres.addSlide();
  s.background = { color: C.white };
  s.addText(title, { ...TXT, x: M, y: 0.45, w: W, h: 0.60, fontSize: 28, bold: true, color: C.navy });
  s.addShape(pres.shapes.LINE, { x: M, y: 1.12, w: 1.2, h: 0, line: { color: C.orange, width: 2.5 } });
  if (sub) s.addText(sub, { ...TXT, x: M, y: 1.22, w: W, h: 0.40, fontSize: 15, color: C.textMute });
  t.addTLogo(pres, s, ASSETS);
  return s;
}

// P01 表紙
const p1 = t.addCoverSlide(pres, ASSETS, {
  companyName: "株式会社TAKイーヴァック",
  projectName: "定型業務・調達業務の効率化に向けて",
  slideTitle: "初回お打ち合わせ資料",
  date: "2026年10月1日（木）",
  author: "thomas株式会社"
});
p1.addNotes("【不信】8/28の延期のご連絡へのお礼から入る。今日は売り込みではなく、お話を伺う場であることを伝える。");

// P02 本日のお打ち合わせについて
const p2 = page("本日のお打ち合わせについて");
[
  ["目的", "調達業務・定型業務の現状とお困りごとを伺い、弊社がお手伝いできる点を一緒に整理する"],
  ["最後に決めたいこと", "次回、詳しく確認するテーマと、ご同席いただく方"]
].forEach(([label, body], i) => {
  const y = 1.75 + i * 1.25;
  p2.addText(label, { ...TXT, x: M, y, w: 2.6, h: 1.0, fontSize: 18, bold: true, color: C.orange, valign: "middle" });
  p2.addText(body, { ...TXT, x: M + 2.7, y, w: W - 2.7, h: 1.0, fontSize: 22, bold: true, color: C.navy, valign: "middle" });
});
p2.addShape(pres.shapes.LINE, { x: M, y: 4.3, w: W, h: 0, line: { color: C.border, width: 1 } });
p2.addText("時間配分（約60分）", { ...TXT, x: M, y: 4.45, w: W, h: 0.4, fontSize: 16, bold: true, color: C.navy });
const agenda = [["ご挨拶・本日の目的", "5分"], ["thomasのご紹介", "10分"], ["お困りごとのお伺い", "30分"], ["お手伝いの例", "10分"], ["今後の進め方", "5分"]];
const aw = W / agenda.length;
agenda.forEach(([name, min], i) => {
  const main = i === 2;
  p2.addShape(pres.shapes.RECTANGLE, { x: M + i * aw + 0.05, y: 5.0, w: aw - 0.1, h: 0.12, fill: { color: main ? C.orange : C.navy }, line: { type: "none" } });
  p2.addText([
    { text: min, options: { fontSize: 20, bold: true, color: main ? C.orange : C.navy, breakLine: true } },
    { text: name, options: { fontSize: 14, color: main ? C.orange : C.text, bold: main } }
  ], { ...TXT, x: M + i * aw + 0.05, y: 5.2, w: aw - 0.1, h: 1.1, valign: "top" });
});
p2.addNotes("【不要】説明よりお伺いに時間を割くことを示す。途中退席の予定がないかもここで確認する。");

// P03 thomasについて
const p3 = page("thomasについて", "業務の整理からシステムの導入・定着まで、一貫してご支援しています");
const facts = [["2018年", "創業"], ["200社以上", "のご支援実績"], ["3拠点", "東京本社・福岡・京都"], ["全社員", "AI資格を保有"]];
const fw = W / 4;
facts.forEach(([num, label], i) => {
  const x = M + i * fw;
  if (i > 0) p3.addShape(pres.shapes.LINE, { x, y: 1.95, w: 0, h: 1.3, line: { color: C.border, width: 1 } });
  p3.addText(num, { ...TXT, x: x + 0.1, y: 1.9, w: fw - 0.2, h: 0.75, fontSize: 30, bold: true, color: C.navy, align: "center" });
  p3.addText(label, { ...TXT, x: x + 0.1, y: 2.65, w: fw - 0.2, h: 0.6, fontSize: 15, align: "center", valign: "top" });
});
p3.addText("主なサービス", { ...TXT, x: M, y: 3.7, w: W, h: 0.4, fontSize: 18, bold: true, color: C.navy });
const svc = [
  ["業務自動化（RPA）", "繰り返しのパソコン作業をロボットが代行"],
  ["議事録AI", "会議・通話の文字起こしと要約を自動化"],
  ["与信管理DX", "取引先の与信情報を定期取得し、変化を通知"],
  ["Smart CRM", "Salesforceを基盤にした顧客・案件管理"],
  ["AIデータ統合・ダッシュボード", "散らばったデータを整理し、見える化"],
  ["業務改善コンサルティング", "業務の棚卸しから構築まで一貫して支援"]
];
svc.forEach(([name, desc], i) => {
  const col = i % 2, row = Math.floor(i / 2);
  const x = M + col * (W / 2), y = 4.25 + row * 0.78;
  p3.addShape(pres.shapes.RECTANGLE, { x, y: y + 0.08, w: 0.07, h: 0.55, fill: { color: C.orange }, line: { type: "none" } });
  p3.addText([
    { text: name, options: { fontSize: 16, bold: true, color: C.navy, breakLine: true } },
    { text: desc, options: { fontSize: 14 } }
  ], { ...TXT, x: x + 0.2, y, w: W / 2 - 0.4, h: 0.72, valign: "middle" });
});
p3.addNotes("【不信】『この会社に相談して大丈夫か』を崩すパート。10分以内で終える。事例は相手の関心が出てから補足する。");

// P04 調達業務で手間が生まれやすいところ（仮説）
const p4 = page("調達業務で手間が生まれやすいところ", "設備工事業で一般的に見られる例です。貴社の実際のご状況を本日お伺いさせてください");
const steps = ["業者選定・\n見積依頼", "見積比較", "発注", "納期・\n手配状況の管理", "検収・支払"];
const gap = 0.32, sw = (W - gap * 4) / 5, sy = 1.95, sh = 1.15;
steps.forEach((name, i) => {
  const x = M + i * (sw + gap);
  p4.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y: sy, w: sw, h: sh, fill: { color: C.navy }, line: { type: "none" }, rectRadius: 0.08 });
  p4.addText(name, { ...TXT, x, y: sy, w: sw, h: sh, fontSize: 17, bold: true, color: C.white, align: "center", valign: "middle" });
  if (i < 4) p4.addShape(pres.shapes.RIGHT_ARROW, { x: x + sw + 0.05, y: sy + sh / 2 - 0.14, w: 0.22, h: 0.28, fill: { color: C.textMute }, line: { type: "none" } });
  if (i < 4) {
    p4.addShape(pres.shapes.OVAL, { x: x + sw / 2 - 0.22, y: sy + sh - 0.1, w: 0.44, h: 0.44, fill: { color: C.orange }, line: { color: C.white, width: 1.5 } });
    p4.addText(String(i + 1), { ...TXT, x: x + sw / 2 - 0.22, y: sy + sh - 0.1, w: 0.44, h: 0.44, fontSize: 16, bold: true, color: C.white, align: "center", valign: "middle" });
  }
});
const pains = [
  ["取引先の経営状況の確認が、新規取引時の一度きりになっている"],
  ["複数業者の見積（PDF・紙・Excel）を、比較表へ手で転記している"],
  ["発注書を作り、基幹システムにも同じ内容を入力している"],
  ["現場ごとの手配状況が、担当者のExcelやメールに分散している"]
];
pains.forEach(([txt], i) => {
  const col = i % 2, row = Math.floor(i / 2);
  const x = M + col * (W / 2), y = 3.75 + row * 1.0;
  p4.addShape(pres.shapes.OVAL, { x, y: y + 0.13, w: 0.44, h: 0.44, fill: { color: C.orange }, line: { type: "none" } });
  p4.addText(String(i + 1), { ...TXT, x, y: y + 0.13, w: 0.44, h: 0.44, fontSize: 16, bold: true, color: C.white, align: "center", valign: "middle" });
  p4.addText(txt, { ...TXT, x: x + 0.6, y, w: W / 2 - 0.85, h: 0.7, fontSize: 17, valign: "middle" });
});
p4.addText("当てはまるもの・当てはまらないもの、ほかのお困りごとをお聞かせください", {
  ...TXT, x: M, y: 5.95, w: W, h: 0.55, fontSize: 18, bold: true, color: C.navy, align: "center", valign: "middle"
});
p4.addNotes("【不要】本日の山場。4つは仮説。『どれが一番近いですか』と聞き、外れたら素直に直す。");

// P05 お手伝いできることの例
const p5 = page("お手伝いできることの例", "前ページの手間ごとに、考えられる対応です");
const H = (s) => ({ text: s, options: { bold: true, color: C.white, fill: { color: C.navy }, fontSize: 16 } });
const R = (a, b, c) => [
  { text: a, options: { bold: true, color: C.navy } }, { text: b }, { text: c, options: { color: C.textMute } }
];
p5.addTable([
  [H("手間の例"), H("対応の例"), H("関連サービス")],
  R("① 取引先の与信確認", "与信情報を定期的に取得し、変化があれば担当者へ通知する", "与信管理DX"),
  R("② 見積の比較", "見積書の内容を読み取り、比較表へ自動で反映する", "RPA・AI"),
  R("③ 発注書の作成・入力", "決まった手順の作成・転記・システム入力をロボットが代行する", "RPA"),
  R("④ 手配状況の管理", "現場・発注・納期の情報を一か所に集め、一覧で見られるようにする", "Smart CRM・ダッシュボード")
], {
  x: M, y: 1.85, w: W, colW: [2.75, 5.49, 2.5], rowH: 0.88,
  fontFace: F.jp, fontSize: 16, color: C.text, valign: "middle", margin: [0.06, 0.15, 0.06, 0.15],
  border: { type: "solid", pt: 0.75, color: C.border }
});
p5.addText("実際に適用できるか、どの程度の効果があるかは、業務の詳細を確認したうえでご提案いたします", {
  ...TXT, x: M, y: 6.3, w: W, h: 0.4, fontSize: 14, color: C.textMute
});
p5.addNotes("【不適】反応があった行だけ深掘り。効果・金額・連携可否はこの場で約束しない。");

// P06 本日お伺いしたいこと
const p6 = page("本日お伺いしたいこと", "差し支えない範囲でお聞かせください");
const qs = [
  ["調達業務の流れ", "見積依頼から支払いまでの流れと、関わる部署・人数"],
  ["手間がかかっている作業", "転記・集計・確認など、繰り返し発生している作業"],
  ["お使いのシステム", "基幹システム・Excel・メールなど、現在の道具と使い分け"],
  ["優先したいこと", "まず解決したいことと、いつ頃までに変えたいか"],
  ["ご検討の進め方", "社内のご相談先や、ご判断の流れ"]
];
qs.forEach(([q, d], i) => {
  const y = 1.8 + i * 0.95;
  p6.addShape(pres.shapes.OVAL, { x: M, y: y + 0.12, w: 0.56, h: 0.56, fill: { color: C.navy }, line: { type: "none" } });
  p6.addText(String(i + 1), { ...TXT, x: M, y: y + 0.12, w: 0.56, h: 0.56, fontSize: 20, bold: true, color: C.white, align: "center", valign: "middle" });
  p6.addText(q, { ...TXT, x: M + 0.8, y, w: 3.4, h: 0.8, fontSize: 20, bold: true, color: C.navy, valign: "middle" });
  p6.addText(d, { ...TXT, x: M + 4.25, y, w: W - 4.25, h: 0.8, fontSize: 17, valign: "middle" });
  if (i < qs.length - 1) p6.addShape(pres.shapes.LINE, { x: M, y: y + 0.88, w: W, h: 0, line: { color: C.border, width: 0.75 } });
});
p6.addNotes("【不急】④で『いつまでに』を必ず聞く。【決裁】⑤で決裁者・親会社承認の要否をさりげなく確認する。");

// P07 今後の進め方（案）
const p7 = page("今後の進め方（案）", "小さく確かめながら進めます");
const flow = [
  ["本日のお伺い", "現状とお困りごとを伺い、テーマの候補を挙げる"],
  ["業務の詳細確認", "実務ご担当者様も交え、対象業務の流れと手間を確認する"],
  ["ご提案", "効果が見込める業務を選び、進め方と概算をご提示する"],
  ["小さく試す", "デモや一部業務での検証で、使えるかを確かめる"]
];
const fw2 = W / 4;
p7.addShape(pres.shapes.LINE, { x: M + fw2 / 2, y: 2.2, w: W - fw2, h: 0, line: { color: C.border, width: 3 } });
flow.forEach(([name, desc], i) => {
  const cx = M + i * fw2 + fw2 / 2;
  const now = i === 0;
  p7.addShape(pres.shapes.OVAL, { x: cx - 0.4, y: 1.8, w: 0.8, h: 0.8, fill: { color: now ? C.orange : C.navy }, line: { color: C.white, width: 3 } });
  p7.addText(String(i + 1), { ...TXT, x: cx - 0.4, y: 1.8, w: 0.8, h: 0.8, fontSize: 24, bold: true, color: C.white, align: "center", valign: "middle" });
  p7.addText(name, { ...TXT, x: cx - fw2 / 2 + 0.1, y: 2.8, w: fw2 - 0.2, h: 0.5, fontSize: 20, bold: true, color: now ? C.orange : C.navy, align: "center" });
  p7.addText(desc, { ...TXT, x: cx - fw2 / 2 + 0.15, y: 3.35, w: fw2 - 0.3, h: 1.1, fontSize: 15, align: "center", valign: "top" });
});
p7.addShape(pres.shapes.RECTANGLE, { x: M, y: 4.85, w: W, h: 1.45, fill: { color: C.sectionFill }, line: { color: C.orange, width: 1 } });
p7.addText("本日決めたいこと", { ...TXT, x: M + 0.35, y: 4.85, w: 2.8, h: 1.45, fontSize: 18, bold: true, color: C.orange, valign: "middle" });
p7.addText([
  { text: "次回、詳しく確認するテーマ", options: { bullet: true, breakLine: true } },
  { text: "次回の日程と、ご同席いただく方（実務ご担当者様など）", options: { bullet: true } }
], { ...TXT, x: M + 3.2, y: 4.85, w: W - 3.5, h: 1.45, fontSize: 18, color: C.navy, valign: "middle", paraSpaceAfter: 6 });
p7.addNotes("次回の日程・テーマ・同席者をこの場で決める。お客様と『戦友』として、一緒に社内へ進める姿勢を伝える。");

// P08 結び
t.addClosingSlide(pres, ASSETS, { subMessage: "thomas株式会社　宮川 晋之介" });

pres.writeFile({ fileName: OUT }).then(f => console.log("written:", f));
