import { Link, useLocation } from "wouter";

const links = [
  { href: "/", label: "Generate" },
  { href: "/library", label: "Library" },
  { href: "/settings", label: "Settings" },
];

export function Nav() {
  const [pathname] = useLocation();
  return (
    <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-5">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--panel-2)] text-sm font-bold text-[var(--accent)]">
          RD
        </div>
        <div>
          <div className="text-sm font-semibold tracking-wide">RAWE Dog</div>
          <div className="text-xs text-[var(--muted)]">
            Job paste → tailored application kit
          </div>
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
      </nav>
    </header>
  );
}
