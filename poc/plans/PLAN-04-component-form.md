# PLAN-04 — connect-angular: ComponentForm (Dynamic Forms)

## Goal

Build `ComponentFormComponent` (`pd-component-form`) — the most complex piece of the library. It accepts a Pipedream `Component` definition and renders a fully dynamic form covering all prop types, including dependent/dynamic props that reload when upstream values change.

This is the Angular equivalent of `ComponentForm` / `ComponentFormContainer` from `@pipedream/connect-react`.

## Context

- Library path: `poc/libs/connect-angular/src/lib/components/component-form/`
- Depends on `PipedreamClientService` (PLAN-02) for account connection and dynamic prop reload
- React usage reference: `connect-react-demo/src/` — see how `ComponentFormContainer` is used in `DynamicComponent.tsx`
- React reference: read the actual connect-react source — these are the key files:
  - `/Users/dmitry/projects/forks/pipedream/packages/connect-react/src/components/ComponentForm.tsx` — top-level form component
  - `/Users/dmitry/projects/forks/pipedream/packages/connect-react/src/components/InternalComponentForm.tsx` — internal form logic (dynamic props, reload)
  - `/Users/dmitry/projects/forks/pipedream/packages/connect-react/src/components/Field.tsx` and `InternalField.tsx` — field wrapper
  - `/Users/dmitry/projects/forks/pipedream/packages/connect-react/src/components/Control.tsx` — control dispatcher (maps prop type → control component)
  - `/Users/dmitry/projects/forks/pipedream/packages/connect-react/src/components/ControlApp.tsx` — OAuth account picker
  - `/Users/dmitry/projects/forks/pipedream/packages/connect-react/src/components/ControlSelect.tsx` — static + async select
  - `/Users/dmitry/projects/forks/pipedream/packages/connect-react/src/components/ControlInput.tsx` — text/number inputs
  - `/Users/dmitry/projects/forks/pipedream/packages/connect-react/src/components/ControlBoolean.tsx` — checkbox
  - `/Users/dmitry/projects/forks/pipedream/packages/connect-react/src/components/ControlObject.tsx` — JSON object field
  - `/Users/dmitry/projects/forks/pipedream/packages/connect-react/src/components/ControlArray.tsx` — array field
  - `/Users/dmitry/projects/forks/pipedream/packages/connect-react/src/components/ControlHttpRequest.tsx` — HTTP interface info
  - `/Users/dmitry/projects/forks/pipedream/packages/connect-react/src/components/Alert.tsx` — alert field
  - `/Users/dmitry/projects/forks/pipedream/packages/connect-react/src/hooks/form-context.tsx` — form state management
  - `/Users/dmitry/projects/forks/pipedream/packages/connect-react/src/utils/type-guards.ts` — prop type guards (critical for understanding the prop type discrimination)
- All Pipedream prop types must be supported (see complete list below)
- Angular 21 — use `@switch`, `@for`, `@if` control flow; signals for all local state

## Prerequisites

PLAN-02 and PLAN-03 must be completed.

---

## Prop Types Reference

Study `@pipedream/sdk` TypeScript types after installation:
```bash
cat poc/node_modules/@pipedream/sdk/dist/index.d.ts | grep -A 5 "ConfigurableProp"
```

The `ConfigurableProp` union covers:

| `type` value | UI Control | Notes |
|---|---|---|
| `string` | `<input type="text">` or `<textarea>` | `multiline: true` → textarea; `secret: true` → password |
| `integer` | `<input type="number" step="1">` | |
| `number` | `<input type="number">` | |
| `boolean` | `<input type="checkbox">` | |
| `object` | `<textarea>` (JSON) | Show JSON parse error if invalid |
| `array` | Repeated input rows + add/remove | Items have their own `type` |
| `app` | Account selector button | Calls `PipedreamClientService.connectAccount()` |
| `$.interface.http` | Read-only info box | Shows "this step exposes an HTTP endpoint"; no user input |
| `$.interface.timer` | Cron/interval picker | Two sub-modes: cron string or interval in milliseconds |
| `select` (static options) | `<select>` | `options` is an array of `{ label, value }` |
| `select` (async options) | `<select>` with loading | `options` is a function — call SDK to resolve |
| `data_store` | `<input type="text">` | Value is a store name string |
| `alert` | `<div class="pd-alert">` | Description-only, no input; `alertType`: "info" \| "warning" \| "error" |

Each prop also has:
- `label` — display name (fall back to `name` if absent)
- `description` — markdown text, render as HTML (use `[innerHTML]` with sanitization or a markdown pipe)
- `optional` — if false, field is required
- `hidden` — skip rendering entirely
- `default` — pre-fill value
- `reloadProps` — when this prop's value changes, re-fetch the entire prop set from SDK

---

## File Structure to Create

```
poc/libs/connect-angular/src/lib/components/component-form/
├── component-form.ts
├── component-form.html
├── component-form.css
└── fields/
    ├── string-field.ts
    ├── number-field.ts
    ├── boolean-field.ts
    ├── object-field.ts
    ├── array-field.ts
    ├── app-field.ts          ← OAuth account picker
    ├── select-field.ts
    ├── timer-field.ts
    ├── alert-field.ts
    └── field-wrapper.ts      ← shared label + description + error
```

---

## Step 1 — `FieldWrapperComponent` (shared chrome)

Create `poc/libs/connect-angular/src/lib/components/component-form/fields/field-wrapper.ts`:

```typescript
import { Component, input } from '@angular/core';
import { ConfigurableProp } from '@pipedream/sdk';

@Component({
  selector: 'pd-field-wrapper',
  standalone: true,
  template: `
    <div class="pd-field" [class.pd-field--required]="!prop().optional">
      <label [for]="fieldId()">
        {{ prop().label ?? prop().name }}
        @if (!prop().optional) { <span class="pd-required">*</span> }
      </label>

      <ng-content />

      @if (prop().description) {
        <p class="pd-field-description" [innerHTML]="prop().description"></p>
      }
      @if (error()) {
        <p class="pd-field-error">{{ error() }}</p>
      }
    </div>
  `,
})
export class FieldWrapperComponent {
  prop = input.required<ConfigurableProp>();
  fieldId = input('');
  error = input<string | null>(null);
}
```

---

## Step 2 — Individual field components

Each field component receives `prop` (the `ConfigurableProp` definition) and `value` / `valueChange` for two-way binding.

### `string-field.ts`

```typescript
import { Component, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ConfigurablePropString } from '@pipedream/sdk';
import { FieldWrapperComponent } from './field-wrapper';

@Component({
  selector: 'pd-string-field',
  standalone: true,
  imports: [FormsModule, FieldWrapperComponent],
  template: `
    <pd-field-wrapper [prop]="prop()" [fieldId]="prop().name">
      @if (prop().multiline) {
        <textarea
          [id]="prop().name"
          [ngModel]="value()"
          (ngModelChange)="valueChange.emit($event)"
          [required]="!prop().optional"
          rows="4"
        ></textarea>
      } @else {
        <input
          [id]="prop().name"
          [type]="prop().secret ? 'password' : 'text'"
          [ngModel]="value()"
          (ngModelChange)="valueChange.emit($event)"
          [required]="!prop().optional"
        />
      }
    </pd-field-wrapper>
  `,
})
export class StringFieldComponent {
  prop = input.required<ConfigurablePropString>();
  value = input<string>('');
  valueChange = output<string>();
}
```

Build similar pattern for:
- `NumberFieldComponent` — `<input type="number">`
- `BooleanFieldComponent` — `<input type="checkbox">`
- `ObjectFieldComponent` — `<textarea>` with JSON parse/stringify and inline error
- `TimerFieldComponent` — radio for cron vs interval, then either `<input type="text">` (cron) or `<input type="number">` (ms)
- `AlertFieldComponent` — `<div class="pd-alert pd-alert--{{prop().alertType}}">` with description

### `app-field.ts` (OAuth account connector)

```typescript
import { Component, input, output, signal, inject } from '@angular/core';
import { ConfigurablePropApp } from '@pipedream/sdk';
import { PipedreamClientService } from '../../../services/pipedream-client.service';
import { FieldWrapperComponent } from './field-wrapper';

@Component({
  selector: 'pd-app-field',
  standalone: true,
  imports: [FieldWrapperComponent],
  template: `
    <pd-field-wrapper [prop]="prop()">
      @if (value()) {
        <div class="pd-connected-account">
          <span>Connected: {{ value() }}</span>
          <button type="button" (click)="disconnect()">Disconnect</button>
        </div>
      } @else {
        <button
          type="button"
          class="pd-connect-btn"
          [disabled]="connecting()"
          (click)="connect()"
        >
          {{ connecting() ? 'Connecting...' : 'Connect ' + prop().app }}
        </button>
      }
      @if (error()) {
        <p class="pd-error">{{ error() }}</p>
      }
    </pd-field-wrapper>
  `,
})
export class AppFieldComponent {
  prop = input.required<ConfigurablePropApp>();
  /** value is the connected account ID */
  value = input<string | null>(null);
  valueChange = output<string | null>();

  protected readonly connecting = signal(false);
  protected readonly error = signal<string | null>(null);

  private readonly client = inject(PipedreamClientService);

  protected async connect() {
    this.connecting.set(true);
    this.error.set(null);
    try {
      const result = await this.client.connectAccount(this.prop().app);
      this.valueChange.emit(result.id);
    } catch (e) {
      this.error.set('Connection failed. Please try again.');
    } finally {
      this.connecting.set(false);
    }
  }

  protected disconnect() {
    this.valueChange.emit(null);
  }
}
```

### `select-field.ts` (static + async options)

```typescript
import { Component, input, output, signal, effect, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ConfigurablePropSelect } from '@pipedream/sdk';
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
        <p>Loading options...</p>
      } @else {
        <select
          [id]="prop().name"
          [ngModel]="value()"
          (ngModelChange)="valueChange.emit($event)"
          [required]="!prop().optional"
        >
          <option value="">— Select —</option>
          @for (opt of resolvedOptions(); track opt.value) {
            <option [value]="opt.value">{{ opt.label }}</option>
          }
        </select>
      }
    </pd-field-wrapper>
  `,
})
export class SelectFieldComponent {
  prop = input.required<ConfigurablePropSelect>();
  value = input<unknown>(null);
  valueChange = output<unknown>();
  /** Pass the current configured props so async options can use them as context */
  configuredProps = input<Record<string, unknown>>({});

  protected readonly resolvedOptions = signal<SelectOption[]>([]);
  protected readonly loading = signal(false);

  private readonly client = inject(PipedreamClientService);

  constructor() {
    effect(async () => {
      const prop = this.prop();
      const opts = prop.options;
      if (Array.isArray(opts)) {
        // Static options
        this.resolvedOptions.set(
          opts.map((o) =>
            typeof o === 'string' ? { label: o, value: o } : o
          )
        );
      } else if (typeof opts === 'function') {
        // Async options — call via SDK
        // TODO: verify exact SDK method for resolving dynamic options
        // This may require calling client.raw with the component's options endpoint
        this.loading.set(true);
        try {
          // Placeholder — implement once SDK API is confirmed
          const result = await (opts as Function)({ configuredProps: this.configuredProps() });
          this.resolvedOptions.set(result ?? []);
        } catch {
          this.resolvedOptions.set([]);
        } finally {
          this.loading.set(false);
        }
      }
    });
  }
}
```

> **Note on async options**: Pipedream's async `options` functions are server-side — they don't run directly in the browser. The SDK exposes an endpoint to resolve them. Check `@pipedream/connect-react` source or SDK types for `client.components.options()` or similar. The `configuredProps` context is passed so the options can be scoped (e.g. "list channels for this connected Slack account").

### `array-field.ts`

```typescript
import { Component, input, output, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ConfigurablePropArray } from '@pipedream/sdk';
import { FieldWrapperComponent } from './field-wrapper';

@Component({
  selector: 'pd-array-field',
  standalone: true,
  imports: [FormsModule, FieldWrapperComponent],
  template: `
    <pd-field-wrapper [prop]="prop()">
      @for (item of items(); track $index) {
        <div class="pd-array-row">
          <input
            type="text"
            [ngModel]="item"
            (ngModelChange)="updateItem($index, $event)"
          />
          <button type="button" (click)="removeItem($index)">−</button>
        </div>
      }
      <button type="button" (click)="addItem()">+ Add item</button>
    </pd-field-wrapper>
  `,
})
export class ArrayFieldComponent {
  prop = input.required<ConfigurablePropArray>();
  value = input<unknown[]>([]);
  valueChange = output<unknown[]>();

  protected readonly items = computed(() => this.value() ?? []);

  protected addItem() {
    this.valueChange.emit([...this.items(), '']);
  }

  protected removeItem(index: number) {
    const next = [...this.items()];
    next.splice(index, 1);
    this.valueChange.emit(next);
  }

  protected updateItem(index: number, val: unknown) {
    const next = [...this.items()];
    next[index] = val;
    this.valueChange.emit(next);
  }
}
```

---

## Step 3 — `ComponentFormComponent` (main orchestrator)

Create `poc/libs/connect-angular/src/lib/components/component-form/component-form.ts`:

```typescript
import {
  Component, input, output, signal, computed, effect, inject, OnInit
} from '@angular/core';
import { Component as PdComponent, ConfigurableProp, ConfiguredProps } from '@pipedream/sdk';
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

  private readonly client = inject(PipedreamClientService);

  constructor() {
    // Load props from component definition; re-run when component input changes
    effect(() => {
      const comp = this.component();
      this.props.set(comp.configurable_props ?? []);
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
      await this.reloadProps(updated);
    }
  }

  protected onSubmit() {
    this.submitted.emit(this.configuredProps());
  }

  private async reloadProps(currentConfiguredProps: ConfiguredProps) {
    this.reloading.set(true);
    try {
      // TODO: implement using PipedreamClientService.configureProps()
      // once the SDK method is identified (see PLAN-02 notes on configureProps)
      const result = await this.client.configureProps(
        this.component().key,
        currentConfiguredProps as Record<string, unknown>
      );
      // result should include updated `configurable_props`
      // this.props.set(result.configurable_props ?? []);
    } catch (e) {
      console.error('Failed to reload props', e);
    } finally {
      this.reloading.set(false);
    }
  }
}
```

### `component-form.html`

```html
<form class="pd-component-form" (ngSubmit)="onSubmit()">
  @if (reloading()) {
    <div class="pd-reloading-overlay">Updating form...</div>
  }

  @for (prop of props(); track prop.name) {
    @if (!prop.hidden) {
      @switch (prop.type) {
        @case ('string') {
          <pd-string-field
            [prop]="prop"
            [value]="propValue(prop)"
            (valueChange)="onFieldChange(prop, $event)"
          />
        }
        @case ('integer') {
          <pd-number-field
            [prop]="prop"
            [value]="propValue(prop)"
            (valueChange)="onFieldChange(prop, $event)"
          />
        }
        @case ('number') {
          <pd-number-field
            [prop]="prop"
            [value]="propValue(prop)"
            (valueChange)="onFieldChange(prop, $event)"
          />
        }
        @case ('boolean') {
          <pd-boolean-field
            [prop]="prop"
            [value]="propValue(prop)"
            (valueChange)="onFieldChange(prop, $event)"
          />
        }
        @case ('object') {
          <pd-object-field
            [prop]="prop"
            [value]="propValue(prop)"
            (valueChange)="onFieldChange(prop, $event)"
          />
        }
        @case ('array') {
          <pd-array-field
            [prop]="prop"
            [value]="propValue(prop)"
            (valueChange)="onFieldChange(prop, $event)"
          />
        }
        @case ('app') {
          <pd-app-field
            [prop]="prop"
            [value]="propValue(prop)"
            (valueChange)="onFieldChange(prop, $event)"
          />
        }
        @case ('select') {
          <pd-select-field
            [prop]="prop"
            [value]="propValue(prop)"
            [configuredProps]="configuredProps()"
            (valueChange)="onFieldChange(prop, $event)"
          />
        }
        @case ('$.interface.timer') {
          <pd-timer-field
            [prop]="prop"
            [value]="propValue(prop)"
            (valueChange)="onFieldChange(prop, $event)"
          />
        }
        @case ('$.interface.http') {
          <div class="pd-alert pd-alert--info">
            This step will be triggered via an HTTP webhook endpoint,
            which Pipedream generates after deployment.
          </div>
        }
        @case ('alert') {
          <pd-alert-field [prop]="prop" />
        }
        @default {
          <!-- Unknown prop type: render as text input with type label -->
          <pd-string-field
            [prop]="prop"
            [value]="propValue(prop)"
            (valueChange)="onFieldChange(prop, $event)"
          />
        }
      }
    }
  }

  <button type="submit" class="pd-submit-btn" [disabled]="submitting() || reloading()">
    {{ submitting() ? 'Saving...' : 'Save' }}
  </button>
</form>
```

---

## Step 4 — Export from library

Add to `poc/libs/connect-angular/src/index.ts`:

```typescript
export { ComponentFormComponent } from './lib/components/component-form/component-form';
```

---

## Step 5 — Resolve the dynamic props SDK method

Before considering this plan done, complete the `configureProps` method in `PipedreamClientService` (see PLAN-02).

Investigation steps:
1. Read `/Users/dmitry/projects/forks/pipedream/packages/connect-react/src/components/InternalComponentForm.tsx` — this is the authoritative source for how dynamic props reload works in the React implementation; find where `reloadProps` is detected and what SDK call it triggers
2. Read `/Users/dmitry/projects/forks/pipedream/packages/connect-react/src/hooks/form-context.tsx` — shows the form state shape and how configuredProps are managed
3. Check SDK types: `cat poc/node_modules/@pipedream/sdk/dist/index.d.ts | grep -i "prop\|configure" | head -40`
4. The likely API pattern based on Pipedream's REST API is something like: `POST /components/{key}/props` with `{ configured_props }` in the body

Once confirmed, update `PipedreamClientService.configureProps()` and then complete `ComponentFormComponent.reloadProps()`.

---

## Files Created / Modified

| File | Action |
|------|--------|
| `poc/libs/connect-angular/src/lib/components/component-form/component-form.ts` | Create |
| `poc/libs/connect-angular/src/lib/components/component-form/component-form.html` | Create |
| `poc/libs/connect-angular/src/lib/components/component-form/component-form.css` | Create |
| `poc/libs/connect-angular/src/lib/components/component-form/fields/field-wrapper.ts` | Create |
| `poc/libs/connect-angular/src/lib/components/component-form/fields/string-field.ts` | Create |
| `poc/libs/connect-angular/src/lib/components/component-form/fields/number-field.ts` | Create |
| `poc/libs/connect-angular/src/lib/components/component-form/fields/boolean-field.ts` | Create |
| `poc/libs/connect-angular/src/lib/components/component-form/fields/object-field.ts` | Create |
| `poc/libs/connect-angular/src/lib/components/component-form/fields/array-field.ts` | Create |
| `poc/libs/connect-angular/src/lib/components/component-form/fields/app-field.ts` | Create |
| `poc/libs/connect-angular/src/lib/components/component-form/fields/select-field.ts` | Create |
| `poc/libs/connect-angular/src/lib/components/component-form/fields/timer-field.ts` | Create |
| `poc/libs/connect-angular/src/lib/components/component-form/fields/alert-field.ts` | Create |
| `poc/libs/connect-angular/src/index.ts` | Append export |

## Notes

- `prop.type` for `app` props uses the app's name slug (e.g. `"slack"`), not literally `"app"`. The SDK's `ConfigurablePropApp` has `type: string` with a specific structure. Verify against SDK types and adjust the `@case ('app')` check if needed — it may need to check `prop.app !== undefined` instead of `prop.type === 'app'`
- `$.interface.http` and `$.interface.timer` are trigger-only prop types; they configure how the workflow is triggered
- The `[innerHTML]` binding for `prop.description` is safe here because descriptions come from Pipedream's own API, not user input
