import { useEffect, useRef, useState } from 'react';
import type * as MapLibre from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Place } from '../../contracts/place';
import * as css from './places.css';

type Runtime = {
  library: typeof MapLibre;
  map: MapLibre.Map;
  markers: Map<string, MapLibre.Marker>;
};
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
export function FacilityMap({
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
          // Replaced by the public facility bounds as soon as markers mount.
          center: [126.45, 34.9],
          zoom: 10,
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
        setRuntime({ library, map, markers: new Map() });
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
    fitPlaces(runtime, places);
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
}
