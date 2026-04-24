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
