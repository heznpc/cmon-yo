# HTTPS 실행과 검증

관련 이슈: [#10](https://github.com/heznpc/cmon-yo/issues/10). 단일 서버에서 Caddy가 HTTPS를 종료하고 loopback의 Fastify로 전달하는 구성입니다. 현재 등록된 GitHub deployment·environment·서비스 주소는 없습니다. 아래 설정을 만들었다는 사실을 공개 배포 완료로 기록하지 않습니다.

## 서버 실행

Node 22.22.3, PostgreSQL, Caddy 2.11.4로 확인했습니다. 서버와 도메인이 정해진 뒤 도메인의 DNS를 해당 서버에 연결하고 80/443을 Caddy에 전달합니다. Node의 3000과 PostgreSQL은 외부에 공개하지 않습니다. 기존 서버를 사용한다면 포트·도메인 충돌을 먼저 확인합니다.

제품 `.env`에는 `DATABASE_URL`, 충분한 `AUTH_SECRET`, `AUTH_ORIGIN=https://<배포 도메인>`, `HOST=127.0.0.1`, `PORT=3000`, `TRUST_PROXY=loopback`을 설정합니다. 이메일 인증을 제공하는 production은 유효한 SMTP 설정이 필요합니다. 테스트 메일 수신함과 `/_perf`·`/_test` 경로를 제품 서버에 등록하지 않습니다. OAuth 설정은 HTTPS 실행의 선행조건이 아닙니다.

```sh
npm ci
npm run with-env -- auth -- migrate
npm run with-env -- facilities -- migrate
npm run with-env -- meetups -- migrate
npm run build
npm run with-env -- start

# 다른 터미널/서비스 관리자에서 실행합니다. CMON_DOMAIN은 실제 도메인입니다.
CMON_DOMAIN="$CMON_DOMAIN" caddy run --config deploy/Caddyfile --adapter caddyfile
```

공개 서비스 최초 발행 전에 실제 도메인·서버·외부 노출 범위를 확정합니다. 이 실행에서는 공개 서버 생성·DNS 변경·인증서 발급·과금 자원 생성을 수행하지 않습니다. 운영 서버에서는 프로세스 재시작·로그 보존·DB 백업/복구와 배포 전 migration을 서비스 관리 체계에 연결해야 합니다.

`TRUST_PROXY`를 비우면 전달 헤더를 신뢰하지 않는 기존 동작입니다. `loopback`은 `127.0.0.1`·`::1`만 허용하며 전체 주소/홉 수 신뢰는 지원하지 않습니다. 인증 handler는 이 결과로 얻은 IP를 사용하며 사용자가 보낸 `X-Cmon-Client-IP`는 대체합니다. Caddy 앞에 다른 프록시/CDN을 추가하면 이 구조의 검증 결과를 그대로 적용하지 않습니다.

`proxy.caddy`의 양수 `flush_interval`은 연결 종료 전파를 유지합니다. 길이가 정해지지 않은 SSR 응답은 스트림으로 전달하며, gzip도 검사합니다. `flush_interval -1`은 Caddy에서 소비자 종료 시 upstream 요청을 취소하지 않는 동작이 있어 사용하지 않습니다. [Caddy 공식 문서](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy), [Fastify 신뢰 프록시 설정](https://fastify.dev/docs/latest/Reference/Server/#trustproxy)을 참고했습니다.

## 로컬 HTTPS 검사

공식 Caddy release의 바이너리와 SHA-512 checksum을 대조한 뒤 `CADDY_BIN`으로 경로를 전달합니다. 저장소는 바이너리·인증서·키를 커밋하지 않습니다. Docker daemon이나 시스템 인증서 저장소 변경은 필요하지 않습니다.

```sh
CADDY_BIN=/path/to/caddy npm run with-env -- qa:https
# 지속 부하도 실행할 때
CADDY_BIN=/path/to/caddy CMON_LOAD=1 npm run with-env -- qa:https
```

스크립트는 production Web/SSR을 빌드하고 독립 DB schema에 시설 21개·모임 40개·글 2,000개·댓글 8,000개·시험 계정 2개를 준비합니다. loopback 3130/3131/3443을 사용합니다. 임시 self-signed 인증서를 Node 검사 클라이언트의 CA 목록에만 전달하며 인증서 검증을 끄지 않습니다. 시스템/브라우저의 신뢰 저장소는 변경하지 않습니다. Caddy의 설정·데이터도 `.cache/transport/run`에 둡니다.

검사: HTTP/1.1 identity/gzip·HTTP/2 gzip의 실제 시설 본문 선도착 → 공급자 해제 → 날씨 도착, 공유 요청 중 한 소비자의 종료, 마지막 소비자의 종료, timeout/복구, Secure cookie와 두 계정, 잘못된 Origin, private/no-store, 해시 자산 cache, 404, 시험 제어 경로의 프록시 차단입니다. 종료 시 이 실행에서 시작한 프로세스와 시험 schema를 정리합니다.

결과는 `.cache/transport/transport.json`, `load.json`에 저장하며 credential·위치 원본을 결과에 포함하지 않습니다. 로컬 CA 검사는 공개 인증서 발급·실제 HTTPS 도메인·Safari의 인증서 신뢰 검증이 아닙니다. 실제 배포에서는 해당 도메인에서 브라우저 본문/날씨 도착 순서와 취소를 다시 확인해야 합니다.

부하는 닫힌 루프에서 worker당 요청 1개를 유지합니다. 동시 1/8/32, 정상 cache·700ms 공급자 지연·공급자 실패를 구분하고 각 조합은 warm-up 1초 후 5초씩 3회입니다. API·SSR·개인 조회 8경로를 순환하며 gzip 응답 본문 byte를 기록합니다. 로그인은 준비 단계로 완료하며 준비 간 시험 제한 기록만 초기화합니다. 제품 rate limit·정원·버전 검사는 유지합니다. 로그인/쓰기 처리량, 운영 수용 인원, 장시간 안정성, 별도 부하 발생기·운영 서버의 결과로 해석하지 않습니다.

요청 지연은 헤더 도착과 전체 응답 완료를 구분합니다. SSR 전체 완료는 날씨도 기다리므로 본문 표시·LCP와 다릅니다. CPU/RSS·pool 대기는 Node 프로세스 관측이고 Caddy/DB 전체 자원 사용량은 아닙니다. DB wait는 50ms 간격 표본, event loop는 20ms 해상도의 지연 histogram입니다. 부하 발생기·DB·앱이 같은 Mac에서 실행되므로 운영 한계로 환산하지 않습니다.

측정 결과는 [성능 실행 기록](../docs/performance-acceptance.md), 실제 위치 검증은 [Web 수용조건](../docs/web-activity-acceptance.md)을 따릅니다.
