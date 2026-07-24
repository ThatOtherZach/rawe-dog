import JSZip from "jszip";
import { markdownToPdfBuffer } from "./pdf";
import { markdownToDocxBuffer } from "./docx";
import { cleanDocumentMarkdown, slugifyFilename } from "../clean-md";
import type { ApplicationKit } from "../parse-kit";

export type KitDocKey = "resume" | "cover" | "alignment" | "star";

export function kitDocs(kit: ApplicationKit): {
  key: KitDocKey;
  label: string;
  markdown: string;
  formats: ("md" | "pdf" | "docx")[];
}[] {
  const docs: {
    key: KitDocKey;
    label: string;
    markdown: string;
    formats: ("md" | "pdf" | "docx")[];
  }[] = [
    {
      key: "resume",
      label: "Resume",
      markdown: cleanDocumentMarkdown(kit.resumeMarkdown),
      formats: ["md", "pdf", "docx"],
    },
    {
      key: "cover",
      label: "Cover_Letter",
      markdown: cleanDocumentMarkdown(kit.coverLetterMarkdown),
      formats: ["md", "pdf", "docx"],
    },
    {
      key: "alignment",
      label: "Alignment_Notes",
      markdown: cleanDocumentMarkdown(kit.alignmentNotesMarkdown),
      formats: ["md"],
    },
    {
      key: "star",
      label: "STAR_Prep",
      markdown: cleanDocumentMarkdown(kit.starPrepMarkdown),
      formats: ["md"],
    },
  ];
  return docs.filter((d) => d.markdown.trim().length > 0);
}

export async function buildKitZip(
  kit: ApplicationKit,
  baseName?: string
): Promise<Buffer> {
  const zip = new JSZip();
  const company = slugifyFilename(
    kit.meta.company || kit.meta.targetTitle || "application",
    "application"
  );
  const prefix = baseName || company;

  for (const doc of kitDocs(kit)) {
    const stem = `${prefix}_${doc.label}`;
    if (doc.formats.includes("md")) {
      zip.file(`${stem}.md`, doc.markdown);
    }
    if (doc.formats.includes("pdf")) {
      zip.file(
        `${stem}.pdf`,
        await markdownToPdfBuffer(doc.markdown, doc.label)
      );
    }
    if (doc.formats.includes("docx")) {
      zip.file(
        `${stem}.docx`,
        await markdownToDocxBuffer(doc.markdown, doc.label)
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
