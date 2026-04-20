import { Route } from '@angular/router';

export const appRoutes: Route[] = [
  { path: '', redirectTo: 'workflows', pathMatch: 'full' },
  {
    path: 'workflows',
    loadComponent: () =>
      import('@poc/feature-workflow-builder').then((m) => m.WorkflowsPageComponent),
  },
  {
    path: 'accounts',
    loadComponent: () =>
      import('@poc/feature-manage-connected-accounts').then(
        (m) => m.FeatureManageConnectedAccountsComponent,
      ),
  },
  {
    path: 'triggers',
    loadComponent: () =>
      import('@poc/feature-workflow-builder').then(
        (m) => m.DeployedTriggersPageComponent,
      ),
  },
];
