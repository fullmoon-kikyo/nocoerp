import { categoryZhCN } from '../../shared/category-locales.js';
import fileUi from '../extensions/nocobase-file-component-ui/locales/zh-CN.js';
import type { AppResource } from './en-US.js';
import systemZhCN from './system/zh-CN.js';
import sharingRules from './sharing-zh-CN.js';
import { materialZhCN } from '../../shared/material-locales.js';

const zhCN: AppResource = {
  // The template's own copy; see `./en-US.ts`.
  ...systemZhCN,
  ...fileUi,
  sharingRules,
  categoryManagement: categoryZhCN,
  materials: materialZhCN,
};

export default zhCN;
