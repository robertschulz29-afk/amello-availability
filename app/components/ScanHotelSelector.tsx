'use client';

import * as React from 'react';
import { HotelCombobox } from '@/app/components/HotelCombobox';

type Hotel = { id: number; name: string; code: string; brand?: string };

type Props = {
  hotels: Hotel[];
  loading: boolean;
  loadError?: string | null;
  selectedIds: number[];
  onChange: (ids: number[]) => void;
};

export const ScanHotelSelector = React.memo(function ScanHotelSelector({ hotels, loading, loadError, selectedIds, onChange }: Props) {
  return (
    <div>
      <label className="form-label">Hotels to Scan</label>

      {loadError ? (
        <div className="text-danger small">{loadError}</div>
      ) : loading ? (
        <button type="button" className="btn btn-outline-secondary w-100 text-start" disabled>
          Loading hotels…
        </button>
      ) : (
        <>
          <HotelCombobox hotels={hotels} selectedIds={selectedIds} onChange={onChange} />
          {selectedIds.length === 0 && (
            <div className="text-danger small">Select at least one hotel to scan.</div>
          )}
        </>
      )}
    </div>
  );
});
