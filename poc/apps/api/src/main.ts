import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import * as path from 'path';
import { PipedreamClient } from '@pipedream/sdk/server';
import { HashbrownAzure } from '@hashbrownai/azure';
import type { Chat } from '@hashbrownai/core';

const {
  PIPEDREAM_CLIENT_ID,
  PIPEDREAM_CLIENT_SECRET,
  PIPEDREAM_PROJECT_ID,
  PIPEDREAM_PROJECT_ENVIRONMENT = 'development',
  PORT = '3333',
  ALLOWED_ORIGIN = 'http://localhost:4200',
  AZURE_OPENAI_API_KEY,
  AZURE_OPENAI_ENDPOINT,
} = process.env;

if (!PIPEDREAM_CLIENT_ID || !PIPEDREAM_CLIENT_SECRET || !PIPEDREAM_PROJECT_ID) {
  console.error('Missing required Pipedream environment variables.');
  process.exit(1);
}

const pd = new PipedreamClient({
  projectId: PIPEDREAM_PROJECT_ID,
  projectEnvironment: PIPEDREAM_PROJECT_ENVIRONMENT as 'development' | 'production',
  clientId: PIPEDREAM_CLIENT_ID,
  clientSecret: PIPEDREAM_CLIENT_SECRET,
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

// ── Hashbrown chat endpoint (LLM proxy) ────────────────────────────────────

app.post('/api/chat', async (req, res) => {
  if (!AZURE_OPENAI_API_KEY || !AZURE_OPENAI_ENDPOINT) {
    res.status(500).json({ error: 'AZURE_OPENAI_API_KEY / AZURE_OPENAI_ENDPOINT not configured' });
    return;
  }

  const completionParams = req.body as Chat.Api.CompletionCreateParams;

  const response = HashbrownAzure.stream.text({
    apiKey: AZURE_OPENAI_API_KEY,
    endpoint: AZURE_OPENAI_ENDPOINT,
    request: completionParams as any,
  });

  res.header('Content-Type', 'application/octet-stream');

  for await (const chunk of response) {
    res.write(chunk);
  }

  res.end();
});

// ── MCP proxy to Pipedream ─────────────────────────────────────────────────

const MCP_TARGET_URL = process.env.MCP_SERVER ?? 'https://remote.mcp.pipedream.net';

async function pdMcpHeaders(
  externalUserId: string,
  extra: Record<string, string> = {},
): Promise<Record<string, string>> {
  const accessToken = await (pd as any).rawAccessToken;
  return {
    Accept: 'application/json, text/event-stream',
    Authorization: `Bearer ${accessToken}`,
    'x-pd-project-id': PIPEDREAM_PROJECT_ID!,
    'x-pd-environment': PIPEDREAM_PROJECT_ENVIRONMENT,
    'x-pd-external-user-id': externalUserId,
    'x-pd-tool-mode': 'full-config',
    'x-pd-app-discovery': 'true',
    ...extra,
  };
}

app.post('/api/mcp', async (req, res) => {
  const externalUserId = req.query.externalUserId as string;
  if (!externalUserId) {
    res.status(400).json({ error: 'externalUserId query parameter required' });
    return;
  }

  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  const conversationId = req.headers['x-pd-conversation-id'] as string | undefined;

  try {
    const extra: Record<string, string> = { 'Content-Type': 'application/json' };
    if (sessionId) extra['Mcp-Session-Id'] = sessionId;
    if (conversationId) extra['x-pd-conversation-id'] = conversationId;

    const headers = await pdMcpHeaders(externalUserId, extra);

    const upstream = await fetch(MCP_TARGET_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(req.body),
    });

    const upstreamSessionId = upstream.headers.get('Mcp-Session-Id');
    if (upstreamSessionId) res.setHeader('Mcp-Session-Id', upstreamSessionId);

    const contentType = upstream.headers.get('Content-Type');
    if (contentType) res.setHeader('Content-Type', contentType);

    res.status(upstream.status);

    if (contentType?.includes('text/event-stream') && upstream.body) {
      const reader = (upstream.body as ReadableStream<Uint8Array>).getReader();
      const flush = () => { if (typeof (res as any).flush === 'function') (res as any).flush(); };
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
        flush();
      }
      res.end();
    } else {
      const body = await upstream.text();
      res.send(body);
    }
  } catch (err) {
    console.error('MCP proxy error:', err);
    res.status(502).json({ error: 'MCP proxy request failed' });
  }
});

// GET /api/mcp — The Pipedream MCP server is stateless and does not support
// server-initiated SSE streams. Return 405 so the SDK client stops retrying.
app.get('/api/mcp', (_req, res) => {
  res.status(405).json({ error: 'SSE stream not supported by this MCP server' });
});

app.delete('/api/mcp', async (req, res) => {
  const externalUserId = req.query.externalUserId as string;
  if (!externalUserId) {
    res.status(400).json({ error: 'externalUserId query parameter required' });
    return;
  }

  const sessionId = req.headers['mcp-session-id'] as string;
  const conversationId = req.headers['x-pd-conversation-id'] as string | undefined;

  try {
    const extra: Record<string, string> = {};
    if (sessionId) extra['Mcp-Session-Id'] = sessionId;
    if (conversationId) extra['x-pd-conversation-id'] = conversationId;

    const headers = await pdMcpHeaders(externalUserId, extra);

    const upstream = await fetch(MCP_TARGET_URL, { method: 'DELETE', headers });
    res.sendStatus(upstream.status);
  } catch (err) {
    console.error('MCP proxy error:', err);
    res.status(502).json({ error: 'MCP proxy cleanup failed' });
  }
});

// ── Start server ───────────────────────────────────────────────────────────

const port = parseInt(PORT, 10);
const server = app.listen(port, () => {
  console.log(`API listening at http://localhost:${port}`);
});
server.on('error', console.error);
