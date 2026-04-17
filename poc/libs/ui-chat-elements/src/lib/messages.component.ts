import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  Injector,
  input,
  output,
  viewChild,
} from '@angular/core';
import type { UiAssistantMessage, UiChatMessage } from '@hashbrownai/angular';
import type { Chat } from '@hashbrownai/core';

import { MatButtonModule } from '@angular/material/button';

import { CosRenderMessageComponent } from './render-message.component';
import { ToolChipComponent } from './tool-chip.component';

export interface ChatToolMetadata {
  [toolName: string]: {
    i18n: {
      pending: string;
      done: string;
    };
  };
}

@Component({
  selector: 'esp-ai-assistant-chat-loading-indicator',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="loader">
    <span></span> <span></span> <span></span>
  </div>`,
  styles: [
    `
      .loader {
        --animationTime: 0.8s;
        --dotSize: 0.75rem;
      }
      .loader span {
        display: inline-block;
        vertical-align: middle;
        width: var(--dotSize);
        height: var(--dotSize);
        background: #6366f1;
        border-radius: var(--dotSize);
        animation: loader var(--animationTime) infinite alternate;
        margin: 1rem 0;
      }
      .loader span:nth-of-type(2) {
        animation-delay: 0.2s;
      }
      .loader span:nth-of-type(3) {
        animation-delay: 0.6s;
      }
      @keyframes loader {
        0% {
          opacity: 0.9;
          transform: scale(0.5);
        }
        100% {
          opacity: 0.1;
          transform: scale(1);
        }
      }
    `,
  ],
})
class AiAssistantChatLoadingComponent {}

@Component({
  selector: 'esp-hb-ai-assistant-chat-messages',
  imports: [
    CosRenderMessageComponent,
    MatButtonModule,
    ToolChipComponent,
    AiAssistantChatLoadingComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-content select="[attachedContent]" />

    @for (message of collapsedMessages(); track $index) {
      @switch (message.role) {
        @case ('user') {
          <div class="chat-message user">
            <p>{{ message.content }}</p>
          </div>
        }
        @case ('assistant') {
          <div
            class="chat-message assistant"
            [class.hasToolCalls]="message.toolCalls.length > 0"
          >
            <div class="assistant-avatar">
              <i class="fa-solid fa-user text-gray-400"></i>
            </div>
            <div class="assistant-tools">
              @for (toolCall of message.toolCalls; track $index) {
                @if (toolMetadata()?.[toolCall.name]?.i18n; as toolI18n) {
                  <esp-ai-assistant-tool-chip
                    [toolCall]="toolCall"
                    [pending]="toolI18n.pending"
                    [done]="toolI18n.done"
                  />
                } @else {
                  <esp-ai-assistant-tool-chip
                    [toolCall]="toolCall"
                    [pending]="'Running ' + toolCall.name"
                    [done]="'Ran ' + toolCall.name"
                  />
                }
              }
            </div>

            @if (message.content) {
              <cos-hb-render-message
                [message]="message"
                [messageIndex]="$index"
              />
            }
          </div>
        }
        @case ('error') {
          <div class="chat-message msg-error">
            <i class="fa-solid fa-triangle-exclamation text-red-500"></i>
            <span>{{ message.content }}</span>
            @if ($last) {
              <button mat-button (click)="retry.emit()">Retry</button>
            }
          </div>
        }
      }
    }
    @if (messageLoading()) {
      <esp-ai-assistant-chat-loading-indicator />
    }
  `,
  styles: [
    `
      :host {
        display: flex;
        flex-direction: column;
        padding: 0 1rem;
        margin-top: 1rem;
        gap: 1rem;
      }

      .chat-message {
        margin-bottom: 0.5rem;
      }

      .chat-message p:last-child {
        margin-bottom: 0;
      }

      .chat-message.user {
        padding: 0.5rem 1rem;
        border-radius: 1rem;
        width: 80%;
        background-color: #e0e7ff;
        align-self: flex-end;
        white-space: pre-wrap;
      }

      .chat-message.assistant {
        display: grid;
        width: 100%;
        grid-template-columns: 24px 1fr;
        grid-template-rows: auto auto;
        grid-template-areas:
          'avatar content'
          'blank content';
        column-gap: 1rem;
      }

      .chat-message.assistant.hasToolCalls {
        row-gap: 8px;
        grid-template-areas:
          'avatar tools'
          'blank content';
      }

      esp-ai-assistant-chat-loading-indicator {
        margin-left: 24px;
      }

      .assistant-avatar {
        grid-area: avatar;
        display: flex;
      }

      .assistant-avatar img {
        width: 24px;
        height: 24px;
        border-radius: 8px;
      }

      .assistant-tools {
        grid-area: tools;
        display: flex;
        flex-direction: row;
        flex-wrap: wrap;
        gap: 8px;
      }

      cos-hb-render-message {
        grid-area: content;
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }

      .chat-message.component {
        align-self: flex-start;
        width: 100%;
      }

      .chat-message.tool {
        align-self: flex-start;
        width: 100%;
        font-style: italic;
      }

      .chat-message.msg-error {
        padding: 1rem;
        border-radius: 1rem;
        width: 80%;
        background-color: #fee2e2;
        align-self: flex-start;
        margin-top: 1rem;
        display: flex;
        align-items: center;
        gap: 1rem;
      }

      .chat-message.msg-error span {
        width: 100%;
      }

      .chat-message.msg-error mat-icon {
        width: 32px !important;
      }

      .chat-message.msg-error .mat-mdc-button {
        align-self: flex-end;
        height: 1rem;
      }
    `,
  ],
})
export class MessagesComponent {
  readonly retry = output<void>();
  readonly messages = input.required<UiChatMessage<Chat.AnyTool>[]>();
  readonly messageLoading = input.required<boolean>();
  readonly toolMetadata = input<ChatToolMetadata>();

  private readonly _elementRef = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly collapsedMessages = computed(() => {
    const messages = this.messages();
    const collapsedMessages = [];
    let assistantMessageStack: UiAssistantMessage[] = [];

    for (const message of messages) {
      if (
        !message.content &&
        !(message as UiAssistantMessage).toolCalls?.length
      ) {
        // skip empty messages
        continue;
      }

      if (message.role === 'assistant' && message.toolCalls.length > 0) {
        assistantMessageStack.push(message);
      } else if (
        message.role === 'assistant' &&
        message.toolCalls.length === 0
      ) {
        assistantMessageStack.push(message);

        collapsedMessages.push(
          this.collapseAssistantMessageStack(assistantMessageStack),
        );
        assistantMessageStack = [];
      } else {
        collapsedMessages.push(message);
      }
    }

    if (assistantMessageStack.length > 0) {
      collapsedMessages.push(
        this.collapseAssistantMessageStack(assistantMessageStack),
      );
    }

    return collapsedMessages;
  });

  constructor() {
    effect(() => {
      if (this.messages().length) {
        const el = this._elementRef.nativeElement;
        requestAnimationFrame(() => {
          el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
        });
      }
    });
  }

  collapseAssistantMessageStack(assistantMessageStack: UiAssistantMessage[]) {
    const [firstMessage, ...rest] = assistantMessageStack;
    return rest.reduce((acc: UiAssistantMessage, message) => {
      return {
        ...acc,
        ...message,
        toolCalls: [...acc.toolCalls, ...message.toolCalls],
      };
    }, firstMessage);
  }
}
