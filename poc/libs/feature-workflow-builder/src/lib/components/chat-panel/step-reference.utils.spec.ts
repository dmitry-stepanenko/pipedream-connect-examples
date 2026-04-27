import {
  slugFromKey,
  enumeratePaths,
  validateStepReferences,
  getAvailablePaths,
} from './step-reference.utils';
import type { StepSnapshot, WorkflowStep } from '@poc/data-access-api';

// ── slugFromKey ──────────────────────────────────────────────────────────────

describe('slugFromKey', () => {
  it('replaces hyphens with underscores', () => {
    expect(slugFromKey('google_calendar-list-events')).toBe('google_calendar_list_events');
  });

  it('handles keys with no hyphens', () => {
    expect(slugFromKey('schedule')).toBe('schedule');
  });

  it('handles multiple hyphens', () => {
    expect(slugFromKey('slack_v2-send-message')).toBe('slack_v2_send_message');
  });
});

// ── enumeratePaths ───────────────────────────────────────────────────────────

describe('enumeratePaths', () => {
  it('returns empty array for primitives', () => {
    expect(enumeratePaths('hello')).toEqual([]);
    expect(enumeratePaths(42)).toEqual([]);
    expect(enumeratePaths(null)).toEqual([]);
  });

  it('enumerates flat object keys', () => {
    expect(enumeratePaths({ a: 1, b: 'x' })).toEqual(['a', 'b']);
  });

  it('enumerates nested object paths', () => {
    const paths = enumeratePaths({ start: { dateTime: '2026-04-20T17:30:00' } });
    expect(paths).toContain('start');
    expect(paths).toContain('start.dateTime');
  });

  it('enumerates array indices', () => {
    const paths = enumeratePaths([{ id: 'evt1' }, { id: 'evt2' }]);
    expect(paths).toContain('0');
    expect(paths).toContain('0.id');
    expect(paths).toContain('1');
    expect(paths).toContain('1.id');
  });

  it('prepends prefix to all paths', () => {
    const paths = enumeratePaths({ id: 'evt1' }, '$return_value.0');
    expect(paths).toContain('$return_value.0');
    expect(paths).toContain('$return_value.0.id');
    expect(paths).not.toContain('id');
  });

  it('enumerates a realistic calendar event snapshot', () => {
    const snapshot: StepSnapshot = {
      $return_value: [
        {
          id: '7t8hunb88',
          summary: 'meeting with John',
          start: { dateTime: '2026-04-20T17:30:00+03:00' },
        },
      ],
      exports: { $summary: 'Successfully retrieved 1 event' },
    };
    const paths = enumeratePaths(snapshot);
    expect(paths).toContain('$return_value');
    expect(paths).toContain('$return_value.0');
    expect(paths).toContain('$return_value.0.id');
    expect(paths).toContain('$return_value.0.summary');
    expect(paths).toContain('$return_value.0.start');
    expect(paths).toContain('$return_value.0.start.dateTime');
    expect(paths).toContain('exports');
    expect(paths).toContain('exports.$summary');
  });
});

// ── validateStepReferences ───────────────────────────────────────────────────

const calendarStep = {
  data: {
    source: 'pipedream' as const,
    app: {} as any,
    component: { key: 'google_calendar-list-events' } as any,
    configuredProps: {},
  },
  tested: true,
  outputSnapshot: {
    $return_value: [
      {
        id: 'evt1',
        summary: 'meeting',
        start: { dateTime: '2026-04-20T17:30:00+03:00' },
      },
    ],
    exports: { $summary: 'Retrieved 1 event' },
  } satisfies StepSnapshot,
};

describe('validateStepReferences', () => {
  it('passes when there are no step references', () => {
    const result = validateStepReferences({ text: 'Hello world' }, [calendarStep]);
    expect(result.valid).toBe(true);
  });

  it('passes for trigger references without checking snapshot', () => {
    const result = validateStepReferences(
      { timeMin: '{{steps.trigger.event.timestamp}}' },
      [calendarStep],
    );
    expect(result.valid).toBe(true);
  });

  it('passes for a valid path in the snapshot', () => {
    const result = validateStepReferences(
      { subject: '{{steps.google_calendar_list_events.$return_value.0.summary}}' },
      [calendarStep],
    );
    expect(result.valid).toBe(true);
  });

  it('fails when the referenced step does not exist', () => {
    const result = validateStepReferences(
      { text: '{{steps.nonexistent_step.$return_value}}' },
      [calendarStep],
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain('nonexistent_step');
      expect(result.availablePaths).toEqual([]);
    }
  });

  it('fails when the referenced step has not been tested', () => {
    const untestedStep = { ...calendarStep, tested: false, outputSnapshot: null };
    const result = validateStepReferences(
      { text: '{{steps.google_calendar_list_events.$return_value.0.id}}' },
      [untestedStep],
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain('has not been tested yet');
    }
  });

  it('fails when the path does not exist in the snapshot', () => {
    const result = validateStepReferences(
      { text: '{{steps.google_calendar_list_events.$return_value.event_text}}' },
      [calendarStep],
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain('path not found in step output');
      expect(result.availablePaths).toContain(
        'steps.google_calendar_list_events.$return_value',
      );
      expect(result.availablePaths).toContain(
        'steps.google_calendar_list_events.$return_value.0.summary',
      );
    }
  });

  it('returns available paths prefixed with the step slug', () => {
    const result = validateStepReferences(
      { text: '{{steps.google_calendar_list_events.$return_value.bad_field}}' },
      [calendarStep],
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      for (const p of result.availablePaths) {
        expect(p.startsWith('steps.google_calendar_list_events.')).toBe(true);
      }
    }
  });

  it('fails on the first invalid reference when multiple are present', () => {
    const result = validateStepReferences(
      {
        a: '{{steps.google_calendar_list_events.$return_value.0.id}}',
        b: '{{steps.google_calendar_list_events.$return_value.bad}}',
      },
      [calendarStep],
    );
    expect(result.valid).toBe(false);
  });

  it('passes when all references in a multi-prop object are valid', () => {
    const result = validateStepReferences(
      {
        id: '{{steps.google_calendar_list_events.$return_value.0.id}}',
        summary: '{{steps.google_calendar_list_events.$return_value.0.summary}}',
      },
      [calendarStep],
    );
    expect(result.valid).toBe(true);
  });
});

// ── getAvailablePaths ────────────────────────────────────────────────────────

const triggerStep: WorkflowStep = {
  id: 'step-trigger',
  type: 'trigger',
  data: {
    source: 'pipedream',
    app: {} as any,
    component: { key: 'google_calendar-new-event' } as any,
    configuredProps: {},
  },
};

const triggerStepWithSnapshot: WorkflowStep = {
  ...triggerStep,
  tested: true,
  outputSnapshot: {
    $return_value: { id: 'evt1', summary: 'meeting' },
    exports: {},
  } satisfies StepSnapshot,
};

const actionStep: WorkflowStep = {
  id: 'step-action',
  type: 'action',
  data: {
    source: 'pipedream',
    app: {} as any,
    component: { key: 'slack_v2-send-message' } as any,
    configuredProps: {},
  },
};

const actionStepWithSnapshot: WorkflowStep = {
  ...actionStep,
  tested: true,
  outputSnapshot: {
    $return_value: { ts: '12345', channel: 'C001' },
    exports: { $summary: 'Message sent' },
  } satisfies StepSnapshot,
};

const customTriggerStep: WorkflowStep = {
  id: 'step-custom',
  type: 'trigger',
  data: { source: 'custom', customTriggerId: 'order-created' },
};

describe('getAvailablePaths', () => {
  it('returns empty array when selectedStepIndex is 0', () => {
    expect(getAvailablePaths([triggerStep, actionStep], 0)).toEqual([]);
  });

  it('returns empty array when selectedStepIndex is negative', () => {
    expect(getAvailablePaths([triggerStep], -1)).toEqual([]);
  });

  it('skips non-pipedream steps', () => {
    const paths = getAvailablePaths([customTriggerStep, actionStep], 1);
    expect(paths).toEqual([]);
  });

  it('returns prefix path for trigger without snapshot', () => {
    const paths = getAvailablePaths([triggerStep, actionStep], 1);
    expect(paths).toEqual(['steps.trigger']);
  });

  it('returns prefix path for action without snapshot', () => {
    const paths = getAvailablePaths([triggerStep, actionStep], 2);
    expect(paths).toContain('steps.trigger');
    expect(paths).toContain('steps.slack_v2_send_message');
  });

  it('enumerates trigger snapshot under steps.trigger', () => {
    const paths = getAvailablePaths([triggerStepWithSnapshot, actionStep], 1);
    expect(paths).toContain('steps.trigger');
    expect(paths).toContain('steps.trigger.$return_value');
    expect(paths).toContain('steps.trigger.$return_value.id');
    expect(paths).toContain('steps.trigger.$return_value.summary');
    expect(paths).toContain('steps.trigger.exports');
  });

  it('enumerates action snapshot under steps.{slug}', () => {
    const paths = getAvailablePaths([triggerStep, actionStepWithSnapshot], 2);
    expect(paths).toContain('steps.slack_v2_send_message');
    expect(paths).toContain('steps.slack_v2_send_message.$return_value');
    expect(paths).toContain('steps.slack_v2_send_message.$return_value.ts');
    expect(paths).toContain('steps.slack_v2_send_message.$return_value.channel');
    expect(paths).toContain('steps.slack_v2_send_message.exports');
    expect(paths).toContain('steps.slack_v2_send_message.exports.$summary');
  });

  it('only includes steps before selectedStepIndex', () => {
    // Step at index 2 is the selected step — only steps 0 and 1 should contribute paths
    const selectedStep: WorkflowStep = {
      id: 'step-selected',
      type: 'action',
      data: {
        source: 'pipedream',
        app: {} as any,
        component: { key: 'gmail-send-email' } as any,
        configuredProps: {},
      },
      outputSnapshot: {
        $return_value: { messageId: 'msg1' },
        exports: {},
      },
    };
    const paths = getAvailablePaths(
      [triggerStepWithSnapshot, actionStepWithSnapshot, selectedStep],
      2,
    );
    // Paths from preceding steps must appear
    expect(paths.some((p) => p.startsWith('steps.trigger.$return_value'))).toBe(true);
    expect(paths.some((p) => p.startsWith('steps.slack_v2_send_message'))).toBe(true);
    // Selected step's paths must NOT appear
    expect(paths.some((p) => p.startsWith('steps.gmail_send_email'))).toBe(false);
  });

  it('skips pipedream steps with no component key', () => {
    const stepNoKey: WorkflowStep = {
      id: 'step-nokey',
      type: 'action',
      data: {
        source: 'pipedream',
        app: {} as any,
        component: {} as any,
        configuredProps: {},
      },
    };
    const paths = getAvailablePaths([stepNoKey, actionStep], 1);
    expect(paths).toEqual([]);
  });

  it('combines paths from multiple preceding steps', () => {
    const steps: WorkflowStep[] = [
      triggerStepWithSnapshot,
      actionStepWithSnapshot,
      { ...actionStep, id: 'step-selected' },
    ];
    const paths = getAvailablePaths(steps, 2);
    expect(paths.some((p) => p.startsWith('steps.trigger.$return_value'))).toBe(true);
    expect(paths.some((p) => p.startsWith('steps.slack_v2_send_message'))).toBe(true);
  });
});
