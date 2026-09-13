# 실제 모임·Native 이메일 세션 수용조건

관련 이슈: [#3 인증](https://github.com/heznpc/cmon-yo/issues/3), [#5 실제 모임](https://github.com/heznpc/cmon-yo/issues/5). handoff S1·S2·S3·S4·S7의 이번 구현 단위입니다. PR #4는 전체 인증 후속 검증이 남아 draft를 유지합니다.

## 구현한 사용자 흐름

- Web·iOS의 이메일 가입/인증 안내·로그인 → 원래 대상에서 사용자가 행동 확인 → 모임 생성/참여/취소 → 내 모임.
- 등록된 무안군 시설에서 모임 목록/생성으로 이동합니다. 동네·종목·한국 날짜·시설·페이지로 조회하며 빈 결과를 가짜 모집으로 채우지 않습니다.
- Web과 SwiftUI는 별도 화면이며 PostgreSQL service·HTTP 계약·최종 권한 판정을 공유합니다. 공개 상세에는 개인 상태를 넣지 않고 membership와 내 모임을 별도로 조회합니다.
- Web의 생성 입력은 실패 시 유지합니다. 같은 계정의 재확인 중에는 숨긴 폼을 보존하며, 계정 변경은 새 문서로 전환합니다. Native는 로그아웃/만료 시 진행 요청을 취소하고 개인 화면·초안·이전 navigation을 제거합니다.

## 서버 정책과 보장 범위

- 정원은 주최자를 포함한 2~100명입니다. 생성 시 주최자도 참여자로 저장합니다. 참여 취소 기록과 주최 취소된 모임도 내 모임에서 확인할 수 있습니다.
- 모임이 열려 있고 시작 전일 때만 생성 이후 수정·참여·참여 취소·주최 취소가 가능합니다. 주최자는 참여 취소 대신 모임 취소를 사용합니다. 정원을 현재 참여 인원보다 줄일 수 없습니다. 취소된 모임을 재개하는 동작은 없습니다.
- 모든 변경은 서버의 현재 계정과 `X-Cmon-User`가 같아야 합니다. Cookie 변경에는 정확한 Origin이 필요하며 Bearer를 함께 보냈다고 면제하지 않습니다. Native Bearer 조회는 Cookie로 대체 인증하지 않습니다.
- 행 잠금과 transaction으로 마지막 정원과 상태 전이를 판정합니다. 모든 변경은 확인한 `expectedVersion`을 요구합니다. 다른 변경 이후 늦게 도착한 최초 명령도 409로 거부합니다. 주최 수정 폼은 열었을 때의 버전을 유지합니다.
- 사용자별 `Idempotency-Key` UUID와 정규화된 명령을 DB에 저장합니다. 같은 내용의 동시 재전송은 같은 모임 ID를 반환하고 내용이 달라지면 409입니다. 성공한 명령은 계정이 존재하는 동안 유지합니다.
- 응답 미확인은 미실행이 아닙니다. `/api/v1/me/commands/:id`로 확인하고, 결과가 아직 없으면 같은 번호·같은 내용으로 사용자가 다시 보낼 수 있습니다. 조회의 null은 늦은 요청의 미실행 보장이 아닙니다. 새 UUID를 통한 자동 재전송은 하지 않습니다. 생성에는 선행 버전이 없어 늦게 도착한 요청 자체를 철회하는 보장은 없습니다.
- 계정 탈퇴는 주최 모임을 취소하고 참여를 제거하며 관련 버전을 올립니다. 공개 모임 정보는 취소 상태로 남습니다. 인증 세션·계정별 명령은 제거됩니다.
- `MEETUP_SOURCE=database`가 기본입니다. 기존 `.env`에 fixture 경로가 있어도 실제 모임을 덮지 않습니다. 읽기 전용 회귀 서버만 `MEETUP_SOURCE=fixture`를 명시합니다.

## 인증·저장

[Better Auth Bearer 문서](https://better-auth.com/docs/plugins/bearer)와 설치된 1.7.4 구현을 대조해 서명 필수 세션을 사용합니다. `/api/native/auth/*`는 Browser Cookie/Origin/Sec-Fetch-Site 요청을 거부하고 로그인에만 토큰을 반환합니다. Web 인증 응답에서는 토큰 본문과 헤더를 제거합니다. Native는 URLSession의 Cookie·cache·redirect를 사용하지 않습니다.

Native 저장은 origin별 Keychain이며 [WhenUnlockedThisDeviceOnly](https://developer.apple.com/documentation/security/ksecattraccessiblewhenunlockedthisdeviceonly)를 사용합니다. 재실행 후 서버에서 다시 계정을 확인합니다. 서명 없는 Simulator 앱은 Keychain을 사용할 수 없으므로 `scripts/build-ios-simulator.sh`가 Xcode 빌드 단계에서 Simulator 전용 ad-hoc entitlement를 넣습니다. 배포·실기기 서명 설정이 아닙니다.

## 실행 증거 — 2026-09-13

환경: macOS 27.0, Node 22.22.3/npm 10.9.8, PostgreSQL 17.11, Xcode 26.6, iPhone 17e/iOS 26.3 Simulator. 시험 계정/모임은 명시적으로 표시하고 공개 서비스로 발행하지 않았습니다.

| 검증 | 실제 관측 |
| --- | --- |
| `npm run with-env -- check` | lint·TypeScript·Vitest 73개·client/server build·server-only bundle 검사 통과 |
| `tests/meetings.test.tsx` | 실제 DB·HTTP: 동시 중복 생성, 마지막 자리 경쟁, 오래된 버전, 주최 권한, 수정·취소, 응답 유실 결과 조회, 개인 SSR, Origin·계정 바인딩, 만료·로그아웃·탈퇴 |
| `AUTH_SECRET= npm run with-env -- test:web` | Chromium 25개 통과. 기존 23개 + 모임 dev/prod 2개. Native QA와 독립 schema를 사용 |
| 모임 dev/prod 브라우저 | 원래 생성 화면 복귀 → 실패 입력 보존·같은 요청 재전송 → 생성·수정 → 다른 사용자 참여·응답 유실 확인 → 내 모임 → 참여 취소 → 주최 취소. A의 개인 응답을 보류한 채 다른 탭에서 로그아웃·B 로그인 후 도착시켜도 A의 주최 상태가 섞이지 않음 |
| 실제 production main, loopback 3194 | 인증된 시험 계정의 로그인·생성·주최 취소·내 모임·로그아웃, JS 없는 실제 모임 SSR, runtime 오류 0, 시험 메일 route 404. SMTP는 로컬 시험 주소로만 설정하고 실제 발송은 수행하지 않음 |
| Simulator 독립 XCTest | 10개 실행·10개 성공. 신규 AccountMeetingTests는 실제 Native HTTP 인증·생성·참여/취소·주최 취소·지연 응답 취소·A/B 전환. standalone xctest는 app entitlement가 없어 시험 credential store를 사용함 |
| 설치 앱 Keychain·UI | 실제 Keychain 로그인·앱 종료/재실행 복원, 다른 계정 로그인, 모임 생성·참여·내 모임·참여 취소 반영. 비로그인 상세 → 로그인 → 동일 상세의 참여 버튼 → 사용자가 참여 실행을 확인. QA 서버 응답을 멈춘 후 조회 실패, 재개 후 버튼으로 복구 확인 |
| 화면 | Web 1280px·320px/200%, Native 기본·Accessibility XXXL. 화면과 스크롤·긴 제목·입력·대비·기본 터치 영역을 관측. 날짜/시간을 나눠 320px 확대 시 날짜가 잘리던 문제 수정 |

Browser plugin not available: 저장소 Playwright를 사용했습니다. Simulator는 XcodeBuildMCP·명시적 UDID의 simctl/idb 조작·화면 관측입니다. 사람의 수동 QA나 XCUITest 실행으로 집계하지 않습니다. 증거는 Git 제외된 test-results와 로컬 QA 파일에 보관하며 메일 링크·자격 증명을 첨부하지 않습니다.

수정 후 재검증한 결함: UUID 인증 PK와 migration FK 타입 불일치, 시설 옵션 비동기 로딩 후 선택값 유실, 주최 편집의 기준 버전 자동 교체, 로그인 자동 조회와 원래 화면 복귀의 경쟁, Simulator Keychain 서명 누락, 기존 fixture 환경값이 실제 production 모임을 가리던 문제. Native는 credential 저장 이후 계정 확인 완료도 재조회 조건에 넣어 상세 복귀의 참여 상태가 누락될 가능성을 보완하고 설치 앱에서 재확인했습니다. HTTP 관측은 route template·method·status·durationMs·requestId만 기록하며 query·Cookie·Bearer·개인 응답 원문을 기록하지 않습니다.

## 별도 미검증

공식 Google·카카오·네이버·Apple 왕복, 외부 SMTP 수신, 공급자 수단 연결/해제·충돌, 인증된 WKWebView와 입력 복구는 남아 있습니다. Native 계정 설정·탈퇴는 Web 계정으로 이동해 별도로 로그인합니다. 기존 읽기 전용 WebView를 인증된 실제 모임 화면으로 전환했다고 주장하지 않습니다.

실기기·VoiceOver 전체 흐름·성능/부하·운영 관측 수집·공개 모집의 주최 책임은 별도입니다. 기존 XCUITest 발견 2개·실행 0개의 환경 복구를 재개하지 않았습니다. PR2의 기상청 공식 성공 응답 미검증도 유지합니다. 최종 브랜드는 후속 Web·Native 스타일 적용 범위입니다.
