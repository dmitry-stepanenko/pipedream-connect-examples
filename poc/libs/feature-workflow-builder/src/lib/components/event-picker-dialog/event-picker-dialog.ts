import { Component, input, output, signal } from '@angular/core';
import { DatePipe, JsonPipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import type { TriggerEvent } from '@poc/data-access-api';

@Component({
  selector: 'pd-event-picker-dialog',
  standalone: true,
  imports: [DatePipe, JsonPipe, MatButtonModule],
  templateUrl: './event-picker-dialog.html',
  styleUrl: './event-picker-dialog.css',
})
export class EventPickerDialogComponent {
  readonly events = input.required<TriggerEvent[]>();
  readonly running = input<boolean>(false);
  readonly confirmed = output<string>();
  readonly cancelled = output<void>();

  protected readonly selectedId = signal<string | null>(null);
  protected readonly expandedId = signal<string | null>(null);

  protected select(id: string) {
    this.selectedId.set(id);
  }

  protected toggleExpand(id: string) {
    this.expandedId.update((cur) => (cur === id ? null : id));
  }

  protected confirm() {
    const id = this.selectedId();
    if (id) this.confirmed.emit(id);
  }

  protected cancel() {
    this.cancelled.emit();
  }
}
