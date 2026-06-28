import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { HeroCanvas } from "@/components/three/HeroCanvas";
import { ProductCard } from "@/components/ProductCard";
import { Reveal } from "@/components/Reveal";
import { COLLECTIONS, PRODUCTS } from "@/lib/products";

export default function Home() {
  const featured = PRODUCTS.slice(0, 3);

  return (
    <>
      {/* ----------------------------------------------------------- HERO */}
      <section className="relative h-[100svh] w-full overflow-hidden">
        <div className="absolute inset-0">
          <HeroCanvas />
        </div>
        {/* vignette */}
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_120%_at_50%_40%,transparent_40%,rgba(12,11,10,0.85)_100%)]" />

        <div className="relative z-10 flex h-full flex-col justify-between px-6 pb-16 pt-32 lg:px-10">
          <div className="mx-auto w-full max-w-[1400px]">
            <Reveal>
              <span className="eyebrow">High Jewellery · Maison Harene</span>
            </Reveal>
          </div>

          <div className="mx-auto w-full max-w-[1400px]">
            <div className="max-w-3xl">
              <Reveal delay={0.1}>
                <h1 className="display text-[3.4rem] leading-[0.92] text-ivory sm:text-[5rem] lg:text-[7rem]">
                  Cut from
                  <br />
                  <span className="italic text-champagne">light</span>, set by
                  hand.
                </h1>
              </Reveal>
              <Reveal delay={0.25}>
                <p className="mt-8 max-w-md text-base leading-relaxed text-cream/80">
                  Rings, necklaces, earrings and bracelets — each piece drawn,
                  cut and finished in our atelier. Jewellery made to be worn for
                  a lifetime, and passed beyond it.
                </p>
              </Reveal>
              <Reveal delay={0.4}>
                <div className="mt-10 flex flex-wrap items-center gap-5">
                  <Link
                    href="/collections"
                    className="group flex items-center gap-3 bg-ivory px-8 py-4 text-[0.74rem] uppercase tracking-[0.2em] text-onyx transition-colors hover:bg-champagne"
                  >
                    Explore collections
                    <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                  </Link>
                  <Link
                    href="/atelier"
                    className="link-reveal text-[0.74rem] uppercase tracking-[0.2em] text-cream"
                  >
                    The Atelier
                  </Link>
                </div>
              </Reveal>
            </div>
          </div>
        </div>

        <div className="absolute bottom-8 right-6 z-10 hidden items-center gap-3 text-[0.66rem] uppercase tracking-[0.2em] text-stone lg:flex lg:right-10">
          <span className="h-px w-10 bg-stone" />
          Scroll to discover
        </div>
      </section>

      {/* --------------------------------------------------- INTRODUCTION */}
      <section className="border-y border-sand/12 bg-onyx px-6 py-28 lg:px-10">
        <div className="mx-auto grid max-w-[1400px] gap-12 md:grid-cols-12">
          <div className="md:col-span-5">
            <Reveal>
              <span className="eyebrow">Est. in pursuit of permanence</span>
            </Reveal>
          </div>
          <div className="md:col-span-7">
            <Reveal delay={0.1}>
              <p className="display text-[1.8rem] leading-[1.25] text-cream lg:text-[2.6rem]">
                We believe a jewel should hold more than light. It should hold a
                moment — and return it, undimmed, every time it is worn.
              </p>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------- COLLECTIONS */}
      <section className="bg-onyx px-6 py-28 lg:px-10">
        <div className="mx-auto max-w-[1400px]">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <Reveal>
              <div>
                <span className="eyebrow">The Collections</span>
                <h2 className="display mt-4 text-5xl text-ivory lg:text-7xl">
                  Four houses of light
                </h2>
              </div>
            </Reveal>
            <Reveal delay={0.1}>
              <Link
                href="/collections"
                className="link-reveal text-[0.74rem] uppercase tracking-[0.2em] text-champagne"
              >
                View all pieces
              </Link>
            </Reveal>
          </div>

          <div className="mt-16 grid gap-px overflow-hidden border border-sand/12 bg-sand/12 md:grid-cols-2 lg:grid-cols-4">
            {COLLECTIONS.map((c, i) => (
              <Reveal key={c.slug} delay={i * 0.08}>
                <Link
                  href={`/collections/${c.slug}`}
                  className="group flex h-full min-h-[22rem] flex-col justify-between bg-onyx p-8 transition-colors duration-500 hover:bg-onyx-soft"
                  data-cursor
                >
                  <div>
                    <span className="display text-6xl text-champagne/30 transition-colors duration-500 group-hover:text-champagne/70">
                      0{i + 1}
                    </span>
                  </div>
                  <div>
                    <span className="eyebrow">{c.tagline}</span>
                    <h3 className="display mt-3 text-3xl text-ivory">{c.name}</h3>
                    <p className="mt-3 text-sm leading-relaxed text-stone">
                      {c.description}
                    </p>
                    <span className="mt-5 inline-flex items-center gap-2 text-[0.7rem] uppercase tracking-[0.18em] text-cream/70 transition-colors group-hover:text-champagne">
                      Discover <ArrowRight className="h-3.5 w-3.5" />
                    </span>
                  </div>
                </Link>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------ FEATURED PIECES */}
      <section className="bg-onyx-soft px-6 py-28 lg:px-10">
        <div className="mx-auto max-w-[1400px]">
          <Reveal>
            <span className="eyebrow">Recently to the salon</span>
            <h2 className="display mt-4 max-w-2xl text-5xl text-ivory lg:text-6xl">
              Pieces chosen for this season
            </h2>
          </Reveal>
          <div className="mt-16 grid gap-x-8 gap-y-14 sm:grid-cols-2 lg:grid-cols-3">
            {featured.map((p, i) => (
              <ProductCard key={p.slug} product={p} index={i} />
            ))}
          </div>
        </div>
      </section>

      {/* ----------------------------------------------------- ATELIER TEASER */}
      <section className="relative overflow-hidden bg-onyx px-6 py-32 lg:px-10">
        <div className="absolute -right-40 top-1/2 h-[40rem] w-[40rem] -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(201,169,106,0.12),transparent_65%)]" />
        <div className="mx-auto grid max-w-[1400px] items-center gap-16 md:grid-cols-2">
          <Reveal>
            <div className="aspect-[4/5] w-full bg-[radial-gradient(120%_90%_at_30%_20%,rgba(201,169,106,0.18),transparent_55%),radial-gradient(80%_60%_at_80%_90%,rgba(159,184,255,0.12),transparent_60%)] bg-onyx-soft" />
          </Reveal>
          <Reveal delay={0.15}>
            <div>
              <span className="eyebrow">Inside the Atelier</span>
              <h2 className="display mt-5 text-5xl leading-[1.05] text-ivory lg:text-6xl">
                Forty hands.
                <br />
                One jewel.
              </h2>
              <p className="mt-7 max-w-md text-base leading-relaxed text-cream/75">
                From the first graphite sketch to the final polish, a single
                Harene piece passes through the hands of designers, lapidaries,
                setters and polishers — many trained over decades. Nothing
                leaves the bench until it is beyond reproach.
              </p>
              <Link
                href="/atelier"
                className="mt-9 inline-flex items-center gap-3 border border-champagne/50 px-8 py-4 text-[0.74rem] uppercase tracking-[0.2em] text-champagne transition-colors hover:bg-champagne hover:text-onyx"
              >
                Enter the Atelier <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ---------------------------------------------------- NEWSLETTER */}
      <section className="border-t border-sand/12 bg-onyx-soft px-6 py-24 lg:px-10">
        <div className="mx-auto max-w-[1400px]">
          <div className="grid gap-12 md:grid-cols-2 md:items-end">
            <Reveal>
              <h2 className="display text-4xl leading-tight text-ivory lg:text-5xl">
                Correspondence from the maison
              </h2>
              <p className="mt-4 max-w-md text-sm leading-relaxed text-stone">
                Private viewings, new commissions and the occasional letter from
                the bench. No noise — only what is worth your attention.
              </p>
            </Reveal>
            <Reveal delay={0.1}>
              <form className="flex border-b border-sand/30 pb-3">
                <input
                  type="email"
                  required
                  placeholder="Your email address"
                  className="flex-1 bg-transparent text-sm text-ivory outline-none placeholder:text-stone"
                />
                <button
                  type="submit"
                  className="text-[0.72rem] uppercase tracking-[0.2em] text-champagne"
                >
                  Subscribe
                </button>
              </form>
            </Reveal>
          </div>
        </div>
      </section>
    </>
  );
}
