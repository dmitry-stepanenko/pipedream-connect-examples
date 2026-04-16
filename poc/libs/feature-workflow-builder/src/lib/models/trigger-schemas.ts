/**
 * Static event schemas for known Pipedream triggers.
 * These describe the shape of `steps.trigger.event` so the LLM can
 * produce valid `{{steps.trigger.event.*}}` references without requiring
 * a test run.
 */

export interface TriggerEventSchema {
  /** Human-readable trigger name */
  name: string;
  /** Pipedream component keys that match this schema */
  componentKeys: string[];
  /** Flat map of dot-paths to their types, e.g. "timezone_configured.iso8601.date" → "string" */
  paths: Record<string, string>;
  /** Example reference expressions the LLM can use */
  exampleReferences: string[];
}

// ── Schedule trigger ────────────────────────────────────────────────────────

const timezonePaths = (prefix: string): Record<string, string> => ({
  [`${prefix}.date.day`]: 'number',
  [`${prefix}.date.month`]: 'number',
  [`${prefix}.date.year`]: 'number',
  [`${prefix}.iso8601.date`]: 'string',
  [`${prefix}.iso8601.time`]: 'string',
  [`${prefix}.iso8601.timestamp`]: 'string',
  [`${prefix}.metadata.day_name`]: 'string',
  [`${prefix}.metadata.day_of_week`]: 'number',
  [`${prefix}.metadata.start_of_week`]: 'string',
  [`${prefix}.pretty.date`]: 'string',
  [`${prefix}.pretty.time`]: 'string',
  [`${prefix}.pretty.time_24h`]: 'string',
  [`${prefix}.time.hour`]: 'number',
  [`${prefix}.time.millisecond`]: 'number',
  [`${prefix}.time.minute`]: 'number',
  [`${prefix}.time.second`]: 'number',
  [`${prefix}.timezone`]: 'string',
});

export const SCHEDULE_TRIGGER_SCHEMA: TriggerEventSchema = {
  name: 'Schedule Trigger',
  componentKeys: [
    'schedule-custom-interval',
    'schedule-daily-schedule',
    'schedule-weekly-schedule',
    'schedule-monthly-schedule',
    'schedule-cron-schedule',
  ],
  paths: {
    'timestamp': 'number',
    'cron': 'string',
    ...timezonePaths('timezone_utc'),
    ...timezonePaths('timezone_configured'),
  },
  exampleReferences: [
    '{{steps.trigger.event.timezone_configured.iso8601.date}}',
    '{{steps.trigger.event.timezone_configured.iso8601.timestamp}}',
    '{{steps.trigger.event.timezone_configured.pretty.date}}',
    '{{steps.trigger.event.timezone_configured.pretty.time}}',
    '{{steps.trigger.event.timezone_configured.timezone}}',
    '{{steps.trigger.event.timezone_utc.iso8601.timestamp}}',
    '{{steps.trigger.event.timestamp}}',
  ],
};

// ── Registry ────────────────────────────────────────────────────────────────

export const KNOWN_TRIGGER_SCHEMAS: TriggerEventSchema[] = [
  SCHEDULE_TRIGGER_SCHEMA,
];

/**
 * Look up the static trigger event schema for a component key.
 * Returns null if the trigger type is not statically known.
 */
export function getTriggerSchema(componentKey: string): TriggerEventSchema | null {
  return KNOWN_TRIGGER_SCHEMAS.find((s) => s.componentKeys.includes(componentKey)) ?? null;
}
