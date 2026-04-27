/**
 * Returns true if a Pipedream configurable prop should be treated as optional.
 *
 * A prop is optional when:
 *  - `optional` is explicitly `true`, OR
 *  - `optional` is unset (`undefined`) AND the prop has a non-null default value
 *    (the default acts as its effective value, so the user / LLM need not supply one).
 *
 * A prop is required when `optional` is `false` or is unset with no default.
 */
export function isPropOptional(prop: {
  optional?: boolean;
  default?: unknown;
}): boolean {
  if (prop.optional === true) return true;
  if (prop.optional === undefined && prop.default !== undefined && prop.default !== null) return true;
  return false;
}
