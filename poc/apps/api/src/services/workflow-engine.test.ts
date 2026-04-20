import {
  slugFromKey,
  getAtPath,
  resolveInterpolations,
  executeWorkflow,
} from './workflow-engine';
import type { Workflow } from '../models/workflow.model';

// Cloudflare Workers KVNamespace is not available in the Jest environment;
// tests use a minimal jest.fn() stand-in cast to any.
type AnyKv = any;

// ── slugFromKey ──────────────────────────────────────────────────────────────

describe('slugFromKey', () => {
  it('replaces hyphens with underscores', () => {
    expect(slugFromKey('google_calendar-list-events')).toBe(
      'google_calendar_list_events',
    );
  });

  it('handles keys with no hyphens', () => {
    expect(slugFromKey('schedule')).toBe('schedule');
  });

  it('handles multiple consecutive hyphens', () => {
    expect(slugFromKey('slack_v2-send-message')).toBe('slack_v2_send_message');
  });
});

// ── getAtPath ────────────────────────────────────────────────────────────────

describe('getAtPath', () => {
  const obj = {
    steps: {
      trigger: {
        event: {
          timezone_configured: {
            iso8601: { date: '2026-04-14' },
          },
        },
      },
    },
  };

  it('navigates a deep path', () => {
    expect(
      getAtPath(obj, [
        'steps',
        'trigger',
        'event',
        'timezone_configured',
        'iso8601',
        'date',
      ]),
    ).toBe('2026-04-14');
  });

  it('returns undefined for missing paths', () => {
    expect(getAtPath(obj, ['steps', 'trigger', 'event', 'missing'])).toBeUndefined();
  });

  it('returns undefined when traversal hits a non-object', () => {
    expect(getAtPath(obj, ['steps', 'trigger', 'event', 'timezone_configured', 'iso8601', 'date', 'extra'])).toBeUndefined();
  });

  it('handles null/undefined mid-path gracefully', () => {
    expect(getAtPath({ a: null }, ['a', 'b'])).toBeUndefined();
  });

  it('supports $ prefix keys like $return_value', () => {
    expect(getAtPath({ steps: { google_calendar_list_events: { $return_value: [{ id: '1' }] } } }, [
      'steps',
      'google_calendar_list_events',
      '$return_value',
    ])).toEqual([{ id: '1' }]);
  });
});

// ── resolveInterpolations ────────────────────────────────────────────────────

describe('resolveInterpolations', () => {
  const triggerEvent = {
    timezone_configured: {
      iso8601: { date: '2026-04-14' },
    },
  };
  const calendarOutput = [{ id: 'evt1', summary: 'Team standup' }];

  const context = {
    steps: {
      trigger: { event: triggerEvent },
      google_calendar_list_events: {
        $return_value: calendarOutput,
      },
    },
  };

  describe('string values', () => {
    it('replaces a trigger date expression embedded in a larger string', () => {
      const result = resolveInterpolations(
        '{{steps.trigger.event.timezone_configured.iso8601.date}}T00:00:00Z',
        context,
      );
      expect(result).toBe('2026-04-14T00:00:00Z');
    });

    it('replaces timeMax correctly', () => {
      const result = resolveInterpolations(
        '{{steps.trigger.event.timezone_configured.iso8601.date}}T23:59:59Z',
        context,
      );
      expect(result).toBe('2026-04-14T23:59:59Z');
    });

    it('JSON-stringifies objects/arrays when entire string is a single expression', () => {
      const result = resolveInterpolations(
        '{{steps.google_calendar_list_events.$return_value}}',
        context,
      );
      expect(result).toBe(JSON.stringify(calendarOutput));
    });

    it('JSON-stringifies non-string values when embedded in a larger string', () => {
      const result = resolveInterpolations(
        'Here is your weekly summary: \n{{steps.google_calendar_list_events.$return_value}}',
        context,
      );
      expect(result).toBe(
        `Here is your weekly summary: \n${JSON.stringify(calendarOutput)}`,
      );
    });

    it('throws for an unresolvable single expression', () => {
      expect(() =>
        resolveInterpolations('{{steps.missing.step.value}}', context),
      ).toThrow('Unresolved interpolation: {{steps.missing.step.value}}');
    });

    it('throws for an unresolvable expression embedded in a larger string', () => {
      expect(() =>
        resolveInterpolations('prefix {{steps.missing.step.value}} suffix', context),
      ).toThrow('Unresolved interpolation: {{steps.missing.step.value}}');
    });

    it('error message includes the unresolved path', () => {
      expect(() =>
        resolveInterpolations('{{steps.google_calendar_list_events.$return_value.event_text}}', context),
      ).toThrow('path does not exist in the execution context');
    });

    it('handles multiple expressions in one string', () => {
      const result = resolveInterpolations(
        '{{steps.trigger.event.timezone_configured.iso8601.date}} to {{steps.trigger.event.timezone_configured.iso8601.date}}',
        context,
      );
      expect(result).toBe('2026-04-14 to 2026-04-14');
    });

    it('passes through plain strings with no expressions', () => {
      expect(resolveInterpolations('primary', context)).toBe('primary');
    });
  });

  describe('non-string values', () => {
    it('passes through booleans unchanged', () => {
      expect(resolveInterpolations(true, context)).toBe(true);
    });

    it('passes through numbers unchanged', () => {
      expect(resolveInterpolations(42, context)).toBe(42);
    });

    it('passes through null unchanged', () => {
      expect(resolveInterpolations(null, context)).toBeNull();
    });
  });

  describe('nested objects', () => {
    it('resolves expressions inside configuredProps objects', () => {
      const props = {
        calendarId: 'cuddleminister@gmail.com',
        singleEvents: true,
        timeMin: '{{steps.trigger.event.timezone_configured.iso8601.date}}T00:00:00Z',
        timeMax: '{{steps.trigger.event.timezone_configured.iso8601.date}}T23:59:59Z',
        timeZone: 'UTC',
      };
      const result = resolveInterpolations(props, context) as typeof props;
      expect(result.timeMin).toBe('2026-04-14T00:00:00Z');
      expect(result.timeMax).toBe('2026-04-14T23:59:59Z');
      // Non-expression values untouched
      expect(result.calendarId).toBe('cuddleminister@gmail.com');
      expect(result.singleEvents).toBe(true);
    });

    it('resolves expressions inside arrays', () => {
      const result = resolveInterpolations(
        ['{{steps.trigger.event.timezone_configured.iso8601.date}}', 'static'],
        context,
      );
      expect(result).toEqual(['2026-04-14', 'static']);
    });
  });
});

// ── executeWorkflow ──────────────────────────────────────────────────────────

describe('executeWorkflow', () => {
  // Minimal Pipedream-sourced workflow matching the example-workflows.json structure.
  // Step fixtures use `as any` to avoid providing the full App/Component SDK types.
  const triggerStep: any = {
    id: '1776174921429-dbrtyt',
    type: 'trigger',
    data: {
      source: 'pipedream',
      app: { nameSlug: 'schedule' },
      component: { key: 'schedule-weekly', configurableProps: [] },
      configuredProps: { cron: { cron: '' } },
    },
    tested: false,
  };

  const calendarStep: any = {
    id: '1776174946649-4rwhoh',
    type: 'action',
    data: {
      source: 'pipedream',
      app: { nameSlug: 'google_calendar' },
      component: {
        key: 'google_calendar-list-events',
        configurableProps: [
          { type: 'app', app: 'google_calendar', name: 'googleCalendar' },
          { type: 'string', name: 'calendarId', optional: true },
          { type: 'boolean', name: 'singleEvents', optional: true },
          { type: 'string', name: 'timeMin', optional: true },
          { type: 'string', name: 'timeMax', optional: true },
          { type: 'string', name: 'timeZone', optional: true },
        ],
      },
      configuredProps: {
        calendarId: 'cuddleminister@gmail.com',
        singleEvents: true,
        timeMin: '{{steps.trigger.event.timezone_configured.iso8601.date}}T00:00:00Z',
        timeMax: '{{steps.trigger.event.timezone_configured.iso8601.date}}T23:59:59Z',
        timeZone: 'UTC',
        googleCalendar: 'apn_6Lh0O4Y',
      },
    },
    tested: false,
  };

  const slackStep: any = {
    id: '1776174946650-w1i7by',
    type: 'action',
    data: {
      source: 'pipedream',
      app: { nameSlug: 'slack_v2' },
      component: {
        key: 'slack_v2-send-message',
        configurableProps: [
          { type: 'app', app: 'slack_v2', name: 'slack' },
          { type: 'string', name: 'channelType' },
          { type: 'string', name: 'conversation' },
          { type: 'string', name: 'text' },
          { type: 'boolean', name: 'addToChannel' },
        ],
      },
      configuredProps: {
        channelType: 'Channels',
        conversation: 'C0ASQ2LCJSZ',
        text: 'Here is your weekly summary: \n{{steps.google_calendar_list_events.$return_value}}',
        addToChannel: false,
        slack: 'apn_Xehdbd7',
      },
    },
    tested: false,
  };

  const workflow: Workflow = {
    id: '1776174921429-gozff5',
    name: 'Weekly Event Summary to Slack',
    description: '',
    steps: [triggerStep, calendarStep, slackStep],
    status: 'published',
    externalUserId: 'demo-user-1',
    createdAt: '2026-04-14T13:55:21.429Z',
    updatedAt: '2026-04-14T15:39:21.636Z',
    deployedTriggerId: 'ti_NQT2ngM',
  };

  const triggerPayload = {
    timezone_configured: {
      iso8601: { date: '2026-04-14' },
    },
  };

  const calendarEvents = [
    { id: 'evt1', summary: 'Team standup', start: { dateTime: '2026-04-14T09:00:00Z' } },
  ];

  let mockActionsRun: jest.Mock;
  let mockKv: AnyKv;
  let mockPd: any;

  beforeEach(() => {
    mockActionsRun = jest.fn();
    mockKv = {
      get: jest.fn().mockResolvedValue(null),
      put: jest.fn().mockResolvedValue(undefined),
    };
    mockPd = { actions: { run: mockActionsRun } };
  });

  it('resolves trigger interpolations before calling the calendar step', async () => {
    mockActionsRun
      .mockResolvedValueOnce({ ret: calendarEvents, exports: {} })
      .mockResolvedValueOnce({ ret: { ok: true }, exports: {} });

    await executeWorkflow(mockPd, mockKv, workflow, triggerPayload);

    const calendarCall = mockActionsRun.mock.calls[0][0];
    expect(calendarCall.configuredProps.timeMin).toBe('2026-04-14T00:00:00Z');
    expect(calendarCall.configuredProps.timeMax).toBe('2026-04-14T23:59:59Z');
  });

  it('passes the calendar step output to the Slack step', async () => {
    mockActionsRun
      .mockResolvedValueOnce({ ret: calendarEvents, exports: {} })
      .mockResolvedValueOnce({ ret: { ok: true }, exports: {} });

    await executeWorkflow(mockPd, mockKv, workflow, triggerPayload);

    const slackCall = mockActionsRun.mock.calls[1][0];
    expect(slackCall.configuredProps.text).toBe(
      `Here is your weekly summary: \n${JSON.stringify(calendarEvents)}`,
    );
  });

  it('normalizes app-type props (wraps auth token in authProvisionId)', async () => {
    mockActionsRun
      .mockResolvedValueOnce({ ret: calendarEvents, exports: {} })
      .mockResolvedValueOnce({ ret: { ok: true }, exports: {} });

    await executeWorkflow(mockPd, mockKv, workflow, triggerPayload);

    const calendarCall = mockActionsRun.mock.calls[0][0];
    expect(calendarCall.configuredProps.googleCalendar).toEqual({
      authProvisionId: 'apn_6Lh0O4Y',
    });
  });

  it('returns success results for each action step', async () => {
    mockActionsRun
      .mockResolvedValueOnce({ ret: calendarEvents, exports: {} })
      .mockResolvedValueOnce({ ret: { ok: true }, exports: {} });

    const run = await executeWorkflow(mockPd, mockKv, workflow, triggerPayload);

    expect(run.status).toBe('success');
    expect(run.steps).toHaveLength(2);
    expect(run.steps[0]).toMatchObject({
      stepId: calendarStep.id,
      componentKey: 'google_calendar-list-events',
      status: 'success',
    });
    expect(run.steps[1]).toMatchObject({
      stepId: slackStep.id,
      componentKey: 'slack_v2-send-message',
      status: 'success',
    });
  });

  it('stops execution and records error when a step throws', async () => {
    mockActionsRun.mockRejectedValueOnce(new Error('API quota exceeded'));

    const run = await executeWorkflow(mockPd, mockKv, workflow, triggerPayload);

    expect(run.status).toBe('error');
    expect(run.steps).toHaveLength(1);
    expect(run.steps[0]).toMatchObject({
      stepId: calendarStep.id,
      status: 'error',
      error: 'API quota exceeded',
    });
    expect(mockActionsRun).toHaveBeenCalledTimes(1);
  });

  it('stops execution when a step returns an error observation', async () => {
    // Mirrors the real Pipedream behaviour: pd.actions.run resolves (no throw)
    // but places the error in result.os with k === 'error'.
    mockActionsRun.mockResolvedValueOnce({
      os: [{ k: 'error', err: { message: 'Bad Request' } }],
      exports: {},
    });

    const run = await executeWorkflow(mockPd, mockKv, workflow, triggerPayload);

    expect(run.status).toBe('error');
    expect(run.steps).toHaveLength(1);
    expect(run.steps[0]).toMatchObject({
      stepId: calendarStep.id,
      status: 'error',
      error: 'Bad Request',
    });
    // Slack must NOT run after the calendar step errors
    expect(mockActionsRun).toHaveBeenCalledTimes(1);
  });

  it('uses the error observation message even when err.message is missing', async () => {
    mockActionsRun.mockResolvedValueOnce({
      os: [{ k: 'error' }],
      exports: {},
    });

    const run = await executeWorkflow(mockPd, mockKv, workflow, triggerPayload);

    expect(run.steps[0].status).toBe('error');
    expect(run.steps[0].error).toBe('Step returned an error');
  });

  it('resolves trigger interpolations when a triggerPayload is provided', async () => {
    // Simulates a caller passing explicit trigger data (e.g. from the test-trigger
    // endpoint) so that {{steps.trigger.event.*}} references are resolved.
    mockActionsRun
      .mockResolvedValueOnce({ ret: calendarEvents, exports: {} })
      .mockResolvedValueOnce({ ret: { ok: true }, exports: {} });

    await executeWorkflow(mockPd, mockKv, workflow, {
      timezone_configured: { iso8601: { date: '2026-04-14' } },
    });

    const calendarCall = mockActionsRun.mock.calls[0][0];
    expect(calendarCall.configuredProps.timeMin).toBe('2026-04-14T00:00:00Z');
    expect(calendarCall.configuredProps.timeMax).toBe('2026-04-14T23:59:59Z');
  });

  it('fails the step when trigger interpolations cannot be resolved (empty payload)', async () => {
    const run = await executeWorkflow(mockPd, mockKv, workflow, {});

    expect(run.status).toBe('error');
    expect(run.steps).toHaveLength(1);
    expect(run.steps[0].status).toBe('error');
    expect(run.steps[0].error).toMatch('Unresolved interpolation');
    expect(mockActionsRun).not.toHaveBeenCalled();
  });

  it('fails the step when a prop references a non-existent path', async () => {
    const workflowWithBadRef: Workflow = {
      ...workflow,
      steps: [
        triggerStep,
        {
          ...calendarStep,
          data: {
            ...calendarStep.data,
            configuredProps: {
              ...calendarStep.data.configuredProps,
              timeMin: '{{steps.nonexistent.field}}T00:00:00Z',
            },
          },
        } as any,
      ],
    };

    const run = await executeWorkflow(mockPd, mockKv, workflowWithBadRef, triggerPayload);

    expect(run.status).toBe('error');
    expect(run.steps[0].status).toBe('error');
    expect(run.steps[0].error).toMatch('Unresolved interpolation: {{steps.nonexistent.field}}');
    expect(mockActionsRun).not.toHaveBeenCalled();
  });
});
