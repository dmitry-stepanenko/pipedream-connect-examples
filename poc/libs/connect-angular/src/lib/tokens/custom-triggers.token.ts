import { InjectionToken, Provider } from '@angular/core';
import { CustomTrigger } from '../models/custom-trigger.model';

export const CUSTOM_TRIGGERS = new InjectionToken<CustomTrigger[]>(
  'CUSTOM_TRIGGERS',
  { factory: () => [] }
);

/** Register your app's internal triggers with the workflow builder */
export function provideCustomTriggers(triggers: CustomTrigger[]): Provider {
  return { provide: CUSTOM_TRIGGERS, useValue: triggers };
}
