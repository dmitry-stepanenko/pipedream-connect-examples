import {
  effect,
  inject,
  Injectable,
  Injector,
  runInInjectionContext,
  signal,
} from '@angular/core';
import { structuredCompletionResource } from '@hashbrownai/angular';
import { createHttpTransport } from '@hashbrownai/core';
import type { s, TransportOrFactory } from '@hashbrownai/core';
import { ChatProviderService } from './chat-provider.service';

export interface AiStructuredCompletionOptions<
  Input,
  Schema extends s.HashbrownType,
> {
  /** System prompt guiding the structured completion. */
  system: string;
  /** Input data sent alongside the system prompt. */
  input: Input;
  /** Hashbrown schema describing the expected output shape. */
  schema: Schema;
  /**
   * Optional transport override. Defaults to the active provider's baseUrl.
   */
  transport?: TransportOrFactory;
  /** Optional label shown in hashbrown debug tooling. */
  debugName?: string;
}

/**
 * Generic service for one-shot structured LLM completions.
 *
 * Wraps `structuredCompletionResource` into an imperative Promise API so it
 * can be called from tool handlers (or any non-reactive context).
 * Each `complete()` call creates an isolated child injector that is destroyed
 * once the completion settles, preventing resource/effect leaks.
 */
@Injectable({ providedIn: 'root' })
export class AiStructuredCompletionService {
  private readonly _injector = inject(Injector);
  private readonly _providerService = inject(ChatProviderService);

  complete<Input, Schema extends s.HashbrownType>(
    options: AiStructuredCompletionOptions<Input, Schema>
  ): Promise<s.Infer<Schema>> {
    const provider = this._providerService.active();
    const transport = options.transport ?? createHttpTransport({ baseUrl: provider.baseUrl });
    const model = provider.smallModel;

    return new Promise<s.Infer<Schema>>((resolve, reject) => {
      // Create a child injector scoped to this single completion so that the
      // resource and the watcher effect are cleaned up when we destroy it.
      const child = Injector.create({ providers: [], parent: this._injector });

      const settle = (fn: () => void) => {
        fn();
        child.destroy();
      };

      runInInjectionContext(child, () => {
        const inputSignal = signal<Input | null>(options.input);

        const resource = structuredCompletionResource({
          input: inputSignal,
          model,
          transport,
          system: options.system,
          schema: options.schema,
          ...(options.debugName ? { debugName: options.debugName } : {}),
        });

        effect(() => {
          if (resource.isLoading()) return;

          const sendingError = resource.sendingError();
          const generatingError = resource.generatingError();
          const err = sendingError ?? generatingError;
          if (err) {
            settle(() => reject(err));
            return;
          }

          const value = resource.value();
          if (value !== null && value !== undefined) {
            settle(() => resolve(value as s.Infer<Schema>));
          }
        });
      });
    });
  }
}
