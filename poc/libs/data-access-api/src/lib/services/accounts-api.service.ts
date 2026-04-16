import { inject, Injectable } from '@angular/core';
import { PIPEDREAM_CONFIG } from '@poc/connect-angular';

@Injectable({ providedIn: 'root' })
export class AccountsApiService {
  private readonly config = inject(PIPEDREAM_CONFIG);

  private get baseUrl(): string {
    return `${this.config.apiBaseUrl}/api/accounts`;
  }

  async deleteAccount(accountId: string): Promise<void> {
    const res = await fetch(
      `${this.baseUrl}/${encodeURIComponent(accountId)}`,
      { method: 'DELETE' },
    );
    if (!res.ok) throw new Error(`Failed to delete account: ${res.status}`);
  }
}
