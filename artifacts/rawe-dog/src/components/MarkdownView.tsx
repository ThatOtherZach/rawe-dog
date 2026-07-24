import { useMemo } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";

marked.setOptions({
  gfm: true,
  breaks: true,
});

/** Render markdown to sanitized HTML for Alignment / STAR prep preview. */
export function MarkdownView({ source }: { source: string }) {
  const html = useMemo(() => {
    if (!source.trim()) return "<p><em>No content</em></p>";
    const raw = marked.parse(source, { async: false }) as string;
    // Sanitize to prevent XSS from LLM output or user-supplied content
    return DOMPurify.sanitize(raw, {
      USE_PROFILES: { html: true },
      FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form"],
      FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover", "onfocus", "onblur", "onchange", "onsubmit"],
    });
  }, [source]);

  return (
    <div
      className="md-render"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
