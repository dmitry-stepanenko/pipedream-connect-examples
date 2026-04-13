import { inject, Injectable, Injector, runInInjectionContext, signal } from '@angular/core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Chat } from '@hashbrownai/core';
import { createTool } from '@hashbrownai/angular';
import { PIPEDREAM_CONFIG } from '../tokens/pipedream-config.token';

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

    const { tools: mcpTools } = await this.client.listTools();

    const tools = mcpTools.map((tool) => {
      return runInInjectionContext(this.injector, () => {
        return createTool({
          name: tool.name,
          description: tool.description ?? '',
          schema: {
            ...tool.inputSchema,
            additionalProperties: false,
            ...(tool.inputSchema.required
              ? { required: tool.inputSchema.required }
              : {}),
          },
          handler: async (input) => {
            const result = await this.client?.callTool({
              name: tool.name,
              arguments: input,
            });
            return result;
          },
        });
      });
    });

    this.tools.set(tools);
    this.connected.set(true);
  }

  async disconnect() {
    if (this.client) {
      await this.client.close();
      this.client = undefined;
      this.connected.set(false);
      this.tools.set([]);
    }
  }
}
