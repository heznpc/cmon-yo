# Web 소통·내 활동·현장 확인 수용조건

관련 이슈: [#8](https://github.com/heznpc/cmon-yo/issues/8). 시작 기준은 성능 브랜치의 `a82c9a4`입니다. 기존 PR #2·#4·#7과 이력을 보존하고 `feat/streaming-navigation-performance` 위의 별도 브랜치에서 진행합니다. 이번 실행 우선순위는 Web이며 Native 변경은 포함하지 않습니다.

## 사용자 흐름과 저장 경계

- `/community`: 무안군·종목 피드 → 게시글 → 작성·수정·삭제·댓글 → 목록·내 글. 참여하지 않은 사용자도 이메일 인증 후 작성할 수 있습니다. 본문은 HTML로 실행하지 않는 텍스트이며 관련 시설·모임은 실제 목록에서 선택합니다.
- `/meetups/:id/discussion`: 실제 모임의 공개 댓글 → 이메일 로그인 → 사용자가 댓글 등록. 부모가 삭제·숨김·차단되면 댓글 조회·작성을 거부합니다. fixture 읽기 전용 WebView는 변경하지 않습니다.
- `/activity`: 내 모임·내 글·닉네임·선택 동네·차단 해제. 동네는 선택 설정이며 거주 인증이 아닙니다. 개인 정보는 인증 확인 후 SSR하며, 초기 Query 상태와 같은 application service를 HTTP에서도 사용합니다.
- 게시글 수정·삭제는 작성자와 확인한 버전을 요구합니다. 작성·댓글·신고·차단·프로필 변경에는 계정에 묶인 명령 UUID를 사용합니다. 완료된 요청은 같은 결과를 반환하며, 같은 번호로 내용을 바꾸면 409입니다. 저장 결과 조회에서 null은 늦은 요청의 미실행을 보장하지 않습니다.
- Web은 실패 시 입력을 유지하고 저장 결과 확인·동일 요청 재전송을 제공합니다. 계정 변경·화면 종료 시 이전 사용자 초안을 복원하지 않습니다. 계정 재확인 중에는 개인 화면을 숨깁니다. 읽기 요청의 예상 사용자도 서버 세션과 대조하며 다른 계정 응답을 기존 Query key에 넣지 않습니다.
- 저장 후 글·댓글·차단·프로필 중 영향받은 Query만 갱신합니다. 신고 접수는 본문을 재조회하지 않으며 댓글의 응답 유실 복구에서도 게시글 본문 API 재조회는 0건입니다.
- 글/댓글은 시각·UUID cursor로 다음 묶음을 조회합니다. 목록에 새 글이 추가되거나 이전 항목이 삭제돼도 다음 cursor의 기준은 바뀌지 않습니다. 필터·cursor는 URL에 남기며 기존 내부 이동·뒤로가기·스크롤 복원을 사용합니다.
- 신고는 접수 상태로 저장하고 자동 삭제하지 않습니다. 차단은 서로의 글/댓글을 숨기며 내 활동·내 글에서 해제합니다. 공개 쓰기 처리 책임은 저장소 운영자이며 아래 운영 명령으로 대기 목록을 확인하고 숨김/기각을 기록합니다. 사용자 명령은 계정당 1분 20개로 제한하며 중복 재전송은 예산을 다시 소모하지 않습니다.

## 현장 확인

모임 상세의 `현장 확인`에서 개인 출석 상태를 별도로 조회합니다. 현재 참여자만 확인할 수 있고 취소된 모임은 제외합니다. 확인 근거 없이 7일이 지난 요청은 조회 시 확인되지 않음·기한 지남으로 표시합니다. 위치 원본은 일시적인 요청 입력으로만 사용하며 DB·SSR·제품 로그에 저장하지 않습니다.

개발 정책 `local-v1`: 시작 30분 전~종료 30분 후, 반경 200m, 정확도 100m 이내, 120초 이내의 위치 샘플입니다. 운영 현장 검증으로 정한 임계값이 아니며 화면에도 이 범위를 표시합니다. 위치 확인은 실제 운동 수행이나 조작 방지 증명이 아닙니다.

위치 거부·부정확·오래된 샘플·범위 밖은 실패 이유를 구분합니다. 참여자는 종료 다음 날까지 사유를 남겨 수동 확인을 요청할 수 있습니다. 요청 접수는 출석 확정이 아니며 주최자는 7일 이내에 다른 참여자만 확인합니다. 거절·GPS 실패만으로 노쇼를 확정하지 않습니다. 참여 상태와 출석 상태는 별도로 유지하고 취소된 참여는 출석 표시에서 제외합니다. 다른 참여자나 이미 확인/검토 중인 출석이 있으면 장소·시간 변경을 거부합니다.

## 실행과 운영 명령

```sh
npm ci
npm run with-env -- auth -- migrate
npm run with-env -- meetups -- migrate
npm run with-env -- dev
# production 검증은 먼저 npm run build
npm run with-env -- community -- reports
npm run with-env -- community -- resolve <신고-UUID> hidden
npm run with-env -- community -- resolve <신고-UUID> dismissed
```

`meetups migrate`는 기존 시설/모임 뒤에 커뮤니티·현장 확인 migration을 순서대로 적용합니다. 실제 사용자 DB에 시험 글을 자동 생성하지 않습니다. `.env`의 로컬 메일 수신함을 이용하는 개발 실행과 SMTP 설정이 필요한 production 실행을 구분합니다. 외부 자격증명 없이 production UI를 확인하는 시험 서버는 `QA_PRODUCTION=1 QA_PORT=3116 npm run with-env -- qa:meetings`이며 별도 시험 schema·로컬 시험 메일만 사용합니다. 제품 서버에 시험용 메일 조회 route를 등록하지 않습니다.

## 검증 기록

환경: Node 22.22.3, PostgreSQL 17.11, macOS 27.0, Chromium. Browser plugin not available: 저장소 Playwright를 사용합니다. 테스트별 독립 PostgreSQL schema와 명시적인 시험 계정을 사용하며 공식 OAuth·SMTP·기상청 응답을 성공으로 가정하지 않습니다.

- `npm run with-env -- check`: lint·TypeScript·Vitest **83개, skip 0개**·production client/server build·server-only bundle 경계 통과. 최종 코드에서 DB 파일 순차 실행과 시나리오 내부 동시 요청을 함께 확인했습니다.
- `tests/community.test.tsx`: 실제 DB·HTTP·SSR, 본인 변경/타인 거부·오래된 버전·같은 요청·잘못된 Origin/계정·신고 처리·차단·cursor·프로필·쓰기 제한·현장 요청/확정·위치 경계·취소 회귀.
- `AUTH_SECRET= npm run with-env -- test:web`: 기존 인증·모임·streaming을 포함하는 dev/prod 브라우저 검사. 신규 화면은 글 작성/수정/댓글/삭제, 실패 입력·응답 유실 복구, 신고/차단/해제, SSR/hydration, 320px·글자 200%, 프로필, 위치 거부 주입·수동 요청·주최 승인·제어된 Geolocation 성공을 검사합니다.
- `PORT=3200 AUTH_ORIGIN=http://127.0.0.1:3200 npm run with-env -- dev`: 시험 schema가 아닌 로컬 개발 DB의 main 서버도 실행했습니다. Codex in-app browser에서 `/community`의 빈 목록·종목 필터·로그인/작성 링크를 화면으로 확인했습니다. 이 관측은 개발 실행이며 위 production build 브라우저 검사를 대체하지 않습니다.
- 실제 로컬 개발 DB에 migration을 적용하고 `community reports`의 빈 대기 목록 응답을 확인했습니다. 숨김 처리는 독립 DB 검사의 실제 service로 검증합니다.

브라우저 실행은 **34개 통과**이며 기존 인증·모임·시설·streaming과 새 Web 흐름을 함께 실행했습니다. production의 게시글 상세에서 escaped script 본문·수정/삭제·댓글 입력이 표시되고, 320px·글자 200%에서 가로 넘침 없이 조작했습니다. 현장 확인 화면에서는 수동 요청이 대기로 표시된 뒤 다른 계정인 주최자의 승인으로 바뀌고, 제어된 Geolocation 응답은 별도의 위치 확인 성공으로 표시됐습니다. 두 신규 시나리오의 `pageerror` 관측은 0건입니다. 차단 목록 503→독립 재조회→차단 해제도 실행했습니다. 화면 파일은 Playwright의 `test-results/**/community-mobile.png`, `attendance-confirmed.png`이며 명령을 다시 실행하면 생성됩니다. 자동 브라우저 조작과 화면 관측 결과이며 사람의 사용성 검사나 실제 GPS 현장 결과가 아닙니다.

발견 후 수정: 커뮤니티 로그인 복귀 허용 경로 누락, 활동 route 등록 누락, 수정 시작 버전 보존, 응답 유실 이후 확정된 댓글 입력 정리, 개인 읽기의 예상 사용자 대조, 이동 후 mutation callback 무시, 페이지 삽입/삭제 때 offset 이동, 실패 화면의 무관한 상세 재조회. 설치된 인증 adapter의 전체 schema 조사와 다른 테스트 파일의 schema 삭제가 충돌해 가입 503이 발생한 문제는 파일 실행을 순차화해 제거했습니다. 각 시나리오 내부의 동시 요청 검사는 유지합니다. 작성 양식은 hydration 전 입력을 막아 최초 타이핑이 초기 상태로 덮이는 결함을 수정했으며, JS를 끈 화면의 입력 잠금도 검사합니다. 차단 목록의 실패·재시도 표시와 저장 결과 조회의 예상 사용자 대조를 보완했습니다. 가입 제한의 시험 간 누적 429는 시험 서버의 제한 기록만 시나리오별 초기화하며 제품 제한은 유지합니다. 시험 서버가 재빌드 전 JS manifest를 재사용해 404를 내려주던 실행 문제는 해당 시험 프로세스 재시작과 `reuseExistingServer: false`로 방지합니다.

## 구분할 후속 범위

OAuth·외부 SMTP·기상청 공식 응답은 현재 설정에서 연결되지 않았습니다. Native·인증된 WebView·HealthKit·실기기·VoiceOver·최종 브랜드는 이번 Web 실행 완료 판정에 포함하지 않습니다. 공개 HTTPS 배포의 buffering, 운영 수용량, 실제 GPS 현장 검증·실사용자 피드백도 로컬 실행 결과로 대체하지 않습니다. 공개 서비스 최초 발행과 PR merge는 수행하지 않습니다.
