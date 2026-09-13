import { useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { publicAPI } from '../../api/public';
import { placeKey, regionOfPlace } from '../../contracts/place';
import { RegionSelect } from './RegionSelect';

export function PlacePicker({
  value,
  onChange,
  disabled,
  optional = false,
  label = '장소',
  name,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  optional?: boolean;
  label?: string;
  name?: string;
}) {
  const [region, setRegion] = useState(value ? regionOfPlace(value) : '');
  const query = useInfiniteQuery({
    queryKey: ['place-options', region],
    initialPageParam: 0,
    queryFn: ({ signal, pageParam }) =>
      publicAPI.places(signal, { regionCode: region || undefined, page: pageParam }),
    getNextPageParam: (last) => last.nextPage ?? undefined,
    staleTime: 60_000,
    retry: false,
  });
  const options = query.data?.pages.flatMap((page) => page.places) ?? [];
  const selected = useQuery({
    queryKey: placeKey(value),
    enabled: !!value && !options.some((place) => place.id === value),
    queryFn: ({ signal }) => publicAPI.placeInfo(value, signal),
    staleTime: 60_000,
    retry: false,
  });
  return (
    <>
      <RegionSelect
        label="시설 지역"
        value={region}
        disabled={disabled}
        onChange={(e) => {
          setRegion(e.target.value);
          onChange('');
        }}
      />
      <label>
        {label}
        <select
          name={name}
          required={!optional}
          disabled={disabled}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">{optional ? '연결하지 않음' : '시설 선택'}</option>
          {options.map((place) => (
            <option key={place.id} value={place.id}>
              {place.name}
            </option>
          ))}
          {value && !options.some((place) => place.id === value) ? (
            <option value={value}>{selected.data?.place.name ?? '선택한 시설'}</option>
          ) : null}
        </select>
      </label>
      {query.hasNextPage ? (
        <button
          type="button"
          disabled={disabled || query.isFetching}
          onClick={() => void query.fetchNextPage()}
        >
          시설 더 불러오기
        </button>
      ) : null}
      {query.isFetching ? <p role="status">시설을 불러오는 중…</p> : null}
      {query.isError ? (
        <p role="alert">
          시설 목록을 불러오지 못했습니다.{' '}
          <button type="button" disabled={disabled} onClick={() => void query.refetch()}>
            시설 다시 조회
          </button>
        </p>
      ) : null}
    </>
  );
}
