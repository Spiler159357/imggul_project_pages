# Cloudflare D1 row 사용량 측정 기준

작성일: 2026-07-06

## 1. 공식 문서 출처

확인한 공식 문서는 다음과 같다.

- Cloudflare D1 Pricing: https://developers.cloudflare.com/d1/platform/pricing/
- Cloudflare D1 Metrics and analytics: https://developers.cloudflare.com/d1/observability/metrics-analytics/
- Cloudflare D1 Return objects: https://developers.cloudflare.com/d1/worker-api/return-object/
- Cloudflare D1 Use indexes: https://developers.cloudflare.com/d1/best-practices/use-indexes/
- Cloudflare D1 Limits: https://developers.cloudflare.com/d1/platform/limits/

Cloudflare D1 pricing 문서는 2026-04-21 기준으로 업데이트되어 있으며, 이 문서는 해당 기준을 따른다.

## 2. 핵심 기준

Cloudflare D1은 쿼리 실행량을 다음 기준으로 측정한다.

| 항목 | 기준 |
| --- | --- |
| `rows_read` | 쿼리가 읽거나 스캔한 row 수 |
| `rows_written` | D1 DB에 쓰인 row 수 |
| write 작업 | `INSERT`, `UPDATE`, `DELETE`가 rows written에 포함 |
| transaction/batch | 읽기와 쓰기가 섞이면 둘 다 카운트될 수 있음 |
| row 크기 | row 크기나 컬럼 수는 row count 자체에는 영향 없음 |
| index | read scan은 줄일 수 있지만, indexed column write 시 추가 written row가 발생할 수 있음 |
| DDL | `CREATE`, `ALTER`, `DROP`도 read/write row가 섞여 발생할 수 있음 |
| Wrangler/dashboard 쿼리 | 대시보드나 Wrangler에서 직접 실행한 쿼리도 사용량에 포함 |

## 3. rows read

`rows_read`는 반환된 row 수가 아니라 스캔한 row 수다.

예를 들어 5,000 row 테이블에서 `SELECT * FROM table`이 full table scan으로 실행되면 5,000 rows read로 계산된다. unindexed column으로 필터링하면 실제 반환 row가 적어도 조건을 판단하기 위해 더 많은 row를 읽을 수 있다.

따라서 read 최적화 기준은 다음과 같다.

- deterministic primary key로 직접 조회한다.
- 자주 필터링하는 컬럼에는 index를 고려한다.
- 단, 이번 작업의 목표는 write row 최소화이므로 보조 index는 매우 제한적으로만 사용한다.
- 목록 조회가 필요하면 클라이언트가 이미 가진 project/character 목록으로 key를 만들어 개별 조회하는 방식이 write 관점에서 유리하다.

## 4. rows written

`rows_written`은 DB에 쓰인 row 수다.

공식 문서 기준으로 write 작업에는 다음이 포함된다.

```sql
INSERT
UPDATE
DELETE
```

예를 들어 `INSERT`로 10 row를 넣으면 10 rows written으로 계산된다. `UPDATE`와 `DELETE`도 영향을 받은 row 수가 rows written에 반영되는 것으로 보아야 한다.

이번 플래너 재설계에서는 다음을 row write 최소화 기준으로 삼는다.

- 이미지 1장마다 queue row를 만들지 않는다.
- candidate image도 D1 row로 만들지 않고 run JSON 안의 배열로 저장한다.
- 진행률 카운터를 job/task/item/run에 중복 update하지 않는다.
- stage/heartbeat row update를 제거하거나 최소화한다.
- 이벤트 로그를 D1 row로 남기지 않는다.
- cleanup queue를 후보 이미지마다 insert하지 않고 정상 경로에서는 R2 직접 삭제를 사용한다.
- 보조 index를 만들지 않는다. 필요한 조회는 primary key 기반 deterministic key로 해결한다.

## 5. index와 write 비용

Cloudflare 문서는 index가 read scan row를 줄일 수 있지만, index가 참조하는 컬럼에 write가 발생하면 추가 written row가 생긴다고 설명한다.

따라서 이번 신규 스키마의 원칙은 다음과 같다.

```text
1. primary key는 필수이므로 유지한다.
2. 보조 index는 만들지 않는다.
3. status, project_id, character_id 목록 조회를 위해 index를 만들지 않는다.
4. record_key를 deterministic하게 구성해 primary key 조회만 사용한다.
```

단, 이 선택은 read query 편의성과 일부 cleanup 조회 성능을 희생한다. 이번 작업의 목표가 rows written 최소화이므로 의도된 trade-off다.

## 6. 측정 방법

D1 Worker Binding API의 `D1Result.meta`에는 다음 값이 포함된다.

```js
{
  meta: {
    rows_read: 4,
    rows_written: 0
  }
}
```

실제 구현 후에는 다음 계층에서 측정해야 한다.

```js
async function runPlannerStatement(statement, label) {
  const result = await statement.run();
  console.log('[planner-d1]', label, {
    rowsRead: result.meta?.rows_read,
    rowsWritten: result.meta?.rows_written,
    changes: result.meta?.changes
  });
  return result;
}
```

Cloudflare dashboard에서도 D1 database의 Metrics 탭에서 Row Metrics를 확인할 수 있고, account billing 쪽에서는 rows read, rows written, storage를 확인할 수 있다. GraphQL Analytics API로도 조회 가능하다.

## 7. 한계와 주의점

- 수동으로 SQL statement 수를 세는 것은 추정일 뿐이며, 최종 기준은 D1이 반환하는 `meta.rows_written`이다.
- cascade delete, trigger, index 갱신은 수동 카운트보다 더 많은 rows written을 만들 수 있다.
- row 크기는 count에 직접 영향을 주지 않지만, D1에는 최대 string/BLOB/table row size 2 MB 제한이 있다.
- 한 Worker invocation의 D1 query 수 제한도 있다. compact JSON 구조는 write row를 줄이는 대신 한 row의 JSON parse/serialize 비용이 커진다.
- empty table도 storage를 약간 사용한다. 테이블 수를 줄이면 storage와 migration 복잡도도 같이 줄어든다.
