# 걷기 · Native와 React 경계

현재 변경은 코드 작성 단계이며 빌드·테스트·서명·기기 실행을 수행하지 않았습니다. 실제 HealthKit 읽기와 background 전달, WebKit 인증·복귀는 미검증입니다.

## 배포 설정과 요청 복구

- `project.yml`의 `CMON_API_URL` 빌드 설정을 `CmonAPIBaseURL` Info.plist 값으로 앱에 포함합니다. Release는 사용자 정보·경로·쿼리가 없는 HTTPS origin이 필요하며, 미설정/잘못된 설정에서는 서비스 연결 불가 화면을 표시합니다. Debug에서만 미설정 시 `http://127.0.0.1:3000`을 사용합니다. 운영 주소와 서명·프로비저닝은 실제 배포 전에 지정해야 합니다.
- 모임 생성·수정·참여·취소도 origin/계정/endpoint별 `MeetingCommands` 보호 파일에 원본 key/body를 저장한 뒤 보냅니다. 모임 작성 또는 상세에 재진입하면 저장된 명령의 결과를 조회하며, 새 명령으로 덮어쓰지 않습니다. 결과가 없을 때는 ‘같은 요청 다시 보내기’에서만 원본을 재전송합니다. 파일은 백업에서 제외하고 기기 잠금 시 접근을 제한합니다.
- 위 복구 동작과 Release 설정용 회귀 테스트는 코드로 추가했으나 실행하지 않았습니다. 전송 전 저장 실패·응답 손실·앱 종료 후 복구·키체인 잠금·계정 전환은 실제 기기 검증이 남아 있습니다.

- `WalkingTab`은 오늘의 기기 걸음 기록, 서버 반영, 건강 연결, 동기화와 결과 조회를 표시합니다. `/quests?surface=native`에서 React가 원정과 보상을 표시합니다.
- `HealthStepProvider`는 stepCount 읽기만 요청하고, `HKStatisticsCollectionQuery`의 날짜별 통계 합계를 사용합니다. 각 원천의 raw sample을 직접 합산하지 않습니다. 날짜 경계와 interval calendar는 Asia/Seoul이며 오늘부터 7일 전까지 읽습니다.
- 권한 요청 성공은 읽기 허용을 뜻하지 않습니다. 조회 결과가 없거나 날짜별 sum이 없으면 해당 날짜를 payload에서 제외하며 0으로 채우지 않습니다. 실제 통계값이 0인 경우만 0을 전송할 수 있습니다. 백그라운드 전달과 관측 오류는 읽기 허용을 증명하지 않습니다.
- `WalkingSyncService`는 `AccountSession`의 Native HTTP 인증을 사용하며 WebKit 준비와 독립합니다. 원본 건강 기록이나 자격증명을 로그에 남기지 않습니다. 서버에는 날짜별 합계만 전송합니다.
- 첫 기기 연결부터 명령 키·payload를 origin/계정별 보호 파일에 원자적으로 저장한 뒤 전송합니다. sync revision도 전송 전에 저장합니다. 재실행·오프라인·계정 전환 이후 미확정 요청을 찾으면 GET 결과 조회를 먼저 하고, 같은 mutation은 버튼을 통한 명시 재시도에서만 전송합니다. 새 계정으로 이전 계정의 batch를 보내지 않습니다.
- 서버의 `sourceRevision`으로 같은 기기의 source를 복구합니다. 다른 기기의 source를 자동 채택하지 않습니다. `COMMAND_CONFLICT`는 미확정 상태를 유지해 결과 조회를 제공합니다. 확정적인 요청 거절은 pending을 해제하고 소비한 revision은 보존합니다.
- HKObserverQuery와 background-delivery entitlement를 선언하고, 시스템 알림과 foreground 진입에서 최근 날짜를 다시 조회합니다. 전달 시각·주기·앱 종료 상태의 동기화를 보장하지 않습니다. 기존 Keychain `WhenUnlockedThisDeviceOnly`와 파일 `completeFileProtection`을 유지하므로 잠금 중 자격증명·batch 접근이 불가할 수 있습니다. 잠금 해제 후 앱 재진입으로 복구해야 합니다.
- 앱 계정 generation 변경 시 오래된 결과를 버립니다. 로그아웃은 계정별 journal을 다른 계정에 넘기지 않으며, 미확정 요청의 추후 조회를 위해 해당 계정 저장 기록을 유지합니다. 저장 파일은 기기 백업에서 제외합니다.
- 잠금 중 최초 Keychain 복원에 실패한 경우에만 다음 계정 새로고침에서 자격증명을 다시 읽습니다. 로그아웃은 이 재시도 상태를 해제합니다. 자동 건강 조회·전송은 현재 계정에 연결된 이 기기의 source가 확인된 뒤에만 수행합니다.
- WebView는 HttpOnly cookie를 Native에서 설정한 비영속 저장소를 사용합니다. JavaScript에 토큰을 넘기거나 걷기 bridge를 추가하지 않습니다. 동일 origin의 `/quests`만 WebView에서 열고, 다른 웹 페이지의 사용자 클릭에는 ‘브라우저에서 열기’를 제시합니다. 하위 frame 발신과 자동 외부 탐색은 차단합니다. Native ‘걷기로 돌아가기’ 버튼으로 닫고 현재 상태를 다시 조회합니다.

`CmonYo.entitlements`, `Info.plist`, `project.yml`의 권한·서명 입력만 추가했습니다. 실제 Developer capability와 provisioning 일치 여부, HealthKit 통계의 기기 시간대·날짜 경계·복수 원천 처리, 잠금/강제종료/오프라인 복구, 계정 전환, Dynamic Type·VoiceOver·작은 화면은 향후 실행 검증 대상입니다. Simulator 스크립트에도 새 파일과 entitlement를 반영했으나 실행하지 않았습니다.
