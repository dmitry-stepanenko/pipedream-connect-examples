import { validatePropTypes } from './validate-prop-types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function props(record: Record<string, unknown>) {
  return record;
}

function defs(entries: Array<{ name: string; type: string }>) {
  return entries;
}

// ---------------------------------------------------------------------------
// validatePropTypes — valid cases
// ---------------------------------------------------------------------------

describe('validatePropTypes — valid', () => {
  it('passes when all props match their declared types', () => {
    const result = validatePropTypes(
      props({ name: 'Alice', count: 3, active: true }),
      defs([
        { name: 'name', type: 'string' },
        { name: 'count', type: 'integer' },
        { name: 'active', type: 'boolean' },
      ]),
    );
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.message).toBeNull();
  });

  it('passes for string[] with an array value', () => {
    const result = validatePropTypes(
      props({ to: ['alice@example.com', 'bob@example.com'] }),
      defs([{ name: 'to', type: 'string[]' }]),
    );
    expect(result.valid).toBe(true);
  });

  it('passes for integer[] with an integer array', () => {
    const result = validatePropTypes(
      props({ ids: [1, 2, 3] }),
      defs([{ name: 'ids', type: 'integer[]' }]),
    );
    expect(result.valid).toBe(true);
  });

  it('passes for $.discord.channel[] with string array', () => {
    const result = validatePropTypes(
      props({ channels: ['111', '222'] }),
      defs([{ name: 'channels', type: '$.discord.channel[]' }]),
    );
    expect(result.valid).toBe(true);
  });

  it('passes for object type with a plain object', () => {
    const result = validatePropTypes(
      props({ metadata: { key: 'value' } }),
      defs([{ name: 'metadata', type: 'object' }]),
    );
    expect(result.valid).toBe(true);
  });

  it('skips props not present in configurableProps', () => {
    const result = validatePropTypes(
      props({ unknown: 42 }),
      defs([{ name: 'name', type: 'string' }]),
    );
    expect(result.valid).toBe(true);
  });

  it('skips props without a declared type', () => {
    const result = validatePropTypes(
      props({ anything: 42 }),
      [{ name: 'anything' }], // no type
    );
    expect(result.valid).toBe(true);
  });

  it('skips "any" type props', () => {
    const result = validatePropTypes(
      props({ payload: [1, 'two', true] }),
      defs([{ name: 'payload', type: 'any' }]),
    );
    expect(result.valid).toBe(true);
  });

  it('skips "app" type props', () => {
    const result = validatePropTypes(
      props({ gmail: { authProvisionId: 'id123' } }),
      defs([{ name: 'gmail', type: 'app' }]),
    );
    expect(result.valid).toBe(true);
  });

  it('accepts template references for string type', () => {
    const result = validatePropTypes(
      props({ subject: '{{steps.trigger.event.subject}}' }),
      defs([{ name: 'subject', type: 'string' }]),
    );
    expect(result.valid).toBe(true);
  });

  it('rejects bare template reference for string[] (must be wrapped in array)', () => {
    const result = validatePropTypes(
      props({ to: '{{steps.trigger.event.to}}' }),
      defs([{ name: 'to', type: 'string[]' }]),
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toMatch(/wrap it in an array/i);
  });

  it('accepts template reference inside array for string[]', () => {
    const result = validatePropTypes(
      props({ to: ['{{steps.trigger.event.to}}'] }),
      defs([{ name: 'to', type: 'string[]' }]),
    );
    expect(result.valid).toBe(true);
  });

  it('rejects template reference for boolean (real type error)', () => {
    const result = validatePropTypes(
      props({ enabled: '{{steps.x.enabled}}' }),
      defs([{ name: 'enabled', type: 'boolean' }]),
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toMatch(/pass true or false/i);
  });

  it('validates $.airtable.baseId as string', () => {
    const result = validatePropTypes(
      props({ baseId: 'appXYZ123' }),
      defs([{ name: 'baseId', type: '$.airtable.baseId' }]),
    );
    expect(result.valid).toBe(true);
  });

  it('validates $.discord.channel as string', () => {
    const result = validatePropTypes(
      props({ channel: '123456789' }),
      defs([{ name: 'channel', type: '$.discord.channel' }]),
    );
    expect(result.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// validatePropTypes — array/scalar mismatch
// ---------------------------------------------------------------------------

describe('validatePropTypes — array/scalar mismatch', () => {
  it('rejects string for string[] prop', () => {
    const result = validatePropTypes(
      props({ to: 'alice@example.com' }),
      defs([{ name: 'to', type: 'string[]' }]),
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].prop).toBe('to');
    expect(result.errors[0].message).toMatch(/wrap it in an array/i);
    expect(result.errors[0].message).toMatch(/\["alice@example.com"\]/);
  });

  it('rejects number for string[] prop', () => {
    const result = validatePropTypes(
      props({ ids: 42 }),
      defs([{ name: 'ids', type: 'string[]' }]),
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toMatch(/wrap it in an array/i);
  });

  it('rejects array for string prop', () => {
    const result = validatePropTypes(
      props({ name: ['Alice'] }),
      defs([{ name: 'name', type: 'string' }]),
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toMatch(/pass a single value/i);
  });

  it('rejects array for integer prop', () => {
    const result = validatePropTypes(
      props({ count: [1] }),
      defs([{ name: 'count', type: 'integer' }]),
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toMatch(/pass a single value/i);
  });
});

// ---------------------------------------------------------------------------
// validatePropTypes — array element type mismatch
// ---------------------------------------------------------------------------

describe('validatePropTypes — array element type mismatch', () => {
  it('rejects string elements for integer[]', () => {
    const result = validatePropTypes(
      props({ ids: ['1', '2'] }),
      defs([{ name: 'ids', type: 'integer[]' }]),
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0].prop).toBe('ids');
    expect(result.errors[0].message).toMatch(/non-integer element/i);
    expect(result.errors[0].message).toContain('"1"');
  });

  it('rejects mixed string/integer elements for integer[]', () => {
    const result = validatePropTypes(
      props({ ids: [1, '2', 3] }),
      defs([{ name: 'ids', type: 'integer[]' }]),
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toContain('"2"');
  });

  it('rejects number elements for string[]', () => {
    const result = validatePropTypes(
      props({ tags: ['foo', 42] }),
      defs([{ name: 'tags', type: 'string[]' }]),
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toMatch(/non-string element/i);
    expect(result.errors[0].message).toContain('42');
  });

  it('rejects number elements for $.discord.channel[]', () => {
    const result = validatePropTypes(
      props({ channels: [111, 222] }),
      defs([{ name: 'channels', type: '$.discord.channel[]' }]),
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toMatch(/non-string element/i);
  });

  it('passes empty array for string[]', () => {
    const result = validatePropTypes(
      props({ tags: [] }),
      defs([{ name: 'tags', type: 'string[]' }]),
    );
    expect(result.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// validatePropTypes — scalar type mismatch
// ---------------------------------------------------------------------------

describe('validatePropTypes — scalar type mismatch', () => {
  it('rejects number for string prop', () => {
    const result = validatePropTypes(
      props({ name: 42 }),
      defs([{ name: 'name', type: 'string' }]),
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0].prop).toBe('name');
    expect(result.errors[0].declaredType).toBe('string');
    expect(result.errors[0].message).toMatch(/pass a string value/i);
  });

  it('rejects boolean for string prop', () => {
    const result = validatePropTypes(
      props({ label: true }),
      defs([{ name: 'label', type: 'string' }]),
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toMatch(/pass a string value/i);
  });

  it('rejects string for integer prop', () => {
    const result = validatePropTypes(
      props({ count: '5' }),
      defs([{ name: 'count', type: 'integer' }]),
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toMatch(/pass an integer/i);
  });

  it('rejects float for integer prop', () => {
    const result = validatePropTypes(
      props({ count: 3.14 }),
      defs([{ name: 'count', type: 'integer' }]),
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toMatch(/pass an integer/i);
  });

  it('rejects string "true" for boolean prop', () => {
    const result = validatePropTypes(
      props({ active: 'true' }),
      defs([{ name: 'active', type: 'boolean' }]),
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toMatch(/pass true or false/i);
  });

  it('rejects number for boolean prop', () => {
    const result = validatePropTypes(
      props({ active: 1 }),
      defs([{ name: 'active', type: 'boolean' }]),
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toMatch(/pass true or false/i);
  });

  it('rejects array for object prop', () => {
    const result = validatePropTypes(
      props({ metadata: [{ key: 'v' }] }),
      defs([{ name: 'metadata', type: 'object' }]),
    );
    // Array check fires first (is this an array for a non-array type)
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toMatch(/pass a single value/i);
  });

  it('rejects string for object prop', () => {
    const result = validatePropTypes(
      props({ metadata: '{"key":"value"}' }),
      defs([{ name: 'metadata', type: 'object' }]),
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toMatch(/pass a plain object/i);
  });

  it('rejects number for $.airtable.baseId (string-ID) prop', () => {
    const result = validatePropTypes(
      props({ baseId: 12345 }),
      defs([{ name: 'baseId', type: '$.airtable.baseId' }]),
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toMatch(/pass a string value/i);
  });
});

// ---------------------------------------------------------------------------
// validatePropTypes — multiple errors
// ---------------------------------------------------------------------------

describe('validatePropTypes — multiple errors', () => {
  it('collects all errors across props', () => {
    const result = validatePropTypes(
      props({ to: 'alice@example.com', subject: 42, active: 'yes' }),
      defs([
        { name: 'to', type: 'string[]' },
        { name: 'subject', type: 'string' },
        { name: 'active', type: 'boolean' },
      ]),
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(3);
  });

  it('message lists all errors', () => {
    const result = validatePropTypes(
      props({ to: 'alice@example.com', count: '5' }),
      defs([
        { name: 'to', type: 'string[]' },
        { name: 'count', type: 'integer' },
      ]),
    );
    expect(result.message).toContain('"to"');
    expect(result.message).toContain('"count"');
  });
});

// ---------------------------------------------------------------------------
// validatePropTypes — $.interface.timer
// ---------------------------------------------------------------------------

describe('validatePropTypes — $.interface.timer', () => {
  it('accepts { intervalSeconds: 900 }', () => {
    const result = validatePropTypes(
      props({ timer: { intervalSeconds: 900 } }),
      defs([{ name: 'timer', type: '$.interface.timer' }]),
    );
    expect(result.valid).toBe(true);
  });

  it('accepts { cron: "0 * * * *" }', () => {
    const result = validatePropTypes(
      props({ timer: { cron: '0 * * * *' } }),
      defs([{ name: 'timer', type: '$.interface.timer' }]),
    );
    expect(result.valid).toBe(true);
  });

  it('accepts object with both intervalSeconds and cron', () => {
    const result = validatePropTypes(
      props({ timer: { intervalSeconds: 300, cron: '0 * * * *' } }),
      defs([{ name: 'timer', type: '$.interface.timer' }]),
    );
    expect(result.valid).toBe(true);
  });

  it('rejects a plain string "900"', () => {
    const result = validatePropTypes(
      props({ timer: '900' }),
      defs([{ name: 'timer', type: '$.interface.timer' }]),
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toMatch(/plain object/i);
  });

  it('rejects an array like ["", "{\"intervalSeconds\":900}"]', () => {
    const result = validatePropTypes(
      props({ timer: ['', '{"intervalSeconds":900}'] }),
      defs([{ name: 'timer', type: '$.interface.timer' }]),
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toMatch(/plain object/i);
  });

  it('rejects an integer', () => {
    const result = validatePropTypes(
      props({ timer: 900 }),
      defs([{ name: 'timer', type: '$.interface.timer' }]),
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toMatch(/plain object/i);
  });

  it('rejects null', () => {
    const result = validatePropTypes(
      props({ timer: null }),
      defs([{ name: 'timer', type: '$.interface.timer' }]),
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toMatch(/plain object/i);
  });

  it('rejects an object with neither intervalSeconds nor cron', () => {
    const result = validatePropTypes(
      props({ timer: {} }),
      defs([{ name: 'timer', type: '$.interface.timer' }]),
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toMatch(/missing both/i);
  });

  it('rejects intervalSeconds that is a string', () => {
    const result = validatePropTypes(
      props({ timer: { intervalSeconds: '900' } }),
      defs([{ name: 'timer', type: '$.interface.timer' }]),
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toMatch(/positive integer/i);
  });

  it('rejects intervalSeconds that is 0', () => {
    const result = validatePropTypes(
      props({ timer: { intervalSeconds: 0 } }),
      defs([{ name: 'timer', type: '$.interface.timer' }]),
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toMatch(/positive integer/i);
  });

  it('rejects cron that is an empty string', () => {
    const result = validatePropTypes(
      props({ timer: { cron: '' } }),
      defs([{ name: 'timer', type: '$.interface.timer' }]),
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toMatch(/non-empty cron/i);
  });
});

// ---------------------------------------------------------------------------
// validatePropTypes — alert (display-only, must be rejected)
// ---------------------------------------------------------------------------

describe('validatePropTypes — alert', () => {
  it('rejects any value for an alert prop', () => {
    const result = validatePropTypes(
      props({ alert: 'hello' }),
      defs([{ name: 'alert', type: 'alert' }]),
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toMatch(/display-only/i);
    expect(result.errors[0].message).toMatch(/do not include/i);
  });

  it('rejects null for an alert prop', () => {
    const result = validatePropTypes(
      props({ alert: null }),
      defs([{ name: 'alert', type: 'alert' }]),
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toMatch(/display-only/i);
  });
});

// ---------------------------------------------------------------------------
// validatePropTypes — dir and sql (must be strings)
// ---------------------------------------------------------------------------

describe('validatePropTypes — dir', () => {
  it('accepts a string path', () => {
    const result = validatePropTypes(
      props({ outputDir: '/tmp/output' }),
      defs([{ name: 'outputDir', type: 'dir' }]),
    );
    expect(result.valid).toBe(true);
  });

  it('rejects a number', () => {
    const result = validatePropTypes(
      props({ outputDir: 42 }),
      defs([{ name: 'outputDir', type: 'dir' }]),
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toMatch(/plain string/i);
  });

  it('rejects an array', () => {
    const result = validatePropTypes(
      props({ outputDir: ['/tmp'] }),
      defs([{ name: 'outputDir', type: 'dir' }]),
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toMatch(/plain string/i);
  });
});

describe('validatePropTypes — sql', () => {
  it('accepts a SQL string', () => {
    const result = validatePropTypes(
      props({ query: 'SELECT * FROM users' }),
      defs([{ name: 'query', type: 'sql' }]),
    );
    expect(result.valid).toBe(true);
  });

  it('rejects an object', () => {
    const result = validatePropTypes(
      props({ query: { sql: 'SELECT 1' } }),
      defs([{ name: 'query', type: 'sql' }]),
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toMatch(/plain string/i);
  });
});

// ---------------------------------------------------------------------------
// validatePropTypes — http_request and $.interface.apphook (must be objects)
// ---------------------------------------------------------------------------

describe('validatePropTypes — http_request', () => {
  it('accepts a plain object', () => {
    const result = validatePropTypes(
      props({ request: { method: 'GET', url: 'https://example.com' } }),
      defs([{ name: 'request', type: 'http_request' }]),
    );
    expect(result.valid).toBe(true);
  });

  it('rejects a string', () => {
    const result = validatePropTypes(
      props({ request: 'https://example.com' }),
      defs([{ name: 'request', type: 'http_request' }]),
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toMatch(/plain object/i);
  });

  it('rejects an array', () => {
    const result = validatePropTypes(
      props({ request: [{ method: 'GET' }] }),
      defs([{ name: 'request', type: 'http_request' }]),
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toMatch(/plain object/i);
  });
});

describe('validatePropTypes — $.interface.apphook', () => {
  it('accepts a plain object', () => {
    const result = validatePropTypes(
      props({ hook: { eventNames: ['push'] } }),
      defs([{ name: 'hook', type: '$.interface.apphook' }]),
    );
    expect(result.valid).toBe(true);
  });

  it('rejects a string', () => {
    const result = validatePropTypes(
      props({ hook: 'push' }),
      defs([{ name: 'hook', type: '$.interface.apphook' }]),
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toMatch(/plain object/i);
  });

  it('rejects an array', () => {
    const result = validatePropTypes(
      props({ hook: ['push', 'pull_request'] }),
      defs([{ name: 'hook', type: '$.interface.apphook' }]),
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toMatch(/plain object/i);
  });
});

// ---------------------------------------------------------------------------
// validatePropTypes — silently skipped types (any, app, data_store, etc.)
// ---------------------------------------------------------------------------

describe('validatePropTypes — silently skipped types', () => {
  it.each(['any', 'app', 'data_store', '$.interface.http', '$.service.db'])(
    'skips validation for type "%s"',
    (type) => {
      const result = validatePropTypes(
        props({ field: ['unexpected', 'array'] }),
        defs([{ name: 'field', type }]),
      );
      expect(result.valid).toBe(true);
    },
  );
});
