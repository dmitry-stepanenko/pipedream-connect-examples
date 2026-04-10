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
