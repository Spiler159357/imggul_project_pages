# Background Planner Generation Setup

This implementation adds the application code for server-side planner generation, but Cloudflare resources still need to be created before it can run in production.

## Required Cloudflare Resources

1. D1 database
   - Suggested name: `imggul-planner`
   - Apply `migrations/0001_planner_background.sql`.
   - Add the real `database_id` to the Pages project binding named `DB`.

2. Queue
   - Suggested queue: `imggul-generation-queue`
   - Optional dead letter queue: `imggul-generation-dlq`
   - Add the producer binding named `GENERATION_QUEUE` to the Pages project.
   - Deploy `src/planner-background.js` as the queue consumer Worker.

3. Secrets
   - `NOVELAI_TOKEN`
   - `secretKey`

4. R2
   - Reuse the existing `imgBucket` binding and `imggul-storage` bucket.

## Local Files

- `src/planner-background.js`
  - Shared API helpers and Queue consumer.
- `migrations/0001_planner_background.sql`
  - D1 schema for job and item status.
- `wrangler.background.example.toml`
  - Example Worker config for the Queue consumer.
- `wrangler.toml`
  - Pages config with commented D1/Queue producer binding template.

## Initial Feature Scope

Background mode is planner-only and intentionally excludes browser-only features:

- reference images
- precise/vibe transfer images
- inpaint
- server-side WebP conversion

Use browser mode for those workflows until the server-side image preprocessing path is added.
