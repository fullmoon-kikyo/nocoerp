import NotificationManagementProvider from './notification-management.js';
import SubmissionProvider from './submission.js';
import MaterialMasterDataProvider from './material-master-data.js';
import type { ApplicationServiceProviderConstructor } from '@nocobase/app-server/application';

const serviceProviders: readonly ApplicationServiceProviderConstructor[] = [
  SubmissionProvider,
  NotificationManagementProvider,
  MaterialMasterDataProvider,
];

export default serviceProviders;
