import {
  effect,
  inject,
  Injectable,
  Injector,
  runInInjectionContext,
  signal,
} from '@angular/core';
import { structuredCompletionResource } from '@hashbrownai/angular';
import type { s, TransportOrFactory } from '@hashbrownai/core';


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
   * Optional transport override.
   * Defaults to the global transport configured via `provideHashbrown`.
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

  complete<Input, Schema extends s.HashbrownType>(
    options: AiStructuredCompletionOptions<Input, Schema>
  ): Promise<s.Infer<Schema>> {
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
          model: 'gpt-4o@2025-01-01-preview',
          system: options.system,
          schema: options.schema,
          ...(options.transport ? { transport: options.transport } : {}),
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
