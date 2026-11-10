import { randomUUID } from 'node:crypto';
import { HttpError } from './articles.mjs';
import { pageOptions } from './audit.mjs';
function text(value, label, min, max) {
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) throw new HttpError(400, `${label}长度须为 ${min} 至 ${max} 个字符。`);
  return value.trim();
}
function feedbackContent(input) {
  if (!input || !['suggestion', 'consultation', 'feedback'].includes(input.type)) throw new HttpError(400, '请选择有效的留言类型。');
  return { type: input.type, title: text(input.title, '留言标题', 2, 60), content: text(input.content, '留言内容', 10, 1000) };
}
export function validateFeedback(input) {
  const content = feedbackContent(input);
  const gameName = text(input.gameName, '游戏名称', 1, 40);
  if (typeof input.qq !== 'string' || !/^[1-9][0-9]{4,11}$/.test(input.qq.trim())) throw new HttpError(400, 'QQ 号须为 5 至 12 位数字，首位不能为 0。');
  return { ...content, gameName, qq: input.qq.trim() };
}
export function newFeedback(input, now = Date.now()) {
  return { ...validateFeedback(input), id: randomUUID(), createdAt: new Date(now).toISOString(), status: 'new' };
}
export function serializeFeedback(feedback) {
  const encoded = JSON.stringify({ version: 1, feedback }, null, 2) + '\n';
  // Reserve processing space for every stored record. A read record can be
  // marked unread later, so capacity must not depend on its current status.
  const unread = feedback.map(({ readBy, readAt, ...item }) => ({ ...item, status: 'new' }));
  const budget = Buffer.byteLength(JSON.stringify({ version: 1, feedback: unread }, null, 2) + '\n') + feedback.length * 1024;
  if (feedback.length > 5000 || budget > 16 * 1024 * 1024 || Buffer.byteLength(encoded) > 16 * 1024 * 1024) throw new HttpError(413, '反馈记录不能超过 5000 条或 16 MiB（含处理空间）。');
  return encoded;
}
export function validateStoredFeedback(input) {
  if (!Array.isArray(input)) throw new HttpError(400, '反馈记录格式不正确。');
  const ids = new Set();
  const timestamp = value => { if (typeof value !== 'string' || value.length !== 24 || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new HttpError(400, '反馈时间格式不正确。'); return value; };
  const records = input.map(item => {
    if (!item || typeof item.id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(item.id) || ids.has(item.id) || !['new', 'read'].includes(item.status)) throw new HttpError(400, '反馈记录格式不正确。');
    ids.add(item.id);
    const legacy = !Object.hasOwn(item, 'gameName') && !Object.hasOwn(item, 'qq');
    const record = { ...(legacy ? feedbackContent(item) : validateFeedback(item)), id: item.id, createdAt: timestamp(item.createdAt), status: item.status };
    if (item.status === 'read') {
      if (!item.readBy || typeof item.readBy.id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(item.readBy.id) || typeof item.readBy.username !== 'string' || !/^[A-Za-z0-9_-]{3,40}$/.test(item.readBy.username)) throw new HttpError(400, '反馈处理账号格式不正确。');
      record.readBy = { id: item.readBy.id, username: item.readBy.username }; record.readAt = timestamp(item.readAt);
    }
    return record;
  });
  serializeFeedback(records); return records;
}
export function feedbackPage(feedback, parameters) {
  const { page, pageSize, search } = pageOptions(parameters); const status = parameters.get('status') || '';
  if (status && !['new', 'read'].includes(status)) throw new HttpError(400, '反馈筛选状态不正确。');
  const filtered = [...feedback].reverse().filter(item => (!status || item.status === status) && (!search || [item.title, item.content, item.id, item.gameName, item.qq].join(' ').toLowerCase().includes(search)));
  return { feedback: filtered.slice((page - 1) * pageSize, page * pageSize), total: filtered.length, page, pageSize };
}
export function feedbackRateLimit(now = Date.now, entries = new Map()) {
  return (ip, response) => {
    const at = now(); let entry = entries.get(ip);
    if (!entry || entry.until <= at) { entry = { count: 0, until: at + 60000 }; entries.set(ip, entry); }
    if (++entry.count > 5) { response.setHeader('Retry-After', String(Math.max(1, Math.ceil((entry.until - at) / 1000)))); throw new HttpError(429, '提交过于频繁，请稍后再试。'); }
    if (entries.size > 10000) for (const [key, value] of entries) if (value.until <= at) entries.delete(key);
  };
}
