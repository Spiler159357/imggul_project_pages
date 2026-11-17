# 이미지 편집기 실사용 피드백 반영 명세서

작성일: 2026-11-17  
대응 계획: [피드백 수정 계획](image-editor-feedback-rework-plan.md)  
상태: 코드 반영 및 로컬 정적 검사 완료. 운영 배포·DB migration·실제 데이터 삭제·실기기 검증은 미실행.

## 1. 적용 범위

AI 생성 이미지의 수동 편집 흐름을 다시 구성했다. 새 작업의 캔버스 규격은 가로형 1216×832, 정사각형 1024×1024, 세로형 832×1216으로 유지한다. 불러오는 추가 레이어는 클립보드 이미지도 받을 수 있도록 가로·세로 각각 1216px 이내를 허용한다. 고해상도 편집은 추가하지 않았다.

작업 문서와 임시 편집은 R2에만 보관한다. 편집기 자체에는 D1 조회·쓰기·스키마 확인·런타임 DDL·IndexedDB 저장이 없다. 공용 프로젝트·캐릭터·별명 서비스가 기존에 사용하는 DB까지 삭제하는 변경은 아니다.

## 2. 피드백별 변경 사항

| ID | 요청과 문제 | 반영한 동작 | 주요 구현 |
| --- | --- | --- | --- |
| F01 | 기능 설명 부족 | 헤더·초기 화면의 도움말, 도구별 설명, 32개 도구의 사용 방법, 저장/출력/모바일/단축키 안내 추가. `?`로 열기 | `public/js/editor/help.js`, `workspace.js`, 별도 사용자 안내서 |
| F02 | 저장 위치 불명·작업 삭제 불가 | 저장 화면·하단·불러오기에서 현재 프로젝트의 편집 작업 위치 표시. 작업 목록에 썸네일·수정 시각·삭제 버튼 제공. 정식 작업 삭제 시 전용 자산과 연결된 임시 편집 정리 | `workspace.js`, `storage.js`, `src/editor/api.js`, `r2-store.js` |
| F03 | 비표준·불명확한 파일 용어 | 작업 저장/작업 불러오기/다른 이름으로 저장/이미지 내보내기로 명칭 통일. 별도 복구본·저장 버전 메뉴 제거 | `workspace.js` |
| F04 | 파일 메뉴 과다 | 파일 메뉴는 새 작업·작업 불러오기·작업 저장·다른 이름으로 저장 네 항목으로 제한. 이미지 내보내기는 헤더의 독립 버튼 | `workspace.js` |
| F05 | 템플릿·작업 복제 불필요 | 템플릿·작업 복제·사용자 프리셋 저장/불러오기·일괄 출력 UI와 실행 경로 제거. 다른 이름으로 저장과 레이어 복제는 유지 | `workspace.js`, `storage.js` |
| F06 | 여러 개의 불명확한 새 작업 진입 | 새 작업 하나의 선택창에서 프로젝트 이미지·내 기기 이미지·빈 캔버스를 선택. 이미지 fetch/decode에 성공한 뒤 작업 탭 생성. 취소·실패 시 빈 작업을 남기지 않음 | `workspace.js`, `engine.js` |
| F07 | 이미지 배치 접근 깊이·명칭 문제 | 바로 보이는 이미지 불러오기 버튼에서 현재 작업에 새 이미지 레이어 배치. 현재 작업을 새 작업으로 바꾸지 않음. 드롭·클립보드도 현재 작업에 배치 | `workspace.js` |
| F08 | 터치는 화면 이동만 됨·펜 브러시 불능 | touch 강제 hand 분기 제거. 한 손가락·펜·마우스는 선택 도구 실행. 손 도구/Space/중간 버튼은 화면 이동. 두 손가락은 이동·확대/축소. 두 번째 손가락 진입 시 미확정 획 취소. 포인터 ID 추적·취소·capture 유실 처리, 펜 사용 중 touch 간섭 차단, 0 필압 대체값 처리. 모바일 샘플 위치 선택·패스 완료 버튼 제공 | `tools.js`, `workspace.js` |
| F09 | 편집기 인페인트 불필요 | AI 편집 패널, 모델·프롬프트·비용·후보·실행/중단·결과 적용 및 전용 모듈 제거. 이미지 생성 탭의 인페인트에는 변경 없음 | `workspace.js`, `model.js`, `ai.js` 삭제, CSS 정리 |
| F10 | 별명·캐릭터 대표 썸네일 누락 | 프로젝트 이미지 선택·내보내기 폴더 선택에서 공용 선택 카드를 사용. 폴더/파일 별명과 실제 이름을 함께 표시하고 양쪽으로 검색. 캐릭터는 공용 표시 모델의 0.webp 대표 이미지 사용. 경로 안내도 별명 적용. 실패 이미지는 공용 placeholder 표시 | `asset-picker-cards.js`/`selection-ui.js` 재사용, `workspace.js`, `editor.css` |
| F11 | 모달 안내가 배경 블러에 가림 | 각 편집기 dialog 안에 `role=status`, `aria-live=polite` 안내 영역 배치. 진행·오류는 가장 위의 열린 모달에 표시하고 하단 상태도 갱신 | `workspace.js`, `editor.css` |
| F12 | 작업 닫기 경로가 깊음 | 각 작업 탭에 독립 × 버튼 추가. 변경이 있으면 저장 후 닫기/저장하지 않고 닫기/취소 선택. 닫기는 정식 문서 삭제와 분리. 마지막 탭을 닫으면 문서 없는 홈 표시 | `workspace.js` |
| F13 | 메뉴 외부 상호작용으로 닫히지 않음 | 다른 메뉴/외부 pointerdown 시 기존 메뉴 닫기. 메뉴 명령 실행 후 닫기, Esc로 닫기 | `workspace.js` |
| F14 | 재진입 시 색상 선택 UI 회귀 | 프로젝트 세션의 도구·색상 옵션을 재사용하고 마운트마다 선택창 이벤트 재연결. 작은 화면/coarse pointer뿐 아니라 실제 touch/pen도 하단 선택창 사용. PC 마우스는 기존 native 입력 유지. 진입점·내부 모듈·CSS 자산 버전 통일 | `color-picker.js`, `workspace.js`, 상위 import 및 `app.html` |
| F15 | 진입마다 자동 이름/빈 작업 누적 | 홈에는 엔진·문서가 없음. 새로고침·단순 진입으로 문서/저장 요청을 만들지 않음. 이미지로 시작해도 초기 상태를 기준선으로 설정. 이름은 첫 작업 저장에서 입력하고, 이름 미지정 상태는 메모리에만 존재 | `workspace.js`, `model.js`, `engine.js`, `storage.js` |
| F16 | 과도한 자동 저장·복구/백업 | `change` 대신 내용 확정 이벤트만 구독. 5초 debounce로 연속 편집 병합. 작업 탭 전환·편집기 이탈·visibility hidden·pagehide·beforeunload에서 변경만 임시 저장 시도. 정식 저장 경로와 분리. PNG 인코딩/해시는 자산 버전으로 재사용하고 없는 해시만 전송. 최신 임시 문서만 유지하고 참조 없는 전용 자산 정리 | `engine.js`, `storage.js`, `r2-store.js` |
| F17 | 편집기 DB 전면 제거·테스트 데이터 정리 | 라우터가 `{bucket: env.imgBucket}`만 전달. 서버 SQL/DB 콜백과 브라우저 복구 DB 사용 제거. 신규 0028 migration으로 편집 전용 테이블 삭제 및 공유 메타데이터에서 편집기 태그만 제거. 이전 R2 데이터의 목록/건수/용량 확인 후 영구 삭제 UI 제공. R2 전용 정리 Worker 추가 | `functions/[[path]].js`, `src/editor/*`, `0028_remove_editor_database.sql`, `wrangler.editor-maintenance.toml` |
| F18 | 저장·복사·붙여넣기 단축키 부족 | Ctrl/Cmd+S, Shift+S, O, C/X/V 및 합성 복사 지원. 실제 PNG 시스템 클립보드 쓰기/읽기와 native paste 이벤트 연결. 권한 제한 시 편집기 내부 복사로 대체하고 안내. 입력창의 텍스트 C/X/V·IME는 유지. paste keydown에서 이중 삽입하지 않음 | `workspace.js`, `help.js` |

각 행은 코드에 반영한 범위다. 터치·펜·브라우저 권한·저장 API의 실제 성공은 배포 환경에서 별도 확인해야 한다.

## 3. 화면과 파일 동작

### 홈과 새 작업

- 최초 진입에는 홈만 표시한다. 열린 작업은 프로젝트별 메모리 세션에서 재사용하며 새로고침 시에는 홈에서 다시 시작한다.
- 새 작업의 프로젝트 이미지와 내 기기 이미지는 원본 이미지로 시작한다. 빈 캔버스는 세 규격 중 하나를 고른다.
- 파일 선택 취소·불러오기 실패·모달 닫기 도중 취소된 새 작업은 목록에 등록하지 않는다.
- 열린 작업은 최대 8개다. 모바일에서는 모든 명령 버튼으로 화면 폭에 따라 숨겨지는 메뉴 명령도 실행할 수 있다.

### 저장·다른 이름으로 저장·불러오기

- 첫 작업 저장은 이름을 입력해야 시작한다. 이름 지정 취소는 정식 작업을 만들지 않는다. 시작한 저장의 확정 중에는 해당 입력창 닫기를 막는다.
- 저장된 작업의 작업 저장은 같은 작업 ID의 최신 문서를 갱신한다. 다른 이름으로 저장은 새 ID를 만들고 현재 탭을 그 작업으로 전환한다. 기존 정식 작업은 남는다.
- 실행 취소/다시 실행은 편집 내용만 바꾸고, 저장 후의 작업 ID·프로젝트·이름을 과거 값으로 되돌리지 않는다.
- 작업 불러오기는 저장한 작업과 임시 편집 이어하기를 구분한다. 이미 열린 ID는 해당 탭으로 이동한다. 불러오기 실패 시 기존 작업은 그대로 유지한다.
- 탭 ×의 저장하지 않고 닫기는 해당 세션의 임시 편집도 제거한다. 저장한 작업 자체의 삭제는 불러오기 목록에서 수행한다.

### 내보내기

- PNG·JPEG·WebP를 다운로드하거나 현재 프로젝트 이미지 폴더에 출력한다. JPEG의 배경색·품질을 지정할 수 있다.
- 프로젝트 출력은 임시 스냅샷을 확보하며, 출력 때문에 정식 작업을 자동 생성하지 않는다. 출력 준비 중 내용이 바뀌면 재실행을 안내한다.
- sourceKey의 원본 덮어쓰기는 금지한다. 다른 동명 파일은 사용자 확인과 ETag 비교를 통과해야 덮어쓴다. 파일별 직전 이미지 1개만 R2에 보관하며 무제한 백업을 만들지 않는다.
- 이미지 저장 후 연결 메타데이터만 실패하면 부분 성공을 명시하고 정보 저장 재시도를 제공한다. 재시도는 출력 operation ID와 실제 이미지 소유 표시가 일치할 때만 허용한다.

## 4. 저장 데이터와 프로토콜

```text
__editor/v2/{projectId}/
  saved/documents/{documentId}.json
  saved/assets/{documentId}/{sha256}.png
  autosave/{sessionId}/documents/{documentId}.json
  autosave/{sessionId}/assets/{documentId}/{sha256}.png
  tickets/{requestId}.json
  quota.json
  locks/{documentId}.json

__editor/v2/output-metadata/{sha256(outputKey)}.json
__editor/v2/output-operations/{operationId}.json
__editor/v2/output-backups/{sha256(outputKey)}/image
__editor/v2/output-backups/{sha256(outputKey)}/metadata.json
__editor/v2/maintenance/cursor.json
```

썸네일은 문서의 preview 해시로 연결한 PNG 자산이다. 정식/임시 경로가 서로의 자산을 공유하지 않으며, 다른 작업 ID와도 자산 소유권을 분리한다. 원본 프로젝트 파일을 문서 삭제 대상으로 삼지 않는다.

| API | 계약 |
| --- | --- |
| `GET /api/editor/v2/documents?projectId&kind=saved|autosave` | R2 문서 목록. 임시 항목에는 sessionId 포함 |
| `POST /documents/{id}/prepare?projectId&kind&sessionId` | 전체 manifest 검증, 요청 SHA 확인, ETag 비교, 누락 해시와 10분 전송 ticket 발급 |
| `PUT /tickets/{ticketId}/assets/{hash}?projectId` | 예약한 PNG만 업로드. 크기·실제 헤더·SHA-256 확인 |
| `POST /tickets/{ticketId}/commit?projectId` | 같은 manifest와 모든 자산 검증 후 조건부 최신 문서 확정. 같은 요청 재시도는 동일 결과 반환 |
| `GET /documents/{id}?projectId&kind&sessionId` | 문서와 현재 ETag 조회 |
| `GET /documents/{id}/assets/{hash}` / `/preview` | 현재 문서가 참조하는 자산만 조회. scope query 필요 |
| `DELETE /documents/{id}` | 문서 내용·자산 정리. scope query 필요 |
| `POST /documents/{id}/export` | 확정 스냅샷 revision과 이미지 규격 검증 후 출력 |
| `POST /maintenance/output-repair` | 부분 완료 출력의 R2 sidecar 재작성 |
| `GET/POST /maintenance/legacy` | 구 데이터 삭제 전 목록 검토와 목록 토큰 재확인 |

표의 짧은 URL은 `/api/editor/v2` 기준이다. 모든 편집 API는 관리자 인증을 요구하고, 변경 요청은 `X-Editor-Protocol: 2`가 필요하다. 구 `/api/editor/*` 저장 프로토콜은 410으로 거절한다. 공개 이미지 경로와 일반 파일 선택 목록에서는 `__editor`를 차단한다.

같은 문서의 정식/임시 자산 변경·삭제·정리는 R2 조건부 lease로 직렬화하고 문서 확정은 ETag로 한 번 더 비교한다. 409 충돌은 기존 저장본을 덮어쓰지 않고 다시 불러오기/다른 이름으로 저장을 안내한다. lease 경합은 423이며 클라이언트가 제한 횟수 내에서 재시도한다. 만료·삭제된 요청은 410으로 중단하고 같은 ID의 신규 생성으로 자동 전환하지 않는다. 임시 저장이 중단되면 명시적으로 작업 저장/다른 이름으로 저장을 수행해야 한다.

### 임시 저장 제한과 정리

- 프로젝트당 임시 작업 최대 10개, 실제 임시 객체와 진행 중 예약 합계 256MiB, 최종 임시 저장 후 7일 만료.
- 저장 전송 중 필요한 추가 자산과 manifest·ticket 공간을 먼저 예약한다. 기존 자산을 새 자산으로 교체하는 순간에도 여유 공간이 필요할 수 있다. 초과 시 507과 정리 안내를 반환한다.
- 종료 시 네트워크·브라우저의 강제 중단 때문에 마지막 비동기 저장의 완료는 보장하지 않는다. 미저장 변경이 있으면 브라우저 종료 경고를 사용한다. 주 저장 수단은 명시적인 작업 저장이다.
- 삭제 후 늦은 전송을 막기 위한 작은 삭제 장벽은 24시간 유지한다. 자산은 삭제 시 물리적으로 정리하고 장벽은 후속 정리에서 제거한다. 전송 ticket은 10분 유효하며 만료 후 유예가 지난 ticket·고아 자산을 정리한다.
- 7일이 지난 임시 작업은 불러오기를 거부한다. 물리적 삭제는 목록 조회/저장 준비와 별도 정리 Worker에서 수행한다. Worker는 매시 23분에 R2 프로젝트 prefix 최대 2개씩 순회하며, 프로젝트 수·실패 재시도에 따라 물리 삭제 시각은 만료 시각보다 늦을 수 있다.
- R2 lifecycle로 모든 자산을 생성일 기준 삭제하지 않는다. 오래됐어도 현재 문서가 참조하는 PNG가 삭제될 수 있기 때문이다.

## 5. DB 및 구 데이터 전환 절차

**이 문서를 작성하는 동안 원격 DB·R2에 삭제 명령을 실행하지 않았다.** 사용자가 commit/push한 배포가 실제 행동 검증의 선행 조건이다.

1. 편집 중인 구 탭을 종료하고 새 코드를 Cloudflare Pages에 배포한다. 새 라우터가 구 저장 요청을 거절하는지 확인한다.
2. `migrations/0028_remove_editor_database.sql`을 기존 D1 migration 절차로 적용한다. 예: `npx wrangler d1 migrations apply imggul_db --remote`. 적용 대상은 기존 `wrangler.toml`의 `imggul_db`다. Pages 코드 배포만으로 이 SQL이 자동 실행되지는 않는다.
3. migration은 `editor_workspace_revisions`, `editor_workspace_documents`, `image_editor_revisions`, `image_editor_documents` 네 전용 테이블을 `DROP TABLE IF EXISTS`로 제거한다. 공유 `file_metadata`는 테이블/행을 삭제하지 않고, editorDocumentId가 문자열인 행에서 편집기 필드 다섯 개만 제거한다. 원본 생성 메타데이터는 유지한다. 별도 수동 DML은 필요하지 않다.
4. 편집기 → 작업 불러오기 → 이전 편집기 테스트 데이터 정리 → 삭제 대상 확인에서 키/건수/용량을 검토하고 삭제한다. 기본 범위는 `__editor/` 중 v2 제외, `__editor_sessions/`, `__editor_backups/`, `editor_session/`, `editor_sessions/`다. v2 작업은 제외한다.
5. 구 출력 이미지도 지우려면 별도 포함 옵션을 선택한다. 구 출력 기록과 실제 editorDocumentId 소유 표시가 일치하는 이미지가 대상이다. 문서 sourceKey 및 0번 대표 이미지는 제외한다. 목록 확인 후 영구 삭제를 확정한다. 다른 용도로 재사용한 이미지가 있으면 포함 옵션을 사용하지 않는다.
6. `npm run deploy:editor-maintenance`로 별도 R2 전용 정리 Worker를 배포한다. 이 Worker 설정에는 D1 바인딩이 없다. 배포하지 않으면 사용 중 요청에서의 정리만 수행되고 미접속 프로젝트의 물리 정리는 지연된다.
7. 새 편집기 최초 진입 시 구 `imggul-editor-workspace` IndexedDB를 삭제한다. 구 탭이 삭제를 막으면 다른 탭을 닫으라는 안내를 표시한다. 사이트 전체 데이터·로그인 정보·공용 설정을 삭제하지 않는다.
8. 운영에서 네 편집 전용 테이블 부재, 구 R2 대상 0건, 원본·별명·캐릭터 데이터 유지, 신규 저장의 v2 객체만 증가함을 확인한다.

운영자가 사용할 명령은 다음과 같다. 먼저 대기 중인 migration 목록을 확인하고 배포된 코드와 적용 순서를 맞춘다. 아래 명령을 이번 작업에서 실행하지는 않았다.

```powershell
npx wrangler d1 migrations list imggul_db --remote
npx wrangler d1 migrations apply imggul_db --remote
npm run deploy:editor-maintenance
```

이미 적용된 0027 migration은 수정하지 않았다. 신규 설치에서도 전체 migration을 순서대로 적용한 최종 상태는 편집 전용 테이블 없음이다. 삭제 migration 이후 구 서버 코드로 단순 롤백하면 DB 기반 편집 기능은 작동하지 않는다.

### 운영 적용 명령

사용자가 commit/push해 신규 Pages 배포가 완료되고 구 편집기 쓰기 요청이 410으로 차단되는 것을 확인한 뒤 실행한다. 아래 명령을 이번 작업에서 실행하지 않았다.

```powershell
npx.cmd wrangler d1 migrations apply imggul_db --remote
npm.cmd run deploy:editor-maintenance
```

첫 명령은 D1에 아직 적용하지 않은 migration 전체를 표시하므로 적용 목록에 0028을 포함해 의도한 파일만 있는지 확인한다. SQL 콘솔을 사용한다면 `migrations/0028_remove_editor_database.sql`이 같은 정리 내용이다. 두 방식을 중복 적용하는 대신 기존 프로젝트의 migration 관리 방식을 따른다. 이후 R2 실제 삭제는 작업 불러오기의 대상 확인 화면에서 수행한다.

## 6. 검사 결과와 배포 확인 목록

로컬에서는 저장소 지침에 따라 정적 검사만 수행했다. `npm run check:editor-static`에서 JavaScript 구문, 브라우저/서버 import 번들, CSS 구문, UTF-8/BOM, 폐기 import, 내부 경로 차단, R2 capability 경계를 검사한다. 별도 AST 식별자 검사, TOML 파싱, 메모리 스키마에서 SQL EXPLAIN 컴파일, `git diff --check`, 변경 텍스트의 BOM 검사도 통과했다. SQL 확인에는 프로젝트 DB나 실제 데이터가 사용되지 않았다. 실제 브라우저·API 호출·모델 다운로드·원격 DDL/DML 실행은 하지 않았다.

배포 후 확인할 항목:

1. 홈 진입/새로고침/탭 왕복으로 정식 작업이나 임시 작업이 늘지 않는지 확인.
2. 세 규격에서 새 작업 → 손가락/펜/마우스 브러시 → 실행 취소 → 저장 → 불러오기 → 내보내기.
3. 선택·패널·화면 이동만 했을 때 저장 요청 없음, 획을 그리는 도중 전체 저장 없음, 확정된 연속 편집만 5초 후 병합 저장.
4. 저장 취소, 파일 선택 취소, 이미지 해석 실패, 작업 불러오기 도중 닫기에서 유령 작업이 남지 않음.
5. 다른 이름으로 저장 후 Undo가 작업 ID/이름을 되돌리지 않음. 두 브라우저의 동시 저장은 충돌로 안내.
6. 작업 삭제 중 대기 저장이 재생성하지 않음. 해당 작업 자산만 삭제되고 원본·다른 작업·출력 이미지는 유지.
7. 임시 작업 10개/256MiB 제한, 7일 만료, 만료 ticket 정리와 정리 Worker 로그 확인.
8. 별명이 있는 프로젝트/캐릭터/상황/파일과 0.webp 대표 썸네일, 썸네일 실패 placeholder 확인.
9. 모달 안에서 로딩·저장·오류 안내가 블러 없이 보임. 메뉴 외부 누르기/Esc, 작업 탭 × 확인.
10. 모바일 세로/가로·펜·하이브리드 기기에서 색상 선택, 다른 탭 왕복, 색 적용/취소, 다크/라이트 테마 확인.
11. 시스템 이미지 복사·외부 이미지 붙여넣기·합성 복사·권한 거부 대체·텍스트 입력 중 C/X/V·한국어 IME 확인.
12. 프로젝트 출력 동명 충돌·원본 보호·metadata 부분 실패 재시도, 갤러리의 R2 출력 정보 조회 확인.

참고한 저장 계약: [R2 Workers API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/), [D1 migration](https://developers.cloudflare.com/d1/reference/migrations/).
