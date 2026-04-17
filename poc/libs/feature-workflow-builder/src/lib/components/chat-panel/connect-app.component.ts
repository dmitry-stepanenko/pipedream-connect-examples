import { Component, InjectionToken, inject, input, signal, computed } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import {
  MatDialog,
  MatDialogModule,
  MAT_DIALOG_DATA,
} from '@angular/material/dialog';
import { PipedreamClientService } from '@poc/connect-angular';
import { WorkflowService } from '@poc/data-access-api';
import type { PipedreamStep } from '@poc/data-access-api';
import type { ConfigurableProp } from '@pipedream/sdk';

export interface AppPropConfig {
  type: string;
  app: string;
  name: string;
}

export const CHAT_SEND_MESSAGE = new InjectionToken<
  (message: string) => void
>('CHAT_SEND_MESSAGE');

@Component({
  selector: 'pd-connect-app',
  standalone: true,
  imports: [MatButtonModule],
  template: `
    @if (appName(); as name) {
      @switch (state()) {
        @case ('idle') {
          <button
            mat-flat-button
            class="connect-btn"
            (click)="handleConnect()"
          >
            <i class="fa-solid fa-plug"></i>
            Connect {{ name }}
          </button>
        }
        @case ('loading') {
          <button mat-flat-button class="connect-btn" disabled>
            <i class="fa-solid fa-spinner fa-spin"></i>
            Connect {{ name }}
          </button>
        }
        @case ('connecting') {
          <button mat-flat-button class="connect-btn" disabled>
            <i class="fa-solid fa-spinner fa-spin"></i>
            Connecting {{ name }}…
          </button>
        }
        @case ('connected') {
          <div class="connected">
            <i class="fa-solid fa-check"></i>
            {{ name }} connected
          </div>
        }
        @case ('error') {
          <div class="error-row">
            <span class="error-text">Failed to connect {{ name }}</span>
            <button mat-button (click)="handleConnect()">Retry</button>
          </div>
        }
      }
    } @else {
      <div class="error-row">
        <span class="error-text">App configuration not found</span>
      </div>
    }
  `,
  styles: [
    `
      :host {
        display: block;
        margin: 4px 0;
      }

      .connect-btn {
        gap: 8px;
        background-color: #4f46e5;
        color: white;
      }

      .connected {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 6px 16px;
        border-radius: 8px;
        background-color: #dcfce7;
        color: #166534;
        font-size: 0.875rem;
        font-weight: 500;
      }

      .error-row {
        display: inline-flex;
        align-items: center;
        gap: 8px;
      }

      .error-text {
        color: #dc2626;
        font-size: 0.875rem;
      }
    `,
  ],
})
export class ConnectAppComponent {
  private readonly pdClient = inject(PipedreamClientService);
  private readonly workflowService = inject(WorkflowService);
  private readonly dialog = inject(MatDialog);
  private readonly sendMessage = inject(CHAT_SEND_MESSAGE);

  readonly workflowId = input.required<string>();
  readonly stepId = input.required<string>();

  readonly state = signal<
    'idle' | 'loading' | 'connecting' | 'connected' | 'error'
  >('idle');

  private readonly resolvedProp = computed<AppPropConfig | null>(() => {
    const workflow = this.workflowService
      .workflows()
      .find((w) => w.id === this.workflowId());
    const step = workflow?.steps.find((s) => s.id === this.stepId());
    if (!step?.data || step.data.source !== 'pipedream') return null;

    const pdStep = step.data as PipedreamStep;
    const prop = pdStep.component.configurableProps?.find(
      (p): p is ConfigurableProp & { type: 'app'; app: string; name: string } =>
        p.type === 'app',
    );
    return prop ?? null;
  });

  protected readonly appName = computed<string | null>(() => {
    const prop = this.resolvedProp();
    if (!prop) return null;
    return prop.name.charAt(0).toUpperCase() + prop.name.slice(1);
  });

  async handleConnect() {
    this.state.set('loading');
    const appProp = this.resolvedProp();
    if (!appProp) {
      this.state.set('error');
      return;
    }

    try {
      const res = await this.pdClient.listAccounts(appProp.app);
      const accounts: { id: string; name: string }[] = (
        (res as any).data ?? []
      ).map((a: any) => ({ id: a.id, name: a.name }));

      if (accounts.length > 0) {
        this.state.set('idle');
        this.openAccountPicker(appProp, accounts);
      } else {
        await this.connectNew(appProp);
      }
    } catch {
      await this.connectNew(appProp);
    }
  }

  private openAccountPicker(appProp: AppPropConfig, accounts: { id: string; name: string }[]) {
    const ref = this.dialog.open(AccountPickerDialogComponent, {
      width: '360px',
      data: { appSlug: appProp.app, appName: this.appName()!, accounts },
    });
    ref.afterClosed().subscribe((result?: string) => {
      if (result === '__connect_new__') {
        this.connectNew(appProp);
      } else if (result) {
        this.onAccountSelected(appProp, result);
      }
    });
  }

  private async connectNew(appProp: AppPropConfig) {
    this.state.set('connecting');
    try {
      const result = await this.pdClient.connectAccount(appProp.app);
      await this.onAccountSelected(appProp, result.id);
    } catch {
      this.state.set('error');
    }
  }

  private async onAccountSelected(appProp: AppPropConfig, accountId: string) {
    const workflow = this.workflowService
      .workflows()
      .find((w) => w.id === this.workflowId());
    const step = workflow?.steps.find((s) => s.id === this.stepId());
    if (step?.data?.source === 'pipedream') {
      const current = step.data as PipedreamStep;
      this.workflowService.configureStep(this.workflowId(), this.stepId(), {
        ...current,
        configuredProps: { ...current.configuredProps, [appProp.name]: accountId },
      });
      await this.workflowService.save(this.workflowId());
    }

    this.state.set('connected');
    this.sendMessage(`I've connected my ${this.appName()!} account.`);
  }
}

// ── Account picker dialog ──────────────────────────────────────────────────

interface AccountPickerData {
  appSlug: string;
  appName: string;
  accounts: { id: string; name: string }[];
}

@Component({
  selector: 'pd-account-picker-dialog',
  standalone: true,
  imports: [MatDialogModule, MatButtonModule],
  template: `
    <h2 mat-dialog-title>Connect {{ data.appName }}</h2>

    <mat-dialog-content>
      <p class="subtitle">Select an existing account or connect a new one.</p>
      <div class="account-list">
        @for (account of data.accounts; track account.id) {
          <button
            mat-stroked-button
            class="account-item"
            [mat-dialog-close]="account.id"
          >
            <i class="fa-solid fa-user"></i>
            {{ account.name }}
          </button>
        }
      </div>
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button mat-flat-button color="primary" [mat-dialog-close]="'__connect_new__'">
        <i class="fa-solid fa-plug"></i>
        Connect new account
      </button>
    </mat-dialog-actions>
  `,
  styles: [
    `
      .subtitle {
        margin: 0 0 12px;
        font-size: 0.875rem;
        color: #6b7280;
      }

      .account-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .account-item {
        justify-content: flex-start;
        gap: 8px;
        text-align: left;
      }
    `,
  ],
})
export class AccountPickerDialogComponent {
  readonly data = inject<AccountPickerData>(MAT_DIALOG_DATA);
}
