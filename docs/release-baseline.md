# 검증한 코드의 공개 기준선

구현 기준은 `69c71d6`, 검토 단위는 [PR #16](https://github.com/heznpc/cmon-yo/pull/16)입니다. `2db82a1` 위에 초안·요청 복구, 화면 책임 정리, 로컬 관측, 인증된 웹 댓글 왕복을 구현했습니다. 아래 실행 증거는 이 구현에 대한 결과입니다.

## 이번 작업의 종료 기준

공개 기준선은 검증한 코드를 커밋·푸시하고 실행 방법과 검증 범위를 남기는 것입니다. 다음 네 기준은 충족했습니다.

| 작업                       | 종료 기준과 확인 결과                                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 초안 보존·미확인 요청 복구 | 작성 → 시설 탐색 → 뒤로가기·새로고침 후 입력 복원. 응답 유실 후 원래 요청 번호로 결과 조회·명시적 재시도 확인 |
| 화면 책임·명령 처리 정리   | 편집·조회·요청 결과 관리를 분리하고 커뮤니티·모임·현장 확인에 같은 복구 규칙 적용                             |
| 오류·요청 ID·캐시 관측     | 로컬에서 SSR·stream·날씨 실패를 재현하고 요청 ID로 추적. 제한된 브라우저 진단과 서버 로그 연결 확인           |
| 인증된 웹뷰 댓글 작성·복귀 | Simulator 설치 앱에서 Native 모임 상세 → 같은 계정의 웹 댓글 작성·저장 → 기존 Native 상세 복귀 확인           |

관측의 범위는 로컬 오류 재현·추적까지입니다. 운영 대시보드·외부 모니터링 서비스 구축, 서비스 배포·사용자 모집은 종료 기준에 포함하지 않습니다. 추가 트래픽 대응·운영 인프라는 실제 필요가 생길 때 검토합니다. 실기기·외부 공급자 미검증은 아래에 남기되 이번 작업의 종료나 PR #16의 검토 준비를 막는 조건으로 두지 않습니다.

## 기반 변경과 조건부 후속

| 검토 단위 | 구현 범위                                   | 해당 연결·운영을 진행할 때 확인할 사항                             |
| --------- | ------------------------------------------- | ------------------------------------------------------------------ |
| PR #2     | 시설 DB·날씨 adapter·Web/Native 조회        | 기상청 인증 성공 실응답, 수집 자료 갱신 절차 확인                  |
| PR #4     | 이메일 계정·Native 세션·모집/참여/취소      | 외부 SMTP 수신, 활성화할 OAuth 공급자별 왕복, 실기기 검증          |
| PR #7     | SSR 스트리밍·내부 이동·조회 cache           | 운영 배포 경로에서 전송·오류·부하 수용조건 확인                    |
| PR #9     | 게시글·댓글·내 활동·현장 확인               | 공개 글 운영 절차, 현장 확인 정책의 실기기/현장 검증               |
| PR #11    | HTTPS 전달·부하 시험 도구                   | 실제 배포 환경의 인증서·proxy·지속 부하 실행 증거                  |
| PR #16    | Web 초안·요청 복구·관측·인증된 웹 댓글 왕복 | 실제 배포 시 실기기·HTTPS origin 왕복, 필요 시 로그 수집·보관 기준 |

이 표는 기반 구현과 조건부 후속을 구분한 기록입니다. 외부 공급자 미검증을 연결 성공으로 표시하지 않으며, 기존 PR의 상태나 병합을 자동 변경하지 않습니다. `fix/region-configuration`의 별도 변경은 이 기준 커밋에 포함되지 않았습니다.

## 복구와 관측의 수용조건

- 게시글의 제목·본문·종목·연결 대상·수정 기준 버전을 계정/작성 대상별로 보관합니다. 이동·뒤로가기·새로고침 후 복원하고 저장 성공·명시적 폐기·계정 전환 시 정리합니다. 댓글도 부모별로 초안을 구분합니다.
- 요청 번호와 입력을 전송 전에 기록합니다. 응답 유실·새로고침·재접속 후 결과를 조회하고 명시적 재전송에서만 같은 번호와 내용을 사용합니다. 조회 결과 null은 미실행 보장이 아니므로 새 요청으로 자동 교체하지 않습니다.
- 브라우저 저장을 사용할 수 없으면 초안 상태를 설명합니다. 요청 번호 보관에 실패하면 전송하지 않습니다. 다른 기기·브라우저 간 초안 동기화는 포함하지 않습니다.
- 원본 GPS는 영속 저장하지 않습니다. 재실행한 위치 요청은 번호로 결과를 조회하며, 원본 입력이 없으므로 재전송하지 않습니다.
- HTTP 요청 ID·명령 ID로 브라우저 실패, 서버 처리, SSR/stream 실패, 날씨 adapter의 cache·공급자 결과를 연결합니다. 브라우저 보고는 신뢰하지 않는 진단 자료이며 본문·원시 URL·계정·위치·credential·원문 오류를 수집하지 않습니다.
- 기능별 편집/조회 컴포넌트와 공통 요청 처리의 책임을 나눕니다. 저장 성공과 이후 화면 갱신 실패를 구분합니다.

## 인증된 Native 웹 댓글의 한 흐름

Native 실제 모임 상세 → Native 세션 확인 → 해당 모임의 웹 댓글 → 댓글 저장 → 기존 Native 상세 복귀입니다. 동일 origin의 HttpOnly 세션 cookie를 Native에서 WebKit에 설정하며 credential을 JavaScript나 bridge 메시지로 전달하지 않습니다. 계정 변경·로그아웃 후 이전 웹 화면은 닫힙니다. 외부 origin·다른 모임으로의 임의 bridge 이동은 허용하지 않습니다. 기존 fixture 읽기 전용 실험은 별도로 유지합니다.

현재 진행한 댓글 작성·복귀 한 흐름이 범위입니다. 서버 HTTP·WebKit·Simulator 설치 앱 실행은 확인했고, 실기기·공식 OAuth 왕복은 조건부 후속입니다.

## 로컬 실행과 재현

Node·의존성·로컬 PostgreSQL과 `.env` 준비는 [README 실행 안내](../README.md#실행)를 따릅니다. `DATABASE_URL`은 로컬 개발 DB, `TEST_DATABASE_URL`은 별도 시험 DB를 사용합니다. 기본 화면 실행은 로컬 메일 수신함을 사용하고, 브라우저 QA 서버는 시험 인증·날씨 공급자를 직접 구성하므로 외부 서비스 키가 필요하지 않습니다.

```sh
npm run with-env -- auth -- migrate
npm run with-env -- meetups -- migrate
npm run with-env -- facilities -- apply contracts/samples/muan-parks.json
npm run with-env -- dev
```

`/account`에서 로컬 계정을 만들고 `.cache/auth-mail/`의 인증 링크로 확인합니다. `/community/new`에서 제목·본문 입력 → 둘러보기 → 뒤로가기 → 새로고침을 실행하면 입력이 복원됩니다. 아래 Web 검사는 응답 유실·미전송·계정 전환·저장소 실패도 재현합니다. `check`가 production assets를 빌드합니다.

```sh
npm run with-env -- check
AUTH_SECRET= KMA_API_KEY= PORT=3000 npm run with-env -- test:web -- --project=meetings-development --project=meetings-production
npm run with-env -- test -- tests/observability.test.tsx tests/streaming.test.tsx tests/weather.test.ts
```

Playwright는 설정된 시험 서버를 띄우므로 기존 개발 서버를 종료한 뒤 실행합니다. 고정 QA 포트와 서버는 [playwright.config.ts](../playwright.config.ts)를 따릅니다. 관측 검사는 SSR·stream·공급자 실패를 주입하고 동일 `requestId`의 이벤트를 확인합니다. 제품 서버는 터미널에 JSON 이벤트를 출력하며, 브라우저 Network의 `X-Request-ID`와 문서의 `cmon-request-id`, 명령의 `commandId`로 요청·저장·복구 결과를 연결할 수 있습니다.

Native는 [Simulator 설치·실행 안내](../README.md#실제-모임native-로그인-실행--최신)의 `CMON_API_URL`을 위 개발 서버 주소에 맞춥니다. 앱에서 로그인 → 내 모임 상세 → ‘모임 이야기 · 댓글 쓰기’ → 댓글 등록 → ‘앱 모임으로 돌아가기’를 실행합니다. 기존 Native 상세의 같은 모임으로 돌아오는지 확인합니다.

11개 iOS HTTP·WebKit 검사를 재실행하려면 아래 세 시험 서버를 각각 별도 터미널에서 실행하고, 사용자가 지정한 부팅된 Simulator의 UDID를 `CMON_SIMULATOR_ID`에 넣습니다. 첫 서버는 3100/3101, 시설 서버는 3112/3113, 댓글 서버는 3197을 사용합니다.

```sh
npx tsx tests/ios-server.ts
npm run with-env -- qa:places
QA_PORT=3197 npm run with-env -- qa:meetings
```

```sh
SIMCTL_CHILD_CMON_NATIVE_TEST_URL=http://127.0.0.1:3197 npm run test:ios -- "$CMON_SIMULATOR_ID"
```

## 이번 변경의 실행 증거

2026-09-14, macOS 로컬 PostgreSQL과 시험 메일 공급자로 검증했습니다. 기상청·SMTP·OAuth 공식 연결이나 운영 부하의 성공 증거로 해석하지 않습니다.

- `npm run with-env -- check`: lint·TypeScript·86개 테스트·production build·browser bundle의 server-only 의존성 제외 검사 통과.
- Playwright의 `meetings-development`·`meetings-production`: 18개 통과. Chromium에서 게시글 작성 → 시설 탐색 → 뒤로가기 → 새로고침의 초안 복원, 저장/폐기, 대상 분리, 응답 유실 후 결과 조회, 미전송 요청의 동일 번호 재시도, 다른 탭 계정 전환, 저장소 실패 차단을 확인했습니다. 1280×900·390×844·320×740와 글자 200% 조건을 포함했습니다. Browser plugin not available로 저장소의 Playwright를 사용했습니다.
- 관측 검증: SSR·스트리밍 실패와 실제 날씨 adapter의 실패/cache 경로를 요청 ID에 연결하고, 브라우저 보고의 필드 제한·수집량 제한·sink 실패 격리를 확인했습니다. 별도 production 서버를 실행해 SSR의 요청 ID와 진단 수신 로그도 확인했습니다.
- `bash scripts/build-ios-simulator.sh <임시 출력 경로>`: iOS Simulator 앱 빌드 성공. iPhone 17e / iOS 26.3에서 `npm run test:ios -- <전용 UDID>`의 HTTP·계약·WebKit 11개 테스트 통과.
- 같은 Simulator에 앱을 설치하고 Native 로그인 → 내 모임 상세 → 인증된 웹 댓글 작성 → 저장된 댓글 확인 → ‘앱 모임으로 돌아가기’ → 기존 Native 상세 복귀를 직접 실행했습니다. WebKit 시험에서 동일 계정·HttpOnly cookie·로그아웃 후 이전 세션 거부도 확인했습니다.
- [구현 커밋의 GitHub Actions](https://github.com/heznpc/cmon-yo/actions/runs/34786178546): 코드 검사 86개, 전체 Web 46개, Caddy HTTPS 8개와 conventions 통과. 로컬 구현 검증에 더해 확인한 CI 결과이며 운영 트래픽 수용량 검증은 아닙니다.

실기기, HTTPS 운영 origin의 WebKit cookie 왕복, 외부 로그 수집·보관 정책, 외부 공급자 정상 응답은 조건부 후속이며 미검증입니다. 측정하지 않은 성능 개선율이나 운영 수용량은 주장하지 않습니다.

## PR #16 코드 검토와 회귀 수정

검토 범위는 PR #16의 요청·초안 복구, 계정 경계, 관측, 인증된 WebKit 연결과 이를 호출하는 화면입니다. CI 통과·실행 QA와 코드 검토는 별도 증거이며, 이 기록은 저장소 전체의 독립 리뷰나 외부 리뷰 승인을 의미하지 않습니다.

- 다른 탭의 이전 요청 조회 응답을 지연시킨 동안 새 요청을 저장하면, 늦게 도착한 이전 응답이 새 요청 번호와 초안을 지우는 결함을 Chromium에서 재현했습니다. 결과 정리는 저장된 요청 번호가 일치할 때만 같은 잠금 안에서 수행하고, 초안도 실제 제출 내용과 같은 경우에만 지우도록 수정했습니다. 댓글 완료 화면의 상태 정리는 영속 기록 삭제와 분리했습니다.
- Fastify `onError`에서 아직 적용되지 않은 `reply.statusCode`를 읽어 HTTP 500을 관측 이벤트에 200으로 기록하는 결함을 재현했습니다. 오류에 지정된 HTTP 상태나 기본 500을 기록하도록 수정하고 500·503을 확인했습니다.
- 수정 후 `check` 87개, 개발·production의 관련 Web 22개, iOS HTTP·WebKit 11개를 확인했습니다. Web 22개 중 20개는 전체 실행에서 통과했고, 새 시험이 로그인 완료 전에 두 번째 탭을 열던 순서 문제를 고친 뒤 나머지 2개를 다시 통과시켰습니다. iOS는 연결 실패 시험이 예약한 3199 포트와 QA 서버의 충돌을 해소한 후 11개를 재실행했습니다.

자체 API·로컬 DB·이메일 인증과 기본 CSS는 구현되어 있습니다. 공식 OAuth·기상청·SMTP 실연결과 화면별 UI·CSS 마감은 이 검증으로 완료됐다고 표시하지 않습니다.
