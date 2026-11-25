import type { Application } from '@nocobase/app-server/application';
import { ServiceProvider } from '@nocobase/service-provider';
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import {
  categoryCollection,
  materialCollection,
  categoryResource,
  materialResource,
} from '../material-master-data/resources.js';

export default class MaterialMasterDataProvider extends ServiceProvider<Application> {
  readonly name = 'app/material-master-data';
  override boot(): Promise<void> {
    const authz = this.app.container.resolve(authorizationToken);
    authz.database.collections.add({
      name: categoryCollection,
      title: { key: 'materials.categories', ns: 'nocoerp-app' },
    });
    authz.database.collections.add({
      name: materialCollection,
      title: { key: 'materials.title', ns: 'nocoerp-app' },
    });
    authz.compositeResources.define(categoryResource);
    authz.compositeResources.define(materialResource);
    authz.ui.sections.add({
      name: 'materials',
      title: { key: 'materials.navigation', ns: 'nocoerp-app' },
      parent: 'business',
    });
    authz.ui.place(
      { type: 'composite', id: 'masterData.categories' },
      { section: 'materials' },
    );
    authz.ui.place(
      { type: 'composite', id: 'masterData.materials' },
      { section: 'materials' },
    );
    return Promise.resolve();
  }
}
