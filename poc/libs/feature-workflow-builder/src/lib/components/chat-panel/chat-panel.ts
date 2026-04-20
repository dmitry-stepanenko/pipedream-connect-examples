import {
  AfterViewInit,
  Component,
  computed,
  effect,
  inject,
  Injector,
  signal,
  untracked,
  type WritableSignal,
} from '@angular/core';
import { type UiChatResourceRef } from '@hashbrownai/angular';
import { type Chat } from '@hashbrownai/core';
import { PipedreamMcpService, WorkflowService } from '@poc/data-access-api';
import { PipedreamClientService, CUSTOM_TRIGGERS } from '@poc/connect-angular';
import { AiStructuredCompletionService } from '@poc/data-access-structured-completion';
import { provideMarkdown } from 'ngx-markdown';
import {
  ComposerComponent,
  MessagesComponent,
  type ChatToolMetadata,
} from '@poc/ui-chat-elements';
import { CHAT_SEND_MESSAGE } from './connect-app.component';
import { AIChatDefinition } from './chat-definition';

// ── Main chat panel ─────────────────────────────────────────────────────────

@Component({
  selector: 'pd-chat-panel',
  standalone: true,
  imports: [MessagesComponent, ComposerComponent],
  providers: [
    provideMarkdown(),
    {
      provide: CHAT_SEND_MESSAGE,
      useFactory: () => {
        const panel = inject(ChatPanelComponent);
        return (message: string) => panel.sendMessage(message);
      },
    },
  ],
  template: `
    <div class="pd-chat-panel">
      <div class="pd-chat-messages">
        <esp-hb-ai-assistant-chat-messages
          class="max-h-full overflow-auto"
          [toolMetadata]="toolMetadata()"
          [messages]="$any(chat().value())"
          [messageLoading]="chat().isLoading()"
          (retry)="retryMessages()"
        />
      </div>

      <div class="pd-chat-input-row">
        <esp-ai-assistant-composer
          class="w-full"
          [loading]="chat().isLoading()"
          (sendMessage)="sendMessage($event)"
          (stopChat)="stopChat()"
        />
      </div>
    </div>
  `,
  styleUrl: './chat-panel.css',
})
export class ChatPanelComponent implements AfterViewInit {
  private readonly injector = inject(Injector);
  private readonly mcpService = inject(PipedreamMcpService);
  private readonly pdClient = inject(PipedreamClientService);
  private readonly workflowService = inject(WorkflowService);
  private readonly customTriggers = inject(CUSTOM_TRIGGERS);
  private readonly completionService = inject(AiStructuredCompletionService);

  readonly toolMetadata = computed<ChatToolMetadata>(() => ({
    create_workflow: {
      i18n: {
        pending: 'Creating workflow: {{ name }}',
        done: 'Created workflow: {{ name }}',
      },
    },
    add_workflow_step: {
      i18n: {
        pending: 'Adding step: {{ stepName }}',
        done: 'Added step: {{ stepName }}',
      },
    },
    configure_step: {
      i18n: {
        pending: 'Configuring step: {{ appName }}',
        done: 'Configured step: {{ appName }}',
      },
    },
    set_step_props: {
      i18n: { pending: 'Setting properties', done: 'Set properties' },
    },
    list_app_components: {
      i18n: {
        pending: 'Listing components: {{ appName }}',
        done: 'Listed components: {{ appName }}',
      },
    },
    list_custom_triggers: {
      i18n: { pending: 'Listing triggers', done: 'Listed triggers' },
    },
    get_active_workflow: {
      i18n: { pending: 'Fetching workflow', done: 'Fetched workflow' },
    },
    update_workflow_name: {
      i18n: {
        pending: 'Renaming workflow: {{ name }}',
        done: 'Renamed workflow: {{ name }}',
      },
    },
    remove_workflow_step: {
      i18n: {
        pending: 'Removing step: {{ stepName }}',
        done: 'Removed step: {{ stepName }}',
      },
    },
    test_step: {
      i18n: {
        pending: 'Testing step: {{ stepName }}',
        done: 'Tested step: {{ stepName }}',
      },
    },
    review_workflow: {
      i18n: {
        pending: 'Reviewing workflow…',
        done: 'Reviewed workflow',
      },
    },
    get_prop_options: {
      i18n: {
        pending: 'Fetching options for {{ stepName }}…',
        done: 'Fetched options for {{ stepName }}',
      },
    },
  }));

  // Chat is a writable signal so we can recreate it when MCP tools change.
  // Pipedream MCP dynamically adds/removes tools based on conversation state
  // (e.g. WHAT_ARE_YOU_TRYING_TO_DO → SELECT_APPS → begin_configuration_*),
  // so the chat resource must be recreated to pick up new tools.
  readonly chat: WritableSignal<UiChatResourceRef<any>>;
  private readonly _chatDefinition = new AIChatDefinition();

  private pendingToolRefresh = false;

  constructor() {
    // Initialize the chat (runs in constructor = injection context is available)
    this.chat = signal(this._chatDefinition.initChat());

    // Watch for MCP tool changes — reset chat with updated tools.
    // Skip the first emission (initial tool load is already captured by initChat).
    let firstSkipped = false;
    effect(() => {
      this.mcpService.tools();
      if (!firstSkipped) {
        firstSkipped = true;
        return;
      }
      untracked(() => {
        if (this.chat().isLoading()) {
          // Can't reset mid-generation — defer until the loop finishes.
          this.pendingToolRefresh = true;
        } else {
          this.resetChat({ messages: this.chat().value() });
        }
      });
    });

    // When loading finishes with a pending tool refresh, apply it.
    effect(() => {
      const loading = this.chat().isLoading();
      if (!loading && this.pendingToolRefresh) {
        untracked(() => {
          this.pendingToolRefresh = false;
          this.resetChat({
            messages: this.chat().value(),
            resend: true,
          });
        });
      }
    });
  }

  private resetChat(options?: {
    messages?: Chat.Message<any, any>[];
    resend?: boolean;
  }) {
    const current = this.chat();
    if (current) this._stopChatInternal(current);
    this.chat.set(this._chatDefinition.initChat(options?.messages));
    if (options?.resend) {
      this.chat().resendMessages();
    }
  }

  private async _stopChatInternal(chat: UiChatResourceRef<any>) {
    // Retry stop() — hashbrown may throw if it's mid-generation
    for (let attempt = 0; attempt < 200; attempt++) {
      try {
        chat.stop();
        break;
      } catch {
        await new Promise((res) => setTimeout(res, 50));
      }
    }
  }

  // ── Public API ──────────────────────────────────────────────────────────

  ngAfterViewInit() {
    this.mcpService.connect();
  }

  stopChat() {
    const chat = this.chat();

    if (!chat) return;

    try {
      chat.stop();

      /** If stop doesn't throw, it means we have pending messages */

      const messages = chat.value();

      const lastUserIndex = messages.map((m) => m.role).lastIndexOf('user');

      // Keep only messages up to the last user message
      const trimmedMessages = messages.slice(0, lastUserIndex + 1);

      this.resetChat({
        messages: [
          ...trimmedMessages,

          /**
           * We need a fake message otherwise the agent will still take the user messsage into consideration.
           */
          { role: 'assistant', content: '', toolCalls: [] },
        ],
      });
    } catch {}
  }

  sendMessage(message: string) {
    this.chat().sendMessage({ role: 'user', content: message });
  }

  retryMessages() {
    this.chat().resendMessages();
  }
}
