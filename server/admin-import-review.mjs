// 服务端 2.1.0：管理端「外部帖审查」接口（管理端 2.0.8 对接，见 docs/server-2.1.0-api.md）。
// 业务逻辑在 ai-review.mjs，这里只做鉴权、参数和审计。
import {ApiError} from './errors.mjs';

export function importReviewRoutes({aiReview, adminAuth, audit, ip}) {
  return {
    // → {settings, stats, job}
    'GET /api/admin/ai-moderation/import'(req) {
      adminAuth(req);
      return aiReview.state();
    },
    // body: Partial<settings> = {enabled?, reviewComments?, onAiDown?: 'skip'|'keyword', autoBackfill?} → {settings, stats, job}
    'POST /api/admin/ai-moderation/import'(req, b) {
      const {admin} = adminAuth(req);
      const body = b || {};
      if (body.onAiDown != null && !['skip', 'keyword'].includes(String(body.onAiDown))) {
        throw new ApiError(400, 'BAD_ON_AI_DOWN', 'onAiDown 只能是 skip 或 keyword');
      }
      const st = aiReview.saveSettings(body);
      audit(admin.id, 'admin.ai_moderation.import', 'ai', ip(req), st);
      return aiReview.state();
    },
    // body: {scope: 'all'|'v2ex'|'hn'} → {job}；后台异步补审；已有任务在跑时 409 JOB_RUNNING（error.job 带当前任务）
    'POST /api/admin/ai-moderation/import/backfill'(req, b) {
      const {admin} = adminAuth(req);
      const scope = String((b && b.scope) || 'all');
      if (!['all', 'v2ex', 'hn'].includes(scope)) throw new ApiError(400, 'BAD_SCOPE', 'scope 只能是 all、v2ex 或 hn');
      let job;
      try { job = aiReview.startBackfill({scope, actorId: admin.id}); }
      catch (e) {
        if (e && e.status === 409) throw new ApiError(409, 'JOB_RUNNING', '已有补审任务在进行，请等它结束或先停止', {job: e.job});
        throw e;
      }
      audit(admin.id, 'admin.ai_moderation.import.backfill', 'job:' + job.id, ip(req), {scope, total: job.total});
      return {job};
    },
    // → {job}（没有任务时 job 为 null；停止是在当前这条审完后生效，status 变为 stopped）
    'POST /api/admin/ai-moderation/import/backfill/stop'(req) {
      const {admin} = adminAuth(req);
      const job = aiReview.stopBackfill();
      audit(admin.id, 'admin.ai_moderation.import.backfill.stop', job ? 'job:' + job.id : 'job:none', ip(req));
      return {job};
    },
  };
}
