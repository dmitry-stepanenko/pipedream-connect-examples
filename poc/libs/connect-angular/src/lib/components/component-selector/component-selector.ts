import {
  Component, input, output, signal, effect, inject
} from '@angular/core';
import { App, Component as PdComponent } from '@pipedream/sdk';
import { PipedreamClientService } from '../../services/pipedream-client.service';

@Component({
  selector: 'pd-component-selector',
  standalone: true,
  templateUrl: './component-selector.html',
  styleUrl: './component-selector.css',
})
export class ComponentSelectorComponent {
  app = input.required<App>();
  componentType = input<'action' | 'trigger'>('action');
  value = input<PdComponent | null>(null);
  valueChange = output<PdComponent | null>();

  protected readonly components = signal<PdComponent[]>([]);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  private readonly client = inject(PipedreamClientService);

  constructor() {
    // Reload components when app or type changes
    effect(() => {
      const app = this.app();
      const type = this.componentType();
      if (app) {
        this.loadComponents(app.nameSlug, type);
      }
    });
  }

  protected select(component: PdComponent) {
    this.valueChange.emit(component);
  }

  protected clear() {
    this.valueChange.emit(null);
  }

  private async loadComponents(appSlug: string, type: 'action' | 'trigger') {
    this.loading.set(true);
    this.error.set(null);
    try {
      const result = await this.client.listComponents({
        app: appSlug,
        componentType: type,
        limit: 50,
      });
      this.components.set(result.data ?? []);
    } catch {
      this.error.set('Failed to load components');
    } finally {
      this.loading.set(false);
    }
  }
}
