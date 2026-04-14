import { Hono } from 'hono';
import { PipedreamClient } from '@pipedream/sdk/server';
import { HashbrownAzure } from '@hashbrownai/azure';
import type { Chat } from '@hashbrownai/core';
import type { ENV_VARS } from './env-vars';
import { configureCors } from './utils/util-cors';

const app = new Hono<{ Bindings: ENV_VARS }>();

app.use('*', configureCors());

function createPipedreamClient(env: ENV_VARS) {
  return new PipedreamClient({
    projectId: env.PIPEDREAM_PROJECT_ID,
    projectEnvironment: (env.PIPEDREAM_PROJECT_ENVIRONMENT ?? 'development') as
      | 'development'
      | 'production',
    clientId: env.PIPEDREAM_CLIENT_ID,
    clientSecret: env.PIPEDREAM_CLIENT_SECRET,
  });
}

async function pdMcpHeaders(
  pd: PipedreamClient,
  env: ENV_VARS,
  externalUserId: string,
  extra: Record<string, string> = {},
): Promise<Record<string, string>> {
  const accessToken = await (pd as any).rawAccessToken;
  return {
    Accept: 'application/json, text/event-stream',
    Authorization: `Bearer ${accessToken}`,
    'x-pd-project-id': env.PIPEDREAM_PROJECT_ID,
    'x-pd-environment': env.PIPEDREAM_PROJECT_ENVIRONMENT ?? 'development',
    'x-pd-external-user-id': externalUserId,
    'x-pd-tool-mode': 'full-config',
    'x-pd-app-discovery': 'true',
    ...extra,
  };
}

// Health check
app.get('/api', (c) => {
  return c.json({ message: 'API is running' });
});

// Mint a Pipedream connect token for a given external user
app.post('/api/pipedream/token', async (c) => {
  const { externalUserId } = await c.req.json();

  if (!externalUserId || typeof externalUserId !== 'string') {
    return c.json({ error: 'externalUserId is required' }, 400);
  }

  const pd = createPipedreamClient(c.env);

  try {
    const tokenResponse = await pd.tokens.create({
      externalUserId,
      allowedOrigins: [c.req.header('origin') || '*'],
    });
    return c.json(tokenResponse);
  } catch (err) {
    console.error('Failed to create Pipedream token:', err);
    return c.json({ error: 'Failed to create token' }, 500);
  }
});

// ── Hashbrown chat endpoint (LLM proxy) ────────────────────────────────────

app.post('/api/chat', async (c) => {
  const { AZURE_OPENAI_API_KEY, AZURE_OPENAI_ENDPOINT } = c.env;

  if (!AZURE_OPENAI_API_KEY || !AZURE_OPENAI_ENDPOINT) {
    return c.json(
      { error: 'AZURE_OPENAI_API_KEY / AZURE_OPENAI_ENDPOINT not configured' },
      500,
    );
  }

  const completionParams =
    (await c.req.json()) as Chat.Api.CompletionCreateParams;

  const response = HashbrownAzure.stream.text({
    apiKey: AZURE_OPENAI_API_KEY,
    endpoint: AZURE_OPENAI_ENDPOINT,
    request: completionParams as any,
  });

  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of response) {
          controller.enqueue(chunk);
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'application/octet-stream' },
  });
});

// ── MCP proxy to Pipedream ─────────────────────────────────────────────────

app.post('/api/mcp', async (c) => {
  const externalUserId = c.req.query('externalUserId');
  if (!externalUserId) {
    return c.json({ error: 'externalUserId query parameter required' }, 400);
  }

  const sessionId = c.req.header('mcp-session-id');
  const chatId = c.req.header('x-pd-mcp-chat-id');

  try {
    const pd = createPipedreamClient(c.env);
    const mcpTargetUrl =
      c.env.MCP_SERVER ?? 'https://remote.mcp.pipedream.net';

    const extra: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (sessionId) extra['Mcp-Session-Id'] = sessionId;
    if (chatId) extra['x-pd-mcp-chat-id'] = chatId;

    const headers = await pdMcpHeaders(pd, c.env, externalUserId, extra);

    const upstream = await fetch(mcpTargetUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(await c.req.json()),
    });

    const responseHeaders = new Headers();

    const upstreamSessionId = upstream.headers.get('Mcp-Session-Id');
    if (upstreamSessionId)
      responseHeaders.set('Mcp-Session-Id', upstreamSessionId);

    const contentType = upstream.headers.get('Content-Type');
    if (contentType) responseHeaders.set('Content-Type', contentType);

    if (contentType?.includes('text/event-stream') && upstream.body) {
      return new Response(upstream.body, {
        status: upstream.status,
        headers: responseHeaders,
      });
    }

    const body = await upstream.text();
    return new Response(body, {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch (err) {
    console.error('MCP proxy error:', err);
    return c.json({ error: 'MCP proxy request failed' }, 502);
  }
});

// GET /api/mcp — The Pipedream MCP server is stateless and does not support
// server-initiated SSE streams. Return 405 so the SDK client stops retrying.
app.get('/api/mcp', (c) => {
  return c.json({ error: 'SSE stream not supported by this MCP server' }, 405);
});

app.delete('/api/mcp', async (c) => {
  const externalUserId = c.req.query('externalUserId');
  if (!externalUserId) {
    return c.json({ error: 'externalUserId query parameter required' }, 400);
  }

  const sessionId = c.req.header('mcp-session-id');
  const chatId = c.req.header('x-pd-mcp-chat-id');

  try {
    const pd = createPipedreamClient(c.env);
    const mcpTargetUrl =
      c.env.MCP_SERVER ?? 'https://remote.mcp.pipedream.net';

    const extra: Record<string, string> = {};
    if (sessionId) extra['Mcp-Session-Id'] = sessionId;
    if (chatId) extra['x-pd-mcp-chat-id'] = chatId;

    const headers = await pdMcpHeaders(pd, c.env, externalUserId, extra);

    const upstream = await fetch(mcpTargetUrl, { method: 'DELETE', headers });
    return new Response(null, { status: upstream.status });
  } catch (err) {
    console.error('MCP proxy error:', err);
    return c.json({ error: 'MCP proxy cleanup failed' }, 502);
  }
});

export default app;
