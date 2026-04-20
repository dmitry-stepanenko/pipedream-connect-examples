import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <div class="app-layout">
      <nav class="app-nav">
        <span class="app-logo">Workflow Builder</span>
        <a routerLink="/workflows" routerLinkActive="app-nav__link--active" class="app-nav__link">
          Workflows
        </a>
        <a routerLink="/accounts" routerLinkActive="app-nav__link--active" class="app-nav__link">
          Connected Accounts
        </a>
        <a routerLink="/triggers" routerLinkActive="app-nav__link--active" class="app-nav__link">
          Deployed Triggers
        </a>
      </nav>
      <div class="app-content">
        <router-outlet />
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; height: 100vh; }
    .app-layout {
      display: flex;
      flex-direction: column;
      height: 100%;
      font-family: system-ui, sans-serif;
    }
    .app-nav {
      display: flex;
      align-items: center;
      gap: 0.25rem;
      height: 52px;
      padding: 0 1.25rem;
      border-bottom: 1px solid #e5e7eb;
      background: #fff;
      flex-shrink: 0;
    }
    .app-logo {
      font-size: 1rem;
      font-weight: 700;
      color: #111827;
      margin-right: 1.5rem;
    }
    .app-nav__link {
      padding: 0.35rem 0.75rem;
      border-radius: 4px;
      font-size: 0.875rem;
      color: #374151;
      text-decoration: none;
    }
    .app-nav__link:hover { background: #f3f4f6; }
    .app-nav__link--active {
      background: #eef2ff;
      color: #4f46e5;
      font-weight: 500;
    }
    .app-content {
      flex: 1;
      overflow: hidden;
    }
  `],
})
export class App {}
