import { contentFields, defaultSiteContent } from '../public/site-content-schema.js';
import { HttpError } from './articles.mjs';

export const MAX_SITE_CONTENT_BYTES = 1024 * 1024;
const fields = new Map(contentFields.map(field => [field.key, field]));
const plainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

export function validateSiteContent(input) {
  if (!plainObject(input) || input.version !== 1 || !plainObject(input.values) || Object.keys(input).some(key => !['version', 'values'].includes(key))) throw new HttpError(400, '网站内容格式不正确，请使用本系统的内容配置。');
  const values = { ...defaultSiteContent.values };
  for (const [key, value] of Object.entries(input.values)) {
    const field = fields.get(key);
    if (!field) throw new HttpError(400, `网站内容包含未知区域：${key}。`);
    if (typeof value !== 'string') throw new HttpError(400, `${field.label}必须是文本。`);
    if (value.length > field.maxLength) throw new HttpError(400, `${field.label}不能超过 ${field.maxLength} 个字符。`);
    values[key] = value;
  }
  const content = { version: 1, values };
  serializeSiteContent(content);
  return content;
}

export function serializeSiteContent(content) {
  const encoded = JSON.stringify(content, null, 2) + '\n';
  if (Buffer.byteLength(encoded, 'utf8') > MAX_SITE_CONTENT_BYTES) throw new HttpError(413, '网站内容总容量不能超过 1 MiB。此次操作未保存。');
  return encoded;
}

export function renameSampleArticles(articles) {
  const rename = value => value.replaceAll('云川市人民政府', '晏阳联合政府').replaceAll('云川市', '晏阳').replaceAll('云川', '晏阳');
  return articles.map(article => article.isSample === true ? {
    ...article,
    title: rename(article.title),
    summary: rename(article.summary),
    source: rename(article.source),
    body: article.body.map(rename)
  } : article);
}
