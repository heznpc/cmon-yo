# 탐색·날씨·SSR 성능 수용조건

관련 이슈: [#6](https://github.com/heznpc/cmon-yo/issues/6). 기반은 `f86a4d7`이며 PR #4의 `feat/account-sessions` 위에 별도 성능 브랜치를 쌓았습니다. 시작 시 작업 트리는 깨끗했고, PR #4는 base `feat/facilities-weather`, head `feat/account-sessions`, draft/open이었습니다. 기존 인증·모임 구현과 이력을 보존합니다.

## 사용자 문제와 변경

- 시설 service와 SSR loader가 날씨까지 기다려 시설 이름·주소·운동시설과 관련 모임 링크가 함께 늦었습니다. 필수 시설 조회와 날씨 조회를 분리했습니다. 시설의 존재 여부를 먼저 판정하고, 실제 본문과 링크가 들어 있는 HTML을 전송합니다. 날씨는 Suspense 영역에서 로딩·성공·이전 예보·실패·명시적 재시도를 제공합니다.
- 공개 모임 상세도 본문과 개인 참여 상태를 분리했습니다. 공개 404를 먼저 판정하고, 개인 상태를 확인하기 전에는 참여·주최 권한을 활성화하지 않습니다. 내 계정·내 모임·생성 화면의 필요한 인증 확인은 유지합니다.
- 직접 진입은 Fastify + React `renderToPipeableStream` + StaticRouter, 내부 이동은 React Router 7.18.3 BrowserRouter/Link입니다. API와 SSR은 같은 application service를 사용합니다. 전역 개인 cache나 자체 라우터를 만들지 않았습니다.
- 늦은 날씨/계정 데이터만 요청별 QueryClient에서 추출합니다. JSON의 `<`, `>`, `&`, 줄 구분 문자를 escape하고, 요청 UUID와 두 개의 명시적 데이터 슬롯으로 전달합니다. React가 숨겨진 stream segment를 해당 영역에 배치한 뒤 hydration에 전달하며, 조회를 다시 실행하지 않습니다. React의 `bootstrapModules`가 초기 JSON 뒤에 async module을 내보내므로 전체 stream 종료 전에도 hydration과 내부 링크가 동작합니다. 완료·기한 초과 시 수신 observer와 timer를 해제합니다.
- 목록 필터·페이지는 URL/Query key에, 스크롤은 history entry별 제한된 메모리에 둡니다. 생성·수정·참여·취소는 해당 상세·membership·내 모임·목록만 갱신합니다. 계정 변경 시 개인 Query 취소/삭제와 새 문서 전환, BroadcastChannel과 BFCache 복귀 재확인은 유지합니다. 오래된 개인 SSR 상태를 내부 뒤로가기 때 재주입하지 않습니다. 첫 hydration은 이미 스크롤한 SSR 문서를 위로 되돌리지 않으며, 시설 상세는 목록의 완전한 시설 정보를 원래 조회 시각과 함께 재사용합니다. 공개 목록에서 아직 확인하지 않은 계정을 비로그인으로 단정하지 않습니다.
- 해시 JS/CSS에는 `public, max-age=31536000, immutable`, 나머지 응답에는 `private, no-store`를 적용합니다. 계정 화면·모임 화면·편집 코드는 별도 동적 chunk입니다. 초기 파일 하나의 크기를 전체 초기 전송량으로 간주하지 않습니다.
- 같은 격자·대상/발표 시각의 날씨 요청을 합칩니다. 한 소비자의 취소는 다른 소비자를 취소하지 않으며 마지막 소비자 종료 때만 upstream을 취소합니다. 기본 fresh TTL 5분, 실패 재요청 간격 2초, cache/진행 요청 각각 최대 64개, 공급자 deadline 2.5초입니다. 유효한 이전 예보만 stale로 반환합니다.
- Native는 `/places/:id/info`와 `/places/:id/weather`를 별도 task·상태로 소비합니다. 날씨 재조회는 시설 화면을 다시 만들지 않습니다. 기존 `/places/:id` 결합 API도 호환성을 위해 유지했습니다.

## 측정 절차와 해석

환경: macOS 27.0 (26A428), Apple M4/16GiB, Node 22.22.3/npm 10.9.8, PostgreSQL 17.11, Chromium 153.0.8010.12, 1280×900. `NODE_ENV=production`으로 서버를 실행하고 Vite production 자산을 사용했습니다. HTTP loopback이며 bandwidth/CPU throttling·TLS·중간 proxy는 없습니다. DB와 합성 날씨 HTTP 서버도 같은 Mac에서 실행됩니다. 다른 데스크톱 앱도 실행 중인 공유 Mac이며 OS 부하는 격리하지 못했습니다. 원시 기록에 실행 시작/종료 UTC·load average를 함께 남깁니다.

`tests/performance/server.ts`는 매 실행마다 독립 PostgreSQL schema를 만들고 실제 시설 표본 21개·시험 모임 40개·시험 계정 2개를 준비합니다. DB 대신 fixture service를 쓰지 않습니다. 날씨만 24시간×4항목(TMP/POP/PTY/WSD), 96행의 합성 로컬 HTTP 응답으로 정상, 700ms 지연, 503, 응답 보류에 따른 2.5초 timeout을 통제합니다. 종료 시 자신이 만든 schema만 정리합니다. 시험용 제어/계정 route는 제품 `main.ts`에 등록되지 않으며 loopback에만 bind합니다.

```sh
# .nvmrc의 Node를 활성화하고 TEST_DATABASE_URL을 .env에 설정합니다.
npm ci
npm run build
npm run with-env -- perf:server
# 다른 터미널
npm run perf:measure -- after
```

기준선은 코드 변경 전에 빌드해 보존한 `.cache/performance/before-server`와 `before-client`로 동일 port에서 재실행했습니다. 실행 명령은 `NODE_ENV=production PERF_ASSETS=.cache/performance/before-client node --env-file=.env .cache/performance/before-server/server.js`, 측정은 `npm run perf:measure -- before`입니다. 새 환경에서 기준선을 재현하려면 `f86a4d7`의 별도 checkout에 이번 PR의 측정용 `tests/performance/server.ts`, `measure.mjs`, `src/server/assets.ts`만 복사하고, 기준선 lockfile로 설치·제품 build 후 `npx vite build --ssr tests/performance/server.ts --outDir .cache/performance/harness`로 harness를 빌드합니다. 제품 service·loader·화면은 기준선 것을 사용하고 측정은 `node tests/performance/measure.mjs before`로 실행합니다. 두 버전을 동시에 부하 측정하지 않습니다.

- 문서 진입: 조건별 warm-up 2회 제외 후 10회. 매회 새 browser context로 HTTP cache가 비어 있고 날씨 cache를 reset합니다. hit 조건은 결합 API 1회로 날씨를 먼저 채우며 아래 공급자 호출 수에는 이 priming 호출을 포함합니다. 프로세스/DB는 warm 상태입니다.
- 탐색: 비로그인, 참여 계정 로그인, 참여 계정→주최 계정 전환 각각 warm-up 2회 제외 후 10회. 시설 목록→상세→관련 모임→뒤로가기(상세)→뒤로가기(시설 목록)→모임 목록→상세, 로그인 흐름에는 참여/취소→내 모임, 전환에는 로그아웃/로그인을 추가합니다. context별 최초 자산은 cold, 이후 이동은 같은 cache를 사용합니다. 로그인 상태 준비용 HTTP 로그인은 측정 구간 밖이며, 계정 전환의 실제 UI 로그인은 측정합니다.
- 부하: 호환 결합 API `/api/v1/places/park-46840-00023`의 응답 완료까지 측정합니다. 날씨 지연/실패/hit × 동시 1/8/32, warm-up 1 wave 제외 후 5 waves입니다. 따라서 셀별 표본은 5/40/160이며 p95는 nearest-rank입니다. 스트리밍 본문 표시 시간과 이 API 완료 지연은 서로 다른 지표입니다.
- TTFB는 Navigation Timing `responseStart`, 본문 표시는 실제 시설 h1이 layout에 존재한 뒤 두 animation frame을 지난 시각의 proxy입니다. 빈 shell은 대상이 아닙니다. LCP는 브라우저 PerformanceObserver 값, 링크 사용 가능 시점은 실제 관련 모임 링크가 표시된 시각(SSR anchor도 이동 가능)입니다. hydration 준비 시점은 React의 effect 이후 시설 갱신 버튼이 활성화된 시각으로 별도 측정합니다. 두 값은 스트림 종료나 날씨 완료 시각과 다릅니다. 내부 이동 시간은 Playwright 행동 시작부터 해당 실제 본문/상태까지이며 자동조작 비용도 포함합니다. 모임 목록·내 모임은 정적인 화면 제목이 아니라 실제 시험 모임 항목을 기다립니다. 계정 전환의 다음 입력은 새 문서의 클라이언트 작업이 정산된 뒤 시작합니다.
- 전송량은 CDP `Network.loadingFinished.encodedDataLength` 합계(헤더 포함, loopback 서버 무압축)입니다. 요청 정산은 문서 load와 현재 문서의 fetch promise 완료 후 CDP 네트워크 신호가 500ms 정숙한 상태를 기다립니다. 문서 교체·취소 때 종료 이벤트가 누락되는 요청은 별도 abandoned 수로 기록하며, 전송량은 확인된 완료 응답만 합산합니다. SPA 뒤로가기 후 문서 `networkidle` 이벤트가 오지 않는 측정기 문제를 발견해 이 절차로 전후 모두 재실행했습니다.
- CPU는 wave 동안의 Node 프로세스 user+system 시간, 메모리는 50ms 간격 RSS 최고 관측값입니다. 합성 날씨 HTTP도 같은 프로세스이므로 제품 서버만의 CPU가 아닙니다. DB는 pool 대기 최대값과 50ms 간격 `pg_stat_activity` active wait 표본입니다. 짧은 대기를 놓칠 수 있으며 DB 대기 시간 총량이나 운영 처리량을 뜻하지 않습니다. 요청 종료 시 Query/render 자원과 날씨 소비는 취소하며, 이미 실행된 DB 질의는 기존 statement 2초/query 2.5초 상한 안에서 종료됩니다.

## 동일 조건의 결과

최종 비교는 Node 22.22.3으로 2026-09-13 22:37–22:42 KST에 기준선→변경본 순서로 실행했습니다. 1분 load average는 기준선 시작/종료 5.03/7.79, 변경본 7.79/6.97입니다. 공유 Mac의 부하 변동이 있어 작은 차이와 p95를 제품 효과로 단정하지 않습니다. 시스템 Node 26으로 실행된 중간 진단은 이 표에서 제외했습니다. 원시 결과는 Git 제외된 `.cache/performance/before-node22.json`, `after-node22.json`, 집계는 `node tests/performance/summarize.mjs before-node22 after-node22`로 재생성합니다.

아래 시간 셀은 **변경 전 p50/p95 → 변경 후 p50/p95, ms**입니다. 각 문서 조건 n=10이며, 링크 표시와 hydration 준비를 구분합니다.

| 날씨 조건 | TTFB | 시설 본문 표시 | LCP | 링크 표시 | hydration 준비 |
| --- | --- | --- | --- | --- | --- |
| 정상 miss | 6.8/20.7 → 5.6/12.9 | 35.7/98.7 → 39.1/108.9 | 44/80 → 48/80 | 83.4/132.3 → 79.6/137 | 97.6/151.6 → 99.1/164.1 |
| 700ms 지연 miss | 707.5/712.1 → 6/14.5 | 738/775.4 → 39.1/121.1 | 748/756 → 48/124 | 787/796.6 → 78.1/140.9 | 800.6/810.3 → 92.3/171 |
| 503 miss | 3.6/8.6 → 8.3/37 | 32.3/55.6 → 117.9/153.3 | 40/44 → 96/156 | 69.4/73 → 141.8/173.4 | 82.9/86.2 → 169.3/202.3 |
| 2.5초 timeout miss | 2,503.7/2,509.8 → 5.7/20.5 | 2,536.4/2,564.1 → 39.4/96.4 | 2,544/2,548 → 48/104 | 2,574.5/2,579.1 → 77.9/212.6 | 2,588.6/2,593.6 → 91.2/238.6 |
| fresh cache hit | 3/7.7 → 4/9.8 | 31.6/36.5 → 36.9/59.4 | 40/44 → 44/72 | 80.6/85 → 86.6/133.8 | 94.2/98.3 → 100/159.4 |

지연·timeout에서 본문과 hydration의 공급자 대기를 분리했습니다. 정상·hit의 미세한 차이를 개선으로 주장하지 않습니다. 503 조건은 이 실행에서 본문과 hydration이 더 늦었습니다. 첫 시설 진입의 총 완료 전송량은 정상 조건 **383,420 → 413,785 B**로 늘었습니다. 라우터·stream 전달 비용이 추가되어, 코드 분할을 전체 최초 전송량 감소라고 표현하지 않습니다.

탐색도 같은 p50/p95 ms이며 상태별 n=10입니다. 계정 전환 열의 탐색·참여는 전환 전 참여 계정, 마지막 로그인 행은 주최 계정으로의 실제 전환입니다.

| 행동 | 비로그인 | 로그인 | 계정 전환 흐름 |
| --- | --- | --- | --- |
| 시설 목록 → 상세 | 89.9/93.3 → 372.4/491.7 | 95.5/137.1 → 365.3/438.6 | 89.9/206.5 → 363.4/475 |
| 상세 → 관련 모임 | 78.2/79.7 → 135.2/162.2 | 82.5/97 → 136.4/167.1 | 78.3/387.6 → 158.4/223.5 |
| 뒤로가기 → 시설 상세 | 43.6/45.7 → 5.7/13 | 45.2/55.9 → 5.7/11 | 45.6/107 → 5.6/35.3 |
| 뒤로가기 → 시설 목록 | 43.8/49.5 → 7.7/19.6 | 48.1/83 → 7.1/17.1 | 45.8/109.1 → 7/30.7 |
| 모임 목록 → 상세 | 88.3/90.2 → 74/97.4 | 89.3/173 → 72.2/89.2 | 88.3/158.2 → 72.9/150.6 |
| 참여 | — | 138.1/221.4 → 85.9/91 | 136.5/154.1 → 67.4/159 |
| 참여 취소 확정 | — | 58.8/79.9 → 57.8/110.7 | 58/133.8 → 58/119.6 |
| 내 모임 | — | 60.2/102.7 → 104.1/120.1 | 60.5/115.4 → 101.3/143.4 |
| 다른 계정 로그인 | — | — | 232.8/276.6 → 236.3/265.1 |

시설 목록 복귀와 모임 상세·참여 일부는 빨라졌지만, 첫 시설 상세·관련 모임·내 모임의 Playwright 구간은 늦었습니다. 첫 시설 이동 추가 진단 2회에서는 locator 해석 대기가 포함되었고, 실제 DOM click→상세 h1 변경은 7/14ms였습니다(화면 paint 측정이 아닌 진단, 표본 2). 이 진단으로 위 구간 측정값을 대체하거나 탐색 전체의 개선율을 주장하지 않습니다. 관련 모임의 첫 chunk 로딩과 개인 화면의 인증 확인 비용도 남습니다.

다음은 전체 탐색 구간의 p50입니다. 최초 문서와 자산을 포함하며 API는 준비용 로그인 이후부터 집계합니다.

| 상태 | HTML 요청 전→후 | API 요청 전→후 | 전체 요청 전→후 | 완료 전송량 B 전→후 | abandoned 전→후 |
| --- | --- | --- | --- | --- | --- |
| 비로그인 | 7 → 1 | 0 → 5 | 21 → 20 | 2,732,392 → 456,375 | 0 → 1 |
| 로그인 | 8 → 1 | 6 → 14 | 30 → 29 | 3,119,297 → 460,748 | 0 → 0 |
| 계정 전환 | 11 → 3 | 13 → 22 | 46 → 66 | 4,268,007 → 475,623 | 2 → 1 |

계정 전환에서는 개인 cache를 비우고 새 문서로 옮기므로 추가 요청을 유지합니다. 쪼개진 모듈의 HTTP cache 조회도 요청 수에 포함되어 전체 요청 수가 항상 줄지는 않습니다. abandoned는 완료 이벤트가 없는 취소/문서 교체 관측이며, 해당 전송량은 미집계입니다. 이 부분의 bytes를 0 B 전송으로 단정하지 않습니다.

동시 요청 표는 **결합 API 응답 완료**와 프로세스 관측입니다. 지연 분리는 HTML 본문을 앞당기며, 호환 API 자체는 여전히 날씨를 포함합니다. CPU는 wave별 p50 ms, RSS는 각 조건의 최대 MiB 관측값입니다.

| 날씨 / 동시 수 (요청 n) | API 지연 전→후 p50/p95 ms | 공급자 호출/wave 전→후 | CPU 전→후 ms | RSS 전→후 MiB | pool 대기 최대 전→후 |
| --- | --- | --- | --- | --- | --- |
| delay / 1 (5) | 705.4/706.9 → 706.3/719.3 | 1 → 1 | 11.5 → 18.6 | 166.5 → 90.3 | 0 → 0 |
| delay / 8 (40) | 709/714.3 → 708.3/712.6 | 8 → 1 | 20.8 → 15.1 | 169.8 → 80.8 | 0 → 0 |
| delay / 32 (160) | 732.7/773.5 → 709.4/715.4 | 32 → 1 | 117.7 → 21.3 | 181 → 76.3 | 0 → 0 |
| failure / 1 (5) | 0.9/0.9 → 1.1/2 | 1 → 1 | 0.6 → 0.8 | 181.2 → 78.3 | 0 → 0 |
| failure / 8 (40) | 2.6/3 → 2.5/2.9 | 8 → 1 | 3.4 → 1.8 | 181.2 → 83.6 | 0 → 0 |
| failure / 32 (160) | 7.8/11.7 → 4.3/5.9 | 32 → 1 | 11.5 → 6.2 | 181.5 → 84.7 | 19 → 0 |
| hit / 1 (5) | 0.5/0.6 → 0.9/1.7 | 1 → 1 | 2.3 → 2 | 181.5 → 85.4 | 0 → 0 |
| hit / 8 (40) | 0.9/3.8 → 1.5/6.2 | 1 → 1 | 3.7 → 4.7 | 181.5 → 85.5 | 0 → 0 |
| hit / 32 (160) | 3.7/8.5 → 4.2/8.7 | 1 → 1 | 11.2 → 9.1 | 181.7 → 86.7 | 0 → 8 |

각 버전 615회 중 결합 API의 비-200/연결 오류는 0회입니다. 이는 날씨 성공률이 아닙니다. failure 조건의 공급자 503은 wave당 전 1/8/32회, 후 1회였으며 API는 `weather.status=unavailable`인 200을 반환합니다. 문서 timeout은 전후 모두 각 10회 공급자 연결 종료가 관측됐고, 변경본의 timeout event도 10회입니다. 브라우저 runtime/hydration 오류는 두 측정에서 0회였습니다.

변경본 지연 32 동시 wave는 miss 1·joined 31·success 1이었고, hit 32 동시는 priming miss/success 각 1 후 hit 32였습니다. failure 32의 한 wave는 miss 1·joined 9·backoff 22·failure 1로 공급자 재요청을 억제했습니다. 기준선에는 세부 cache event 계측이 없어 동일 이벤트 수를 소급 주장하지 않습니다.

DB active wait 관측은 전 0/212, 후 0/208 표본입니다. 짧은 쿼리의 wait가 없었다는 보장이 아닙니다. CPU·RSS는 별도 프로세스의 순차 실행·GC·공유 Mac 부하에 영향을 받으므로 메모리 개선율이나 운영 수용량으로 환산하지 않습니다.

## 회귀·실행 증거 — 2026-09-13

| 수준             | 명령·환경                                                                                           | 관측                                                                                                                                                                                                               |
| ---------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 자동 검사·build  | Node 22.22.3, `npm run with-env -- check`                                                           | lint·TypeScript·Vitest 79개·client/server build·server-only bundle 경계 통과                                                                                                                                       |
| DB·HTTP·보안     | 실제 PostgreSQL 통합 검사와 신규 stream/weather 검사                                                | 404/권한 선판정, 요청별 SSR 격리, 안전한 늦은 JSON, disconnect·shell/late render 오류·deadline 정리, 공급자 coalescing·독립 취소·cache 상한/만료/backoff                                                           |
| 브라우저         | `AUTH_SECRET= npm run with-env -- test:web`                                                         | dev/prod Chromium 30개 통과. 원본 stream 보류 중 실제 시설 본문·내부 모임 이동(HTML 1회), 해제 후 날씨만 표시/포커스 유지, 독립 실패/재시도, 다른 시설 이동, 필터·페이지·스크롤 복원, hydration API 중복 0회, 두 계정의 지연된 개인 응답 격리 |
| 기존 사용자 흐름 | 같은 브라우저 suite                                                                                 | 생성/수정/참여/취소/내 모임, 로그인 후 원래 화면과 사용자 확인, 입력 보존·응답 유실 확인/동일 명령 재전송, A의 늦은 개인 응답과 B 전환, 320px/글자 200% 회귀 유지                                                  |
| iOS build        | `bash scripts/build-ios-simulator.sh <output>`                                                      | Xcode 26.6 Simulator 앱 build 성공                                                                                                                                                                                 |
| Simulator XCTest | `SIMCTL_CHILD_CMON_NATIVE_TEST_URL=http://127.0.0.1:3117 bash scripts/test-ios-simulator.sh <UDID>` | iPhone 17e/iOS 26.3, 독립 XCTest 10개 성공. 신규 분리 조회·timeout 중 시설 조회·이전 예보·복구, 기존 Native 계정/모임·WebKit 회귀 포함                                                                             |
| 설치 앱 UI       | XcodeBuildMCP, 같은 Simulator, 로컬 production QA 서버                                              | 시설 상세에서 날씨를 보류해도 이름·주소·운동시설·모임 링크 표시. 해제 후 동일 화면의 예보 표시, timeout/실패 후 날씨 버튼만으로 성공 복구, 시설→관련 모임 이동을 화면과 조작으로 확인                              |

발견 후 고친 결함: 전송 시작 뒤 504 헤더 재전송, 상위 hydration 준비 상태 갱신이 pending Suspense HTML을 버리는 문제, 늦은 packet 수신과 React segment 반영의 순서 경쟁, CSS가 분할 manifest에서 빠지는 문제, 일반 module script가 stream 종료까지 hydration을 미루는 문제, 초기 hydration의 스크롤 되감기, 인증을 조회하지 않는 공개 목록에서 비로그인으로 단정해 발생하는 불필요한 문서 전환. 각각 실패한 스트림/화면 흐름을 수정 후 다시 실행했습니다. 화면 QA에서 붙어 있던 시설의 두 모임 링크 간격도 기존 actions 배치로 분리했습니다.

Browser plugin이 없어 저장소 Playwright를 사용했습니다. Native는 설치 앱의 도구 조작·화면 관측이며 사람의 수동 QA나 XCUITest 실행으로 집계하지 않습니다. 독립 XCTest가 사용하는 시험 credential store와 설치 앱 Keychain도 구분합니다.

## 미검증·PR 상태

HTTPS 배포 환경의 proxy buffering·stream 전달, 실제 네트워크/저사양 기기, 운영 부하·수용량은 미검증입니다. 소표본의 개선율이나 서비스 수용량을 주장하지 않습니다. 공식 기상청 성공 실연결, WeatherKit 교체, 공식 OAuth·외부 SMTP·인증된 WebView·커뮤니티·최종 브랜드는 기존 후속 범위에 유지합니다. 실기기와 VoiceOver 전체 흐름도 별도입니다. XCUITest 환경 복구·runtime 설치·초기화는 수행하지 않습니다.

성능 PR은 `feat/account-sessions`를 base로 두어 PR #4와 분리합니다. 기존 PR #4는 미병합 draft이며, merge하거나 이력을 변경하지 않습니다. 성능 PR도 로컬 검증과 배포 환경 미검증을 구분해 draft로 유지합니다.
