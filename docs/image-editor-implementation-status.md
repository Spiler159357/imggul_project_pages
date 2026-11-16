# 이미지 편집기 구현 및 검증 기록

작성일: 2026-11-17  
기준: [62개 작업 실행 계획](image-editor-implementation-roadmap.md)

## 현재 상태

0~11단계에 해당하는 신규 UI·엔진·저장·수동 편집·AI·출력·효율 확장 코드를 반영했다. 구 편집기의 실행 진입점·전용 CSS·API·문서 테이블 갱신 의존성을 제거했다. 신규 구현은 기존 편집 문서를 이전하지 않는다.

**소스 구현과 정적 확인은 실행 동작 검증 완료를 의미하지 않는다.** E09-03·E09-05의 Cloudflare 통합 검증, 다른 단계의 배포 종료 조건, 고급 도구·자동 분리의 품질·성능 평가는 미실행이다. 따라서 계획 전체의 종료 조건을 모두 통과했다고 표시하지 않는다.

저장소의 AGENTS.md에 따라 로컬 브라우저·E2E·라이브 API 테스트를 실행하지 않았다. commit/push와 배포도 수행하지 않았다. 사용자가 commit/push한 배포에서 검증한다.

## 단계별 반영 범위

| 단계 | 코드·설계에 반영한 범위 | 주 산출물 |
| --- | --- | --- |
| 0 | 세 규격·원본 보존·좌표/alpha·합성/명령·저장/AI 계약, 세 비율 UI 시안 | design-contracts, ui-spec, wireframes |
| 1 | 새 전체 작업 화면, 도구별 옵션·패널·명령 검색·시작/열기·입력 수명주기 | workspace.js, index.js, editor.css |
| 2 | JSON 모델·자산 registry·공통 합성기·좌표·보기·속성/픽셀 이력 | model.js, engine.js, render.js, bitmap.js |
| 3 | 관리자 API·불변 자산/manifest·ETag head·동일 요청 재시도·자동 저장·IndexedDB·버전 | storage.js, src/editor/api.js, migration 0027 |
| 4 | 레이어 CRUD·다중 선택·그룹·병합·변형 확정/취소·프리셋/크롭·혼합·정렬·스냅 | engine.js, tools.js, workspace.js |
| 5 | 선택 도구/연산·선택 변형·마스크·내용/마스크 대상·클리핑·복사/잘라내기/붙여넣기 | tools.js, engine.js, render.js |
| 6 | 브러시/지우개·필압·간격·선 보정·색상/채우기/그라데이션·조정/필터·비교 | bitmap.js, tools.js, workspace.js |
| 7 | 여러 줄 문자·서체/행간/자간·도형/화살표·테두리/그림자·폰트 준비 장벽 | render.js, workspace.js |
| 8 | 현재 모델/가격 서비스 연결·불변 요청 스냅샷·순차 후보·중단·비교·명시적 레이어 적용 | ai.js, workspace.js |
| 9 | 세 형식 출력·프로젝트 폴더·ETag 덮어쓰기·백업·부분 출력 복구·새 기본 진입점 | src/editor/api.js, app.html, main/project/manage |
| 10 | 도장/색상 힐링/영역 패치·레벨/커브/히스토그램/LUT·경계/베지어/벡터 마스크·원근/워프/국소 밀기 | bitmap.js, render.js, tools.js, workspace.js |
| 11 | 최대 8문서·문서 간 복사·기기 내 피사체 모델 Worker·프리셋/템플릿/일괄 출력·핀치/시트/배치 저장 | subject.js, subject-worker.js, workspace.js |

## 구현 방식과 실제 한계

- 힐링은 기준 샘플과 대상 경계의 평균 색 차이를 보정하는 방식이다. 영역 패치는 선택 영역에 다른 위치의 픽셀을 옮기는 방식이다. Photoshop의 콘텐츠 인식 채우기·복구 품질과 동등하다고 검증하지 않았다. 복잡한 경계는 마스크 보정 또는 인페인트로 처리한다.
- 원근은 projective quadrilateral을 작은 삼각형으로 샘플링하고, 워프는 3×3 제어점의 변위를 보간한다. 국소 밀기는 반경별 감쇠를 적용한 픽셀 역매핑이다. 미리보기·alpha·변형 경계·출력 일치와 체감 품질은 실제 배포에서 확인한다.
- 베지어 벡터 마스크는 점·제어점을 문서에 보관하고 펜으로 재편집한다. 피사체 모델 결과는 래스터 선택 영역으로 적용하고 마스크 브러시로 보완한다. 경계 색 정리는 안쪽의 확실한 색을 경계에 보간하는 방식이다.
- 기기 내 자동 분리는 Transformers.js 3.8.1 / Xenova MODNet FP32 WASM을 사용한다. 모델 다운로드·실행을 이 작업에서 수행하지 않았다. 캐릭터/일러스트·반투명 경계·복수 인물 품질, 다운로드 시간·메모리·태블릿 지원은 확인이 필요하다.
- 레이어 스타일은 각 레이어의 로컬 자산 영역 안에서 계산한다. 바깥 그림자·테두리가 경계에서 잘릴 수 있어 배포 품질 확인 항목으로 남긴다. 효과가 적용된 그룹 해제는 손실을 막기 위해 먼저 효과를 해제하거나 병합하도록 안내한다.
- 서버 문서·버전·후보가 참조한 R2 자산의 자동 삭제는 도입하지 않았다. 문서 삭제는 head의 삭제 표시이며 원본·기존 데이터·버전 자산을 물리적으로 지우지 않는다.
- 템플릿·브러시/보정/스타일 프리셋·패널 배치는 해당 브라우저의 로컬 저장소에 보관한다. 여러 기기 간 동기화는 제공하지 않는다. 기존 PSD 교환·RAW·CMYK·고해상도는 이번 범위에 포함하지 않았다.

## 정적 확인

- `npm run check:editor-static`: 신규 엔진과 연결부 20개 JavaScript 구문, 브라우저 진입점/피사체 Worker/서버 API의 3개 import bundle, CSS 파싱, UTF-8/BOM, 구 진입 의존성 제거·내부 경로 보호 확인.
- 신규 migration을 메모리 SQLite에서 읽어 신규 테이블/인덱스 구문과 재적용 가능 여부 확인. 서비스 DB에 실행하지 않는다.
- 수정/신규 텍스트 전체의 strict UTF-8·BOM과 `git diff --check` 확인.
- 실행 화면·Canvas 픽셀 결과·네트워크 저장·실제 AI 요청·모델 추론·Anlas 사용·성능 수치는 확인하지 않았다.

## 배포 후 확인 순서

1. Pages의 `imgBucket`·`DB` 바인딩과 신규 migration 0027을 확인한다. API에도 동일한 IF NOT EXISTS 초기화가 있다. 기존 테이블·R2 파일을 삭제하지 않는다.
2. 세 규격 각각 프로젝트/로컬 열기 → 레이어·마스크·텍스트 → 저장·재열기 → PNG/JPEG/WebP 다운로드/프로젝트 저장을 확인한다. 작업 공간 UI와 모델 Worker의 정적 파일 로드도 확인한다.
3. R01~R11을 [실행 계획](image-editor-implementation-roadmap.md)의 결과 조건으로 확인한다. 두 창의 revision 충돌, 응답 유실 후 동일 요청 재시도, DB/업로드 실패·로컬 복구·이전 버전·출력 메타데이터 복구를 포함한다.
4. 인페인트는 비용 UI·오류·중단을 먼저 확인하고 실제 과금 요청의 모델/규격/비용·결과를 기록한다. 생성 중 편집·규격 변경·문서 이동과 `요청 당시 작업 열기`도 확인한다.
5. 도장/힐링·벡터/래스터 경계·원근/워프·국소 밀기·모델 자동 분리를 각각 기준 이미지로 평가한다. 모델 다운로드 실패·중단과 캐릭터/머리카락·반투명 경계를 포함한다.
6. 20레이어·5마스크·5효과 문서에서 줌/이동/변형 30fps, 브러시 반영 p95 50ms라는 목표를 측정한다. 브라우저·기기·배포 식별값을 기록한다. 이 수치는 측정 전 보장치가 아니다.
7. IME·펜/손가락·핀치·하단 시트·패널 배치·열린 8문서·진입/이탈 반복·공용 이미지 생성 기능을 확인한다. 문제를 수정한 뒤 영향을 받는 시나리오만 재확인한다.

현재 배포 식별값: 없음. 실제 실행 결과: 미실행. 아래 작업 상태에서 `구현·정적 확인`은 배포 완료와 구분한다.

## 작업 ID별 추적

| ID | 작업 | 소스/정적 상태 | 배포 상태 | 연결 위치 |
| --- | --- | --- | --- | --- |
| E00-01 | 작업 범위·규격·출력 정책 정리 | 설계 기록 작성 | 설계 문서 검토 가능 | design-contracts / ui-spec / wireframes |
| E00-02 | 핵심 작업 흐름·명령 목록 정의 | 설계 기록 작성 | 설계 문서 검토 가능 | design-contracts / ui-spec / wireframes |
| E00-03 | 신규 UI 시안과 상태 전환 작성 | 설계 기록 작성 | 설계 문서 검토 가능 | design-contracts / ui-spec / wireframes |
| E00-04 | 문서·명령·합성 계약 정의 | 설계 기록 작성 | 설계 문서 검토 가능 | design-contracts / ui-spec / wireframes |
| E00-05 | 저장·서비스 경계 정의 | 설계 기록 작성 | 설계 문서 검토 가능 | design-contracts / ui-spec / wireframes |
| E00-06 | AI 제공자 연결 조건 조사 | 설계 기록 작성 | 설계 문서 검토 가능 | design-contracts / ui-spec / wireframes |
| E01-01 | 신규 진입점·화면 수명주기 작성 | 구현·정적 확인 | 미실행 | workspace / index / editor.css |
| E01-02 | 작업 공간 레이아웃 작성 | 구현·정적 확인 | 미실행 | workspace / index / editor.css |
| E01-03 | 명령·포커스·단축키 연결 기반 | 구현·정적 확인 | 미실행 | workspace / index / editor.css |
| E01-04 | 시작·열기·최근 작업 UI 작성 | 구현·정적 확인 | 미실행 | workspace / index / editor.css |
| E01-05 | pointer 세션·취소·overlay 작성 | 구현·정적 확인 | 미실행 | workspace / index / editor.css |
| E02-01 | 문서 스키마와 내용 상태 작성 | 구현·정적 확인 | 미실행 | model / engine / render / bitmap |
| E02-02 | 이미지/자산 레지스트리 작성 | 구현·정적 확인 | 미실행 | model / engine / render / bitmap |
| E02-03 | Canvas2D 공통 합성기 작성 | 구현·정적 확인 | 미실행 | model / engine / render / bitmap |
| E02-04 | 좌표·pan/zoom·선택 경계 작성 | 구현·정적 확인 | 미실행 | model / engine / render / bitmap |
| E02-05 | 명령 이력과 직렬화 작성 | 구현·정적 확인 | 미실행 | model / engine / render / bitmap |
| E02-06 | 기본 편집 상태를 화면과 연결 | 구현·정적 확인 | 미실행 | model / engine / render / bitmap |
| E03-01 | 신규 스키마·내부 경로·인증 연결 | 구현·정적 확인 | 미실행 | storage / API / migration 0027 |
| E03-02 | 원본/추가 자산 업로드·조회 | 구현·정적 확인 | 미실행 | storage / API / migration 0027 |
| E03-03 | 문서 revision commit·조회·목록 | 구현·정적 확인 | 미실행 | storage / API / migration 0027 |
| E03-04 | 수동/자동 저장 상태 작성 | 구현·정적 확인 | 미실행 | storage / API / migration 0027 |
| E03-05 | 로컬 복구·이동 확인 작성 | 구현·정적 확인 | 미실행 | storage / API / migration 0027 |
| E03-06 | 최근 작업·버전 기록·복원 작성 | 구현·정적 확인 | 미실행 | storage / API / migration 0027 |
| E04-01 | 레이어 목록·CRUD·순서·복제 | 구현·정적 확인 | 미실행 | engine / tools / workspace |
| E04-02 | 다중 선택·그룹·병합 | 구현·정적 확인 | 미실행 | engine / tools / workspace |
| E04-03 | 자유 변형 핸들·속성 연결 | 구현·정적 확인 | 미실행 | engine / tools / workspace |
| E04-04 | 크롭·프리셋·회전 작성 | 구현·정적 확인 | 미실행 | engine / tools / workspace |
| E04-05 | 블렌딩·정렬·가이드 작성 | 구현·정적 확인 | 미실행 | engine / tools / workspace |
| E05-01 | 공통 선택 마스크·경계 표시 | 구현·정적 확인 | 미실행 | engine / tools / render / workspace |
| E05-02 | 기본 선택 도구 작성 | 구현·정적 확인 | 미실행 | engine / tools / render / workspace |
| E05-03 | 색상 선택·경계 연산 작성 | 구현·정적 확인 | 미실행 | engine / tools / render / workspace |
| E05-04 | 레이어 마스크·최소 마스크 브러시 작성 | 구현·정적 확인 | 미실행 | engine / tools / render / workspace |
| E05-05 | 클리핑·마스크 변형 연결 | 구현·정적 확인 | 미실행 | engine / tools / render / workspace |
| E05-06 | 선택 복사·잘라내기·붙여넣기 | 구현·정적 확인 | 미실행 | engine / tools / render / workspace |
| E06-01 | 일반 브러시·지우개·stroke 품질 작성 | 구현·정적 확인 | 미실행 | bitmap / tools / workspace |
| E06-02 | 색상·스포이트·채우기·그라데이션 | 구현·정적 확인 | 미실행 | bitmap / tools / workspace |
| E06-03 | 조정 레이어·속성 작성 | 구현·정적 확인 | 미실행 | bitmap / tools / workspace |
| E06-04 | 필터 스택·가림 작성 | 구현·정적 확인 | 미실행 | bitmap / tools / workspace |
| E06-05 | 비교·캐시·UI 갱신 통합 | 구현·정적 확인 | 미실행 | bitmap / tools / workspace |
| E07-01 | 텍스트 입력·레이아웃 작성 | 구현·정적 확인 | 미실행 | render / workspace |
| E07-02 | 텍스트 스타일·폰트 준비 작성 | 구현·정적 확인 | 미실행 | render / workspace |
| E07-03 | 도형 생성·속성 작성 | 구현·정적 확인 | 미실행 | render / workspace |
| E07-04 | 테두리·그림자·효과 연결 | 구현·정적 확인 | 미실행 | render / workspace |
| E08-01 | AI 스냅샷·어댑터 작성 | 구현·정적 확인 | 미실행 | ai / workspace |
| E08-02 | 설정·비용·요청 UI 작성 | 구현·정적 확인 | 미실행 | ai / workspace |
| E08-03 | 작업 상태·취소·늦은 결과 처리 | 구현·정적 확인 | 미실행 | ai / workspace |
| E08-04 | 후보 미리보기·비교 작성 | 구현·정적 확인 | 미실행 | ai / workspace |
| E08-05 | 후보를 레이어로 확정 | 구현·정적 확인 | 미실행 | ai / workspace |
| E09-01 | 내보내기 UI·인코딩 작성 | 구현·정적 확인 | 미실행 | API / workspace / 프로젝트 진입 연결 |
| E09-02 | 프로젝트 저장·덮어쓰기 작성 | 구현·정적 확인 | 미실행 | API / workspace / 프로젝트 진입 연결 |
| E09-03 | 최초 릴리스 통합 검증 | 검증 절차 작성·실행 대기 | 미실행 | API / workspace / 프로젝트 진입 연결 |
| E09-04 | 기본 진입점 전환·구 코드 제거 | 구현·정적 확인 | 미실행 | API / workspace / 프로젝트 진입 연결 |
| E09-05 | 교체 후 배포 확인·운영 메모 | 운영 메모 작성·실행 대기 | 미실행 | API / workspace / 프로젝트 진입 연결 |
| E10-01 | 복제 도장·힐링·패치 | 구현·정적 확인 | 실행·품질 평가 미실행 | bitmap / render / tools / workspace |
| E10-02 | Levels·Curves·히스토그램·LUT | 구현·정적 확인 | 미실행 | bitmap / render / tools / workspace |
| E10-03 | 정밀 경계·펜·벡터 마스크 | 구현·정적 확인 | 실행·품질 평가 미실행 | bitmap / render / tools / workspace |
| E10-04 | 원근·기울이기·워프·국소 변형 | 구현·정적 확인 | 실행·품질 평가 미실행 | bitmap / render / tools / workspace |
| E10-05 | 고급 브러시·리터칭·표현 | 구현·정적 확인 | 미실행 | bitmap / render / tools / workspace |
| E11-01 | 다중 문서·문서 간 복사 | 구현·정적 확인 | 미실행 | subject / Worker / workspace |
| E11-02 | 자동 피사체/배경 분리 | 구현·정적 확인 | 실행·품질 평가 미실행 | subject / Worker / workspace |
| E11-03 | 프리셋·반복 작업 | 구현·정적 확인 | 미실행 | subject / Worker / workspace |
| E11-04 | 태블릿·좁은 화면·작업 공간 완성 | 구현·정적 확인 | 미실행 | subject / Worker / workspace |
