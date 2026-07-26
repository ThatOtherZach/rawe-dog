import JSZip from "jszip";
import { markdownToPdfBuffer } from "./pdf.js";
import { markdownToDocxBuffer } from "./docx.js";
import { cleanDocumentMarkdown, slugifyFilename } from "../clean-md.js";
import type { ApplicationKit } from "../parse-kit.js";

type KitDoc = {
  label: string;
  markdown: string;
  formats: ("md" | "pdf" | "docx")[];
};

function kitDocs(kit: ApplicationKit): KitDoc[] {
  return [
    {
      label: "Resume",
      markdown: kit.resumeMarkdown,
      formats: ["md", "pdf", "docx"],
    },
    {
      label: "Cover_Letter",
      markdown: kit.coverLetterMarkdown,
      formats: ["md", "pdf", "docx"],
    },
    {
      label: "Alignment",
      markdown: kit.alignmentNotesMarkdown,
      formats: ["md"],
    },
    {
      label: "STAR_Prep",
      markdown: kit.starPrepMarkdown,
      formats: ["md"],
    },
  ].filter((d) => d.markdown.trim().length > 0) as KitDoc[];
}

export async function buildKitZip(
  kit: ApplicationKit,
  baseName?: string,
  opts?: { includePdf?: boolean }
): Promise<Buffer> {
  const includePdf = opts?.includePdf ?? true;
  const zip = new JSZip();
  const company = slugifyFilename(
    kit.meta.company || kit.meta.targetTitle || "application",
    "application"
  );
  const prefix = baseName || company;

  for (const doc of kitDocs(kit)) {
    const md = cleanDocumentMarkdown(doc.markdown);
    const stem = `${prefix}_${doc.label}`;
    if (doc.formats.includes("md")) {
      zip.file(`${stem}.md`, md);
    }
    if (includePdf && doc.formats.includes("pdf")) {
      zip.file(
        `${stem}.pdf`,
        await markdownToPdfBuffer(md, doc.label)
      );
    }
    if (doc.formats.includes("docx")) {
      zip.file(
        `${stem}.docx`,
        await markdownToDocxBuffer(md, doc.label)
      );
    }
  }

  zip.file(
    `${prefix}_meta.json`,
    JSON.stringify(
      {
        ...kit.meta,
        generatedAt: new Date().toISOString(),
        generator: "RAWE Dog",
      },
      null,
      2
    )
  );

  return Buffer.from(await zip.generateAsync({ type: "nodebuffer" }));
}
