export default function AboutPage() {
  return (
    <div className="mt-8 space-y-6">
      <section className="panel p-5">
        <h1 className="mb-1 text-xl font-semibold">Support RAWE Dog</h1>
        <p className="mb-4 text-sm text-[var(--muted)]">
          If this framework actually helps you land interviews or makes your job search less
          soul-crushing, and you feel like throwing some crypto my way, here's an Ethereum address:
        </p>
        <div className="flex items-center gap-3 rounded-lg border border-[var(--border)] bg-[#0c0e13] px-4 py-3">
          <code className="flex-1 break-all font-mono text-sm text-[var(--accent)]">
            0xC300A97f4ce2f9D4B02106045374c4C5eDb349af
          </code>
          <button
            className="btn shrink-0"
            onClick={() =>
              void navigator.clipboard.writeText("0xC300A97f4ce2f9D4B02106045374c4C5eDb349af")
            }
          >
            Copy
          </button>
        </div>
        <p className="mt-4 text-sm text-[var(--muted)]">
          No pressure. This is free and open source. Use it, improve it, share it.
        </p>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Thanks for being the kind of person who values good tools over free ones.
        </p>
        <p className="mt-4 text-sm font-medium text-[var(--text)]">Go get&apos;em!</p>
      </section>
    </div>
  );
}
