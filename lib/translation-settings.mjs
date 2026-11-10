import { HttpError } from './articles.mjs';

const defaults = { provider: 'deepl', endpoint: 'https://api-free.deepl.com/v2/translate', model: '', apiKey: '', fallback: true };
export function validateTranslationSettings(value) {
  const invalid = message => { throw new HttpError(400, message); };
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !Object.hasOwn(defaults, key))) invalid('翻译设置格式不正确。');
  const { provider, model, apiKey, fallback } = value;
  if (!['llm', 'deepl', 'offline'].includes(provider) || typeof fallback !== 'boolean') invalid('请选择有效的翻译方式和回退选项。');
  if (typeof model !== 'string' || model.length > 150 || /[\x00-\x1f\x7f]/.test(model) || provider === 'llm' && !model.trim()) invalid('请填写有效的模型名称（最多 150 个字符）。');
  if (typeof apiKey !== 'string' || apiKey.length > 2048 || /[\x00-\x20\x7f-\uffff]/.test(apiKey)) invalid('密钥格式不正确，请重新粘贴。');
  let endpoint;
  try { endpoint = new URL(value.endpoint); } catch { invalid('请填写完整的 HTTPS 接口地址。'); }
  if (typeof value.endpoint !== 'string' || value.endpoint.length > 500 || endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) invalid('接口须使用 HTTPS，且不能包含账号、密码、查询参数或片段。');
  if (provider === 'llm' && !endpoint.pathname.endsWith('/chat/completions')) invalid('AI 接口地址须以 /chat/completions 结尾。');
  return { provider, endpoint: endpoint.toString(), model: model.trim(), apiKey, fallback };
}
export function resolveTranslationSettings(stored, environment = process.env) {
  if (stored) return validateTranslationSettings(stored);
  return validateTranslationSettings({ ...defaults, apiKey: (environment.DEEPL_API_KEY || '').trim(), endpoint: environment.DEEPL_API_URL || defaults.endpoint });
}
export function updateTranslationSettings(input, current) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => ![...Object.keys(defaults), 'clearApiKey'].includes(key)) || input.clearApiKey !== undefined && typeof input.clearApiKey !== 'boolean') throw new HttpError(400, '翻译设置格式不正确。');
  if (input.clearApiKey && input.apiKey) throw new HttpError(400, '不能同时填写并清除密钥。');
  const { clearApiKey, ...fields } = input;
  const candidate = validateTranslationSettings({ ...fields, apiKey: fields.apiKey ?? '' });
  if (candidate.provider === 'offline' || input.clearApiKey) candidate.apiKey = '';
  else if (!candidate.apiKey) {
    if (current.apiKey && (candidate.provider !== current.provider || new URL(candidate.endpoint).origin !== new URL(current.endpoint).origin)) throw new HttpError(400, '切换服务或接口域名后，请重新填写对应服务的密钥，或勾选清除密钥。');
    candidate.apiKey = current.apiKey;
  }
  return candidate;
}
export function publicTranslationSettings(value, credentialSource = 'server') {
  return { provider: value.provider, endpoint: value.endpoint, model: value.model, fallback: value.fallback, hasApiKey: !!value.apiKey, maskedKey: value.apiKey ? '••••••••' : '', credentialSource: value.apiKey ? credentialSource : 'none' };
}
