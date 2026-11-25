import system from './system/zh-CN.js';
import type enUS from './sharing-en-US.js';
import type { LocaleResource } from '@nocobase/i18n';

const sharingRules: LocaleResource<typeof enUS> = {
  ...system.settings.defaultAccess,
  none: '不共享',
  title: '共享规则',
  description: '将指定记录共享给已具备相应操作权限的明确人员或团队。',
  boundary:
    '共享只增加数据范围，不授予页面、操作或字段权限，也不自动共享关联记录；限制规则仍然生效。',
  new: '新建共享规则',
  edit: '共享规则',
  name: '规则名称',
  reason: '共享原因',
  search: '搜索规则或接收对象编号',
  noResources:
    '当前尚无可共享的业务记录。请先添加业务模块，并声明支持的操作和数据范围。',
  noResourcesShort: '暂无可共享的业务数据',
  recipients: '接收对象',
  recipientType: '接收对象类型',
  recipientHint: '选择明确的人员或已注册团队，保存前核对下方每一位接收对象。',
  noRecipients: '尚未选择接收对象。',
  recipientCount: '{{count}} 个接收对象',
  searchRecipients: '搜索接收对象',
  noMatches: '没有匹配项。',
  unresolved: '对象暂不可用，明确移除前保留',
  removeRecipient: '移除接收对象 {{name}}',
  remove: '移除',
  previous: '上一页',
  next: '下一页',
  page: '第 {{page}} 页 · 共 {{total}} 项',
  specificRecords: '选择指定记录',
  pickRecords: '选择记录',
  selectedRecords: '已选 {{count}} 条记录',
  removeRecord: '移除记录 {{id}}',
  actionsRequired:
    '请至少选择一个操作，并选择非空的指定记录或受支持的数据范围。',
  recipientsRequired: '请至少选择一个明确的接收对象。',
  delete: '撤销共享',
  deleteTitle: '撤销「{{name}}」？',
  deleteHint:
    '仅移除此共享规则，其他共享规则、角色授权和独立权限来源仍然保留。',
  deleted: '已撤销共享「{{name}}」。',
  saved: '已保存共享「{{name}}」。',
  unsupported:
    '此规则包含不可用操作或不受支持的选择，为保留原配置，当前仅供查看。',
  changed: '编辑期间此规则已被其他人修改，请重新加载后再保存。',
  deleteChanged: '此规则已变更，请核对最新配置后再撤销。',
  duplicate: '此规则标识已存在，请使用其他标识。',
  back: '返回共享规则',
};
export default sharingRules;
