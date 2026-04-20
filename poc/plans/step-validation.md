# Step Validation & Reference Integrity

## Problem

The LLM can hallucinate step output paths (e.g. `{{steps.google_calendar_list_events.$return_value.event_text}}` when `event_text` doesn't exist), and those bad references pass silently through `set_step_props` and only fail at execution time — after the user has already seen a broken workflow run.

Three things need to change:

1. **Sequential test enforcement** — step N can only be tested if step N-1 is already tested.
2. **Rich output snapshots** — store the actual return value of each tested step so downstream steps have real paths to reference.
3. **Reference validation in `set_step_props`** — reject `{{steps.X.Y}}` references that don't resolve against stored snapshots, with an enumerated list of valid paths (also the foundation for future autocomplete).

---

## 1. Sequential Test Enforcement

### Rule
`test_step` for step at index N is only allowed if the step at index N-1 has `tested: true`.

Both of the following satisfy the requirement:
- The step was tested individually via the `test_step` tool.
- The step was executed as part of a full workflow run (which marks every step tested in order).

### Where to enforce
- **`WorkflowService.testStep()`** — check the preceding step's `tested` flag before running; throw if not satisfied.
- **`test_step` tool handler** — surface a clear error to the LLM: _"Step N cannot be tested until step N-1 is tested first."_
- **`executeWorkflow()`** — after each step succeeds, mark it `tested: true` and store its snapshot (see §2), then continue to the next step.

### Context for interpolation during isolated test
When testing step N individually, the engine builds the interpolation context from the **stored snapshots** of steps 1..N-1 (not by re-executing them). This means isolated testing is cheap and deterministic.

---

## 2. Storing Actual Output Snapshots

### What to store
After a step is successfully tested (individually or via full workflow run), store the full execution result on the step:

```ts
interface StepSnapshot {
  $return_value: unknown;       // exact ret from pd.actions.run
  exports: Record<string, unknown>; // exact exports
}
```

Store this as `step.outputSnapshot: StepSnapshot` on the `WorkflowStep` model, alongside the existing `tested: boolean`.

### Why actual values, not type placeholders
Real values give the LLM (and future autocomplete) meaningful context. `"2026-04-20T17:30:00+03:00"` tells the LLM it's an ISO datetime and helps it construct correct downstream expressions. A placeholder like `"<string>"` conveys no useful information.

### What gets returned to the LLM
`get_active_workflow` should include the snapshot for each tested step, so the LLM has real paths and values to work with when constructing references for downstream props.

---

## 3. Reference Validation in `set_step_props`

### Core utility: `enumeratePaths(snapshot)`
A single utility that walks a snapshot object and returns every valid dot-path as a flat list:

```ts
// Input:
{ $return_value: [{ id: "evt1", start: { dateTime: "2026-04-20T17:30:00+03:00" } }] }

// Output:
[
  "$return_value",
  "$return_value.0",
  "$return_value.0.id",
  "$return_value.0.start",
  "$return_value.0.start.dateTime",
]
```

This same function serves two purposes:
- **Validation** — check if a given path is in the list.
- **Autocomplete (future)** — return the full list as suggestions when the user types `{{steps.X.`.

### Validation flow in `set_step_props`
For each prop value being set:

1. Extract all `{{steps.SLUG.PATH}}` patterns via regex.
2. For each match:
   - Verify `SLUG` corresponds to a step that exists in the workflow.
   - Verify that step has `tested: true` and a stored `outputSnapshot`.
   - Check whether `PATH` exists in `enumeratePaths(outputSnapshot)`.
3. If any check fails, reject the call and return:
   - The specific unresolved reference.
   - The list of valid paths from that step's snapshot.

### Where this runs
**Client-side in `set_step_props` tool handler** (`chat-panel.ts`).

Rationale:
- The tool handler already has full workflow state via `WorkflowService`.
- The LLM gets immediate structured feedback in the same turn and can self-correct.
- No server round-trip needed for what is a structural path-existence check.
- The server-side `resolveInterpolations` throw remains as a final execution-time backstop.

### Example error response
```json
{
  "success": false,
  "error": "Invalid reference {{steps.google_calendar_list_events.$return_value.event_text}} — path not found in step output.",
  "availablePaths": [
    "steps.google_calendar_list_events.$return_value",
    "steps.google_calendar_list_events.$return_value.0",
    "steps.google_calendar_list_events.$return_value.0.id",
    "steps.google_calendar_list_events.$return_value.0.summary",
    "steps.google_calendar_list_events.$return_value.0.start",
    "steps.google_calendar_list_events.$return_value.0.start.dateTime"
  ]
}
```

---

## Files Affected

| File | Change |
|------|--------|
| `poc/libs/data-access-api/src/lib/workflow.model.ts` | Add `outputSnapshot` to `WorkflowStep`; update `StepOutputSchema` or replace with richer type |
| `poc/libs/data-access-api/src/lib/services/workflow.service.ts` | Enforce sequential test order; store snapshot after test; build interpolation context from snapshots |
| `poc/libs/feature-workflow-builder/src/lib/components/chat-panel/chat-panel.ts` | Add `enumeratePaths` utility; validate references in `set_step_props`; update `test_step` error message; include snapshots in `get_active_workflow` response |
| `poc/apps/api/src/services/workflow-engine.ts` | Store snapshot on each step after execution in `executeWorkflow`; build interpolation context from stored snapshots when testing a single step |
| `poc/apps/api/src/services/workflow-engine.test.ts` | Tests for sequential enforcement, snapshot storage, interpolation from snapshots |
