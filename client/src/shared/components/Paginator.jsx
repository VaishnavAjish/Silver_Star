/**
 * Paginator — numbered page navigation (1 2 3 … n)
 *
 * Props:
 *   page       {number}   current page (1-based)
 *   totalPages {number}   total number of pages
 *   onPage     {function} called with new page number when user clicks
 *
 * Usage:
 *   <Paginator page={page} totalPages={totalPages} onPage={setPage} />
 */
export default function Paginator({ page, totalPages, onPage }) {
  if (!totalPages || totalPages <= 1) return null;

  const pages = buildPageList(page, totalPages);

  return (
    <div className="paginator">
      {/* ← Prev */}
      <button
        type="button"
        className="paginator-btn paginator-arrow"
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
        aria-label="Previous page"
      >
        ‹
      </button>

      {/* Page numbers */}
      {pages.map((p, i) =>
        p === '…' ? (
          <span key={`ellipsis-${i}`} className="paginator-ellipsis">…</span>
        ) : (
          <button
            key={p}
            type="button"
            className={`paginator-btn${p === page ? ' paginator-active' : ''}`}
            onClick={() => onPage(p)}
            aria-current={p === page ? 'page' : undefined}
          >
            {p}
          </button>
        )
      )}

      {/* → Next */}
      <button
        type="button"
        className="paginator-btn paginator-arrow"
        disabled={page >= totalPages}
        onClick={() => onPage(page + 1)}
        aria-label="Next page"
      >
        ›
      </button>
    </div>
  );
}

/**
 * Builds the list of page numbers to show, inserting '…' for large gaps.
 * E.g. for page=6, totalPages=20:  [1, '…', 4, 5, 6, 7, 8, '…', 20]
 */
function buildPageList(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

  const pages = new Set([1, total]);
  for (let d = -2; d <= 2; d++) {
    const p = current + d;
    if (p >= 1 && p <= total) pages.add(p);
  }

  const sorted = [...pages].sort((a, b) => a - b);
  const result = [];
  let prev = 0;
  for (const p of sorted) {
    if (p - prev > 1) result.push('…');
    result.push(p);
    prev = p;
  }
  return result;
}
