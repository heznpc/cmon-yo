import { Suspense } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AppLink } from '../../app/navigation';
import { Icon } from '../../app/Icon';
import { StreamSlot } from '../../app/stream';
import { publicAPI } from '../../api/public';
import { displayDate } from '../../contracts/date';
import { placeKey, placesKey, weatherKey, type Place, type Weather } from '../../contracts/place';
import * as css from '../meetup/meetup.css';
import * as mapCSS from './places.css';
import { FacilityRefresh } from './FacilityRefresh';
import { usePlaceFavorites } from './usePlaceFavorites';

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

function FavoriteButton({ id }: { id: string }) {
  const favorites = usePlaceFavorites();
  const isFavorite = favorites.ids.has(id);
  return (
    <>
      <button
        className={mapCSS.favorite}
        aria-pressed={isFavorite}
        aria-label={isFavorite ? '찜 해제' : '찜하기'}
        disabled={favorites.busyId === id}
        onClick={() => void favorites.toggle(id)}
      >
        <Icon name="heart" /> {isFavorite ? '찜 해제' : '찜하기'}
      </button>
      {favorites.message ? <p role="alert">{favorites.message}</p> : null}
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
      <button
        aria-disabled={query.isFetching}
        onClick={() => {
          if (!query.isFetching) void query.refetch();
        }}
      >
        날씨 다시 조회
      </button>
    </div>
  );
}

export function PlaceDetail({ id }: { id: string }) {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: placeKey(id),
    staleTime: 60_000,
    retry: false,
    // Preserve the list record's original age when it seeds a detail route.
    initialData: () => {
      const place = client
        .getQueryData<{ places: Place[] }>(placesKey)
        ?.places.find((candidate) => candidate.id === id);
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
            <AppLink className={css.primary} href={`/meetups/new?placeId=${id}`}>
              이 장소에서 모임 만들기
            </AppLink>
            <FavoriteButton id={id} />
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
