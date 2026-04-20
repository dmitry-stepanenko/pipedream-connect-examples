import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  output,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';

import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'esp-ai-assistant-composer',
  template: `
    <mat-form-field class="w-full">
      <textarea
        matInput
        [formControl]="form.controls.message"
        [placeholder]="placeholder()"
        (keydown.enter)="onHitEnter($event)"
      ></textarea>
    </mat-form-field>
    @if (!loading()) {
      <button
        mat-button
        aria-label="Send"
        [disabled]="form.invalid || !form.controls.message.value"
        (click)="onSendMessage()"
      >
        Send
      </button>
    } @else {
      <button
        mat-button
        aria-label="Stop"
        type="button"
        (click)="stopChat.emit()"
      >
        Stop
      </button>
    }
  `,
  host: {
    class: 'flex gap-2 items-center',
  },
  imports: [
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    ReactiveFormsModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ComposerComponent {
  private readonly _fb = inject(FormBuilder);
  readonly sendMessage = output<string>();
  readonly stopChat = output<void>();
  readonly placeholder = input<string>('Type a message');
  readonly loading = input.required<boolean>();

  readonly form = this._createForm();

  private _createForm() {
    const f = this._fb.group({
      message: this._fb.nonNullable.control(''),
    });
    f.controls.message.setValue(
      // `I need a workflow that on schedule sends "hello" to my slack "General" channel at 9 a.m. every Monday`
      `I need a workflow that on schedule fetches my google calendar events for the current week, summarizes all of them with chat gpt and sends a short report as a slack message`,
    );
    return f;
  }

  onHitEnter($event: Event) {
    $event.preventDefault();

    if (!($event as KeyboardEvent).shiftKey) {
      this.onSendMessage();
    }
  }

  onSendMessage() {
    this.form.updateValueAndValidity();
    if (this.form.valid && this.form.controls.message.value) {
      const value = this.form.getRawValue();

      this.sendMessage.emit(value.message);
      this.form.reset();
    }
  }
}
