import PDFDocument from "pdfkit";
import { cleanDocumentMarkdown } from "../clean-md";

/**
 * Structured ATS resume/cover PDF.
 * Flowing layout with consistent styles (Platypus-like discipline in pdfkit).
 */

type Block =
  | { type: "h1"; text: string }
  | { type: "h2"; text: string }
  | { type: "h3"; text: string }
  | { type: "para"; text: string }
  | { type: "bullet"; text: string }
  | { type: "rule" }
  | { type: "blank" };

type InlineRun = { text: string; bold?: boolean; italic?: boolean };

const MARGIN = 50;
const PAGE_W = 612; // letter
const CONTENT_W = PAGE_W - MARGIN * 2;

function parseInline(raw: string): InlineRun[] {
  const s = raw
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  const runs: InlineRun[] = [];
  const re = /(\*\*\*[^*]+\*\*\*|\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m.index > last) runs.push({ text: s.slice(last, m.index) });
    const token = m[0];
    if (token.startsWith("***") && token.endsWith("***")) {
      runs.push({ text: token.slice(3, -3), bold: true, italic: true });
    } else if (token.startsWith("**") && token.endsWith("**")) {
      runs.push({ text: token.slice(2, -2), bold: true });
    } else {
      runs.push({ text: token.slice(1, -1), italic: true });
    }
    last = m.index + token.length;
  }
  if (last < s.length) runs.push({ text: s.slice(last) });
  return runs.length ? runs : [{ text: s }];
}

function stripInline(s: string): string {
  return parseInline(s)
    .map((r) => r.text)
    .join("");
}

function parseBlocks(md: string): Block[] {
  const text = cleanDocumentMarkdown(md);
  const lines = text.split("\n");
  const blocks: Block[] = [];
  let paraBuf: string[] = [];

  const flushPara = () => {
    if (!paraBuf.length) return;
    const t = paraBuf.join(" ").replace(/\s+/g, " ").trim();
    if (t) blocks.push({ type: "para", text: t });
    paraBuf = [];
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const trimmed = line.trim();

    if (!trimmed) {
      flushPara();
      if (blocks.length && blocks[blocks.length - 1].type !== "blank") {
        blocks.push({ type: "blank" });
      }
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushPara();
      blocks.push({ type: "rule" });
      continue;
    }

    if (trimmed.startsWith("# ")) {
      flushPara();
      blocks.push({ type: "h1", text: trimmed.slice(2).trim() });
      continue;
    }
    if (trimmed.startsWith("## ")) {
      flushPara();
      blocks.push({ type: "h2", text: trimmed.slice(3).trim() });
      continue;
    }
    if (trimmed.startsWith("### ") || trimmed.startsWith("#### ")) {
      flushPara();
      blocks.push({
        type: "h3",
        text: trimmed.replace(/^#{3,4}\s+/, "").trim(),
      });
      continue;
    }
    if (/^[-*•]\s+/.test(trimmed)) {
      flushPara();
      blocks.push({ type: "bullet", text: trimmed.replace(/^[-*•]\s+/, "") });
      continue;
    }

    paraBuf.push(trimmed);
  }
  flushPara();
  return blocks;
}

function looksLikeContact(s: string): boolean {
  const t = s.toLowerCase();
  return (
    /@/.test(t) ||
    /linkedin\.com/.test(t) ||
    /\+?\d[\d\s().-]{7,}/.test(t) ||
    /phone|mobile|email|vancouver|toronto|canada/.test(t)
  );
}

function fontFor(run: InlineRun): string {
  if (run.bold && run.italic) return "Helvetica-BoldOblique";
  if (run.bold) return "Helvetica-Bold";
  if (run.italic) return "Helvetica-Oblique";
  return "Helvetica";
}

function drawRichText(
  doc: PDFKit.PDFDocument,
  text: string,
  opts: {
    size: number;
    width: number;
    x?: number;
    align?: "left" | "right" | "center";
    lineGap?: number;
  }
) {
  const runs = parseInline(text);
  const x = opts.x ?? MARGIN;
  doc.x = x;
  // Build continued runs on one flow
  runs.forEach((run, i) => {
    doc.font(fontFor(run)).fontSize(opts.size);
    doc.text(run.text, {
      width: opts.width,
      align: opts.align || "left",
      continued: i < runs.length - 1,
      lineGap: opts.lineGap ?? 1.5,
    });
  });
}

export async function markdownToPdfBuffer(
  md: string,
  title?: string
): Promise<Buffer> {
  const blocks = parseBlocks(md);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "LETTER",
      margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
      info: title
        ? { Title: stripInline(title), Author: "RAWE Dog" }
        : { Author: "RAWE Dog" },
      autoFirstPage: true,
      bufferPages: true,
    });

    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c as Buffer));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const pageBottom = () => doc.page.height - MARGIN;

    const ensureSpace = (needed: number) => {
      if (doc.y + needed > pageBottom()) {
        doc.addPage();
      }
    };

    // Optional: pull contact lines after h1 into a header row
    let i = 0;
    if (blocks[0]?.type === "h1") {
      const name = blocks[0].text;
      i = 1;
      const contactLines: string[] = [];
      while (i < blocks.length) {
        const b = blocks[i];
        if (b.type === "blank") {
          i++;
          continue;
        }
        if (b.type === "para" && looksLikeContact(b.text) && contactLines.length < 4) {
          contactLines.push(b.text);
          i++;
          continue;
        }
        break;
      }

      ensureSpace(48);
      const nameY = doc.y;
      doc.font("Helvetica-Bold").fontSize(18).fillColor("#111111");
      doc.text(stripInline(name), MARGIN, nameY, {
        width: contactLines.length ? CONTENT_W * 0.55 : CONTENT_W,
        lineGap: 2,
      });
      const afterNameY = doc.y;

      if (contactLines.length) {
        const contactText = contactLines.map(stripInline).join("\n");
        doc.font("Helvetica").fontSize(9).fillColor("#333333");
        doc.text(contactText, MARGIN + CONTENT_W * 0.55, nameY, {
          width: CONTENT_W * 0.45,
          align: "right",
          lineGap: 2,
        });
        doc.y = Math.max(afterNameY, doc.y) + 6;
      } else {
        doc.y = afterNameY + 4;
      }

      // rule under header
      const ruleY = doc.y;
      doc
        .moveTo(MARGIN, ruleY)
        .lineTo(MARGIN + CONTENT_W, ruleY)
        .lineWidth(1)
        .strokeColor("#333333")
        .stroke();
      doc.y = ruleY + 12;
      doc.fillColor("#111111");
    }

    for (; i < blocks.length; i++) {
      const b = blocks[i];

      if (b.type === "blank") {
        doc.moveDown(0.25);
        continue;
      }

      if (b.type === "rule") {
        ensureSpace(16);
        const y = doc.y + 2;
        doc
          .moveTo(MARGIN, y)
          .lineTo(MARGIN + CONTENT_W, y)
          .lineWidth(0.5)
          .strokeColor("#aaaaaa")
          .stroke();
        doc.y = y + 10;
        doc.fillColor("#111111");
        continue;
      }

      if (b.type === "h2") {
        ensureSpace(36);
        doc.moveDown(0.35);
        doc.font("Helvetica-Bold").fontSize(12).fillColor("#111111");
        doc.text(stripInline(b.text).toUpperCase(), MARGIN, doc.y, {
          width: CONTENT_W,
          lineGap: 2,
        });
        const y = doc.y + 2;
        doc
          .moveTo(MARGIN, y)
          .lineTo(MARGIN + CONTENT_W, y)
          .lineWidth(0.8)
          .strokeColor("#222222")
          .stroke();
        doc.y = y + 8;
        continue;
      }

      if (b.type === "h1") {
        ensureSpace(32);
        doc.font("Helvetica-Bold").fontSize(16).fillColor("#111111");
        doc.text(stripInline(b.text), MARGIN, doc.y, {
          width: CONTENT_W,
          lineGap: 2,
        });
        doc.moveDown(0.2);
        continue;
      }

      if (b.type === "h3") {
        ensureSpace(28);
        doc.moveDown(0.15);
        doc.font("Helvetica-Bold").fontSize(10.5).fillColor("#111111");
        doc.text(stripInline(b.text), MARGIN, doc.y, {
          width: CONTENT_W,
          lineGap: 1.5,
        });
        doc.moveDown(0.1);
        continue;
      }

      if (b.type === "bullet") {
        ensureSpace(22);
        const bulletX = MARGIN + 6;
        const textX = MARGIN + 18;
        const textW = CONTENT_W - 18;
        const startY = doc.y;

        doc.font("Helvetica").fontSize(10).fillColor("#111111");
        doc.text("•", bulletX, startY, { width: 12, lineBreak: false });

        doc.x = textX;
        doc.y = startY;
        drawRichText(doc, b.text, {
          size: 10,
          width: textW,
          x: textX,
          lineGap: 1.5,
        });
        doc.y += 3;
        continue;
      }

      if (b.type === "para") {
        ensureSpace(20);
        drawRichText(doc, b.text, {
          size: 10,
          width: CONTENT_W,
          x: MARGIN,
          lineGap: 2,
        });
        doc.moveDown(0.15);
      }
    }

    doc.end();
  });
}
