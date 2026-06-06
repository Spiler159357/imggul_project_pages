# Basic Image Editor Implementation Plan

## 1. Goal

이 문서는 imggul에 아주 기초적인 이미지 수정 기능을 추가하기 위한 구현 계획을 정리한다.

목표는 전문 이미지 편집기를 만드는 것이 아니라, 프로젝트/R2에 이미 저장된 이미지를 불러와 다음 수준의 가벼운 보정 작업을 수행하고 다시 저장할 수 있게 하는 것이다.

- R2에 저장된 이미지 선택 및 편집
- 원본 경로 덮어쓰기 저장, 자동 백업, 다른 이름으로 저장
- 브러시 드로잉
- 브러시 기반 모자이크
- 텍스트와 간단한 도형 추가
- 레이어 기반 편집 객체 관리
- 편집 세션 임시 저장
- undo/redo 및 히스토리

UI 배치 위치는 이 문서의 범위에서 제외한다. 이 문서는 기능 구현 단위, 데이터 흐름, 모듈 구조, 단계별 작업 순서를 다룬다.

UI 설계는 별도 문서인 [Basic Image Editor UI Plan](image-basic-editor-ui-plan.md)에서 관리한다. 기능 구현 작업을 시작할 때는 이 문서의 Phase와 UI 문서의 Phase가 서로 연결되는지 `14. UI Join Points`를 먼저 확인한다.

## 2. Scope

### 2.1 In Scope

- 브라우저 Canvas 기반 이미지 편집
- R2 object key 기반 이미지 열기
- 기존 `/api/list`, 정적/R2 파일 서빙 흐름 재사용
- 이미지 편집 전용 저장 API 추가
- 저장 시 원본 key 덮어쓰기 또는 새 key로 저장
- 편집 중 상태를 클라이언트 메모리, R2, DB에 나누어 유지
- 기본 브러시, 모자이크 브러시, 텍스트, 도형, 히스토리 구현
- 텍스트, 도형, 추가 이미지 등을 재편집 가능한 layer 객체로 관리
- 편집 결과를 WebP Blob으로 export
- 저장 시 기존 이미지 metadata와 DB 연결 무결성 보존

### 2.2 Out Of Scope

- PSD, AI, CLIP 등 전문 편집 포맷 지원
- 로컬 파일 시스템의 임의 경로 읽기/쓰기
- 브라우저 밖의 OS 파일 저장 대화상자 강제 제어
- 서버 사이드 이미지 처리 파이프라인

레이어 기능은 scope에 포함한다. 다만 전문 편집기 수준의 모든 레이어 효과, 블렌딩 모드, 마스크 그룹, 조정 레이어까지 한 번에 구현하지는 않는다. 초기 구현은 확장 가능한 layer document model을 먼저 만들고, 기본 layer type을 순차적으로 추가한다.

## 3. Current System Fit

현재 프로젝트는 Cloudflare Pages Functions와 R2를 중심으로 파일을 다룬다.

- 이미지 목록 조회: `GET /api/list?prefix=...`
- 일반 파일 업로드/저장: `PUT /api/upload`
- 파일 삭제/이름 변경 등 관리: `POST /api/manage`
- R2 이미지 서빙: 정적 에셋에 없는 파일 경로를 R2 object key로 조회

이미지 편집 기능은 프론트엔드 Canvas에서 렌더링하고 최종 결과 Blob을 저장하는 구조가 적합하다. 다만 저장 시 원본 이미지 metadata와 DB 연결이 끊어지면 안 되므로, 최종 저장은 기존 범용 업로드 API에만 의존하지 않고 이미지 편집 전용 API를 추가하는 방향이 적합하다.

전용 API의 역할은 다음과 같다.

- 저장 대상 key 검증
- 원본 object 존재 여부 확인
- 기존 R2 customMetadata 보존 또는 병합
- DB의 `file_metadata` 연결 보존 또는 새 key로 복제
- 편집 작업문서와 최종 산출물 관계 기록
- 저장 실패 시 중간 상태가 남지 않도록 정리

## 4. Recommended Architecture

### 4.1 Module Structure

새 기능은 UI 배치와 분리해서 다음 모듈 중심으로 구현한다.

- `public/js/image_editor/core.js`
  - 캔버스 생성, 이미지 로드, 좌표 변환, 렌더링 루프
  - 편집 상태의 단일 진입점
- `public/js/image_editor/document.js`
  - 편집 작업문서 schema
  - layer CRUD
  - document version migration
- `public/js/image_editor/layers.js`
  - layer type별 렌더링
  - layer hit testing
  - layer transform 처리
- `public/js/image_editor/history.js`
  - undo/redo stack 관리
  - command 기반 히스토리 항목 관리
- `public/js/image_editor/tools.js`
  - brush, mosaic, text, shape tool 정의
  - pointer event 처리 규칙
- `public/js/image_editor/export.js`
  - layer document를 Canvas에 합성
  - 합성 결과를 Blob/File로 변환
  - PNG/WebP 선택, 파일명 생성
- `public/js/image_editor/storage.js`
  - R2 이미지 열기
  - 저장/다른 이름으로 저장 API 호출
  - 저장 경로 검증
- `public/js/image_editor/autosave.js`
  - 작업문서 임시 저장
  - dirty state와 복구 후보 관리

초기에는 전역 함수 기반 기존 코드 스타일과 맞추되, 새 모듈 내부는 명시적인 editor state 객체를 사용한다.

### 4.2 Editor State

편집기 상태는 작업문서와 런타임 상태를 분리한다.

```js
{
  documentId: "editor_doc_...",
  sourceKey: "project/character/001.webp",
  sourcePrefix: "project/character/",
  sourceFileName: "001.webp",
  outputKey: "project/character/001.webp",
  imageWidth: 1024,
  imageHeight: 1024,
  documentVersion: 1,
  layers: [],
  selectedLayerIds: [],
  zoom: 1,
  panX: 0,
  panY: 0,
  activeTool: "brush",
  toolOptions: {
    brush: { size: 24, color: "#ff0000", opacity: 1, hardness: 1, shape: "round" },
    mosaic: { size: 40, blockSize: 12, strength: 1 },
    text: { fontFamily: "sans-serif", fontSize: 32, color: "#ffffff", bold: false, italic: false },
    shape: { type: "rect", strokeColor: "#ffffff", fillColor: "transparent", strokeWidth: 4 }
  },
  dirty: false
}
```

`sourceKey`, `outputKey`, `imageWidth`, `imageHeight`, `documentVersion`, `layers`는 저장 가능한 작업문서 데이터다. `zoom`, `panX`, `panY`, `activeTool`, `selectedLayerIds`는 런타임 UI 상태로 보고 필요할 때만 임시 저장한다.

### 4.3 Layer Document Model

모든 추가 이미지, 도형, 텍스트, 브러시 작업, 모자이크 작업은 layer 또는 layer operation으로 취급한다.

초기 layer type:

- `sourceImage`: 원본 이미지. 항상 최하단에 존재한다.
- `raster`: 브러시 stroke가 누적되는 bitmap layer.
- `mosaic`: 원본 또는 하위 합성 결과에 대해 모자이크 mask를 적용하는 effect layer.
- `text`: 텍스트 내용, 폰트, 크기, 스타일을 보존하는 editable object layer.
- `shape`: 사각형, 타원, 선, 화살표 같은 vector object layer.
- `image`: 사용자가 추가로 배치한 R2 이미지 또는 편집 세션 asset.

공통 layer field:

```js
{
  id: "layer_...",
  type: "text",
  name: "Text 1",
  visible: true,
  locked: false,
  opacity: 1,
  blendMode: "source-over",
  transform: { x: 120, y: 80, scaleX: 1, scaleY: 1, rotation: 0 },
  bounds: { x: 120, y: 80, width: 240, height: 60 },
  data: {}
}
```

초기에는 `blendMode` 값을 저장하되 UI에서는 `source-over`만 지원한다. 이렇게 하면 이후 multiply, screen 같은 블렌딩을 추가할 때 document schema를 바꾸지 않아도 된다.

### 4.4 Extensibility Policy

모든 기능은 추가 확장을 전제로 구현한다.

- tool은 공통 interface를 가진 plugin-like object로 만든다.
- layer type별 renderer와 serializer를 분리한다.
- document schema에는 `documentVersion`을 포함한다.
- schema 변경이 필요한 경우 migration 함수를 둔다.
- 저장 API는 결과 이미지만 받지 않고 작업문서 id, source key, output key, metadata policy를 함께 받는다.
- UI 배치가 바뀌어도 core/editor module은 재사용 가능해야 한다.

## 5. Image Loading And Saving

### 5.1 Open

이미지 열기는 R2 object key를 기준으로 한다.

1. 선택 가능한 이미지는 기본적으로 `/api/list` 결과 안의 이미지 파일로 제한한다.
2. 사용자가 이미지를 선택하면 `/${encodeURIComponent(key)}` 형태가 아니라 기존 앱의 자산 URL 생성 규칙을 재사용한다.
3. 이미지를 `Image` 객체로 로드한다.
4. CORS와 tainted canvas 문제가 발생하지 않도록 동일 origin R2 서빙 경로를 사용한다.
5. 원본 이미지 크기와 source key를 editor state에 저장한다.

지원 확장자는 초기에 `png`, `jpg`, `jpeg`, `webp`로 제한한다. GIF는 첫 프레임만 편집되는 혼란이 있으므로 1차 구현에서는 제외한다.

### 5.2 Save

저장은 현재 `sourceKey`에 덮어쓰는 동작이다.

1. layer document를 export canvas에 합성한다.
2. Canvas를 Blob으로 변환한다.
3. 저장 기본 포맷은 항상 WebP로 한다.
4. `/api/image-editor/save` 전용 API로 Blob, source key, output key, document id를 전송한다.
5. 서버는 기존 R2 object의 customMetadata와 DB `file_metadata`를 읽는다.
6. 서버는 원본 object와 metadata snapshot을 백업 위치에 먼저 저장한다.
7. 백업이 성공한 경우에만 새 이미지 object를 저장하면서 기존 metadata를 보존하거나 편집 metadata를 병합한다.
8. 저장 성공 후 작업문서의 saved revision을 갱신하고 `dirty=false`로 변경한다.
9. 갤러리/프로젝트 이미지 캐시를 무효화한다.

주의할 점은 저장 과정에서 이미지 파일만 새로 쓰고 metadata 또는 DB row를 잃으면 기존 프로젝트 기능과 연결이 끊어질 수 있다는 점이다. 따라서 저장은 반드시 metadata 보존을 포함한 단일 흐름으로 처리한다.

권장 정책:

- 1차 구현에서는 저장 실행 시 원본 덮어쓰기 확인을 표시한다.
- 저장 직전에 원본 object와 metadata snapshot을 백업 저장 공간에 반드시 남긴다.
- 백업 저장이 실패하면 원본 덮어쓰기 저장을 진행하지 않는다.
- 저장 실패 시 원본 metadata를 변경하지 않는다.
- 저장 성공 후 `file_metadata`에는 기존 metadata를 유지하고 편집 이력 필드만 병합한다.

백업 저장 위치 예시:

- `__editor_backups/{documentId}/{revisionId}/original`
- `__editor_backups/{documentId}/{revisionId}/metadata.json`

백업 metadata에는 최소한 `sourceKey`, `backupKey`, `documentId`, `revisionId`, `createdAt`, `originalContentType`, `originalCustomMetadata`를 기록한다.

### 5.3 Save As

다른 이름으로 저장은 `outputKey`를 새로 지정해 업로드한다.

기본 경로:

- 원본 이미지의 prefix

기본 파일명:

- `원본파일명_edited.webp`

경로 선택 정책:

- 기본적으로 현재 프로젝트/R2 이미지 트리 내부에서만 선택한다.
- 직접 경로 입력은 허용하되, R2 key로 정규화한다.
- `..`, 선행 slash, 빈 파일명, 제어 문자, 예약 메타 파일명은 거부한다.
- `_meta.json`, `.aliases.json`, `.memos.json` 등 시스템 파일명과 충돌하지 않게 한다.

다른 이름으로 저장 시 metadata 정책:

- 원본 이미지의 metadata를 기본 복제한다.
- `sourceKey`, `savedAsKey`, `editedAt`, `editorDocumentId`를 추가한다.
- 새 파일이 원본과 다른 독립 asset인지, 원본의 derivative인지 구분할 수 있게 `derivedFromKey`를 기록한다.
- 다른 이름으로 저장도 기본 export 포맷은 WebP를 사용한다.

### 5.4 Temporary Save

편집 작업 중 브라우저 새로고침, 탭 종료, 장시간 작업, 큰 이미지 처리 실패에 대비해 임시 저장 공간을 둔다.

R2 저장 위치 예시:

- `__editor_sessions/{documentId}/document.json`
- `__editor_sessions/{documentId}/preview.webp`
- `__editor_sessions/{documentId}/assets/{assetId}.webp`
- `__editor_sessions/{documentId}/snapshots/{revisionId}.json`

DB table 예시:

```sql
CREATE TABLE image_editor_documents (
    id TEXT PRIMARY KEY,
    source_key TEXT NOT NULL,
    output_key TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft',
    document_json_key TEXT NOT NULL,
    preview_key TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    saved_at TEXT NOT NULL DEFAULT '',
    extra_json TEXT NOT NULL DEFAULT '{}'
);
```

```sql
CREATE TABLE image_editor_revisions (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL,
    revision_number INTEGER NOT NULL,
    document_json_key TEXT NOT NULL,
    created_at TEXT NOT NULL,
    summary_json TEXT NOT NULL DEFAULT '{}'
);
```

임시 저장 정책:

- 작업문서는 debounce를 걸어 주기적으로 저장한다.
- preview는 너무 자주 저장하지 않고 명시 저장 또는 일정 간격으로만 갱신한다.
- 오래된 draft는 cleanup 대상이 되도록 `updated_at`을 기록한다.
- 최종 저장 후에도 작업문서는 일정 기간 보존해 재편집할 수 있게 한다.
- 임시 저장 prefix는 일반 갤러리 목록에서 노출하지 않는다.
- 작업문서 조회는 관리자 또는 해당 작업을 만든 사용자 권한으로 제한한다.

## 6. Editing Tools

### 6.1 Brush

브러시는 pointer event 기반으로 동작한다.

지원 옵션:

- size
- color
- opacity
- shape: `round`, `square`
- hardness: 초기에는 UI 옵션만 두고 round brush edge 처리에 반영

구현 방식:

1. 현재 선택된 `raster` layer가 없으면 새 raster layer를 만든다.
2. `pointerdown`에서 stroke 시작
3. `pointermove`에서 이전 좌표와 현재 좌표를 선분으로 연결
4. 선 끝은 round cap 또는 square cap 적용
5. `pointerup`에서 stroke operation을 해당 raster layer에 확정한다.

브러시 한 획은 히스토리상 하나의 작업으로 취급한다.

### 6.2 Mosaic Brush

모자이크는 색상 브러시와 다른 tool로 분리한다. 사용자는 브러시처럼 영역을 칠하지만, 실제 결과는 선택된 영역의 픽셀을 블록 단위로 재샘플링한다.

지원 옵션:

- brush size: 모자이크를 적용할 영역의 지름
- block size: 픽셀 블록 크기
- strength: 원본과 모자이크 결과를 섞는 정도

구현 방식:

1. mosaic layer를 생성하거나 현재 mosaic layer를 선택한다.
2. 모자이크 stroke 중 mask canvas에 선택 영역을 누적한다.
3. layer data에는 mask, block size, strength를 저장한다.
4. 렌더링 시 하위 합성 결과의 대상 bounding box를 읽는다.
5. bounding box 내부를 `blockSize` 단위로 순회한다.
6. mask에 포함된 영역에만 모자이크 결과를 적용한다.
7. strength가 1보다 작으면 원본 픽셀과 결과 픽셀을 alpha blend한다.

초기 구현은 성능과 단순성을 위해 stroke 종료 시 preview를 갱신한다. 하지만 모자이크 결과를 원본 bitmap에 파괴적으로 병합하지 않고, mask와 옵션을 layer data로 보존한다.

### 6.3 Text

텍스트는 클릭 위치에 입력 상자를 띄우고, 확정 시 text layer로 저장한다.

지원 옵션:

- font family
- font size
- bold
- italic
- color
- opacity
- align: 초기에는 left만 지원하고 center/right는 후순위

구현 방식:

1. canvas 좌표에 HTML input 또는 textarea overlay를 배치한다.
2. 사용자가 텍스트를 입력하고 확정하면 text layer를 생성한다.
3. 이후 선택/이동/내용 수정/스타일 수정은 layer data 변경으로 처리한다.
4. text layer 렌더링 시 `ctx.fillText`를 사용한다.

Korean text 입력을 고려해 IME composition 중 Enter 처리에 주의한다.

### 6.4 Shapes

도형은 초기에는 다음만 지원한다.

- rectangle
- ellipse
- line
- arrow

지원 옵션:

- stroke color
- fill color
- stroke width
- opacity

구현 방식:

1. `pointerdown`에서 시작점 저장
2. `pointermove`에서 overlay canvas에 preview 렌더링
3. `pointerup`에서 shape layer를 생성한다.
4. 이후 선택/이동/크기 조절/색상 변경은 shape layer data 변경으로 처리한다.

도형은 확정 후에도 재편집 가능한 객체로 유지한다.

## 7. History, Undo, Redo

### 7.1 Keyboard Shortcuts

- `Ctrl+Z`: undo
- `Ctrl+R`: redo
- `Ctrl+Y`: redo 보조 단축키로 추가 가능

브라우저의 기본 `Ctrl+R` 새로고침과 충돌한다. 편집기가 활성화되어 있고 포커스가 일반 입력 필드가 아닐 때만 `preventDefault()`를 호출한다.

### 7.2 History Model

초기 구현은 command 기반으로 시작한다.

```js
{
  id: "cmd_...",
  label: "Update text layer",
  targetLayerId: "layer_...",
  before: {},
  after: {},
  apply: "updateLayer",
  revert: "updateLayer",
  createdAt: 1710000000000
}
```

텍스트, 도형, layer transform, layer option 변경은 JSON diff 또는 before/after object로 기록한다. raster brush처럼 bitmap 변경이 필요한 작업만 bounds 기반 `ImageData`를 사용한다.

작업별 history 전략:

- brush: raster layer의 stroke bounds에 대한 ImageData 또는 stroke command 기록
- mosaic: mask path와 option 변경 기록
- text: layer data before/after 기록
- shape: layer data before/after 기록
- image: asset reference와 transform before/after 기록

### 7.3 Limits

권장 초기 제한:

- 최대 히스토리 항목 100개
- 누적 ImageData 예상 메모리 256MB 근처에서 오래된 항목 제거
- 이미지 한 변이 매우 큰 경우 편집 시작 전 경고 표시
- autosave revision은 히스토리 전체가 아니라 현재 document snapshot 중심으로 저장

## 8. Storage And Permission Rules

기본 규칙은 "프로젝트 상에 존재하는 R2 이미지에 대해서만 제한적으로 작업 가능"이다.

클라이언트 검증:

- `/api/list`로 확인한 파일만 열기 목록에 노출
- 저장 대상 key는 현재 프로젝트 prefix 또는 사용자가 접근 가능한 prefix 내부로 제한
- 이미지 확장자만 허용

서버 검증:

- `/api/image-editor/document`로 작업문서를 생성/조회/갱신한다.
- `/api/image-editor/save`로 최종 이미지를 저장한다.
- `/api/image-editor/save-as`는 새 key 저장과 metadata 복제를 함께 처리한다.
- `/api/image-editor/cleanup`은 오래된 임시 작업물을 정리한다.
- 이미지 content-type만 허용한다.
- 시스템 메타 파일명은 거부한다.
- 허용 prefix를 검증한다.
- 원본 key 존재 여부를 검증한다.
- 저장 감사 로그를 기록한다.
- 기존 metadata와 DB row를 보존하거나 명시 정책에 따라 복제한다.

## 9. Metadata Policy

편집 결과는 기존 metadata를 잃지 않아야 한다. 저장 과정의 기본 정책은 "보존 후 병합"이다.

저장 성공 후 기존 `_meta` 또는 `file_metadata` 내용을 유지하고 다음 정보를 추가한다.

```json
{
  "edited": true,
  "editorVersion": 1,
  "sourceKey": "project/character/001.webp",
  "savedAsKey": "project/character/001_edited.webp",
  "derivedFromKey": "project/character/001.webp",
  "editorDocumentId": "editor_doc_...",
  "editedAt": "2026-06-06T00:00:00.000+09:00",
  "operationsSummary": ["brush", "mosaic", "text"]
}
```

metadata 무결성 규칙:

- 저장 API는 원본 object의 customMetadata를 먼저 읽는다.
- 덮어쓰기 저장은 기존 customMetadata를 유지하고 편집 관련 field만 추가/갱신한다.
- 다른 이름으로 저장은 원본 metadata를 새 key의 metadata로 복제한 뒤 derivative 정보를 추가한다.
- DB `file_metadata`가 있으면 같은 정책으로 병합 또는 복제한다.
- metadata 삭제가 필요한 경우에도 암묵적으로 삭제하지 않고 명시 옵션을 통해서만 처리한다.
- 저장 실패 시 metadata update를 실행하지 않는다.
- metadata update 실패 시 이미지 저장 성공만 반환하지 않고 partial failure로 처리한다.

작업 전체 히스토리는 영구 저장하지 않는다. 대신 작업문서 snapshot은 R2/DB 임시 저장 공간에 저장해 재편집과 복구에 사용한다.

## 10. Implementation Phases

### Phase 1: Editor Core

- `image_editor` 모듈 디렉터리 추가
- R2 이미지 key로 이미지 로드
- base canvas, overlay canvas, 좌표 변환 구현
- layer document schema 구현
- `sourceImage` layer 렌더링 구현
- WebP Blob export 구현
- 이미지 편집 전용 document/save API 설계 및 최소 구현

완료 기준:

- R2 이미지 1개를 열어 canvas에 표시할 수 있다.
- 편집 작업문서가 생성된다.
- 편집 없이 저장하면 자동 백업이 생성되고 기존 metadata가 유지된 상태로 이미지가 정상 저장된다.
- 다른 이름으로 저장 시 원본 metadata가 복제된 새 파일이 생긴다.

### Phase 2: Temporary Storage And Integrity

- R2 작업문서 저장 위치 추가
- DB `image_editor_documents`, `image_editor_revisions` 추가
- autosave 저장/복구 구현
- metadata 보존/복제 helper 구현
- 원본 덮어쓰기 전 백업 저장 helper 구현
- 저장 실패와 partial failure 처리 규칙 구현

완료 기준:

- 새로고침 후 draft 작업문서를 복구할 수 있다.
- 저장 전후 metadata가 삭제되지 않는다.
- 원본 덮어쓰기 전 원본 object와 metadata 백업이 생성된다.
- 백업 생성 실패 시 원본 덮어쓰기가 중단된다.
- 다른 이름 저장 시 원본 metadata와 연결 정보가 보존된다.

### Phase 3: Layers, Brush, And History

- raster layer 구현
- brush tool 구현
- command 기반 history 구현
- `Ctrl+Z` undo 구현
- `Ctrl+R`, `Ctrl+Y` redo 구현
- layer 선택/이동의 최소 동작 구현

완료 기준:

- 브러시 한 획이 raster layer에 기록된다.
- 여러 번 undo/redo해도 layer document가 깨지지 않는다.
- 작업문서 저장 후 다시 열어도 레이어 구조가 유지된다.

### Phase 4: Mosaic

- mosaic mask canvas 구현
- mosaic layer 구현
- block size/strength 옵션 구현
- mosaic 작업 히스토리 연동

완료 기준:

- 브러시로 칠한 영역만 모자이크 처리된다.
- 강도와 block size 변경이 결과에 반영된다.
- undo/redo가 정상 동작한다.

### Phase 5: Text, Shapes, And Image Layers

- text overlay input 구현
- font size, bold, italic, color 적용
- rectangle, ellipse, line, arrow 구현
- overlay preview와 layer object 생성 구현
- 추가 이미지 layer 구현
- history 연동

완료 기준:

- 텍스트와 도형을 원하는 위치에 추가할 수 있다.
- 확정된 텍스트/도형/이미지를 다시 선택하고 수정할 수 있다.
- 작업문서 저장 후 다시 열어도 텍스트/도형/이미지가 객체로 유지된다.

### Phase 6: Hardening

- 큰 이미지 메모리 경고
- 저장 전 덮어쓰기 확인
- 저장 실패 복구 메시지
- 경로 검증 강화
- 저장 metadata 기록
- 기존 갤러리/프로젝트 캐시 무효화 연결

완료 기준:

- 저장 대상 경로가 잘못되면 업로드하지 않는다.
- 저장 성공 후 기존 이미지 목록/미리보기가 갱신된다.
- 편집 세션 중 실수로 새로고침/닫기 시 dirty 상태 경고가 표시된다.

## 11. Key Technical Risks

### 11.1 Canvas Memory

큰 이미지는 canvas, raster layer, preview, history가 빠르게 메모리를 사용한다.

대응:

- bounds 기반 history 사용
- vector/text/object layer는 bitmap snapshot 대신 JSON command로 기록
- 히스토리 항목 수 제한
- 너무 큰 이미지 경고
- 필요 시 작업용 canvas를 최대 편집 해상도로 축소하는 옵션 추가

### 11.2 Ctrl+R Collision

`Ctrl+R`은 브라우저 새로고침 기본 단축키다.

대응:

- 편집기가 활성화된 상태에서만 redo로 가로챈다.
- 텍스트 입력 중에는 기본 입력 흐름을 우선한다.
- 저장하지 않은 변경사항이 있으면 `beforeunload` 경고를 등록한다.

### 11.3 Tainted Canvas

이미지를 다른 origin에서 불러오면 canvas export가 막힐 수 있다.

대응:

- 앱과 같은 origin의 R2 서빙 경로만 사용한다.
- 외부 URL 직접 편집은 지원하지 않는다.

### 11.4 Destructive Save

원본 덮어쓰기는 되돌릴 수 없는 서버 저장 작업이다.

대응:

- 1차 구현에서 저장 전 확인
- Save의 기본 동작은 원본 덮어쓰기다.
- 원본 덮어쓰기 전 자동 백업을 필수로 수행한다.
- 백업이 정상 완료되지 않으면 저장을 중단한다.
- "다른 이름으로 저장"은 별도 보조 액션으로 둔다.

### 11.5 Metadata Integrity

이미지 저장은 성공했지만 metadata 또는 DB 연결이 삭제되면 프로젝트 기능에서 이미지가 고아 데이터처럼 취급될 수 있다.

대응:

- 이미지 편집 전용 저장 API 사용
- 저장 전 원본 metadata snapshot 확보
- 이미지 object 저장과 DB metadata update를 하나의 서버 흐름으로 처리
- partial failure를 성공으로 숨기지 않기
- 저장 후 metadata read-back 검증

### 11.6 Layer Schema Drift

레이어 기능은 확장될수록 schema 변경이 자주 발생할 수 있다.

대응:

- 모든 document에 `documentVersion` 기록
- layer type별 serializer/deserializer 분리
- migration 함수 추가
- 알 수 없는 layer type은 삭제하지 않고 unsupported layer로 보존

## 12. Open Decisions

- 작업문서 draft를 최종 저장 후 얼마 동안 보존할지 결정해야 한다.
- 임시 저장 cleanup 주기를 결정해야 한다.
- layer별 blend mode 지원을 언제 확장할지 결정해야 한다.

확정된 저장 정책:

- 저장 기본 포맷은 WebP다.
- Save의 기본 동작은 원본 덮어쓰기다.
- 원본 덮어쓰기 전 자동 백업은 필수다.
- 백업 실패 시 저장을 진행하지 않는다.

## 13. Recommended First Implementation

가장 현실적인 첫 구현 범위는 다음과 같다.

1. R2 이미지 열기
2. layer document 생성
3. `sourceImage` layer 렌더링
4. 작업문서 임시 저장
5. metadata 보존형 다른 이름으로 저장
6. metadata 보존형 원본 덮어쓰기 저장

그 다음 raster brush와 command 기반 undo/redo를 추가한다. 레이어와 저장 무결성을 먼저 잡아야 이후 모자이크, 텍스트, 도형, 추가 이미지 기능을 확장해도 구조를 다시 갈아엎지 않아도 된다.

## 14. UI Join Points

이 섹션은 기능 구현 문서와 UI 문서를 함께 보기 위한 연결 지점이다. 기능을 구현할 때는 아래 표의 UI 요구사항도 같이 확인한다.

| Implementation Area | Related UI Area | Required Join Point |
| --- | --- | --- |
| `4.2 Editor State` | UI `16. UI To State Mapping` | UI control이 어떤 editor state를 읽고 쓰는지 같은 이름으로 유지한다. |
| `4.3 Layer Document Model` | UI `8.2 Layers Tab`, `11. Layer Editing UX` | layer type, visibility, lock, opacity, transform 표현이 문서 model과 UI panel에서 일치해야 한다. |
| `5.2 Save` | UI `9.1 Save Confirmation` | 원본 덮어쓰기 저장은 metadata/DB 보존 상태를 UI에 명시해야 한다. |
| `5.3 Save As` | UI `9.2 Save As Dialog` | 기본 경로, 파일명, derivative metadata 정책이 UI 기본값과 API 동작에서 일치해야 한다. |
| `5.4 Temporary Save` | UI `10. Temporary Save And Recovery UI` | autosave status, draft recovery, cleanup 정책이 같은 document id를 기준으로 연결되어야 한다. |
| `6. Editing Tools` | UI `6. Tool Bar`, `8.1 Properties Tab` | 도구 옵션 이름과 값 범위가 tool implementation과 option UI에서 다르면 안 된다. |
| `7. History, Undo, Redo` | UI `8.3 History Tab`, `12. Keyboard Shortcuts` | command label, undo/redo availability, shortcut handling이 history state와 동기화되어야 한다. |
| `8. Storage And Permission Rules` | UI `14. Empty And Loading States`, `9. Save UI` | 권한/경로/지원 확장자 오류가 UI 상태로 표현되어야 한다. |
| `9. Metadata Policy` | UI `9. Save UI` | metadata 보존 실패는 일반 저장 실패와 구분해서 보여준다. |
| `10. Implementation Phases` | UI `17. Implementation Phases` | 기능 Phase를 진행할 때 대응 UI Phase의 최소 완료 기준도 함께 만족해야 한다. |

권장 작업 순서:

1. 기능 Phase를 선택한다.
2. 위 표에서 대응 UI section을 확인한다.
3. editor state, API payload, UI state 이름이 같은지 맞춘다.
4. 기능 완료 기준과 UI 완료 기준을 함께 체크한다.
