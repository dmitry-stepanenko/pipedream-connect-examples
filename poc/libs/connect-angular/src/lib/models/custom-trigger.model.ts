/** JSON Schema subset — enough to describe trigger payload fields */
export interface JsonSchemaProperty {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description?: string;
  enum?: string[];
  items?: JsonSchemaProperty;
  properties?: Record<string, JsonSchemaProperty>;
}

export interface JsonSchema {
  type: 'object';
  properties: Record<string, JsonSchemaProperty>;
  required?: string[];
}

/**
 * An internal business event that can trigger a workflow.
 * Registered by consuming apps via provideCustomTriggers().
 *
 * Example: { id: 'order.created', name: 'Order Created', payloadSchema: { ... } }
 */
export interface CustomTrigger {
  id: string;
  name: string;
  description: string;
  /** Optional icon name or URL */
  icon?: string;
  /** Describes the shape of the event payload; used for variable picking in later steps */
  payloadSchema: JsonSchema;
}
