// thomas-pptx.js  --  thomas株式会社 共通PowerPointデザインライブラリ
// 単一ファイル版：theme + helpers + slides + patterns を統合
// 使い方:
//   const t = require("./thomas-pptx");
//   const pres = new (require("pptxgenjs"))();
//   pres.layout = "LAYOUT_WIDE";
//   t.addCoverSlide(pres, ASSETS, { companyName, projectName, ... });

const path = require("path");

// ---------- テーマ定数 ----------
const C = {
  navy: "002060", navyDark: "13243F",
  orange: "EB6311", orangeAgenda: "F94F12",
  red: "B91C1C", redBg: "FFF5F5", redBar: "EF4444",
  amber: "B45309", amberBg: "FFFBEB", amberBar: "F59E0B",
  green: "059669", greenBg: "F0FDF4", greenBar: "10B981",
  blue: "1D4ED8", blueBg: "EFF6FF", blueBar: "002060",
  text: "334155", textMute: "64748B", border: "E2E8F0",
  sectionFill: "FFF7ED", white: "FFFFFF", codeBg: "F8FAFC"
};
const F = { jp: "Yu Gothic", en: "Calibri", code: "Consolas" };
const LAYOUT = { W: 13.333, H: 7.5, margin: 1.33, contentW: 10.74 };

// ---------- 装飾 ----------
function addCoverDecoration(pres, slide, assetsDir) {
  slide.addImage({ path: path.join(assetsDir, "bg_cover.png"), x: 0, y: 0, w: LAYOUT.W, h: LAYOUT.H });
}
function addPageDecoration(pres, slide, assetsDir) {
  slide.addImage({ path: path.join(assetsDir, "bg_page.png"), x: 0, y: 0, w: LAYOUT.W, h: LAYOUT.H });
}
function addTLogo(pres, slide, assetsDir) {
  if (!assetsDir) return;
  slide.addImage({ path: path.join(assetsDir, "logo_t.png"), x: 0.25, y: 6.78, w: 0.50, h: 0.50 });
}

// ---------- タイトル ----------
function addTitleBar(pres, slide, title, subtitle) {
  slide.addText(title, {
    x: LAYOUT.margin, y: 0.42, w: LAYOUT.contentW, h: 0.4,
    fontFace: F.jp, fontSize: 24, bold: true, color: C.navy, margin: 0
  });
  if (subtitle) {
    slide.addText(subtitle, {
      x: LAYOUT.margin, y: 0.87, w: LAYOUT.contentW, h: 0.26,
      fontFace: F.jp, fontSize: 12, color: C.textMute, margin: 0
    });
  }
}
function addSectionHeading(pres, slide, opts) {
  const { x = LAYOUT.margin, y, w = LAYOUT.contentW, text, underlineW = 2.0 } = opts;
  slide.addText(text, { x, y, w, h: 0.30, fontFace: F.jp, fontSize: 14, bold: true, color: C.navy, margin: 0 });
  slide.addShape(pres.shapes.LINE, { x, y: y + 0.30, w: underlineW, h: 0, line: { color: C.orange, width: 1.5 } });
}

// ---------- カード ----------
function addCard(pres, slide, opts) {
  const { x, y, w, h, accentColor, bgColor = C.white, header, headerColor, body, bodyFontSize = 11 } = opts;
  slide.addShape(pres.shapes.RECTANGLE, { x, y, w, h, fill: { color: bgColor }, line: { color: C.border, width: 0.5 } });
  slide.addShape(pres.shapes.RECTANGLE, { x, y, w: 0.08, h, fill: { color: accentColor }, line: { color: accentColor } });
  if (header) {
    slide.addText(header, {
      x: x + 0.25, y: y + 0.1, w: w - 0.35, h: 0.32,
      fontFace: F.jp, fontSize: 12, bold: true,
      color: headerColor || accentColor, valign: "middle", margin: 0
    });
  }
  if (body) {
    const bodyY = header ? y + 0.46 : y + 0.12;
    const bodyH = header ? h - 0.52 : h - 0.2;
    const common = { x: x + 0.28, y: bodyY, w: w - 0.45, h: bodyH, fontFace: F.jp, fontSize: bodyFontSize, color: C.text, valign: "top", margin: 0 };
    if (Array.isArray(body)) slide.addText(body, { ...common, paraSpaceAfter: 3 });
    else slide.addText(body, common);
  }
}
function addStepCard(pres, slide, opts) {
  const { x, y, w, h, num, color, bgColor = C.white, headColor, title, body, bodyFontSize = 10.5 } = opts;
  slide.addShape(pres.shapes.RECTANGLE, { x, y, w, h, fill: { color: bgColor }, line: { color: C.border, width: 0.5 } });
  slide.addShape(pres.shapes.RECTANGLE, { x, y, w: 0.08, h, fill: { color }, line: { color } });
  slide.addShape(pres.shapes.OVAL, { x: x + 0.22, y: y + 0.15, w: 0.36, h: 0.36, fill: { color }, line: { color } });
  slide.addText(String(num), {
    x: x + 0.22, y: y + 0.15, w: 0.36, h: 0.36,
    fontFace: F.jp, fontSize: 14, bold: true, color: C.white, align: "center", valign: "middle", margin: 0
  });
  slide.addText(title, {
    x: x + 0.64, y: y + 0.13, w: w - 0.80, h: 0.32,
    fontFace: F.jp, fontSize: 12, bold: true, color: headColor || color, valign: "middle", margin: 0
  });
  if (body) {
    const common = { x: x + 0.22, y: y + 0.60, w: w - 0.42, h: h - 0.70, fontFace: F.jp, fontSize: bodyFontSize, color: C.text, valign: "top", margin: 0 };
    if (Array.isArray(body)) slide.addText(body, { ...common, paraSpaceAfter: 3 });
    else slide.addText(body, common);
  }
}
function addBeforeAfterCode(pres, slide, opts) {
  const { x1 = LAYOUT.margin, y, w = 5.28, h = 2.70, gap = 0.17,
          beforeLines = [], afterLines = [],
          beforeLabel = " Before ", afterLabel = " After " } = opts;
  const x2 = x1 + w + gap;
  slide.addShape(pres.shapes.RECTANGLE, { x: x1, y, w, h, fill: { color: "FEF2F2" }, line: { color: C.border, width: 0.5 } });
  slide.addShape(pres.shapes.RECTANGLE, { x: x1, y, w: 0.08, h, fill: { color: C.redBar }, line: { color: C.redBar } });
  slide.addText(beforeLabel, { x: x1 + 0.25, y: y + 0.10, w: w - 0.35, h: 0.32, fontFace: F.jp, fontSize: 12, bold: true, color: C.red, valign: "middle", margin: 0 });
  slide.addText(
    beforeLines.map((t, i) => ({ text: t, options: { fontFace: F.code, fontSize: 11, color: C.text, breakLine: i < beforeLines.length - 1 } })),
    { x: x1 + 0.28, y: y + 0.55, w: w - 0.45, h: h - 0.65, valign: "top", margin: 0 }
  );
  slide.addShape(pres.shapes.RECTANGLE, { x: x2, y, w, h, fill: { color: "ECFDF5" }, line: { color: C.border, width: 0.5 } });
  slide.addShape(pres.shapes.RECTANGLE, { x: x2, y, w: 0.08, h, fill: { color: C.greenBar }, line: { color: C.greenBar } });
  slide.addText(afterLabel, { x: x2 + 0.25, y: y + 0.10, w: w - 0.35, h: 0.32, fontFace: F.jp, fontSize: 12, bold: true, color: C.green, valign: "middle", margin: 0 });
  slide.addText(
    afterLines.map((t, i) => ({ text: t, options: { fontFace: F.code, fontSize: 11, color: C.text, breakLine: i < afterLines.length - 1 } })),
    { x: x2 + 0.28, y: y + 0.55, w: w - 0.45, h: h - 0.65, valign: "top", margin: 0 }
  );
}
function addStyledTable(pres, slide, opts) {
  const { x = LAYOUT.margin, y, w = LAYOUT.contentW, colW, rowH = 0.30, headers, rows } = opts;
  const headerRow = headers.map(h => ({
    text: h,
    options: { bold: true, color: C.white, fill: { color: C.navy }, align: "left", valign: "middle", fontFace: F.jp, fontSize: 11 }
  }));
  const bodyRows = rows.map(row =>
    row.map(cell => {
      if (typeof cell === "string") return { text: cell, options: { fontFace: F.jp, fontSize: 10, color: C.text, valign: "middle" } };
      return { text: cell.text, options: { fontFace: F.jp, fontSize: 10, color: C.text, valign: "middle", ...(cell.options || {}) } };
    })
  );
  slide.addTable([headerRow, ...bodyRows], {
    x, y, w, colW, rowH, fontFace: F.jp, fontSize: 10, color: C.text,
    border: { pt: 0.5, color: C.border }, valign: "middle"
  });
}

// ---------- 表紙・アジェンダ・区切り・コンテンツ・クロージング ----------
function addCoverSlide(pres, assetsDir, opts) {
  const s = pres.addSlide();
  s.background = { color: C.white };
  addCoverDecoration(pres, s, assetsDir);
  s.addText(opts.companyName + "　　御中", {
    x: 0.48, y: 0.64, w: 11.0, h: 1.04,
    fontFace: F.jp, fontSize: 40, bold: true,
    color: C.navy, underline: { style: "sng", color: C.navy }, margin: 0
  });
  s.addText(opts.projectName, {
    x: 1.31, y: 3.06, w: 10.72, h: 0.84,
    fontFace: F.jp, fontSize: 32, bold: true, color: C.navy,
    align: "center", valign: "middle", margin: 0
  });
  s.addShape(pres.shapes.RECTANGLE, { x: 1.97, y: 3.92, w: 9.40, h: 0.64, fill: { color: C.orange }, line: { color: C.orange } });
  s.addText(opts.slideTitle, {
    x: 1.97, y: 3.92, w: 9.40, h: 0.64,
    fontFace: F.jp, fontSize: 21.33, bold: true, color: C.white,
    align: "center", valign: "middle", margin: 0
  });
  s.addText([
    { text: opts.date, options: { breakLine: true } },
    { text: opts.author, options: {} }
  ], {
    x: 2.52, y: 4.69, w: 8.24, h: 0.90,
    fontFace: F.jp, fontSize: 18.67, bold: true, color: C.navy,
    align: "center", valign: "middle", paraSpaceAfter: 2, margin: 0
  });
  return s;
}
function addAgendaSlide(pres, assetsDir, opts) {
  const s = pres.addSlide();
  s.background = { color: C.white };
  addPageDecoration(pres, s, assetsDir);
  s.addText("アジェンダ", {
    x: 0.22, y: 0.20, w: 12.53, h: 0.82,
    fontFace: F.jp, fontSize: 32, bold: true, color: C.orangeAgenda,
    valign: "middle", margin: 0
  });
  const items = opts.items.map((t, i) => ({
    text: (i + 1) + ".  " + t,
    options: { breakLine: i < opts.items.length - 1 }
  }));
  s.addText(items, {
    x: 1.35, y: 1.60, w: 10.5, h: 4.6,
    fontFace: F.jp, fontSize: 24, bold: true, color: C.navy,
    valign: "top", paraSpaceAfter: 14, margin: 0
  });
  return s;
}
function addDividerSlide(pres, assetsDir, opts) {
  const s = pres.addSlide();
  s.background = { color: C.white };
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: 1.67, y: 3.10, w: 10.00, h: 1.30,
    fill: { color: C.orange }, line: { color: C.orange }, rectRadius: 0.15
  });
  const label = opts.sectionNumber !== undefined
    ? (opts.sectionNumber + ". " + opts.sectionTitle)
    : String(opts.sectionTitle);
  s.addText(label, {
    x: 1.67, y: 3.10, w: 10.00, h: 1.30,
    fontFace: F.jp, fontSize: 36, bold: true, color: C.white,
    align: "center", valign: "middle", margin: 0
  });
  addTLogo(pres, s, assetsDir);
  return s;
}
function addContentSlide(pres, assetsDir, opts) {
  if (typeof assetsDir === "object" && assetsDir !== null && !opts) {
    opts = assetsDir; assetsDir = null;
  }
  const s = pres.addSlide();
  s.background = { color: C.white };
  addTitleBar(pres, s, opts.title, opts.subtitle);
  addTLogo(pres, s, assetsDir);
  return s;
}
function addClosingSlide(pres, assetsDir, opts = {}) {
  const s = pres.addSlide();
  s.background = { color: C.white };
  addCoverDecoration(pres, s, assetsDir);
  const message = opts.message || "thank you!";
  s.addText(message, {
    x: 0.5, y: 2.60, w: LAYOUT.W - 1.0, h: 2.30,
    fontFace: F.jp, fontSize: 120, bold: true, color: C.navy,
    align: "center", valign: "middle", margin: 0
  });
  if (opts.subMessage) {
    s.addText(opts.subMessage, {
      x: 0.5, y: 5.10, w: LAYOUT.W - 1.0, h: 0.60,
      fontFace: F.jp, fontSize: 22, bold: true, color: C.navy,
      align: "center", valign: "middle", margin: 0
    });
  }
  return s;
}

// ---------- パターン ----------
function addIssueSlide(pres, assetsDir, opts) {
  const s = pres.addSlide();
  s.background = { color: C.white };
  addTitleBar(pres, s, opts.title, opts.subtitle);
  addCard(pres, s, {
    x: LAYOUT.margin, y: 1.40, w: LAYOUT.contentW, h: 1.25,
    accentColor: C.redBar, bgColor: C.redBg,
    header: " 事象 ", headerColor: C.red, body: opts.event
  });
  const causeN = (opts.causes || []).length;
  if (causeN > 0) {
    const gap = 0.15;
    const w = (LAYOUT.contentW - gap * (causeN - 1)) / causeN;
    (opts.causes || []).forEach((c, i) => {
      addCard(pres, s, {
        x: LAYOUT.margin + i * (w + gap), y: 2.85, w, h: 1.85,
        accentColor: C.amberBar, bgColor: C.amberBg,
        header: c.header || (" 原因 " + (i + 1) + " "),
        headerColor: C.amber, body: c.body
      });
    });
  }
  const actionN = (opts.actions || []).length;
  if (actionN > 0) {
    const gap = 0.15;
    const w = (LAYOUT.contentW - gap * (actionN - 1)) / actionN;
    (opts.actions || []).forEach((a, i) => {
      addCard(pres, s, {
        x: LAYOUT.margin + i * (w + gap), y: 4.90, w, h: 2.05,
        accentColor: C.greenBar, bgColor: C.greenBg,
        header: a.header || (" 対応 " + (i + 1) + " "),
        headerColor: C.green, body: a.body
      });
    });
  }
  addTLogo(pres, s, assetsDir);
  return s;
}
function addDiscussionSlide(pres, assetsDir, opts) {
  const s = pres.addSlide();
  s.background = { color: C.white };
  addTitleBar(pres, s, opts.title, opts.subtitle);
  let cardsY = 1.40, cardsH = 5.55;
  if (opts.summary) {
    addCard(pres, s, {
      x: LAYOUT.margin, y: 1.40, w: LAYOUT.contentW, h: 1.10,
      accentColor: C.redBar, bgColor: C.redBg,
      header: " 課題サマリ ", headerColor: C.red, body: opts.summary
    });
    cardsY = 2.70; cardsH = 4.25;
  }
  const palette = [
    { bar: C.blueBar, bg: C.white, head: C.navy },
    { bar: C.amberBar, bg: C.amberBg, head: C.amber },
    { bar: C.greenBar, bg: C.greenBg, head: C.green }
  ];
  const pts = opts.points || [];
  const gap = 0.13;
  const w = (LAYOUT.contentW - gap * (pts.length - 1)) / pts.length;
  pts.forEach((p, i) => {
    const style = palette[i % palette.length];
    addCard(pres, s, {
      x: LAYOUT.margin + i * (w + gap), y: cardsY, w, h: cardsH,
      accentColor: style.bar, bgColor: style.bg,
      header: p.header || (" 論点 " + (i + 1) + " "),
      headerColor: style.head, body: p.body, bodyFontSize: 10.5
    });
  });
  addTLogo(pres, s, assetsDir);
  return s;
}
function addStepsSlide(pres, assetsDir, opts) {
  const s = pres.addSlide();
  s.background = { color: C.white };
  addTitleBar(pres, s, opts.title, opts.subtitle);
  let stepsY = 1.40, stepsH = 5.55;
  if (opts.summary) {
    addCard(pres, s, {
      x: LAYOUT.margin, y: 1.40, w: LAYOUT.contentW, h: 0.95,
      accentColor: C.amberBar, bgColor: C.amberBg,
      header: " サマリ ", headerColor: C.amber, body: opts.summary
    });
    stepsY = 2.50; stepsH = 4.45;
  }
  const steps = opts.steps || [];
  const gap = 0.15;
  const w = (LAYOUT.contentW - gap * (steps.length - 1)) / steps.length;
  const palette = [
    { color: C.blueBar, head: C.navy },
    { color: C.amberBar, head: C.amber },
    { color: C.greenBar, head: C.green },
    { color: C.redBar, head: C.red }
  ];
  steps.forEach((st, i) => {
    const p = palette[i % palette.length];
    addStepCard(pres, s, {
      x: LAYOUT.margin + i * (w + gap), y: stepsY, w, h: stepsH,
      num: i + 1, color: p.color, headColor: p.head, title: st.title, body: st.body
    });
  });
  addTLogo(pres, s, assetsDir);
  return s;
}

module.exports = {
  C, F, LAYOUT,
  addCoverDecoration, addPageDecoration, addTLogo,
  addTitleBar, addSectionHeading,
  addCard, addStepCard, addBeforeAfterCode, addStyledTable,
  addCoverSlide, addAgendaSlide, addDividerSlide, addContentSlide, addClosingSlide,
  addIssueSlide, addDiscussionSlide, addStepsSlide
};
