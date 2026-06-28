"use client";

import Link from "next/link";
import { motion } from "motion/react";
import type { Product } from "@/lib/products";
import { currency } from "@/lib/products";

export function ProductCard({ product, index = 0 }: { product: Product; index?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.8, delay: (index % 3) * 0.08, ease: [0.16, 1, 0.3, 1] }}
    >
      <Link href={`/product/${product.slug}`} className="group block" data-cursor>
        <div className="relative aspect-[4/5] overflow-hidden bg-onyx-soft">
          {/* Procedural gem-lit backdrop */}
          <div
            className="absolute inset-0 transition-transform duration-[1.4s] ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-105"
            style={{
              background: `radial-gradient(120% 90% at 50% 18%, ${product.gem}22 0%, transparent 55%), radial-gradient(80% 60% at 70% 80%, #c9a96a18 0%, transparent 60%), #14120f`,
            }}
          />
          {/* The "jewel" */}
          <div className="absolute inset-0 flex items-center justify-center">
            <div
              className="h-28 w-28 rotate-45 rounded-[28%] opacity-80 shadow-[0_0_60px_-10px] transition-all duration-700 group-hover:rotate-[55deg] group-hover:opacity-100"
              style={{
                background: `linear-gradient(135deg, ${product.gem} 0%, #ffffff 35%, ${product.gem} 60%, #8a8170 100%)`,
                color: product.gem,
              }}
            />
          </div>
          <div className="absolute left-5 top-5">
            <span className="eyebrow">{product.collection}</span>
          </div>
          <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-onyx/90 to-transparent px-5 pb-5 pt-12 opacity-0 transition-opacity duration-500 group-hover:opacity-100">
            <span className="text-[0.72rem] uppercase tracking-[0.16em] text-cream">
              View piece
            </span>
            <span className="text-[0.72rem] uppercase tracking-[0.16em] text-champagne">
              →
            </span>
          </div>
        </div>
        <div className="mt-5 flex items-baseline justify-between gap-4">
          <h3 className="display text-xl text-ivory">{product.name}</h3>
          <span className="text-sm text-stone">{currency(product.price)}</span>
        </div>
        <p className="mt-1 text-[0.8rem] text-stone">
          {product.metal} · {product.carat}
        </p>
      </Link>
    </motion.div>
  );
}
