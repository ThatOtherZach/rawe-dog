import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const base = process.env.BASE_URL || "http://localhost:3000";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const md = `# Zachary Jordan, Business Systems Analyst

vancouver@example.com | +1 647-000-0000 | Vancouver, Canada

## Experience

### TD Securities, Business Systems Analyst IV

- Partnered with stakeholders on requirements and **UAT** coordination
- Designed test cases and tracked delivery in **Jira**
- Documented production readiness for enterprise releases

### Industrious CRM, Salesforce Consultant

- Built Salesforce feedback app used in client UAT
- Delivered multilingual training and admin configuration

## Certifications

- Salesforce Certified Administrator
- Salesforce Certified Data Architect

## Education

**Advanced Diploma, Centennial College**
`;

const res = await fetch(`${base}/api/export`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    markdown: md,
    format: "pdf",
    filename: "test_resume",
    title: "Test Resume",
  }),
});
const buf = Buffer.from(await res.arrayBuffer());
const out = path.join(__dirname, "..", "data", "test-resume.pdf");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, buf);
console.log("status", res.status, "bytes", buf.length, "magic", buf.slice(0, 4).toString());
console.log("wrote", out);
if (!res.ok || buf.slice(0, 4).toString() !== "%PDF") process.exit(1);

// library download if any file exists
const lib = await fetch(`${base}/api/library`).then((r) => r.json());
const tpl = lib.files?.["resume-template"]?.[0];
if (tpl) {
  const d = await fetch(
    `${base}/api/library/file?slot=resume-template&id=${encodeURIComponent(tpl.id)}`
  );
  const dbuf = Buffer.from(await d.arrayBuffer());
  console.log("library download", d.status, "bytes", dbuf.length, "name", tpl.originalName);
  if (!d.ok) process.exit(1);
}

console.log("PDF + library download OK");
