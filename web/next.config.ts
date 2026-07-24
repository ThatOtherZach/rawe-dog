import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdfkit", "pdf-parse", "openai"],
};

export default nextConfig;
