# Double JSON Response from Azure OpenAI / Hashbrown

## Problem

The LLM (Azure GPT-4o via `@hashbrownai/azure` v0.4.1) occasionally returns two JSON objects
in a single response instead of one. This produces a malformed response that the client
cannot parse correctly.

The model is `gpt-4o@2025-01-01-preview` configured in `uiChatResource` inside
`poc/libs/feature-workflow-builder/src/lib/components/chat-panel/chat-panel.ts`.

No `response_format`, `strict`, or structured-output options are currently set.

---

## Likely Causes (in order of probability)

### 1. Component rendering + tool call in the same turn
`uiChatResource` uses `exposeComponent(...)` for three UI components (MarkdownComponent,
WorkflowSuggestionCard, ConnectAppComponent). Hashbrownai asks the model to emit a JSON
object to describe which component to render alongside its text response. If the model
also emits a tool call in the same turn, Azure returns a message with both non-null
`content` (the component JSON) AND non-null `tool_calls` — two separate JSON blobs.

### 2. Model "thinking" preamble
GPT-4o sometimes emits a scratch-pad JSON object before the actual structured response,
concatenated without a separator: `{...}{...}`.

### 3. Strict mode not enabled
Azure OpenAI supports `"strict": true` in the `response_format.json_schema`. Without it
the model has more freedom to deviate from the schema and can emit extra content.

---

## Debug Steps

### Step 1 — Capture the raw Azure response

Add logging in `poc/apps/api/src/index.ts` at the `/api/chat` handler, before hashbrownai
processes the response, to capture:

- `choices[0].message.content` — two JSON objects here = model preamble problem
- `choices[0].message.tool_calls` — two entries here = duplicate tool call problem
- Both non-null simultaneously = component rendering collision (most likely)

For streaming, capture the raw SSE `data:` lines before they are parsed.

### Step 2 — Inspect the request body hashbrownai sends to Azure

Log the full request body (`messages`, `tools`, `response_format`) that hashbrownai
constructs. Check:

- Is `response_format` set at all?
- If a JSON schema is present, does it include `"strict": true`?
- How are components encoded in the `tools` array?

### Step 3 — Check hashbrownai 0.4.1 API surface

Look for a `strict` or `structuredOutputs` option on `uiChatResource` in the hashbrownai
source (`node_modules/@hashbrownai/core` or their GitHub). If it exists, enable it in
`chat-panel.ts`:

```ts
uiChatResource({
  model: 'gpt-4o@2025-01-01-preview',
  strict: true,            // try this
  // or: structuredOutputs: true,
  ...
})
```

---

## Fix Options

### Option A — Enable strict mode in hashbrownai (preferred)
If hashbrownai exposes the option, pass it to `uiChatResource`. This enforces the schema
at the token level and physically prevents the model from emitting two objects.

### Option B — Open an issue / PR on hashbrownai
If strict mode is not exposed, the fix belongs in hashbrownai: pass `"strict": true` in
the `response_format.json_schema` it constructs for component schemas, and set
`parallel_tool_calls: false` to prevent the model from emitting multiple tool calls in
one turn.

### Option C — Client-side defensive parsing
As a stopgap while Option A/B is pursued, add a response interceptor that extracts the
last complete JSON object from the raw content string. Libraries like `json-repair` handle
the `{...}{...}` concatenation case.

---

## Files Involved

| File | Role |
|------|------|
| `poc/apps/api/src/index.ts` | `/api/chat` endpoint — add logging here to capture raw Azure response |
| `poc/libs/feature-workflow-builder/src/lib/components/chat-panel/chat-panel.ts` | `uiChatResource` config — add strict option here once confirmed available |
| `node_modules/@hashbrownai/core` | Check available options on `uiChatResource` |
