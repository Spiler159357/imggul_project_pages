# R2 JSON 데이터 DB 마이그레이션 명세 및 계획

## 목적

R2는 이미지, 텍스트/마크다운 원문, 로그 같은 파일 저장소로 유지하고, 애플리케이션 상태나 목록/메타데이터 성격의 JSON은 D1 DB로 이전한다. 목표는 `_meta.json`, `.aliases.json`처럼 동시 수정에 취약한 단일 JSON 파일 의존도를 줄이고, 조회/수정/삭제를 행 단위로 처리하는 것이다.

## 현재 R2 JSON 사용 현황

| 구분 | 현재 R2 key 패턴 | 주요 코드 | 성격 | 마이그레이션 판단 |
| --- | --- | --- | --- | --- |
| 전역 별칭 | `.imggul_aliases.json` | `functions/[[path]].js` `/api/aliases` | 프로젝트/파일 표시명 매핑 | DB 이전 |
| 프로젝트별 별칭 | `{project}/.aliases.json` | `functions/[[path]].js` `/api/aliases`, `/api/manage` | 프로젝트 하위 폴더/파일 표시명 매핑 | DB 이전 |
| 텍스트 메모 묶음 | `{prefix}.memos.json` | `functions/[[path]].js` `/api/upload`, `/api/list`, `/api/manage` | `.txt` 가상 파일의 본문/공개 여부 | 보류 또는 별도 검토. 사용자는 txt/md 유지 희망 |
| 이미지 메타 | `{folderPrefix}_meta.json` | `public/js/api.js`, `src/planner-background.js` | 파일명별 생성 프롬프트/시드/해상도 등 | DB 이전 |
| 캐릭터 메타 | `{characterPrefix}_character_meta.json` | `public/js/project/shared.js` | 캐릭터 프롬프트, 의상 변형, 활성 변형 | DB 이전 우선 |
| 상황 메타 | `{projectPrefix}_situations_meta.json` | `public/js/project/shared.js`, `public/js/craft.js` | 상황 목록, 상황별 프롬프트/생성 설정 | DB 이전 우선 |
| 플래너 메타 | `{projectPrefix}_planner_temp_image/plans/{characterId}_planner_meta.json` | `public/js/project/planner.js`, `src/planner-background.js` | 캐릭터별 플랜/생성 상태/결과 이미지 | DB 이전. 백그라운드 DB와 통합 검토 |
| 플래너 설정 | `{projectPrefix}_planner_temp_image/_planner_settings.json` | `public/js/project/planner.js` | 프로젝트별 생성 기본 설정 | DB 이전 |
| 프로젝트 프롬프트 | `{projectPrefix}prompt.md`, `style_prompt.md` 등 | `public/js/project/shared.js` | 마크다운 원문 | 유지 |
| 이미지/바이너리 | `*.webp`, `*.png`, 업로드 파일 | 전반 | 파일 원본 | 유지 |
| 로그 | `logs/**/*.log` | `src/planner-background.js` | 운영 로그 | 유지 |

## DB 스키마 초안

| 테이블 | 주요 컬럼 | 용도 |
| --- | --- | --- |
| `projects` | `id`, `prefix`, `name`, `created_at`, `updated_at` | R2 폴더 기반 프로젝트를 DB에서 식별. 초기에는 prefix를 기준으로 보강 가능 |
| `aliases` | `scope`, `project_prefix`, `target_key`, `alias`, `updated_at` | 전역/프로젝트 별칭 통합 |
| `characters` | `id`, `project_prefix`, `prefix`, `folder_name`, `name`, `cover_image`, `created_at`, `updated_at` | 캐릭터 폴더와 기본 정보 |
| `character_meta` | `character_id`, `prompt`, `parts_json`, `prompt_variants_json`, `active_prompt_variant_id`, `raw_json`, `updated_at` | 캐릭터 프롬프트와 변형. 구조화가 어려운 필드는 JSON으로 보존 |
| `situations` | `id`, `project_prefix`, `folder_name`, `name`, `alias`, `image_number`, `prompt_json`, `generation_json`, `prompt_variants_json`, `sort_order`, `created_at`, `updated_at` | 상황 목록과 생성 설정 |
| `file_metadata` | `folder_prefix`, `file_name`, `metadata_json`, `created_at`, `updated_at` | 기존 `{folderPrefix}_meta.json`의 파일별 메타데이터 |
| `planner_settings` | `project_prefix`, `settings_json`, `updated_at` | 플래너 기본 설정 |
| `planner_plans` | `id`, `project_id`, `project_prefix`, `character_id`, `status`, `stage`, `default_count`, `created_at`, `updated_at` | 현재 플래너 메타의 상위 단위 |
| `planner_plan_items` | `id`, `plan_id`, `situation_id`, `image_number`, `generation_json`, `images_json`, `selected_image`, `status`, `stage`, `error_message`, `updated_at` | 플래너 항목 단위. 기존 `planner_background_items`와 중복 최소화 필요 |

## API 변경 방향

| 기존 동작 | 변경 방향 |
| --- | --- |
| JSON 파일을 직접 `GET /{key}.json`으로 읽음 | `/api/projects/...`, `/api/characters/...`, `/api/situations/...`, `/api/planner/...`, `/api/metadata/...`처럼 DB 조회 API로 전환 |
| 클라이언트가 JSON 전체를 읽고 수정 후 `/api/upload`로 다시 업로드 | 서버 API가 행 단위 upsert/delete 처리 |
| `/api/list`에서 R2 목록과 `.memos.json`을 합성 | R2 파일 목록 + DB 별칭/메타를 서버에서 합성 |
| `/api/manage` 폴더 삭제/이동 시 별칭 JSON만 보정 | 관련 DB 행도 트랜잭션 또는 순차 보정 |
| 백그라운드 플래너가 D1 작업 테이블과 R2 planner meta를 동시 갱신 | 최종 상태 저장소를 DB로 단일화하고, 필요하면 R2 JSON은 임시 호환 레이어로만 유지 |

## 마이그레이션 단계

1. 스키마 추가
   - 새 D1 migration 파일에 위 테이블 중 1차 대상(`aliases`, `character_meta`, `situations`, `file_metadata`, `planner_settings`)부터 생성한다.
   - 기존 `planner_background_*` 테이블은 유지하고, 플래너 본체 테이블과 통합 범위를 별도 결정한다.

2. 읽기 API 추가
   - 기존 R2 JSON을 바로 대체하지 말고 DB 우선, R2 fallback 방식으로 API를 만든다.
   - fallback이 발생하면 응답에 내부적으로 추적 가능한 플래그를 남겨 누락 데이터를 확인한다.

3. 쓰기 API 추가
   - 캐릭터 메타, 상황 메타, 플래너 설정, 파일 메타부터 DB에 쓰도록 서버 API를 추가한다.
   - 초기 전환 기간에는 DB write 후 R2 JSON도 함께 쓰는 dual-write를 허용한다.

4. 데이터 이관 스크립트 작성
   - R2 list로 대상 JSON key를 수집한다.
   - JSON parse 실패, 빈 파일, 중복 key를 리포트로 남긴다.
   - idempotent upsert로 여러 번 실행 가능하게 만든다.

5. 클라이언트 전환
   - `loadCharacterMeta/saveCharacterMeta`, `loadProjectSituations/saveProjectSituations`, `loadPlannerSettings/savePlannerSettings`, `loadMetadataFromDB/saveMetadataToDB`를 새 API 호출로 교체한다.
   - 함수명은 호환을 위해 유지해도 되지만, 내부 저장소는 DB로 바꾼다.

6. 검증
   - 마이그레이션 전후 프로젝트 수, 캐릭터 메타 수, 상황 수, 파일 메타 수를 비교한다.
   - 대표 프로젝트에서 캐릭터 프롬프트 편집, 상황 추가/삭제, 이미지 메타 조회, 플래너 저장/재개를 확인한다.

7. R2 JSON 읽기 중단
   - 일정 기간 dual-read/dual-write 후 DB 단독 읽기로 전환한다.
   - R2 JSON은 즉시 삭제하지 말고 백업 prefix로 이동하거나 읽기 전용 보관한다.

## 우선순위

| 우선순위 | 대상 | 이유 |
| --- | --- | --- |
| 1 | `_character_meta.json` | 캐릭터 프롬프트/의상 변형은 핵심 편집 데이터이며 충돌 위험이 큼 |
| 2 | `_situations_meta.json` | 상황 목록 전체를 한 JSON에 저장해 행 단위 수정에 부적합 |
| 3 | `_planner_settings.json` | 작고 단순해서 API 전환 검증에 적합 |
| 4 | 폴더별 `_meta.json` | 이미지 생성 메타가 파일명별 행으로 자연스럽게 분리됨 |
| 5 | `.aliases.json`, `.imggul_aliases.json` | 프로젝트/폴더 이동 로직과 함께 정리 필요 |
| 6 | `_planner_meta.json` | 이미 `planner_background_*` D1 테이블이 있어 통합 설계를 먼저 확정해야 함 |

## 제외 또는 보류

- `prompt.md`, `style_prompt.md`, 기타 `.md`/`.txt` 원문은 이번 마이그레이션 범위에서 제외한다.
- `.memos.json`은 내부적으로 JSON이지만 txt 가상 파일 저장소 역할을 하므로, 사용자가 txt 유지 방침을 확정한 뒤 별도 검토한다.
- 이미지, WebP, PNG, 업로드 바이너리, 로그는 R2에 남긴다.

## 리스크와 대응

| 리스크 | 대응 |
| --- | --- |
| R2 JSON과 DB 간 불일치 | 전환 기간에는 DB 우선 읽기 + R2 fallback + dual-write 로그를 둔다 |
| 기존 URL 직접 접근 의존 | JSON 직접 접근 대신 API를 쓰도록 클라이언트를 먼저 교체한다 |
| 폴더 rename/delete 시 참조 깨짐 | DB에는 `prefix` 기반 참조를 유지하되, rename API에서 관련 행을 함께 갱신한다 |
| 플래너 상태 저장 중복 | `planner_background_jobs/items`와 신규 플래너 테이블의 책임을 분리하거나 통합한다 |
| JSON 내부 구조 변화 | `raw_json` 또는 `*_json` 컬럼을 함께 보존해 점진적으로 정규화한다 |

## 1차 완료 기준

- 신규 DB migration이 추가되어 로컬/원격 D1에 적용 가능하다.
- 캐릭터 메타, 상황 메타, 플래너 설정, 파일 메타가 DB API로 읽기/쓰기 된다.
- 기존 R2 JSON만 존재하는 데이터도 fallback으로 정상 표시된다.
- 마이그레이션 스크립트 실행 후 수량 검증 리포트가 생성된다.
- 수정한 텍스트 파일은 UTF-8 BOM 없이 저장된다.
