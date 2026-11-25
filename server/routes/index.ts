import type { Application } from '@nocobase/app-server/application';
import type { AppRouteContribution } from '@nocobase/app-server/router';
import materialMasterDataRoutes from './material-master-data.js';
import materialCategoryRoutes from './material-categories.js';

const routes: readonly AppRouteContribution<Application>[] = [
  materialCategoryRoutes,
  materialMasterDataRoutes,
];

export default routes;
