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
    <mat-form-field>
      <textarea
        matInput
        [formControl]="form.controls.message"
        [placeholder]="placeholder()"
        (keydown.enter)="onHitEnter($event)"
      ></textarea>
      @if (!loading()) {
        <button
          mat-icon-button
          matSuffix
          aria-label="Send"
          [disabled]="form.invalid || !form.controls.message.value"
          (click)="onSendMessage()"
        >
          <mat-icon fontIcon="send"></mat-icon>
        </button>
      } @else {
        <button
          mat-icon-button
          matSuffix
          aria-label="Stop"
          type="button"
          (click)="stopChat.emit()"
        >
          <mat-icon fontIcon="stop"></mat-icon>
        </button>
      }
    </mat-form-field>
  `,
  imports: [MatButtonModule, MatFormFieldModule, MatInputModule, MatIconModule, ReactiveFormsModule],
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
    return this._fb.group({
      message: this._fb.nonNullable.control(''),
    });
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
