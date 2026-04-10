import { EnvironmentProviders, makeEnvironmentProviders } from '@angular/core';
import { PIPEDREAM_CONFIG, PipedreamConnectConfig } from './tokens/pipedream-config.token';

/**
 * Call in app.config.ts to configure the connect-angular library.
 *
 * @example
 * // app.config.ts
 * export const appConfig: ApplicationConfig = {
 *   providers: [
 *     provideConnectAngular({
 *       tokenEndpointUrl: 'http://localhost:3333/api/pipedream/token',
 *       externalUserId: 'user-123',
 *     }),
 *     provideCustomTriggers([...]),
 *   ]
 * };
 */
export function provideConnectAngular(
  config: PipedreamConnectConfig
): EnvironmentProviders {
  return makeEnvironmentProviders([
    { provide: PIPEDREAM_CONFIG, useValue: config },
  ]);
}
