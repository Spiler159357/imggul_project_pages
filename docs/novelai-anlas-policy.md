# NovelAI Image Anlas 정책 정리

기준일: 2026-08-24  
적용 코드: `public/js/nai-pricing.js`

## 1. 프로젝트의 기본 원칙

- UI의 반복 생성은 NovelAI 배치가 아니다. 브라우저가 `n_samples: 1` 요청을 순차적으로 여러 번 전송한다.
- 예상 비용은 한 요청의 비용을 먼저 계산한 뒤 실제 요청 횟수만큼 합산한다.
- 구독 상태나 V5 무료 사용량을 확인하지 못하면 0 Anlas로 단정하지 않고 가능한 범위로 표시한다.
- 실행 직전 예상 비용이 증가하면 기존 클릭으로 과금하지 않고 갱신된 비용을 다시 보여준다.

## 2. Opus 0 Anlas 조건

공통 조건은 다음과 같다.

- 한 요청에 이미지 1장(`n_samples: 1`)
- 28 steps 이하
- 1,048,576 pixels(1024×1024) 이하
- 활성 Opus 구독

모델과 작업별 적용은 다음과 같다.

| 작업 | V4.5 이하 | V5 |
| --- | --- | --- |
| Text to Image | 0 Anlas | V5 무료 사용량이 남아 있으면 0 Anlas |
| 일반 Inpaint | 위 공통 조건이면 0 Anlas | 유료 |
| Image2Image | 유료 | 유료 |
| 다중 샘플 요청 | 유료 | 유료 |

V5의 0 Anlas 생성은 별도의 충전식 무료 사용량을 소비한다. 이 사용량이 소진되면 동일한 설정도 Anlas를 소비한다.

## 3. 인페인트 해석

- `mask`가 있는 요청은 Inpaint로 분류한다.
- `image`만 있고 `mask`가 없는 요청은 Image2Image로 분류한다.
- V4.5 이하 Inpaint를 단순히 "베이스 이미지 사용"으로 분류해 유료 처리하지 않는다.
- V4.5 이하 Inpaint도 28 steps 또는 1MP 한도를 넘으면 유료다.
- Focused Inpainting은 선택 영역을 약 1MP로 처리하므로 큰 원본 이미지에서도 Opus 0 Anlas가 가능하다. 현재 프로젝트는 일반 인페인트 페이로드를 사용하므로 실제 전송 해상도로 판정한다.

## 4. 별도 비용 항목

- Precise Reference: 이미지 한 장을 생성할 때 참조 이미지 하나당 5 Anlas가 추가된다.
- Vibe Transfer: V4 이상에서 새 Vibe 인코딩에 일회성 2 Anlas가 발생할 수 있다. 4개를 초과하는 Vibe는 추가 Vibe마다 2 Anlas가 더해진다. 현재 프로젝트 UI는 Vibe 1개만 지원한다.
- SMEA/DYN, 높은 steps, 큰 해상도는 기본 생성 단가를 높인다.
- 유료 Inpaint와 Image2Image는 strength가 기본 생성 단가에 반영된다.

Vibe 인코딩은 생성 요청 단가와 별도의 캐시·인코딩 단계에 해당할 수 있어 현재 생성 버튼의 확정 단가에는 포함하지 않는다. 새로운 Vibe를 등록하는 흐름을 별도 구현하면 그 시점에 2 Anlas를 명시해야 한다.

## 5. 근거와 주의사항

- [NovelAI 구독 정책](https://docs.novelai.net/en/subscription/)
- [NovelAI Inpaint 및 Focused Inpainting](https://docs.novelai.net/en/image/inpaint/)
- [NovelAI Precise Reference](https://docs.novelai.net/en/image/precisereference/)
- [NovelAI Vibe Transfer](https://docs.novelai.net/en/image/vibetransfer/)
- [NovelAI API 비용 계산 구현 참고](https://aedial.github.io/novelai-api/_modules/novelai_api/ImagePreset.html)

NovelAI 구독 문서의 일반적인 "베이스 이미지 제외" 문구와 Inpaint/Focused Inpainting의 실제 무료 동작 설명 사이에는 표현 차이가 있다. 이 프로젝트는 기존 V4.5 이하 인페인트의 실제 0 Anlas 동작과 공개 비용 계산 구현을 기준으로 Inpaint와 Image2Image를 분리한다. V5는 별도 무료 사용량 정책이 있으므로 보수적으로 유료 Inpaint로 처리한다.
