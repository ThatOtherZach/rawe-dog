import { Link, useLocation } from "wouter";
import { XpNavButton } from "./XpWidget";
import { useEffect, useState } from "react";

const links = [
  { href: "/", label: "Generate" },
  { href: "/postings", label: "Postings" },
  { href: "/library", label: "Library" },
  { href: "/settings", label: "Settings" },
];

function useGitHubStars(repo: string) {
  const [stars, setStars] = useState<number | null>(null);
  useEffect(() => {
    fetch(`https://api.github.com/repos/${repo}`, {
      headers: { Accept: "application/vnd.github+json" },
    })
      .then((r) => r.json())
      .then((d) => { if (typeof d.stargazers_count === "number") setStars(d.stargazers_count); })
      .catch(() => {});
  }, [repo]);
  return stars;
}

export function Nav() {
  const [pathname] = useLocation();
  const stars = useGitHubStars("ThatOtherZach/rawe-dog");
  return (
    <header className="mx-auto w-full max-w-6xl px-4 py-3 sm:py-5">
      {/* Single row on sm+; stacks to two rows on mobile */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex items-center gap-3">
          <img src="/logo-mark.svg" alt="RAWE Dog" className="h-8 w-8 sm:h-9 sm:w-9" />
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-semibold tracking-wide">RAWE-DOG</span>
              <a
                href="https://github.com/ThatOtherZach/rawe-dog"
                target="_blank"
                rel="noopener noreferrer"
                title="View on GitHub"
                className="flex items-center gap-1 text-[var(--muted)] opacity-60 transition hover:opacity-100"
              >
                <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor" aria-hidden="true">
                  <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
                </svg>
                {stars !== null && (
                  <span className="text-[10px] tabular-nums">
                    {stars >= 1000 ? `${(stars / 1000).toFixed(1)}k` : stars}
                  </span>
                )}
              </a>
            </div>
            <div className="hidden text-xs text-[var(--muted)] sm:block">
              Resume And Work Experience - Document Output Generator
            </div>
          </div>
        </div>
        {/* Nav wraps to its own row on mobile, filling full width */}
        <nav className="flex w-full items-center gap-0.5 sm:w-auto sm:gap-1">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="nav-link flex-1 text-center sm:flex-none"
              data-active={
                l.href === "/"
                  ? pathname === "/"
                  : pathname.startsWith(l.href)
              }
            >
              {l.label}
            </Link>
          ))}
          <XpNavButton />
        </nav>
      </div>
    </header>
  );
}
