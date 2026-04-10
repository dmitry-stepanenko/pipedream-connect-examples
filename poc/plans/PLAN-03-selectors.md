# PLAN-03 — connect-angular: App & Component Selectors

## Goal

Build two reusable Angular components:
- `AppSelectorComponent` (`pd-app-selector`) — search and select a Pipedream app
- `ComponentSelectorComponent` (`pd-component-selector`) — list and select a trigger or action for a given app

These are the Angular equivalents of `SelectApp` and `SelectComponent` from `@pipedream/connect-react`.

## Context

- Library path: `poc/libs/connect-angular/src/lib/components/`
- Depends on `PipedreamClientService` from PLAN-02
- React reference: read the actual source at:
  - `/Users/dmitry/projects/forks/pipedream/packages/connect-react/src/components/SelectApp.tsx`
  - `/Users/dmitry/projects/forks/pipedream/packages/connect-react/src/components/SelectComponent.tsx`
  - `/Users/dmitry/projects/forks/pipedream/packages/connect-react/src/hooks/use-apps.tsx`
  - `/Users/dmitry/projects/forks/pipedream/packages/connect-react/src/hooks/use-components.tsx`
- React usage reference: `connect-react-demo/src/` — `SelectApp` and `SelectComponent` usage in `DynamicComponent.tsx` and `Customization*.tsx`
- Angular 21 — standalone components with signals
- Use `resource()` (Angular 19+) for async data fetching, or `HttpClient` with RxJS if `resource()` proves insufficient

## Prerequisites

PLAN-02 must be completed.

---

## Step 1 — Create directory structure

```
poc/libs/connect-angular/src/lib/components/
├── app-selector/
│   ├── app-selector.ts
│   ├── app-selector.html
│   └── app-selector.css
└── component-selector/
    ├── component-selector.ts
    ├── component-selector.html
    └── component-selector.css
```

Do NOT use `nx generate` for individual component files — just create them directly. `nx generate` is required only for new apps/libs.

---

## Step 2 — `AppSelectorComponent`

### `app-selector.ts`

```typescript
import {
  Component, input, output, signal, computed, inject, OnInit
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { App } from '@pipedream/sdk';
import { PipedreamClientService } from '../../services/pipedream-client.service';

@Component({
  selector: 'pd-app-selector',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './app-selector.html',
  styleUrl: './app-selector.css',
})
export class AppSelectorComponent implements OnInit {
  // Two-way binding: <pd-app-selector [(value)]="myApp" />
  value = input<App | null>(null);
  valueChange = output<App | null>();

  protected readonly query = signal('');
  protected readonly apps = signal<App[]>([]);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly isOpen = signal(false);

  protected readonly filteredApps = computed(() => {
    const q = this.query().toLowerCase();
    if (!q) return this.apps();
    return this.apps().filter(
      (a) => a.name.toLowerCase().includes(q) || a.name_slug.includes(q)
    );
  });

  private readonly client = inject(PipedreamClientService);

  async ngOnInit() {
    await this.loadApps();
  }

  protected async onSearch(q: string) {
    this.query.set(q);
    if (q.length >= 2) {
      await this.loadApps(q);
    }
  }

  protected selectApp(app: App) {
    this.valueChange.emit(app);
    this.isOpen.set(false);
    this.query.set('');
  }

  protected clear() {
    this.valueChange.emit(null);
  }

  private async loadApps(query?: string) {
    this.loading.set(true);
    this.error.set(null);
    try {
      const result = await this.client.listApps(query, 50);
      this.apps.set(result.data ?? []);
    } catch (e) {
      this.error.set('Failed to load apps');
    } finally {
      this.loading.set(false);
    }
  }
}
```

### `app-selector.html`

```html
<div class="pd-app-selector">
  @if (value()) {
    <div class="pd-selected-app">
      @if (value()?.img) {
        <img [src]="value()!.img" [alt]="value()!.name" class="pd-app-icon" />
      }
      <span>{{ value()?.name }}</span>
      <button type="button" (click)="clear()" aria-label="Clear">✕</button>
    </div>
  } @else {
    <div class="pd-app-search">
      <input
        type="text"
        placeholder="Search apps..."
        [ngModel]="query()"
        (ngModelChange)="onSearch($event)"
        (focus)="isOpen.set(true)"
        autocomplete="off"
      />
      @if (loading()) {
        <span class="pd-loading">Loading...</span>
      }
    </div>

    @if (isOpen() && filteredApps().length > 0) {
      <ul class="pd-app-list" role="listbox">
        @for (app of filteredApps(); track app.name_slug) {
          <li
            class="pd-app-option"
            role="option"
            (click)="selectApp(app)"
            (keydown.enter)="selectApp(app)"
            tabindex="0"
          >
            @if (app.img) {
              <img [src]="app.img" [alt]="app.name" class="pd-app-icon" />
            }
            <span>{{ app.name }}</span>
          </li>
        }
      </ul>
    }

    @if (error()) {
      <p class="pd-error">{{ error() }}</p>
    }
  }
</div>
```

---

## Step 3 — `ComponentSelectorComponent`

### `component-selector.ts`

```typescript
import {
  Component, input, output, signal, effect, inject
} from '@angular/core';
import { App, Component as PdComponent } from '@pipedream/sdk';
import { PipedreamClientService } from '../../services/pipedream-client.service';

@Component({
  selector: 'pd-component-selector',
  standalone: true,
  templateUrl: './component-selector.html',
  styleUrl: './component-selector.css',
})
export class ComponentSelectorComponent {
  app = input.required<App>();
  componentType = input<'action' | 'trigger'>('action');
  value = input<PdComponent | null>(null);
  valueChange = output<PdComponent | null>();

  protected readonly components = signal<PdComponent[]>([]);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  private readonly client = inject(PipedreamClientService);

  constructor() {
    // Reload components when app or type changes
    effect(() => {
      const app = this.app();
      const type = this.componentType();
      if (app) {
        this.loadComponents(app.name_slug, type);
      }
    });
  }

  protected select(component: PdComponent) {
    this.valueChange.emit(component);
  }

  protected clear() {
    this.valueChange.emit(null);
  }

  private async loadComponents(appSlug: string, type: 'action' | 'trigger') {
    this.loading.set(true);
    this.error.set(null);
    try {
      const result = await this.client.listComponents({
        app: appSlug,
        componentType: type,
        limit: 50,
      });
      this.components.set(result.data ?? []);
    } catch {
      this.error.set('Failed to load components');
    } finally {
      this.loading.set(false);
    }
  }
}
```

### `component-selector.html`

```html
<div class="pd-component-selector">
  @if (value()) {
    <div class="pd-selected-component">
      <span>{{ value()?.name }}</span>
      <button type="button" (click)="clear()">✕</button>
    </div>
  } @else if (loading()) {
    <p class="pd-loading">Loading {{ componentType() }}s...</p>
  } @else if (error()) {
    <p class="pd-error">{{ error() }}</p>
  } @else {
    <ul class="pd-component-list" role="listbox">
      @for (component of components(); track component.key) {
        <li
          class="pd-component-option"
          role="option"
          (click)="select(component)"
          (keydown.enter)="select(component)"
          tabindex="0"
        >
          <strong>{{ component.name }}</strong>
          @if (component.description) {
            <small>{{ component.description }}</small>
          }
        </li>
      }
      @if (components().length === 0) {
        <li class="pd-empty">No {{ componentType() }}s found for this app.</li>
      }
    </ul>
  }
</div>
```

---

## Step 4 — Export from library

Add to `poc/libs/connect-angular/src/index.ts`:

```typescript
// Components
export { AppSelectorComponent } from './lib/components/app-selector/app-selector';
export { ComponentSelectorComponent } from './lib/components/component-selector/component-selector';
```

---

## Step 5 — Add basic styles

The CSS files can start minimal. The consuming app (`myapp`) will provide real styles. For now, `app-selector.css` and `component-selector.css` just need to prevent layout breakage:

```css
/* Both files — minimal reset */
:host {
  display: block;
  position: relative;
}

.pd-app-list,
.pd-component-list {
  list-style: none;
  margin: 0;
  padding: 0;
  border: 1px solid #ccc;
  max-height: 300px;
  overflow-y: auto;
  background: white;
  position: absolute;
  z-index: 100;
  width: 100%;
}

.pd-app-option,
.pd-component-option {
  padding: 8px 12px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
}

.pd-app-option:hover,
.pd-component-option:hover {
  background: #f5f5f5;
}

.pd-app-icon {
  width: 20px;
  height: 20px;
  object-fit: contain;
}
```

---

## Files Created / Modified

| File | Action |
|------|--------|
| `poc/libs/connect-angular/src/lib/components/app-selector/app-selector.ts` | Create |
| `poc/libs/connect-angular/src/lib/components/app-selector/app-selector.html` | Create |
| `poc/libs/connect-angular/src/lib/components/app-selector/app-selector.css` | Create |
| `poc/libs/connect-angular/src/lib/components/component-selector/component-selector.ts` | Create |
| `poc/libs/connect-angular/src/lib/components/component-selector/component-selector.html` | Create |
| `poc/libs/connect-angular/src/lib/components/component-selector/component-selector.css` | Create |
| `poc/libs/connect-angular/src/index.ts` | Append exports |

## Notes

- The `App` and `Component` types come directly from `@pipedream/sdk` — import them from there, not from the library
- `listApps` with no query loads a default set; the user can then type to refine. Consider debouncing the search input (300ms) to avoid excessive API calls
- The `ComponentSelectorComponent` re-fetches when `app` or `componentType` inputs change — this is handled by the `effect()` in the constructor
- SDK responses use `.data` for the array and may include pagination (`page_info.has_next_page`). For the demo, pagination is omitted; add a "Load more" button if needed
