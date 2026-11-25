import { categoryEnUS } from '../../shared/category-locales.js';
import type { LocaleResource } from '@nocobase/i18n';
import { materialEnUS } from '../../shared/material-locales.js';

// Keep business permission labels aligned with the application's client wording.
const enUS = { categoryManagement: categoryEnUS, materials: materialEnUS };

export type AppServerResource = LocaleResource<typeof enUS>;

export default enUS;
