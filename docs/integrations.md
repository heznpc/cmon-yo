# API·OAuth 설정과 실연결

`.env.example`을 복사한 `.env`에 값을 넣으면 현재 서버 코드가 읽습니다. **OAuth 앱 등록·callback·동의 항목을 공급자 콘솔에서 설정한 뒤 연결 시험을 시작할 수 있습니다.** 키를 채우는 것만으로 정상 연결이 검증되지는 않습니다. 예시 파일과 저장소에는 실제 비밀값을 넣지 않습니다.

## 공통 준비

1. `DATABASE_URL`과 별도 `TEST_DATABASE_URL`, 32자 이상의 `AUTH_SECRET`을 설정합니다. 비밀값 생성에는 `openssl rand -hex 32`를 사용할 수 있습니다.
2. `AUTH_ORIGIN`을 실제 브라우저 접속 주소와 맞춥니다. 기본 개발 주소는 `http://127.0.0.1:3000`입니다. `localhost`는 다른 origin이며, 경로·마지막 `/`를 붙이지 않습니다.
3. 아래 migration을 실행하고 서버를 재시작합니다. 실행 중인 서버의 환경변수는 파일 저장만으로 바뀌지 않습니다.

```sh
npm run with-env -- auth -- migrate
npm run with-env -- facilities -- migrate
npm run with-env -- meetups -- migrate
npm run with-env -- dev
```

시설·모임·게시글·댓글 API는 자체 서버와 PostgreSQL을 사용합니다. 외부 커뮤니티 SaaS 키는 필요하지 않습니다. 시설 원본 수집과 데이터 적재는 [README](../README.md#pr2-시설날씨-실행)를 따릅니다.

## 공급자별 입력과 콘솔 설정

| 연결      | `.env`에 입력                                                       | 콘솔에서 먼저 확인할 사항                                                                                                  |
| --------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Google    | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`                          | Web application OAuth 클라이언트, 동의 화면, 필요한 테스트 사용자, 승인된 redirect URI                                     |
| 카카오    | `KAKAO_CLIENT_ID`에 REST API 키, `KAKAO_CLIENT_SECRET`              | 카카오 로그인 사용, callback URL, 계정 이메일 등 요청 정보의 동의 항목·사용 권한, 테스트 계정                              |
| 네이버    | `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET`                            | 네이버 로그인 앱, 서비스 URL, callback URL, 프로필 제공 항목과 개발/서비스 이용 조건                                       |
| Apple Web | `APPLE_CLIENT_ID`에 Services ID, `APPLE_CLIENT_SECRET`에 서명한 JWT | Sign in with Apple을 활성화한 기본 App ID와 Services ID 연결, 허용 HTTPS 도메인·return URL, 로그인 전용 키와 JWT 만료 갱신 |
| 기상청    | `KMA_API_KEY`                                                       | API허브의 단기예보 API 사용이 가능한 `authKey`. 공공데이터포털 `serviceKey`와 다릅니다.                                    |
| SMTP      | `AUTH_MAIL_TRANSPORT=smtp`, `EMAIL_SMTP_*`, `EMAIL_FROM`            | 발송 가능한 SMTP 계정과 발신 주소/도메인 인증. 465는 TLS, 다른 포트는 STARTTLS를 요구합니다.                               |

OAuth는 ID와 secret을 **둘 다** 입력한 공급자만 Web 로그인 화면에 표시합니다. 네 공급자를 전부 활성화할 필요는 없습니다. 반쪽 설정은 서버 시작 오류가 됩니다. 공급자의 이메일 제공·인증 정보가 계정 정책과 맞는지도 실제 왕복에서 확인합니다.

callback은 다음과 같습니다. `<AUTH_ORIGIN>`을 실제 값으로 바꿔 콘솔에 정확히 등록합니다.

```text
<AUTH_ORIGIN>/api/auth/callback/google
<AUTH_ORIGIN>/api/auth/callback/kakao
<AUTH_ORIGIN>/api/auth/callback/naver
<AUTH_ORIGIN>/api/auth/callback/apple
```

Google은 공식 문서에서 로컬 개발 redirect를 허용합니다. Apple Web은 허용된 HTTPS 도메인을 준비해야 하므로 기본 `127.0.0.1` 설정만으로는 진행할 수 없습니다. Apple의 로그인용 client secret은 단순 문자열 암호가 아닌 서명한 JWT이며, App Store Connect API 키를 대신 사용하지 않습니다.

공식 설정 근거: [Google Web OAuth](https://developers.google.com/identity/protocols/oauth2/web-server), [카카오 로그인 사전 설정](https://developers.kakao.com/docs/ko/kakaologin/prerequisite), [네이버 로그인 API](https://developers.naver.com/docs/login/api/api.md), [Apple Web 설정](https://developer.apple.com/help/account/capabilities/configure-sign-in-with-apple-for-the-web/), [기상청 API허브](https://apihub.kma.go.kr/apiList.do?seqApi=10).

## 시설 지도

Web은 MapLibre GL JS와 [OpenFreeMap의 공식 공개 지도](https://openfreemap.org/quick_start/), Native는 MapKit을 사용합니다. 두 경로 모두 이번 구현에 입력할 API 키가 없습니다. 공공시설 API에 있는 좌표를 핀으로 표시하며 사용자 현재 위치 권한을 요청하지 않습니다.

지도 배경은 외부 네트워크 연결이 필요하고 Web은 WebGL을 사용합니다. 초기화·배경 요청 실패 시 오류와 재시도를 표시하며 시설 목록·상세는 계속 이용할 수 있습니다. OpenFreeMap·OpenMapTiles·OpenStreetMap의 출처 표기를 유지합니다. 자동 회귀 검사는 시험용 지도 스타일·GeoJSON으로 외부 트래픽을 만들지 않으며, 실제 지도 배경 표시는 별도로 실행 확인합니다.

## 시설 찜

이메일 인증을 마친 계정은 `/places`의 시설 행·선택 카드와 시설 상세에서 찜을 저장하거나 해제할 수 있습니다. 상태는 `place_favorites`에 계정별로 저장하며 `GET /api/v1/me/place-favorites`, `PUT`·`DELETE /api/v1/me/place-favorites/{id}`를 사용합니다. 로그인하지 않은 사용자는 안내만 보고 저장 요청을 보내지 않습니다. 마이그레이션은 시설 테이블과 함께 적용되며 인증 테이블이 아직 없는 시설 전용 시험 스키마에서도 실행할 수 있습니다.

## 값 입력 후 확인할 흐름

- **OAuth:** `/account`의 활성화된 공급자 버튼 → 동의 → callback → 원래 화면 복귀 → 새로고침·로그아웃. 취소·거절과 이미 존재하는 이메일 계정의 충돌도 확인합니다. 버튼 표시만으로 연결 성공을 판정하지 않습니다.
- **기상청:** `/places`에서 실제 시설 상세 → 단기예보. 현재 adapter는 API허브 `VilageFcstInfoService_2.0/getVilageFcst`를 호출합니다. 실제 예보 시각·공급자 응답을 확인하고, 키 누락/오류의 `unavailable`을 성공으로 표시하지 않습니다.
- **SMTP:** 시험용 계정의 가입 인증·비밀번호 복구 메일을 실제 수신하고 링크를 확인합니다. `AUTH_MAIL_TRANSPORT=local`은 `.cache/auth-mail` 파일 수신함이며 외부 발송이 아닙니다. production 계정 런타임은 SMTP 설정을 요구합니다.

Native는 `CMON_API_URL`을 앱 실행 환경에 별도로 전달해야 합니다. 서버 `.env`를 자동으로 읽지 않습니다. 현재 Native는 이메일 로그인과 인증된 Web 댓글 복귀를 구현했으며, **Native 소셜 로그인 시작·복귀는 추가 구현 대상**입니다. `SETUP_*` 변수는 메모이고 런타임에서 읽지 않습니다. OAuth 동의 화면을 댓글용 WKWebView에 넣지 않습니다.

2026-09-14 기준, 로컬 DB·시험 메일/날씨 공급자의 동작은 검증했으나 공식 OAuth·기상청 정상 응답·외부 SMTP 수신은 미검증입니다. 이번 문서 수정은 공급자 활성화나 실연결 성공을 의미하지 않습니다.
