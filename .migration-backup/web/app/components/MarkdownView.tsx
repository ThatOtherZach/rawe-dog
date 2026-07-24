"use client";

import { useMemo } from "react";
import { marked } from "marked";

marked.setOptions({
  gfm: true,
  breaks: true,
});

/** Render markdown to HTML for Alignment / STAR prep preview. */
export function MarkdownView({ source }: { source: string }) {
  const html = useMemo(() => {
    if (!source.trim()) return "<p><em>No content</em></p>";
    return marked.parse(source, { async: false }) as string;
  }, [source]);

  return (
    <div
      className="md-render"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
