import {
  computed,
  inject,
  Injectable,
  InjectionToken,
  Signal,
  signal,
  WritableSignal,
} from '@angular/core';

export interface ChatProviderConfig {
  /** Display name shown in the UI provider selector. */
  name: string;
  /** URL of the backend chat endpoint (passed to uiChatResource transport). */
  baseUrl: string;
  /** Main model used for the AI chat conversation. */
  model: string;
  /** Smaller/cheaper model used for structured completions (e.g. workflow review). */
  smallModel: string;
}

export type ChatProvidersMap = Record<string, ChatProviderConfig>;

/** Token for injecting the providers map. Provide this in app.config.ts. */
export const CHAT_PROVIDERS_MAP = new InjectionToken<ChatProvidersMap>(
  'CHAT_PROVIDERS_MAP',
);

const STORAGE_KEY = 'chatProvider';

@Injectable({ providedIn: 'root' })
export class ChatProviderService {
  private readonly providersMap = inject(CHAT_PROVIDERS_MAP);
  private readonly _key: WritableSignal<string>;

  readonly active: Signal<ChatProviderConfig>;

  constructor() {
    const keys = Object.keys(this.providersMap);
    const stored = localStorage.getItem(STORAGE_KEY);
    const initial = stored && keys.includes(stored) ? stored : keys[0];
    this._key = signal(initial);
    this.active = computed(() => this.providersMap[this._key()] ?? Object.values(this.providersMap)[0]);
  }

  get key(): Signal<string> {
    return this._key.asReadonly();
  }

  get providerEntries(): { key: string; name: string }[] {
    return Object.entries(this.providersMap).map(([key, cfg]) => ({
      key,
      name: cfg.name,
    }));
  }

  setProvider(key: string): void {
    if (this.providersMap[key]) {
      this._key.set(key);
      localStorage.setItem(STORAGE_KEY, key);
    }
  }
}
