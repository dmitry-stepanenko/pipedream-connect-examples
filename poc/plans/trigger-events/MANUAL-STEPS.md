# Manual Steps — Wrangler / D1

Run these commands from `apps/api/` (where `wrangler.jsonc` lives).

## After Phase 01 — Apply trigger_events migration

```bash
cd apps/api

# Local dev database
npx wrangler d1 migrations apply workflows-db --local

# Remote (production) — run when deploying
npx wrangler d1 migrations apply workflows-db --remote
```

This creates the `trigger_events` table and its index.
