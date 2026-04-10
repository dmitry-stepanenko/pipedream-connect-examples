# PLAN-01 — API: Pipedream Token Endpoint

## Goal

Add a `POST /api/pipedream/token` endpoint to the Express API app. This is the only backend piece the Angular app needs: it mints a short-lived Pipedream auth token for a given `externalUserId` using your project credentials (which must never reach the browser).

## Context

- API app: `poc/apps/api/src/main.ts` — minimal Express server, listens on port 3333
- Workspace root: `poc/package.json` — `@pipedream/sdk` is NOT yet installed
- Angular dev server runs on port 4200 — CORS must allow this origin
- Node target uses CommonJS (`tsconfig.app.json` has `"module": "commonjs"`)

## Prerequisites

None — this is the first plan.

## Step 1 — Install dependencies

From `poc/` directory:

```bash
npm install @pipedream/sdk dotenv cors
npm install --save-dev @types/cors
```

## Step 2 — Create `.env` file

Create `poc/apps/api/.env` (this file must NOT be committed — add to `.gitignore`):

```
PIPEDREAM_CLIENT_ID=your_client_id_here
PIPEDREAM_CLIENT_SECRET=your_client_secret_here
PIPEDREAM_PROJECT_ID=your_project_id_here
PIPEDREAM_PROJECT_ENVIRONMENT=development
PORT=3333
ALLOWED_ORIGIN=http://localhost:4200
```

Also create `poc/apps/api/.env.example` (committed, no real values):

```
PIPEDREAM_CLIENT_ID=
PIPEDREAM_CLIENT_SECRET=
PIPEDREAM_PROJECT_ID=
PIPEDREAM_PROJECT_ENVIRONMENT=development
PORT=3333
ALLOWED_ORIGIN=http://localhost:4200
```

Add `.env` to `poc/.gitignore` if not already present:

```
apps/api/.env
```

## Step 3 — Update `poc/apps/api/src/main.ts`

Replace the existing `main.ts` with:

```typescript
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import * as path from 'path';
import { createBackendClient } from '@pipedream/sdk/server';

const {
  PIPEDREAM_CLIENT_ID,
  PIPEDREAM_CLIENT_SECRET,
  PIPEDREAM_PROJECT_ID,
  PIPEDREAM_PROJECT_ENVIRONMENT = 'development',
  PORT = '3333',
  ALLOWED_ORIGIN = 'http://localhost:4200',
} = process.env;

if (!PIPEDREAM_CLIENT_ID || !PIPEDREAM_CLIENT_SECRET || !PIPEDREAM_PROJECT_ID) {
  console.error('Missing required Pipedream environment variables.');
  process.exit(1);
}

const pd = createBackendClient({
  projectId: PIPEDREAM_PROJECT_ID,
  environment: PIPEDREAM_PROJECT_ENVIRONMENT as 'development' | 'production',
  credentials: {
    clientId: PIPEDREAM_CLIENT_ID,
    clientSecret: PIPEDREAM_CLIENT_SECRET,
  },
});

const app = express();

app.use(cors({ origin: ALLOWED_ORIGIN }));
app.use(express.json());
app.use('/assets', express.static(path.join(__dirname, 'assets')));

// Health check
app.get('/api', (_req, res) => {
  res.send({ message: 'API is running' });
});

// Mint a Pipedream connect token for a given external user
app.post('/api/pipedream/token', async (req, res) => {
  const { externalUserId } = req.body;

  if (!externalUserId || typeof externalUserId !== 'string') {
    res.status(400).json({ error: 'externalUserId is required' });
    return;
  }

  try {
    const tokenResponse = await pd.tokens.create({
      externalUserId,
      allowedOrigins: [ALLOWED_ORIGIN],
    });
    res.json(tokenResponse);
  } catch (err: unknown) {
    console.error('Failed to create Pipedream token:', err);
    res.status(500).json({ error: 'Failed to create token' });
  }
});

const port = parseInt(PORT, 10);
const server = app.listen(port, () => {
  console.log(`API listening at http://localhost:${port}`);
});
server.on('error', console.error);
```

## Step 4 — Verify `@pipedream/sdk` server import

The `@pipedream/sdk` package exports two entry points:
- `@pipedream/sdk/browser` — for Angular/browser use
- `@pipedream/sdk/server` — for Node.js (uses `createBackendClient`)

If `@pipedream/sdk/server` does not resolve, check the SDK's `package.json` exports field and adjust the import to match. As a fallback:
```typescript
import { PipedreamClient } from '@pipedream/sdk';
const pd = new PipedreamClient({ ... });
```

## Step 5 — Run and test

```bash
# From poc/
npx nx serve api

# Test in another terminal:
curl -X POST http://localhost:3333/api/pipedream/token \
  -H "Content-Type: application/json" \
  -d '{"externalUserId": "test-user-1"}'
# Should return: { token: "...", expires_at: "..." }
```

## Files Modified / Created

| File | Action |
|------|--------|
| `poc/apps/api/src/main.ts` | Replace |
| `poc/apps/api/.env` | Create (not committed) |
| `poc/apps/api/.env.example` | Create |
| `poc/.gitignore` | Add `.env` entry |
| `poc/package.json` | Added `@pipedream/sdk`, `dotenv`, `cors`, `@types/cors` |

## Notes

- Pipedream credentials are obtained from your project at pipedream.com → Settings → Projects → your project → OAuth clients
- The `externalUserId` is any string that uniquely identifies your app's user (e.g. their database ID)
- Tokens expire (typically 1 hour); the Angular `PipedreamClientService` (PLAN-02) handles refresh by calling this endpoint again
