const base = process.env.BASE_URL || "http://localhost:3000";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  console.log("== health ==");
  const health = await fetch(`${base}/api/health`).then((r) => r.json());
  console.log(JSON.stringify(health, null, 2));
  assert(health.ok, "health not ok");
  assert(health.settings.hasApiKey, "API key missing");
  assert(health.library.ready, "library not ready");

  console.log("\n== settings test ==");
  const test = await fetch(`${base}/api/settings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "test" }),
  }).then(async (r) => ({ status: r.status, body: await r.json() }));
  console.log(JSON.stringify(test, null, 2));
  assert(test.status === 200 && test.body.ok, "connection test failed");

  console.log("\n== pass1 ==");
  const jobPosting = `
Business Systems Analyst — Contoso Financial (Remote / Canada)

We're hiring a BSA to partner with stakeholders, write requirements, run UAT, and work in Jira/Agile.
Requirements:
- Requirements gathering and stakeholder communication
- Test case design / UAT coordination
- Jira / Agile delivery experience
- Salesforce platform familiarity is a plus
- Strong documentation skills

Nice to have: enterprise finance environment experience.
`.trim();

  const pass1Res = await fetch(`${base}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mode: "pass1",
      jobPosting,
      company: "Contoso Financial",
      targetTitle: "Business Systems Analyst",
    }),
  });
  const pass1 = await pass1Res.json();
  if (!pass1Res.ok || !pass1.ok) {
    console.error(pass1);
    process.exit(1);
  }
  console.log("pass1 stats", pass1.stats);
  console.log("leads", pass1.selection.leadExperiences);
  assert(
    pass1.stats.skippedPass1 || pass1.stats.pass1Chars < 45000,
    `pass1 still too heavy: ${pass1.stats.pass1Chars}`
  );

  console.log("\n== pass2 ==");
  const pass2Res = await fetch(`${base}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mode: "pass2",
      jobPosting,
      company: "Contoso Financial",
      targetTitle: "Business Systems Analyst",
      selection: pass1.selection,
      overrideLeads: pass1.selection.leadExperiences,
    }),
  });
  const pass2 = await pass2Res.json();
  if (!pass2Res.ok || !pass2.ok) {
    console.error(pass2);
    process.exit(1);
  }
  console.log("pass2 stats", pass2.stats);
  console.log("meta", pass2.kit.meta);
  assert(pass2.kit.resumeMarkdown?.length > 200, "resume too short");
  assert(pass2.kit.coverLetterMarkdown?.length > 100, "cover too short");
  assert(
    !/<span/i.test(pass2.kit.resumeMarkdown),
    "resume still contains HTML span"
  );

  console.log("\n== export pdf ==");
  const pdfRes = await fetch(`${base}/api/export`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      markdown: pass2.kit.resumeMarkdown,
      format: "pdf",
      filename: "smoke_resume",
      title: "Smoke Resume",
    }),
  });
  const pdfBuf = Buffer.from(await pdfRes.arrayBuffer());
  console.log("pdf status", pdfRes.status, "bytes", pdfBuf.length);
  assert(pdfRes.ok && pdfBuf.length > 1000, "pdf too small or failed");
  assert(pdfBuf.slice(0, 4).toString() === "%PDF", "not a PDF");

  console.log("\n== export docx ==");
  const docxRes = await fetch(`${base}/api/export`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      markdown: pass2.kit.resumeMarkdown,
      format: "docx",
      filename: "smoke_resume",
    }),
  });
  const docxBuf = Buffer.from(await docxRes.arrayBuffer());
  console.log("docx status", docxRes.status, "bytes", docxBuf.length);
  assert(docxRes.ok && docxBuf.length > 1000, "docx failed");
  // ZIP magic for docx
  assert(docxBuf[0] === 0x50 && docxBuf[1] === 0x4b, "docx not zip/docx");

  console.log("\n== export kit zip ==");
  const zipRes = await fetch(`${base}/api/export`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      format: "zip",
      filename: "Contoso",
      kit: pass2.kit,
    }),
  });
  const zipBuf = Buffer.from(await zipRes.arrayBuffer());
  console.log("zip status", zipRes.status, "bytes", zipBuf.length);
  assert(zipRes.ok && zipBuf.length > 2000, "zip failed");
  assert(zipBuf[0] === 0x50 && zipBuf[1] === 0x4b, "not a zip");

  console.log("\nSMOKE OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
