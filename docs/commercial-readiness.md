# 상용화 전 코드 점검 — 2026-10-03

현재 저장소는 상용 출시 품질을 확인한 상태가 아닙니다. 기능 구현 외에 계정 격리, 실패 후 복구, 운영 설정·DB 변경 누락 방지에서 아래 결함이 있었고 코드로 보강했습니다. 앱·서버·DB·컴파일러·테스트·디버거는 실행하지 않았습니다. 이 문서는 정적 검토 결과이며 실행 성공이나 모든 오류 제거를 뜻하지 않습니다.

## 수정한 경로

| 사용자·운영 문제 | 코드 변경 | 작성한 회귀 검사 |
| --- | --- | --- |
| 계정 전환 뒤 다른 계정의 찜 상태가 남거나 늦은 응답이 현재 화면을 갱신 | 계정별 query key, SSR 찜 복원, X-Cmon-User 검사, 변경 요청 취소·콜백 소유 계정 확인 | commercial-readiness, community Web |
| 네트워크 단절·HTML gateway 응답·잘못된 성공 응답을 저장 거절로 오인 | HTTP 상태 보존, NETWORK_ERROR/INVALID_RESPONSE 구분, 408·5xx 미확정 요청 번호 유지 | http-client, public-api |
| iOS 앱 종료 후 모임 생성·수정 요청 번호 소실 | 계정·서버·대상별 보호 파일에 먼저 저장하고 결과 확인 뒤 제거, 저장 실패 시 전송 중지 | NativeSafetyTests |
| HealthKit 동기화의 이전 활성화 응답이나 다른 source 영수증이 새 상태를 덮어씀 | 활성화 세대 구분, source 변경 시 revision 재설정, sync 영수증 source 일치 검사 | WalkingTests |
| 모집 중 계정 탈퇴 후 원정 정원 점유 | 새 SQL migration 007에서 시작 전 좌석 제거, 시작 후에는 익명 합산만 유지 | walking DB 시나리오 |
| 운영 설정·DB migration 누락에도 서버 수신 시작 | 설정 사전 검사, HTTPS origin·SMTP·loopback 강제, migration journal/checksum 확인 | commercial-readiness, walking |
| 처리한 5xx 누락·내부 예외 노출·종료 무기한 대기 | 안전한 오류 응답, 상태별 관측, liveness/readiness, 종료 유예 제한, idle DB 오류 처리 | commercial-readiness |
| 현장 확인 GET의 rejected Promise가 제품 오류 envelope를 우회 | try/catch 내부에서 service Promise를 await | 기존 attendance 계약 검사 대상 |
| 이름·글·모임·원정·수동 확인 사유의 NUL 입력이 DB 오류로 전달 | 입력 경계 거부, Web/Native 이름 정규화 공유 | commercial-readiness, walking |
| 초안 지역 유실·거리 기반 페이지 전환 조건 유실·선택 시설 누락 | 지역 초안 정리 계약 수정, 오래된 초안 기본값, URL 조회 조건 보존, 시설 선택 재동기화·실패 재시도 | community, regions Web |
| 화면 chunk 로드 실패 또는 렌더 오류로 복구 수단 소실 | React 오류 경계, 초기 준비 실패 안내와 새로고침, SSR 본문 유지 | recovery Web |
| iOS 잘못된 배포 주소·닫힌 WebView 후 응답 반영 | Release HTTPS origin 검사·설정 실패 화면, WebView 수명·취소 처리 | NativeSafetyTests, 기존 bridge 검사 대상 |

## 기존 오류 기록 조사

- 과거 Web CI의 게시글 제목 선택 실패는 숨겨진 SSR 양식과 표시된 양식을 함께 찾는 selector 문제였습니다. main의 `d17a04a` 수정과 동일하게 표시된 textbox의 role/name을 사용했습니다.
- 과거 Conventions 실패는 잘못된 커밋 저자와 공동 저자 trailer 때문이었습니다. 새 커밋은 저장소 규칙의 단일 noreply 신원을 사용합니다. 과거 커밋은 재작성하지 않습니다.
- CI의 Node 20 Action 경고는 checkout/setup-node v4에서 발생했습니다. 공식 v5의 `action.yml`이 Node 24를 선언한 것을 확인하고 두 workflow를 변경했습니다. 제품 Node 버전은 `.nvmrc`를 유지합니다.
- CI DB 준비는 전체 통합 migration 명령을 사용하도록 변경했습니다. 새 workflow 실행 결과는 이 기록의 근거가 아닙니다.

## 남아 있는 출시 판단 조건

이번 변경의 컴파일·테스트·SQL 적용·개발/production UI·실기기·접근성·동시성·부하 결과는 모두 미검증입니다. 이전 커밋의 CI 성공은 이번 변경을 입증하지 않습니다. 외부 인증·메일·날씨 연결, 운영 HTTPS 주소와 iOS 배포 주소, 백업 복원·장애 복구·알림 운영 역시 실제 환경 확인이 필요합니다. 코드는 이 조건이 부족할 때 실패를 숨기거나 운영 준비가 됐다고 표시하지 않도록 보강했습니다.

리워드는 현재 포인트·앱 내 배지 교환입니다. 현금·상품권 정산이나 기기 무결성 증명까지 구현된 것으로 해석하지 않습니다. 실행 제한을 해제한 뒤 변경된 경로를 검증하기 전까지 PR은 draft로 유지합니다.
