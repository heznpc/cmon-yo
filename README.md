# C'mon Yo!

오늘 동네에서 같이 움직이자.

**Swift native + React Web hybrid architecture**. React와 SwiftUI는 각각 제품 화면이며, Fastify API와 React SSR loader는 같은 공개 모임 service를 직접 호출합니다.

**PR1 기능 수용조건 충족 / XCUITest 자동화 미검증**입니다. fixture 기반 Web·API·iOS의 필수 실행 증거는 아래에 기록했습니다. 실제 모집·로그인·참여·댓글 쓰기는 없습니다. 브랜드 미정의 기본 UI이며 최종 WebView 배치를 확정하지 않습니다. 아래의 통과·미검증을 구분합니다.

PR1 기능 기준선은 main에 반영됐습니다. **PR2는 무안군 시설·날씨 연결을 구현했으며 기상청 인증 실응답 검증이 남아 draft**입니다. [PR2 수용조건](docs/pr2-acceptance.md)과 아래 실행 기록을 따릅니다.

## 현재 구조와 프론트의 API 연결

- 첫 HTML: Fastify SSR loader → application service → PostgreSQL/날씨 adapter → HTML과 직렬화된 Query 상태 → React hydration. 이후 웹 재조회는 `src/api/public.ts` → same-origin HTTP API → 동일 service입니다. Native는 URLSession으로 같은 JSON API를 소비합니다.
- `GET /api/v1/openapi.json`은 현재 공개 조회 3개(모임 상세·시설 목록·시설 상세)의 경로·입력·응답·오류를 제공합니다. 별도 백엔드 구현자는 이 계약을 소비할 수 있습니다. Zod의 입력 스키마에서 생성해 추가 필드를 허용하며, 알 수 없는 종목과 선택 설명의 클라이언트 정규화는 유지합니다. 실제 날짜·시작/종료 순서 등 JSON Schema로 표현되지 않는 의미 검증은 기존 TS/Swift 계약 검사에 남습니다.
- 웹 HTTP client는 응답을 `unknown`으로 받아 검증합니다. 404는 해당 상세를 비우고, 실패한 갱신은 이전 정보임을 표시합니다. 오류의 `code/requestId/retryable`을 보존하며 공급자 메시지를 화면에 그대로 표시하지 않습니다. `retryable`이 자동 재시도를 뜻하지 않으며 조회 화면의 `retry: false`를 유지합니다.
- 현재는 **Fastify가 SSR과 제품 API를 함께 맡는 단일 서버 + 직접 PostgreSQL 연결**입니다. Supabase Auth/관리형 DB는 계획이며 미연결입니다. 독립 Spring 서버와의 연동을 구현했다고 주장하지 않습니다.
- SSR과 제품 API는 같은 service를 사용하고, 클라이언트는 공개 HTTP 계약을 소비합니다. 서버를 분리할 필요가 생기면 배포·소유권·장애 경계에 따라 결정합니다. 현재 renderer는 stream을 사용하지만 loader는 데이터를 받은 뒤 렌더링합니다. 데이터별 점진적 표시나 성능 향상은 아직 입증하지 않았습니다.

실행한 서버의 명세 확인: `curl -fsS http://127.0.0.1:3000/api/v1/openapi.json`. 명세 생성 코드와 DB/key는 browser bundle에 포함되지 않습니다.

## 실행

Node **22.22.3**, npm **10.9.8**. 의존성은 `package-lock.json`에 고정합니다.

```sh
npm ci
npm run dev
# http://127.0.0.1:3000/meetups/11111111-1111-4111-8111-111111111111
```

```sh
npm run build
PORT=3002 npm start
# http://127.0.0.1:3002/meetups/11111111-1111-4111-8111-111111111111
```

API는 `/api/v1/meetups/:id`, 읽기 전용 안내는 `/meetups/:id/discussion`입니다. `HOST` 기본값은 `127.0.0.1`, `PORT`는 `3000`입니다. `MEETUP_FIXTURE_PATH`로 다른 JSON 파일을 읽을 수 있으며 누락·오류를 성공 데이터로 대체하지 않습니다. production은 build manifest의 JS/CSS만 제공합니다. 실행이 끝나면 서버를 Ctrl-C로 종료합니다.

## PR2 시설·날씨 실행

PostgreSQL 17+와 `DATABASE_URL`이 필요합니다. schema 적용과 원본 import는 서버 실행과 분리합니다. 연결 정보와 `KMA_API_KEY`(API허브 발급 키)는 서버 환경변수로만 전달합니다. `.env` 파일을 자동 로드하지 않습니다.

```sh
export DATABASE_URL=postgres://cmon@127.0.0.1:55432/cmon_pr2
npm run facilities -- migrate
npm run facilities -- dry-run contracts/samples/muan-parks.json
npm run facilities -- apply contracts/samples/muan-parks.json
npm run dev
# http://127.0.0.1:3000/places
# http://127.0.0.1:3000/places/park-46840-00023
```

`npm run facilities -- capture /tmp/new-muan-parks.json`은 공식 포털 파일 전체 수집이 성공한 뒤 새 지역 파일을 만듭니다(기존 파일 덮어쓰기 거부). 갱신 시 이 파일을 dry-run 후 apply합니다. source 파일 없이 자동으로 fixture를 넣거나 누락 행을 삭제하지 않습니다. DB 미설정/실패는 503, 등록 행 없음은 빈 목록입니다. API는 `/api/v1/places`, `/api/v1/places/:id`입니다.

Native 기본 탭은 시설입니다. 기존 모임은 “샘플 모임” 탭에 있고 `CMON_START_TAB=meetups`로도 시작할 수 있습니다. `CMON_API_URL` 설정은 두 탭에 적용됩니다. `KMA_API_KEY` 미설정이면 시설은 표시하고 날씨는 조회 불가로 표시합니다.

PR2 검증에서는 `TEST_DATABASE_URL`도 설정합니다. PostgreSQL 검사는 그 DB 안에 실행별 schema를 만들고 해당 schema만 정리합니다. 미설정 시 DB 검사 3개는 skip되므로 전체 검증 통과의 근거로 쓰면 안 됩니다. CI에는 PostgreSQL service와 두 환경변수를 설정했습니다.

```sh
export TEST_DATABASE_URL=postgres://cmon@127.0.0.1:55432/cmon_pr2_test
npm run check
npm run test:web
# Simulator 통합 XCTest 전: 아래 서버 둘을 별도 터미널에서 실행
npx tsx tests/ios-server.ts
npx tsx tests/places-server.ts
npm run test:ios -- "$CMON_SIMULATOR_ID"
```

`tests/places-server.ts`는 3112의 실제 DB service와 3113의 **합성 KMA HTTP 응답**을 연결하는 로컬 QA 도구입니다. `PUT /_test/state/{normal,reset,empty,error,not-found,disconnect,changed,weather-error,weather-timeout}`으로 상태를 전환합니다. 제품 서버에 포함하지 않으며 실제 기상청 날씨 표본이 아닙니다. Web E2E가 이 서버를 직접 시작/종료할 수 있습니다. 별도 실행한 QA 서버는 끝나면 Ctrl-C로 종료합니다.

## 검증 명령

```sh
npm run check                 # lint, typecheck, Vitest, production build, bundle 검사
npx playwright install chromium
npm run test:web              # dev/prod + 악성 fixture 서버를 시작하고 종료
```

iOS는 XcodeGen과 iOS 17+ SDK를 사용합니다. 실제 빌드·검증 환경은 macOS 27.0, Xcode 26.6, Swift 6.3.3, iPhone 17e / iOS 26.3.1 Simulator입니다.

```sh
xcodegen generate --spec ios/project.yml
xcrun simctl list devices available
# 기존 Simulator UDID를 지정합니다. 다른 기기·워크트리를 삭제하지 않습니다.
xcodebuild -project ios/CmonYo.xcodeproj -scheme CmonYo \
  -destination "platform=iOS Simulator,id=$CMON_SIMULATOR_ID" test
```

현재 맥에서 scheme destination 선택은 `iOS 26.5 is not installed`로 실패합니다. 2026-09-12 재현 원인·runner 결과는 아래에 기록했습니다. 아래의 target 빌드는 성공했고 앱을 Simulator에 설치·실행했습니다.

```sh
xcodebuild -project ios/CmonYo.xcodeproj -target CmonYo -sdk iphonesimulator \
  -configuration Debug CONFIGURATION_BUILD_DIR=/tmp/cmon-yo-target-build \
  build CODE_SIGNING_ALLOWED=NO
xcrun simctl install "$CMON_SIMULATOR_ID" /tmp/cmon-yo-target-build/CmonYo.app
SIMCTL_CHILD_CMON_API_URL=http://127.0.0.1:3000 \
  xcrun simctl launch "$CMON_SIMULATOR_ID" app.heznpc.cmonyo
```

Native는 `CMON_API_URL`(기본 `http://127.0.0.1:3000`)과 `CMON_MEETUP_ID`(기본 fixture ID)를 실행 환경에서 받습니다. 테스트 앱은 서명 없이 Simulator에만 설치하며 실기기·배포 검증은 별개입니다.

계약·HTTP·WebKit XCTest는 같은 소스를 독립 Simulator 테스트 번들로 컴파일하는 우회 실행도 제공합니다(Apple Silicon). 서버와 별도 터미널에서 실행하고 끝나면 서버를 종료합니다.

```sh
npx tsx tests/ios-server.ts        # 로컬 검증용 3100/3101, 제품 서버에 포함되지 않음
npm run test:ios -- "$CMON_SIMULATOR_ID"
```

이 경로는 `@testable import CmonYo`만 제거하고 실제 Networking·MeetupBridge와 XCTest 본문을 함께 컴파일합니다. XCUITest의 대체 실행이 아닙니다. 서버 제목 변경·503은 `PUT /_test/state/changed`, `/error`, `/normal`로 검증합니다. 같은 모임의 404 전환은 `/not-found`, API 연결 종료는 `/disconnect`를 사용합니다. 이 제어 경로는 로컬 테스트 서버에만 있습니다.

## 계약과 화면 경계

- `contracts/fixtures/matrix.json`의 **43개 입력**을 TS/Swift가 함께 검증합니다. 필수 필드의 누락·null, 잘못된 타입·UUID·시각·정원은 거부합니다. UTC 시각은 밀리초 3자리의 `...Z`이며 종료가 시작보다 뒤입니다.
- `description` 누락/null은 설명 없음, 새로운 non-empty 종목은 `unknown`입니다. 읽기 응답의 추가 필드는 무시합니다. `viewerParticipation`은 반드시 존재하는 null입니다. 개인 상태는 PR3 범위입니다.
- SSR QueryClient는 요청별로 만들고 응답 완료·오류·연결 종료·5초 deadline에 정리합니다. 초기 query freshness는 60초이며 초기 hydration은 API를 재조회하지 않습니다. 새로고침은 HTTP 조회를 수행합니다. HTML/JSON은 `private, no-store`입니다.
- 본문은 React 텍스트 노드로 표시합니다. 초기 JSON의 `<`, `>`, `&`, U+2028/U+2029를 escape하며 HTML/Markdown renderer나 사용자 링크 입력은 없습니다.
- Native가 상세·modal 표시와 복귀를 소유하고 WebView가 안내 스크롤을 소유합니다. 안내를 닫으면 기존 상세가 남습니다. 입력·draft는 없고 WebView를 다시 열면 새 문서·스크롤로 시작합니다. Native 상세는 안내 실패에도 남습니다.
- Bridge는 v1 `capabilities`와 현재 모임의 `openMeetup`만 지원합니다. 실제 main-frame의 scheme/host/port를 검사합니다. 수락 이후 실행과 웹 응답 관측은 독립적이며 timeout/종료에서 자동 재전송하지 않습니다. 자세한 종료 계약은 [PR1 수용조건](docs/pr1-acceptance.md)을 따릅니다.

실제로 사용하는 스타일 변경 지점은 Web의 `src/features/meetup/meetup.css.ts`, 화면 구성은 `MeetupPage.tsx`, Native 상세는 `ios/CmonYo/Features/MeetupView.swift`, 안내 컨테이너는 `ios/CmonYo/Web/DiscussionView.swift`입니다. 범용 디자인 시스템은 없습니다.

## 2026-09-12 실행 결과

검증 수준은 **순수 로직**, **실제 HTTP·WebKit 통합**, **실행 앱 QA**, **XCUITest 자동화**를 구분합니다. 아래 최초 실행 기록의 제품 소스는 PR1 초기 구현이며, Web은 최초 실행과 runner 차단 기록 단계의 CI 재실행에서 통과했습니다. 정상 조회 후 갱신 실패 수정의 재검증은 아래 2026-09-13 기록을 따릅니다.

| 수용조건      | 결과 / 테스트 이름과 검증 수준                                                                                                                                                                                                                                                                         |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 실제 HTTP     | 통과: `HTTPTests.testRealFastifyChanges404AndConnectionFailure` — 실제 Simulator URLSession → Fastify의 변경·404·연결 거부. 실행 앱 UI에서도 변경·오류·재시도 확인                                                                                                                                     |
| 공통 계약     | 통과: `contracts.test.ts`의 `shared TS/Swift contract matrix`, `ContractTests.testSharedMatrix` — 순수 로직, 같은 43개 입력과 unknown fallback                                                                                                                                                         |
| SSR           | 통과: `API and SSR call the same service directly; no-store, 400, 404` — service/HTTP handler 통합. `JavaScript disabled: SSR title, time and place are visible body content` — dev/prod 실행 Chromium                                                                                                 |
| hydration     | 통과: `hydration has zero initial API requests; keyboard refresh, changed HTTP and failure/retry` — dev/prod 실행 Chromium, 초기 API 0회·키보드 새로고침 1회·변경·오류·재시도                                                                                                                          |
| SSR 격리      | 통과: `overlapping loads isolate dehydrated state; shared-client mutant is detected` — loader 통합과 결함 주입. `two overlapping real HTTP SSR requests contain only their own state` — 실제 HTTP                                                                                                      |
| bundle        | 통과: `check-bundle.mjs` — production asset 정적 검사, browser import 경계 lint. 실행 보안 전체를 증명하는 검사는 아님                                                                                                                                                                                 |
| bridge        | 통과: `bridge.test.ts`의 requestId/close/timeout 4개 — 순수 로직·가짜 transport. `BridgeTests.testAcceptanceAndCloseBoundaries` — 순수 로직. `testActualWebKitAllowedAndDisallowedSenders`, `testActualWebKitCloseAfterAcceptanceKeepsNavigation` — 실제 WebKit. 기존 Native 상세 복귀 — 실행 앱 UI QA |
| bridge 발신자 | 통과: `BridgeTests.testActualWebKitAllowedAndDisallowedSenders`, `testActualWebKitMalformedMessagesAndScheme` — 실제 WebKit의 다른 host/port, HTTPS frame origin, subframe에서 추가 이동 0회. `testOriginAndMalformedInputs`는 별도의 순수 로직 검사                                                   |
| 오류·중단     | 통과: 위 WebKit malformed 검사. `service failure, shell failure and deadline clean request clients`, `client disconnect aborts in-flight data and cleans exactly once`, `disconnect after shell aborts a suspended render and cleans once` — 서버 통합, 500/503/504·실제 HTTP 연결 종료                |
| 직렬화        | 통과: `malicious SSR text remains text at 320px and 200% type size; touch target works` — dev/prod 실행 Chromium, script 실행·img 삽입 없음                                                                                                                                                            |
| 실행          | dev/prod Web와 Simulator 앱 실행 통과. XCUITest는 발견 2개·실행 0개로 미검증. 빌드·독립 XCTest·도구 기반 앱 QA와 구분                                                                                                                                                                                  |

자동 검사는 Vitest **54개**, Chromium **12개**, Simulator XCTest **7개** 통과입니다. 브라우저 QA는 1280×900 및 320×740/글자 200%에서 수행했습니다. Native는 기본 크기와 Accessibility XXXL에서 줄바꿈·스크롤을 확인했습니다. Browser plugin not available: 저장소 Playwright 검증 경로를 사용했습니다. 브라우저 제목·본문·console·새로고침·읽기 전용 안내·404·실패/재시도와 스크린샷을 확인했습니다.

재현 후 수정한 결함:

1. 저장소 경로의 작은따옴표가 vanilla-extract 5.2.6 생성 import를 깨뜨림 → 해당 Vite import를 JSON 인용. 같은 경로에서 검사·build·dev 실행 재확인.
2. Node/Chromium의 ICU가 한국어 오전을 다르게 표시해 hydration 복구 발생 → 한국 시간의 숫자 부분을 고정 형식으로 조합. 양쪽 hydration 오류 0회 재확인.
3. iOS 26.3 Simulator WebKit의 `system-ui`가 한글을 누락 glyph로 표시 → 별도 WebKit 화면에서 기본/Arial은 정상임을 확인하고 Arial/sans-serif 사용. 실제 안내의 한글·복귀 재확인.
4. 잘못된 API 응답에서 Zod 내부 오류 배열이 화면에 표시됨 → 일반 오류 문구와 재시도로 교체. 실제 브라우저에서 같은 잘못된 응답과 복구를 재검증.
5. Swift 6.3 WebKit delegate의 actor/sendable 서명 불일치 → SDK와 같은 서명으로 수정, 앱·XCTest target 빌드와 실제 WebKit 테스트 재확인.

### XCUITest 차단 재현과 후속 실행 기록

2026-09-12 KST, `feat/pr1-meetup-integration`의 PR1 초기 구현에서 시작했으며 미커밋 변경은 없었습니다. 제품 코드·deployment target·scheme의 테스트 포함 범위는 변경하지 않았습니다.

- 환경: arm64, macOS 27.0 (26A428), Xcode 26.6 (17F113), Swift 6.3.3. `DEVELOPER_DIR`는 미설정이며 `xcode-select -p`는 `/Applications/Xcode.app/Contents/Developer`입니다.
- 설치 SDK: `iphoneos26.5`, `iphonesimulator26.5`. 설치 runtime: iOS 26.3.1 (23D8133) 하나. 선택 기기는 기존 iPhone 17e입니다. 명령의 `CMON_SIMULATOR_ID`에는 `simctl list devices available`에서 확인한 해당 UDID를 넣습니다.
- `CmonYo` scheme의 Debug TestAction에는 `CmonYoTests`, `CmonYoUITests` 모두 `skipped=NO`이며 별도 `.xctestplan`은 없습니다. 실제 build setting은 `IPHONEOS_DEPLOYMENT_TARGET=17.0`, `SUPPORTED_PLATFORMS=iphoneos iphonesimulator`입니다.
- 26.5는 제품 최소 OS 요구가 아닙니다. 프로젝트의 `SDKROOT=iphoneos`가 활성 Xcode의 26.5 SDK로 해석됩니다. Xcode platform의 `MinimumSDKVersion=26.5`, `simctl runtime match list`의 기본 매핑은 SDK 26.5.1/build 23F81a → runtime 23F81a이며 해당 runtime은 없습니다.
- `-showdestinations`는 유효한 Simulator를 하나도 반환하지 않고 iOS destination을 `iOS 26.5 is not installed`로 표시합니다. `-sdk iphonesimulator`를 추가해도 같습니다. 실패는 **destination 해석 단계**로, 컴파일·테스트 발견·실행 전에 발생합니다. 성공한 target 빌드와 독립 XCTest는 이 scheme destination 해석을 거치지 않습니다.
- [Apple 지원표](https://developer.apple.com/xcode/system-requirements)의 Xcode 26.6 지원 호스트는 macOS 26.2–26.x입니다. 현재 macOS 27.0은 그 범위 밖입니다. SDK가 있다는 사실이나 독립 XCTest 성공만으로 이 호스트 조합 전체를 지원된다고 판정하지 않습니다.

실제 재현 명령과 로컬 증거(사용자 경로·원본 기기 로그는 원격에 첨부하지 않음):

```sh
xcodebuild -project ios/CmonYo.xcodeproj -scheme CmonYo -showdestinations
xcodebuild -project ios/CmonYo.xcodeproj -scheme CmonYo -sdk iphonesimulator -showdestinations
xcodebuild -project ios/CmonYo.xcodeproj -scheme CmonYo \
  -destination "platform=iOS Simulator,id=$CMON_SIMULATOR_ID" -destination-timeout 5 \
  -resultBundlePath /tmp/cmon-pr1-destination-failure.xcresult test
xcrun xcresulttool get test-results summary \
  --path /tmp/cmon-pr1-destination-failure.xcresult --compact
```

결과 bundle은 생성됐지만 `totalTestCount=0`, `passedTests=0`, `failedTests=0`, `result=unknown`, 기기/구성 목록은 비어 있습니다. **테스트 실패 0개가 통과를 뜻하지 않습니다.** `/tmp/cmon-pr1-destination-failure.log`에 destination 오류가 있습니다.

[Apple 공식 플랫폼 설치 명령](https://developer.apple.com/documentation/xcode/downloading-and-installing-additional-xcode-components)으로 `xcodebuild -downloadPlatform iOS -buildVersion 26.5 -architectureVariant arm64`를 한 번 실행했습니다. 카탈로그에서 iOS 26.5 Simulator (23F73), arm64를 선택했으나 10분 이상 `Preparing to download...`에 머물러 SIGINT로 중단했습니다. 새 runtime은 설치되지 않았습니다. 로컬 설치 서비스 로그에는 `_fetchSingleMatch ... multiple matches`, `MAQueryTooManyResults (13)`가 관측됐으며 설치 로그는 `/tmp/cmon-pr1-platform-install.log`입니다. 이를 네트워크 장애나 저장 공간 부족으로 단정하지 않습니다. 플랫폼 설치 성공과 유효 destination 확보가 여전히 필요하며, 캐시 초기화·Simulator 삭제·무작위 재설치는 하지 않았습니다.

원본 XCUITest runner도 설치된 `idb`로 실행을 시도했습니다.

```sh
xcodebuild -project ios/CmonYo.xcodeproj -target CmonYoUITests -sdk iphonesimulator \
  -configuration Debug CONFIGURATION_BUILD_DIR=/tmp/cmon-yo-target-build \
  build CODE_SIGNING_ALLOWED=NO
idb xctest run ui --udid "$CMON_SIMULATOR_ID" --install --timeout 180 \
  --result-bundle-path /tmp/cmon-pr1-idb-ui.xcresult \
  /tmp/cmon-yo-target-build/CmonYoUITests-Runner.app/PlugIns/CmonYoUITests.xctest \
  /tmp/cmon-yo-target-build/CmonYo.app /tmp/cmon-yo-target-build/CmonYoUITests-Runner.app
idb xctest list-bundle --udid "$CMON_SIMULATOR_ID" app.heznpc.cmonyo.uitests
IDB_DYLD_LIBRARY_PATH="$(xcode-select -p)/Platforms/iPhoneSimulator.platform/Developer/usr/lib" \
  idb xctest run ui --udid "$CMON_SIMULATOR_ID" --timeout 180 --report-activities \
  --result-bundle-path /tmp/cmon-pr1-idb-ui-libs.xcresult \
  app.heznpc.cmonyo.uitests app.heznpc.cmonyo app.heznpc.cmonyo.uitests.xctrunner
```

발견된 테스트는 `MeetupUITests.test404ConnectionFailureAndRetryControls`, `testRoundTripTwiceReturnsToExistingDetail` **2개**입니다. 첫 실행은 runner의 `Testing.framework`가 `lib_TestingInterop.dylib`를 찾지 못해 DYLD 종료됐습니다. 활성 Xcode에 있는 해당 Simulator 라이브러리 경로를 runner 환경에 지정하자 시작은 했지만 `Error while preparing for testing`와 test-session 연결 종료로 테스트는 **0개 실행**됐습니다. 두 `idb` 실행 모두 비정상 종료했으며 요청한 `.xcresult`는 생성되지 않았습니다. 로그는 `/tmp/cmon-pr1-idb-ui.log`, `/tmp/cmon-pr1-idb-ui-libs.log`, 발견 결과는 `/tmp/cmon-pr1-idb-discovery.log`입니다. 이 우회 경로도 성공한 UI 자동화로 집계하지 않습니다.

같은 소스의 앱 및 UI-test target 빌드는 재실행 성공했습니다. `npx tsx tests/ios-server.ts`와 `npm run test:ios -- "$CMON_SIMULATOR_ID"`는 순수 XCTest 3개와 실제 HTTP/WebKit XCTest 4개, 총 **7개 실행·7개 성공·0개 실패**였습니다(`/tmp/cmon-pr1-xctest.log`). XcodeBuildMCP와 `idb ui`로 실행 앱의 HTTP 제목 변경·404·연결 거부와 재시도·503 후 복구·안내 진입·같은 모임으로 두 차례 복귀도 재확인했습니다. 정상/변경/503은 `CMON_API_URL=http://127.0.0.1:3100`, 연결 거부는 포트 `3199`, 404는 `CMON_MEETUP_ID=33333333-3333-4333-8333-333333333333`으로 앱을 실행했습니다. 앱 QA는 에이전트가 XcodeBuildMCP의 `tap`·`wait_for_ui`·`screenshot`과 `idb ui tap`을 단계별로 호출한 UI 자동조작 및 화면 관측입니다. 사람이 직접 터치한 수동 QA가 아니며, XCUITest 테스트 suite 실행으로 집계하지 않습니다.

### 2026-09-13 수용 판정과 후속 검증

runner 차단 기록 단계의 기록과 기존 실행 증거를 최신 `docs/pr1-acceptance.md`의 11개 필수 항목에 대조했습니다. 각 항목은 위 표의 테스트·실행 QA로 충족되며, 남은 필수 기능 검증이나 알려진 미수정 결함은 없습니다. 코드 변경 없이 기존 증거를 재사용했습니다. 특히 실행 앱의 근거는 다음과 같습니다.

| 실행 앱 흐름                | 기존 관측과 근거 (2026-09-12, iPhone 17e / iOS 26.3.1)                                                                                                                                                                                                                                          |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 실제 HTTP 조회·제목 변경    | 실행 Fastify의 `PUT /_test/state/changed` 후 Native 새로고침을 조작하고 변경 제목을 `wait_for_ui`와 스크린샷으로 확인. `HTTPTests.testRealFastifyChanges404AndConnectionFailure`도 실제 URLSession 경로를 검증                                                                                  |
| 404                         | 존재하지 않는 ID로 앱을 실행하고 `wait_for_ui`에서 “모임을 찾을 수 없습니다.” 관측. 로컬 `cmon-pr1-404.png`                                                                                                                                                                                     |
| 연결 실패·재시도            | 닫힌 포트 3199로 실행해 연결 오류를 관측하고 “다시 시도”를 조작한 뒤 오류가 유지됨을 확인. 로컬 `cmon-pr1-connection.png`                                                                                                                                                                       |
| 503 후 복구                 | 서버 상태를 `error`로 바꿔 Native 오류·재시도 버튼을 관측. `changed`로 복구한 뒤 “다시 시도”를 조작해 변경 제목과 정상 버튼을 확인한 도구 실행 기록                                                                                                                                             |
| WebView 진입·동일 모임 복귀 | 안내 버튼 → WebView 제목·복귀 버튼 스크린샷 → `idb ui tap` → `wait_for_ui`의 “닫기” 소멸 및 기존 Native 제목 관측을 두 차례 수행. `cmon-pr1-return.png`는 복귀 버튼이 있는 안내 화면이고, 복귀 결과의 근거는 그 뒤 UI 관측 기록임. 상세의 sheet 해제 경로와 실제 WebKit bridge 검사도 함께 대응 |

**PR1 기능 수용조건 충족 / XCUITest 자동화 미검증**으로 판정하고 PR1를 ready for review 대상으로 전환합니다. 2026-09-13 사용자 지시에 따라 추가 요청된 runner 실행은 지원 환경에서 수행할 후속 항목으로 분리했습니다. 원래 PR1 수용조건은 유지합니다.

- [ ] XCUITest는 **발견 2개·실행 0개, runner 실행 차단으로 미검증**입니다. 지원되는 호스트·Xcode·Simulator runtime 조합에서 기존 `test404ConnectionFailureAndRetryControls`, `testRoundTripTwiceReturnsToExistingDetail`을 실행하고, result bundle의 발견/실행/성공/실패 수와 각 결과를 확인합니다. 빌드·독립 XCTest·도구 기반 앱 QA 성공으로 대체 통과 처리하지 않습니다. 현재 환경에서 추가 runner 시도·runtime 설치·초기화·OS/Xcode 변경은 진행하지 않습니다.

실기기·VoiceOver 전체 탐색은 현재 PR1 필수로 명시된 범위가 아닌 후속 미검증입니다. 이미 확인한 작은 화면·글자 확대·키보드·포커스·터치 QA를 VoiceOver 전체 검증으로 확대 해석하지 않습니다. 성능·production proxy flush·운영 처리량도 미검증이며 개선을 주장하지 않습니다.

### 2026-09-13 정상 조회 후 갱신 실패 수정·재검증

갱신 실패 수정 전 상태의 정상 → 404 전환에서 Web·Native 모두 오류와 이전 상세·안내 행동이 동시에 남는 결함을 재현했습니다. Native는 기존 실행 앱에서 같은 모임을 조회한 뒤 테스트 서버를 `not-found`로 바꾸고 새로고침했습니다. 최초 404로 실행하는 기존 QA만으로 이 전환을 검증한 것은 아니었습니다.

- Web `MeetupPage.tsx`: 404를 해당 모임 query의 명시적인 빈 결과로 반영하여 상세·안내 링크를 내립니다. 뒤이은 연결 실패에서도 이전 상세가 되살아나지 않습니다.
- Native `MeetupView.swift`: 404에서 현재 상세만 비웁니다. 두 화면 모두 연결 실패로 유지하는 정보 앞에 “이전에 불러온 정보입니다. 최신 정보를 확인하지 못했습니다.”를 표시하며, 재시도 시작만으로 오류 표시를 지우지 않습니다. 성공 응답에서 최신 내용·행동을 복구하고 오류·이전 정보 표시를 정리합니다.
- 다른 query/cache, API 계약, bridge 명령, 제품 스타일은 변경하지 않았습니다. 로컬 HTTP 시험 서버에 404·연결 종료 상태를 추가하고 Web 회귀 검사 2개와 기존 Native UI-test 메서드를 보완했습니다.

환경: macOS 27.0, Node 22.22.3/npm 10.9.8, Xcode 26.6 (17F113), iPhone 17e / iOS 26.3.1 (23D8133). Browser plugin not available: 저장소 Playwright를 사용했습니다.

| 실제 실행                                                                                                              | 결과와 검증 수준                                                                                                                                                                                                                                  |
| ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npx playwright test --project=development --grep 'refresh 404\|refresh connection failure' --reporter=list` (수정 전) | 신규 회귀 검사 2개 실패: 404 뒤 기존 제목 잔존, 연결 실패 뒤 이전 정보 표시 부재를 각각 검출                                                                                                                                                      |
| `npm run lint`, `npm run typecheck`, `npm run build`                                                                   | 통과. client/server production 빌드 및 server-only bundle 검사 포함                                                                                                                                                                               |
| `npx vitest run tests/server.test.tsx tests/bridge.test.ts`                                                            | 10개 성공. 서버 통합과 가짜 bridge transport 검사이며 앱 UI 검증은 아님                                                                                                                                                                           |
| `npx playwright test --reporter=list` (수정 후)                                                                        | dev/prod 실행 Chromium 16개 성공. 신규 2개 × 2환경 포함. 새 회귀 검사는 HTTP 응답 대체/연결 중단을 사용해 실제 렌더·클릭·재시도 중 표시·복구를 검증                                                                                               |
| 앱·UI-test target 빌드                                                                                                 | `xcodebuild -project ios/CmonYo.xcodeproj -target CmonYo -sdk iphonesimulator -configuration Debug CONFIGURATION_BUILD_DIR=/tmp/cmon-yo-refresh-build build CODE_SIGNING_ALLOWED=NO` 성공. `-target CmonYoUITests`도 성공. runner는 실행하지 않음 |
| 실제 HTTP Web QA                                                                                                       | `npx tsx tests/ios-server.ts`와 로컬 Playwright QA 스크립트로 3100 서버 상태를 전환. 1280×900 및 320×740/글자 200%에서 404·실제 연결 종료·복구·안내 왕복 확인. 제목/본문·스크린샷 정상, 가로 넘침·runtime/hydration 오류 없음                     |
| 실행 Native 앱 QA                                                                                                      | 위 앱을 설치·실행하고 XcodeBuildMCP·`idb ui` 자동조작/접근성 트리·스크린샷 관측. 정상 → 404 → 연결 종료 → 변경 제목 성공 → 연결 종료(이전 정보 표시) → 정상 성공을 확인. 복구된 안내 버튼으로 WebView 진입 후 기존 상세 한 개로 복귀 확인         |

실행 QA 로그·화면은 로컬 `/tmp/cmon-refresh-qa/`에 있습니다(`web-before.log`, `web-after.log`, `web-http-qa.log`, `native-qa.log`, `native-build.log`, `native-uitest-build.log`, `web-*-404.png`, `web-*-stale.png`, `native-before-404.png`, `native-after-*.json/png`). 앱 QA는 사람이 직접 터치한 수동 검사나 XCUITest 실행이 아닙니다.

이 갱신 실패 결함은 실행 Web·Native에서 해소했습니다. **PR1 기능 수용조건 충족 / XCUITest 자동화 미검증** 판정을 유지합니다. XCUITest는 이전 발견 **2개·실행 0개**이며, 보완한 `test404ConnectionFailureAndRetryControls`를 포함한 기존 두 메서드의 runner 검증은 지원 환경에서 수행할 후속 항목입니다. 이번 빌드·도구 QA를 XCUITest 성공으로 대체하지 않습니다. 실기기·VoiceOver 전체 흐름도 후속 미검증으로 유지합니다.

## 2026-09-13 PR2 실행 기록

환경: macOS 27.0, Node 22.22.3/npm 10.9.8, PostgreSQL 17.11(Homebrew), Xcode 26.6(17F113), iPhone 17e/iOS 26.3.1 Simulator. DB는 localhost 55432의 이번 작업 전용 cluster이며 시험은 별도 schema를 사용했습니다. Browser plugin not available: 저장소 Playwright/Chromium을 사용했습니다. 앱 조작은 XcodeBuildMCP와 `idb ui` 자동화·접근성 트리·스크린샷 관측이며, 사람의 수동 터치나 XCUITest runner 실행이 아닙니다.

| 실제 명령·흐름 | 결과 / 검증 수준 |
| --- | --- |
| `npm run facilities -- capture contracts/samples/muan-parks.json` | 공식 포털 18,202행/2페이지 수집 → 무안군 21행. 실제 capture 실행은 동일 script의 `npx tsx scripts/facilities.ts capture ...`로 실행. 21개 관리번호 고유, 같은 이름 2행, 운동시설 칸 미제공 10행 |
| `npx tsx scripts/facilities.ts migrate`, `dry-run`, `apply` × 2 | 실제 PostgreSQL: dry-run 삽입 예정 21/시설 저장 0, 첫 apply 삽입 21, 재실행 삽입·변경 0/동일 21 |
| `TEST_DATABASE_URL=… DATABASE_URL=… npm run check` | lint/typecheck, Vitest **63개 성공**(PostgreSQL 3개 포함), production client/server build·bundle 검사 통과. 마지막 title 수정 후 lint/typecheck/build 재실행 통과 |
| `npx playwright test --reporter=list` → `--grep 'DB-backed\|hydration has zero'` 재검사 | 최초 18개 통과/2개 실패에서 title 결함 검출. 수정 후 영향 4개(dev/prod 각각 모임 hydration·시설 SSR) 성공. 나머지 16개는 앞선 실행 성공 증거를 유지 |
| `DB-backed facilities SSR…` | dev/prod 실제 PostgreSQL HTTP/JS 없는 본문·출처·시설 문자열, hydration 초기 API 0회, 키보드 갱신 1회·상세 진입. 키 없는 날씨 unavailable |
| `local HTTP QA: fresh/stale/unavailable…` | 두 Playwright project에서 같은 3112 개발 QA 서버를 검사. 합성 KMA의 정상→실패/stale→복구, 404/상세 제거, 실제 소켓 종료/이전 정보, timeout/unavailable, empty·SSR 오류/재시도. production 날씨 실응답 검증은 아님 |
| production 서버 3006 + 로컬 `web-qa.mjs` | 실제 DB 시설 21개/상세/목록 복귀·키 없는 날씨 재시도. 1280×900, 320×740/글자 200%, URL/title·본문·overlay·콘솔·가로 넘침·스크린샷·키보드 조작 확인. runtime/hydration 오류 0 |
| `xcodegen generate --spec ios/project.yml`; `xcodebuild -project ios/CmonYo.xcodeproj -target CmonYo -sdk iphonesimulator -configuration Debug CONFIGURATION_BUILD_DIR=/tmp/cmon-pr2-build build CODE_SIGNING_ALLOWED=NO` | 실제 Simulator용 앱 빌드 성공. `-target CmonYoUITests`도 빌드 성공. runner 성공으로 표현하지 않음 |
| `npm run test:ios -- "$CMON_SIMULATOR_ID"` | Simulator 독립 XCTest **9개 성공**. 신규 `FacilityTests.testSharedFacilityWeatherContract`는 공통 JSON decode/거부, `testRealHTTPFacilitiesAndWeatherFailureRecovery`는 실제 URLSession→DB API→합성 날씨 HTTP의 실패/복구. 기존 모임 HTTP·WebKit도 성공 |
| 실행 Native 앱 3112 QA | 목록→상세, 정상→날씨 실패/stale→복구, 404/상세 제거, 변경 제목→연결 종료/이전 정보, timeout/unavailable→복구, 기존 목록 복귀, empty→목록 오류→재시도 복구를 확인 |
| 실행 Native 앱 → production 서버 3006 | DB 시설 목록·상세, 인증키 없는 날씨 unavailable을 확인. 샘플 모임 탭→WebView→앱 복귀 버튼→기존 상세 1개 복귀도 확인. 시험용 날씨 응답을 쓰지 않은 제품 서버 경로 |

수용조건별 판단:

| 항목 | 판단 / 근거 |
| --- | --- |
| 실제 시설 표본 | 통과 — 실제 capture 파일과 Web·Native 출처/기준일/미제공 표시 |
| ingest 정합성 | 통과 — 실제 실행 및 `dry-run writes no places…`, `invalid/partial source and mid-transaction DB failure…`의 반복·동시 적용·한 행 변경·rollback |
| 부분 수집 안전성 | 통과 — `public download rejects a partial page…`, malformed/중복 행/개수 불일치 거부·DB 보존 |
| service·SSR | 통과 — `actual HTTP API and SSR read DB changes…`의 실제 DB/HTTP·empty·400/404/503·복구, 기존 SSR 정리 회귀 검사 |
| 날씨 실연결 | **미검증 / 차단** — API허브 인증키가 제공되지 않아 공식 성공 실응답을 확보하지 못함. 공식 가이드/로컬 시험 응답은 대체 통과 아님 |
| 날씨 실패 계약 | 통과 — `weather.test.ts`의 정규화·발표 지연/날짜 경계·실제 로컬 HTTP·부분 응답·인증 오류·deadline·취소·만료, Web/Native 상태 전환 |
| Web 실행 | 통과 — 위 dev/prod 검사·별도 production 화면 QA. live 날씨는 별개 미검증 |
| Native 실행 | 통과 — 앱 빌드·공통 계약·실제 HTTP XCTest·실행 UI를 각각 확인. live 날씨는 별개 미검증 |
| 경계·회귀 | 통과 — lint/typecheck/build, 63개 검사, 기존 Web/HTTP/WebKit 및 server-only bundle 검사 |

발견·수정: React `<title>`의 여러 children 때문에 문서 제목이 빈 값을 반환했습니다. 제목을 단일 문자열로 바꾸고 실패했던 dev/prod hydration 및 시설 제목 검사를 재실행했습니다. 공급자의 2월 30일 같은 잘못된 날짜를 Date가 다른 날로 보정하지 않도록 달력 유효성 검사를 추가하고 날씨 검사 3개도 재실행했습니다. 초기 테스트의 표본 빈칸 수와 격자 기대값도 실제 집계와 공식 C 예제 실행으로 바로잡았습니다(10행, 표본 공원 nx=52/ny=67). Native QA 스크립트의 좌표 탭/뒤로 버튼 범위 오류는 도구의 요소 탭으로 해당 흐름을 재확인했습니다.

조회 비용은 21행을 대상으로 `EXPLAIN (ANALYZE, BUFFERS)`를 1회 실행했습니다: 반환 21행, shared hit 5, execution 0.072ms. warm cache의 단일 표본이며 cold/warm 비교·운영 처리량·성능 개선 증거가 아닙니다.

로컬 증거는 `/tmp/cmon-pr2-research/`의 `check.log`, `web-tests.log`, `web-recheck.log`, `web-qa.json/log`, `native-build.log`, `native-uitest-build.log`, `native-tests.log`, `native-qa.log`, `native-*.json/png`, `web-*.png`, `query-plan.log`에 있습니다. 시설 capture는 저장소에 남기며 날씨 fixture는 합성임을 구분합니다.

**PR2 완료 미선언 / draft 유지:** 남은 필수 항목은 인증된 기상청 성공 실응답과 실제 값·시각·격자 대조입니다. API허브 키를 서버 환경에 연결해 이 경로를 실행한 뒤 수용조건을 다시 판정합니다. PR1의 XCUITest 발견 2개·실행 0개, 실기기·VoiceOver 전체 흐름 후속 미검증은 그대로 유지하며 이번 작업에서 runtime 설치·초기화·runner 재시도를 하지 않았습니다.

## 2026-09-13 프론트 아키텍처 검토·HTTP 계약 보완

Web과 Native가 조회 계약을 확인하고 응답 실패를 일관되게 처리하도록 현재 조회 3개의 OpenAPI와 웹 HTTP client를 연결했습니다. SSR의 service 직접 호출과 기존 WebView 경계는 유지했습니다. 단일 서버 구성과 Supabase 미연결 계획을 위에 명시했습니다. OpenAPI 생성 시 UUID 정규식의 대소문자 허용이 사라지지 않도록 기존 `i` flag를 동등한 명시적 문자 범위로 표현하고 HTTP/명세 대조에 대문자 UUID를 포함했습니다. 기존 TS/Swift 입력 허용 범위를 바꾼 것은 아닙니다.

환경: macOS 27.0, Node 22.22.3/npm 10.9.8, PostgreSQL 17.11. 이번 검사용 임시 DB cluster는 localhost 55433이며 실제 시설 21행을 import했습니다. Browser plugin not available: 저장소 Playwright E2E와 별도 Playwright CLI 세션을 사용했습니다.

| 실행 명령·검사 | 실제 결과·검증 수준 |
| --- | --- |
| `DATABASE_URL=… TEST_DATABASE_URL=… npm run check` | lint/typecheck, Vitest **66개 성공**(실제 PostgreSQL 3개 포함), client/server build, 서버 전용 코드·key·OpenAPI generator의 browser bundle 부재 확인 |
| `published OpenAPI matches actual HTTP reads…` | 실제 HTTP listener → 내려받은 OpenAPI → 독립 Ajv JSON Schema 검증. 공개 조회 3개, empty, 400/404/503, 대문자 UUID, 추가 필드 허용·모순된 날씨 거부. 이 검사의 service 데이터는 fixture이며, `actual HTTP API and SSR read DB changes…`에서 실제 DB 시설 목록·상세도 동일 명세와 대조 |
| `web HTTP client validates wire data…`, `web HTTP client distinguishes a closed connection…` | 실제 로컬 HTTP 응답으로 클라이언트 정규화, 잘못된 JSON/성공 응답 거부, 오류 metadata와 안전한 표시 메시지, 상세 404/목록 404 구분, 자동 재시도 없음, 소켓 종료, 응답 body 수신 중 취소·이미 취소된 요청 검증 |
| `DATABASE_URL=… TEST_DATABASE_URL=… npm run test:web -- --reporter=list` | dev/prod Chromium **22개 성공**. JS 없는 SSR·hydration 초기 API 0회·404/연결 실패/변경/복구·bridge 회귀 포함. 신규 잘못된 200 응답은 Playwright HTTP 가로채기이며 초기/복구 내용은 실제 DB 서버에서 조회 |
| `owned-run --server 'DATABASE_URL=… PORT=3006 npm start' --port 3006 --max-lifetime 600`, Playwright CLI `open/route/click/unroute/resize/eval/screenshot/console/requests` | 실행 production 화면에서 실제 DB 상세 → 잘못된 200 응답 주입 → 이전 정보·안내 표시 → 실제 DB 재조회 성공과 오류 제거. 1280×900 및 320×740/글자 200%, URL/title·본문·overlay 없음·가로 넘침 없음·화면 관측 확인. 요청 2회(주입/복구), 앱/hydration 오류 0. 콘솔의 기존 favicon.ico 404 1건은 별도 기록 |

로컬 증거는 `/tmp/cmon-api-contract-qa.8DkNbs/`의 `check.log`, `web-tests.log`, `owned/` 서버 로그, `.playwright-cli/` DOM·console·화면입니다. QA는 에이전트의 브라우저 자동조작이며 사람의 수동 QA가 아닙니다. Native 코드·wire 형태는 유지했으며 이번에 Simulator/실기기/XCUITest를 재실행하지 않았습니다.

HTTP 계약 전달 수용조건은 통과했습니다. **기상청 인증 성공 실응답은 여전히 필수 미검증이므로 PR2는 draft를 유지합니다.** 독립 Spring 서버 연동, 인증·계정 전환·참여 mutation, 데이터별 점진적 SSR·성능 측정, PR1의 XCUITest/실기기/VoiceOver 후속 검증을 이번 결과로 통과 처리하지 않습니다.

- [기여·브랜치·커밋 규칙](CONTRIBUTING.md)
- [PR1 수용조건](docs/pr1-acceptance.md)
- [제품·아키텍처 인계 문서](docs/CMON_YO_FINAL_HANDOFF.md)
