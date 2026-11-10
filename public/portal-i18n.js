export const languages = Object.freeze([
  { code: 'zh-CN', name: '简体中文' }, { code: 'zh-TW', name: '繁體中文' }, { code: 'en', name: 'English' },
  { code: 'ko', name: '한국어' }, { code: 'ja', name: '日本語' },
  { code: 'de', name: 'Deutsch' }, { code: 'fr', name: 'Français' },
  { code: 'ru', name: 'Русский' }, { code: 'es', name: 'Español' },
  { code: 'ar', name: 'العربية', direction: 'rtl' },
  { code: 'pt', name: 'Português' }, { code: 'it', name: 'Italiano' },
]);
export const normalizeLanguage = code => languages.some(item => item.code === code) ? code : 'zh-CN';

export function localizeArticle(article, code) {
  const language = normalizeLanguage(code);
  const translated = language !== 'zh-CN' && article.translation?.locales?.[language];
  const complete = translated && typeof translated.title === 'string' && translated.title.trim()
    && typeof translated.summary === 'string' && typeof translated.source === 'string'
    && Array.isArray(translated.body) && translated.body.length > 0
    && translated.body.every(paragraph => typeof paragraph === 'string' && paragraph.trim());
  return complete
    ? { ...article, title: translated.title, summary: translated.summary, source: translated.source, body: [...translated.body], isTranslated: true, contentLanguage: language }
    : { ...article, isTranslated: false, contentLanguage: 'zh-CN' };
}
const storageKey = 'yanyang-portal-language';
const chineseUi = {
  language: '语言', switchError: '无法切换语言，请重试。', originalContent: '此内容显示原文。',
  originalLanguage: '原文', mainNavigation: '主导航', newsTabs: '新闻栏目', serviceTabs: '办事对象',
  slideSelector: '选择城市图片', previousSlide: '上一张图片', nextSlide: '下一张图片',
  closeDialog: '关闭详情', searchCategories: '搜索栏目', commonEntries: '常用政务入口',
  search: '站内搜索', languageChanged: '语言已切换。', chineseOriginal: '中文原文',
};

export function createI18n({ storage, load = async code => {
  const response = await fetch(`./locales/${code}.json`, { cache: 'no-cache' });
  if (!response.ok) throw new Error('Language unavailable');
  return response.json();
} } = {}) {
  let preferredLanguage = 'zh-CN';
  try { preferredLanguage = normalizeLanguage(storage?.getItem(storageKey)); } catch { /* Storage is optional. */ }
  let language = 'zh-CN', dictionary = null, generation = 0;
  const dictionaries = new Map();
  return {
    preferredLanguage,
    get language() { return language; },
    get direction() { return language === 'ar' ? 'rtl' : 'ltr'; },
    localizeArticle: article => localizeArticle(article, language),
    ui: key => dictionary?.ui?.[key] ?? chineseUi[key] ?? '',
    text(key, source, defaultValue) {
      if (language === 'zh-CN' || source !== defaultValue) return source;
      return dictionary && Object.hasOwn(dictionary.values, key) && typeof dictionary.values[key] === 'string' ? dictionary.values[key] : source;
    },
    async setLanguage(code) {
      const target = normalizeLanguage(code), request = ++generation;
      let next = null;
      if (target !== 'zh-CN') {
        next = dictionaries.get(target);
        if (!next) {
          next = await load(target);
          if (next?.version !== 1 || next.locale !== target || !next.values || typeof next.values !== 'object' || Array.isArray(next.values) || !next.ui || typeof next.ui !== 'object' || !Object.values(next.values).every(value => typeof value === 'string') || !Object.values(next.ui).every(value => typeof value === 'string')) throw new Error('Invalid language dictionary');
          dictionaries.set(target, next);
        }
      }
      if (request !== generation) return false;
      language = target; dictionary = next;
      try { storage?.setItem(storageKey, target); } catch { /* Do not block switching. */ }
      return true;
    },
  };
}
