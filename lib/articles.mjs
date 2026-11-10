import { createHash, randomUUID } from 'node:crypto';

export const categories = ['政务要闻', '通知公告', '政策文件', '政策解读', '部门动态', '民生资讯'];
export const MAX_ARTICLE_DATA_BYTES = 64 * 1024 * 1024;
export const translationLanguages = Object.freeze(['zh-TW', 'en', 'ko', 'ja', 'de', 'fr', 'ru', 'es', 'ar', 'pt', 'it']);
export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export function serializeArticleData(articles) {
  if (articles.length > 10000) throw new HttpError(413, '文章数量不能超过 10000 篇，请先备份并清理不再需要的内容。');
  const encoded = JSON.stringify({ version: 1, articles }, null, 2) + '\n';
  if (Buffer.byteLength(encoded, 'utf8') > MAX_ARTICLE_DATA_BYTES) throw new HttpError(413, '文章数据总容量不能超过 64 MiB，请先备份并清理不再需要的内容。此次操作未保存。');
  return encoded;
}
function text(value, label, min, max, fallback) {
  if (value === undefined && fallback !== undefined) value = fallback;
  if (typeof value !== 'string') throw new HttpError(400, `${label}必须是文本。`);
  value = value.trim();
  if (value.length < min || value.length > max) throw new HttpError(400, `${label}长度须为 ${min} 至 ${max} 个字符。`);
  return value;
}
export function articleTranslationFingerprint(article) {
  return createHash('sha256').update(JSON.stringify([article.title, article.summary || '', article.source || '', article.body])).digest('hex');
}
export function validateTranslatedContent(input, paragraphCount) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, '文章译文格式不正确。');
  const title = text(input.title, '译文标题', 1, 1000);
  const summary = text(input.summary, '译文摘要', 0, 4000, '');
  const source = text(input.source, '译文来源', 0, 1000, '');
  if (!Array.isArray(input.body) || input.body.length !== paragraphCount) throw new HttpError(400, '译文段落须与原文一一对应。');
  const body = input.body.map(value => text(value, '译文段落', 1, 200000));
  if (body.reduce((size, value) => size + value.length, 0) > 200000) throw new HttpError(400, '文章译文过长。');
  return { title, summary, source, body };
}
function validateTranslation(input, article) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !/^[a-f0-9]{64}$/.test(input.fingerprint) || !['pending', 'translating', 'completed', 'failed'].includes(input.status)
    || !input.locales || typeof input.locales !== 'object' || Array.isArray(input.locales)
    || typeof input.updatedAt !== 'string' || input.updatedAt.length > 40 || !Number.isFinite(Date.parse(input.updatedAt))) throw new HttpError(400, '文章翻译状态格式不正确。');
  const locales = {};
  for (const [language, content] of Object.entries(input.locales)) {
    if (!translationLanguages.includes(language)) throw new HttpError(400, '不支持此文章译文语言。');
    locales[language] = validateTranslatedContent(content, article.body.length);
  }
  if (input.status === 'completed' && Object.keys(locales).length !== translationLanguages.length) throw new HttpError(400, '文章译文尚未全部完成。');
  if (input.error !== undefined && !['engine_unavailable', 'translation_failed', 'translation_timeout', 'invalid_translation'].includes(input.error)) throw new HttpError(400, '文章翻译错误状态不正确。');
  return { fingerprint: input.fingerprint, status: input.status, locales, updatedAt: new Date(input.updatedAt).toISOString(), ...(input.error ? { error: input.error } : {}) };
}
function scheduleTimestamp(value) {
  const invalid = () => new HttpError(400, '定时发布时间须为带明确时区的有效 ISO 8601 日期时间，包含时、分、秒。');
  if (typeof value !== 'string' || value.length > 40) throw invalid();
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (!match) throw invalid();
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, offsetHourText, offsetMinuteText] = match;
  const year = Number(yearText), month = Number(monthText), day = Number(dayText);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth[month - 1] || Number(hourText) > 23 || Number(minuteText) > 59 || Number(secondText) > 59 || Number(offsetHourText ?? 0) > 23 || Number(offsetMinuteText ?? 0) > 59) throw invalid();
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw invalid();
  const normalized = new Date(time).toISOString();
  if (!/^\d{4}-/.test(normalized)) throw invalid();
  return normalized;
}
export function validateScheduleTime(article, now = Date.now()) {
  if (article.status === 'scheduled' && Date.parse(scheduleTimestamp(article.scheduledAt)) <= now) throw new HttpError(400, '定时发布时间须晚于当前时间。');
  return article;
}
export function validateArticle(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, '文章格式不正确。');
  const title = text(input.title, '标题', 2, 100);
  if (!categories.includes(input.category)) throw new HttpError(400, '请选择有效的文章栏目。');
  const date = text(input.date, '发布日期', 10, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number(date.slice(0, 4)) < 1900 || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) throw new HttpError(400, '发布日期须为有效的 YYYY-MM-DD 日期。');
  const summary = text(input.summary, '摘要', 0, 400, '');
  const source = text(input.source, '来源', 0, 80, '');
  if (!['published', 'draft', 'scheduled'].includes(input.status)) throw new HttpError(400, '请选择发布、草稿或定时发布状态。');
  if (!Array.isArray(input.body) || input.body.length === 0 || input.body.length > 1000) throw new HttpError(400, '正文必须包含至少一个段落。');
  const body = input.body.map(paragraph => text(paragraph, '正文段落', 1, 50000));
  if (body.reduce((total, paragraph) => total + paragraph.length, 0) > 50000) throw new HttpError(400, '正文总长度不能超过 50000 个字符。');
  const scheduledAt = input.status === 'scheduled' || (input.status === 'published' && input.scheduledAt != null) ? scheduleTimestamp(input.scheduledAt) : undefined;
  if (input.autoTranslate !== undefined && typeof input.autoTranslate !== 'boolean') throw new HttpError(400, '自动翻译选项必须为是或否。');
  return { title, category: input.category, date, summary, body, source, status: input.status, ...(scheduledAt === undefined ? {} : { scheduledAt }), ...(input.autoTranslate === undefined ? {} : { autoTranslate: input.autoTranslate }) };
}
export function newArticle(input) {
  const now = new Date().toISOString();
  return { ...validateArticle(input), id: randomUUID(), isSample: false, createdAt: now, updatedAt: now };
}
export function validateStoredArticles(articles) {
  if (!Array.isArray(articles)) throw new HttpError(400, '备份必须包含文章数组。');
  if (articles.length > 10000) throw new HttpError(413, '文章数量不能超过 10000 篇，请先备份并清理不再需要的内容。');
  const ids = new Set();
  const validated = articles.map(input => {
    const article = validateArticle(input);
    if (typeof input.id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(input.id) || ids.has(input.id)) throw new HttpError(400, '文章编号不合法或重复。');
    ids.add(input.id);
    const now = new Date().toISOString();
    const timestamp = (value, label) => {
      if (value === undefined) return now;
      if (typeof value !== 'string' || value.length > 40 || !Number.isFinite(Date.parse(value))) throw new HttpError(400, `${label}格式不正确。`);
      return new Date(value).toISOString();
    };
    const translation = input.translation && article.autoTranslate === true && input.translation.fingerprint === articleTranslationFingerprint(article) ? validateTranslation(input.translation, article) : undefined;
    return { ...article, id: input.id, isSample: input.isSample === true, createdAt: timestamp(input.createdAt, '创建时间'), updatedAt: timestamp(input.updatedAt, '更新时间'), ...(translation ? { translation } : {}) };
  });
  serializeArticleData(validated);
  return validated;
}
export function sortArticles(articles) {
  return [...articles].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
}
