"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import { useCart } from "@/lib/cart";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/collections", label: "Collections" },
  { href: "/atelier", label: "Atelier" },
  { href: "/journal", label: "Journal" },
  { href: "/contact", label: "Contact" },
];

export function Header() {
  const [scrolled, setScrolled] = useState(false);
  const [mobile, setMobile] = useState(false);
  const count = useCart((s) => s.lines.reduce((n, l) => n + l.qty, 0));
  const setOpen = useCart((s) => s.setOpen);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-[60] transition-all duration-500",
        scrolled
          ? "bg-onyx/80 py-4 backdrop-blur-md"
          : "bg-transparent py-7",
      )}
    >
      <div className="mx-auto flex max-w-[1400px] items-center justify-between px-6 lg:px-10">
        {/* Left nav (desktop) */}
        <nav className="hidden flex-1 items-center gap-9 md:flex">
          {NAV.slice(0, 2).map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className="link-reveal text-[0.78rem] uppercase tracking-[0.18em] text-cream/80 hover:text-ivory"
            >
              {n.label}
            </Link>
          ))}
        </nav>

        {/* Wordmark */}
        <Link
          href="/"
          className="flex-1 text-center md:flex-none"
          aria-label="Harene home"
        >
          <span className="display text-2xl tracking-[0.3em] text-ivory lg:text-[1.7rem]">
            HARENE
          </span>
        </Link>

        {/* Right nav + cart (desktop) */}
        <div className="hidden flex-1 items-center justify-end gap-9 md:flex">
          {NAV.slice(2).map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className="link-reveal text-[0.78rem] uppercase tracking-[0.18em] text-cream/80 hover:text-ivory"
            >
              {n.label}
            </Link>
          ))}
          <button
            onClick={() => setOpen(true)}
            className="link-reveal text-[0.78rem] uppercase tracking-[0.18em] text-cream/80 hover:text-ivory"
          >
            Cart ({count})
          </button>
        </div>

        {/* Mobile controls */}
        <div className="flex items-center gap-5 md:hidden">
          <button
            onClick={() => setOpen(true)}
            className="text-[0.72rem] uppercase tracking-[0.16em] text-cream/80"
          >
            ({count})
          </button>
          <button onClick={() => setMobile(true)} aria-label="Open menu">
            <Menu className="h-5 w-5 text-ivory" />
          </button>
        </div>
      </div>

      {/* Mobile overlay menu */}
      {mobile && (
        <div className="fixed inset-0 z-[70] flex flex-col bg-onyx px-6 py-7 md:hidden">
          <div className="flex items-center justify-between">
            <span className="display text-2xl tracking-[0.3em]">HARENE</span>
            <button onClick={() => setMobile(false)} aria-label="Close menu">
              <X className="h-6 w-6 text-ivory" />
            </button>
          </div>
          <nav className="mt-16 flex flex-col gap-7">
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                onClick={() => setMobile(false)}
                className="display text-4xl text-ivory"
              >
                {n.label}
              </Link>
            ))}
          </nav>
        </div>
      )}
    </header>
  );
}
