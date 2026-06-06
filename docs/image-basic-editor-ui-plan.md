# Basic Image Editor UI Plan

## 1. Goal

이 문서는 기초 이미지 편집 기능의 UI 계획을 정리한다.

1차 접근 위치는 프로젝트 탭 내부의 프로젝트 상세 화면으로 둔다. 이미지 편집기는 캐릭터/상황이 상하로 배치되는 것과 같은 방식으로, 프로젝트 상세 화면에서 플래너 하단에 위치하는 섹션 카드로 제공한다. 플래너/갤러리/이미지 모달 등 다른 기능은 편집 대상 이미지와 context를 전달하는 진입점 역할을 한다.

편집 워크스페이스는 독립 기능으로 설계하되, 이후 필요하면 이미지 모달, 갤러리, 캐릭터 상세, 상황 상세에서도 같은 editor core를 호출할 수 있어야 한다.

이 문서는 이후 실제 스크린샷, 목업 이미지, Figma 캡처, HTML 프로토타입 캡처를 붙여가며 수정할 수 있는 형태로 유지한다. 동시에 Codex가 읽고 수정할 수 있도록 Markdown, Mermaid, ASCII wireframe, 컴포넌트 명세를 함께 사용한다.

기능 구현 설계는 별도 문서인 [Basic Image Editor Implementation Plan](image-basic-editor-implementation-plan.md)에서 관리한다. UI 작업을 시작할 때는 이 문서의 화면/컴포넌트가 구현 문서의 editor state, layer model, save API와 연결되는지 `19. Implementation Join Points`를 먼저 확인한다.

## 2. UI Principles

- 이미지가 화면의 중심이어야 한다.
- 편집 기능은 많은 설명문보다 익숙한 아이콘, 짧은 라벨, 툴팁으로 전달한다.
- 레이어 기반 편집을 전제로 하며, 텍스트/도형/추가 이미지/모자이크는 선택 후 다시 수정할 수 있어야 한다.
- 저장 UI는 단순해야 하지만, metadata와 DB 연결 무결성을 해치지 않는 저장 정책을 분명하게 보여줘야 한다.
- 사용자는 현재 작업물이 저장되었는지, 임시 저장되었는지, 원본을 덮어쓸 예정인지 항상 알 수 있어야 한다.
- 데스크톱에서는 좌우 패널과 중앙 캔버스 구조를 사용하고, 모바일에서는 패널을 접거나 하단 시트로 전환한다.

## 3. Editable Design Document Format

이 UI 계획 문서는 이미지 기반 자료를 추가할 수 있도록 다음 규칙을 사용한다.

### 3.1 Image Slots

실제 UI 목업 또는 캡처가 생기면 아래 슬롯에 이미지 경로를 붙인다. 이미지 파일은 가능하면 `docs/assets/image-editor/` 아래에 둔다.

```md
![Desktop workspace mockup](C:/Users/Kimyunsik/Documents/GitHub/imggul_project_pages/docs/assets/image-editor/desktop-workspace.png)
```

현재 단계에서는 실제 이미지가 없으므로, 각 slot은 비워두고 텍스트 wireframe을 함께 둔다.

| Slot | Purpose | File |
| --- | --- | --- |
| `desktop-workspace` | 데스크톱 전체 편집 화면 | `docs/assets/image-editor/desktop-workspace.png` |
| `mobile-workspace` | 모바일 편집 화면 | `docs/assets/image-editor/mobile-workspace.png` |
| `save-dialog` | 저장/다른 이름 저장 다이얼로그 | `docs/assets/image-editor/save-dialog.png` |
| `layer-panel` | 레이어 패널 상세 | `docs/assets/image-editor/layer-panel.png` |
| `tool-options` | 도구별 옵션 패널 | `docs/assets/image-editor/tool-options.png` |
| `editor-entry` | 프로젝트 상세 화면의 편집기 섹션 진입 구조 | `docs/assets/image-editor/editor-entry.png` |

### 3.2 Wireframe Policy

목업 이미지가 없어도 구조를 이해할 수 있도록 각 주요 화면에는 ASCII wireframe을 둔다. 실제 UI가 바뀌면 wireframe도 같이 갱신한다.

### 3.3 AI-Readable Notes

각 화면에는 다음 정보를 반드시 적는다.

- 화면 목적
- 주요 상태
- 사용자 액션
- 연결되는 editor state
- 저장/metadata 관련 주의사항

## 4. Workspace Layout

### 4.1 Project Section Entry

이미지 편집기는 프로젝트 탭 내부의 프로젝트 상세 화면에서 접근하는 것을 1차 기준으로 한다. 프로젝트 상세 화면의 오른쪽 영역은 플래너와 편집기를 상하로 배치하며, 편집기는 플래너 하단에 위치한다. 다른 화면은 편집 대상 이미지의 `sourceKey`와 선택 context를 넘기고, 실제 편집 작업은 프로젝트의 이미지 편집기 섹션에서 수행한다.

개념 구조:

```text
+--------------------------------------------------------------------------------+
| App Nav: Explorer | Craft | Project                                      |
+--------------------------------------------------------------------------------+
| Project Detail: Prompt | Character/Situation | Planner / Image Editor       |
+--------------------------------------------------------------------------------+
|                                                                                |
|                         Editor Workspace                                       |
|                                                                                |
+--------------------------------------------------------------------------------+
```

의도:

- 이미지 편집 기능을 프로젝트 context 안에 두면서도 섹션 진입 후에는 충분한 캔버스 공간을 확보한다.
- 플래너, 프로젝트, 갤러리에서 생성하거나 확인한 이미지를 곧바로 편집 대상으로 넘길 수 있게 한다.
- project id, character id, situation id 같은 context를 함께 전달하고, 편집 기본 목록은 현재 프로젝트 prefix를 우선한다.

초기 진입 방식:

- 프로젝트 상세 화면에 `편집기` 카드를 제공하며, 이 카드는 플래너 카드 하단에 위치한다.
- 플래너 이미지 카드, 프로젝트 이미지 카드, 갤러리 이미지 카드에는 `편집` 액션을 제공하고 프로젝트의 이미지 편집기 섹션으로 이동한다.
- 이미지 편집기 섹션에는 최근 편집 draft, 최근 편집 이미지, 선택된 이미지의 편집 시작 버튼을 표시한다.
- 복구 가능한 draft가 있으면 이미지 편집기 섹션 상단에 표시한다.
- 이미지가 선택되지 않은 상태에서는 프로젝트/R2 이미지 선택 액션을 제공한다.

화면 배치 정책:

- 데스크톱에서는 프로젝트 편집기 섹션의 대부분을 editor workspace로 사용한다.
- 프로젝트 상세 대시보드에서는 플래너 하단에 편집기 카드를 배치한다.
- 이미지 편집기 화면 내부 레이아웃은 `4.2 Desktop Layout`을 따른다.

상태 규칙:

- 다른 화면에서 이미지 편집기를 열면 `sourceKey`와 가능한 context id를 함께 전달한다.
- 이미지 편집기에서 저장 또는 다른 이름 저장이 완료되면 관련 프로젝트/플래너/갤러리 이미지 목록을 갱신한다.
- 편집 draft는 프로젝트별로 조회 가능해야 한다.
- 현재 프로젝트 밖의 R2 이미지는 기본 선택 목록에 노출하지 않는다.

### 4.2 Desktop Layout

데스크톱 기본 구조는 상단 작업 막대, 좌측 도구 막대, 중앙 캔버스, 우측 속성/레이어 패널, 하단 상태 막대로 구성한다.

```text
+--------------------------------------------------------------------------------+
| Top Bar: Back | Image Name / Dirty State | Undo Redo | Save | Save As | More   |
+-----+--------------------------------------------------------------+-----------+
|     |                                                              |           |
|Tool |                                                              | Inspector |
| Bar |                         Canvas Stage                         | + Layers  |
|     |                                                              |           |
|     |                                                              |           |
+-----+--------------------------------------------------------------+-----------+
| Status Bar: zoom | image size | cursor pos | autosave | source/output key       |
+--------------------------------------------------------------------------------+
```

권장 너비:

- left toolbar: 48-56px
- right panel: 280-360px
- top bar: 48-56px height
- status bar: 28-36px height

중앙 캔버스는 checkerboard 또는 중립 회색 배경 위에 이미지를 표시한다. 이미지가 화면보다 작아도 캔버스 stage는 남은 공간을 채운다.

### 4.3 Mobile Layout

모바일에서는 이미지 영역을 최대화한다.

```text
+----------------------------------+
| Top: Back | Name | Save | More   |
+----------------------------------+
|                                  |
|                                  |
|           Canvas Stage           |
|                                  |
|                                  |
+----------------------------------+
| Tool Strip: brush mosaic text ...|
+----------------------------------+
| Bottom Sheet: options/layers     |
+----------------------------------+
```

모바일 정책:

- 도구 선택은 하단 icon strip으로 제공한다.
- 도구 옵션과 레이어는 하단 sheet로 전환한다.
- 복잡한 저장 경로 선택은 full-screen dialog로 연다.
- 텍스트/도형 편집 중에는 캔버스 조작과 객체 조작이 충돌하지 않도록 명확한 완료/취소 버튼을 둔다.

## 5. Top Bar

### 5.1 Purpose

Top bar는 문서 상태와 저장 액션을 보여준다.

### 5.2 Elements

- Back
  - 편집기 닫기
  - dirty 상태면 저장/버리기/취소 확인
- Image name
  - 현재 `sourceKey` 또는 표시 이름
  - Save As 이후에는 `outputKey` 기준으로 표시
- Dirty state
  - `저장됨`
  - `수정됨`
  - `임시 저장됨`
  - `저장 실패`
- Undo
- Redo
- Save
  - 원본 덮어쓰기
  - metadata 보존형 저장 API 호출
- Save As
  - 기본 경로는 원본 prefix
- More
  - 작업문서 복구
  - 원본 보기
  - 편집 문서 정보
  - 임시 저장 삭제

### 5.3 State Rules

- `dirty=false`이면 Save 버튼은 disabled 또는 subdued 상태로 둔다.
- autosave 중에는 Dirty state 영역에 `임시 저장 중...`을 표시한다.
- Save 실패 시 Save 버튼 주변에 오류 상태를 표시하되 캔버스 작업은 유지한다.
- 원본 덮어쓰기 저장 전에는 확인 dialog를 띄운다.

## 6. Tool Bar

### 6.1 Tool List

초기 도구:

- Move/Select
- Brush
- Mosaic
- Text
- Rectangle
- Ellipse
- Line
- Arrow
- Add Image
- Hand/Pan
- Zoom

아이콘은 기존 앱에서 사용하는 lucide icon을 우선 사용한다.

권장 icon:

- Move/Select: `mouse-pointer-2`
- Brush: `paintbrush`
- Mosaic: `grid-3x3`
- Text: `type`
- Rectangle: `square`
- Ellipse: `circle`
- Line: `minus`
- Arrow: `move-up-right`
- Add Image: `image-plus`
- Hand/Pan: `hand`
- Zoom: `zoom-in`

### 6.2 Tool Behavior

- 도구 선택 시 right inspector의 option section이 해당 도구 옵션으로 바뀐다.
- 객체 layer가 선택된 상태에서 Move/Select를 사용하면 transform handle을 표시한다.
- Brush와 Mosaic은 raster/effect layer를 생성하거나 현재 호환 layer에 작업한다.
- Text, Shape, Image 도구는 새 editable layer를 만든다.

## 7. Canvas Stage

### 7.1 Purpose

Canvas stage는 실제 편집 대상 이미지를 보여주고 pointer interaction을 처리한다.

### 7.2 Visual Requirements

- 이미지 바깥은 중립 회색 또는 checkerboard로 표시한다.
- 선택된 layer는 bounding box와 transform handle을 표시한다.
- locked layer는 선택 표시만 가능하고 transform handle은 disabled로 표시한다.
- text 편집 중에는 실제 입력 caret이 보이는 overlay input을 사용한다.
- canvas zoom이 바뀌어도 toolbar/panel layout은 흔들리지 않는다.

### 7.3 Canvas Layers

화면상 canvas는 다음 구조로 운영한다.

```text
Interaction Overlay
Selection Handles
Tool Preview Canvas
Rendered Document Canvas
Stage Background
```

`Rendered Document Canvas`는 layer document를 합성한 결과다. `Tool Preview Canvas`는 브러시/mosaic preview, shape drawing preview에 사용한다.

## 8. Inspector Panel

우측 패널은 `Properties`, `Layers`, `History` 탭으로 구성한다.

```text
+-----------------------------+
| Properties | Layers | History|
+-----------------------------+
| Tool Options / Layer Options |
|                             |
| Context Actions             |
+-----------------------------+
```

### 8.1 Properties Tab

도구별 옵션을 제공한다.

Brush:

- size slider/input
- color swatch
- opacity slider
- shape segmented control
- hardness slider

Mosaic:

- brush size slider/input
- block size slider/input
- strength slider
- preview quality toggle

Text:

- font family select
- font size input
- bold toggle
- italic toggle
- color swatch
- opacity slider
- align segmented control

Shape:

- shape type
- stroke color
- fill color
- stroke width
- opacity

Image Layer:

- replace image
- opacity
- position
- size
- rotation

### 8.2 Layers Tab

레이어 패널은 재편집 가능성을 보장하는 핵심 UI다.

Layer item 표시:

- visibility toggle
- lock toggle
- thumbnail
- layer name
- layer type badge
- opacity summary
- drag handle

Layer actions:

- select
- rename
- reorder
- duplicate
- delete
- lock/unlock
- show/hide
- merge down은 초기 구현에서 제공하지 않는다.

초기 layer type별 표시:

- `sourceImage`: 원본. 삭제 불가, 기본 locked 권장
- `raster`: 브러시 레이어
- `mosaic`: 모자이크 효과 레이어
- `text`: 텍스트 레이어
- `shape`: 도형 레이어
- `image`: 추가 이미지 레이어

### 8.3 History Tab

History는 작업 목록과 undo/redo 상태를 보여준다.

표시 항목:

- 작업 이름
- 대상 layer 이름
- 작업 시간
- 현재 위치 indicator

주의:

- History는 편집 세션 중 기능이다.
- autosave document에는 현재 document snapshot을 저장하고 전체 history 영구 보존은 기본 요구사항이 아니다.

## 9. Save UI

### 9.1 Save Confirmation

원본 덮어쓰기 저장 시 다음 정보를 표시한다.

- 원본 key
- 저장 포맷: WebP
- 자동 백업 생성 여부
- 백업 저장 위치 또는 백업 revision
- metadata 보존 여부
- DB metadata 연결 보존 여부
- 임시 작업문서 id

문구 방향:

```text
원본 이미지를 덮어씁니다.
저장 전에 원본 이미지와 metadata 백업을 생성합니다.
기존 이미지 metadata와 DB 연결은 보존됩니다.
```

버튼:

- 저장
- 다른 이름으로 저장
- 취소

### 9.2 Save As Dialog

```text
+--------------------------------------------------+
| 다른 이름으로 저장                               |
+--------------------------------------------------+
| 원본: project/character/001.webp                 |
| 저장 경로: [ project/character/              v ] |
| 파일명:   [ 001_edited.webp                  ]   |
| 포맷:     [ WebP v ]  품질: [ 0.92 ------- ]     |
|                                                  |
| [x] 원본 metadata 복제                           |
| [x] 원본과 derivative 연결 기록                  |
|                                                  |
|                         [취소] [저장]            |
+--------------------------------------------------+
```

기본값:

- 저장 경로: 원본 prefix
- 파일명: `{baseName}_edited.webp`
- 포맷: WebP
- metadata 복제: enabled, 사용자가 끌 수 없게 할지 검토
- derivative 연결 기록: enabled

### 9.3 Save Error State

저장 실패 시:

- 캔버스와 작업문서는 유지한다.
- dirty 상태를 유지한다.
- 실패 원인을 짧게 표시한다.
- metadata update 실패는 단순 업로드 실패와 구분한다.
- 자동 백업 실패는 원본 덮어쓰기 전에 발생한 저장 차단 상태로 구분한다.

예시 상태:

- `이미지 저장 실패`
- `metadata 보존 실패`
- `DB 연결 갱신 실패`
- `저장 경로 검증 실패`
- `원본 백업 실패`

## 10. Temporary Save And Recovery UI

### 10.1 Autosave Indicator

Status bar 또는 top bar에 표시한다.

상태:

- `임시 저장됨`
- `임시 저장 중...`
- `임시 저장 실패`
- `복구 가능한 작업 있음`

### 10.2 Recovery Dialog

편집기를 열 때 같은 source key에 draft가 있으면 복구 dialog를 표시한다.

```text
+--------------------------------------------------+
| 복구 가능한 편집 작업                            |
+--------------------------------------------------+
| 원본: project/character/001.webp                 |
| 마지막 임시 저장: 2026-06-06 20:35               |
| 작업문서: editor_doc_...                         |
|                                                  |
| [새로 시작] [임시 작업 삭제] [복구하기]          |
+--------------------------------------------------+
```

복구하기는 document snapshot을 불러온다. 새로 시작은 draft를 즉시 삭제하지 않고 별도 정리 대상으로 남기는 것이 안전하다.

## 11. Layer Editing UX

### 11.1 Selection

- canvas에서 객체를 클릭하면 해당 layer를 선택한다.
- layer panel에서 item을 클릭해도 선택된다.
- 선택된 layer는 canvas와 layer panel 양쪽에 표시된다.

### 11.2 Transform

지원 transform:

- move
- resize
- rotate

초기 구현에서는 multi-select transform은 후순위로 둔다. 단, schema는 `selectedLayerIds` 배열을 사용해 향후 확장 가능하게 둔다.

### 11.3 Text Editing

- text layer 더블 클릭 또는 Enter로 내용 편집 모드 진입
- 편집 중 IME composition을 방해하지 않는다.
- Escape는 편집 취소
- Ctrl+Enter 또는 완료 버튼은 확정

### 11.4 Shape Editing

- 선택 시 handle 표시
- stroke/fill/width는 Properties에서 변경
- shape type 변경은 가능하면 허용하되, 초기에는 같은 geometry를 유지할 수 있는 shape 사이에서만 제공한다.

## 12. Keyboard Shortcuts

초기 단축키:

- `Ctrl+Z`: undo
- `Ctrl+R`: redo
- `Ctrl+Y`: redo
- `Ctrl+S`: save
- `Ctrl+Shift+S`: save as
- `V`: move/select
- `B`: brush
- `M`: mosaic
- `T`: text
- `Delete`: selected layer delete
- `Space`: hold to pan

주의:

- 텍스트 입력 중에는 문자 단축키를 막지 않는다.
- `Ctrl+R`은 브라우저 새로고침과 충돌하므로 편집기가 active이고 일반 입력 필드가 아닐 때만 가로챈다.
- 저장하지 않은 변경이 있으면 browser unload 경고를 표시한다.

## 13. Accessibility And Feedback

- 모든 icon button에는 tooltip과 `aria-label`을 둔다.
- 색상 swatch에는 현재 색상 hex 값을 텍스트로도 제공한다.
- slider에는 숫자 input을 함께 제공한다.
- 저장/임시 저장/오류 상태는 색상만으로 전달하지 않는다.
- keyboard로 layer panel과 top bar 버튼에 접근할 수 있어야 한다.

## 14. Empty And Loading States

### 14.1 No Image Loaded

편집기에 이미지가 없을 때:

- R2 이미지 선택 액션
- 최근 편집 draft 복구 액션

### 14.2 Image Loading

- 캔버스 중앙에 loading indicator
- source key 표시
- 실패 시 R2 key와 오류를 표시하되 긴 오류는 접는다.

### 14.3 Unsupported Image

지원하지 않는 확장자 또는 손상 이미지:

- 편집 불가 메시지
- 원본 다운로드 또는 닫기 액션

## 15. Responsive Behavior

Breakpoint 방향:

- desktop: 1024px 이상
- tablet: 768px 이상
- mobile: 767px 이하

Desktop:

- left toolbar 고정
- right inspector 고정
- status bar 표시

Tablet:

- left toolbar 고정
- inspector는 접기 가능
- layer panel은 drawer 가능

Mobile:

- toolbar는 하단 strip
- inspector는 bottom sheet
- status bar 정보는 top bar 또는 More 안으로 축약

## 16. UI To State Mapping

| UI Element | Editor State | Notes |
| --- | --- | --- |
| selected tool | `activeTool` | tool module 선택 |
| brush size | `toolOptions.brush.size` | raster layer stroke에 사용 |
| mosaic strength | `toolOptions.mosaic.strength` | mosaic layer data에 저장 |
| selected layer | `selectedLayerIds` | canvas handle과 inspector가 동기화 |
| layer visibility | `layers[].visible` | render 결과에 즉시 반영 |
| layer lock | `layers[].locked` | transform/edit 제한 |
| dirty state | `dirty` | save button 상태 |
| autosave status | runtime autosave state | top/status bar 표시 |
| output path | `outputKey` | save/save-as API에 전달 |

## 17. Implementation Phases

### Phase 1: Static Workspace Shell

- 프로젝트 상세 화면의 플래너 하단 편집기 섹션 진입점
- top bar, tool bar, canvas stage, inspector panel skeleton
- desktop layout CSS
- mobile bottom tool strip 구조
- empty/loading/error state

완료 기준:

- 프로젝트 상세 화면에서 플래너 하단의 편집기 카드를 확인할 수 있다.
- 이미지 없이도 편집 workspace layout을 볼 수 있다.
- 각 영역이 고정된 크기와 responsive 제약을 가진다.

### Phase 2: Canvas And Tool Options

- R2 이미지 로드 후 canvas stage 표시
- zoom/pan UI
- Brush/Mosaic/Text/Shape tool option panel
- keyboard shortcut shell

완료 기준:

- 도구를 선택하면 option panel이 바뀐다.
- canvas stage가 이미지 크기와 zoom 상태를 안정적으로 표시한다.

### Phase 3: Layer Panel

- layer list 표시
- select/show/hide/lock/rename/reorder
- selected layer와 canvas handle 동기화

완료 기준:

- 텍스트/도형/이미지 layer가 panel에서 객체로 보인다.
- 선택한 layer의 속성이 Properties에 표시된다.
- layer panel은 초기에는 펼쳐진 상태이며, 사용자가 편의에 따라 접을 수 있어야 한다.

### Phase 4: Save And Recovery UI

- save confirmation
- save as dialog
- autosave indicator
- recovery dialog
- save error state

완료 기준:

- 사용자가 원본 덮어쓰기와 다른 이름 저장 차이를 명확히 이해할 수 있다.
- 원본 덮어쓰기 저장 전에 자동 백업이 생성된다는 점을 확인할 수 있다.
- metadata 보존 상태가 저장 UI에 표시된다.
- 임시 저장 draft를 복구할 수 있다.
- 원본 metadata 복제 옵션에 대해서는 무결성을 우선하여 사용자가 끌 수 없게 두는 편이 안전하다.

### Phase 5: Polish And Mobile

- mobile bottom sheet
- touch transform handle 크기 조정
- tooltip/aria-label 정리
- long path truncation
- error message refinement

완료 기준:

- 모바일에서도 이미지 영역이 충분히 넓게 유지된다.
- 긴 R2 key가 UI를 깨지 않는다.
- 버튼/텍스트가 좁은 화면에서 겹치지 않는다.

## 18. Open Decisions

- 현재는 전부 결정이 완료되었음.


확정된 UI 정책:

- 이미지 편집기는 상단 앱 navigation의 독립 탭이 아니라 프로젝트 탭 내부의 프로젝트 상세 화면에서 플래너 하단 섹션으로 제공한다.
- Save 버튼의 기본 동작은 원본 덮어쓰기다.
- 원본 덮어쓰기 전 자동 백업 생성 상태를 저장 확인 UI에 표시한다.

## 19. Implementation Join Points

이 섹션은 UI 문서와 기능 구현 문서를 함께 보기 위한 연결 지점이다. UI를 설계하거나 구현할 때는 아래 표의 기능 요구사항도 같이 확인한다.

| UI Area | Related Implementation Area | Required Join Point |
| --- | --- | --- |
| `4. Workspace Layout` | Implementation `4. Recommended Architecture` | workspace shell은 프로젝트 섹션 내부에 붙더라도 editor core, layer renderer, autosave module을 분리해서 끼울 수 있어야 한다. |
| `4.1 Project Section Entry` | Implementation `5. Image Loading And Saving`, `5.4 Temporary Save` | 다른 화면에서 editor를 열 때 project context, source key, draft document id를 전달해야 한다. |
| `5. Top Bar` | Implementation `5.2 Save`, `7. History, Undo, Redo` | dirty state, autosave state, undo/redo availability, save action이 editor runtime state와 직접 연결되어야 한다. |
| `6. Tool Bar` | Implementation `6. Editing Tools` | tool id와 UI button id를 같은 기준으로 유지해 tool registry에 연결한다. |
| `7. Canvas Stage` | Implementation `4.3 Layer Document Model`, `6. Editing Tools` | canvas hit testing, preview canvas, selection handle은 layer document model을 기준으로 동작해야 한다. |
| `8.1 Properties Tab` | Implementation `4.2 Editor State`, `6. Editing Tools` | option control은 `toolOptions` 또는 selected layer data를 직접 갱신한다. |
| `8.2 Layers Tab` | Implementation `4.3 Layer Document Model` | UI에서 가능한 layer action은 document layer CRUD와 history command로 기록되어야 한다. |
| `8.3 History Tab` | Implementation `7. History, Undo, Redo` | history item label과 현재 위치 indicator는 command stack에서 가져온다. |
| `9. Save UI` | Implementation `5. Image Loading And Saving`, `9. Metadata Policy` | save dialog는 metadata 보존/복제/partial failure 정책을 숨기지 않는다. |
| `10. Temporary Save And Recovery UI` | Implementation `5.4 Temporary Save` | draft recovery UI는 `image_editor_documents`와 R2 작업문서 key를 기준으로 한다. |
| `11. Layer Editing UX` | Implementation `4.3 Layer Document Model`, `7. History, Undo, Redo` | 선택, 이동, 크기 조절, 삭제는 모두 layer command로 기록되어 undo/redo 가능해야 한다. |
| `12. Keyboard Shortcuts` | Implementation `7.1 Keyboard Shortcuts` | `Ctrl+R` 충돌 방지, 텍스트 입력 중 shortcut 비활성화 조건을 구현과 동일하게 유지한다. |
| `17. Implementation Phases` | Implementation `10. Implementation Phases` | UI Phase 완료 기준은 대응 기능 Phase의 최소 state/API가 존재할 때만 완료로 본다. |

권장 작업 순서:

1. UI 화면 또는 컴포넌트를 선택한다.
2. 위 표에서 대응 구현 section을 확인한다.
3. 필요한 editor state, layer field, API payload가 정의되어 있는지 확인한다.
4. 정의가 없으면 UI만 먼저 만들지 말고 구현 문서에 join point를 추가한다.
