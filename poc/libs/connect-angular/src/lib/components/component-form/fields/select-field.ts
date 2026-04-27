import { Component, input, output, signal, effect, inject, untracked, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { ConfigurableProp, ConfiguredProps, PropOption } from '@pipedream/sdk';
import { PipedreamClientService } from '../../../services/pipedream-client.service';
import { FieldWrapperComponent } from './field-wrapper';

interface SelectOption { label: string; value: unknown }

@Component({
  selector: 'pd-select-field',
  standalone: true,
  imports: [FormsModule, MatFormFieldModule, MatSelectModule, FieldWrapperComponent],
  template: `
    <pd-field-wrapper [prop]="prop()" [fieldId]="prop().name">
      @if (loading()) {
        <p class="pd-loading">Loading options...</p>
      } @else {
        <mat-form-field appearance="outline" class="pd-mat-field">
          <mat-select
            [id]="prop().name"
            [multiple]="isMulti()"
            [ngModel]="isMulti() ? multiValue() : value()"
            (ngModelChange)="valueChange.emit($event)"
            [required]="!prop().optional"
          >
            @if (!isMulti()) {
              <mat-option [value]="null">— Select —</mat-option>
            }
            @for (opt of resolvedOptions(); track opt.value) {
              <mat-option [value]="opt.value">{{ opt.label }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
      }
    </pd-field-wrapper>
  `,
  styles: [`
    .pd-mat-field {
      width: 100%;
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

  protected readonly isMulti = computed(() => {
    const type = (this.prop() as ConfigurableProp & { type?: string }).type;
    return type === 'string[]' || type === 'integer[]';
  });

  /** For multi-select: ensure value is always an array */
  protected readonly multiValue = computed<unknown[]>(() => {
    const v = this.value();
    if (Array.isArray(v)) return v;
    if (v != null) return [v];
    return [];
  });

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
