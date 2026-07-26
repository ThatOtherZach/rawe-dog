import { Link, useLocation } from "wouter";
import { XpNavButton } from "./XpWidget";

const links = [
  { href: "/", label: "Generate" },
  { href: "/postings", label: "Postings" },
  { href: "/library", label: "Library" },
  { href: "/settings", label: "Settings" },
];

export function Nav() {
  const [pathname] = useLocation();
  return (
    <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-5">
      <div className="flex items-center gap-3">
        <img src="/logo-mark.svg" alt="RAWE Dog" className="h-9 w-9" />
        <div>
          <div className="text-sm font-semibold tracking-wide">RAWE-DOG</div>
          <div className="text-xs text-[var(--muted)]">Resume And Work Experience - Document Output Generator</div>
        </div>
      </div>
      <nav className="flex items-center gap-1">
        {links.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="nav-link"
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
    </header>
  );
}
