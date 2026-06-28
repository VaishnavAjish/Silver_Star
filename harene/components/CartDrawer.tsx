"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { X, Minus, Plus } from "lucide-react";
import { useCart } from "@/lib/cart";
import { currency } from "@/lib/products";

export function CartDrawer() {
  const { lines, open, setOpen, setQty, remove, subtotal } = useCart();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Avoid hydration mismatch from persisted store
  const items = mounted ? lines : [];
  const total = mounted ? subtotal() : 0;

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-[90] bg-onyx/70 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setOpen(false)}
          />
          <motion.aside
            className="fixed right-0 top-0 z-[91] flex h-full w-full max-w-md flex-col border-l border-sand/15 bg-onyx-soft"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="flex items-center justify-between border-b border-sand/15 px-7 py-6">
              <span className="eyebrow">Your selection</span>
              <button onClick={() => setOpen(false)} aria-label="Close cart">
                <X className="h-5 w-5 text-cream" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-7">
              {items.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center text-center">
                  <p className="display text-2xl text-cream">Nothing chosen yet</p>
                  <p className="mt-2 max-w-xs text-sm text-stone">
                    Pieces you select will gather here.
                  </p>
                  <Link
                    href="/collections"
                    onClick={() => setOpen(false)}
                    className="mt-7 border border-champagne/50 px-7 py-3 text-[0.72rem] uppercase tracking-[0.18em] text-champagne transition-colors hover:bg-champagne hover:text-onyx"
                  >
                    Explore collections
                  </Link>
                </div>
              ) : (
                <ul className="divide-y divide-sand/10 py-2">
                  {items.map((l) => (
                    <li key={l.slug} className="flex gap-4 py-5">
                      <div
                        className="h-20 w-16 shrink-0"
                        style={{
                          background: `radial-gradient(80% 80% at 50% 30%, ${l.gem}33, transparent), #14120f`,
                        }}
                      />
                      <div className="flex flex-1 flex-col">
                        <div className="flex justify-between gap-2">
                          <span className="display text-lg leading-tight text-ivory">
                            {l.name}
                          </span>
                          <button
                            onClick={() => remove(l.slug)}
                            className="text-[0.68rem] uppercase tracking-[0.14em] text-stone hover:text-bordeaux"
                          >
                            Remove
                          </button>
                        </div>
                        <span className="mt-0.5 text-xs text-stone">{l.metal}</span>
                        <div className="mt-auto flex items-center justify-between pt-3">
                          <div className="flex items-center gap-3 border border-sand/20 px-2 py-1">
                            <button
                              onClick={() => setQty(l.slug, l.qty - 1)}
                              aria-label="Decrease"
                            >
                              <Minus className="h-3.5 w-3.5 text-cream" />
                            </button>
                            <span className="w-5 text-center text-sm">{l.qty}</span>
                            <button
                              onClick={() => setQty(l.slug, l.qty + 1)}
                              aria-label="Increase"
                            >
                              <Plus className="h-3.5 w-3.5 text-cream" />
                            </button>
                          </div>
                          <span className="text-sm text-cream">
                            {currency(l.price * l.qty)}
                          </span>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {items.length > 0 && (
              <div className="border-t border-sand/15 px-7 py-6">
                <div className="flex items-baseline justify-between">
                  <span className="eyebrow">Subtotal</span>
                  <span className="display text-2xl text-ivory">
                    {currency(total)}
                  </span>
                </div>
                <p className="mt-1 text-[0.72rem] text-stone">
                  Taxes &amp; insured shipping calculated at checkout.
                </p>
                <Link
                  href="/cart"
                  onClick={() => setOpen(false)}
                  className="mt-5 block bg-champagne py-4 text-center text-[0.72rem] uppercase tracking-[0.2em] text-onyx transition-colors hover:bg-ivory"
                >
                  Proceed to checkout
                </Link>
              </div>
            )}
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
