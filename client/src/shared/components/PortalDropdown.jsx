/**
 * PortalDropdown — escapes overflow:hidden/auto stacking contexts.
 *
 * Renders children into document.body via React Portal with position:fixed
 * coordinates derived from anchorRef.getBoundingClientRect().
 *
 * Use this whenever a dropdown inside a table cell, card, or modal gets
 * clipped by an ancestor with overflow:hidden or overflow:auto.
 *
 * Props
 * ─────
 * anchorRef   React ref attached to the element the dropdown anchors to
 * open        boolean — whether the dropdown is visible
 * children    dropdown content
 * minWidth    number  — minimum pixel width (default 0 = match anchor width)
 * maxHeight   number  — CSS max-height passed to the inner wrapper (default 260)
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export default function PortalDropdown({ anchorRef, open, children, minWidth = 0, maxHeight = 260 }) {
  const [pos, setPos] = useState(null);
  const rafRef = useRef(null);

  useEffect(() => {
    if (!open) { setPos(null); return; }

    // Wrap in rAF so the read (getBoundingClientRect) happens AFTER the browser
    // has committed the current paint — eliminates the forced-reflow violation
    // that occurred when reading layout synchronously inside a React state flush.
    const calc = () => {
      rafRef.current = requestAnimationFrame(() => {
        const el = anchorRef?.current;
        if (!el) return;

        const r  = el.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;

        const w = Math.max(r.width, minWidth);

        // Flip above when there's not enough space below
        const spaceBelow = vh - r.bottom - 6;
        const spaceAbove = r.top - 6;
        const flipUp     = spaceBelow < 120 && spaceAbove > spaceBelow;

        // Guard against right-edge overflow
        const rawLeft = r.left;
        const left    = Math.max(4, Math.min(rawLeft, vw - w - 8));

        setPos(
          flipUp
            ? { left, width: w, bottom: vh - r.top + 2, top: undefined, maxHeight: Math.min(maxHeight, spaceAbove) }
            : { left, width: w, top: r.bottom + 2,       bottom: undefined, maxHeight: Math.min(maxHeight, spaceBelow) }
        );
      });
    };

    calc();

    // Recalculate on any scroll (capture = catches scrolls inside tables/modals)
    window.addEventListener('scroll', calc, true);
    window.addEventListener('resize', calc);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      window.removeEventListener('scroll', calc, true);
      window.removeEventListener('resize', calc);
    };
  }, [open, anchorRef, minWidth, maxHeight]);

  if (!open || !pos) return null;

  const { top, bottom, left, width, maxHeight: mh } = pos;

  return createPortal(
    <div
      style={{
        position:  'fixed',
        zIndex:    9999,
        top:       top    !== undefined ? top    : 'auto',
        bottom:    bottom !== undefined ? bottom : 'auto',
        left,
        width,
        maxHeight: mh,
        overflowY: 'auto',
        background:   '#fff',
        border:       '1px solid #D4E8DC',
        borderRadius: 6,
        boxShadow:    '0 8px 28px rgba(0,0,0,.16), 0 2px 6px rgba(0,0,0,.08)',
      }}
    >
      {children}
    </div>,
    document.body
  );
}
