import type { PipedreamStep, StepSnapshot, WorkflowStep } from '@poc/data-access-api';

export function slugFromKey(componentKey: string): string {
  return componentKey.replace(/-/g, '_');
}

/**
 * Walks a snapshot object and returns every valid dot-path as a flat list.
 * Used for both reference validation and future autocomplete suggestions.
 */
export function enumeratePaths(value: unknown, prefix = ''): string[] {
  const paths: string[] = [];
  if (prefix) paths.push(prefix);
  if (Array.isArray(value)) {
    value.forEach((item, i) => {
      paths.push(...enumeratePaths(item, prefix ? `${prefix}.${i}` : String(i)));
    });
  } else if (value !== null && typeof value === 'object') {
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      paths.push(...enumeratePaths(val, prefix ? `${prefix}.${key}` : key));
    }
  }
  return paths;
}

export function validateStepReferences(
  propValues: Record<string, unknown>,
  steps: Array<{ data: unknown; outputSnapshot?: StepSnapshot | null; snapshotStale?: boolean; tested?: boolean }>,
): { valid: true } | { valid: false; error: string; availablePaths: string[] } {
  const refPattern = /\{\{steps\.([^.}]+)\.([^}]+)\}\}/g;
  const allText = JSON.stringify(propValues);
  let match: RegExpExecArray | null;

  while ((match = refPattern.exec(allText)) !== null) {
    const slug = match[1];
    const path = match[2];

    // Trigger references are validated at runtime — skip here
    if (slug === 'trigger') continue;

    const referencedStep = steps.find(
      (s) =>
        s.data &&
        (s.data as PipedreamStep).source === 'pipedream' &&
        slugFromKey((s.data as PipedreamStep).component?.key ?? '') === slug,
    );

    if (!referencedStep) {
      return {
        valid: false,
        error: `Reference {{steps.${slug}.${path}}} refers to an unknown step "${slug}".`,
        availablePaths: [],
      };
    }

    if (!referencedStep.outputSnapshot) {
      return {
        valid: false,
        error: `Reference {{steps.${slug}.${path}}} — step "${slug}" has not been tested yet. Test it first to capture its output.`,
        availablePaths: [],
      };
    }

    const validPaths = enumeratePaths(referencedStep.outputSnapshot).map(
      (p) => `steps.${slug}.${p}`,
    );
    if (!validPaths.includes(`steps.${slug}.${path}`)) {
      return {
        valid: false,
        error: `Invalid reference {{steps.${slug}.${path}}} — path not found in step output.`,
        availablePaths: validPaths,
      };
    }
  }

  return { valid: true };
}

/**
 * Returns all available {{steps.*}} reference paths visible to the step at
 * `selectedStepIndex`. Includes both concrete leaf paths (when a snapshot exists)
 * and bare prefix paths (when not yet tested).
 */
export function getAvailablePaths(
  steps: WorkflowStep[],
  selectedStepIndex: number,
): string[] {
  console.log(JSON.parse(JSON.stringify({steps, selectedStepIndex})));
  if (selectedStepIndex <= 0) return [];
  const paths: string[] = [];
  for (let i = 0; i < selectedStepIndex; i++) {
    const step = steps[i];
    const data = step.data;
    if (!data || data.source !== 'pipedream') continue;
    const pd = data as PipedreamStep;
    if (!pd.component?.key) continue;
    if (step.outputSnapshot) {
      const prefix = step.type === 'trigger' ? 'steps.trigger' : `steps.${slugFromKey(pd.component.key)}`;
      paths.push(...enumeratePaths(step.outputSnapshot, prefix));
    } else {
      const prefix = step.type === 'trigger' ? 'steps.trigger' : `steps.${slugFromKey(pd.component.key)}`;
      paths.push(prefix);
    }
  }
  return paths;
}
