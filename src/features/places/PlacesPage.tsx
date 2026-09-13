import { useSearchParams } from 'react-router';
import { RegionSelect } from './RegionSelect';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Suspense, useEffect, useState } from 'react';
import {
  placeKey,
  weatherKey,
  placesKey,
  placeListKey,
  placeFiltersSchema,
  placeSourceURL,
  type Weather,
  type Place,
} from '../../contracts/place';
import { publicAPI } from '../../api/public';
import { displayDate } from '../../contracts/date';
import * as css from '../meetup/meetup.css';
import { StreamSlot } from '../../app/stream';
import { AppLink } from '../../app/navigation';
import { ProductNav } from '../../app/ProductNav';

function FacilityInfo({ place }: { place: Place }) {
  return (
    <>
      <p>
        {place.kind} · {place.address}
      </p>
      <p>
        {place.exerciseFacilities.length
          ? place.exerciseFacilities.join(' · ')
          : '운동시설 정보 미제공'}
      </p>
      <p className={css.note}>
        공공데이터 기준일 {place.sourceDate}. 현재 이용 가능 여부는 현장과 다를 수 있습니다.
      </p>
    </>
  );
}
function WeatherInfo({ weather, refreshFailed }: { weather: Weather; refreshFailed: boolean }) {
  if (weather.status === 'unavailable')
    return (
      <section aria-label="날씨">
        <h2>단기예보</h2>
        <p>날씨를 불러오지 못했습니다. 다시 시도해 주세요.</p>
      </section>
    );
  const facts = weather.facts;
  return (
    <section aria-label="날씨">
      <h2>단기예보</h2>
      <p>
        {weather.status === 'stale' || refreshFailed
          ? '날씨 갱신에 실패했습니다. 이전에 받은 예보입니다.'
          : '최근에 받은 예보입니다.'}
      </p>
      <dl>
        <dt>예보 대상 · 한국 시간</dt>
        <dd>{displayDate(facts.validAt)}</dd>
        <dt>기온</dt>
        <dd>{facts.temperatureC === null ? '정보 없음' : `${facts.temperatureC} °C`}</dd>
        <dt>강수확률</dt>
        <dd>
          {facts.precipitationProbabilityPercent === null
            ? '정보 없음'
            : `${facts.precipitationProbabilityPercent} %`}
        </dd>
        <dt>강수형태</dt>
        <dd>
          {
            { none: '없음', rain: '비', snow: '눈', mixed: '비/눈', unknown: '정보 없음' }[
              facts.precipitationType
            ]
          }
        </dd>
        <dt>풍속</dt>
        <dd>
          {facts.windSpeedMetersPerSecond === null
            ? '정보 없음'
            : `${facts.windSpeedMetersPerSecond} m/s`}
        </dd>
      </dl>
      <p className={css.note}>
        기상청 발표 {displayDate(facts.issuedAt)} · 조회 {displayDate(facts.fetchedAt)}
      </p>
    </section>
  );
}
export function PlacesPage({ id }: { id?: string }) {
  return (
    <main className={css.page}>
      <p>C'mon Yo! · 공원과 운동시설</p>
      <ProductNav />
      {id ? <PlaceDetail id={id} /> : <PlaceList />}
      <p>
        <AppLink href={placeSourceURL}>출처: 전국도시공원정보표준데이터</AppLink>
      </p>
      <AppLink href="/meetups">운동 모임 둘러보기</AppLink>
    </main>
  );
}
function PlaceList() {
  const [params, setParams] = useSearchParams();
  const parsedFilters = placeFiltersSchema.safeParse(
    Object.fromEntries([...params].filter(([, value]) => value !== '')),
  );
  const filters = parsedFilters.success ? parsedFilters.data : { page: 0 };
  const query = useQuery({
    enabled: parsedFilters.success,
    queryKey: placeListKey(filters),
    staleTime: 60_000,
    retry: false,
    queryFn: ({ signal }) => publicAPI.places(signal, filters),
  });
  return (
    <>
      <h1>공원과 운동시설</h1>
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
      <ul>
        {query.data?.places.map((place) => (
          <li key={place.id}>
            <h2>
              <AppLink href={`/places/${place.id}`}>{place.name}</AppLink>
            </h2>
            <FacilityInfo place={place} />
          </li>
        ))}
      </ul>
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
function PlaceDetail({ id }: { id: string }) {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: placeKey(id),
    staleTime: 60_000,
    retry: false,
    // The public list already contains the complete facility record. Preserve
    // its age so an old list cannot extend the detail's freshness indefinitely.
    initialData: () => {
      const place = client
        .getQueryData<{ places: Place[] }>(placesKey)
        ?.places.find((place) => place.id === id);
      return place ? { place } : undefined;
    },
    initialDataUpdatedAt: () => client.getQueryState(placesKey)?.dataUpdatedAt,
    queryFn: ({ signal }) => publicAPI.placeInfo(id, signal),
  });
  return (
    <>
      <AppLink href="/places">시설 목록으로 돌아가기</AppLink>
      {query.isError ? <p role="alert">시설을 불러오지 못했습니다. 다시 시도해 주세요.</p> : null}
      {query.data === null ? <p role="alert">시설을 찾을 수 없습니다.</p> : null}
      {query.data && query.isError ? (
        <p>이전에 불러온 정보입니다. 최신 정보를 확인하지 못했습니다.</p>
      ) : null}
      <h1>{query.data?.place.name ?? '시설 상세'}</h1>
      {query.data ? (
        <>
          <FacilityInfo place={query.data.place} />
          <div className={css.actions}>
            <AppLink href={`/meetups?placeId=${id}`}>이 장소의 모임 보기</AppLink>
            <AppLink href={`/meetups/new?placeId=${id}`}>이 장소에서 모임 만들기</AppLink>
          </div>
          <Suspense
            fallback={
              <section aria-label="날씨">
                <h2>단기예보</h2>
                <p role="status">날씨를 불러오는 중…</p>
              </section>
            }
          >
            <StreamSlot name="weather">
              {(packet) => <WeatherPanel id={id} failed={packet?.failed} />}
            </StreamSlot>
          </Suspense>
        </>
      ) : null}
      <p role="status">{query.isFetching ? '시설을 불러오는 중…' : ''}</p>
      <FacilityRefresh
        loading={query.isFetching}
        refresh={() => void query.refetch()}
        label="시설 새로고침"
      />
    </>
  );
}

function WeatherPanel({ id, failed = false }: { id: string; failed?: boolean }) {
  const query = useQuery({
    queryKey: weatherKey(id),
    staleTime: 60_000,
    retry: false,
    enabled: !failed,
    queryFn: ({ signal }) => publicAPI.weather(id, signal),
  });
  return (
    <div aria-label="날씨 상태">
      {query.data ? (
        <WeatherInfo weather={query.data.weather} refreshFailed={query.isError} />
      ) : (
        <section aria-label="날씨">
          <h2>단기예보</h2>
          <p role="status">
            {query.isFetching
              ? '날씨를 불러오는 중…'
              : '날씨를 불러오지 못했습니다. 다시 시도해 주세요.'}
          </p>
        </section>
      )}
      {query.data && query.isFetching ? <p role="status">날씨를 갱신하는 중…</p> : null}
      <button disabled={query.isFetching} onClick={() => void query.refetch()}>
        날씨 다시 조회
      </button>
    </div>
  );
}

// Hydration readiness belongs to the control. Updating an ancestor while a
// sibling Suspense boundary is dehydrated would discard its pending HTML.
function FacilityRefresh({
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
