import { HttpError } from './articles.mjs';
import { createDeepLTranslator, createTranslationEngine } from './online-translator.mjs';
import { createLlmTranslator } from './llm-translator.mjs';
import { resolveTranslationSettings } from './translation-settings.mjs';

export function createConfiguredTranslator({ store, offline, fetchImpl = globalThis.fetch, environment = process.env }) {
  const active = new Set();
  let closed = false, testing = false;
  const settings = () => resolveTranslationSettings(store.getTranslationSettings(), environment);
  const online = config => config.provider === 'llm' ? createLlmTranslator({ ...config, fetchImpl }) : config.provider === 'deepl' ? createDeepLTranslator({ ...config, fetchImpl }) : { available: async () => false, close() {} };
  function makeEngine(config) {
    return createTranslationEngine({ online: online(config), offline: config.provider === 'offline' || config.fallback ? offline : undefined });
  }
  return {
    async status() {
      const config = settings();
      const engine = makeEngine(config);
      const state = await engine.status();
      return { ...state, onlineProvider: config.provider, providerLabel: config.provider === 'llm' ? 'AI 大模型' : config.provider === 'deepl' ? 'DeepL' : '离线模型', model: config.provider === 'llm' ? config.model : '', fallback: config.fallback };
    },
    async available() { return !closed && (await this.status()).available; },
    async translate(article, onTranslation) {
      if (closed) throw new Error('translation closed');
      // Each article uses one immutable configuration; saving affects the next task.
      const config = settings(), adapter = online(config);
      active.add(adapter);
      try { return await createTranslationEngine({ online: adapter, offline: config.provider === 'offline' || config.fallback ? offline : undefined }).translate(article, onTranslation); }
      finally { active.delete(adapter); adapter.close(); }
    },
    async test() {
      if (testing) throw new HttpError(409, '连接测试正在进行，请稍候。');
      const config = settings();
      if (config.provider === 'offline') throw new HttpError(400, '仅离线模式无需联网测试。');
      const adapter = online(config);
      if (closed || !await adapter.available()) throw new HttpError(400, '请先保存接口地址、模型和密钥，再测试连接。');
      testing = true; active.add(adapter);
      try {
        let content;
        await adapter.translateLanguage({ title: '连接测试', summary: '', source: '晏阳联合政府', body: ['欢迎访问晏阳联合政府网站。'] }, 'en', value => { content = value; });
        if (!content?.title || !content.body?.[0]) throw new Error('invalid test translation');
        return { ok: true, message: '连接成功，已完成中文至英文的测试翻译。', preview: content.body[0] };
      } catch (error) {
        const messages = { translation_timeout: '连接测试超时，请检查服务地址或稍后重试。', service_auth: '服务拒绝了密钥，请检查密钥、账号权限及余额。', service_limit: '服务限流或额度不足，请检查服务商控制台。', invalid_translation: '服务返回的译文格式不完整，请检查模型是否支持 JSON 输出。' };
        throw new HttpError(502, messages[error.translationCode] || '连接测试失败，请检查接口地址、模型、密钥及服务商额度。');
      } finally { testing = false; active.delete(adapter); adapter.close(); }
    },
    close() { closed = true; active.forEach(adapter => adapter.close()); offline?.close(); },
  };
}
