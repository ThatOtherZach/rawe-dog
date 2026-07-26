import PDFDocument from "pdfkit";
import { cleanDocumentMarkdown } from "../clean-md.js";

/**
 * Structured ATS resume/cover PDF.
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function drawRichText(doc: any, text: string, opts: {
  size: number;
  width: number;
  x?: number;
  /** Explicit y for the first run. When omitted, doc.y is used. Pass this for
   *  co-positioned elements (e.g. a bullet marker + its body text) to ensure
   *  both start on the same baseline regardless of what the previous draw left
   *  in doc.y. */
  y?: number;
  align?: "left" | "right" | "center";
  lineGap?: number;
}) {
  const runs = parseInline(text);
  const x = opts.x ?? MARGIN;

  for (let i = 0; i < runs.length; i++) {
    const run = runs[i];
    const isLast = i === runs.length - 1;
    doc.font(fontFor(run)).fontSize(opts.size);

    if (i === 0) {
      // Always use explicit x,y for the first run. This fully resets pdfkit's
      // internal cursor so x-drift from previous blocks cannot accumulate, and
      // lets callers pin the y for co-positioned draws (bullet marker + body).
      const y = opts.y !== undefined ? opts.y : (doc.y as number);
      doc.text(run.text, x, y, {
        continued: !isLast,
        width: opts.width,
        align: opts.align ?? "left",
        lineGap: opts.lineGap ?? 2,
      });
    } else {
      doc.text(run.text, {
        continued: !isLast,
        width: opts.width,
        align: opts.align ?? "left",
        lineGap: opts.lineGap ?? 2,
      });
    }
  }
}

export async function markdownToPdfBuffer(
  markdown: string,
  _title?: string
): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({
      size: "LETTER",
      margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
    });

    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const blocks = parseBlocks(markdown);
    let first = true;

    for (const block of blocks) {
      if (block.type === "blank") {
        if (!first) doc.moveDown(0.4);
        continue;
      }

      if (block.type === "rule") {
        doc
          .moveTo(MARGIN, doc.y)
          .lineTo(MARGIN + CONTENT_W, doc.y)
          .strokeColor("#cccccc")
          .stroke();
        doc.moveDown(0.5);
        first = false;
        continue;
      }

      if (block.type === "h1") {
        if (!first) doc.moveDown(0.3);
        const isContact = looksLikeContact(stripInline(block.text));
        if (isContact) {
          doc.font("Helvetica").fontSize(9).fillColor("#555555");
          doc.text(stripInline(block.text), MARGIN, doc.y, {
            width: CONTENT_W,
            align: "center",
          });
        } else {
          doc.font("Helvetica-Bold").fontSize(16).fillColor("#111111");
          doc.text(stripInline(block.text), MARGIN, doc.y, {
            width: CONTENT_W,
            align: "center",
          });
        }
        doc.moveDown(0.3);
        first = false;
        continue;
      }

      if (block.type === "h2") {
        if (!first) doc.moveDown(0.5);
        doc.font("Helvetica-Bold").fontSize(11).fillColor("#222222");
        doc.text(stripInline(block.text).toUpperCase(), MARGIN, doc.y, {
          width: CONTENT_W,
        });
        doc
          .moveTo(MARGIN, doc.y + 2)
          .lineTo(MARGIN + CONTENT_W, doc.y + 2)
          .strokeColor("#333333")
          .stroke();
        doc.moveDown(0.4);
        first = false;
        continue;
      }

      if (block.type === "h3") {
        if (!first) doc.moveDown(0.3);
        doc.fillColor("#111111");
        drawRichText(doc, block.text, { size: 10, width: CONTENT_W });
        doc.moveDown(0.15);
        first = false;
        continue;
      }

      if (block.type === "bullet") {
        const INDENT = 12;
        const bulletY = doc.y as number;
        doc.font("Helvetica").fontSize(9.5).fillColor("#333333");
        // Draw the marker at bulletY WITHOUT continued:true so pdfkit does not
        // lock subsequent draws into a 10-pt-wide continuation flow.
        doc.text("•", MARGIN, bulletY, { width: INDENT, continued: false });
        // Draw body at the same bulletY so marker and text share a baseline.
        // drawRichText uses explicit x,y for its first run, so the y snap is
        // guaranteed even though pdfkit advanced doc.y after the marker draw.
        drawRichText(doc, block.text, {
          size: 9.5,
          width: CONTENT_W - INDENT,
          x: MARGIN + INDENT,
          y: bulletY,
        });
        doc.moveDown(0.1);
        first = false;
        continue;
      }

      if (block.type === "para") {
        doc.fillColor("#333333");
        drawRichText(doc, block.text, { size: 9.5, width: CONTENT_W });
        doc.moveDown(0.2);
        first = false;
        continue;
      }
    }

    doc.end();
  });
}
