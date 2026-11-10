const modelIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,149}$/;
const unsupportedMessage = '此服务未提供标准模型列表，请手动填写模型名称。';

const failure = (code, message = '模型识别失败，请检查接口地址、密钥和服务商能力。') => Object.assign(new Error(message), { translationCode: code });

function modelsEndpoint(endpoint) {
  const url = new URL(endpoint);
  url.search = '';
  url.hash = '';
  url.pathname = url.pathname.replace(/\/chat\/completions\/?$/, '/models');
  return url.toString();
}

function chooseModel(models, currentModel = '') {
  if (currentModel && models.includes(currentModel)) return currentModel;
  const score = model => {
    const id = model.toLowerCase();
    if (/embedding|rerank|moderation|whisper|tts|image|vision|audio/.test(id)) return -100;
    return (/(chat|instruct|translate)/.test(id) ? 20 : 0)
      + (/(deepseek|qwen|gpt|claude|glm|llama|mistral)/.test(id) ? 5 : 0);
  };
  return [...models].sort((left, right) => score(right) - score(left) || models.indexOf(left) - models.indexOf(right))[0] || '';
}

export async function discoverTranslationModels({ provider = 'llm', endpoint, apiKey = '', model = '', fetchImpl = globalThis.fetch, timeoutMs = 15_000 } = {}) {
  if (provider !== 'llm') return { supported: false, models: [], selectedModel: '', message: unsupportedMessage };
  if (typeof apiKey !== 'string' || !apiKey.trim()) throw failure('model_discovery_auth', '请先保存服务密钥，再识别模型。');
  let url;
  try { url = modelsEndpoint(endpoint); } catch { throw failure('model_discovery_failed'); }
  if (!url.endsWith('/models')) throw failure('model_discovery_failed');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs); timer.unref?.();
  let response;
  try {
    response = await fetchImpl(url, { method: 'GET', redirect: 'error', signal: controller.signal, headers: { Authorization: `Bearer ${apiKey.trim()}`, Accept: 'application/json' } });
  } catch (error) {
    throw failure(controller.signal.aborted ? 'model_discovery_timeout' : 'model_discovery_failed');
  } finally { clearTimeout(timer); }
  if (response.status === 404 || response.status === 405) return { supported: false, models: [], selectedModel: '', message: unsupportedMessage };
  if (response.status === 401 || response.status === 403) throw failure('model_discovery_auth', '服务拒绝了密钥，请检查密钥和账号权限。');
  if (!response.ok) throw failure('model_discovery_failed');
  let payload;
  try { payload = await response.json(); } catch { throw failure('invalid_model_list', '服务返回的模型列表格式不正确。'); }
  const values = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.models) ? payload.models : null;
  if (!values) throw failure('invalid_model_list', '服务返回的模型列表格式不正确。');
  const models = [...new Set(values.map(value => typeof value === 'string' ? value : value?.id).filter(value => typeof value === 'string' && modelIdPattern.test(value)))].slice(0, 100);
  if (!models.length) throw failure('invalid_model_list', '服务返回的模型列表为空或格式不正确。');
  return { supported: true, models, selectedModel: chooseModel(models, model), message: `已识别 ${models.length} 个可用模型。` };
}

export { modelsEndpoint, chooseModel };
