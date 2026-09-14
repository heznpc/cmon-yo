import { useQuery } from '@tanstack/react-query';
import type { SelectHTMLAttributes } from 'react';
import { publicAPI } from '../../api/public';
import { regionsKey } from '../../contracts/place';

export function RegionSelect({
  label = '동네',
  emptyLabel = '전체',
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { label?: string; emptyLabel?: string }) {
  const query = useQuery({
    queryKey: regionsKey,
    queryFn: ({ signal }) => publicAPI.regions(signal),
    staleTime: 60_000,
    retry: false,
  });
  const selected = String(props.value ?? props.defaultValue ?? '');
  return (
    <>
      <label>
        {label}
        <select {...props}>
          <option value="">{emptyLabel}</option>
          {query.data?.regions.map((region) => (
            <option key={region.code} value={region.code}>
              {region.name}
            </option>
          ))}
          {selected && !query.data?.regions.some((region) => region.code === selected) ? (
            <option value={selected}>지역 {selected}</option>
          ) : null}
        </select>
      </label>
      {query.isError ? (
        <p role="alert">
          동네 목록을 불러오지 못했습니다.{' '}
          <button type="button" onClick={() => void query.refetch()}>
            동네 다시 조회
          </button>
        </p>
      ) : null}
    </>
  );
}
