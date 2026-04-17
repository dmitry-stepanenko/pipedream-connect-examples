import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MarkdownComponent as NgxMarkdownComponent } from 'ngx-markdown';

@Component({
  selector: 'esp-ai-assistant-markdown',
  imports: [NgxMarkdownComponent],
  template: `
    @defer (on viewport) {
      <markdown [data]="data()" />
    } @placeholder {
      <div></div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host ::ng-deep p:last-child {
      margin-bottom: 0;
    }

    :host {
      padding: 0.5rem;
    }
  `,
})
export class MarkdownComponent {
  readonly data = input<string>('');
}
