import {
  Component, input, output, signal, computed, inject, OnInit
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { App } from '@pipedream/sdk';
import { PipedreamClientService } from '../../services/pipedream-client.service';

@Component({
  selector: 'pd-app-selector',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './app-selector.html',
  styleUrl: './app-selector.css',
})
export class AppSelectorComponent implements OnInit {
  // Two-way binding: <pd-app-selector [(value)]="myApp" />
  value = input<App | null>(null);
  valueChange = output<App | null>();

  protected readonly query = signal('');
  protected readonly apps = signal<App[]>([]);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly isOpen = signal(false);

  protected readonly filteredApps = computed(() => {
    const q = this.query().toLowerCase();
    if (!q) return this.apps();
    return this.apps().filter(
      (a) => a.name.toLowerCase().includes(q) || a.nameSlug.includes(q)
    );
  });

  private readonly client = inject(PipedreamClientService);

  async ngOnInit() {
    await this.loadApps();
  }

  protected async onSearch(q: string) {
    this.query.set(q);
    if (q.length >= 2) {
      await this.loadApps(q);
    }
  }

  protected selectApp(app: App) {
    this.valueChange.emit(app);
    this.isOpen.set(false);
    this.query.set('');
  }

  protected clear() {
    this.valueChange.emit(null);
  }

  private async loadApps(query?: string) {
    this.loading.set(true);
    this.error.set(null);
    try {
      const result = await this.client.listApps(query, 50);
      this.apps.set(result.data ?? []);
    } catch (e) {
      this.error.set('Failed to load apps');
    } finally {
      this.loading.set(false);
    }
  }
}
