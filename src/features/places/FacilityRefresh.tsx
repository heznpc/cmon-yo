import { useEffect, useState } from 'react';

// Readiness belongs to the control. Updating an ancestor while a sibling
// Suspense boundary is dehydrated would discard its pending HTML.
export function FacilityRefresh({
  loading,
  refresh,
  label,
}: {
  loading: boolean;
  refresh: () => void;
  label: string;
}) {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  return (
    <button disabled={!ready || loading} onClick={refresh}>
      {label}
    </button>
  );
}
