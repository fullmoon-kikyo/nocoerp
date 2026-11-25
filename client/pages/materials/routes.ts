import { Boxes, Database, FolderTree } from 'lucide-react';
import { defineAppRoutes } from '@nocobase/app-client/plugins';

export default defineAppRoutes([
  {
    name: 'materialManagement',
    navigation: { title: 'materials.navigation', icon: Boxes },
    children: [
      {
        name: 'materialCategories',
        path: '/materials/categories',
        auth: 'required',
        authz: {
          resource: { type: 'page', id: 'materials.categories' },
          action: 'access',
        },
        navigation: { title: 'categoryManagement.title', icon: FolderTree },
        breadcrumb: { title: 'categoryManagement.title' },
        componentLoader: () => import('./categories/index.js'),
        children: [
          {
            name: 'categoryMaterialDetail',
            path: 'materials/:id',
            breadcrumb: { title: 'materials.details' },
            presentation: { kind: 'child-page' },
            componentLoader: () => import('./material-form.js'),
          },
          {
            name: 'categoryManagementCreate',
            path: 'create',
            presentation: {
              kind: 'dialog',
              title: 'categoryManagement.create',
            },
            componentLoader: () => import('./category-form.js'),
          },
          {
            name: 'categoryManagementEdit',
            path: ':id/edit',
            presentation: { kind: 'dialog', title: 'categoryManagement.edit' },
            componentLoader: () => import('./categories/edit-form.js'),
          },
          {
            name: 'categoryManagementMove',
            path: ':id/move',
            presentation: { kind: 'dialog', title: 'categoryManagement.move' },
            componentLoader: () => import('./categories/move-form.js'),
          },
          {
            name: 'categoryManagementImport',
            path: 'import',
            presentation: {
              kind: 'dialog',
              title: 'categoryManagement.import',
            },
            componentLoader: () => import('./categories/import-form.js'),
          },
        ],
      },
      {
        name: 'materialMasterData',
        path: '/materials/master-data',
        auth: 'required',
        authz: {
          resource: { type: 'page', id: 'materials.master-data' },
          action: 'access',
        },
        navigation: { title: 'materials.masterData', icon: Database },
        breadcrumb: { title: 'materials.masterData' },
        componentLoader: () => import('./index.js'),
        children: [
          {
            name: 'materialCreate',
            path: 'create',
            breadcrumb: { title: 'materials.newMaterial' },
            presentation: { kind: 'child-page' },
            componentLoader: () => import('./material-form.js'),
          },
          {
            name: 'materialEdit',
            path: ':id/edit',
            breadcrumb: { title: 'materials.details' },
            presentation: { kind: 'child-page' },
            componentLoader: () => import('./material-form.js'),
          },
          {
            name: 'materialCategoryCreate',
            path: 'categories/create',
            presentation: { kind: 'dialog', title: 'materials.newCategory' },
            componentLoader: () => import('./category-form.js'),
          },
        ],
      },
    ],
  },
]);
