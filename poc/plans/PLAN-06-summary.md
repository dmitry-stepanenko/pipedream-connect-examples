# PLAN-06 Implementation Summary — Workflow Builder UI

**Status:** Complete. Build passes (`nx build connect-angular`).

---

## Files Created

| File | Purpose |
|------|---------|
| `.../workflow-list/workflow-list.ts` | `WorkflowListComponent` — lists saved workflows, create/delete/select |
| `.../workflow-list/workflow-list.html` | Template with `@if`/`@for`, active state, empty state |
| `.../workflow-list/workflow-list.css` | List layout, item styles, shared button classes |
| `.../workflow-builder/workflow-builder.ts` | `WorkflowBuilderComponent` — main canvas with CDK drag-drop |
| `.../workflow-builder/workflow-builder.html` | Step chain template with inline name editing |
| `.../workflow-builder/workflow-builder.css` | Builder layout, connector arrows, CDK drag-drop preview styles |
| `.../workflow-step/workflow-step.ts` | `WorkflowStepComponent` — step card with collapsed/expanded states |
| `.../workflow-step/workflow-step.html` | Header with step summary + expandable body for picker/form |
| `.../workflow-step/workflow-step.css` | Step card, index badge, action buttons |
| `.../step-picker/step-picker.ts` | `StepPickerComponent` — multi-mode picker (custom triggers → app → component) |
| `.../step-picker/step-picker.html` | `@switch`-based mode navigation |
| `.../step-picker/step-picker.css` | Picker layout, custom trigger list, back button |

All paths relative to `poc/libs/connect-angular/src/lib/components/`.

## Files Modified

| File | Change |
|------|--------|
| `poc/libs/connect-angular/src/index.ts` | Added 4 component exports |
| `poc/package.json` | Added `@angular/cdk@21.2.6` |

---

## Corrections Made vs. Plan

| Issue | Plan said | Actual implementation |
|-------|-----------|----------------------|
| `pipedreamData` / `customData` / `customTriggerName` | Defined as `get` getters, but template used `()` call syntax | Converted to `computed()` signals so `pipedreamData()` works in templates |
| `customTriggerName` in template | Used without `()` (`{{ customTriggerName }}`) | Changed to `{{ customTriggerName() }}` to match computed signal |
| Model imports in `workflow-step.ts` | `import { WorkflowStep, ... }` (value import) | Used `import type { ... }` — consistent with `isolatedModules: true` fix from PLAN-02/05 |
| `ConfiguredProps` import in `workflow-step.ts` | `import { ConfiguredProps }` (value import) | Used `import type { ConfiguredProps }` — only used as type annotation |

---

## Design Decisions

- **Computed signals over getters**: `pipedreamData`, `customData`, and `customTriggerName` are `computed()` signals rather than getters. This ensures consistent `()` call syntax in templates and proper change detection via the signal graph.
- **CDK drag-drop**: Trigger step (index 0) is non-draggable via `[cdkDragDisabled]="i === 0"` and `onDrop` guards prevent other steps from taking position 0.
- **`StepPickerComponent` mode machine**: Uses a `signal<PickerMode>` with `@switch` to navigate between source selection, app browsing, and component selection — no router needed.
- **Inline name editing**: `WorkflowBuilderComponent` toggles between an `<h2>` and an `<input>` via `editingName` signal. Saves on blur or Enter, cancels on Escape.

---

## Component API

### `pd-workflow-list`

| Input/Output | Type | Description |
|-------------|------|-------------|
| `open` (output) | `string` | Emits workflow id when user creates or selects a workflow |

### `pd-workflow-builder`

No inputs — reads from `WorkflowService.activeWorkflow()` directly.

### `pd-workflow-step`

| Input/Output | Type | Description |
|-------------|------|-------------|
| `step` (input, required) | `WorkflowStep` | The step data |
| `workflowId` (input, required) | `string` | Parent workflow id |
| `stepIndex` (input, required) | `number` | Position in the step chain |
| `remove` (output) | `void` | Emitted when user clicks remove |

### `pd-step-picker`

| Input/Output | Type | Description |
|-------------|------|-------------|
| `stepType` (input, required) | `'trigger' \| 'action'` | Determines which components to show |
| `picked` (output) | `WorkflowStepData` | Emitted when user picks a trigger/action |
