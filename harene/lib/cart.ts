"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Product } from "./products";

export interface CartLine {
  slug: string;
  name: string;
  price: number;
  metal: string;
  gem: string;
  qty: number;
}

interface CartState {
  lines: CartLine[];
  open: boolean;
  add: (p: Product) => void;
  remove: (slug: string) => void;
  setQty: (slug: string, qty: number) => void;
  clear: () => void;
  setOpen: (open: boolean) => void;
  count: () => number;
  subtotal: () => number;
}

export const useCart = create<CartState>()(
  persist(
    (set, get) => ({
      lines: [],
      open: false,
      add: (p) =>
        set((s) => {
          const existing = s.lines.find((l) => l.slug === p.slug);
          if (existing) {
            return {
              open: true,
              lines: s.lines.map((l) =>
                l.slug === p.slug ? { ...l, qty: l.qty + 1 } : l,
              ),
            };
          }
          return {
            open: true,
            lines: [
              ...s.lines,
              {
                slug: p.slug,
                name: p.name,
                price: p.price,
                metal: p.metal,
                gem: p.gem,
                qty: 1,
              },
            ],
          };
        }),
      remove: (slug) =>
        set((s) => ({ lines: s.lines.filter((l) => l.slug !== slug) })),
      setQty: (slug, qty) =>
        set((s) => ({
          lines: s.lines
            .map((l) => (l.slug === slug ? { ...l, qty: Math.max(0, qty) } : l))
            .filter((l) => l.qty > 0),
        })),
      clear: () => set({ lines: [] }),
      setOpen: (open) => set({ open }),
      count: () => get().lines.reduce((n, l) => n + l.qty, 0),
      subtotal: () => get().lines.reduce((n, l) => n + l.qty * l.price, 0),
    }),
    { name: "harene-cart" },
  ),
);
