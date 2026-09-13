import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import {
  placeDetailSchema,
  placeListSchema,
  placeKey,
  placesKey,
  placeSourceURL,
  type Weather,
  type Place,
} from '../../contracts/place';
import { displayDate } from '../meetup/MeetupPage';
import * as css from '../meetup/meetup.css';

async function get(path: string, signal: AbortSignal) {
  const response = await fetch(path, { signal });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('시설을 불러오지 못했습니다. 다시 시도해 주세요.');
  return response.json() as Promise<unknown>;
}
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
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(true);
  }, []);
  return (
    <main className={css.page}>
      <p>C'mon Yo! · 무안군 공공시설 파일럿</p>
      {id ? <PlaceDetail id={id} ready={ready} /> : <PlaceList ready={ready} />}
      <p>
        <a href={placeSourceURL}>출처: 전국도시공원정보표준데이터</a>
      </p>
      <a href="/meetups/11111111-1111-4111-8111-111111111111">공개 샘플 모임</a>
    </main>
  );
}
function PlaceList({ ready }: { ready: boolean }) {
  const query = useQuery({
    queryKey: placesKey,
    staleTime: 60_000,
    retry: false,
    queryFn: async ({ signal }) => placeListSchema.parse(await get('/api/v1/places', signal)),
  });
  return (
    <>
      <h1>공원과 운동시설</h1>
      {query.isError ? <p role="alert">시설을 불러오지 못했습니다. 다시 시도해 주세요.</p> : null}
      {query.isError && query.data ? (
        <p>이전에 불러온 목록입니다. 최신 정보를 확인하지 못했습니다.</p>
      ) : null}
      {query.data?.places.length === 0 ? <p>등록된 시설 정보가 없습니다.</p> : null}
      <ul>
        {query.data?.places.map((place) => (
          <li key={place.id}>
            <h2>
              <a href={`/places/${place.id}`}>{place.name}</a>
            </h2>
            <FacilityInfo place={place} />
          </li>
        ))}
      </ul>
      <p role="status">{query.isFetching ? '시설을 불러오는 중…' : ''}</p>
      <button disabled={!ready || query.isFetching} onClick={() => void query.refetch()}>
        {query.isError ? '다시 시도' : '시설 새로고침'}
      </button>
    </>
  );
}
function PlaceDetail({ id, ready }: { id: string; ready: boolean }) {
  const query = useQuery({
    queryKey: placeKey(id),
    staleTime: 60_000,
    retry: false,
    queryFn: async ({ signal }) => {
      const response = await get(`/api/v1/places/${id}`, signal);
      return response === null ? null : placeDetailSchema.parse(response);
    },
  });
  return (
    <>
      <a href="/places">시설 목록으로 돌아가기</a>
      {query.isError ? <p role="alert">시설을 불러오지 못했습니다. 다시 시도해 주세요.</p> : null}
      {query.data === null ? <p role="alert">시설을 찾을 수 없습니다.</p> : null}
      {query.data && query.isError ? (
        <p>이전에 불러온 정보입니다. 최신 정보를 확인하지 못했습니다.</p>
      ) : null}
      <h1>{query.data?.place.name ?? '시설 상세'}</h1>
      {query.data ? (
        <>
          <FacilityInfo place={query.data.place} />
          <WeatherInfo weather={query.data.weather} refreshFailed={query.isError} />
        </>
      ) : null}
      <p role="status">{query.isFetching ? '시설과 날씨를 불러오는 중…' : ''}</p>
      <button disabled={!ready || query.isFetching} onClick={() => void query.refetch()}>
        {query.isError || !query.data || query.data.weather.status !== 'fresh'
          ? '다시 시도'
          : '시설·날씨 새로고침'}
      </button>
    </>
  );
}
