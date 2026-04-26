'use client';

import * as React from 'react';

export function PaginationBar({ page, totalPages, totalItems, itemsPerPage, itemLabel = 'hotels', onPage, onPerPage }: {
  page: number;
  totalPages: number;
  totalItems: number;
  itemsPerPage: number;
  itemLabel?: string;
  onPage: (p: number) => void;
  onPerPage: (n: number) => void;
}) {
  if (totalItems === 0) return null;
  return (
    <div className="d-flex align-items-center gap-3 flex-wrap">
      <div className="d-flex align-items-center gap-2">
        <label className="form-label mb-0 text-nowrap small">{itemLabel[0].toUpperCase() + itemLabel.slice(1)}/page:</label>
        <select className="form-select form-select-sm" style={{ width: 80 }} value={itemsPerPage} onChange={e => onPerPage(Number(e.target.value))}>
          {[5, 10, 25, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
        </select>
      </div>
      <div className="d-flex align-items-center gap-1">
        <button className="btn btn-outline-secondary btn-sm" disabled={page <= 1} onClick={() => onPage(1)}>«</button>
        <button className="btn btn-outline-secondary btn-sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>‹</button>
        <span className="small px-2">Page {page} of {totalPages} <span className="text-muted">({totalItems} {itemLabel})</span></span>
        <button className="btn btn-outline-secondary btn-sm" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>›</button>
        <button className="btn btn-outline-secondary btn-sm" disabled={page >= totalPages} onClick={() => onPage(totalPages)}>»</button>
      </div>
    </div>
  );
}
