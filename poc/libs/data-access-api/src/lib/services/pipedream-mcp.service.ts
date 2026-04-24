import { inject, Injectable, Injector, runInInjectionContext, signal } from '@angular/core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Chat } from '@hashbrownai/core';
import { createTool } from '@hashbrownai/angular';
import { PIPEDREAM_CONFIG } from '@poc/connect-angular';

const TOOL_TIMEOUT_MS = 180_000; // 3 minutes, matching Pipedream reference

// OpenAI strict mode rejects $schema and open-dictionary object properties
// (type=object with no sub-properties). Strip both; the remaining MCP schemas
// are already strict-compliant (they include additionalProperties:false and required).
function cleanMcpSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const { properties, ...rest } = schema as Record<string, unknown> & { properties?: Record<string, Record<string, unknown>> };
  delete rest['$schema'];

  if (!properties) return rest;

  const cleanedProps = Object.fromEntries(
    Object.entries(properties).filter(([, prop]) => !(prop['type'] === 'object' && !prop['properties'])),
  );

  return { ...rest, properties: cleanedProps };
}

@Injectable({ providedIn: 'root' })
export class PipedreamMcpService {
  private readonly config = inject(PIPEDREAM_CONFIG);
  private readonly injector = inject(Injector);
  private client?: Client;
  private chatId: string = crypto.randomUUID();

  readonly connected = signal(false);
  readonly tools = signal<Chat.AnyTool[]>([]);

  async connect(chatId?: string) {
    if (chatId) this.chatId = chatId;

    this.client = new Client({
      name: 'pipedream',
      version: '1.0.0',
    });

    const apiBase = this.config.tokenEndpointUrl.replace('/api/pipedream/token', '');
    const mcpUrl = new URL(
      `${apiBase}/api/mcp?externalUserId=${encodeURIComponent(this.config.externalUserId)}`,
    );

    await this.client.connect(new StreamableHTTPClientTransport(mcpUrl, {
      requestInit: {
        headers: {
          'x-pd-mcp-chat-id': this.chatId,
        },
      },
    }));

    await this.refreshTools();
    this.connected.set(true);
  }

  /**
   * Re-fetches the tool list from the MCP server and updates the tools signal.
   * Called after initial connection and after each tool execution, because
   * Pipedream MCP dynamically adds/removes tools based on the conversation state
   * (e.g. WHAT_ARE_YOU_TRYING_TO_DO → SELECT_APPS → begin_configuration_* → run_*).
   */
  async refreshTools(): Promise<void> {
    if (!this.client) return;

    const { tools: mcpTools } = await this.client.listTools();
    console.log(JSON.parse(JSON.stringify({mcpTools})));

    const tools = mcpTools.map((tool) => {
      return runInInjectionContext(this.injector, () => {
        return createTool({
          name: tool.name,
          description: tool.description ?? '',
          schema: cleanMcpSchema(tool.inputSchema),
          handler: async (input) => {
            const result = await this.executeTool(tool.name, input);
            // Refresh tools after each call — Pipedream MCP changes available
            // tools based on conversation state (e.g. after SELECT_APPS,
            // new begin_configuration_* tools appear).
            await this.refreshTools();
            return result;
          },
        });
      });
    });

    this.tools.set(tools);
  }

  async disconnect() {
    if (this.client) {
      await this.client.close();
      this.client = undefined;
      this.connected.set(false);
      this.tools.set([]);
    }
  }

  private async executeTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (!this.client) {
      throw new Error('MCP client not connected');
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TOOL_TIMEOUT_MS);

    try {
      const result = await this.client.callTool({ name, arguments: args });
      return result;
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(`Tool "${name}" timed out after ${TOOL_TIMEOUT_MS / 1000}s`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
