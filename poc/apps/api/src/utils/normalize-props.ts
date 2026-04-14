import type { ConfigurableProp } from '@pipedream/sdk';

/**
 * Wraps bare-string app-type props into `{ authProvisionId: value }` objects
 * as expected by the Pipedream API. Server-side equivalent of the frontend's
 * PipedreamClientService.normalizeAppProps().
 */
export function normalizeAppProps(
  configuredProps: Record<string, unknown>,
  configurableProps: ConfigurableProp[],
): Record<string, unknown> {
  const appPropNames = new Set(
    configurableProps
      .filter((p) => (p as { type: string }).type === 'app')
      .map((p) => p.name),
  );

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(configuredProps)) {
    if (appPropNames.has(key) && typeof value === 'string') {
      result[key] = { authProvisionId: value };
    } else {
      result[key] = value;
    }
  }
  return result;
}
