import { Component, input, output, signal, effect, inject, untracked, computed } from '@angular/core';
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
  /** Index of this prop in the configurableProps array */
  propIndex = input(0);
  /** Full list of configurable props — used to compute upstream dependencies */
  allProps = input<ConfigurableProp[]>([]);

  protected readonly resolvedOptions = signal<SelectOption[]>([]);
  protected readonly loading = signal(false);

  private readonly client = inject(PipedreamClientService);

  /**
   * Serialized key of configured props BEFORE this prop in the form.
   * Returns a stable string so the effect only re-fires when upstream values
   * actually change (not on every downstream keystroke).
   */
  private readonly upstreamConfigKey = computed(() => {
    const idx = this.propIndex();
    const all = this.allProps();
    const cp = this.configuredProps() as Record<string, unknown>;
    const upstream: Record<string, unknown> = {};
    for (let i = 0; i < idx; i++) {
      upstream[all[i].name] = cp[all[i].name];
    }
    return JSON.stringify(upstream);
  });

  constructor() {
    effect(() => {
      const prop = this.prop();
      // Track upstream configured props — when they change, remote options reload
      // (e.g. connecting a Slack account triggers channel list to load).
      // The serialized key ensures we only re-fire when upstream *values* change,
      // not on every configuredProps reference change from downstream edits.
      const upstreamKey = this.upstreamConfigKey();

      const componentId = untracked(() => this.componentId());
      const dynamicPropsId = untracked(() => this.dynamicPropsId());
      const upstreamProps = JSON.parse(upstreamKey || '{}') as ConfiguredProps;
      this.loadOptions(prop, upstreamProps, componentId, dynamicPropsId);
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
          untracked(() => this.allProps()),
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
      } catch (e) {
        console.error(`Failed to load remote options for prop "${prop.name}"`, e);
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
