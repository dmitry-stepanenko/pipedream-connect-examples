# PLAN-04 Implementation Summary — ComponentForm (Dynamic Forms)

**Status:** Complete. Build passes (`nx build connect-angular`).

---

## Files Created

| File | Purpose |
|------|---------|
| `.../component-form/component-form.ts` | `ComponentFormComponent` — main orchestrator, renders dynamic form based on component's `configurableProps` |
| `.../component-form/component-form.html` | Template with `@switch`/`@if`/`@for` dispatching props to field components |
| `.../component-form/component-form.css` | Form layout, reloading overlay, submit button styles |
| `.../component-form/fields/field-wrapper.ts` | `FieldWrapperComponent` — shared label, description, required indicator, error display |
| `.../component-form/fields/string-field.ts` | `StringFieldComponent` — text input, textarea (multiline), password (secret) |
| `.../component-form/fields/number-field.ts` | `NumberFieldComponent` — number input with step/min/max for integer and number types |
| `.../component-form/fields/boolean-field.ts` | `BooleanFieldComponent` — checkbox |
| `.../component-form/fields/object-field.ts` | `ObjectFieldComponent` — JSON textarea with parse validation |
| `.../component-form/fields/array-field.ts` | `ArrayFieldComponent` — repeated text inputs with add/remove |
| `.../component-form/fields/app-field.ts` | `AppFieldComponent` — OAuth account connector via `PipedreamClientService.connectAccount()` |
| `.../component-form/fields/select-field.ts` | `SelectFieldComponent` — static options or remote options via `configureProp` API |
| `.../component-form/fields/timer-field.ts` | `TimerFieldComponent` — cron/interval radio toggle |
| `.../component-form/fields/alert-field.ts` | `AlertFieldComponent` — info/warning/error display-only field |

All paths relative to `poc/libs/connect-angular/src/lib/components/`.

## Files Modified

| File | Change |
|------|--------|
| `poc/libs/connect-angular/src/index.ts` | Added `ComponentFormComponent` export |
| `poc/libs/connect-angular/src/lib/services/pipedream-client.service.ts` | Implemented `reloadProps()` and `configureProp()` methods using SDK's `client.components.reloadProps()` and `client.components.configureProp()`. Deprecated the old `configureProps()` stub. |
| `poc/libs/connect-angular/src/lib/components/app-selector/app-selector.ts` | Fixed `name_slug` → `nameSlug` (pre-existing SDK type mismatch) |
| `poc/libs/connect-angular/src/lib/components/component-selector/component-selector.ts` | Fixed `name_slug` → `nameSlug` (same) |

---

## Corrections Made vs. Plan

| Issue | Plan said | Actual implementation |
|-------|-----------|----------------------|
| Prop type discrimination | Plan used `@case ('app')` for app type | Confirmed correct — SDK types have `type: "app"` literal in `ConfigurableProp.App` |
| Array prop type | Plan used `'array'` | SDK uses `'string[]'` and `'integer[]'` — both handled |
| `configureProps()` method | Plan assumed a `configureProps` SDK method | SDK has two separate methods: `reloadProps` (re-fetch prop definitions after a `reloadProps: true` prop changes) and `configureProp` (fetch remote options for a single prop) |
| Select field options | Plan called `opts` as a function directly | Remote options use `prop.remoteOptions: true` flag + `client.components.configureProp()` API call, not a local function |
| Import paths for types | Plan imported specific types like `ConfigurablePropString` | Used `ConfigurableProp` union with type assertions — avoids importing dozens of sub-types that may not be directly exported from `@pipedream/sdk/browser` |
| Dynamic props reload | Plan had a TODO placeholder | Fully implemented: slices visible props during reload, restores on error, tracks `dynamicPropsId`, cleans up `configuredProps` after reload |
| Options-with-select routing | Plan dispatched only on `prop.type` | Added `hasOptions()` check — props with `remoteOptions: true` or static `options[]` render as select regardless of their base type |

---

## Design Decisions

- **Type assertions over specific imports**: Field components accept `ConfigurableProp` and cast to access type-specific fields. This avoids coupling to internal SDK type names and keeps imports clean.
- **`hasOptions()` guard in template**: Props with `remoteOptions` or static `options` are routed to `SelectFieldComponent` before the `@switch` on `prop.type`, matching the React implementation's pattern.
- **`dynamicPropsId` tracking**: Stored in a signal on `ComponentFormComponent`, passed through to `SelectFieldComponent` for remote options calls, ensuring dynamic prop contexts are preserved.
- **Props slicing during reload**: When a `reloadProps` change triggers, props below the trigger point are hidden (matching React's behavior) to prevent stale UI.

---

## Component API

### `pd-component-form`

| Input/Output | Type | Description |
|-------------|------|-------------|
| `component` (input, required) | `Component` | Pipedream component definition |
| `configuredProps` (input) | `ConfiguredProps` | Current prop values |
| `configure` (output) | `ConfiguredProps` | Emitted on every field change |
| `submitted` (output) | `ConfiguredProps` | Emitted on form submit |

### Service Methods Added

| Method | Signature | Description |
|--------|-----------|-------------|
| `reloadProps` | `(componentKey, configuredProps, dynamicPropsId?) → Promise<ReloadPropsResponse>` | Re-fetch prop definitions after dynamic prop trigger |
| `configureProp` | `(componentKey, propName, configuredProps, dynamicPropsId?, query?) → Promise<ConfigurePropResponse>` | Fetch remote options for a single prop |
