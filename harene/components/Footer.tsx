import Link from "next/link";

export function Footer() {
  return (
    <footer className="relative border-t border-sand/15 bg-onyx-soft">
      {/* Marquee */}
      <div className="overflow-hidden border-b border-sand/10 py-6">
        <div className="marquee-track">
          {Array.from({ length: 2 }).map((_, i) => (
            <span
              key={i}
              className="display text-[3.5rem] italic text-cream/10 lg:text-[5rem]"
            >
              Harene&nbsp;·&nbsp;Cut from light&nbsp;·&nbsp;Set by hand&nbsp;·&nbsp;Harene&nbsp;·&nbsp;Cut from light&nbsp;·&nbsp;Set by hand&nbsp;·&nbsp;
            </span>
          ))}
        </div>
      </div>

      <div className="mx-auto grid max-w-[1400px] gap-12 px-6 py-16 md:grid-cols-4 lg:px-10">
        <div className="md:col-span-2">
          <span className="display text-3xl tracking-[0.3em]">HARENE</span>
          <p className="mt-5 max-w-sm text-sm leading-relaxed text-stone">
            A high jewellery maison. Each piece is drawn by hand, cut from
            responsibly sourced stones, and set in our atelier — made to be worn
            for a lifetime and passed beyond it.
          </p>
        </div>

        <div>
          <p className="eyebrow">House</p>
          <ul className="mt-5 space-y-3 text-sm text-cream/70">
            <li>
              <Link href="/collections" className="link-reveal">
                Collections
              </Link>
            </li>
            <li>
              <Link href="/atelier" className="link-reveal">
                The Atelier
              </Link>
            </li>
            <li>
              <Link href="/journal" className="link-reveal">
                Journal
              </Link>
            </li>
            <li>
              <Link href="/contact" className="link-reveal">
                Contact
              </Link>
            </li>
          </ul>
        </div>

        <div>
          <p className="eyebrow">Client Care</p>
          <ul className="mt-5 space-y-3 text-sm text-cream/70">
            <li>Book an appointment</li>
            <li>Bespoke commissions</li>
            <li>Care &amp; repair</li>
            <li>+1 (212) 555 0147</li>
          </ul>
        </div>
      </div>

      <div className="mx-auto flex max-w-[1400px] flex-col items-start justify-between gap-3 border-t border-sand/10 px-6 py-6 text-[0.72rem] uppercase tracking-[0.16em] text-stone md:flex-row md:items-center lg:px-10">
        <span>© {new Date().getFullYear()} Maison Harene</span>
        <span>New York · Paris · Tokyo</span>
        <span>Crafted with intention</span>
      </div>
    </footer>
  );
}
