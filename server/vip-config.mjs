// NOVA VIP 权益与额度配置 —— 唯一数据源。
// 服务端权益检查、会员中心页面（经 /api/vip/catalog）、权益表文档、测试都读这里；不要在别处另写一份数字。
// 产品原则（来自 M2.3 调研与负责人决定）：
//   · 安全、隐私、基本聊天、好友、举报/拉黑、内容治理不收费，不出现在权益表里；
//   · VIP 只扩展个性化和适度便利额度；不卖曝光、推荐、聊天优先级，也不因 VIP 获得社区/群管理权限；
//   · 价格只是占位，支付未接入。

const DAY = 864e5;

export const VIP_CONFIG = Object.freeze({
  version: 1,

  // 到期规则：服务端每次请求都按当前时间重新计算，到期立即回落 Basic，没有宽限期。
  expiry: Object.freeze({
    soonDays: 3,                 // 距到期不足该天数 → 状态 expiring（仅提示，权益仍有效）
    graceDays: 0,
    testGrantDays: 30,           // 开发环境「测试 VIP」一次授予的天数（M2.4.4）
    rule: '到期后由服务端立即按 Basic 处理，没有宽限期。',
    dataPolicy: '已创建的内容和数据一律保留；到期只失去「新增 / 使用」该权益的能力。',
  }),

  plans: Object.freeze({
    basic: Object.freeze({
      id: 'basic',
      name: 'Basic',
      tagline: '完整的核心社交与安全能力，永久免费',
    }),
    vip: Object.freeze({
      id: 'vip',
      name: 'NOVA VIP',
      tagline: '更多个性化与适度额度，不影响任何人的基本使用',
      prices: Object.freeze([
        Object.freeze({period: 'month', label: '¥9.9/月', amountCents: 990, currency: 'CNY'}),
        Object.freeze({period: 'year', label: '¥99/年', amountCents: 9900, currency: 'CNY'}),
      ]),
      priceNote: '价格暂定，正式上线前可能调整。',
      purchase: Object.freeze({enabled: false, label: '暂未开放', reason: '支付功能尚未接入'}),
    }),
  }),

  // 不论是否 VIP 都完整保留的能力（会员中心要把这条边界讲清楚）。
  alwaysFree: Object.freeze([
    '发帖、评论、关注与基础聊天',
    '好友、举报与拉黑',
    '账号安全与隐私设置',
    '私聊端到端加密（功能落地后同样对所有人开放）',
    '社区与群的管理权限只按角色授予，不因 VIP 自动获得',
  ]),
  neverSold: Object.freeze(['推荐与曝光优先级', '聊天优先级', '公共置顶名额']),

  // 权益表。key 是服务端 entitlement key；改名等于改接口，请同步测试。
  // kind: flag = 有/无；quota = 数量/长度上限（number，或按 scope 分开的对象）。
  // status: live = 功能已实现并通过测试；planned = 尚未实现（对应步骤完成并验证后才改成 live，不提前承诺）。
  entitlements: Object.freeze({
    vip_badge: Object.freeze({
      title: 'NOVA VIP 标识', kind: 'flag', basic: false, vip: true, status: 'live', phase: 'M2.5.2',
      description: '名字旁显示 VIP 标识。它只表示订阅状态，不是实名认证。',
      onExpire: '标识立即消失。',
    }),
    profile_theme_gold: Object.freeze({
      title: '香槟金主题', kind: 'flag', basic: false, vip: true, status: 'live', phase: 'M2.4.5',
      description: '整套香槟金配色，深色与浅色模式都有，可随时切回默认。',
      onExpire: '立即恢复默认主题；你的偏好会保留，续订后自动恢复。',
    }),
    profile_decoration: Object.freeze({
      title: '资料边框与装饰', kind: 'flag', basic: false, vip: true, status: 'live', phase: 'M2.5.2',
      description: '头像金边与个人主页装饰。',
      onExpire: '边框和装饰立即消失。',
    }),
    personal_saved_items_plus: Object.freeze({
      title: '更多个人收藏', kind: 'quota', unit: '条', basic: 20, vip: 100, status: 'live', phase: 'M2.5.3',
      description: '只增加你自己的私有收藏额度；群聊、社区的公共置顶不受影响。',
      onExpire: '已收藏的内容保留；超出基础额度后不能新增，可随时取消收藏腾出名额。',
    }),
    longer_post_text: Object.freeze({
      title: '更长的发帖与发言', kind: 'quota', unit: '字',
      basic: Object.freeze({post: 280, chat: 500, channel: 280}),
      vip: Object.freeze({post: 1000, chat: 1500, channel: 800}),
      scopeNames: Object.freeze({post: '动态', chat: '聊天消息', channel: '社区频道发言'}),
      status: 'live', phase: 'M2.5.4',
      description: '适度提高单条文字上限；上限由服务端校验，不是无限制。',
      onExpire: '已发布的长内容保留；之后新发的内容按 Basic 上限。',
    }),
    premium_emoji_pack: Object.freeze({
      title: '专属表情包', kind: 'flag', basic: false, vip: true, status: 'live', phase: 'M2.5.5',
      description: '香槟金系列贴纸，可在聊天中从面板选用；所有人都能正常看到并交流。',
      onExpire: '已发出的贴纸仍对所有人可见，但不能再从专属面板选用。',
    }),
    media_quota_plus: Object.freeze({
      title: '更大的媒体额度', kind: 'quota', unit: 'MB', basic: null, vip: null, status: 'planned', phase: 'M4.5 之后',
      description: '图片/视频存储额度。要等媒体上传、鉴权与成本核算完成后才确定数值。',
      onExpire: '已上传文件保留；超额后不能新上传（细则在 M4.5 确定）。',
    }),
  }),
});

export const entitlementKeys = (cfg = VIP_CONFIG) => Object.keys(cfg.entitlements);

/** 取某权益在某套餐下的值。quota 且有 scope 时返回该 scope 的数字；未知 key/scope 返回 undefined。 */
export function valueOf(key, plan, scope, cfg = VIP_CONFIG) {
  const e = cfg.entitlements[key];
  if (!e || (plan !== 'basic' && plan !== 'vip')) return undefined;
  const v = e[plan];
  if (v !== null && typeof v === 'object') return scope === undefined ? undefined : v[scope];
  return v;
}

/** 启动时与测试都会调用：返回问题清单，空数组表示配置合法。 */
export function validateConfig(cfg = VIP_CONFIG) {
  const errs = [], add = m => errs.push(m);
  const ex = cfg.expiry || {};
  if (!(Number.isInteger(ex.soonDays) && ex.soonDays >= 0)) add('expiry.soonDays 必须是非负整数');
  if (ex.graceDays !== 0) add('expiry.graceDays 目前必须为 0（到期立即回落）');
  if (!(Number.isInteger(ex.testGrantDays) && ex.testGrantDays > 0)) add('expiry.testGrantDays 必须是正整数');
  if (!ex.rule || !ex.dataPolicy) add('expiry 必须写明 rule 与 dataPolicy');
  if (!cfg.plans || !cfg.plans.basic || !cfg.plans.vip) add('必须同时有 basic 与 vip 套餐');
  const vip = cfg.plans && cfg.plans.vip;
  if (vip) {
    if (!vip.priceNote) add('vip 套餐必须带价格暂定说明');
    if (!vip.purchase || vip.purchase.enabled !== false) add('支付未接入：purchase.enabled 必须为 false');
    for (const p of vip.prices || []) if (!(Number.isInteger(p.amountCents) && p.amountCents > 0 && p.label)) add('价格项不合法：' + JSON.stringify(p));
  }
  const keys = entitlementKeys(cfg);
  if (!keys.length) add('权益表不能为空');
  for (const key of keys) {
    const e = cfg.entitlements[key], at = `权益 ${key}`;
    if (!/^[a-z][a-z0-9_]*$/.test(key)) add(`${at}：key 只能是小写字母、数字、下划线`);
    for (const f of ['title', 'description', 'onExpire', 'phase']) if (!e[f] || typeof e[f] !== 'string') add(`${at}：缺少 ${f}`);
    if (!['flag', 'quota'].includes(e.kind)) add(`${at}：kind 必须是 flag 或 quota`);
    if (!['live', 'planned'].includes(e.status)) add(`${at}：status 必须是 live 或 planned`);
    if (e.status === 'planned' && e.basic === null && e.vip === null) continue;   // 数值待定的占位项（如媒体额度）
    if (e.kind === 'flag') {
      if (e.basic !== false) add(`${at}：flag 的 basic 必须为 false（Basic 不含该权益）`);
      if (e.vip !== true) add(`${at}：flag 的 vip 必须为 true`);
    } else {
      if (!e.unit) add(`${at}：quota 必须写 unit`);
      const b = e.basic, v = e.vip;
      if (typeof b === 'number' && typeof v === 'number') {
        if (!(Number.isInteger(b) && b > 0 && Number.isInteger(v) && v > b)) add(`${at}：额度须为正整数且 VIP > Basic`);
      } else if (b && v && typeof b === 'object' && typeof v === 'object') {
        const scopes = Object.keys(b);
        if (!scopes.length || scopes.sort().join() !== Object.keys(v).sort().join()) add(`${at}：basic 与 vip 的 scope 必须一致`);
        for (const s of scopes) if (!(Number.isInteger(b[s]) && b[s] > 0 && Number.isInteger(v[s]) && v[s] >= b[s])) add(`${at}.${s}：额度须为正整数且 VIP ≥ Basic`);
        if (!e.scopeNames || scopes.some(s => !e.scopeNames[s])) add(`${at}：每个 scope 都要有 scopeNames`);
      } else add(`${at}：basic 与 vip 的类型必须一致（数字或按 scope 的对象）`);
    }
  }
  return errs;
}

// 启动即校验：配置写错就拒绝启动，不要带着错误的额度上线。
{
  const errs = validateConfig();
  if (errs.length) throw new Error('VIP 配置不合法：\n - ' + errs.join('\n - '));
}

export const DAY_MS = DAY;
