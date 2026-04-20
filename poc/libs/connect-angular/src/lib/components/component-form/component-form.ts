import {
  Component, input, output, signal, effect, inject, computed,
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
  /** Available interpolation paths from prior steps (e.g. steps.slack.$return_value) */
  availablePaths = input<string[]>([]);
  /** Emits the full updated configuredProps on every field change */
  configure = output<ConfiguredProps>();

  protected readonly props = signal<ConfigurableProp[]>([]);
  protected readonly reloading = signal(false);
  protected readonly dynamicPropsId = signal<string | undefined>(undefined);
  /** Set of optional prop names the user has explicitly toggled on */
  protected readonly enabledOptional = signal<Set<string>>(new Set());

  /** Optional props not yet enabled and without a value — shown as toggle chips */
  protected readonly hiddenOptionalProps = computed(() => {
    const cp = this.configuredProps() as Record<string, unknown>;
    const enabled = this.enabledOptional();
    return this.props().filter(p =>
      !p.hidden && p.optional && !enabled.has(p.name)
      && (cp[p.name] === undefined || cp[p.name] === null),
    );
  });

  private readonly client = inject(PipedreamClientService);

  constructor() {
    // Load props from component definition; re-run when component input changes
    effect(() => {
      const comp = this.component();
      this.props.set(comp.configurableProps ?? []);
      this.dynamicPropsId.set(undefined);
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected propValue(prop: ConfigurableProp): any {
    return (this.configuredProps() as Record<string, unknown>)[prop.name];
  }

  protected isPropVisible(prop: ConfigurableProp): boolean {
    if (prop.hidden) return false;
    if (!prop.optional) return true;
    if (this.enabledOptional().has(prop.name)) return true;
    const v = this.propValue(prop);
    return v !== undefined && v !== null;
  }

  protected enableOptionalProp(propName: string) {
    const next = new Set(this.enabledOptional());
    next.add(propName);
    this.enabledOptional.set(next);
  }

  protected disableOptionalProp(prop: ConfigurableProp) {
    const next = new Set(this.enabledOptional());
    next.delete(prop.name);
    this.enabledOptional.set(next);
    // Clear the value when hiding
    const updated: ConfiguredProps = { ...this.configuredProps() };
    delete (updated as Record<string, unknown>)[prop.name];
    this.configure.emit(updated);
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
        allProps,
        this.dynamicPropsId(),
      );

      this.props.set(result.dynamicProps?.configurableProps ?? allProps);
      if (result.dynamicProps?.id) {
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
