import {
  Component, input, output, signal, effect, inject,
} from '@angular/core';
import {
  Component as PdComponent,
  ConfigurableProp,
  ConfiguredProps,
} from '@pipedream/sdk';
import { PipedreamClientService } from '../../services/pipedream-client.service';
import { StringFieldComponent } from './fields/string-field';
import { NumberFieldComponent } from './fields/number-field';
import { BooleanFieldComponent } from './fields/boolean-field';
import { ObjectFieldComponent } from './fields/object-field';
import { ArrayFieldComponent } from './fields/array-field';
import { AppFieldComponent } from './fields/app-field';
import { SelectFieldComponent } from './fields/select-field';
import { TimerFieldComponent } from './fields/timer-field';
import { AlertFieldComponent } from './fields/alert-field';

@Component({
  selector: 'pd-component-form',
  standalone: true,
  imports: [
    StringFieldComponent,
    NumberFieldComponent,
    BooleanFieldComponent,
    ObjectFieldComponent,
    ArrayFieldComponent,
    AppFieldComponent,
    SelectFieldComponent,
    TimerFieldComponent,
    AlertFieldComponent,
  ],
  templateUrl: './component-form.html',
  styleUrl: './component-form.css',
})
export class ComponentFormComponent {
  /** The Pipedream component to render a form for */
  component = input.required<PdComponent>();
  /** Current configured values — passed in, updated via configure output */
  configuredProps = input<ConfiguredProps>({});
  /** Emits the full updated configuredProps on every field change */
  configure = output<ConfiguredProps>();
  /** Emits when user clicks Submit */
  submitted = output<ConfiguredProps>();

  protected readonly props = signal<ConfigurableProp[]>([]);
  protected readonly reloading = signal(false);
  protected readonly submitting = signal(false);
  protected readonly dynamicPropsId = signal<string | undefined>(undefined);

  private readonly client = inject(PipedreamClientService);

  constructor() {
    // Load props from component definition; re-run when component input changes
    effect(() => {
      const comp = this.component();
      this.props.set(comp.configurableProps ?? []);
      this.dynamicPropsId.set(undefined);
    });
  }

  protected propValue(prop: ConfigurableProp): unknown {
    return (this.configuredProps() as Record<string, unknown>)[prop.name];
  }

  protected async onFieldChange(prop: ConfigurableProp, value: unknown) {
    const updated: ConfiguredProps = {
      ...this.configuredProps(),
      [prop.name]: value,
    };
    this.configure.emit(updated);

    if (prop.reloadProps) {
      await this.reloadProps(updated, prop);
    }
  }

  protected onSubmit() {
    this.submitted.emit(this.configuredProps());
  }

  /**
   * Checks if this prop should render a select control.
   * A prop has options if it has static `options` array or `remoteOptions: true`.
   */
  protected hasOptions(prop: ConfigurableProp): boolean {
    const p = prop as ConfigurableProp & { options?: unknown[]; remoteOptions?: boolean };
    return !!p.remoteOptions || (Array.isArray(p.options) && p.options.length > 0);
  }

  private async reloadProps(currentConfiguredProps: ConfiguredProps, triggerProp: ConfigurableProp) {
    this.reloading.set(true);

    // Slice visible props to only those up to and including the trigger prop
    const allProps = this.props();
    const triggerIdx = allProps.findIndex(p => p.name === triggerProp.name);
    if (triggerIdx >= 0) {
      this.props.set(allProps.slice(0, triggerIdx + 1));
    }

    try {
      const result = await this.client.reloadProps(
        this.component().key,
        currentConfiguredProps as Record<string, unknown>,
        this.dynamicPropsId(),
      );

      if (result.dynamicProps?.configurableProps) {
        this.props.set(result.dynamicProps.configurableProps);
        this.dynamicPropsId.set(result.dynamicProps.id);
      }

      // Clean up configuredProps: preserve existing values, add defaults for new props, drop removed props
      const newPropNames = new Set((result.dynamicProps?.configurableProps ?? allProps).map(p => p.name));
      const cleaned: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(currentConfiguredProps as Record<string, unknown>)) {
        if (newPropNames.has(key)) {
          cleaned[key] = val;
        }
      }
      // Add defaults for new props that don't have a value yet
      for (const p of (result.dynamicProps?.configurableProps ?? [])) {
        const pAny = p as ConfigurableProp & { default?: unknown };
        if (!(p.name in cleaned) && pAny.default !== undefined) {
          cleaned[p.name] = pAny.default;
        }
      }
      this.configure.emit(cleaned as ConfiguredProps);
    } catch (e) {
      console.error('Failed to reload props', e);
      // Restore all props on error
      this.props.set(allProps);
    } finally {
      this.reloading.set(false);
    }
  }
}
