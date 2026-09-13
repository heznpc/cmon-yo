# PR1 — 공개 모임의 Web·API·iOS 연결

## 범위

공통 공개 fixture → 같은 service의 Fastify API / React SSR → hydration / 실행 iOS의 HTTP 조회 → 읽기 전용 WKWebView → 기존 Native 상세 복귀.

DB, 인증, GPS, 외부 시설·날씨 API, 참여 mutation, 댓글 저장, HealthKit, Push, 리워드, CDN, codegen은 제외합니다. discussion은 기술 연결 시험이며 최종 커뮤니티 UX의 결정이 아닙니다.

## 사전 검토 반영

SQL의 기존 출석 NULL 조합 조건과 unknown fallback을 새로운 누락으로 취급하지 않습니다. Native HTTP 연결은 설계 부재가 아닌 완료 조건 보완입니다. PR3는 모임 생성·참여·취소, 개인 cache와 계정 전환을 포함합니다. PR3에서 중복 실행 방지·오래된 응답 차단·늦게 도착한 최초 명령의 보장 범위를 각각 정의합니다.

## 수용조건과 증거

| 항목 | 입력 / 기대 동작 | 증거 |
| --- | --- | --- |
| 실제 HTTP | Native가 실행 Fastify에서 모임을 조회. 내장 fixture로 조용히 대체하지 않음 | 실제 HTTP 응답 변경·404·연결 실패를 각각 실행 확인 |
| 공통 계약 | 동일 fixture를 TS/Swift 테스트가 사용. 누락·null·형식 오류·unknown의 경계별 기대값 명시 | 계약 fixture 행렬과 양쪽 테스트 |
| SSR | API와 loader가 같은 service 직접 호출. JS 없이 제목·일시·장소 표시 | API/loader 테스트, JS 비활성 browser DOM |
| hydration | 실제 사용자 조작 연결. 정상 초기 query 즉시 중복 조회 없음 | browser interaction과 요청 수 |
| SSR 격리 | 요청별 QueryClient·dehydrated state 격리 | 겹치는 요청의 순서를 통제한 검사와 공유 client를 넣은 결함 검출 확인 |
| bundle | server-only 코드·비밀 값이 browser bundle에 없음 | production asset 검사 |
| bridge | capabilities/openMeetup 계약. Native 수락과 웹 응답 관측 구분 | 정상 왕복·중복 push 방지·화면 종료 처리 |
| bridge 발신자 | 실제 frame의 scheme/host/port와 main-frame 검사 | 실제 WebKit의 비허용 origin/subframe 메시지에도 navigation 0회 |
| 오류·중단 | 알 수 없는 message/version·잘못된 payload 거부, SSR 오류·중단 정리 | 단위 검사와 실제 통합 검사를 구분 |
| 직렬화 | 악성 초기 문자열이 script 실행이나 DOM 삽입을 일으키지 않음 | 악성 fixture와 browser 검증 |
| 실행 | 개발 서버와 production build 서버 실행, iOS 앱 실행 | 명령·환경·관측 결과 |

## 판정 범위

PR1 통과는 인증 공유, 실데이터 품질, 제품 수요, 참석 신뢰 효과, 운영 처리량의 증거가 아닙니다. 성능 탐색은 환경과 측정 범위를 남기며, 비교 검증 없이 개선을 주장하지 않습니다.

## Bridge v1 종료 계약

Native 수락 시점은 활성 host가 실제 main-frame origin과 메시지를 검증한 직후입니다. `openMeetup`은 현재 모임 ID만 지원하며 다른 ID는 unsupported입니다. 웹의 pending 정리는 Native 명령 취소가 아닙니다.

| 종료 시점 | Native 이동 | 웹 응답 |
| --- | --- | --- |
| 전송 전 웹 종료 | 0회 | closed, 전송하지 않음 |
| Native 수락 전 host 종료 | 0회 | 살아 있는 문서는 closed 오류 관측 가능, 사라진 문서는 미관측 가능 |
| Native 수락 후 웹/host 종료 | 수락한 복귀 실행 유지 | 응답을 관측하거나 종료로 미관측 가능. 미관측을 미실행으로 해석하지 않음 |
| 정상 왕복 | discussion을 닫고 기존 Native 모임으로 복귀, 중복 push 없음 | requestId와 일치하는 accepted 결과. 화면 해제와 응답 관측 순서는 독립적 |

capabilities는 version 1과 openMeetup 지원을 응답합니다. 잘못된 version/type/payload는 error/unsupported, 비허용 frame/origin은 거부하고 이동 0회입니다. 웹은 timeout·closed·transport 실패에서 자동 재전송하지 않습니다. 일반 브라우저에서는 같은 의도를 Web 상세 링크로 연결합니다.

검증은 웹 pending/timeout 정리, 실제 WebKit 발신자 검사와 수락 전후 종료, Simulator 정상 복귀를 나눠 수행합니다. 동일 화면 복귀 보장은 모든 재전송·WebView 재생성의 중복 실행 방지 보장이 아닙니다. 범용 취소 프로토콜·영구 요청 저장소는 PR1에 만들지 않습니다.
