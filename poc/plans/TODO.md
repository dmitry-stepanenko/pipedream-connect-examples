<!-- 1. it should show "connect" prompts in the UI -->
<!-- 2. make sure we're able to autogenerate the whole flow -->
<!-- 3. openai gets serialized objects -->
<!-- 4. rewrite to use a real db instead of KV, reuse models -->
<!-- 5. interpolation should be resolved when testing the step -->
6. suggestions of interpolation in the UI
<!-- 6. validation of interpolation in the UI -->
7. show steps progress
<!-- 8. workflows pages with filters, list of trigger events and runs -->
<!-- 3. have a place to manage connected accounts -->
- prevent repitive tool calls if LLM goes into a loop? maybe validate it's not called more than N times?
- add an ability to review mid-process
- add autosave with debounce, make sure we always use the workflow from the response
- additional suggestions for the selected action? e.g. if openai we would want to always use "chat"
- add conditions (like if/then or split)
- how "generate test event" play along with already published trigger?
- try now vs emit test event in the trigger?
- we can see triggers on a separate page, but we may have events separately? should we display this somehow?

Bugs:
<!-- 1. when account is disconnected, it's not reflected in the workflow -->
2. sometimes connected accounts do not show authorized data until you reconnect
3. if configure step throws, it may try to call it again and again indefinitely
 - not set checkboxes should not be treated as required
<!-- 4. it's not always asking to connect or when it does, the llm stream is not finished -->
<!-- 5. AI Chat does not wait for auth-guarded data of the step to be loaded -->

<!-- 
NOTES
we need to be able to resolve interpolation in fields. I'd like to 

1. show an object with all possible values. when you click on a certain property, it's path gets injected in the field
2. validate interpolation in the ui
 -->
 - reorder steps
 - other triggers
 - review should self heal the workflow
