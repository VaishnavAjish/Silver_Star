import { useState, useEffect } from 'react';

export function usePagination(items, resetDependencies = [], defaultPageSize = 1000) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(defaultPageSize);

  // Reset to page 1 when search/filter dependencies change
  useEffect(() => {
    setPage(1);
  }, resetDependencies); // eslint-disable-line react-hooks/exhaustive-deps

  // For server-side pagination, the items array already contains ONLY the current page's data.
  // We no longer slice it on the client to avoid empty pages when page > 1.
  const paginatedItems = items || [];

  // If using server-side pagination, totalPages should be provided by the server.
  // This client-side fallback is only accurate if the server returned all records at once.
  const totalPages = Math.ceil((items?.length || 0) / pageSize) || 1;

  return { page, setPage, paginatedItems, totalPages, pageSize, setPageSize };
}
