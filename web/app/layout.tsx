import type { Metadata } from "next";
import "./globals.css";
import { Nav } from "./components/Nav";

export const metadata: Metadata = {
  title: "RAWE Dog — Application Kit",
  description:
    "Paste a job posting, ground it in your Master Profile and experience files, generate a tailored resume kit via xAI.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <Nav />
        <main className="mx-auto w-full max-w-6xl px-4 pb-16">{children}</main>
      </body>
    </html>
  );
}
