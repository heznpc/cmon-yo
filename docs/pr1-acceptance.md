# PR1 — 공개 모임의 Web·API·iOS 연결

## 범위

공통 공개 fixture → 같은 service의 Fastify API / React SSR → hydration / 실행 iOS의 HTTP 조회 → 읽기 전용 WKWebView → 기존 Native 상세 복귀.

DB, 인증, GPS, 외부 시설·날씨 API, 참여 mutation, 댓글 저장, HealthKit, Push, 리워드, CDN, codegen은 제외합니다. discussion은 기술 연결 시험이며 최종 커뮤니티 UX의 결정이 아닙니다.

## 사전 검토 반영

SQL의 기존 출석 NULL 조합 조건과 unknown fallback을 새로운 누락으로 취급하지 않습니다. Native HTTP 연결은 설계 부재가 아닌 완료 조건 보완입니다. PR3에서 중복 실행 방지·오래된 응답 차단·늦게 도착한 최초 명령의 보장 범위를 각각 정의합니다.

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
