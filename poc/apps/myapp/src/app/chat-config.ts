import { environment } from '../environments/environment';
import type { ChatProvidersMap } from '@poc/data-access-structured-completion';

/**
 * All available chat providers.
 * To add a new provider, add an entry here and provide the matching backend env vars.
 * The active provider is selected at runtime from the chat UI (persisted in localStorage).
 */
export const CHAT_PROVIDERS: ChatProvidersMap = {
  azure: {
    name: 'Azure OpenAI',
    baseUrl: `${environment.apiUrl}/api/chat-azure`,
    model: 'gpt-4o@2025-01-01-preview',
    smallModel: 'gpt-4o@2025-01-01-preview',
  },
  openai: {
    name: 'OpenAI',
    baseUrl: `${environment.apiUrl}/api/chat-openai`,
    model: 'gpt-5.4',
    smallModel: 'gpt-4o-mini',
  },
};
