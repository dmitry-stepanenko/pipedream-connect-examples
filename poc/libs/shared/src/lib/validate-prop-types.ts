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
 *   "any", "app", "alert", "data_store", "dir", "sql", "http_request",
 *   "$.interface.timer", "$.interface.apphook", "$.interface.http",
 *   "$.service.db", "*[]" array variants — array shape is checked separately.
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
  'alert',
  'app',
  'data_store',
  'dir',
  'sql',
  'http_request',
  '$.interface.timer',
  '$.interface.apphook',
  '$.interface.http',
  '$.service.db',
]);

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
  configurableProps: Array<{ name: string; type?: string }>,
): PropTypeValidationResult {
  const errors: PropTypeError[] = [];

  for (const [key, val] of Object.entries(configuredProps)) {
    const propDef = configurableProps.find((p) => p.name === key);
    if (!propDef?.type) continue;

    const declaredType = propDef.type;

    // Skip opaque/system types entirely.
    if (SKIP_TYPES.has(declaredType)) continue;
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
