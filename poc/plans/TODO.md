1. it should show "connect" prompts in the UI
2. make sure we're able to autogenerate the whole flow
3. openai gets serialized objects
4. rewrite to use a real db instead of KV, reuse models
5. interpolation should be resolved when testing the step
6. suggestions and validation of interpolation in the UI
7. show steps progress
<!-- 3. have a place to manage connected accounts -->


Bugs:
1. when account is disconnected, it's not reflected in the workflow
2. sometimes connected accounts do not show authorized data until you reconnect

<!-- 
NOTES
we need to be able to resolve interpolation in fields. I'd like to 

1. show an object with all possible values. when you click on a certain property, it's path gets injected in the field
2. validate interpolation in the ui
 -->