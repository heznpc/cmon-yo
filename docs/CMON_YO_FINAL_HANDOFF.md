# C'mon Yo! — 최종 제품·아키텍처 정리 / 구현 Handoff

> **문서 기준: 2026-09-12 · 구현 상태와 후속 순서 갱신: 2026-09-13**
> **문서 상태: 구현 기준선과 검증 계획. 구현·배포·성능 검증 완료 보고서가 아니다.**  
> PR1은 병합됐고 PR2는 날씨 성공 실응답 검증이 남은 draft다. 다음 구현 단위는 **§16의 PR3A 인증·계정 격리**이며 PR2와 별도 PR에서 진행한다. 실행 증거와 미검증은 README와 각 PR 수용조건을 따른다.

## 문서 읽는 법

이 문서는 기존 `CODEX_HANDOFF_v0.1`부터 `v0.1.2`까지의 내용과 이후 WebView·UX·SSR·트래픽 논의를 통합한다. 이전 문서와 충돌하면 이 문서를 기준으로 한다. 이전 문서 파일은 변경 이력으로 보존한다.

| 표기 | 의미 |
|---|---|
| **확정** | 사용자가 정한 제품 방향 또는 현재 구현에서 지킬 기준 |
| **구현 기준선** | 지금 사용할 설계. 실제 구현에서 문제가 확인되면 근거와 함께 최소 수정 가능 |
| **후보 / 검증 필요** | 비교하거나 실행해 볼 선택지. 채택·구현 완료로 취급하지 않음 |
| **외부 확인 사실** | 이번 정리에서 열람한 공개 코드·공식 문서의 내용. 문장 옆 출처와 확인 범위를 함께 읽음 |

외부 자료는 공개 구현에서 확인한 기술 선택과 제약을 참고하는 데 사용한다. 출처와 실제 확인 범위는 §19를 따른다.

외부 출처는 §19에 모았다. 출처가 없는 설계·정책·도입 조건은 **C'mon Yo!의 결정 또는 제안**이며, 외부 프로젝트의 내부 표준으로 해석하지 않는다. 공개 코드의 branch 링크는 가변 참조다. 실제 이식 시 commit SHA·라이선스·의존성을 고정해 확인한다.

### 이전 문서에서 더 이상 확정 사항으로 취급하지 않는 내용

- **“커뮤니티는 WebView”**: 기능 이름만으로 배치를 정하지 않는다.
- **“한 화면에 WebView와 Native를 섞지 않는다”**: 공존 가능. 상태·입력·스크롤·내비게이션 책임을 명시한다.
- **“모임 대화는 반드시 별도 WebView 화면”**: PR1의 시험 배치와 최종 제품 UX를 구분한다.
- **“HealthKit은 모임 참여 후 결과 읽기만을 위한 부가기능”**: 혼자 또는 함께 운동하는 상황 모두의 운동량 기능이다.
- **“두 번째 기능을 구현·배포하기 전에는 공통화 금지”**: 구체적인 예정 요구와 변경 비용을 함께 비교한다.
- **“meetup_comments가 threads보다 항상 낫다”**, **“나중에 반드시 modules로 이전한다”**: 정해진 발전 경로로 삼지 않는다.
- **“SSR이면 트래픽이 줄어든다”**, **“WebView는 진입할 때마다 SSR해야 한다”**: 렌더링·캐시·내비게이션 정책을 따로 판단한다.

---

## 1. 제품 정의와 유지할 목표

### 1.1 이름과 목적 — 확정

공식 제품명은 **C'mon Yo!**, 저장소명은 `cmon-yo`를 사용한다.

> Come on, yo. 오늘 동네에서 같이 움직이자.

핵심 문제는 다음이다.

> 오늘 동네에서 운동하고 싶은데 어디에서 할 수 있는지 모르고, 같이 운동할 사람을 구해도 실제로 올지 불확실하다.

제품의 중심은 **지역 + 운동 관심사 + 실제 장소 + 커뮤니티 + 오프라인 참여 신뢰**다. 동시에 개인 운동량을 확인하는 기능을 독립적으로 제공한다.

```text
현재 동네 / 위치
    → 날씨·주변 운동시설
    → 장소·기구·거리·운동 조건 확인
    ├─ 혼자 운동 → 개인 운동량·기록 확인
    └─ 모임 탐색·생성 → 참여 → 현장 체크인 → 함께 운동
                                      ↓
                         선택적으로 운동량·기록 확인
                                      ↓
                          댓글·후기·커뮤니티
```

모임 없이도 운동량 기능을 사용할 수 있고, HealthKit을 연결하지 않아도 모임에 참여하고 체크인할 수 있어야 한다.

### 1.2 제품의 성격 — 확정

C'mon Yo!는 지역 운동과 모임을 지속적으로 이용할 수 있는 서비스로 발전시킨다. **React Web과 SwiftUI 제품 화면을 각각 구현하는 것은 의도적인 선택**이다. 중복 UI 구현을 제거하는 방향으로 목표를 임의 축소하지 않는다.

공유하는 것은 주로 HTTP 계약, 서버 정책, 권한 판단과 영속 상태다. 각 클라이언트는 자체 UI·상호작용·플랫폼 기능·실패 복구를 구현한다. 클라이언트에서 입력을 검증하거나 사전 안내하는 것은 허용하지만, 그것을 서버의 최종 판정으로 대신하지 않는다.

현재 iOS는 **Swift / SwiftUI**다. React Native는 구현하지 않는다. README에는 실제 상태에 맞춰 **Swift native + React Web hybrid architecture**라고 적고, 하지 않은 RN migration 경험을 적지 않는다.

### 1.3 범위

**제품에 포함할 방향**은 Web·SwiftUI, 공공시설 ingest, 날씨, 지역·관심사 탐색, 모임 생성·참여·취소, 현장 체크인·수동 확인, 게시글·댓글, WKWebView 연결, HealthKit 운동량이다. 동네 인증·Push·리워드는 각 목적에 맞춰 후속 단계에서 구체화한다.

**지금 구현하지 않는 것**은 Next.js, React Native, 전체 카페 운영 시스템, 멤버 등급, 실시간 채팅, 전체 추천 엔진, 불필요한 AI 운동 코치, 이벤트 소싱, 마이크로서비스, Redis다. 이는 기능의 영구 금지 목록이 아니라 현재 필요와 실행 범위의 경계다. AI와 실험 플랫폼은 해결할 사용자 문제와 검증 방법이 구체적일 때 도입한다.

A/B 테스트와 실제 지표 개선 경험은 다른 프로젝트로도 보완할 수 있다. C'mon Yo!에서도 핵심 흐름을 구현하면서 최소 관측을 넣고, 사용자 피드백과 측정으로 개선을 검증한다. 이용자·표본 없이 A/B 결과나 성장 성과를 만들지 않는다.

---

## 2. 서비스 요구와 기술 선택

| 서비스 요구 | 구현 선택·참고 근거 | 적용과 검증 경계 |
|---|---|---|
| 초기 화면과 상호작용 연결 | React·Fastify SSR, `council`의 초기 props·HTML stream·hydration [D1] [D2] | 서버 수명주기를 구현하고 초기 데이터와 클라이언트 상태를 연결. 성능은 별도 측정 |
| 가까운 운동 모임 탐색 | 실제 시설과 지역·종목 필터 | 실제 모임 탐색부터 구현하고 추천 엔진은 이용 패턴을 확인한 뒤 판단 |
| 참석 상태의 신뢰 | 현장 체크인·수동 확인 | 위치 확인과 참석 결과를 분리하고 권한 거부·오차·수동 처리 경로 검증 |
| Web·Native 화면 연결 | SEED 상단바, Stackflow history 경계, MetaBridge 계약·driver 분리 [D3] [D4] [D5] | 필요한 화면에서 인증·입력·복귀 비용을 검증 |
| 변경 책임과 재사용 | 공통화가 예외·의존성을 늘린 회고 [B1] | 실제 요구와 변경 비용을 비교해 필요한 부분만 공유 |
| 운영·호환성·관측 | `council` tracing, 오래된 WebView 딥링크의 운영 사례 [D1] [B2] | 초기 데이터·렌더·전송을 구분하고 구버전 앱·링크 고려 |
| 개인 운동량 | SwiftUI·HealthKit | 모임 참여와 독립된 사용자 흐름으로 제공하고 권한·데이터 경계 검증 |

공개 자료의 일부 구현을 전체 서비스 구조로 일반화하지 않는다. 필요한 코드를 이식할 때 출처·라이선스·동작을 함께 확인한다.

### 2.1 현재 구현과 남은 검증 — 2026-09-13, HTTP 계약 보완 후 상태 기준

**공개 조회의 기술 기반은 구현됐으나, 사용자가 모임을 만들고 참여하며 소통하는 제품 흐름은 아직 없다.** 현재 동작과 남은 사용자 흐름을 구분한다.

| 기능·품질 | 코드·검증 근거 | 현재 동작과 다음 검증 |
|---|---|---|
| React·TypeScript·SSR | `src/server/app.ts`, `src/server/render.tsx`, `src/server/loaders/`, `src/app/entry-client.tsx`; `tests/server.test.tsx`, dev/prod Web E2E | 요청별 QueryClient, 안전한 직렬화, 중단·실패, hydration과 초기 중복 조회를 구현·검증했다. loader 완료 후 stream을 시작하므로 데이터별 점진적 표시·성능 개선은 미입증 |
| 프론트 ↔ 서버 계약 | `src/api/public.ts`, `src/server/openapi.ts`, `src/contracts/`; `tests/public-api.test.ts`, 실제 DB HTTP 검사 | 공개 조회 3개의 계약과 오류 복구가 있다. 인증 API·mutation 계약·독립 서버 배포는 후속 검증 |
| 사용자 화면·상태 | `src/features/meetup/MeetupPage.tsx`, `src/features/places/PlacesPage.tsx`; 정상→404/연결 실패→복구, 좁은 화면·글자 확대 실행 QA | 기본 조회 UX는 검증했다. 로그인 폼·작성 보존·참여 중 상태·필터/목록 복귀·개인 cache·계정 전환은 없음 |
| WebView | `src/app/bridge.ts`, `ios/CmonYo/Web/`, 실제 WebKit 통합과 Simulator 도구 QA | 읽기 전용 왕복과 발신자·종료 경계는 검증했다. 인증 공유·키보드 입력·작성 중 복귀는 후속. XCUITest는 발견 2·실행 0이며 통과 아님 |
| 실제 제품 데이터 | `db/001_places.sql`, `src/server/services/place.ts`; 공공시설 21행 import와 DB 검사 | 시설은 실제 데이터다. `src/server/services/meetup.ts`는 파일 fixture이며 실제 모집·참여·댓글 저장은 없다. 기상청 인증 성공 실응답은 필수 미검증 |
| 모니터링·개선 | `app.ts`의 `logger: false`, client의 hydration console 기록; §15는 계획 | 오류 테스트와 requestId는 있으나 운영 수집·지표 baseline·측정에 따른 개선은 아직 없다. 테스트 결과와 운영 지표를 구분 |
| 사용성·개발 검증 | README의 재현→수정→영향 검사 기록, 도구를 이용한 앱 QA | 기술 문제 해결 과정의 자료는 있다. 도구 QA는 사용자 인터뷰가 아니며 사용성/전환 개선은 미입증. 코드 변경의 이유와 재현·수정·재검증 결과를 계속 기록 |

React/Fastify·TanStack Query·Vite·vanilla-extract를 유지한다. 다음 작업은 로그인·모임 참여 화면의 입력, 서버 권한, 개인 상태와 실패 복구를 연결하는 것이다. OpenAPI와 실제 HTTP 검사는 서버 배치가 바뀌어도 유지할 경계다. Supabase는 인증 후보이며 현재 제품 DB는 직접 PostgreSQL 연결이다.

범용 컴포넌트·프레임워크를 선행 구축하지 않는다. 생성 폼·필터·댓글 등 실제 화면에서 반복되는 요구가 생기면 필요한 컴포넌트를 추출하고 키보드·포커스·오류 표시를 검증한다. 최종 브랜드는 후속 적용할 수 있다.

---

## 3. 전체 시스템 — 구현 기준선

```text
Browser                                      iOS App
React / TanStack Query                       SwiftUI / URLSession / Codable
vanilla-extract / Geolocation                 CoreLocation / HealthKit
hydrateRoot                                  WKWebView ↔ Native host
     │                                                │
     └──────────────── HTTPS / API v1 ────────────────┘
                              │
                      Fastify 단일 서버
                      ├─ JSON API routes
                      ├─ SSR loaders / renderer
                      └─ application services
                           ├─ 인증된 actor와 권한 확인
                           ├─ transaction / use-case 조합
                           └─ 순수 domain function 호출
                              │
              ┌───────────────┼────────────────┐
         PostgreSQL        Weather adapter     Auth adapter
         DB adapter            KMA             Supabase Auth
              ↑
        시설 sync script
        외부 공공데이터 → validation → normalize → upsert
```

한 저장소와 단일 Fastify 배포로 시작한다. iOS 앱은 별도 산출물이다. 모듈 경계를 갖춘 단일 서버를 지향하되, `modules/` 폴더 이름 자체를 목표로 삼지 않는다.

### 책임

| 책임 | 위치 |
|---|---|
| 제품 정책의 최종 판단 | 서버 service/domain |
| 영속 상태·참조 무결성·동시성 보장 | PostgreSQL transaction과 제약 |
| HTTP·SSR 연결 | Fastify |
| Web의 서버 상태 | TanStack Query |
| Web의 일시적 UI 상태 | React local state |
| iOS 화면 상태·권한 요청·기기 기능 | SwiftUI와 Native adapter |
| 건강 데이터 읽기와 로컬 해석 | HealthKit 연동 기능. 모임 서버가 원본 건강 데이터의 원장은 아님 |
| 외부 응답 포맷 | 각 adapter 내부 |

SSR loader와 API route는 **같은 service를 함수로 직접 호출**한다. Fastify가 자기 `/api/v1`을 다시 HTTP로 호출하지 않는다.

```text
SSR loader ─┐
            ├─ getMeetupDetail(...) → DB adapter
API route ──┘
```

Supabase Auth와 관리형 PostgreSQL은 후속 연결 후보이며, 현재 PR2 구현은 `pg`를 통한 PostgreSQL 직접 연결이다. Supabase 프로젝트·Auth 연동을 완료한 상태가 아니며, 현재 로컬 개발에 Supabase 계정·프로젝트·키는 필요하지 않다. PR3A의 인증 spike에서 실제 요구와 연결 결과를 확인해 채택 여부를 결정한다. 채택하더라도 제품 테이블 접근은 서버의 PostgreSQL adapter로 모은다. runtime role은 최소 권한으로 두고 migration/DDL 권한과 분리한다. 제품 테이블의 Data API 노출을 차단하며, 사용하지 않는 Data API의 비활성화 여부를 실제 설정에서 확인한다. Supabase 공식 문서는 Data API 접근 권한·schema·RLS 경계를 설명한다. [T4]

현재 HTTP 계약은 `GET /api/v1/openapi.json`으로 확인하며, Web은 얇은 HTTP client에서 JSON을 검증하고 TanStack Query로 화면 상태를 관리한다. SSR은 같은 service를 직접 호출하는 기준을 유지한다. 별도 Spring 제품 서버는 아직 없으며, 도입 시 SSR의 원격 API 호출·인증 전달·deadline을 별도로 검증해야 한다. Streaming renderer 사용과 데이터별 점진적 표시·성능 개선 입증을 구분한다.

직접 DB 연결에 기존 Supabase `auth.uid()` 기반 사용자 RLS가 자동 적용된다고 가정하지 않는다. service의 인가 테스트와 DB 제약을 별도로 구현한다.

---

## 4. 기능을 예상하고 경계는 먼저 만든다

**예정된 기능의 존재를 고려하는 설계는 지금 한다. 사용하지 않는 범용 프레임워크를 먼저 만드는 것은 하지 않는다.**

| 미리 분리할 경계 | 보장할 동작 |
|---|---|
| Meetup / Participation / Attendance | 참석 결과가 바뀌어도 참여 계약의 의미가 사라지지 않음 |
| 개인 운동량 / 모임·출석 | 혼자 운동 가능. 건강 데이터 부재가 모임 기능 실패가 되지 않음 |
| 운동량 / 리워드 | 보상 집계 실패가 운동 기록 실패로 표현되지 않음 |
| 댓글·본문 / 화면 호스트 | WebView·브라우저·추가 Native 화면이 동일 정책을 사용할 수 있음 |
| 날씨 사실 / 운동 적합도 정책 | 외부 코드 변경과 제품 판단 변경을 별도로 처리 |
| 공개 데이터 / 개인 상태 | 공개 콘텐츠를 재사용하면서 개인 정보와 최신 mutation을 격리 |
| 기능의 내부 구현 / 다른 기능의 접근 계약 | 화면 추가·삭제·교체가 관련 없는 정책까지 바꾸지 않음 |

호출 경계는 `HTTP/SSR → service → domain`이다. domain은 React·Fastify·TanStack·DB·외부 네트워크를 import하지 않는다. UI와 Swift는 서버 구현을 import하지 않고 HTTP 계약을 소비한다.

**“제거해도 작동한다”는 뜻은 선택 기능의 부재가 핵심 기능까지 전파되지 않는다는 뜻**이다. 필수 인증·DB 장애를 성공으로 숨기거나, 건강 데이터 없음·날씨 조회 실패를 0이나 맑음으로 바꾸는 뜻이 아니다. 코드 제거, 저장 데이터 보존, 배포된 앱 계약 유지도 별개다.

두 번째 구현을 기다리는 것은 재사용 판단의 경험칙일 뿐이다. 이미 요구가 구체적이면 처음부터 작은 공통 구조를 선택할 수 있다. 인증·인가·검증·DB 불변조건은 실제 사고가 난 뒤까지 기다리지 않는다. 구조 변경은 실제 요구와 유지보수 비용을 근거로 결정한다.

---

## 5. WebView와 Native의 UX 경계

### 5.1 확정할 원칙

**한 화면에 SwiftUI와 WKWebView가 공존할 수 있다.** Apple도 웹 콘텐츠를 Native UI와 결합하는 예를 설명한다. [T5]

WebView 개수나 웹 전환 비율을 목표로 삼지 않는다. 각 사용에는 아래 이유 중 실제로 해당하는 것이 있어야 한다.

| WebView 선택 이유 | 이익이 큰 조건 | 근거가 약한 조건 |
|---|---|---|
| 본문 renderer 공유 | 복잡한 서식·이미지 배치·링크 표현을 웹과 앱에서 동일하게 유지 | 단순 텍스트 카드이며 Native 표현이 이미 제품 목표인 경우 |
| editor·미리보기 공유 | 작성·서식·미리보기 규칙의 공통 운영 가치가 큼 | 단순 입력이며 bridge·키보드 비용이 더 큼 |
| Web UI 배포 | UI 자체가 자주 변하고 구버전 앱의 지원 계약 안에서 배포 가능 | 바뀌는 것이 API 데이터나 서버 정책뿐인 경우 |
| 공개 HTML의 초기 표시·재사용 | cold 진입에서 SSR 이익과 콘텐츠 재사용을 검증할 수 있음 | 전체 JS·hydration 비용이 더 크거나 이미 Native API로 충분한 경우 |

커뮤니티라는 이름, 검색 노출 필요, 서버에서 오는 데이터라는 이유만으로 앱까지 WebView로 만들지 않는다. 브라우저의 React SSR과 SwiftUI의 같은 API 소비는 함께 유지할 수 있다.

### 5.2 화면 배치의 현재 상태

| 영역 | 일반 웹 | iOS 기준 / 남은 선택 |
|---|---|---|
| 홈·날씨·장소 탐색 | React | SwiftUI 제품 화면 유지 |
| 장소·모임 목록/상세·생성 | React | SwiftUI 유지. 서식 본문의 부분 WebView는 이익이 있을 때 비교 |
| 참여·취소·현장 체크인 | React + API / Geolocation | SwiftUI + API / CoreLocation |
| 개인 운동량·HealthKit 연결 | 공통 기능만 별도 정의 | Native 독립 기능 |
| 게시글 피드 | React | SwiftUI와 WebView 모두 후보. title-first 피드라는 이유만으로 웹을 강제하지 않음 |
| 게시글 본문·편집 | React | 동일 renderer/editor 공유 가치가 있을 때 부분 또는 전체 WebView 비교 |
| 모임/게시글 댓글 목록·입력 | React | Native·Web·혼합 모두 가능. 작성·제출·갱신 책임을 정한 뒤 선택 |
| 앱 전체 탭·화면 컨테이너 | 웹 자체 navigation | Native 소유 |
| 웹 영역의 상단바·내부 history | 웹 소유 | 웹 또는 Native 중 소유자 지정. 동일 조작부를 중복 노출하지 않음 |

모임의 약속 지점·중요 안내는 참석자가 즉시 찾을 수 있어야 한다. 필요한 정보가 대화 전체 로딩 뒤에만 나타나는 구조는 피한다.

### 5.3 유효한 혼합 구성의 예 — 후보

```text
SwiftUI 화면
├─ Native 상단바 / 공유
├─ WKWebView: 본문·댓글 목록
└─ Native 댓글 입력 / 첨부 / 등록
```

이 경우 Native가 draft·첨부·제출 요청·제출 중 상태를 소유한다. 서버 성공 후 웹에 **대상 리소스가 변경됐다는 알림**을 보내고, 웹은 필요한 query만 갱신한다. 이벤트를 놓쳤다면 복귀 시 재검증한다. 웹에 타이핑 상태를 매번 복제하거나 두 클라이언트가 동시에 제출하지 않는다.

반대로 목록·작성·미리보기를 하나의 WebView 흐름으로 묶는 선택도 가능하다. 혼합이 우수하거나 전체 웹이 우수하다고 미리 정하지 않는다.

### 5.4 각 화면의 경계 명세

실제 기능 구현 전 다음 항목을 한 표로 기록한다. PR1에서는 fixture 화면의 경계만 작성하면 된다.

| 항목 | 기록할 내용 |
|---|---|
| 진입 목적 | 어떤 사용자 행동에서 웹/Native 영역으로 들어오는가 |
| 소유권 | draft, 제출, 스크롤, 내비게이션을 누가 변경하는가 |
| 복귀 | 원래 리소스로 돌아갈지 새 화면을 열지, 중복 push 방지 방식 |
| 상태 보존 | draft·선택 사진·스크롤·목록 위치의 유지 범위 |
| 실패 | 웹 로딩·권한·인증·요청 실패 시 남겨야 할 기능 |
| 비용 | 첫 진입과 반복 진입의 HTML/API 요청·전송량·메모리 |

키보드, safe area, 뒤로 스와이프, 이미지 로딩 후 높이, 접근성 포커스, 작성 중 이탈을 실제 기기에서 검증한다. WebView를 유지하면 cold 재로딩을 줄일 가능성이 있지만 메모리 비용이 생기므로 무제한 상주시키지 않는다. 프로세스 종료·재생성 시의 복구도 따로 테스트한다.

---

## 6. SSR·캐시·트래픽의 타협점

### 6.1 서로 다른 결정을 섞지 않는다

**UI 배치:** SwiftUI / React / WKWebView 중 무엇이 표현하는가.  
**데이터 경계:** 공개·개인·빠르게 바뀌는 상태 중 무엇을 언제 가져오는가.  
**렌더링·전달:** SSR HTML / JSON / 정적 asset 중 무엇을 전송하고 재사용하는가.

공개 본문과 개인 상태를 분리하는 이익은 전부 React인 화면에서도 얻을 수 있다. 따라서 SSR·캐시 효율만으로 Native 입력창이나 WebView 사용을 정당화하지 않는다.

### 6.2 초기 표시와 반복 행동

초기 데이터를 포함한 SSR과 Query hydration은 클라이언트의 초기 데이터 대기를 줄이고 동일 조회의 불필요한 재실행을 피할 수 있는 방식이다. request별 QueryClient와 freshness 설정이 필요하다. [T2]

그러나 SSR은 서버 렌더 작업을 추가하며 HTML·초기 데이터·JS를 전달한다. 다음을 별도 지표로 취급한다.

| 지표 | 의미 |
|---|---|
| 첫 콘텐츠 표시 | 사용자가 제목·본문을 볼 수 있는 시각 |
| 상호작용 준비 | 필요한 hydration과 조작이 가능한 시각 |
| TTFB | 응답 첫 바이트 수신 시각. 본문 표시·조작 준비와 같지 않음 |
| 서버 비용 | data 조합, React 렌더, DB 조회, 동시 요청의 메모리·연결 사용 |
| 전송량 | HTML·초기 JSON·JS/CSS·이미지의 실제 전송량 |

기준 가설은 **공개 콘텐츠 첫 진입에는 SSR, 반복 이동과 mutation 이후에는 필요한 데이터만 갱신**이다. 이는 구현·측정으로 확인할 가설이며, 캐시가 없는 새 WebView 문서 로드는 다시 SSR될 수 있다.

WebView 안에서의 클라이언트 내비게이션·cache 재사용은 직접 구현·설정해야 한다. `renderToPipeableStream`을 쓴다는 이유만으로 자동 제공되는 기능이 아니다.

### 6.3 공개 상세와 개인 상태

```text
공개 상세
  제목 / 본문 / 공개 장소 / 종목 / 공개 일시

개인·빠른 상태
  내 참여·출석 / 현재 행동 가능 여부 / 반응 상태 / 최신 정원
```

개인 상태는 공개 HTML의 serialized query state에도 포함하지 않아야 공유 캐시 후보가 된다. 본문에 보이지 않아도 cookie·CSRF token·사용자 capability·private DTO가 들어 있으면 같은 문제다.

공개/개인 분리는 **의미상의 계약 경계**다. PR1부터 endpoint를 모두 둘로 늘릴 필요는 없다. 다만 인증된 viewer 정보가 포함된 응답 전체는 shared cache에 저장하지 않는다. 이후 공개 응답을 공유하려면 viewer 전용 조회 등 실제 HTTP 계약도 분리하고 테스트한다.

### 6.4 데이터별 전략 — 후보와 기준선

| 데이터 | 초기 전달·갱신 제안 | 주의 |
|---|---|---|
| 시설명·기구·관리 정보 | 상세 SSR 포함, 데이터 갱신과 맞춘 재사용 검토 | importer 갱신 시 오래된 응답 처리 |
| 날씨 | 예보 격자·발표/대상 시각별 짧은 재사용 | staleness 표시. 모든 요청에서 무조건 외부 재조회하지 않음 |
| 모임 공개 상세 | 직접 진입 SSR, 변경 후 관련 query 갱신 | 취소·공개 범위 변경·일시 변경은 가볍게 캐시하지 않음 |
| 공개 게시글 본문 | renderer 공유와 SSR/cache 이익 비교 | 수정·삭제·비공개 전환의 무효화 필요 |
| 개인화 피드·정확한 사용자 위치 | private 처리 | 사용자별 응답의 공유 캐시 금지 |
| 내 참여·출석·리워드 | 인증된 요청과 서버 판정 | 오래된 화면·cache를 mutation 권한으로 사용하지 않음 |
| 댓글·좋아요 | 관련 query만 갱신 | 문서 전체 reload를 기본 전략으로 삼지 않음 |

**서버 첫 요청은 사용자의 현재 GPS를 알지 못한다.** 선택 동네 query/cookie로 시작하고, 위치 동의 후 실제 거리 등을 갱신한다. cookie의 동네에 따라 내용이 바뀌는 홈 HTML을 아무 조건 없이 공유 캐시하지 않는다.

### 6.5 캐시는 안전한 기준선에서 확장한다

초기에는 인증·개인화 응답과 구분이 끝나지 않은 HTML에 `Cache-Control: private, no-store`를 기본으로 둔다. PR1에 CDN이나 공유 HTML cache를 추가하지 않는다. 안전성이 확인된 공개 JSON·HTML과 hash asset만 별도로 정책을 부여한다.

HTTP의 private/shared cache와 `no-cache`/`no-store`는 다른 개념이며, 응답이 cookie를 사용한다는 이유만으로 자동으로 안전한 개인 cache가 되지는 않는다. 실제 header와 cache 동작을 확인한다. [T3]

공유 캐시 도입 전 확인할 것은 다음이다.

- 응답이 로그인 여부와 무관하게 동일한 공개 내용인지, 세션 발급 `Set-Cookie`나 개인 bootstrap이 없는지.
- 지역·언어·embedded 화면 차이 등 representation이 cache key에 반영되는지.
- 새 버전 JS asset과 HTML의 호환성, CSP header와 문서 내 nonce의 일관성을 유지하는지.
- 삭제·비공개 전환·취소에 필요한 무효화 또는 재검증을 제공하는지.
- 오류·부분 전송·timeout 응답을 정상 문서처럼 저장하지 않는지.
- 실제 CDN/proxy가 streaming을 buffer하는지, HTML cache가 데이터 노출을 만들지 않는지.

개인화 응답에 `Vary: Cookie`만 붙여 공유 안전성이 해결됐다고 보지 않는다. 공유할 수 없는 응답은 명시적으로 제외한다. 댓글·장소 같은 JSON도 공개성 조건을 만족하면 캐시할 수 있으므로, CDN 효율은 WebView만의 장점이 아니다.

### 6.6 트래픽 모델과 측정

```text
SSR CPU 비용 ≈ 실제 origin 렌더 횟수 × 1회 렌더 CPU 비용
DB 비용       ≈ 실제 조회 횟수 × 각 조회 비용
전송량        ≈ 각 리소스의 전송 바이트 합
```

이는 측정 항목을 나누기 위한 단순 모델이다. render wall time에는 I/O 대기가 섞일 수 있으며 요청 수만으로 용량을 보장하지 않는다. 동시 연결·메모리·DB pool 대기도 함께 확인한다.

`첫 열기 → 댓글 등록 → 다른 화면 이동 → 같은 콘텐츠 복귀`에서 cold/warm 경로를 구분하고 HTML 요청 수, 실제 SSR 수, API 중복, JS/이미지 바이트, 사용자 체감 시간을 기록한다. Native와 웹이 같은 데이터를 두 번 가져오는지도 포함한다.

정확한 TTL, 성능 목표, CDN 도입 여부는 아직 확정하지 않는다. 실제 지역 파일럿과 배포 환경에서 baseline을 얻은 뒤 정한다. 측정 전 개선율이나 감당 가능한 사용자 수를 쓰지 않는다.

---

## 7. Fastify / Vite / React SSR bootstrap

### 구현 흐름

```text
Fastify request
  → route / 필요한 인증 / 선택 동네 결정
  → request별 QueryClient
  → 필수 초기 데이터 + 대기 한도가 있는 보조 데이터
  → query cache / dehydrate
  → renderToPipeableStream
  → onShellReady에서 응답 stream 연결
  → hydrateRoot + HydrationBoundary
  → 이후 필요한 JSON query / mutation
```

독립적인 조회에만 병렬 처리를 적용한다. 날씨 위치가 장소 조회에 의존하면 그 의존성을 그대로 표현한다. `Promise.allSettled` 자체는 timeout이 아니므로 외부 요청에 deadline과 취소를 따로 둔다.

필수 데이터 실패를 정상 빈 목록으로 바꾸지 않는다. 정상 0건, DB 오류, 날씨 timeout, 오래된 날씨 사용을 UI·응답에서 구분한다. 접힌 댓글 전체·다음 페이지처럼 첫 판단에 필요 없는 데이터까지 SSR에 넣지 않는다.

이번에 확인한 `council`은 초기 `getPageProps` 처리와 HTML stream을 연결하며, props만 반환하는 경로도 갖고 있다. client entry에는 `hydrateRoot`가 있다. 이는 참고 구현이지 C'mon Yo!의 성능 결과나 해당 팀 전체 아키텍처의 증거가 아니다. [D1] [D2]

### 구현 가드레일

- 서버의 QueryClient는 요청별로 생성한다. 브라우저의 QueryClient는 해당 앱 세션에서 안정적으로 유지한다. 같은 business state를 pageProps와 query cache 양쪽의 변경 가능한 원본으로 만들지 않는다.
- query key·초기 데이터·`staleTime`을 맞춰 불필요한 즉시 재조회를 막는다. 정원·개인 상태처럼 필요한 최신성 검증까지 금지하지 않는다. [T2]
- 개발 Vite 경로와 production build/asset manifest 경로를 구분한다. production에서 Vite dev server를 띄우지 않는다. vanilla-extract CSS도 최종 HTML/asset에 포함되는지 확인한다.
- React의 shell 오류·일반 렌더 오류·abort·client disconnect와 stream 정리를 처리한다. 이미 응답이 시작된 뒤 상태 코드를 자유롭게 바꿀 수 있다고 가정하지 않는다. [T1]
- 초기 상태에 비밀 키·인증 token·raw 위치를 넣지 않는다. 사용자 콘텐츠를 `JSON.stringify`만으로 script에 삽입하지 않고 안전한 직렬화와 `</script>` 회귀 fixture를 사용한다.
- HTML/Markdown 본문과 링크는 별도의 sanitizer·허용 scheme 검사를 적용한다. 직렬화 안전성과 게시글 XSS 방어는 같은 작업이 아니다.
- 서버와 첫 client render가 같은 locale·시간 기준·초기 상태를 사용하도록 한다. 브라우저 GPS와 플랫폼 전용 처리는 hydration 후 실행한다.

현재 정확한 설명은 다음이다.

> Fastify에서 초기 SSR 데이터를 조합하고 React `renderToPipeableStream`으로 HTML을 스트리밍하며, hydration 이후 상호작용 데이터는 TanStack Query가 관리한다.

**Suspense 기반 데이터 스트리밍, TTFB 개선, production proxy에서의 즉시 flush까지 검증했다는 뜻은 아니다.** 실제 점진적 콘텐츠 전송에는 적절한 Suspense/data 구성이 필요하다. [T1]

의존성 버전은 공개 저장소의 오래된 값을 복사하지 않는다. PR1에서 Node·Fastify·Vite·React·플러그인의 작동 조합을 확인하고 lockfile과 실행 환경을 기록한다.

---

## 8. 외부 데이터: 시설 ingest와 날씨

### 8.1 시설 — 구현 기준선

```text
공공데이터 API / 제공 파일
  → 원본 validation
  → normalize
  → dry-run diff
  → transaction / upsert
  → 내부 DB를 서비스 요청에서 조회
```

**실제 dataset ID, 인증키, source identity는 아직 확정되지 않았다. 추측해서 구현하지 않는다.** PR2에서 실제 샘플을 보고 한 행이 장소인지, 장소+기구인지, 안정적인 식별자가 있는지, 여러 기구가 어떻게 반복되는지 확인한다.

같은 입력을 두 번 적용해도 중복이 없어야 한다. 이름·주소를 무조건 고유키로 삼지 않는다. 수집 실패·부분 페이지 수집을 시설 삭제로 해석하지 않는다. 삭제·비활성화는 수집 범위와 source 의미를 확인한 뒤 처리한다.

실패 행·수집 건수·변경 건수·실행 시각을 기록한다. API key를 로그에 남기지 않는다. 전국 확장 전에 지역 파일럿으로 데이터 품질과 조회 비용을 확인한다.

### 8.2 날씨 — 구현 기준선

KMA adapter가 외부 코드를 내부 weather facts로 정규화한다. UI·모임 domain에 `TMP`, `PTY`, `POP`, `WSD` 같은 공급자 코드를 노출하지 않는다. 실제 필드와 예보 종류는 PR2에서 공식 API 응답으로 확인한다.

외부 날씨 사실과 운동 적합도는 구분한다. 아래는 **내부 계약의 개념 예시**이며 공급자 스키마를 확정한 코드는 아니다.

```ts
type WeatherFacts = {
  temperatureC: number | null
  precipitationProbabilityPercent: number | null
  precipitationType: "none" | "rain" | "snow" | "mixed" | "unknown"
  windSpeedMetersPerSecond: number | null
  issuedAt: string | null
  validAt: string
  fetchedAt: string
}

type OutdoorSuitability = "good" | "caution" | "bad" | "unknown"
```

미지원 코드·누락값을 맑음 또는 0으로 바꾸지 않는다. `fresh / stale / unavailable`은 값 자체와 별도로 표현한다. 적합도는 version이 있는 프로젝트 정책이며 모든 운동의 안전을 보증하는 판단으로 표현하지 않는다.

예보 격자와 발표·대상 시각, endpoint 종류를 구분해 제한된 process-local TTL cache를 검토한다. 용량 상한·timeout·취소·동일 요청 결합을 실제 필요 범위에서 구현한다. 다중 서버 간 공유를 보장하는 cache는 아니며, cache가 없어도 기능의 정합성이 유지돼야 한다. Redis를 선행 조건으로 넣지 않는다.

---

## 9. 참여·출석·현장 체크인

### 9.1 상태는 두 축 — 확정

```ts
type ParticipationStatus =
  | "joined"
  | "cancelled"
  | "late_cancelled"

type AttendanceStatus =
  | "pending"
  | "checked_in"
  | "no_show_pending"
  | "attendance_unverified"
  | "no_show"

type ParticipationState =
  | {
      participationStatus: "joined"
      attendanceStatus: AttendanceStatus
    }
  | {
      participationStatus: "cancelled" | "late_cancelled"
      attendanceStatus: null
    }
```

`pending`은 출석 확인 대기, `null`은 취소로 출석 평가 대상이 아님을 뜻한다. 수동 검토 요청의 상태는 `attendance_reviews`에서 관리한다.

| 상황 | participationStatus | attendanceStatus |
|---|---|---|
| 참여 생성 | joined | pending |
| 위치 체크인 또는 출석 수동 확인 | joined | checked_in |
| 종료 후 출석 확인 대기 | joined | no_show_pending |
| 검토 기한 종료·근거 불충분 | joined | attendance_unverified |
| 별도 검토로 노쇼 확정 | joined | no_show |
| 허용된 정상 취소 | cancelled | null |
| 허용된 지각 취소 | late_cancelled | null |

두 enum으로 분리했다고 모든 조합이나 전이가 허용되는 것은 아니다. 클라이언트는 참여·취소 의도만 전달하며 `late_cancelled`와 출석 판정은 서버가 결정한다.

### 9.2 순수 판정과 저장의 분리

```text
인증된 요청
  → service가 권한·최신 DB 상태·server time 준비
  → evaluateCheckIn({ meetup, participation, position, now, policy })
  → transaction에서 결과 반영
  → 두 상태와 명시적 결과 반환
```

검사 순서는 모임 유효성, 참여 자격, 체크인 시간 범위, 위치 값·샘플 freshness·accuracy, 약속 위치와 거리다. `now`는 테스트에서 주입한다. client의 `capturedAt`은 검증할 입력이지 신뢰할 시간 증거가 아니다.

반경·시간·accuracy 임계값은 policy로 전달하고 version을 남긴다. 현재 검증된 운영 임계값은 없다. 테스트값을 검증된 운영 정책이나 현장 검증 완료 기준으로 표시하지 않는다.

GPS 성공은 **정책상 위치 확인**이지 GPS 조작 방지나 실제 운동 수행의 증명이 아니다. 동네 선택·동네 인증·현장 체크인도 서로 다른 개념이다.

### 9.3 실패와 노쇼

GPS 부정확·권한 거부·오래된 샘플만으로 `no_show`를 확정하지 않는다. 재시도와 수동 확인을 제공하며 수동 확인 요청 생성 자체가 출석 결과를 덮어쓰지 않는다.

종료 후 script는 조건을 만족하는 `joined + pending`만 `joined + no_show_pending`으로 전환한다. 근거가 충분하지 않은 채 기한이 끝나면 `attendance_unverified`로 닫을 수 있다. `no_show`는 별도 권한과 검토를 통과해야 하며, 첫 버전에는 공개 신뢰 점수·자동 불이익을 구현하지 않는다.

주최자 출석 확인과 GPS 확인은 metadata로 구분한다. 모임 취소는 `meetups.status` 변경이다. 기존 체크인 결과를 참가 취소로 덮어쓰지 않고, 취소된 모임을 후속 체크인·노쇼 평가에서 제외한다.

### 9.4 동시성·멱등성

`(meetup_id, user_id)`를 unique로 둔다. 모임 생성 시 주최자 participation도 `joined + pending`으로 만들고 정원에 포함한다. 정원은 `participation_status = 'joined'` 기준이다.

참여·취소·정원 관련 변경·체크인에서 필요한 lock 순서를 **meetup → participation**으로 통일한다. service는 transaction 안에서 최신 상태와 정원을 읽고 순수 규칙을 적용한다. PostgreSQL의 행 잠금은 같은 행에 대한 동시 변경을 조정하는 도구이며, 관련 쓰기 경로가 같은 규칙을 지켜야 한다. [T7]

마지막 한 자리에 동시 요청을 보내도 한 명만 새로 참여해야 한다. 완료된 동일 요청의 재시도는 원래 결과를 반환하고 이벤트를 중복 집계하지 않는다. 모임 생성에는 actor별 clientRequestId 등으로 중복 생성 방지를 둔다.

확인되거나 검토 중인 출석을 취소·재참여로 초기화하는 경로를 허용하지 않는다. 주최자 변경·시간/장소 변경·재참여 같은 추가 전이는 기능을 제공하기 전에 명시한다. 초기에는 참가자가 있는 모임의 시간·장소를 알림 없이 바꾸는 기능을 제공하지 않는다.

### 9.5 위치 데이터 최소화

사용자 raw 좌표는 판정 요청 처리에만 사용한다. DB·URL·분석 event·request body log·persisted Query cache에 남기지 않는다. 좌표가 포함된 오류 객체나 breadcrumb도 redaction한다.

저장할 것은 결과, 확인 방식, 확인 시각, 정책 version, 확인 주체다. 이 선택은 원본 위치로 분쟁을 재검증하는 능력을 제한한다는 trade-off가 있다. 공공시설 좌표·모임의 약속 좌표와 개인 위치 이력은 구분한다.

---

## 10. DB 모델과 댓글 저장 결정

### 10.1 핵심 테이블 — 구현 기준선

| 테이블 | 핵심 필드·책임 |
|---|---|
| profiles | auth subject, 표시 이름, 선택 동네. 선택 동네는 인증 배지가 아님 |
| places | source dataset/key, 지역, 장소명, 주소, 좌표, 관리기관, source 갱신 시각, synced_at |
| place_equipment | place_id, source item key, 기구명, 수량 |
| meetups | host_id, place_id, 제목·설명·종목, starts_at/ends_at, capacity, status, 실제 약속 위치 |
| participations | meetup_id/user_id, participation_status, joined_at/cancelled_at, attendance_status, verified_at/method/by, policy_version |
| attendance_reviews | participation_id, 요청 이유, 요청·결정 시각, 검토 상태·결정 주체 |
| posts | 작성자, 지역·종목, 제목·본문, 생성·수정·삭제/공개 범위. 게시글 구현 시 생성 |

시설 identity는 표본 확인 후 확정한다. 기본 제약은 source unique, FK, 시간 순서, 좌표 범위, 수량·정원 유효성, 참여 unique다. 열의 허용 enum 값 검사와 함께 아래 조합 제약을 적용한다.

```sql
CHECK (
  (participation_status = 'joined' AND attendance_status IS NOT NULL)
  OR
  (participation_status IN ('cancelled', 'late_cancelled')
   AND attendance_status IS NULL)
)
```

확인 metadata는 실제 출석 결과와 일치시킨다. 동일 참여의 열린 review는 중복 생성하지 않는다. 첫 인덱스는 지역·장소별 모임·시작 시각·참여 상태 등 실제 route에 맞춰 선정하고 조회 계획으로 확인한다.

장소와 모임은 게시글의 하위 변형으로 억지로 합치지 않는다. 정원·시간·참여·출석 규칙은 일반 게시글과 별도로 유지한다.

### 10.2 댓글 — DB 선택은 아직 확정하지 않음

후보는 `meetup_comments + post_comments`와 작은 `threads + comments`다. 공개 API는 `/meetups/:id/comments`, `/posts/:id/comments`처럼 리소스 중심으로 유지할 수 있어 내부 테이블 추출과 분리 가능하다.

**최초 댓글 migration을 작성할 때**, 이미 예정된 두 용도의 읽기/쓰기 권한, 답글, 수정·삭제, 공개 범위, 운영 정책, 페이지네이션, 이식 비용을 비교하고 하나를 선택한다. 두 기능의 배포를 기다리거나 일부러 이중 테이블을 먼저 만들 필요는 없다.

선택과 무관하게 부모 댓글은 같은 대화 대상이어야 한다. 생성 후 부모 변경을 막고, 자기 참조·순환·깊이 정책을 검증한다. 삭제된 부모와 답글의 표시 규칙을 정한다. cursor pagination 시 부모가 페이지 밖에 있다는 이유만으로 잘못된 tree를 만들지 않게 조회 단위도 함께 설계한다.

UI tree 함수 재사용과 DB 일반화는 다른 결정이다. `threadId`를 미래 편의를 위해 PR1 DTO에 미리 넣지 않는다.

### 10.3 출석 이력과 건강 데이터

현재는 participation 한 행에 하나의 출석 결과를 둔다. 이후 출석을 1:1 테이블로 옮기는 것만으로 여러 시도·검토·override의 이력이 생기지는 않는다. 독립 수명주기와 1:N 이력 요구를 구분한다. 현재는 review 외의 범용 event store를 만들지 않는다.

HealthKit 원본 저장 테이블이나 보상 원장을 PR1에 만들지 않는다. 운동 기록의 클라우드 동기화·리워드를 구현할 때 필요한 최소 데이터와 권한·보존·중복 방지 계약을 별도로 정의한다.

---

## 11. API·계약·클라이언트 상태

### 11.1 계약 기준

HTTP JSON은 camelCase, ID는 문자열, 시각은 UTC ISO 8601, 거리 m, 온도 섭씨, 풍속 m/s를 기본으로 한다. 날짜별 모임 조회는 어떤 timezone의 날짜인지 계약에 명시한다. 임의 local timezone 해석에 의존하지 않는다.

Zod 입력/출력 schema와 **동일 JSON fixture**를 기준으로 TypeScript validation과 Swift Codable decode를 검증한다. 초기에는 수기 Swift DTO를 사용한다. codegen 도입 여부는 안정된 계약에서 발생하는 동기화 비용·오류를 근거로 정하며 API 개수만으로 결정하지 않는다.

새 서버와 기존 앱이 공존할 수 있도록 필드 추가·null/누락·알 수 없는 enum·오류의 처리 규칙을 정한다. 구버전 앱이 모르는 상태를 기존 성공 상태로 바꾸지 않는다. 읽기는 안전한 unknown 표시, 지원하지 않는 행동은 비활성화 등 명시적 fallback을 사용한다. 서버 입력은 엄격하게 검증한다.

fixture 하나의 decode 성공은 전체 호환성 보장이 아니다. 이전 버전 fixture와 오류·optional 필드·unknown 상태를 후속 계약 테스트에 포함한다.

### 11.2 API 목록 — 단계별 구현 대상

| API | 목적 / 구현 시점 |
|---|---|
| GET /api/v1/meetups/:id | PR1 공개 fixture. 이후 실제 모임 상세 |
| GET /api/v1/home?regionCode=&sport= | 동네의 장소·모임·조건 조합 |
| GET /api/v1/places/:id | 장소·기구 상세 |
| GET /api/v1/meetups?placeId=&date= | 모임 목록 |
| POST /api/v1/meetups | 인증된 모임 생성 |
| PUT /api/v1/meetups/:id/participation | 참여/취소 의도 |
| POST /api/v1/meetups/:id/check-ins | 위치 입력·서버 판정 |
| POST /api/v1/participations/:id/verification-requests | 본인의 수동 확인 요청 |
| POST /api/v1/participations/:id/attendance-confirmations | 권한 있는 주최자의 출석 확인 |
| GET/POST /api/v1/meetups/:id/comments | 모임 댓글 |
| GET/POST /api/v1/posts | 게시글 목록·작성 |
| GET /api/v1/posts/:id | 게시글 상세 |
| GET/POST /api/v1/posts/:id/comments | 게시글 댓글 |
| POST /api/v1/auth/web-session | **인증 spike 후보**, 확정 공개 API가 아님 |

노쇼 판정 권한을 출석 확인 API에 암묵적으로 섞지 않는다. 해당 검토 기능을 구현할 때 별도 actor·허용 전이·API를 정의한다.

```ts
type ParticipationInput = { state: "joined" | "cancelled" }

type CheckInInput = {
  position: {
    latitude: number
    longitude: number
    accuracyMeters: number
    capturedAt: string
  }
}

type ApiError = {
  error: {
    code: string
    message: string
    requestId: string
    retryable: boolean
    manualVerificationAllowed?: boolean
  }
}
```

주요 오류는 UNAUTHENTICATED, FORBIDDEN, MEETUP_FULL, MEETUP_CANCELLED, NOT_JOINED, OUTSIDE_CHECK_IN_WINDOW, POSITION_STALE, POSITION_INACCURATE, OUTSIDE_RADIUS 등이다. HTTP status와 machine-readable code를 함께 정의하고 성공 응답으로 오류를 숨기지 않는다.

`viewerParticipation`은 참여 기록이 없으면 null, 있으면 §9의 두 필드를 반환한다. **PR1 fixture는 null**이다. 추후 개인 응답에 들어가는 capabilities는 UI 힌트일 뿐 mutation 권한 검사를 대체하지 않는다.

### 11.3 Query와 mutation

query key는 지역·리소스 ID·필터·개인화 범위를 명시한다. 로그인·계정 전환에서 이전 계정의 cache와 늦은 응답이 새 계정에 섞이지 않도록 cancel/clear와 identity 경계를 둔다.

참여·체크인은 서버 성공 전에 확정 성공으로 표시하지 않는다. 버튼 pending은 가능하다. 좋아요처럼 되돌리기 쉬운 동작은 필요할 때 optimistic update와 rollback을 적용한다.

화면 복귀 시 필요한 resource를 재검증한다. 문서 전체 reload나 WebView 재생성을 기본적인 mutation 후 갱신 방법으로 쓰지 않는다. 모든 query를 일괄 invalidate하기보다 변경된 대상부터 갱신한다.

---

## 12. 인증과 Native–Web bridge

### 12.1 고정 요구사항과 후보 방식

**고정 요구사항**은 같은 사용자 identity, 서버 인가, 자격 증명 비노출, 계정 격리다. 구체적인 세션 교환 방식은 **Proposed / 미실행**이다.

기준 후보는 Supabase Auth의 같은 subject를 사용하고, Native API는 Bearer access token, Browser/WKWebView는 서버가 관리하는 same-origin HttpOnly cookie로 접근하는 구조다. Native의 장기 credential은 Keychain에서 관리한다.

```text
Native access token
  → Fastify web-session 후보 endpoint
  → 서버 identity 검증
  → 짧은 수명의 WebView cookie 발급
  → WKHTTPCookieStore에 설치 완료
  → 허용된 Web 콘텐츠 로드
```

cookie 형식·검증·만료·갱신·폐기는 spike에서 확정한다. 후보에서는 원 access token보다 긴 권한을 새로 발급하지 않는다. Native refresh token을 WebView에 전달하지 않고, token을 URL·DOM·bridge·log에 넣지 않는다.

Browser 인증도 로그인·갱신·로그아웃 경로를 실제 provider 흐름에 맞춰 검증한다. 인증 cookie의 Secure/HttpOnly/host 범위·SameSite/CSRF 정책은 채택한 로그인 방식과 함께 확인한다. `embed=1` 같은 표시 플래그는 인증 근거가 아니다.

### 12.2 인증 spike의 완료 조건

| 시나리오 | 확인할 것 |
|---|---|
| 로그인 | Native와 WebView 요청의 subject 일치 |
| 갱신·만료 | token/cookie 교체 순서, 실패 표시, 무한 재시도 방지 |
| 앱 재시작 | credential 유효성 확인과 화면 복원 |
| 로그아웃 | credential·cookie·웹 화면·개인 cache 정리 |
| 계정 전환 | A의 늦은 요청·페이지 상태가 B에 섞이지 않음 |
| 잘못된 자격 증명 | 서버 거부, 노출 없는 오류 |
| cookie mutation | CSRF/Origin 방어와 인가 |
| 충돌 identity | Bearer와 cookie가 다른 사용자를 가리키는 요청 처리 |

로컬 로그아웃과 이미 발급한 credential의 즉시 서버 폐기는 동일하지 않다. 실제 보장 범위를 확인해 기록한다. 기존 ADR-001은 이 검증의 보조 기록이며, 본 문서의 미확정 상태를 유지한다.

PR1에는 인증을 넣지 않는다. 인증을 필요로 하는 혼합 화면을 본격 확대하기 전에 이 경계를 검증한다.

### 12.3 bridge v1 — 제한된 의도 전달

메시지는 version, requestId, type, 검증된 payload를 갖는다. PR1은 capabilities와 openMeetup만 필수로 하고, openPlace 등은 실제 화면에서 필요한 단계에 추가한다.

```ts
type OpenMeetupMessage = {
  version: 1
  requestId: string
  type: "openMeetup"
  payload: { meetupId: string }
}
```

웹은 Swift navigation path를 직접 수정하지 않는다. Native host에 의도를 전달하고, browser host는 같은 의도를 웹 navigation으로 연결한다. 현재 모임과 같은 대상으로 돌아올 때 중복 화면을 쌓지 않게 한다.

실제 발신 frame의 scheme/host/port와 main-frame 여부를 검사한다. payload가 주장하는 origin이나 현재 top-level URL만 믿지 않는다. 허용 domain은 실제 소유·배포 설정으로 정하며 아직 없는 production domain을 만들었다고 가정하지 않는다.

모르는 version/type과 잘못된 payload는 거부한다. 허용 요청에는 requestId에 대응하는 결과·error·unsupported·timeout 처리를 둔다. 문자열 보간으로 임의 JS/Native 메서드를 실행하는 범용 bridge를 만들지 않는다. Apple은 메시지 응답과 JS 호출을 위한 API를 설명하며, MetaBridge는 계약 생성과 transport driver를 분리한 참고 구현이다. [T5] [D5]

origin 검사는 같은 origin의 XSS까지 막아 주지 않는다. 본문 sanitization, URL scheme 제한, 명령별 권한·입력 제한을 함께 적용한다. 외부 링크는 앱 정책에 따라 외부 브라우저로 보내고 자격 증명을 노출하지 않는다.

raw GPS, HealthKit 원본, 인증 token은 bridge payload로 제공하지 않는다. 향후 운동 결과 공유는 사용자가 명시적으로 선택한 요약 데이터와 목적을 별도로 설계한다.

---

## 13. HealthKit·개인 운동량·리워드

### 13.1 제품 역할 — 확정

HealthKit 연동은 **혼자 운동하거나 함께 운동하는 상황 모두의 운동량을 확인하는 기능**이다. 출석 판정용 센서가 아니며 `participation_id`를 필수 입력으로 요구하지 않는다.

workout, walking/running distance, active energy 등 필요한 항목을 목적별로 선택한다. 초기 구현은 필요한 데이터를 읽어 운동량·결과를 표시하는 것부터 시작한다. 자체 실시간 운동 측정·기록 쓰기·Watch 연동까지 완료한 것으로 표현하지 않는다. 해당 기능이 필요하면 device 지원과 센서 수집 흐름을 별도 검증한다.

개별 workout, 일정 시간 구간의 합계, 하루 운동량은 다른 개념이다. 하루 전체 운동량을 특정 모임에 자동 귀속시키지 않는다. 모임과의 연결은 선택적이고 의미가 명확해야 한다.

### 13.2 권한·데이터 경계

권한은 사용자가 운동량 기능을 사용하려는 맥락에서 필요한 유형만 요청한다. 조회할 수 없는 결과를 운동량 0이나 미출석으로 바꾸지 않는다. Apple은 필요한 데이터만 필요한 맥락에서 요청하도록 설명하며, 읽기 권한 허용 여부를 앱이 직접 확정할 수 없다는 제한을 명시한다. [T6] [T6A]

기본적으로 원본 건강 데이터를 서버나 WebView로 전송하지 않는다. Native 로컬 기능으로 동작하게 하고, 장래 동기화나 게시글 공유가 필요하면 최소 summary·동의·보존·삭제를 별도 설계한다. 서비스 계정 전환과 기기의 건강 데이터 접근은 같은 개념이 아니므로, 다른 계정으로 자동 업로드하지 않게 한다.

### 13.3 리워드 — 제품 후보, 현재 미확정

리워드는 배제하지 않는다. 다만 표시용 운동량과 보상 지급 판단을 분리한다. 보상 도입 전 대상 활동, 중복 집계·재지급 방지, 데이터 수정·삭제, 지급 상태, 오류 복구, 허용 데이터 출처를 정한다.

보상 처리가 실패해도 운동량 자체를 없애거나 운동 완료를 실패로 표현하지 않는다. HealthKit 연결 여부를 모임 이용의 필수 조건으로 만들지 않는다.

Apple의 건강 데이터 정책은 사용자 직접 혜택에 조건을 두고, 제공 주체·제3자 공유·수집 고지 및 광고 활용 등을 제한한다. 구체적인 리워드 방식은 출시 시점의 공식 정책과 실제 데이터 흐름으로 다시 검토한다. **이 문서는 리워드 심사 승인이나 법적 적합성의 판정이 아니다.** [T8]

현재 리워드 DB·지급·현금성 보상·부정 사용 탐지 시스템은 구현하지 않는다. 기능이 들어올 수 있는 관계만 기존 운동·참여 기능과 분리한다.

---

## 14. 폴더 구조와 donor 이식

### 14.1 시작 구조

```text
src/
  app/                 # React routes, entry-client / entry-server
  server/
    server.ts
    renderer.ts
    loaders/
    routes/
    services/          # actor, authorization, transaction, domain 조합
  contracts/           # Zod HTTP 입력·출력
  domain/              # 순수 TypeScript 정책
  features/            # React UI / Query hooks / vanilla-extract
  adapters/
    db/
    auth/
    facilities/
    weather/
  shared/
    queryKeys.ts
    geo.ts
contracts/fixtures/    # TypeScript·Swift 공통 JSON
scripts/
  sync-public-facilities.ts
  reconcile-attendance.ts
supabase/migrations/
ios/CmonYo/
  Features/
  Networking/
  Web/
  Platform/
docs/
```

이 트리는 예정된 코드의 위치를 설명한다. PR1에서 모든 빈 디렉터리·interface를 생성하지 않는다. server-only 의존성과 비밀 키가 browser bundle에 들어가지 않도록 import 경계를 검사한다.

feature 단위 배치가 더 명확한 부분은 작은 단위로 선택할 수 있다. 레이어 → modules 이전을 예약하거나 실제 문제를 일부러 기다리지 않는다. 폴더명보다 데이터 변경 책임·공개 계약·의존성의 방향을 유지한다.

### 14.2 heznpc-archive — 이번 정리에서 실제 파일 재열람

현재 README는 이전 community app에서 출발한 개인 학습 archive, 익명 읽기와 owner/admin 쓰기를 설명한다. 공개 커뮤니티에 현재 권한 정책과 migration을 일괄 이식하지 않는다. [A1]

| 원본 파일 | 처리 | 이식 기준 |
|---|---|---|
| `src/lib/db/comments.ts` | 함수 추출 + query 재작성 | `buildCommentTree`는 DB 호출과 분리해 테스트. 고아 댓글 root 처리 등 동작 확인. 조회는 새 저장 모델에 맞춤 [A2] |
| `src/lib/validation/comment.ts` | 수정 | trim·빈 문자열·길이 규칙을 참고하고 route·ID·필드명을 새 계약에 맞춤 [A3] |
| `src/actions/comments.ts` | Next wrapper 폐기 | `revalidatePath`, Server Action 제거. 생성·soft delete 의미를 새 service로 옮기고 인가를 새로 구현 [A4] |
| `src/components/board/post-card.tsx` | UI 수정 | 제목·작성자·시간·조회/반응 수 구조 참고. `next/link`, Tailwind, 학습/Q&A 의미 제거 [A5] |
| `src/components/board/comment-tree.tsx` | UI 수정 | 재귀·삭제 부모 표시와 깊이 정책 검토. 게시판·채택 답변 props 제거 [A6] |
| `src/components/board/like-button.tsx` | 필요 시 재작성 | 원본은 `useOptimistic` + Server Action. TanStack mutation을 그대로 복사할 수 있는 파일이 아님 [A7] |
| Next App Router pages·설정 | 이식하지 않음 | Fastify/Vite SSR와 React route로 구현 |
| 전체 Supabase migrations | 일괄 이식 금지 | 신규 schema·role·인가/제약 테스트 작성 |

공개 파일을 읽은 것과 donor의 모든 보안 정책을 감사한 것은 다르다. 실제 copy 전에 SHA·라이선스·관련 타입과 의존성을 확인한다. 원본 함수의 기존 동작이 새 pagination·삭제 정책에도 맞는지 테스트한다.

AEGIS에서는 queryKeys·mutation·rollback 패턴을, SkillBridge/create-starter에서는 CI·테스트·validation·repo 운영 패턴을 검토할 수 있다. 이번 문서에서 해당 저장소의 구체 파일 경로는 확인하지 않았으므로 만들어 쓰지 않는다.

---

## 15. 최소 관측·품질·출시 전 확인

### 15.1 기술 관측

| 구분 | 최소 기록 |
|---|---|
| HTTP/API | requestId, route template, status, duration, 5xx |
| SSR | 초기 data 조합 시간, shell 준비, stream 완료/중단, render 오류 |
| 사용자 진입 | Native/WebView 진입부터 본문 표시·상호작용 가능까지 |
| 외부 요청 | weather latency, timeout, failure, stale 사용 |
| hydration | recoverable error 종류와 발생 route |
| 트래픽 | HTML/API 요청 수, SSR 실제 실행 수, asset/이미지 바이트, cache hit/miss |
| 부하 | 동시 요청별 CPU·메모리·DB pool 대기·오류율 |

원본 URL의 민감한 query나 request body 전체를 로그로 남기지 않는다. SSR duration과 사용자 TTFB, WebView의 준비 시간을 같은 수치로 쓰지 않는다. 실행 환경·시나리오·cold/warm·측정 횟수를 함께 기록한다.

### 15.2 제품 event

모임 열기, 참여 시도, 서버에서 확정된 참여·취소, 체크인 결과, 수동 확인 요청 등을 구분한다. 시도 횟수와 상태 전이 횟수는 다르며 재시도·중복 응답을 중복 성공으로 집계하지 않는다.

출석 event는 participation과 attendance 중 어떤 축이 변했는지 표시한다. 건강 원본·raw GPS를 일반 제품 분석에 넣지 않는다. 측정 전 노쇼 감소·참여 증가·SSR 성능 개선을 주장하지 않는다.

### 15.3 공개 서비스에서의 별도 gate

fixture 단계가 끝났다고 실제 공개 운영 준비가 끝난 것은 아니다. 게시글·댓글을 공개 쓰기로 열기 전 인가·삭제·신고/운영 처리·기본적인 쓰기 제한·콘텐츠 안전 처리를 확인한다. 위치·건강 데이터를 수집하는 기능은 실제 수집 목적·보존·동의·배포 정책을 확인한다.

이들은 PR1에 운영 플랫폼을 모두 구현하라는 뜻이 아니라, 공개 범위를 확대할 때 누락하면 안 되는 확인 항목이다.

---

## 16. 구현 순서와 완료 조건

> PR1 실행 범위와 완료 판정은 `docs/pr1-acceptance.md`를 우선한다. 아래 내용은 요약이며 최신 수용조건을 대체하지 않는다.

장기 제품 목표와 현재 PR 범위는 다르다. 아래 순서는 의존성을 설명하는 실행 기준선이다. 각 결과에 따라 최소 조정할 수 있지만 미실행 검증을 완료로 표시하지 않는다.

2026-09-13 현재 구현과 남은 사용자 흐름을 대조해 PR3을 A/B로 나누고, 커뮤니티 입력과 관측 기반 개선을 현장 체크인보다 앞에 배치했다. 아래 PR 번호는 GitHub 번호와 구별되는 **개발 단계 이름**이다. 기상청 검증 대기가 독립적인 인증 구현을 막지는 않지만 PR3 코드는 PR2에 섞지 않는다.

### PR1 — Web / Native / WebView의 첫 연결

**목적:** 실제 DB·인증·GPS 없이 같은 공개 모임을 API·SSR·SwiftUI로 보여주고 WebView와 Native navigation의 계약을 검증한다.

```text
공통 MeetupDetail JSON fixture
  ├─ Zod validation → 동일 service → Fastify GET API
  ├─ 동일 service → React SSR → hydrateRoot / Query hydration
  └─ Swift Codable → SwiftUI 모임 상세
                            ↓
                   읽기 전용 WKWebView
                            ↓ openMeetup
                    기존 Native 모임으로 복귀
```

구현 route는 `GET /api/v1/meetups/:id`, Web `/meetups/:id`, 읽기 전용 `/meetups/:id/discussion`으로 유지한다. discussion은 공개 fixture를 이용한 **통합 시험용 배치**다. 최종 모임 댓글을 WebView로 결정하거나 실제 댓글 작성·저장 기능을 구현한 것이 아니다. Native 컨테이너와 WebView 콘텐츠를 함께 표시하되 PR1에 혼합 입력창·이미지 업로드는 추가하지 않는다.

최소 fixture 예시는 다음과 같다. 실제 파일 하나를 TypeScript와 Swift 테스트가 함께 사용하며, 아래 값은 실제 시설·모임이 아닌 테스트 데이터다.

```json
{
  "meetup": {
    "id": "11111111-1111-4111-8111-111111111111",
    "title": "[Fixture] 일요일 아침 같이 걷기",
    "description": "Web과 Native 연결을 확인하는 테스트 모임입니다.",
    "sport": "walking",
    "startsAt": "2026-09-20T01:00:00.000Z",
    "endsAt": "2026-09-20T02:00:00.000Z",
    "capacity": 6,
    "place": {
      "id": "22222222-2222-4222-8222-222222222222",
      "name": "[Fixture] 샘플 동네 운동장"
    }
  },
  "viewerParticipation": null
}
```

일시 표시는 첫 SSR과 hydration에서 같은 timezone·locale을 사용한다. fixture의 미래/과거 여부로 테스트가 시간이 지나며 깨지지 않도록 clock을 통제한다. 테스트에서 가짜 로그인 사용자나 참여 성공을 꾸미지 않는다.

#### PR1 완료 조건

- [ ] 개발 실행과 production build 실행이 모두 된다. 필요한 명령·환경 설정이 README에 있다.
- [ ] JSON API와 SSR loader가 같은 service를 직접 호출한다. 서버의 self-HTTP-call이 없다.
- [ ] **JavaScript 비활성 상태에서 제목·일시·장소가 본문 UI에 표시된다.** script 안에 문자열만 존재하는 것은 불합격이다.
- [ ] `hydrateRoot` 이후 실제 client interaction이 연결된다. 초기 query의 불필요한 즉시 중복 요청이 없고 freshness 설정을 기록한다.
- [ ] 동시 SSR 요청에서 QueryClient가 공유되지 않는다. server-only 코드가 browser bundle에 포함되지 않는다.
- [ ] TypeScript validation과 Swift Codable이 동일 fixture를 검증한다. malformed fixture도 거부한다.
- [ ] SwiftUI → WebView → `openMeetup` → Native 복귀가 동작하고 동일 모임을 중복 push하지 않는다.
- [ ] **비허용 발신 origin의 형식상 유효한 openMeetup 요청은 무시되고 navigation 호출은 0회다.** 실제 frame의 origin과 main-frame 여부를 검사한다. 외부 페이지 로딩 차단 테스트만으로 대체하지 않는다.
- [ ] 알 수 없는 message/version·잘못된 payload·허용되지 않은 subframe 요청을 처리한다. 실제 WebKit 통합 검증과 순수 검증 함수 테스트를 구분한다.
- [ ] SSR 오류·중단의 최소 경로와 악성 초기 문자열의 안전한 직렬화를 검증한다.
- [ ] lint, typecheck, unit/integration test, build의 실제 명령과 결과를 기록한다. iOS는 macOS/Xcode에서 실행했는지 명시한다.

PR1의 SSR 본문 테스트는 progressive data streaming이나 성능 개선의 증거가 아니다. 공개 fixture bridge 테스트는 인증 공유 완료의 증거가 아니다. macOS/Xcode에서 실행하지 못했다면 iOS 코드를 작성한 것과 실제 빌드·테스트 통과를 구분한다.

**PR1에 넣지 않는 것:** DB migration, 로그인/세션 교환, 시설 API, 날씨, GPS, 참여 mutation, 댓글 영속화, HealthKit, Push, 리워드, CDN, codegen, Stackflow/SEED/MetaBridge의 선행 도입, 미래 module 틀.

### PR2 — 실제 시설과 날씨

실제 dataset·샘플 identity를 확인하고 지역 파일럿 importer, DB adapter, KMA adapter를 구현한다. 재실행 중복 없음, 부분 수집 실패의 안전성, empty/error/stale UI, 외부 요청 deadline을 검증한다. fixture를 실제 데이터처럼 표시하지 않는다.

현재 `docs/pr2-acceptance.md`를 기준으로 구현·실행 증거가 있으며, 인증된 기상청 성공 응답의 값·발표/대상 시각·격자 대조가 남아 있다. 이 항목을 확인하기 전에는 draft를 유지한다. 전국 ingest·지도 탐색·공급자 교체로 범위를 확대하지 않는다.

### PR3A — 인증과 계정 격리

첫 로그인 공급자는 Google이다. 최소 로그인·내 계정 화면으로 실제 provider 연결과 WebView 동일 identity spike를 수행한다. 결과로 인증 방식을 채택·수정·기각한다. Browser·Native의 로그인·갱신·만료·로그아웃·재시작, OpenAPI의 identity/오류 계약, 서버 인가를 검증한다.

개인 cache·진행 중 요청·계정 전환을 이 단계에 포함한다. A의 응답을 지연시킨 채 B로 전환한 뒤 늦게 도착시켜 화면·cache·뒤로가기에 섞이지 않음을 확인한다. 개인 SSR도 요청별로 격리하며 공개 시설 cache를 일괄 삭제하지 않는다. 로그인 입력·오류·포커스와 실제 Native/WKWebView subject 일치를 실행한다. 세션 연결 성공만으로 cache 안전성까지 통과 처리하지 않는다.

§15 중 HTTP route/status/duration/requestId와 인증 실패의 안전한 관측을 여기서 시작한다. 토큰·쿠키·개인 응답 원문을 남기지 않는다. 별도 관측 플랫폼 전체를 선행 구축하지 않는다.

### PR3B — 실제 모임 탐색·생성·참여·취소

fixture를 영속 모임으로 바꾸고 Browser·Native에서 목록/종목·지역 필터→상세→생성·참여·취소를 구현한다. 목록의 필터·페이지·뒤로가기 복원, 입력 검증·작성 보존·진행 표시·서버 오류·재시도를 실제 화면에서 확인한다. 모집 기능을 열기 전 초기 모임 공급과 운영 책임을 정한다.

서버의 권한·마지막 정원 동시성, 중복 효과·오래된 응답·늦게 처음 도착한 명령의 보장 범위를 이 기능의 계약으로 정하고 검증한다. 응답을 못 봤다고 미실행으로 간주해 자동 재시도하지 않는다. TanStack Query mutation의 성공/실패와 관련 목록·상세·개인 cache 갱신을 검증하며 낙관적 성공을 필수로 삼지 않는다. TS/Swift·OpenAPI·실제 HTTP 계약 검사와 PR3A 계정 전환 회귀를 포함한다.

참여 시도와 서버에서 확정된 참여를 구분해 측정하기 시작한다. 공개/개인 응답 분리와 무효화 검증 전에는 공유 HTML cache를 켜지 않는다. PR3A 성공만으로 PR3 전체 완료를 선언하지 않는다.

### PR4 — 모임 댓글과 실제 혼합 UX

첫 소통 흐름은 모임 댓글 작성·조회·삭제로 좁힌다. donor를 선별 이식하고 최초 댓글 migration 전에 저장 모델을 비교·기록한다. 웹과 Native의 본문·목록·입력 중 무엇을 공유할지 §5의 경계 명세를 작성하고 한 가지 실제 흐름을 구현한다.

본문 공유, 전체 웹 흐름, Native 입력+웹 목록을 기능 이익과 비용으로 평가하되 모두 만들어 비교할 필요는 없다. 채택한 경계에서 키보드·작성 보존·복귀·인증 실패·재전송·늦은 응답을 테스트한다. 사진 업로드와 독립 게시판은 이 댓글 흐름의 선행조건으로 넣지 않는다. 공개 쓰기 전 §15.3의 운영 조건을 충족한다.

### PR5 — 사용자 피드백·관측에 따른 개선

PR3부터 수집한 요청·실패·참여 흐름을 바탕으로, SSR loader/shell/stream·hydration 오류·WebView cold/warm 진입을 필요한 범위에서 연결해 측정한다. 같은 환경·데이터·시나리오·표본 기준을 남기고 발견한 지연 또는 사용성 문제 한 가지를 수정해 전후를 비교한다. 임의 개선율과 운영 수용량을 목표로 꾸미지 않는다.

핵심 모임 흐름을 실제 사용자에게 확인할 때 과제·불편·변경·결과를 기록한다. 도구 QA와 사용자 피드백을 구분하고 참여자가 없으면 후자를 미검증으로 남긴다. A/B는 결정할 가설·노출 단위·주 지표·충분한 표본을 확보할 수 있을 때만 진행한다.

### PR6 — 현장 체크인과 수동 확인

순수 정책 테스트, Geolocation/CoreLocation, 서버 판정, 권한 거부·부정확한 위치 fallback, 주최자 확인, reconciliation을 구현한다. 두 상태축, 취소된 모임, 경계 시각, 중복 요청, raw 위치 redaction을 검증한다. 수동 검토 요청 기능 전에 확인 책임을 정한다.

### PR7 — 독립 운동량 기능

HealthKit 읽기·운동량 표시를 단독 사용자 흐름으로 완성한다. 모임 참여가 없어도 동작하고 데이터 없음이 미출석/운동량 0으로 확정되지 않아야 한다. 계정 전환·권한 변화·부분 결과와 공개 공유 경계를 확인한다.

HealthKit은 별도의 장기 제품 목표로 유지한다. 먼저 모임 생성·참여·소통 흐름을 완성하고 개선할 수 있도록 순서를 조정했다.

### 이후 — 동네 인증·Push·리워드·관측 기반 최적화

동네 인증과 거주 인증을 혼동하지 않는다. Push와 로컬 알림도 구분한다. 리워드는 목적과 정책 검토가 완료된 뒤 구현한다. SSR/cache·bundle·DB 최적화는 측정된 병목에 맞춰 추가한다. 미리 microservice·Redis를 도입하지 않는다.

---

## 17. 아직 열려 있는 결정과 결정 시점

| 항목 | 지금 정한 것 | 결정/검증 시점 |
|---|---|---|
| 최종 WebView 범위 | 공존 허용, 커뮤니티 자동 웹 전환 금지 | 해당 화면 UX와 cold/warm 비용을 확인할 때 |
| 상단바·입력·scroll 소유권 | 각 상태의 변경 주체 하나 | 실제 혼합 화면 구현 직전 |
| 공유 HTML/JSON cache | private 기준선, 공개성 확인 전 공유 금지 | 인증·데이터 분리와 무효화 검증 후 |
| SSR 보조 데이터 deadline·TTL | 값·실패·stale 구분 | 실제 API·배포 baseline 확인 후 |
| 인증 교환 | 동일 identity·보안 요구 고정 | PR3A spike |
| 댓글 DB | 두 요구와 변경 비용 비교 | 최초 댓글 migration 전 |
| 공공데이터 identity | 추측 금지 | PR2 실제 샘플 확인 |
| 체크인 임계값 | pure policy와 version | PR6 경계 테스트·현장 확인 |
| 계약 codegen | PR1 수기 DTO+fixture | 동기화 이익이 비용을 넘을 때 |
| module 배치 | 의존성·소유권은 지금 유지 | 현재 변경 단위에 맞춰 필요할 때 |
| 운동 데이터 서버 동기화·리워드 | 모임·출석과 분리 | 목적·동의·정책·지급 정합성 정의 후 |

미확정 항목을 전부 해결해야 PR1을 시작할 수 있는 것은 아니다. 되돌리기 어려운 경계는 해당 의존 기능을 확대하기 전에 검증한다. 모든 폴더 변경에 ADR을 만들기보다 인증·공개 계약·데이터 소유권처럼 대안과 이유를 남길 가치가 있는 결정을 기록한다.

---

## 18. Codex 시작 지시문

> PR1 실행 범위와 완료 판정은 `docs/pr1-acceptance.md`를 우선한다. 아래 내용은 요약이며 최신 수용조건을 대체하지 않는다.

아래는 PR1 시작 당시의 예시를 보존한 것이다. 현재 다음 작업 지시로 재사용하지 않으며, 후속 실행은 §16의 갱신된 순서와 해당 이슈를 따른다.

```text
CMON_YO_FINAL_HANDOFF.md를 구현 기준으로 사용한다.

현재 작업은 §16 PR1만이다.
먼저 실제 저장소와 실행 환경을 확인한 뒤 코드·테스트를 작성한다.
문서의 전체 기능과 후보 구조를 한 번에 구현하지 않는다.

유지할 것:
- React Web과 SwiftUI는 의도적인 별도 제품 구현이다.
- Fastify의 API route와 SSR loader는 같은 service를 직접 호출한다.
- React SSR은 renderToPipeableStream, client는 hydrateRoot를 사용한다.
- TanStack Query는 요청별 SSR cache와 client hydration으로 연결한다.
- TypeScript와 Swift는 동일한 공개 MeetupDetail JSON fixture를 검증한다.
- viewerParticipation은 PR1에서 null이다.
- SwiftUI 상세 → 읽기 전용 WebView → openMeetup → Native 복귀를 구현한다.
- 이 WebView 배치는 기술 연결 시험이지 최종 커뮤니티 UX의 확정이 아니다.

필수 검증:
- JS 비활성 상태에서도 제목·일시·장소가 본문에 표시된다.
- hydration 이후 실제 interaction이 동작한다.
- SSR 요청 간 cache가 섞이지 않고 초기 불필요한 중복 query가 없다.
- 비허용 origin/frame의 bridge 요청이 Native navigation을 일으키지 않는다.
- §16의 나머지 PR1 완료 조건도 확인한다.

PR1에 DB/auth/GPS/외부 API/댓글 mutation/HealthKit/Push/리워드/CDN을 넣지 않는다.
threads/codegen/module skeleton을 미리 만들지 않는다.
Stackflow/SEED/MetaBridge는 참고 근거이며 PR1 필수 의존성이 아니다.

완료 보고:
변경 파일, 실행 명령, 실제 결과, 미실행 항목, 재현된 문제와 최소 수정 이유를 구분한다.
macOS/Xcode에서 실행하지 않은 iOS 테스트를 통과했다고 쓰지 않는다.
fixture·설계·구현·실행 검증·성능 측정을 서로 다른 상태로 보고한다.
```

### README와 면접에서의 표현

실제 결과가 생긴 범위에서만 설명한다. 현재 문서만으로 다음을 주장하지 않는다.

- 외부 서비스의 모든 컴포넌트와 동일한 WebView 구조를 구현했다.
- Streaming SSR 덕분에 TTFB/트래픽이 개선됐다.
- GPS 체크인으로 노쇼나 위치 조작을 방지했다.
- WebView의 인증·계정 전환을 실제 기기에서 검증했다.
- HealthKit으로 모든 운동량을 직접 측정하거나 리워드 심사를 통과했다.
- Swift → React Native migration을 수행했다.

설명 형식은 **사용자 문제 → 제약 → 선택 → 실제 코드 근거 → 감수한 비용 → 테스트/측정 결과**로 한다. 구조를 바꿨다면 그 이유를, 유지했다면 유지한 이유를 기록한다.

---

## 19. 외부 근거와 확인 범위

아래 자료를 문서 정리 과정에서 열람했다. 코드 실행·전체 repository 감사·production 채택 범위 검증은 하지 않았다. 문서에 들어간 구현 정책은 출처의 사실과 구분한다.

### 당근 공개 코드

| ID | 자료 | 확인 범위 |
|---|---|---|
| [D1] | council `api/src/app/renderer.js` | Fastify Vite template, props 사전 조회와 props 경로, tracing, devalue, React HTML stream |
| [D2] | council `api/src/client/mount.ts` | `hydrateRoot` 호출 |
| [D3] | seed-design `ActivityAppBarSlot.tsx` | React 상단바·뒤로 가기·아이콘 버튼·화면 이동 예제 |
| [D4] | stackflow `historySyncPlugin.tsx` | server/browser history 선택과 history 변경 controller 경계 |
| [D5] | metabridge README | schema 기반 SDK/stub와 구현자가 연결하는 transport driver |

이 자료의 일부 예제로 외부 서비스의 화면별 구현이나 전체 구조를 확정할 수 없다.

### 당근 공식 문제 해결 사례

| ID | 자료 | 확인 범위 / 적용 한계 |
|---|---|---|
| [B1] | 「프로덕트에 진심인 엔지니어는 어떻게 일할까? ②」, 2025-01-20 | 공통화가 예외·의존성을 늘린 사례, 실제 데이터로 오류 우선순위를 바꾼 사례. 두 번째 consumer 규칙이나 DB 표준의 근거는 아님 |
| [B2] | 「당근마켓 웹뷰 플랫폼 외전 — 레거시 시스템 안전하게 제거하기」, 2025-02-12, 당근 팀 | 공개 본문에서 오래된 로컬 WebView 딥링크 때문에 남은 이중 배포·리디렉션·호환성 비용 확인. 연결된 전문의 전체 해결 과정을 확인한 것으로 취급하지 않음 |

이전 대화의 2022년 「웹 서버로 돌아가기」는 관련 자료이지만, 이번 재열람에서 Medium 본문을 충분히 확보하지 못했다. 해당 글의 세부 내용을 이번 문서의 새 확정 사실로 사용하지 않았다.

### 공식 기술 문서

| ID | 자료 | 용도 |
|---|---|---|
| [T1] | React `renderToPipeableStream` | shell·stream·오류·abort·Suspense 동작 |
| [T2] | TanStack Query SSR | request별 cache, dehydrate/hydrate, freshness |
| [T3] | MDN HTTP caching | private/shared cache와 응답 제어 |
| [T4] | Supabase Securing your API | API 접근·권한·schema/RLS 경계 |
| [T5] | Apple WWDC20 WKWebView | Native UI 결합·메시징·JS 호출 |
| [T6] | Apple Getting started with HealthKit | 필요한 데이터 유형의 권한 요청 |
| [T6A] | Apple HealthKit authorizationStatus 문서 | 읽기 권한을 직접 확정할 수 없는 제한 |
| [T7] | PostgreSQL Explicit Locking | transaction 내 행 잠금 |
| [T8] | Apple App Review Guidelines | 건강 데이터·직접 혜택·데이터 사용 제한. 출시 전 재확인 |

### donor 공개 파일

[A1]은 현재 운영 모델의 근거이고 [A2]~[A7]은 §14의 파일 매핑 근거다. 인증·인가와 schema는 C'mon Yo!의 공개 커뮤니티 요구에 맞게 다시 검증한다.

[D1]: https://github.com/daangn/council/blob/main/api/src/app/renderer.js
[D2]: https://github.com/daangn/council/blob/main/api/src/client/mount.ts
[D3]: https://github.com/daangn/seed-design/blob/dev/examples/stackflow-spa/src/activities/ActivityAppBarSlot.tsx
[D4]: https://github.com/daangn/stackflow/blob/main/extensions/plugin-history-sync/src/historySyncPlugin.tsx
[D5]: https://github.com/daangn/metabridge/blob/main/README.md
[B1]: https://careers.daangn.com/blog/post/당근-개발자-프로덕트-엔지니어-팀빌딩-회고/
[B2]: https://velog.io/@daangnteam/당근마켓-웹뷰-플랫폼-외전-레거시-시스템-안전하게-제거하기
[T1]: https://react.dev/reference/react-dom/server/renderToPipeableStream
[T2]: https://tanstack.com/query/latest/docs/framework/react/guides/ssr
[T3]: https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Caching
[T4]: https://supabase.com/docs/guides/api/securing-your-api
[T5]: https://developer.apple.com/videos/play/wwdc2020/10188/
[T6]: https://developer.apple.com/videos/play/wwdc2020/10664/
[T6A]: https://developer.apple.com/documentation/healthkit/hkhealthstore/authorizationstatus(for:)
[T7]: https://www.postgresql.org/docs/current/explicit-locking.html
[T8]: https://developer.apple.com/app-store/review/guidelines/
[A1]: https://github.com/heznpc/heznpc-archive/blob/main/README.md
[A2]: https://github.com/heznpc/heznpc-archive/blob/main/src/lib/db/comments.ts
[A3]: https://github.com/heznpc/heznpc-archive/blob/main/src/lib/validation/comment.ts
[A4]: https://github.com/heznpc/heznpc-archive/blob/main/src/actions/comments.ts
[A5]: https://github.com/heznpc/heznpc-archive/blob/main/src/components/board/post-card.tsx
[A6]: https://github.com/heznpc/heznpc-archive/blob/main/src/components/board/comment-tree.tsx
[A7]: https://github.com/heznpc/heznpc-archive/blob/main/src/components/board/like-button.tsx

---

## 최종 기준선

**Web과 Native를 모두 제품으로 유지한다. 예정 기능을 고려해 정책·데이터·호스트 경계를 먼저 분리한다. WebView는 한 화면 안에서도 사용할 수 있지만, 커뮤니티라는 이유로 자동 선택하지 않는다. SSR·캐시·개인 상태·반복 행동을 나눠 비용을 판단한다. 구현은 작은 통합 단위로 진행하고, 채택한 구조의 효과는 실제 실행과 측정으로 확인한다.**
