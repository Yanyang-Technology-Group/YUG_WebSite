import path from 'node:path';
import { mkdir, readFile, rename, open, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { validateStoredArticles, serializeArticleData, HttpError } from './articles.mjs';
import { validateSiteContent, serializeSiteContent, renameSampleArticles } from './site-content.mjs';
import { defaultSiteContent, feedbackDefaultMigrations, photoDefaultMigrations, migratePortalDefaults } from '../public/site-content-schema.js';
import { normalizeAccounts } from './accounts.mjs';
import { validateRequests, serializeRequests } from './requests.mjs';
import { appendAudit, validateLogs } from './audit.mjs';
import { validateStoredFeedback, serializeFeedback } from './feedback.mjs';
import { validateTranslationSettings } from './translation-settings.mjs';
async function readJson(filename, label) {
  try { return JSON.parse(await readFile(filename, 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw new Error(`${label}无法读取，请从备份恢复：${error.message}`);
  }
}
async function atomicJson(filename, value, encoded = JSON.stringify(value, null, 2) + '\n') {
  const temporary = `${filename}.${randomUUID()}.tmp`;
  let file;
  try {
    file = await open(temporary, 'wx', 0o600);
    await file.writeFile(encoded, 'utf8');
    await file.sync();
    await file.close();
    file = undefined;
    await rename(temporary, filename);
  } catch (error) {
    if (file) await file.close().catch(() => {});
    await unlink(temporary).catch(() => {});
    throw new HttpError(500, '无法保存数据，请检查磁盘空间和目录写入权限。');
  }
}
export async function createStore({ rootDir, dataDir, now = Date.now }) {
  await mkdir(dataDir, { recursive: true });
  const articlesFile = path.join(dataDir, 'articles.json');
  const adminFile = path.join(dataDir, 'admin.json');
  const siteContentFile = path.join(dataDir, 'site-content.json');
  const requestsFile = path.join(dataDir, 'requests.json');
  const logsFile = path.join(dataDir, 'logs.json');
  const feedbackFile = path.join(dataDir, 'feedback.json');
  const translationSettingsFile = path.join(dataDir, 'translation-settings.json');
  const transactionFile = path.join(dataDir, 'content-transaction.json');
  let pendingTransaction = await readJson(transactionFile, '联合恢复记录');
  async function materializeTransaction() {
    if (!pendingTransaction) return;
    if (Object.hasOwn(pendingTransaction, 'articles')) await atomicJson(articlesFile, { version: 1, articles: pendingTransaction.articles }, serializeArticleData(pendingTransaction.articles));
    if (Object.hasOwn(pendingTransaction, 'siteContent')) await atomicJson(siteContentFile, pendingTransaction.siteContent, serializeSiteContent(pendingTransaction.siteContent));
    if (Object.hasOwn(pendingTransaction, 'users')) await atomicJson(adminFile, { version: 2, users: pendingTransaction.users });
    if (Object.hasOwn(pendingTransaction, 'requests')) await atomicJson(requestsFile, { version: 1, requests: pendingTransaction.requests }, serializeRequests(pendingTransaction.requests));
    if (Object.hasOwn(pendingTransaction, 'feedback')) await atomicJson(feedbackFile, { version: 1, feedback: pendingTransaction.feedback }, serializeFeedback(pendingTransaction.feedback));
    if (Object.hasOwn(pendingTransaction, 'logs')) await atomicJson(logsFile, { version: 1, logs: pendingTransaction.logs });
    if (Object.hasOwn(pendingTransaction, 'translationSettings')) await atomicJson(translationSettingsFile, pendingTransaction.translationSettings);
    await unlink(transactionFile);
    pendingTransaction = undefined;
  }
  if (pendingTransaction !== undefined) {
    try {
      if (!pendingTransaction || ![1, 2, 3].includes(pendingTransaction.version)) throw new Error('不支持的恢复记录版本');
      if (pendingTransaction.version === 3) {
        const value = pendingTransaction;
        if (Object.keys(value).some(key => !['version', 'articles', 'siteContent', 'users', 'requests', 'feedback', 'logs', 'translationSettings'].includes(key))) throw new Error('恢复记录字段无效');
        pendingTransaction = { version: 3, logs: validateLogs(value.logs) };
        if (Object.hasOwn(value, 'articles')) pendingTransaction.articles = validateStoredArticles(value.articles);
        if (Object.hasOwn(value, 'siteContent')) pendingTransaction.siteContent = validateSiteContent(value.siteContent);
        if (Object.hasOwn(value, 'users')) { pendingTransaction.users = normalizeAccounts({ version: 2, users: value.users }).users; if (!pendingTransaction.users.length) throw new Error('账号列表不能为空'); }
        if (Object.hasOwn(value, 'requests')) pendingTransaction.requests = validateRequests(value.requests);
        if (Object.hasOwn(value, 'feedback')) pendingTransaction.feedback = validateStoredFeedback(value.feedback);
        if (Object.hasOwn(value, 'translationSettings')) pendingTransaction.translationSettings = validateTranslationSettings(value.translationSettings);
      } else pendingTransaction = { version: pendingTransaction.version, articles: validateStoredArticles(pendingTransaction.articles), siteContent: validateSiteContent(pendingTransaction.siteContent), ...(pendingTransaction.version === 2 ? { requests: validateRequests(pendingTransaction.requests) } : {}) };
      await materializeTransaction();
    } catch (error) { throw new Error(`联合恢复记录无法完成，请检查数据目录：${error.message}`); }
  }
  const document = await readJson(articlesFile, '文章数据');
  let articles;
  if (document === undefined) {
    const seeds = (await import(pathToFileURL(path.join(rootDir, 'public/portal-data.js')).href)).articles;
    const now = new Date().toISOString();
    articles = validateStoredArticles(renameSampleArticles(seeds.map(article => ({ ...article, status: 'published', source: '晏阳联合政府', isSample: true, createdAt: now, updatedAt: now }))));
    await atomicJson(articlesFile, { version: 1, articles });
  } else {
    try {
      if (document.version !== 1) throw new Error('不支持的数据版本');
      articles = validateStoredArticles(document.articles);
    } catch (error) { throw new Error(`文章数据格式不正确，请从备份恢复：${error.message}`); }
  }
  const renamed = renameSampleArticles(articles);
  if (JSON.stringify(renamed) !== JSON.stringify(articles)) {
    articles = validateStoredArticles(renamed);
    await atomicJson(articlesFile, { version: 1, articles }, serializeArticleData(articles));
  }
  const storedSiteContent = await readJson(siteContentFile, '网站内容');
  let siteContent;
  try { siteContent = validateSiteContent(storedSiteContent === undefined ? defaultSiteContent : storedSiteContent); }
  catch (error) { throw new Error(`网站内容格式不正确，请从备份恢复：${error.message}`); }
  const upgradedContent = migratePortalDefaults(siteContent);
  let migratedDefaultText = JSON.stringify(upgradedContent) !== JSON.stringify(siteContent);
  siteContent = upgradedContent;
  for (const { key, previousValue, value } of [...feedbackDefaultMigrations, ...photoDefaultMigrations]) {
    if (siteContent.values[key] === previousValue) { siteContent.values[key] = value; migratedDefaultText = true; }
  }
  if (storedSiteContent === undefined || migratedDefaultText) await atomicJson(siteContentFile, siteContent, serializeSiteContent(siteContent));
  const originalAccounts = await readJson(adminFile, '管理员数据');
  let accounts;
  try {
    accounts = normalizeAccounts(originalAccounts);
    if (originalAccounts !== undefined && accounts.users.length === 0) throw new Error('已保存的账号列表不能为空');
  }
  catch (error) { throw new Error(`管理员数据格式不正确，请从备份恢复：${error.message}`); }
  if (originalAccounts !== undefined && JSON.stringify(originalAccounts) !== JSON.stringify(accounts)) await atomicJson(adminFile, accounts);
  const originalRequests = await readJson(requestsFile, '审批记录');
  let requests;
  try {
    if (originalRequests !== undefined && originalRequests?.version !== 1) throw new Error('不支持的记录版本');
    requests = validateRequests(originalRequests === undefined ? [] : originalRequests.requests);
  } catch (error) { throw new Error(`审批记录格式不正确，请从备份恢复：${error.message}`); }
  const originalLogs = await readJson(logsFile, '操作日志');
  let logs;
  try { if (originalLogs !== undefined && originalLogs?.version !== 1) throw new Error('不支持的日志版本'); logs = validateLogs(originalLogs === undefined ? [] : originalLogs.logs); }
  catch (error) { throw new Error(`操作日志格式不正确，请从备份恢复：${error.message}`); }
  const originalFeedback = await readJson(feedbackFile, '意见反馈');
  let feedback;
  try { if (originalFeedback !== undefined && originalFeedback?.version !== 1) throw new Error('不支持的反馈版本'); feedback = validateStoredFeedback(originalFeedback === undefined ? [] : originalFeedback.feedback); }
  catch (error) { throw new Error(`意见反馈格式不正确，请从备份恢复：${error.message}`); }
  const originalTranslationSettings = await readJson(translationSettingsFile, '翻译设置');
  const translationSettingsValue = originalTranslationSettings === undefined ? null : validateTranslationSettings(originalTranslationSettings);
  let translationSettings = translationSettingsValue;
  let tail = Promise.resolve();
  function enqueue(work) {
    const result = tail.then(async () => { await materializeTransaction(); return work(); });
    tail = result.catch(() => {});
    return result;
  }
  async function commit(patch, events) {
    const nextLogs = appendAudit(logs, typeof events === 'function' ? events() : events, now());
    const transaction = { version: 3, ...patch, logs: nextLogs };
    await atomicJson(transactionFile, transaction);
    pendingTransaction = transaction;
    if (patch.articles) articles = patch.articles;
    if (patch.siteContent) siteContent = patch.siteContent;
    if (patch.users) accounts = { version: 2, users: patch.users };
    if (patch.requests) requests = patch.requests;
    if (patch.feedback) feedback = patch.feedback;
    if (patch.translationSettings) translationSettings = patch.translationSettings;
    logs = nextLogs;
    try { await materializeTransaction(); }
    catch (error) { console.error('操作及日志已提交，将在下一次保存或启动时完成写入：', error.message); }
  }
  return {
    whenIdle: () => tail,
    getArticles: () => structuredClone(articles),
    getSiteContent: () => structuredClone(siteContent),
    getUsers: () => structuredClone(accounts.users),
    getUser: id => structuredClone(accounts.users.find(user => user.id === id)),
    findUser: username => typeof username === 'string' ? structuredClone(accounts.users.find(user => user.username.toLowerCase() === username.toLowerCase())) : undefined,
    getRequests: () => structuredClone(requests),
    getLogs: () => structuredClone(logs),
    getFeedback: () => structuredClone(feedback),
    getTranslationSettings: () => structuredClone(translationSettings),
    updateTranslationSettings: (transform, guard = () => {}, audit) => enqueue(async () => {
      guard();
      const next = validateTranslationSettings(await transform(structuredClone(translationSettings)));
      guard();
      await commit({ translationSettings: next }, audit);
    }),
    appendLog: (events, guard = () => {}, completed = () => {}) => enqueue(async () => { guard(); await commit({}, events); completed(); }),
    hasDueArticles: at => articles.some(article => article.status === 'scheduled' && Date.parse(article.scheduledAt) <= at),
    publishScheduled: at => enqueue(async () => {
      const due = articles.filter(article => article.status === 'scheduled' && Date.parse(article.scheduledAt) <= at);
      if (!due.length) return [];
      const dueIds = new Set(due.map(article => article.id));
      const next = validateStoredArticles(articles.map(article => dueIds.has(article.id) ? { ...article, status: 'published', updatedAt: new Date(at).toISOString() } : article));
      await commit({ articles: next }, due.map(article => ({ action: 'article.auto_publish', target: { type: 'article', id: article.id, title: article.title }, message: `按计划自动发布（预定时间 ${article.scheduledAt}）。` })));
      return structuredClone(due);
    }),
    updateArticles: (transform, guard = () => {}, audit) => enqueue(async () => {
      guard();
      const next = validateStoredArticles(await transform(structuredClone(articles)));
      const encoded = serializeArticleData(next);
      guard();
      if (audit) { await commit({ articles: next }, audit); return structuredClone(next); }
      await atomicJson(articlesFile, { version: 1, articles: next }, encoded);
      articles = next;
      return structuredClone(next);
    }),
    updateSiteContent: (transform, guard = () => {}, audit) => enqueue(async () => {
      guard();
      const next = validateSiteContent(await transform(structuredClone(siteContent)));
      guard();
      if (audit) { await commit({ siteContent: next }, audit); return structuredClone(next); }
      await atomicJson(siteContentFile, next, serializeSiteContent(next));
      siteContent = next;
      return structuredClone(next);
    }),
    restoreContent: (restoredArticles, restoredSiteContent, guard = () => {}, audit) => enqueue(async () => {
      guard();
      const nextArticles = validateStoredArticles(restoredArticles);
      const nextSiteContent = validateSiteContent(restoredSiteContent);
      guard();
      if (audit) { await commit({ articles: nextArticles, siteContent: nextSiteContent }, audit); return { articles: structuredClone(nextArticles), siteContent: structuredClone(nextSiteContent) }; }
      const transaction = { version: 1, articles: nextArticles, siteContent: nextSiteContent };
      // The journal rename is the joint commit point. Both in-memory snapshots change
      // together; interrupted projections are replayed before any later write.
      await atomicJson(transactionFile, transaction);
      pendingTransaction = transaction;
      articles = nextArticles;
      siteContent = nextSiteContent;
      try { await materializeTransaction(); }
      catch (error) { console.error('联合恢复已提交，将在下一次保存或启动时完成数据文件写入：', error.message); }
      return { articles: structuredClone(nextArticles), siteContent: structuredClone(nextSiteContent) };
    }),
    updateUsers: (transform, guard = () => {}, audit) => enqueue(async () => {
      guard();
      const next = normalizeAccounts({ version: 2, users: await transform(structuredClone(accounts.users)) });
      guard();
      if (audit) { await commit({ users: next.users }, audit); return structuredClone(next.users); }
      await atomicJson(adminFile, next);
      accounts = next;
      return structuredClone(next.users);
    }),
    updateRequests: (transform, guard = () => {}, audit) => enqueue(async () => {
      guard();
      const next = validateRequests(await transform(structuredClone(requests), structuredClone(articles)));
      guard();
      if (audit) { await commit({ requests: next }, audit); return structuredClone(next); }
      await atomicJson(requestsFile, { version: 1, requests: next }, serializeRequests(next));
      requests = next;
      return structuredClone(next);
    }),
    updateWorkflow: (transform, guard = () => {}, audit) => enqueue(async () => {
      guard();
      const next = await transform({ articles: structuredClone(articles), requests: structuredClone(requests) });
      const nextArticles = validateStoredArticles(next.articles);
      const nextRequests = validateRequests(next.requests);
      guard();
      if (audit) { await commit({ articles: nextArticles, requests: nextRequests }, audit); return { articles: structuredClone(articles), requests: structuredClone(requests) }; }
      const transaction = { version: 2, articles: nextArticles, siteContent, requests: nextRequests };
      await atomicJson(transactionFile, transaction);
      pendingTransaction = transaction;
      articles = nextArticles; requests = nextRequests;
      try { await materializeTransaction(); }
      catch (error) { console.error('审批已提交，将在下一次保存或启动时完成数据文件写入：', error.message); }
      return { articles: structuredClone(articles), requests: structuredClone(requests) };
    }),
    updateFeedback: (transform, guard = () => {}, audit) => enqueue(async () => {
      guard();
      const next = validateStoredFeedback(await transform(structuredClone(feedback)));
      guard();
      if (audit) await commit({ feedback: next }, audit);
      else { await atomicJson(feedbackFile, { version: 1, feedback: next }, serializeFeedback(next)); feedback = next; }
      return structuredClone(next);
    })
  };
}
