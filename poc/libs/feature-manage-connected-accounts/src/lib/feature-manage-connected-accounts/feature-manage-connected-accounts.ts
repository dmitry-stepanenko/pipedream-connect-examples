import { Component, inject, signal, resource } from '@angular/core';
import { DatePipe } from '@angular/common';
import { PipedreamClientService } from '@poc/connect-angular';
import { AccountsApiService } from '@poc/data-access-api';
import type { Account } from '@pipedream/sdk';

@Component({
  selector: 'lib-feature-manage-connected-accounts',
  standalone: true,
  imports: [DatePipe],
  templateUrl: './feature-manage-connected-accounts.html',
  styleUrl: './feature-manage-connected-accounts.css',
})
export class FeatureManageConnectedAccountsComponent {
  private readonly client = inject(PipedreamClientService);
  private readonly accountsApi = inject(AccountsApiService);

  protected readonly disconnecting = signal<string | null>(null);
  protected readonly disconnectError = signal<string | null>(null);

  protected readonly accountsResource = resource({
    loader: async () => {
      const res = await this.client.listAccounts();
      return res.data ?? [];
    },
  });

  protected async disconnect(account: Account) {
    this.disconnecting.set(account.id);
    this.disconnectError.set(null);
    try {
      await this.accountsApi.deleteAccount(account.id);
      this.accountsResource.reload();
    } catch {
      this.disconnectError.set(`Failed to disconnect ${account.name ?? account.id}.`);
    } finally {
      this.disconnecting.set(null);
    }
  }
}
