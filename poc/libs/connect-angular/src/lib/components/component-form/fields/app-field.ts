import {
  Component,
  input,
  output,
  signal,
  computed,
  inject,
  effect,
} from '@angular/core';
import { ConfigurableProp } from '@pipedream/sdk';
import { PipedreamClientService } from '../../../services/pipedream-client.service';
import { FieldWrapperComponent } from './field-wrapper';
import { filter, firstValueFrom, fromEvent, map } from 'rxjs';

interface Account {
  id: string;
  name: string;
}

@Component({
  selector: 'pd-app-field',
  standalone: true,
  imports: [FieldWrapperComponent],
  template: `
    @if (!noAuth()) {
      <pd-field-wrapper [prop]="prop()">
        @switch (viewState()) {
          @case ('connected') {
            <div class="pd-connected-account">
              <span class="pd-account-name">
                {{ accountName() || value() }}
              </span>
              <button type="button" class="pd-btn-link" (click)="showPicker()">
                Change
              </button>
              <button
                type="button"
                class="pd-btn-disconnect"
                (click)="disconnect()"
              >
                Disconnect
              </button>
            </div>
          }
          @case ('outdated') {
            <div class="pd-outdated-account">
              <span class="pd-outdated-text">Account disconnected</span>
              <button type="button" class="pd-btn-link" (click)="showPicker()">
                Reconnect
              </button>
            </div>
          }
          @case ('picking') {
            <div class="pd-account-picker">
              @if (value()) {
                <button
                  type="button"
                  class="pd-btn-link"
                  (click)="picking.set(false)"
                >
                  ← Cancel
                </button>
              }
              @if (accounts().length > 0) {
                <ul class="pd-accounts-list">
                  @for (account of accounts(); track account.id) {
                    <li>
                      <button
                        type="button"
                        class="pd-account-item"
                        (click)="selectAccount(account.id)"
                      >
                        {{ account.name }}
                      </button>
                    </li>
                  }
                </ul>
              }
              <button
                type="button"
                class="pd-connect-btn"
                [disabled]="connecting()"
                (click)="connectNew()"
              >
                {{ connecting() ? 'Connecting…' : '+ Connect new account' }}
              </button>
            </div>
          }
          @case ('loading') {
            <p class="pd-accounts-loading">Loading…</p>
          }
          @default {
            <button type="button" class="pd-connect-btn" (click)="showPicker()">
              Connect {{ asApp().app }}
            </button>
          }
        }
        @if (error()) {
          <p class="pd-error">
            {{ error() }}
            <button
              type="button"
              class="pd-btn-link"
              (click)="loadAccounts(asApp().app)"
            >
              Retry
            </button>
          </p>
        }
      </pd-field-wrapper>
    }
  `,
  styles: [
    `
      .pd-connected-account {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 0.5rem 0.75rem;
        background: #f0fdf4;
        border: 1px solid #86efac;
        border-radius: 4px;
      }
      .pd-account-name {
        flex: 1;
        font-size: 0.9rem;
      }
      .pd-btn-link {
        background: none;
        border: none;
        color: #2563eb;
        cursor: pointer;
        font-size: 0.8rem;
        padding: 0;
        text-decoration: underline;
      }
      .pd-outdated-account {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 0.5rem 0.75rem;
        background: #fefce8;
        border: 1px solid #fde047;
        border-radius: 4px;
      }
      .pd-outdated-text {
        flex: 1;
        font-size: 0.9rem;
        color: #854d0e;
      }
      .pd-btn-disconnect {
        padding: 0.3rem 0.6rem;
        background: #fee2e2;
        border: 1px solid #fca5a5;
        border-radius: 4px;
        cursor: pointer;
        font-size: 0.8rem;
      }
      .pd-account-picker {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }
      .pd-accounts-loading {
        font-size: 0.85rem;
        color: #888;
        margin: 0;
      }
      .pd-accounts-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
      }
      .pd-account-item {
        width: 100%;
        text-align: left;
        padding: 0.45rem 0.75rem;
        background: #f9fafb;
        border: 1px solid #e5e7eb;
        border-radius: 4px;
        cursor: pointer;
        font-size: 0.875rem;
      }
      .pd-account-item:hover {
        background: #f3f4f6;
      }
      .pd-connect-btn {
        padding: 0.45rem 1rem;
        background: #2563eb;
        color: #fff;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 0.875rem;
      }
      .pd-connect-btn:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }
      .pd-error {
        font-size: 0.85rem;
        color: #e53e3e;
        margin: 0.25rem 0 0;
      }
    `,
  ],
})
export class AppFieldComponent {
  prop = input.required<ConfigurableProp>();
  /** value is the connected account ID */
  value = input<string | null>(null);
  valueChange = output<string | null>();

  protected readonly noAuth = signal(false);
  protected readonly accounts = signal<Account[]>([]);
  protected readonly loadingAccounts = signal(false);
  protected readonly connecting = signal(false);
  protected readonly picking = signal(false);
  protected readonly outdated = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly viewState = computed<
    'loading' | 'connected' | 'outdated' | 'picking' | 'idle'
  >(() => {
    if (this.loadingAccounts()) return 'loading';
    if (this.picking()) return 'picking';
    if (this.value() && this.outdated()) return 'outdated';
    if (this.value()) return 'connected';
    return 'idle';
  });

  private readonly client = inject(PipedreamClientService);

  constructor() {
    // Load accounts whenever the app slug changes
    effect(() => {
      const app = this.asApp().app;
      if (app) this.loadAccounts(app);
    });
  }

  protected asApp() {
    return this.prop() as ConfigurableProp & { app: string };
  }

  protected accountName() {
    const id = this.value();
    return this.accounts().find((a) => a.id === id)?.name ?? null;
  }

  protected showPicker() {
    this.picking.set(true);
  }

  protected selectAccount(id: string) {
    this.picking.set(false);
    this.outdated.set(false);
    this.valueChange.emit(id);
  }

  protected async connectNew() {
    this.connecting.set(true);
    this.error.set(null);
    try {
      const result = await Promise.race([
        this.client.connectAccount(this.asApp().app),
        this._connectionInterrupted(),
      ]);
      if (result) {
        await this.loadAccounts(this.asApp().app);
        this.picking.set(false);
        this.outdated.set(false);
        this.valueChange.emit(result.id);
      }
    } catch {
      this.error.set('Connection failed. Please try again.');
    } finally {
      this.connecting.set(false);
    }
  }

  protected disconnect() {
    this.outdated.set(false);
    this.valueChange.emit(null);
  }

  protected async loadAccounts(app: string) {
    this.loadingAccounts.set(true);
    this.noAuth.set(false);
    this.error.set(null);
    try {
      const [accountsRes, appRes] = await Promise.all([
        this.client.listAccounts(app),
        this.client.getApp(app),
      ]);
      const authType = appRes.data?.authType;
      if (!authType || authType === 'none') {
        this.noAuth.set(true);
        return;
      }
      const data = (accountsRes as any).data ?? [];
      this.accounts.set(data.map((a: any) => ({ id: a.id, name: a.name })));
      const currentId = this.value();
      if (currentId) {
        this.outdated.set(
          !data.some((a: { id: string }) => a.id === currentId),
        );
      }
    } catch {
      this.accounts.set([]);
      this.error.set('Failed to load accounts.');
    } finally {
      this.loadingAccounts.set(false);
    }
  }

  private _connectionInterrupted() {
    return firstValueFrom(
      fromEvent<MessageEvent>(window, 'message').pipe(
        filter(
          (v) =>
            v?.type === 'message' &&
            v.data?.type === 'close' &&
            v.origin === 'https://pipedream.com',
        ),
        map(() => null),
      ),
    );
  }
}
