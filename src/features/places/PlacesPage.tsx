import { useSearchParams } from 'react-router';
import { RegionSelect } from './RegionSelect';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { placeListKey, placeFiltersSchema, placeSourceURL } from '../../contracts/place';
import { publicAPI } from '../../api/public';
import * as css from '../meetup/meetup.css';
import { AppLink } from '../../app/navigation';
import { ProductNav } from '../../app/ProductNav';
import { Icon } from '../../app/Icon';
import { FacilityMap } from './FacilityMap';
import * as mapCSS from './places.css';
import { usePlaceFavorites } from './usePlaceFavorites';
import { FacilityRefresh } from './FacilityRefresh';
import { PlaceDetail } from './PlaceDetail';
export function PlacesPage({ id }: { id?: string }) {
  return (
    <>
      <ProductNav />
      <main
        id="page-content"
        tabIndex={-1}
        className={[css.page, id ? '' : mapCSS.explorePage].join(' ')}
      >
        {id ? <PlaceDetail id={id} /> : <PlaceList />}
        <footer className={css.footer}>
          <p>선택한 동네의 공공시설 · 공개 자료에 기반한 시설 정보입니다.</p>
          <p>
            <AppLink href={placeSourceURL}>출처: 전국도시공원정보표준데이터</AppLink>
          </p>
          <AppLink href="/meetups">운동 모임 둘러보기</AppLink>
        </footer>
      </main>
    </>
  );
}
function PlaceList() {
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [deviceLocation, setDeviceLocation] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const parsedFilters = placeFiltersSchema.safeParse(
    Object.fromEntries([...params].filter(([, value]) => value !== '')),
  );
  const filters = parsedFilters.success ? parsedFilters.data : { page: 0 };
  const queryFilters =
    filters.regionCode || !deviceLocation
      ? filters
      : { ...filters, latitude: deviceLocation.latitude, longitude: deviceLocation.longitude };
  const query = useQuery({
    enabled: parsedFilters.success,
    queryKey: placeListKey(queryFilters),
    staleTime: 60_000,
    retry: false,
    queryFn: ({ signal }) => publicAPI.places(signal, queryFilters),
  });
  const visiblePlaces = useMemo(
    () =>
      (query.data?.places ?? []).filter((place) =>
        (place.name + ' ' + place.address)
          .toLocaleLowerCase()
          .includes(search.trim().toLocaleLowerCase()),
      ),
    [query.data?.places, search],
  );
  const favorites = usePlaceFavorites();
  const selected = visiblePlaces.find((place) => place.id === selectedId);
  const selectedCard = useRef<HTMLDivElement>(null);
  useEffect(() => {
    selectedCard.current?.scrollIntoView({ block: 'nearest' });
  }, [selected?.id]);
  return (
    <>
      <h1>공원과 운동시설</h1>
      <p className={css.lead}>지도에서 공원을 찾고, 함께 운동할 장소를 골라보세요.</p>
      <label className={css.search}>
        <Icon name="search" />
        <input
          type="search"
          aria-label="시설 이름·주소 검색"
          placeholder="시설 이름·주소 검색"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setSelectedId(null);
          }}
        />
      </label>
      {!parsedFilters.success ? <p role="alert">조회 조건을 확인해 주세요.</p> : null}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setParams({ regionCode: String(new FormData(e.currentTarget).get('regionCode') ?? '') });
        }}
      >
        <RegionSelect
          key={filters.regionCode ?? ''}
          name="regionCode"
          defaultValue={filters.regionCode ?? ''}
        />
        <button>시설 조건 적용</button>
      </form>
      {query.isError ? <p role="alert">시설을 불러오지 못했습니다. 다시 시도해 주세요.</p> : null}
      {query.isError && query.data ? (
        <p>이전에 불러온 목록입니다. 최신 정보를 확인하지 못했습니다.</p>
      ) : null}
      {query.data?.places.length === 0 ? <p>등록된 시설 정보가 없습니다.</p> : null}
      {favorites.message ? <p role="alert">{favorites.message}</p> : null}
      <div className={mapCSS.layout}>
        <div className={mapCSS.mapColumn}>
          {query.data?.places.length ? (
            <FacilityMap
              places={visiblePlaces}
              selectedId={selected?.id ?? null}
              onSelect={setSelectedId}
              onLocation={setDeviceLocation}
            />
          ) : null}
          {query.data?.places.length ? (
            <p className={css.note}>핀을 누르면 시설 정보와 상세 보기를 확인할 수 있습니다.</p>
          ) : null}
        </div>
        <div className={mapCSS.resultList}>
          {selected ? (
            <div
              ref={selectedCard}
              className={mapCSS.selected}
              role="region"
              aria-label="선택한 시설"
              aria-live="polite"
            >
              <span className={css.category}>{selected.kind}</span>
              <h3>{selected.name}</h3>
              <p className={css.metadata}>{selected.address}</p>
              <p className={css.metadata}>
                {selected.exerciseFacilities.join(' · ') || '운동시설 정보 미제공'}
              </p>
              <div className={mapCSS.cardActions}>
                <AppLink className={css.primary} href={`/places/${selected.id}`}>
                  시설 상세 보기
                </AppLink>
                <button
                  className={mapCSS.favorite}
                  aria-pressed={favorites.ids.has(selected.id)}
                  aria-label={favorites.ids.has(selected.id) ? '찜 해제' : '찜하기'}
                  disabled={favorites.busyId === selected.id}
                  onClick={() => void favorites.toggle(selected.id)}
                >
                  <Icon name="heart" /> {favorites.ids.has(selected.id) ? '찜 해제' : '찜하기'}
                </button>
              </div>
            </div>
          ) : null}

          <p className={css.note}>
            시설 {visiblePlaces.length}곳 · 지도 핀과 같은 검색 결과입니다.
          </p>
          <ul>
            {visiblePlaces.map((place) => (
              <li
                key={place.id}
                className={place.id === selected?.id ? mapCSS.selectedRow : undefined}
              >
                <AppLink href={`/places/${place.id}`} className={css.row} aria-label={place.name}>
                  <div className={css.rowContent}>
                    <h2 className={css.rowTitle}>{place.name}</h2>
                    <span className={css.metadata}>
                      {place.kind} · {place.address}
                    </span>
                    <span className={css.metadata}>
                      {place.exerciseFacilities.join(' · ') || '운동시설 정보 미제공'}
                    </span>
                  </div>
                  <Icon name="chevron" />
                </AppLink>
                <button
                  className={mapCSS.locate}
                  aria-label={place.name + ' 지도에서 보기'}
                  onClick={() => setSelectedId(place.id)}
                >
                  지도에서 보기
                </button>
                <button
                  className={mapCSS.favorite}
                  aria-pressed={favorites.ids.has(place.id)}
                  aria-label={
                    favorites.ids.has(place.id) ? `${place.name} 찜 해제` : `${place.name} 찜하기`
                  }
                  disabled={favorites.busyId === place.id}
                  onClick={() => void favorites.toggle(place.id)}
                >
                  <Icon name="heart" /> {favorites.ids.has(place.id) ? '찜 해제' : '찜하기'}
                </button>
              </li>
            ))}
          </ul>
          {search.trim() && query.data?.places.length && !visiblePlaces.length ? (
            <p role="status">검색한 이름·주소의 시설이 없습니다.</p>
          ) : null}
        </div>
      </div>
      <p role="status">{query.isFetching ? '시설을 불러오는 중…' : ''}</p>
      {filters.page > 0 ? (
        <AppLink
          href={
            '/places?' +
            new URLSearchParams({
              regionCode: filters.regionCode ?? '',
              page: String(filters.page - 1),
            })
          }
        >
          이전 시설 페이지
        </AppLink>
      ) : null}
      {query.data?.nextPage != null ? (
        <AppLink
          href={
            '/places?' +
            new URLSearchParams({
              regionCode: filters.regionCode ?? '',
              page: String(query.data.nextPage),
            })
          }
        >
          다음 시설 페이지
        </AppLink>
      ) : null}
      <FacilityRefresh
        loading={query.isFetching}
        refresh={() => void query.refetch()}
        label={query.isError ? '다시 시도' : '시설 새로고침'}
      />
    </>
  );
}
