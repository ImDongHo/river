## GitHub Actions 자동 수집 관련 알려진 이슈 (2026-09-07)

- **증상**: `강 수위 값 자동 수집` 워크플로우는 매일 성공(초록색)으로 뜨지만, 실제로는 `data/` 폴더에 새 커밋이 안 쌓이고 있었음.
- **원인**: HRFCO API(`api.hrfco.go.kr`) 호출이 GitHub Actions 러너(해외 클라우드 IP)에서 매번 `UND_ERR_CONNECT_TIMEOUT`으로 실패. 로컬(한국 IP)에서는 동일 요청이 정상 동작 확인됨 → HRFCO 서버가 해외 IP 대역을 막고 있는 것으로 추정.
- **현재 상태**: `scripts/fetch-and-store.mjs`의 에러 로그에 `e.cause`를 출력하도록 개선해 원인을 특정함. GitHub Actions 자동화는 보류.
- **필요시 대안**:
  1. 로컬에서 수동 실행 후 커밋 (`HRFCO_AUTH_KEY=키값 node scripts/fetch-and-store.mjs`)
  2. Windows 작업 스케줄러로 로컬 PC에서 매일 자동 실행 + git push
  3. GitHub self-hosted runner를 로컬 PC에 등록
  4. 대안 API 후보: 공공데이터포털의 `행정안전부_홍수통제소수위10분` (https://data.go.kr/data/15153508/openapi.do) — 플랫폼이 달라 IP 차단이 없을 가능성 있음, 단 관측소 코드·응답 필드가 HRFCO 자체 API와 동일한지 별도 검증 필요.  
