import { randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { HttpError, validateStoredArticles } from './articles.mjs';
import { validateSiteContent } from './site-content.mjs';
import { normalizeAccounts } from './accounts.mjs';
import { validateRequests } from './requests.mjs';
import { appendAudit, validateLogs } from './audit.mjs';
import { validateStoredFeedback } from './feedback.mjs';
import { validateTranslationSettings } from './translation-settings.mjs';
import { defaultSiteContent, migratePortalDefaults } from '../public/site-content-schema.js';
import { articles as examples } from '../public/portal-data.js';

const validators = { articles: validateStoredArticles, users: value => normalizeAccounts({ version: 2, users: value }).users, requests: validateRequests, feedback: validateStoredFeedback, logs: validateLogs, siteContent: validateSiteContent, translationSettings: value => value === null ? null : validateTranslationSettings(value) };
const arrayKeys = new Set(['articles', 'users', 'requests', 'feedback', 'logs']);
export async function createD1Store(db, now = Date.now) {
  // One SELECT returns a consistent snapshot including the revision, even with read replication.
  const result = await db.prepare("SELECT 'revision' AS namespace, '1' AS id, 0 AS position, json_object('version', version) AS payload FROM portal_revision WHERE id = 1 UNION ALL SELECT namespace, id, position, payload FROM portal_records ORDER BY namespace, position").all();
  const revision = result.results.find(row => row.namespace === 'revision');
  if (!revision) throw new HttpError(503, 'D1 尚未初始化，请先运行数据库迁移。');
  const version = JSON.parse(revision.payload).version;
  const oldRows = new Map(result.results.filter(row => row.namespace !== 'revision').map(row => [row.namespace + ':' + row.id, row]));
  const state = { articles: [], users: [], requests: [], feedback: [], logs: [], siteContent: defaultSiteContent, translationSettings: null, sessions: [], failures: [], feedbackLimits: [], jobs: [] };
  const grouped = new Map();
  for (const row of oldRows.values()) { const values = grouped.get(row.namespace) || []; values.push(JSON.parse(row.payload)); grouped.set(row.namespace, values); }
  for (const key of Object.keys(state)) if (grouped.has(key)) state[key] = arrayKeys.has(key) || Array.isArray(state[key]) ? grouped.get(key) : grouped.get(key)[0];
  state.initialized = grouped.has('initialized');
  if (!grouped.has('initialized')) {
    const stamp = new Date(now()).toISOString();
    state.articles = examples.map(article => ({ ...article, status: 'published', source: '晏阳联合政府', isSample: true, createdAt: stamp, updatedAt: stamp }));
  }
  for (const [key, validate] of Object.entries(validators)) state[key] = validate(state[key]);
  state.siteContent = migratePortalDefaults(state.siteContent);
  let tail = Promise.resolve();
  function enqueue(work) { const pending = tail.then(work); tail = pending.catch(() => {}); return pending; }
  function commit(patch, event) {
    const next = {};
    for (const [key, value] of Object.entries(patch)) next[key] = validators[key](value);
    next.logs = appendAudit(state.logs, typeof event === 'function' ? event() : event, now());
    Object.assign(state, next);
  }
  const update = key => (transform, guard = () => {}, event) => enqueue(async () => { guard(); const value = await transform(structuredClone(state[key]), structuredClone(state.articles)); guard(); commit({ [key]: value }, event); return structuredClone(state[key]); });
  const store = {
    state,
    whenIdle: () => tail,
    getArticles: () => structuredClone(state.articles), getUsers: () => structuredClone(state.users),
    getUser: id => structuredClone(state.users.find(user => user.id === id)),
    findUser: name => typeof name === 'string' ? structuredClone(state.users.find(user => user.username.toLowerCase() === name.toLowerCase())) : undefined,
    getSiteContent: () => structuredClone(state.siteContent), getRequests: () => structuredClone(state.requests), getFeedback: () => structuredClone(state.feedback), getLogs: () => structuredClone(state.logs), getTranslationSettings: () => structuredClone(state.translationSettings),
    updateArticles: update('articles'), updateUsers: update('users'), updateSiteContent: update('siteContent'), updateRequests: update('requests'), updateFeedback: update('feedback'), updateTranslationSettings: update('translationSettings'),
    appendLog: (event, guard = () => {}, completed = () => {}) => enqueue(() => { guard(); commit({}, event); completed(); }),
    hasDueArticles: at => state.articles.some(article => article.status === 'scheduled' && Date.parse(article.scheduledAt) <= at),
    publishScheduled: at => enqueue(() => { const due = state.articles.filter(article => article.status === 'scheduled' && Date.parse(article.scheduledAt) <= at); if (!due.length) return []; const ids = new Set(due.map(article => article.id)); commit({ articles: state.articles.map(article => ids.has(article.id) ? { ...article, status: 'published', updatedAt: new Date(at).toISOString() } : article) }, due.map(article => ({ action: 'article.auto_publish', target: { type: 'article', id: article.id, title: article.title }, message: '按计划自动发布。' }))); return structuredClone(due); }),
    updateWorkflow: (transform, guard = () => {}, event) => enqueue(async () => { guard(); const value = await transform({ articles: structuredClone(state.articles), requests: structuredClone(state.requests) }); guard(); commit(value, event); return structuredClone(value); }),
    restoreContent: (articles, siteContent, guard = () => {}, event) => enqueue(() => { guard(); commit({ articles, siteContent }, event); return { articles: structuredClone(state.articles), siteContent: structuredClone(state.siteContent) }; }),
    async flush() {
      await tail;
      const nextRows = new Map();
      for (const [namespace, value] of Object.entries({ ...state, initialized: true })) {
        const values = Array.isArray(value) ? value : [value];
        let lastPosition = Math.max(-1, ...[...oldRows.values()].filter(row => row.namespace === namespace).map(row => row.position));
        values.forEach((item, position) => {
          const id = arrayKeys.has(namespace) ? item.id : ['sessions', 'failures', 'feedbackLimits', 'jobs'].includes(namespace) ? item[0] : String(position);
          const old = oldRows.get(namespace + ':' + id);
          position = old ? old.position : ++lastPosition;
          const payload = JSON.stringify(item);
          if (Buffer.byteLength(payload) > 1500000) throw new HttpError(413, '单条数据超过 D1 存储上限（1.5 MB），请缩小文章或译文。');
          nextRows.set(namespace + ':' + id, { namespace, id: String(id), position, payload });
        });
      }
      const token = randomUUID();
      const statements = [];
      for (const [key, row] of oldRows) if (!nextRows.has(key)) statements.push(db.prepare('DELETE FROM portal_records WHERE namespace = ? AND id = ? AND (SELECT token FROM portal_revision WHERE id = 1) = ?').bind(row.namespace, row.id, token));
      for (const [key, row] of nextRows) { const old = oldRows.get(key); if (old?.payload === row.payload && old?.position === row.position) continue; statements.push(db.prepare('INSERT INTO portal_records(namespace, id, position, payload) SELECT ?, ?, ?, ? WHERE (SELECT token FROM portal_revision WHERE id = 1) = ? ON CONFLICT(namespace, id) DO UPDATE SET position = excluded.position, payload = excluded.payload').bind(row.namespace, row.id, row.position, row.payload, token)); }
      if (!statements.length) return;
      if (statements.length > 900) throw new HttpError(413, '此次变更超过 900 条记录，请分批导入。');
      const results = await db.batch([db.prepare('UPDATE portal_revision SET version = version + 1, token = ? WHERE id = 1 AND version = ? RETURNING version').bind(token, version), ...statements]);
      if (!results[0].results.length) throw new HttpError(409, '数据已被另一项操作更新，请刷新后重试；本次操作未保存。');
    }
  };
  return store;
}
