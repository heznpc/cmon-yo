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
  const [selection, setSelection] = useState({
    value,
    region: value ? regionOfPlace(value) : '',
  });
  // Draft recovery and discard can replace the value after mount. Keep the
  // filter in step with that external selection without overwriting a region
  // the user has just chosen while looking for a new facility.
  if (selection.value !== value) {
    setSelection({ value, region: value ? regionOfPlace(value) : '' });
  }
  const region = selection.value === value ? selection.region : value ? regionOfPlace(value) : '';
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
  const selectedMissing = !!value && !options.some((place) => place.id === value);
  const selected = useQuery({
    queryKey: placeKey(value),
    enabled: selectedMissing,
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
          setSelection({ value: '', region: e.target.value });
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
          onChange={(e) => {
            setSelection({ value: e.target.value, region });
            onChange(e.target.value);
          }}
        >
          <option value="">{optional ? '연결하지 않음' : '시설 선택'}</option>
          {options.map((place) => (
            <option key={place.id} value={place.id}>
              {place.name}
            </option>
          ))}
          {selectedMissing ? (
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
      {selectedMissing && selected.isError ? (
        <p role="alert">
          선택한 시설을 확인하지 못했습니다.{' '}
          <button type="button" disabled={disabled || selected.isFetching} onClick={() => void selected.refetch()}>
            선택한 시설 다시 조회
          </button>
        </p>
      ) : null}
      {selectedMissing && selected.data === null ? (
        <p role="alert">선택한 시설이 더 이상 제공되지 않습니다. 다른 시설을 선택해 주세요.</p>
      ) : null}
    </>
  );
}
