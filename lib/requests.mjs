import { createHash, randomUUID } from 'node:crypto';
import { HttpError, validateStoredArticles } from './articles.mjs';

export function articleFingerprint(article) {
  const { translation, ...source } = article;
  return createHash('sha256').update(JSON.stringify(source)).digest('hex');
}
export function contentRequest(type, article, actor) {
  return { id: randomUUID(), type, status: 'pending', requestedBy: { id: actor.id, username: actor.username }, createdAt: new Date().toISOString(), article: structuredClone(article), ...(type === 'delete' ? { articleId: article.id, articleHash: articleFingerprint(article) } : {}), note: '' };
}
export function validateReview(input) {
  if (!['approve', 'reject'].includes(input.decision)) throw new HttpError(400, '请选择批准或驳回。');
  const note = input.note ?? '';
  if (typeof note !== 'string' || note.length > 2000) throw new HttpError(400, '审批意见须为不超过 2000 字的文本。');
  return { decision: input.decision, note: note.trim() };
}
export function validateRequests(input) {
  if (!Array.isArray(input)) throw new HttpError(400, '审批记录格式不正确。');
  if (input.length > 5000) throw new HttpError(413, '审批记录不能超过 5000 条。');
  const ids = new Set();
  const identity = person => {
    if (!person || typeof person.id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(person.id) || typeof person.username !== 'string' || !/^[A-Za-z0-9_-]{3,40}$/.test(person.username)) throw new HttpError(400, '审批账号记录格式不正确。');
    return { id: person.id, username: person.username };
  };
  const timestamp = value => {
    if (typeof value !== 'string' || value.length > 40 || !Number.isFinite(Date.parse(value))) throw new HttpError(400, '审批时间格式不正确。');
    return new Date(value).toISOString();
  };
  const requests = input.map(item => {
    if (!item || typeof item.id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(item.id) || ids.has(item.id) || !['publish', 'delete'].includes(item.type) || !['pending', 'approved', 'rejected'].includes(item.status)) throw new HttpError(400, '审批记录格式不正确或编号重复。');
    ids.add(item.id);
    const article = validateStoredArticles([item.article])[0];
    if (item.type === 'publish' ? !['published', 'scheduled'].includes(article.status) : article.status !== 'published') throw new HttpError(400, '发布申请须为发布或定时发布内容，删除申请须为已发布内容。');
    const note = item.note ?? '';
    if (typeof note !== 'string' || note.length > 2000) throw new HttpError(400, '审批意见格式不正确。');
    const result = { id: item.id, type: item.type, status: item.status, requestedBy: identity(item.requestedBy), createdAt: timestamp(item.createdAt), article, note };
    if (item.type === 'delete') {
      if (item.articleId !== article.id || typeof item.articleHash !== 'string' || !/^[0-9a-f]{64}$/.test(item.articleHash) || item.articleHash !== articleFingerprint(article)) throw new HttpError(400, '删除申请的文章快照格式不正确。');
      result.articleId = item.articleId; result.articleHash = item.articleHash;
    }
    if (item.status !== 'pending') { result.reviewedBy = identity(item.reviewedBy); result.reviewedAt = timestamp(item.reviewedAt); }
    return result;
  });
  serializeRequests(requests);
  return requests;
}
export function serializeRequests(requests) {
  const encoded = JSON.stringify({ version: 1, requests }, null, 2) + '\n';
  // Reserve enough for a 2000-character opinion even when every character
  // needs a six-byte JSON escape, plus the longest reviewer and timestamp.
  const reserved = requests.filter(item => item.status === 'pending').length * 14 * 1024;
  if (Buffer.byteLength(encoded) + reserved > 32 * 1024 * 1024) throw new HttpError(413, '审批记录总容量（含待审批处理空间）不能超过 32 MiB。');
  return encoded;
}
