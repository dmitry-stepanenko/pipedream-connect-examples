# PLAN-07 Summary — myapp: Wiring Everything Together

**Status:** Complete. Build passes (`nx build myapp`).

## Files Created

| File | Description |
|------|-------------|
| `apps/myapp/src/environments/environment.ts` | Dev environment config (apiUrl: `http://localhost:3333`) |
| `apps/myapp/src/environments/environment.prod.ts` | Prod environment config (apiUrl: `/api`) |

## Files Modified

| File | Change |
|------|--------|
| `apps/myapp/src/app/app.config.ts` | Replaced NX scaffold with `provideConnectAngular()`, `provideCustomTriggers()`, and 3 sample custom triggers |
| `apps/myapp/src/app/app.ts` | Replaced NX scaffold with sidebar + main layout importing `WorkflowListComponent` and `WorkflowBuilderComponent`; switched to inline template/styles |
| `apps/myapp/src/styles.scss` | Added CSS reset, `.pd-btn` variants, `.pd-connector` styles |
| `apps/myapp/project.json` | Added `fileReplacements` for production environment config |

## Library Fixes (pre-existing issues caught by app template type-checking)

| File | Issue | Fix |
|------|-------|-----|
| `libs/connect-angular/src/lib/components/app-selector/app-selector.html` | `app.img` — property doesn't exist on SDK `App` type | Changed to `app.imgSrc` (correct SDK property) |
| `libs/connect-angular/src/lib/components/workflow-step/workflow-step.html` | Same `img` → `imgSrc` issue | Changed to `imgSrc` |
| `libs/connect-angular/src/lib/components/component-form/component-form.ts` | `propValue()` returned `unknown`, incompatible with field component inputs | Changed return type to `any` |
| `libs/connect-angular/src/lib/components/component-form/component-form.html` | `@case ('number')` — not a valid `ConfigurableProp.type` value | Removed case (SDK uses `'integer'` only; `@default` handles unexpected types) |
| `libs/connect-angular/src/lib/components/component-form/fields/number-field.ts` | `min`/`max` were `number \| undefined`, binding expects `string \| number \| null` | Added `?? null` fallback |

## Corrections vs. Plan

| Issue | Plan said | Actual |
|-------|-----------|--------|
| Component class name | `AppComponent` | NX generated `App` (matching `main.ts` import) — kept as `App` |
| Emoji encoding | Raw emoji characters in `icon` fields | Used Unicode escapes (`\u{1F6D2}` etc.) for safety |
| `CustomTrigger` import | Value import | `import type { CustomTrigger }` — required by `isolatedModules: true` (consistent with prior plans) |

## Design Decisions

- **Inline template/styles**: `app.ts` switched from external `templateUrl`/`styleUrl` to inline `template`/`styles` since the template is short. The orphaned `app.html` and `app.scss` files remain but are no longer referenced.
- **Class name kept as `App`**: NX generated the class as `App` and `main.ts` imports it as `App`. The plan called it `AppComponent` but renaming would break the bootstrap — kept the NX-generated name.
- **Router removed**: The plan doesn't use routing; removed `provideRouter(appRoutes)` from `app.config.ts`. The app uses the workflow builder directly.

## Running the Demo

```bash
# Terminal 1 — API (must have .env credentials configured per PLAN-01)
cd poc && npx nx serve api

# Terminal 2 — Angular app
cd poc && npx nx serve myapp
```

Open `http://localhost:4200` to see the workflow builder demo.
