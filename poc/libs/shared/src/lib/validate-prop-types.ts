export interface PropTypeError {
  prop: string;
  declaredType: string;
  message: string;
}

export interface PropTypeValidationResult {
  valid: boolean;
  errors: PropTypeError[];
  /** Human-readable multi-line string ready to return to the LLM, or null when valid. */
  message: string | null;
}

/**
 * Maps a Pipedream declared prop `type` string to a JS-type predicate.
 *
 * Scalar types that map directly to a JS primitive:
 *   "string"   → string
 *   "integer"  → number (integer)
 *   "boolean"  → boolean
 *   "object"   → plain object (not array, not null)
 *
 * String-ID types (Airtable IDs, Discord channel IDs, etc.) behave like
 * strings and are validated as such.
 *
 * Types skipped (no scalar check):
 *   "any", "app", "data_store", "$.interface.http", "$.service.db" — opaque/Pipedream-managed
 *
 * Types that are validated with specific rules:
 *   "alert"                — rejected (display-only, must not be configured)
 *   "dir", "sql"           — must be a string
 *   "http_request", "$.interface.apphook" — must be a plain object
 *   "$.interface.timer"    — must be { intervalSeconds: number } or { cron: string }
 *   "*[]" array variants   — array shape is checked separately
 */
const SCALAR_TYPE_CHECKS: Record<
  string,
  { jsType: string; check: (v: unknown) => boolean; hint: string }
> = {
  string: {
    jsType: 'string',
    check: (v) => typeof v === 'string',
    hint: 'Pass a string value.',
  },
  integer: {
    jsType: 'integer',
    check: (v) => typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v),
    hint: 'Pass an integer number value (not a string).',
  },
  boolean: {
    jsType: 'boolean',
    check: (v) => typeof v === 'boolean',
    hint: 'Pass true or false (not a string "true"/"false").',
  },
  object: {
    jsType: 'object',
    check: (v) => v !== null && typeof v === 'object' && !Array.isArray(v),
    hint: 'Pass a plain object { key: value }.',
  },
};

// String-ID prop types that Pipedream uses for resource pickers.
// At runtime the LLM passes these as plain strings (IDs), so they validate as strings.
// String-ID prop types that Pipedream uses for resource pickers.
// At runtime the LLM passes these as plain strings (IDs), so they validate as strings.
const STRING_ID_TYPES = new Set([
  '$.airtable.baseId',
  '$.airtable.tableId',
  '$.airtable.viewId',
  '$.airtable.fieldId',
  '$.discord.channel',
]);

/**
 * Prop types for which no validation is performed — these are system/opaque
 * types whose shape is determined by Pipedream internals or is truly arbitrary.
 */
const SKIP_TYPES = new Set([
  'any',
  'app',        // auth tokens — set by Pipedream auth flow, not the LLM
  'data_store', // opaque Pipedream data store handle
  '$.interface.http',  // HTTP endpoint managed by Pipedream
  '$.service.db',      // Pipedream DB service
]);

/**
 * Prop types that must never appear in configuredProps — display-only fields
 * that have no runtime value and would be rejected by the Pipedream backend.
 */
const REJECT_TYPES = new Set([
  'alert', // display-only banner — the LLM must never attempt to set this
]);

/**
 * Prop types that must be a plain (non-array, non-null) object.
 * These are complex Pipedream interface/config types whose exact schema is
 * determined by Pipedream, but at minimum they cannot be arrays or primitives.
 */
const PLAIN_OBJECT_TYPES = new Set([
  'http_request',       // HTTP request configuration
  '$.interface.apphook', // webhook subscription config
]);

/**
 * Prop types that must be a plain string (path, query, etc.).
 */
const STRING_TYPES = new Set([
  'dir', // file/directory path
  'sql', // SQL query string
]);

/**
 * Validates a $.interface.timer value.
 * Must be a plain object with either:
 *   { intervalSeconds: <positive integer> }  — polling interval
 *   { cron: <non-empty string> }             — cron schedule
 */
function validateTimerProp(key: string, val: unknown): PropTypeError | null {
  if (Array.isArray(val) || typeof val !== 'object' || val === null) {
    return {
      prop: key,
      declaredType: '$.interface.timer',
      message:
        `"${key}" has type "$.interface.timer" but received ${JSON.stringify(val)}. ` +
        'Pass a plain object: { "intervalSeconds": 900 } for a polling interval, ' +
        'or { "cron": "0 * * * *" } for a cron schedule.',
    };
  }
  const t = val as Record<string, unknown>;
  const hasInterval = 'intervalSeconds' in t;
  const hasCron = 'cron' in t;
  if (!hasInterval && !hasCron) {
    return {
      prop: key,
      declaredType: '$.interface.timer',
      message:
        `"${key}" timer object is missing both "intervalSeconds" and "cron". ` +
        'Provide { "intervalSeconds": 900 } or { "cron": "0 * * * *" }.',
    };
  }
  if (hasInterval) {
    const iv = t['intervalSeconds'];
    if (typeof iv !== 'number' || !Number.isInteger(iv) || iv <= 0) {
      return {
        prop: key,
        declaredType: '$.interface.timer',
        message:
          `"${key}" timer.intervalSeconds must be a positive integer, got ${JSON.stringify(iv)}. ` +
          'Example: { "intervalSeconds": 900 }',
      };
    }
  }
  if (hasCron) {
    const c = t['cron'];
    if (typeof c !== 'string' || !c.trim()) {
      return {
        prop: key,
        declaredType: '$.interface.timer',
        message:
          `"${key}" timer.cron must be a non-empty cron expression string, got ${JSON.stringify(c)}.`,
      };
    }
  }
  return null;
}

/**
 * Validates that each value in `configuredProps` matches the declared JS type
 * of the corresponding `configurableProps` entry.
 *
 * Two axes are checked:
 * 1. **Array / scalar**: types ending with `[]` (e.g. `string[]`, `integer[]`,
 *    `$.discord.channel[]`) require an Array; all other user-facing types require a scalar.
 * 2. **Primitive type**: for scalar props with a known JS mapping (`string`,
 *    `integer`, `boolean`, `object`), the actual JS type of the value is checked.
 *
 * Template references like `{{steps.x.y}}` are plain strings and are only valid
 * for `string`-typed props — they pass naturally through the string check.
 * Using them on `integer`, `boolean`, or `object` props is a real error and will
 * be flagged.
 */
export function validatePropTypes(
  configuredProps: Record<string, unknown>,
  configurableProps: Array<{ name: string; type?: string; readOnly?: boolean }>,
): PropTypeValidationResult {
  const errors: PropTypeError[] = [];

  for (const [key, val] of Object.entries(configuredProps)) {
    const propDef = configurableProps.find((p) => p.name === key);
    if (!propDef?.type) continue;

    // readOnly props are display-only — skip validation entirely.
    if (propDef.readOnly) continue;

    const declaredType = propDef.type;

    // Skip opaque/system types entirely.
    if (SKIP_TYPES.has(declaredType)) continue;

    // Reject display-only types that must never be configured.
    if (REJECT_TYPES.has(declaredType)) {
      errors.push({
        prop: key,
        declaredType,
        message:
          `"${key}" has type "${declaredType}" which is a display-only field — ` +
          'do not include it in set_step_props. Remove it from the props array.',
      });
      continue;
    }

    // Timer props have their own shape validation.
    if (declaredType === '$.interface.timer') {
      const timerError = validateTimerProp(key, val);
      if (timerError) errors.push(timerError);
      continue;
    }

    // Types that must be a plain string value.
    if (STRING_TYPES.has(declaredType)) {
      if (typeof val !== 'string') {
        errors.push({
          prop: key,
          declaredType,
          message:
            `"${key}" has type "${declaredType}" but received ${JSON.stringify(val)}. ` +
            'Pass a plain string value.',
        });
      }
      continue;
    }

    // Types that must be a plain (non-null, non-array) object.
    if (PLAIN_OBJECT_TYPES.has(declaredType)) {
      if (Array.isArray(val) || typeof val !== 'object' || val === null) {
        errors.push({
          prop: key,
          declaredType,
          message:
            `"${key}" has type "${declaredType}" but received ${JSON.stringify(val)}. ` +
            'Pass a plain object { key: value }.',
        });
      }
      continue;
    }

    const isArray = Array.isArray(val);

    // --- Array / scalar axis ---
    if (declaredType.endsWith('[]')) {
      if (!isArray) {
        const suggestion =
          typeof val === 'string' ? `["${val}"]` : 'an array';
        errors.push({
          prop: key,
          declaredType,
          message:
            `"${key}" has type "${declaredType}" but received a scalar ` +
            `${JSON.stringify(val)}. Wrap it in an array: ${suggestion}`,
        });
        continue;
      }

      // Validate element types for known array types.
      // Strip the trailing `[]` to get the element type and look up its check.
      const elementTypeName = declaredType.slice(0, -2);
      const effectiveElementType = STRING_ID_TYPES.has(elementTypeName)
        ? 'string'
        : elementTypeName;
      const elementCheck = SCALAR_TYPE_CHECKS[effectiveElementType];
      if (elementCheck) {
        const badElements = (val as unknown[]).filter((el) => !elementCheck.check(el));
        if (badElements.length > 0) {
          errors.push({
            prop: key,
            declaredType,
            message:
              `"${key}" has type "${declaredType}" but contains non-${effectiveElementType} ` +
              `element(s): ${JSON.stringify(badElements)}. ${elementCheck.hint}`,
          });
        }
      }
      continue;
    }

    if (isArray) {
      errors.push({
        prop: key,
        declaredType,
        message:
          `"${key}" has type "${declaredType}" but received an array ` +
          `${JSON.stringify(val)}. Pass a single value instead.`,
      });
      continue;
    }

    // --- Primitive type axis ---
    // Normalise string-ID resource types → treat as `string`.
    const effectiveType = STRING_ID_TYPES.has(declaredType) ? 'string' : declaredType;
    const check = SCALAR_TYPE_CHECKS[effectiveType];
    if (check && !check.check(val)) {
      errors.push({
        prop: key,
        declaredType,
        message:
          `"${key}" has type "${declaredType}" but received ` +
          `${typeof val === 'object' ? JSON.stringify(val) : `${typeof val} ${JSON.stringify(val)}`}. ` +
          check.hint,
      });
    }
  }

  const valid = errors.length === 0;
  const message = valid
    ? null
    : `Type mismatch in configured props:\n${errors.map((e) => `  - ${e.message}`).join('\n')}`;

  return { valid, errors, message };
}
