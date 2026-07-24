import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  BorderStyle,
} from "docx";
import { cleanDocumentMarkdown } from "../clean-md.js";

type InlineRun = { text: string; bold?: boolean; italic?: boolean };

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

function runsToText(runs: InlineRun[], size = 22): TextRun[] {
  return runs.map(
    (r) =>
      new TextRun({
        text: r.text,
        bold: r.bold,
        italics: r.italic,
        size,
      })
  );
}

function mdLinesToParagraphs(md: string): Paragraph[] {
  const lines = cleanDocumentMarkdown(md).split("\n");
  const paras: Paragraph[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      paras.push(new Paragraph({ text: "" }));
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      paras.push(
        new Paragraph({
          border: {
            bottom: { style: BorderStyle.SINGLE, size: 6, color: "CCCCCC" },
          },
          spacing: { after: 120 },
          children: [],
        })
      );
      continue;
    }

    if (trimmed.startsWith("# ")) {
      paras.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          spacing: { after: 200 },
          children: runsToText(parseInline(trimmed.slice(2)), 32),
        })
      );
      continue;
    }
    if (trimmed.startsWith("## ")) {
      paras.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 200, after: 120 },
          children: runsToText(parseInline(trimmed.slice(3)), 26),
        })
      );
      continue;
    }
    if (trimmed.startsWith("### ") || trimmed.startsWith("#### ")) {
      paras.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_3,
          spacing: { before: 160, after: 80 },
          children: runsToText(
            parseInline(trimmed.replace(/^#{3,4}\s+/, "")),
            24
          ),
        })
      );
      continue;
    }

    if (/^[-*•]\s+/.test(trimmed)) {
      paras.push(
        new Paragraph({
          bullet: { level: 0 },
          spacing: { after: 60 },
          children: runsToText(
            parseInline(trimmed.replace(/^[-*•]\s+/, "")),
            22
          ),
        })
      );
      continue;
    }

    paras.push(
      new Paragraph({
        spacing: { after: 80 },
        children: runsToText(parseInline(trimmed), 22),
      })
    );
  }

  return paras;
}

export async function markdownToDocxBuffer(
  md: string,
  title?: string
): Promise<Buffer> {
  const children = mdLinesToParagraphs(md);
  if (title) {
    children.unshift(
      new Paragraph({
        alignment: AlignmentType.LEFT,
        spacing: { after: 200 },
        children: [
          new TextRun({ text: title, bold: true, size: 16, color: "666666" }),
        ],
      })
    );
  }

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: { top: 720, bottom: 720, left: 720, right: 720 },
          },
        },
        children,
      },
    ],
  });

  return Buffer.from(await Packer.toBuffer(doc));
}
