# PLAN-05 Implementation Summary — Workflow Data Model & WorkflowService

**Status:** Complete. Build passes (`nx build connect-angular`).

---

## Files Created

| File | Purpose |
|------|---------|
| `poc/libs/connect-angular/src/lib/models/workflow.model.ts` | `Workflow`, `WorkflowStep`, `WorkflowStepData`, `PipedreamStep`, `CustomTriggerStep` interfaces |
| `poc/libs/connect-angular/src/lib/services/workflow.service.ts` | `WorkflowService` — signal-based service with CRUD, step management, and localStorage persistence |

## Files Modified

| File | Change |
|------|--------|
| `poc/libs/connect-angular/src/index.ts` | Added `export type` re-exports for workflow model interfaces and `export` for `WorkflowService` |

---

## Corrections Made vs. Plan

| Issue | Plan said | Actual implementation |
|-------|-----------|----------------------|
| Model imports | `import { App, Component as PdComponent, ConfiguredProps }` (value imports) | Used `import type { ... }` — required by `isolatedModules: true` (consistent with prior plan fixes) |
| `addStep` return type | Not annotated | Added `: WorkflowStep` return type annotation to silence TypeScript strict mode |

---

## Design Decisions

- **`import type`**: All SDK type imports in `workflow.model.ts` use `import type` to satisfy `isolatedModules: true`, consistent with PLAN-02's corrections.
- **`providedIn: 'root'`**: `WorkflowService` is tree-shakeable and app-wide — no need to provide it manually.
- **localStorage serialization**: `App` and `PdComponent` from the SDK are plain JSON objects, so `JSON.stringify`/`JSON.parse` round-trips safely.
- **Trigger always at index 0**: `reorderSteps` enforces this by re-typing all steps after each reorder.

---

## Service API

### `WorkflowService`

| Member | Type | Description |
|--------|------|-------------|
| `workflows` | `Signal<Workflow[]>` (readonly) | All workflows |
| `activeWorkflow` | `Signal<Workflow \| null>` (computed) | Currently active workflow |
| `activeSteps` | `Signal<WorkflowStep[]>` (computed) | Steps of the active workflow |
| `createWorkflow(name?)` | `→ Workflow` | Creates a workflow with one empty trigger step; sets it as active |
| `updateWorkflow(id, patch)` | `→ void` | Updates name/description |
| `deleteWorkflow(id)` | `→ void` | Removes workflow; clears active if deleted |
| `setActiveWorkflow(id \| null)` | `→ void` | Sets the active workflow |
| `addStep(workflowId)` | `→ WorkflowStep` | Appends an empty action step |
| `removeStep(workflowId, stepId)` | `→ void` | Removes a step by id |
| `configureStep(workflowId, stepId, data)` | `→ void` | Sets step data (app/component/props or custom trigger) |
| `reorderSteps(workflowId, prevIdx, curIdx)` | `→ void` | Reorders steps; re-types step at index 0 as trigger |
