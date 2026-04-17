import { Pipe, PipeTransform } from '@angular/core';
import type { Chat } from '@hashbrownai/core';

/**
 * Interpolates `{{ key }}` placeholders in a tool label template
 * using values from the tool call's `args`.
 *
 * Usage:
 *   {{ 'Creating workflow: {{ name }}' | toolLabel:toolCall }}
 */
@Pipe({ name: 'toolLabel', standalone: true, pure: true })
export class ToolLabelPipe implements PipeTransform {
  transform(template: string, toolCall: Chat.AnyToolCall): string {
    return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, key: string) => {
      const value = toolCall.args?.[key];
      return value != null ? String(value) : '';
    });
  }
}
