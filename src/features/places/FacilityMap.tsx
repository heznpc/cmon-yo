import { memo, useEffect, useRef, useState } from 'react';
import type * as MapLibre from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Place } from '../../contracts/place';
import * as css from './places.css';

type Runtime = {
  library: typeof MapLibre;
  map: MapLibre.Map;
  markers: Map<string, MapLibre.Marker>;
  userMarker: MapLibre.Marker | null;
};
type DeviceLocation = { latitude: number; longitude: number };
const pinHTML =
  '<svg viewBox="0 0 44 52" aria-hidden="true"><path d="M22 49C16 40 4 29 4 20a18 18 0 0 1 36 0c0 9-12 20-18 29Z" fill="#7893F8" stroke="#17264C" stroke-width="2.5"/><circle cx="22" cy="20" r="6" fill="white"/></svg>';

function fitPlaces(runtime: Runtime, places: Place[]) {
  if (!places.length) return;
  const bounds = new runtime.library.LngLatBounds();
  for (const place of places) bounds.extend([place.longitude, place.latitude]);
  runtime.map.fitBounds(bounds, {
    padding: { top: 65, bottom: 45, left: 45, right: 45 },
    maxZoom: 16,
    duration: 0,
  });
}

// Map code is loaded only after mount. The SSR facility list remains usable
// when JavaScript, WebGL, or the external basemap is unavailable.
export const FacilityMap = memo(function FacilityMap({
  places,
  selectedId,
  onSelect,
}: {
  places: Place[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [runtime, setRuntime] = useState<Runtime | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const [tileFailed, setTileFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [location, setLocation] = useState<DeviceLocation | null>(null);
  const [locationState, setLocationState] = useState<
    'idle' | 'loading' | 'granted' | 'denied' | 'timeout' | 'unavailable'
  >('idle');
  const locationRequested = useRef(false);
  const mounted = useRef(true);
  const locationRef = useRef<DeviceLocation | null>(null);
  locationRef.current = location;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  function requestLocation() {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setLocationState('unavailable');
      return;
    }
    setLocationState('loading');
    try {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          if (!mounted.current) return;
          setLocation({ latitude: position.coords.latitude, longitude: position.coords.longitude });
          setLocationState('granted');
        },
        (error) => {
          if (!mounted.current) return;
          if (error.code === 1) {
            setLocationState('denied');
          } else if (error.code === 3) {
            setLocationState('timeout');
          } else {
            setLocationState('unavailable');
          }
        },
        // Permission prompts and the first desktop location fix can take longer
        // than a normal request. Keep the request alive long enough for the
        // user to answer the prompt, while still giving an explicit retry path.
        { enableHighAccuracy: false, maximumAge: 60_000, timeout: 30_000 },
      );
    } catch {
      setLocationState('unavailable');
    }
  }
  useEffect(() => {
    if (!locationRequested.current) {
      locationRequested.current = true;
      requestLocation();
    }
  }, []);
  useEffect(() => {
    let cancelled = false;
    let map: MapLibre.Map | undefined;
    let observer: ResizeObserver | undefined;
    const deadline = setTimeout(() => setTileFailed(true), 15000);
    void Promise.all([
      import('maplibre-gl'),
      import('maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'),
    ])
      .then(([library, worker]) => {
        if (cancelled || !container.current) return;
        library.setWorkerUrl(worker.default);
        map = new library.Map({
          container: container.current,
          style: 'https://tiles.openfreemap.org/styles/liberty',
          attributionControl: { compact: false },
          // Start from a neutral country view until device location or facility bounds are ready.
          center: [127.8, 36.2],
          zoom: 6,
          scrollZoom: false,
          dragRotate: false,
          pitchWithRotate: false,
          locale: {
            'NavigationControl.ZoomIn': '지도 확대',
            'NavigationControl.ZoomOut': '지도 축소',
            'Map.Title': '공원과 운동시설 지도',
          },
        });
        map.addControl(new library.NavigationControl({ showCompass: false }), 'top-left');
        map.on('load', () => {
          clearTimeout(deadline);
          setLoaded(true);
        });
        map.on('error', (event) => {
          console.error('시설 지도 배경 실패', event.error);
          clearTimeout(deadline);
          setTileFailed(true);
        });
        observer = new ResizeObserver(() => map?.resize());
        observer.observe(container.current);
        setRuntime({ library, map, markers: new Map(), userMarker: null });
      })
      .catch((error: unknown) => {
        console.error('시설 지도 초기화 실패', error);
        if (!cancelled) {
          clearTimeout(deadline);
          setFailed(true);
        }
      });
    return () => {
      cancelled = true;
      clearTimeout(deadline);
      observer?.disconnect();
      map?.remove();
    };
  }, [attempt]);

  useEffect(() => {
    if (!runtime || !location) return;
    const element = document.createElement('div');
    element.className = css.userLocation;
    element.setAttribute('role', 'img');
    element.setAttribute('aria-label', '현재 위치');
    runtime.userMarker?.remove();
    runtime.userMarker = new runtime.library.Marker({ element, anchor: 'center' })
      .setLngLat([location.longitude, location.latitude])
      .addTo(runtime.map);
    runtime.map.flyTo({
      center: [location.longitude, location.latitude],
      zoom: Math.max(13, runtime.map.getZoom()),
      duration: 0,
    });
    return () => {
      runtime.userMarker?.remove();
      runtime.userMarker = null;
    };
  }, [runtime, location]);

  useEffect(() => {
    if (!runtime) return;
    const { library, map, markers } = runtime;
    for (const marker of markers.values()) marker.remove();
    markers.clear();
    for (const place of places) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = css.pin;
      button.innerHTML = pinHTML; // Static icon only; facility text never enters HTML.
      button.title = place.name;
      button.setAttribute('aria-label', place.name + ' 지도 핀');
      button.addEventListener('click', () => onSelect(place.id));
      const marker = new library.Marker({ element: button, anchor: 'bottom' })
        .setLngLat([place.longitude, place.latitude])
        .addTo(map);
      button.addEventListener('focus', () => {
        if (!map.getBounds().contains(marker.getLngLat()))
          map.panTo(marker.getLngLat(), { duration: 0 });
      });
      markers.set(place.id, marker);
    }
    if (!locationRef.current) fitPlaces(runtime, places);
    return () => {
      for (const marker of markers.values()) marker.remove();
      markers.clear();
    };
  }, [runtime, places, onSelect]);

  useEffect(() => {
    if (!runtime) return;
    for (const [id, marker] of runtime.markers) {
      const selected = id === selectedId;
      marker.getElement().setAttribute('aria-pressed', String(selected));
      marker.getElement().style.zIndex = selected ? '1' : '';
      if (selected)
        runtime.map.jumpTo({
          center: marker.getLngLat(),
          zoom: Math.max(15, runtime.map.getZoom()),
        });
    }
  }, [runtime, selectedId, places]);

  function retry() {
    setTileFailed(false);
    setFailed(false);
    setLoaded(false);
    setRuntime(null);
    setAttempt((value) => value + 1);
  }
  return (
    <>
      <div className={css.mapToolbar}>
        <span>공원 위치</span>
        <button
          className={css.locationControl}
          disabled={locationState === 'loading'}
          onClick={requestLocation}
        >
          {locationState === 'loading' ? '현재 위치 확인 중…' : '내 위치 찾기'}
        </button>
        <button
          disabled={!runtime || !places.length}
          onClick={() => {
            if (!runtime) return;
            onSelect(null);
            fitPlaces(runtime, places);
          }}
        >
          전체 핀 보기
        </button>
      </div>
      {locationState === 'denied' ? (
        <p className={css.mapMessage} role="status">
          위치 권한이 거부되었습니다. 브라우저 설정에서 허용한 뒤 다시 시도해 주세요.
        </p>
      ) : null}
      {locationState === 'granted' ? (
        <p className={css.mapMessage} role="status">
          현재 위치를 지도에 표시했습니다.
        </p>
      ) : null}
      {locationState === 'unavailable' ? (
        <p className={css.mapMessage} role="status">
          현재 위치를 확인할 수 없습니다. 지도는 시설 핀으로 계속 사용할 수 있습니다.
        </p>
      ) : null}
      {locationState === 'timeout' ? (
        <p className={css.mapMessage} role="status">
          위치 확인 시간이 초과되었습니다. 위치 서비스를 확인한 뒤 다시 시도해 주세요.
        </p>
      ) : null}
      <div ref={container} className={css.map} role="region" aria-label="공원과 운동시설 지도" />
      {!loaded && !failed && !tileFailed ? (
        <p className={css.mapMessage} role="status">
          지도를 불러오는 중… 시설 목록도 이용할 수 있습니다.
        </p>
      ) : null}
      {failed || tileFailed ? (
        <div className={css.mapMessage} role="alert">
          <p>
            {failed ? '지도를 열지 못했습니다.' : '지도 배경을 불러오지 못했습니다.'} 시설 목록에서
            상세를 확인할 수 있습니다.
          </p>
          <button onClick={retry}>지도 다시 불러오기</button>
        </div>
      ) : null}
    </>
  );
});
