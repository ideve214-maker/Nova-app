// 管理端内容列表用的分类 / 来源字段和筛选（服务端 2.1.2）。
// 来源目录复用 import-sources（经 import-feed 再导出）。
import {ApiError} from './errors.mjs';
import {normalizePostCategory, POST_CATEGORIES} from './post-category.mjs';
import {feedSourceById, SOURCE_LABEL} from './import-sources.mjs';

export function sourceDisplayName(id) {
  const key = String(id || '');
  const src = feedSourceById(key);
  if (src) return src.name;
  const label = SOURCE_LABEL[key];
  if (label) return String(label).replace(/^来自\s*/, '');
  return key;
}

export function adminSourceFields(row) {
  const key = String((row && row.source) || '').trim();
  if (!key) return {source: 'user', sourceLabel: '用户'};
  return {source: key, sourceLabel: sourceDisplayName(key)};
}

export function parseAdminPostFilters(q = {}) {
  const catRaw = q.category == null ? '' : String(q.category).trim();
  let category = null;
  if (catRaw) {
    category = normalizePostCategory(catRaw);
    if (!category) throw new ApiError(400, 'BAD_CATEGORY', 'category 只能是 ' + POST_CATEGORIES.join('、'));
  }
  const srcRaw = q.source == null ? '' : String(q.source).trim();
  let source = null;
  if (srcRaw) {
    if (srcRaw === 'user' || srcRaw === 'external') source = srcRaw;
    else if (feedSourceById(srcRaw)) source = srcRaw;
    else throw new ApiError(400, 'BAD_SOURCE', '来源取值无效');
  }
  return {category, source};
}

export function pushAdminPostFilters(where, args, filters, {sourceCol = 'source', categoryCol = 'category'} = {}) {
  if (!filters) return;
  if (filters.category) { where.push(categoryCol + '=?'); args.push(filters.category); }
  if (filters.source === 'user') where.push('(' + sourceCol + " IS NULL OR " + sourceCol + "='')");
  else if (filters.source === 'external') where.push('(' + sourceCol + ' IS NOT NULL AND ' + sourceCol + "!='')");
  else if (filters.source) { where.push(sourceCol + '=?'); args.push(filters.source); }
}
