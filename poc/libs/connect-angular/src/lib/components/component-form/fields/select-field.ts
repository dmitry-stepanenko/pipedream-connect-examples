import { Component, input, output, signal, effect, inject, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ConfigurableProp, ConfiguredProps, PropOption } from '@pipedream/sdk';
import { PipedreamClientService } from '../../../services/pipedream-client.service';
import { FieldWrapperComponent } from './field-wrapper';

interface SelectOption { label: string; value: unknown }

@Component({
  selector: 'pd-select-field',
  standalone: true,
  imports: [FormsModule, FieldWrapperComponent],
  template: `
    <pd-field-wrapper [prop]="prop()" [fieldId]="prop().name">
      @if (loading()) {
        <p class="pd-loading">Loading options...</p>
      } @else {
        <select
          [id]="prop().name"
          [ngModel]="value()"
          (ngModelChange)="valueChange.emit($event)"
          [required]="!prop().optional"
          class="pd-select"
        >
          <option [ngValue]="null">— Select —</option>
          @for (opt of resolvedOptions(); track opt.value) {
            <option [ngValue]="opt.value">{{ opt.label }}</option>
          }
        </select>
      }
    </pd-field-wrapper>
  `,
  styles: [`
    .pd-select {
      width: 100%;
      padding: 0.5rem;
      border: 1px solid #d1d5db;
      border-radius: 4px;
      font-size: 0.9rem;
      background: #fff;
    }
    .pd-loading {
      font-size: 0.85rem;
      color: #666;
    }
  `],
})
export class SelectFieldComponent {
  prop = input.required<ConfigurableProp>();
  value = input<unknown>(null);
  valueChange = output<unknown>();
  /** Current configured props — needed by remote options for context */
  configuredProps = input<ConfiguredProps>({});
  /** Component key — needed for remote options API call */
  componentId = input<string>('');
  /** Dynamic props ID — used for remote options when dynamic props are active */
  dynamicPropsId = input<string | undefined>(undefined);

  protected readonly resolvedOptions = signal<SelectOption[]>([]);
  protected readonly loading = signal(false);

  private readonly client = inject(PipedreamClientService);

  constructor() {
    effect(() => {
      const prop = this.prop();
      // Read context with untracked so changes to these don't re-trigger the effect
      const configuredProps = untracked(() => this.configuredProps());
      const componentId = untracked(() => this.componentId());
      const dynamicPropsId = untracked(() => this.dynamicPropsId());
      this.loadOptions(prop, configuredProps, componentId, dynamicPropsId);
    });
  }

  private async loadOptions(
    prop: ConfigurableProp,
    configuredProps: ConfiguredProps,
    componentId: string,
    dynamicPropsId: string | undefined,
  ) {
    const propAny = prop as ConfigurableProp & { options?: unknown[] };

    if (prop.remoteOptions) {
      // Remote options — call SDK configureProp endpoint
      this.loading.set(true);
      try {
        const result = await this.client.configureProp(
          componentId,
          prop.name,
          configuredProps as Record<string, unknown>,
          dynamicPropsId,
        );
        const opts: SelectOption[] = [];
        if (result.options) {
          for (const o of result.options) {
            if (o && typeof o === 'object' && 'label' in o) {
              opts.push({ label: (o as PropOption).label, value: (o as PropOption).value });
            }
          }
        }
        if (result.stringOptions) {
          for (const s of result.stringOptions) {
            opts.push({ label: s, value: s });
          }
        }
        this.resolvedOptions.set(opts);
      } catch {
        this.resolvedOptions.set([]);
      } finally {
        this.loading.set(false);
      }
    } else if (Array.isArray(propAny.options)) {
      // Static options
      this.resolvedOptions.set(
        propAny.options.map((o: unknown) =>
          typeof o === 'string' ? { label: o, value: o } : (o as SelectOption)
        )
      );
    }
  }
}
