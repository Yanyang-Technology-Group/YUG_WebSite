import { services as serviceDefaults } from './portal-data.js';
import { searchContent } from './portal-utils.js';
import { defaultSiteContent, getContentText, infoSections, topicSections, serviceIds, responseIds } from './site-content-schema.js';
import { createI18n, languages } from './portal-i18n.js';

let siteContent = structuredClone(defaultSiteContent);
let languageStorage;
try { languageStorage = localStorage; } catch { /* Browser storage is optional. */ }
const i18n = createI18n({ storage: languageStorage });
const text = key => i18n.text(key, getContentText(siteContent, key), defaultSiteContent.values[key]);
const ui = key => i18n.ui(key);
const categoryName = category => Object.hasOwn(defaultSiteContent.values, `categories.${category}`) ? text(`categories.${category}`) : category;
const lines = value => value.split(/\r?\n/).map(item => item.trim()).filter(Boolean);
const paragraphs = value => value.split(/\r?\n[ \t]*\r?\n/).map(item => item.trim()).filter(Boolean);
const format = (key, count) => text(key).replaceAll('{count}', String(count));
let services = [];
let responses = [];

let originalArticles = [];
let articles = [];

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const icon = (name, className = 'icon') => `<svg class="${className}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const byCategory = category => articles.filter(article => article.category === category);
const dialog = $('#content-dialog');
let currentNewsCategory = '政务要闻';
let toastTimeout;
let dialogGeneration = 0;

function toast(message) {
  clearTimeout(toastTimeout);
  $('#toast').textContent = message;
  $('#toast').classList.add('visible');
  toastTimeout = setTimeout(() => $('#toast').classList.remove('visible'), 2800);
}

function openDialog(category, html) {
  dialogGeneration++;
  delete dialog.dataset.cityPhoto;
  for (const key of ['article', 'topic', 'searchQuery', 'searchCategory']) delete dialog.dataset[key];
  $('#dialog-category').textContent = category;
  $('#dialog-content').innerHTML = html;
  if (!dialog.open) dialog.showModal();
  dialog.scrollTop = 0;
  document.body.style.overflow = 'hidden';
  const title = $('#dialog-title');
  if (title) {
    title.tabIndex = -1;
    title.focus({ preventScroll: true });
  }
}

function closeDialog() { dialogGeneration++; dialog.close(); }
$('#close-dialog').addEventListener('click', closeDialog);
dialog.addEventListener('close', () => {
  if (!dialog.open) { dialogGeneration++; document.body.style.overflow = ''; }
});
dialog.addEventListener('click', event => {
  if (event.target !== dialog) return;
  const box = dialog.getBoundingClientRect();
  if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) closeDialog();
});

function articleLink(article, className = '') {
  return `<a class="${className}" href="#article/${article.id}" data-article="${article.id}" dir="auto">${escape(article.title)}</a>`;
}

function renderNews(category) {
  currentNewsCategory = category;
  const entries = byCategory(category);
  const first = entries[0];
  $('#news-list').innerHTML = first ? `<div class="news-lead">${articleLink(first)}<p>${escape(first.summary)}</p></div>` + entries.slice(1, 4).map(article => `<div class="news-item">${articleLink(article)}<time datetime="${article.date}">${article.date.slice(5)}</time></div>`).join('') : `<div class="empty-state">${escape(text('ui.emptyColumn'))}</div>`;
  // A related item keeps the news area useful without repeating a headline.
  const extra = category === '政务要闻' ? byCategory('部门动态')[0] : byCategory('民生资讯')[0];
  const last = entries[4] || extra;
  if (first && last) $('#news-list').insertAdjacentHTML('beforeend', `<div class="news-item">${articleLink(last)}<time datetime="${last.date}">${last.date.slice(5)}</time></div>`);
  $$('[data-news-tab]').forEach(button => {
    const selected = button.dataset.newsTab === category;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-selected', selected);
    button.tabIndex = selected ? 0 : -1;
    if (selected) $('#news-list').setAttribute('aria-labelledby', button.id);
  });
}

function renderCompactList(selector, entries, dates = false) {
  $(selector).innerHTML = entries.map(article => `<li><a href="#article/${article.id}" data-article="${article.id}"><span class="list-title">${escape(article.title)}</span>${dates ? `<time datetime="${article.date}">${article.date.slice(5)}</time>` : ''}</a></li>`).join('');
}

function openArticle(id) {
  const article = articles.find(item => item.id === id);
  if (!article) return;
  openDialog(categoryName(article.category), `<article lang="${article.contentLanguage}" dir="${article.contentLanguage === 'ar' ? 'rtl' : 'ltr'}">${i18n.language !== 'zh-CN' && !article.isTranslated ? `<p class="original-content-note">${escape(ui('originalContent'))}</p>` : ''}<h1 id="dialog-title" dir="auto">${escape(article.title)}</h1><div class="article-meta">${escape(text('ui.publishedAt'))}<bdi>${escape(article.date)}</bdi>　　${escape(text('ui.source'))}<bdi>${escape(article.source || text('ui.defaultSource'))}</bdi></div>${article.summary ? `<div class="article-summary" dir="auto">${escape(article.summary)}</div>` : ''}<div class="article-body">${article.body.map(paragraph => `<p dir="auto">${escape(paragraph)}</p>`).join('')}</div>${article.isSample ? `<p class="article-note">${escape(text('ui.articleNote'))}</p>` : ''}</article>`);
  dialog.dataset.article = id;
}

const categories = ['全部', '政务要闻', '通知公告', '政策文件', '政策解读', '部门动态', '民生资讯'];
function openSearch(query = '', category = '全部') {
  const normalizedQuery = String(query).trim();
  const results = searchContent(articles, normalizedQuery, category);
  const matchedServices = category === '全部' && normalizedQuery ? searchContent(services.map(service => ({ ...service, title: service.name, summary: service.description, body: service.materials })), normalizedQuery) : [];
  openDialog(category === '全部' ? text('ui.searchTitle') : categoryName(category), `<h1 id="dialog-title">${escape(normalizedQuery ? text('ui.searchTitle') : category === '全部' ? text('ui.articleCategory') : categoryName(category))}</h1><form class="dialog-search-form" id="dialog-search"><label for="dialog-query" class="sr-only">${escape(text('header.searchLabel'))}</label><input class="field-input" id="dialog-query" type="search" placeholder="${escape(text('ui.searchPlaceholder'))}" value="${escape(normalizedQuery)}" autocomplete="off"><button type="submit">${escape(text('ui.searchButton'))}</button></form><div class="result-filters" data-i18n-aria-label="searchCategories" aria-label="搜索栏目">${categories.map(item => `<button class="${item === category ? 'active' : ''}" data-result-category="${item}" data-query="${escape(normalizedQuery)}" aria-pressed="${item === category}">${escape(categoryName(item))}</button>`).join('')}</div><p class="result-count">${normalizedQuery ? `“${escape(normalizedQuery)}”` : escape(text('ui.searchColumn'))}${escape(format('ui.resultCount', results.length + matchedServices.length))}</p><div id="search-results">${matchedServices.map(service => `<button class="search-result" data-service="${service.id}"><strong>${escape(service.name + text('ui.serviceSuffix'))}</strong><p>${escape(service.description)}</p><small>${escape(text('serviceArea.title'))}</small></button>`).join('')}${results.map(article => `<button class="search-result" data-article="${escape(article.id)}"><strong>${escape(article.title)}</strong><p>${escape(article.summary)}</p><small>${escape(categoryName(article.category))}　${escape(article.date)}</small></button>`).join('')}${!results.length && !matchedServices.length ? `<div class="empty-state">${escape(text('ui.noSearchResults'))}<p>${escape(text('ui.noSearchAdvice'))}</p></div>` : ''}</div>`);
  $('#dialog-search').dataset.category = category;
  dialog.dataset.searchQuery = normalizedQuery;
  dialog.dataset.searchCategory = category;
  $$('[data-i18n-aria-label]').forEach(element => element.setAttribute('aria-label', ui(element.dataset.i18nAriaLabel)));
}

function serviceButton(service) {
  return `<button class="service-button" data-service="${service.id}">${icon(service.icon)}<span>${escape(service.name)}</span></button>`;
}

function renderServices(category = '热门服务') {
  const filtered = category === '法人办事' ? services.filter(item => ['business-startup', 'employment'].includes(item.id)) : category === '个人办事' ? services.filter(item => item.id !== 'business-startup') : services;
  $('#service-grid').innerHTML = filtered.map(serviceButton).join('');
  $$('[data-service-tab]').forEach(button => {
    const selected = button.dataset.serviceTab === category;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-selected', selected);
    button.tabIndex = selected ? 0 : -1;
    if (selected) $('#service-grid').setAttribute('aria-labelledby', button.id);
  });
}

function openService(id) {
  const service = services.find(item => item.id === id);
  if (!service) return;
  openDialog(text('ui.serviceCategory'), `<h1 id="dialog-title">${escape(service.name + text('ui.serviceSuffix'))}</h1><p class="service-intro">${escape(service.description)}</p><div class="service-time">${icon('clock')}${escape(text('ui.serviceTime'))}${escape(service.time)}</div><h2>${escape(text('ui.serviceMaterials'))}</h2><ul class="guide-list">${service.materials.map(item => `<li>${escape(item)}</li>`).join('')}</ul><h2>${escape(text('ui.serviceSteps'))}</h2><ol class="guide-list">${service.steps.map(item => `<li>${escape(item)}</li>`).join('')}</ol><div class="guide-footer">${escape(text('ui.serviceNotice'))}</div>`);
}

// Asset paths are fixed local files; the accompanying text remains editable in the CMS.
const cityPhotos = [
  { id: 'hall', width: 2000, height: 1067, titleKey: 'slides.0.kicker', altKey: 'slides.0.alt' },
  { id: 'residences', width: 1965, height: 1568, titleKey: 'gallery.residences.title', altKey: 'gallery.residences.alt' },
  { id: 'skyline', width: 2000, height: 1006, titleKey: 'slides.1.kicker', altKey: 'slides.1.alt' },
  { id: 'courtyard', width: 2000, height: 1302, titleKey: 'gallery.courtyard.title', altKey: 'gallery.courtyard.alt' },
  { id: 'station', width: 2000, height: 1063, titleKey: 'slides.2.kicker', altKey: 'slides.2.alt' },
];
const slides = ['hall', 'skyline', 'station'].map(id => cityPhotos.find(photo => photo.id === id));
const photoPath = (photo, preview = false) => `./assets/yanyang-${photo.id}${preview ? '-preview' : ''}.jpg`;

function renderCityPhotos() {
  $('#city-photo-grid').innerHTML = cityPhotos.map(photo => `<button class="city-photo-card" data-city-photo="${photo.id}"><span class="city-photo-image"><img src="${photoPath(photo, true)}" srcset="${photoPath(photo, true)} 960w, ${photoPath(photo)} ${photo.width}w" sizes="(max-width: 560px) 100vw, (max-width: 850px) 75vw, ${photo.id === 'hall' ? '850px' : '420px'}" alt="${escape(text(photo.altKey))}" width="${photo.width}" height="${photo.height}" loading="lazy" decoding="async"><span class="city-photo-view">${escape(text('gallery.view'))}</span></span><span class="city-photo-copy"><strong>${escape(text(photo.titleKey))}</strong><span>${escape(text(`gallery.${photo.id}.caption`))}</span></span></button>`).join('');
}

function openCityPhoto(id) {
  const index = cityPhotos.findIndex(photo => photo.id === id);
  if (index < 0) return;
  const photo = cityPhotos[index];
  const previous = cityPhotos[(index + cityPhotos.length - 1) % cityPhotos.length];
  const next = cityPhotos[(index + 1) % cityPhotos.length];
  openDialog(text('gallery.title'), `<article class="city-photo-detail"><h1 id="dialog-title">${escape(text(photo.titleKey))}</h1><figure><img src="${photoPath(photo)}" alt="${escape(text(photo.altKey))}" width="${photo.width}" height="${photo.height}"><figcaption class="city-photo-description">${escape(text(`gallery.${photo.id}.caption`))}</figcaption></figure><p class="city-photo-source">${escape(text('gallery.note'))}</p><div class="city-photo-pagination"><button data-city-photo="${previous.id}">${icon('chevron', 'icon rotate')}<span>${escape(text('gallery.previous'))}</span></button><span aria-live="polite">${index + 1} / ${cityPhotos.length}</span><button data-city-photo="${next.id}"><span>${escape(text('gallery.next'))}</span>${icon('chevron')}</button></div></article>`);
  dialog.dataset.cityPhoto = id;
}

let currentSlide = 0;
function showSlide(index) {
  currentSlide = (index + slides.length) % slides.length;
  const slide = slides[currentSlide];
  $('#feature-image').src = photoPath(slide, true);
  $('#feature-image').srcset = `${photoPath(slide, true)} 960w, ${photoPath(slide)} ${slide.width}w`;
  $('#feature-image').width = slide.width;
  $('#feature-image').height = slide.height;
  $('#feature-image').alt = text(`slides.${currentSlide}.alt`);
  $('#feature-story').setAttribute('aria-label', `${text('gallery.view')} ${text(`slides.${currentSlide}.title`)}`);
  $('#feature-kicker').textContent = text(`slides.${currentSlide}.kicker`);
  $('#feature-title').textContent = text(`slides.${currentSlide}.title`);
  $('#slide-current').textContent = String(currentSlide + 1).padStart(2, '0');
  $$('[data-slide]').forEach(button => {
    const selected = Number(button.dataset.slide) === currentSlide;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-pressed', selected);
  });
}

function openInfo(name) {
  const info = infoSections.find(item => item.id === name) || infoSections.find(item => item.id === '网站帮助');
  const body = paragraphs(text(info.bodyKey));
  let extra = '';
  if (['高效办成一件事', '政务服务'].includes(name)) extra = `<div class="service-grid dialog-services">${services.map(serviceButton).join('')}</div>`;
  if (name === '意见征集' || name === '互动交流') extra = `<button class="primary-button" id="dialog-open-message">${escape(text('ui.saveSuggestion'))}</button>`;
  if (name === '政府信息公开' || name === '信息公开目录') extra = `<button class="primary-button" data-category="政策文件">${escape(text('ui.queryPolicy'))}</button>`;
  if (name === '网站地图') extra = '<div class="result-filters">' + ['news', 'disclosure', 'services', 'interaction', 'city', 'topics'].map(id => `<a class="map-link" href="#${id}">${escape(text(`nav.${id}`))}</a>`).join('') + '</div>';
  openDialog(text('ui.infoCategory'), `<h1 id="dialog-title">${escape(text(info.labelKey))}</h1><div class="article-body">${body.map(item => `<p>${escape(item)}</p>`).join('')}</div>${extra}`);
}

function openTopic(name) {
  const topic = topicSections.find(item => item.id === name);
  if (!topic) return;
  openDialog(text('topicArea.title'), `<h1 id="dialog-title">${escape(text(topic.nameKey) + text('ui.topicSuffix'))}</h1><div class="article-summary">${escape(text(topic.descriptionKey))}</div>${topic.ids.map(id => articles.find(article => article.id === id)).filter(Boolean).map(article => `<button class="search-result" data-article="${escape(article.id)}"><strong>${escape(article.title)}</strong><p>${escape(article.summary)}</p><small>${escape(categoryName(article.category))}　${escape(article.date)}</small></button>`).join('')}`);
  dialog.dataset.topic = name;
}

function openResponse(id) {
  const response = responses.find(item => item.id === id);
  if (!response) return;
  openDialog(text('ui.responseCategory'), `<h1 id="dialog-title">${escape(response.question)}</h1><div class="article-meta">${escape(text('ui.responseDate'))}${escape(response.date)}　　${escape(text('ui.responseState'))}${escape(text('ui.responseStatus'))}</div><div class="article-body"><p>${escape(response.answer)}</p></div><p class="article-note">${escape(text('ui.responseNote'))}</p>`);
}

const messageStorageKey = 'yunchuan-portal-local-messages';
const messageTypes = { suggestion: 'typeSuggestion', consultation: 'typeConsultation', feedback: 'typeFeedback' };
function readMessages() {
  try {
    const saved = JSON.parse(localStorage.getItem(messageStorageKey) || '[]');
    return Array.isArray(saved) ? saved.filter(item => item && typeof item.title === 'string' && typeof item.content === 'string' && typeof item.date === 'string' && typeof item.id === 'string') : [];
  } catch { return []; }
}

function openMessageForm() {
  const saved = readMessages();
  openDialog(text('message.category'), `<h1 id="dialog-title">${escape(text('message.title'))}</h1>
    <div class="message-notice">${escape(text('message.notice'))}</div>
    <form id="message-form" class="message-form">
      <label for="message-type">${escape(text('message.typeLabel'))}<select class="field-input" id="message-type" name="type">${Object.entries(messageTypes).map(([value, key]) => `<option value="${value}">${escape(text(`message.${key}`))}</option>`).join('')}</select></label>
      <label for="message-game-name">${escape(text('message.gameNameLabel'))}<input class="field-input" type="text" id="message-game-name" name="gameName" required minlength="1" maxlength="40" autocomplete="off" aria-describedby="message-identity-note" placeholder="${escape(text('message.gameNamePlaceholder'))}"></label>
      <label for="message-qq">${escape(text('message.qqLabel'))}<input class="field-input" type="text" id="message-qq" name="qq" required minlength="5" maxlength="12" pattern="[1-9][0-9]{4,11}" inputmode="numeric" autocomplete="off" aria-describedby="message-identity-note" placeholder="${escape(text('message.qqPlaceholder'))}"></label>
      <p id="message-identity-note" class="message-identity-note">${escape(text('message.identityNotice'))}</p>
      <label for="message-title">${escape(text('message.titleLabel'))}<input class="field-input" id="message-title" name="title" required minlength="2" maxlength="60" placeholder="${escape(text('message.titlePlaceholder'))}"></label>
      <label for="message-content">${escape(text('message.contentLabel'))}<textarea class="field-input" id="message-content" name="content" required minlength="10" maxlength="1000" placeholder="${escape(text('message.contentPlaceholder'))}"></textarea></label>
      <p class="message-error" id="message-error" role="alert"></p>
      <div class="form-footer"><small>${escape(text('message.footer'))}</small><button type="submit" class="primary-button">${escape(text('message.save'))}</button></div>
    </form>${saved.length ? `<div class="local-message">${escape(format('message.recordsCount', saved.length))}<button id="view-local-messages">${escape(text('message.viewRecords'))}</button></div>` : ''}`);
}

async function saveMessage(form) {
  if (!form || form !== $('#message-form') || form.dataset.submitting === 'true' || form.dataset.submitted === 'true') return;
  const title = form.elements.title.value.trim();
  const content = form.elements.content.value.trim();
  const type = form.elements.type.value;
  const gameName = form.elements.gameName?.value.trim() || '';
  const qq = form.elements.qq?.value.trim() || '';
  if (!gameName || gameName.length > 40 || !/^[1-9][0-9]{4,11}$/.test(qq)) { $('#message-error').textContent = text('message.identityValidationError'); return; }
  if (title.length < 2 || title.length > 60 || content.length < 10 || content.length > 1000 || !Object.hasOwn(messageTypes, type)) { $('#message-error').textContent = text('message.validationError'); return; }
  const generation = dialogGeneration;
  const current = () => generation === dialogGeneration && dialog.open && form === $('#message-form');
  const controls = [...form.elements];
  form.dataset.submitting = 'true';
  form.setAttribute('aria-busy', 'true');
  controls.forEach(control => { control.disabled = true; });
  $('#message-error').textContent = '';
  try {
    const response = await fetch('/api/feedback', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type, gameName, qq, title, content }) });
    const result = await response.json();
    if (response.status !== 201) throw new Error(typeof result.message === 'string' && result.message ? result.message : text('message.submitError'));
    const feedback = result.feedback;
    if (!feedback || typeof feedback.id !== 'string' || typeof feedback.createdAt !== 'string' || !Number.isFinite(Date.parse(feedback.createdAt))) throw new Error(text('message.submitError'));
    form.dataset.submitted = 'true';
    const record = { ...feedback, title, content, type, gameName, qq, submitted: true, date: new Date(feedback.createdAt).toLocaleString(i18n.language, { timeZone: 'Asia/Shanghai' }) };
    let receiptNotice = '';
    try { localStorage.setItem(messageStorageKey, JSON.stringify([record, ...readMessages()].slice(0, 20))); }
    catch { receiptNotice = `<p class="message-notice">${escape(text('message.storageError'))}</p>`; }
    if (!current()) return;
    openDialog(text('message.localCategory'), `<div class="success-panel"><div class="success-icon">${icon('check')}</div><h1 id="dialog-title">${escape(text('message.savedTitle'))}</h1><p>${escape(text('message.savedNotice'))}</p>${receiptNotice}<div class="local-message">${escape(text('message.recordId'))}${escape(record.id)}<br>${escape(text('message.savedAt'))}${escape(record.date)}<br>${escape(text('message.savedTitleLabel'))}${escape(title)}</div><button class="primary-button" id="view-local-messages">${escape(text('message.viewAll'))}</button></div>`);
  } catch (error) {
    if (current()) $('#message-error').textContent = error.message || text('message.submitError');
  } finally {
    form.dataset.submitting = 'false';
    form.removeAttribute('aria-busy');
    controls.forEach(control => { control.disabled = false; });
  }
}

function openMessages() {
  const saved = readMessages();
  openDialog(text('message.recordsCategory'), `<h1 id="dialog-title">${escape(text('message.recordsTitle'))}</h1><p class="message-notice">${escape(text('message.recordsNotice'))}</p>${saved.map(item => `<div class="search-result"><strong>${escape(item.title)}</strong><p>${escape(item.content)}</p><small>${escape(text(item.submitted === true ? 'message.submitted' : 'message.localUnsubmitted'))}　${escape(Object.hasOwn(messageTypes, item.type) ? text(`message.${messageTypes[item.type]}`) : item.type)}　${escape(item.date)}</small></div>`).join('') || `<div class="empty-state">${escape(text('message.empty'))}</div>`}`);
}

function setupKeyboardTabs(selector, callback) {
  const tabs = $$(selector);
  tabs.forEach((tab, index) => tab.addEventListener('keydown', event => {
    let next;
    const step = i18n.direction === 'rtl' ? -1 : 1;
    if (event.key === 'ArrowRight') next = (index + step + tabs.length) % tabs.length;
    if (event.key === 'ArrowLeft') next = (index - step + tabs.length) % tabs.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = tabs.length - 1;
    if (next === undefined) return;
    event.preventDefault();
    callback(tabs[next]);
    tabs[next].focus();
  }));
}

document.addEventListener('click', event => {
  const target = event.target.closest('button, a');
  if (!target) return;
  if (target.dataset.article) { event.preventDefault(); openArticle(target.dataset.article); }
  else if (target.dataset.service) openService(target.dataset.service);
  else if (target.dataset.response) openResponse(target.dataset.response);
  else if (target.dataset.info) openInfo(target.dataset.info);
  else if (target.dataset.topic) openTopic(target.dataset.topic);
  else if (target.dataset.category) openSearch('', target.dataset.category);
  else if (target.dataset.search) openSearch(target.dataset.search);
  else if (target.dataset.resultCategory) openSearch(target.dataset.query, target.dataset.resultCategory);
  else if (target.dataset.newsTab) renderNews(target.dataset.newsTab);
  else if (target.dataset.serviceTab) renderServices(target.dataset.serviceTab);
  else if (target.dataset.slide !== undefined) showSlide(Number(target.dataset.slide));
  else if (target.dataset.cityPhoto) openCityPhoto(target.dataset.cityPhoto);
  else if (target.id === 'open-message' || target.id === 'dialog-open-message') openMessageForm();
  else if (target.id === 'view-local-messages') openMessages();
  else if (target.id === 'all-services') openDialog(text('serviceArea.title'), `<h1 id="dialog-title">${escape(text('ui.allServicesTitle'))}</h1><p class="service-intro">${escape(text('ui.allServicesDescription'))}</p><div class="service-grid dialog-services">${services.map(serviceButton).join('')}</div>`);
  else if (target.id === 'news-more') openSearch('', currentNewsCategory);
  else if (target.id === 'headline-link') openTopic('民生实事');
  else if (target.id === 'feature-story') openCityPhoto(slides[currentSlide].id);
  else if (target.id === 'interpretation-feature') {
    const entry = byCategory('政策解读')[0];
    if (entry) openArticle(entry.id); else openSearch('', '政策解读');
  }
  else if (target.id === 'slide-prev') showSlide(currentSlide - 1);
  else if (target.id === 'slide-next') showSlide(currentSlide + 1);
  if (target.classList.contains('map-link')) closeDialog();
  if (target.classList.contains('nav-link')) {
    $$('.nav-link').forEach(link => link.classList.toggle('active', link === target));
  }
  if (target.getAttribute('href') === '#home') {
    event.preventDefault();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    $$('.nav-link').forEach(link => link.classList.toggle('active', link.getAttribute('href') === '#home'));
  }
});

document.addEventListener('keydown', event => {
  if (!dialog.open || !dialog.dataset.cityPhoto || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
  event.preventDefault();
  const index = cityPhotos.findIndex(photo => photo.id === dialog.dataset.cityPhoto);
  const step = (event.key === 'ArrowRight' ? 1 : -1) * (i18n.direction === 'rtl' ? -1 : 1);
  openCityPhoto(cityPhotos[(index + step + cityPhotos.length) % cityPhotos.length].id);
});

document.addEventListener('submit', event => {
  if (event.target.id === 'site-search') { event.preventDefault(); openSearch($('#search-input').value); }
  if (event.target.id === 'dialog-search') { event.preventDefault(); openSearch($('#dialog-query').value, event.target.dataset.category); }
  if (event.target.id === 'message-form') { event.preventDefault(); saveMessage(event.target); }
});

$('#senior-toggle').addEventListener('click', () => {
  const active = document.body.classList.toggle('senior-mode');
  $('#senior-toggle').setAttribute('aria-pressed', active);
  $('#senior-toggle').textContent = active ? text('display.exitSenior') : text('header.senior');
  toast(active ? text('display.seniorOn') : text('display.seniorOff'));
});
$('#accessibility-toggle').addEventListener('click', () => {
  const active = document.body.classList.toggle('accessible-mode');
  $('#accessibility-toggle').setAttribute('aria-pressed', active);
  toast(active ? text('display.accessibilityOn') : text('display.accessibilityOff'));
});
$('#back-to-top').addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
window.addEventListener('scroll', () => { $('#back-to-top').hidden = window.scrollY < 650; }, { passive: true });

function handleHash() {
  let hash;
  try { hash = decodeURIComponent(location.hash.slice(1)); }
  catch { return; }
  if (hash.startsWith('article/')) openArticle(hash.slice(8));
  if (hash.startsWith('service/')) openService(hash.slice(8));
}
window.addEventListener('hashchange', () => {
  const generation = ++dialogGeneration, hash = location.hash;
  initialLanguage.then(() => { if (generation === dialogGeneration && hash === location.hash) handleHash(); });
});

function renderArticleSections() {
  articles = originalArticles.map(article => i18n.localizeArticle(article));
  renderNews(currentNewsCategory);
  renderCompactList('#policy-list', byCategory('政策文件').slice(0, 4));
  renderCompactList('#interpretation-list', byCategory('政策解读').slice(1, 3));
  renderCompactList('#department-list', byCategory('部门动态').slice(0, 4), true);
}

async function refreshArticles() {
  const generation = dialogGeneration, hash = location.hash;
  try {
    const response = await fetch('/api/articles', { cache: 'no-store' });
    if (!response.ok) throw new Error('无法载入');
    const data = await response.json();
    originalArticles = data.articles;
    renderArticleSections();
    await initialLanguage;
    if (generation === dialogGeneration && hash === location.hash) handleHash();
  } catch { toast(text('ui.loadArticlesError')); }
}

function applySiteContent() {
  document.documentElement?.setAttribute('lang', i18n.language);
  document.documentElement?.setAttribute('dir', i18n.direction);
  document.documentElement?.setAttribute('data-language', i18n.language);
  document.title = text('site.title');
  $$('[data-content]').forEach(element => { element.textContent = text(element.dataset.content); });
  $$('[data-content-search]').forEach(element => { element.dataset.search = text(element.dataset.contentSearch); });
  for (const attribute of ['placeholder', 'aria-label', 'content']) {
    $$(`[data-content-${attribute}]`).forEach(element => element.setAttribute(attribute, text(element.getAttribute(`data-content-${attribute}`))));
  }
  $$('[data-i18n-aria-label]').forEach(element => element.setAttribute('aria-label', ui(element.dataset.i18nAriaLabel)));
  $('#language-label').textContent = ui('language');
  $('#language-current').textContent = languages.find(language => language.code === i18n.language).name;
  $('#language-panel-title').textContent = ui('language');
  $$('[data-language]').forEach(button => {
    if (!button.classList.contains('language-option')) return;
    button.setAttribute('aria-pressed', String(button.dataset.language === i18n.language));
  });
  $('#senior-toggle').textContent = document.body.classList.contains('senior-mode') ? text('display.exitSenior') : text('header.senior');
  services = serviceIds.map(id => ({
    id, icon: serviceDefaults.find(item => item.id === id).icon,
    name: text(`services.${id}.name`), description: text(`services.${id}.description`),
    materials: lines(text(`services.${id}.materials`)), steps: lines(text(`services.${id}.steps`)), time: text(`services.${id}.time`),
  }));
  responses = responseIds.map(id => ({ id, question: text(`responses.${id}.question`), answer: text(`responses.${id}.answer`), date: text(`responses.${id}.date`) }));
  renderArticleSections();
  renderServices($('[data-service-tab].active')?.dataset.serviceTab);
  $('#response-list').innerHTML = responses.map(response => `<li><button class="list-button" data-response="${response.id}"><span class="list-title">${escape(response.question)}</span><span class="response-tag">${escape(text('ui.responseStatus'))}</span></button></li>`).join('');
  showSlide(currentSlide);
  renderCityPhotos();
  $$('[data-slide]').forEach((button, index) => button.setAttribute('aria-label', `${index + 1}：${text(`slides.${index}.title`)}`));
  $('.utility-date').textContent = new Intl.DateTimeFormat(i18n.language, { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long', timeZone: 'Asia/Shanghai' }).format(new Date());
}

$('#language-options').innerHTML = languages.map(language => `<button class="language-option" data-language="${language.code}" lang="${language.code}" dir="${language.direction || 'ltr'}" aria-pressed="${language.code === 'zh-CN'}"><span class="language-native">${language.name}</span><small class="language-code">${language.code}</small>${icon('check', 'icon language-check')}</button>`).join('');
const languagePanel = $('#language-panel');
function positionLanguagePanel() {
  const trigger = $('#language-toggle').getBoundingClientRect();
  const width = Math.min(420, window.innerWidth - 24);
  const left = i18n.direction === 'rtl' ? trigger.left : trigger.right - width;
  const top = Math.max(12, Math.min(trigger.bottom + 12, window.innerHeight - 180));
  languagePanel.style.left = `${Math.max(12, Math.min(left, window.innerWidth - width - 12))}px`;
  languagePanel.style.top = `${top}px`;
  languagePanel.style.maxHeight = `${Math.max(160, window.innerHeight - top - 12)}px`;
}
languagePanel.addEventListener('beforetoggle', event => {
  if (event.newState === 'open') positionLanguagePanel();
});
languagePanel.addEventListener('toggle', event => {
  const open = event.newState === 'open';
  $('#language-toggle').setAttribute('aria-expanded', String(open));
  if (open) $('#language-options [aria-pressed="true"]')?.focus();
});
window.addEventListener('resize', () => {
  if ($('#language-toggle').getAttribute('aria-expanded') === 'true') positionLanguagePanel();
});
let languageRequest = 0;
async function setLanguage(code, announce = true) {
  const request = ++languageRequest;
  $('#language-toggle').setAttribute('aria-busy', 'true');
  $('#language-options').setAttribute('aria-busy', 'true');
  try {
    if (await i18n.setLanguage(code)) {
      const returnFocus = announce && (languagePanel.contains?.(document.activeElement) || document.activeElement === $('#language-toggle'));
      applySiteContent();
      if (dialog.open) {
        if (dialog.dataset.article) openArticle(dialog.dataset.article);
        else if (dialog.dataset.topic) openTopic(dialog.dataset.topic);
        else if (dialog.dataset.searchCategory) openSearch(dialog.dataset.searchQuery, dialog.dataset.searchCategory);
      }
      languagePanel.hidePopover?.();
      if (returnFocus) $('#language-toggle').focus({ preventScroll: true });
      if (announce) toast(ui('languageChanged'));
    }
  } catch {
    if (request === languageRequest) {
      toast(ui('switchError'));
    }
  } finally {
    if (request === languageRequest) {
      $('#language-toggle').setAttribute('aria-busy', 'false');
      $('#language-options').setAttribute('aria-busy', 'false');
    }
  }
}
$('#language-options').addEventListener('click', event => {
  const option = event.target.closest('.language-option[data-language]');
  if (option) setLanguage(option.dataset.language);
});

async function refreshSiteContent() {
  try {
    const response = await fetch('/api/site-content', { cache: 'no-store' });
    if (!response.ok) throw new Error('无法载入网站内容');
    const data = await response.json();
    if (data.content?.version !== 1 || !data.content.values || typeof data.content.values !== 'object' || Array.isArray(data.content.values)) throw new Error('网站内容格式无效');
    siteContent = data.content;
    applySiteContent();
  } catch { toast(text('ui.loadContentError')); }
}

applySiteContent();
setupKeyboardTabs('[data-news-tab]', tab => renderNews(tab.dataset.newsTab));
setupKeyboardTabs('[data-service-tab]', tab => renderServices(tab.dataset.serviceTab));
const initialLanguage = i18n.preferredLanguage !== 'zh-CN' ? setLanguage(i18n.preferredLanguage, false) : Promise.resolve();
const initialGeneration = dialogGeneration, initialHash = location.hash;
initialLanguage.then(() => { if (initialGeneration === dialogGeneration && initialHash === location.hash) handleHash(); });
Promise.all([refreshSiteContent(), refreshArticles()]);

window.addEventListener('focus', () => { refreshSiteContent(); refreshArticles(); });
