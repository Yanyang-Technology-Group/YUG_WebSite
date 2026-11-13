import { services as serviceDefaults, responses as responseDefaults } from './portal-data.js';

// Field keys identify fixed page locations. Their labels may change without changing routes.
const groups = {
  '网站名称与页眉': [
    ['site.name', '网站名称', '晏阳联合政府'],
    ['site.title', '浏览器页面标题', '晏阳联合政府网站'],
    ['site.subtitle', '英文副标题', 'Yanyang United Government'],
    ['site.description', '网站简介', '晏阳联合政府网站，提供政务资讯、政策解读、办事指南和互动交流。', 'textarea'],
    ['header.welcome', '欢迎语', '欢迎访问晏阳联合政府网站'],
    ['header.searchLabel', '搜索框说明', '搜索政务资讯、政策和服务'],
    ['header.searchPlaceholder', '搜索框提示', '搜索政务资讯、政策、服务'],
    ['header.hotSearch', '热搜标签', '热搜：'],
    ['header.hot1', '热搜词一', '营商环境'],
    ['header.hot2', '热搜词二', '就业创业'],
    ['header.hot3', '热搜词三', '医疗保障'],
    ['header.accessibility', '无障碍按钮', '无障碍'],
    ['header.senior', '长者模式按钮', '长者模式'],
    ['header.help', '帮助按钮', '网站帮助'],
    ['header.admin', '管理入口', '管理模式'],
  ],
  '主导航与文章栏目名称': [
    ['nav.home', '首页名称', '首页'],
    ['nav.disclosure', '公开区域名称', '政务公开'],
    ['nav.news', '动态区域名称', '政务动态'],
    ['nav.services', '服务区域名称', '政务服务'],
    ['nav.interaction', '互动区域名称', '政民互动'],
    ['nav.city', '城市区域名称', '走进晏阳'],
    ['nav.topics', '专题区域名称', '专题专栏'],
    ['categories.全部', '全部文章', '全部'],
    ['categories.政务要闻', '要闻栏目名称', '政务要闻'],
    ['categories.通知公告', '公告栏目名称', '通知公告'],
    ['categories.政策文件', '政策文件栏目名称', '政策文件'],
    ['categories.政策解读', '政策解读栏目名称', '政策解读'],
    ['categories.部门动态', '部门动态栏目名称', '部门动态'],
    ['categories.民生资讯', '民生资讯栏目名称', '民生资讯'],
  ],
  '头条与图片轮播': [
    ['headline.tag', '头条上方标签', '今日关注'],
    ['headline.title', '头条标题', '以实干担当绘就高质量发展新图景'],
    ['headline.related1', '关联热点一', '持续优化营商环境'],
    ['headline.related2', '关联热点二', '加快建设宜居韧性智慧城市'],
    ['headline.related3', '关联热点三', '用心用情办好民生实事'],
    ['feature.tag', '图片区域标签', '美丽晏阳'],
    ['slides.0.alt', '第一张图片说明', '游戏中的晏阳大会堂正面，立柱与宽阔台阶在日光下形成整齐的光影'],
    ['slides.0.kicker', '第一张图片短标题', '晏阳大会堂'],
    ['slides.0.title', '第一张图片标题', '光影映照厅堂　方寸尽显庄严'],
    ['slides.1.alt', '第二张图片说明', '游戏中的现代商业街区，高层建筑、商业裙楼与沿街绿化相互交织'],
    ['slides.1.kicker', '第二张图片短标题', '城市新景'],
    ['slides.1.title', '第二张图片标题', '楼宇勾勒天际　街巷铺展生活'],
    ['slides.2.alt', '第三张图片说明', '游戏中的车站正面，夕照下的屋檐、灯光与站前广场相映成景'],
    ['slides.2.kicker', '第三张图片短标题', '站前广场'],
    ['slides.2.title', '第三张图片标题', '夕照映站前　灯火迎归人'],
    ['news.footer', '新闻区域底部说明', '及时发布政务信息　主动回应社会关切'],
  ],
  '城市风貌图集': [
    ['gallery.title', '图集区域名称', '城市风貌'],
    ['gallery.subtitle', '图集区域说明', '从恢宏厅堂到街巷院落，看见晏阳的不同侧面'],
    ['gallery.note', '图集底部说明', '影像来源：晏阳城市建设服务器'],
    ['gallery.view', '查看照片按钮', '查看大图'],
    ['gallery.previous', '上一张照片按钮', '上一张'],
    ['gallery.next', '下一张照片按钮', '下一张'],
    ['gallery.hall.caption', '大会堂配文', '舒展的屋檐、整齐的立柱与层层台阶，共同构成大会堂庄重的正面。日光落在石阶上，映出建筑的秩序与尺度。', 'textarea'],
    ['gallery.residences.title', '住宅街区标题', '云影下的居住街区'],
    ['gallery.residences.alt', '住宅街区图片说明', '游戏中的住宅楼群，灰白色高楼沿道路排列，周边可见绿化与运动场地'],
    ['gallery.residences.caption', '住宅街区配文', '灰白色住宅楼群在云影下依次展开，道路、绿化与运动场地围合出街区的日常空间。', 'textarea'],
    ['gallery.courtyard.title', '传统院落标题', '青瓦叠院，庭树成荫'],
    ['gallery.courtyard.alt', '传统院落图片说明', '游戏中的传统院落，围墙内青瓦屋顶层层展开，庭院与树木穿插其间'],
    ['gallery.courtyard.caption', '传统院落配文', '围墙之内，青瓦屋顶沿中轴层层铺展，庭院与绿树穿插其间。从高处望去，院落的层次与布局清晰可见。', 'textarea'],
    ['gallery.skyline.caption', '现代街区配文', '高层楼宇与商业裙楼相接，沿街绿化为道路添上一抹鲜绿。抬头是城市天际线，转角是街巷生活的细节。', 'textarea'],
    ['gallery.station.caption', '站前广场配文', '夕阳为车站屋檐镀上暖色，站前广场的铺装向建筑延伸。灯光与晚霞相映，留下安静而开阔的城市一景。', 'textarea'],
  ],
  '快捷入口': [
    ['quick.disclosure.title', '信息公开入口名称', '政府信息公开'],
    ['quick.disclosure.subtitle', '信息公开入口说明', '公开透明　依法行政'],
    ['quick.policy.title', '文件库入口名称', '政策文件库'],
    ['quick.policy.subtitle', '文件库入口说明', '权威发布　精准查询'],
    ['quick.service.title', '服务大厅入口名称', '政务服务大厅'],
    ['quick.service.subtitle', '服务大厅入口说明', '一网通办　便捷高效'],
    ['quick.interaction.title', '交流平台入口名称', '互动交流平台'],
    ['quick.interaction.subtitle', '交流平台入口说明', '倾听民意　为民解忧'],
  ],
  '政策与信息公开': [
    ['policy.title', '政策区域标题', '最新政策'],
    ['policy.search', '文件查询入口文字', '查找您关心的政策文件'],
    ['policy.interpretationTitle', '解读区域标题', '政策解读'],
    ['policy.bannerKicker', '解读卡片短标题', '让政策走进生活'],
    ['policy.bannerTitle', '解读卡片标题', '政策看得懂\n红利享得到', 'textarea'],
    ['policy.bannerDetail', '解读卡片说明', '一图读懂惠民惠企新举措'],
    ['disclosure.title', '信息公开区域标题', '政府信息公开'],
    ['disclosure.guide', '公开指南入口名称', '公开指南'],
    ['disclosure.directory', '公开目录入口名称', '公开目录'],
    ['disclosure.report', '工作报告入口名称', '工作报告'],
    ['disclosure.finance', '财政入口名称', '财政预决算'],
    ['disclosure.keyAreas', '重点领域入口名称', '重点领域'],
    ['disclosure.application', '申请公开入口名称', '依申请公开'],
    ['disclosure.reportYear', '工作报告年份', '2026'],
    ['disclosure.reportTitle', '工作报告卡片标题', '政府工作报告'],
  ],
  '民生横幅': [
    ['livelihood.kicker', '民生横幅短标题', '以人民为中心　让幸福可感可及'],
    ['livelihood.title', '民生横幅主标题', '把民生实事办到群众心坎上'],
    ['livelihood.detail', '民生横幅说明', '2026年晏阳民生实事专题'],
  ],
  '政务服务区域': [
    ['serviceArea.title', '服务区域标题', '政务服务'],
    ['serviceArea.subtitle', '服务区域说明', '便民利企，办事更省心'],
    ['serviceArea.all', '全部服务入口', '全部服务'],
    ['serviceArea.tab.hot', '热门服务标签', '热门服务'],
    ['serviceArea.tab.personal', '个人办事标签', '个人办事'],
    ['serviceArea.tab.enterprise', '法人办事标签', '法人办事'],
    ['serviceArea.promotionTitle', '推荐服务标题', '高效办成一件事'],
    ['serviceArea.promotionBody', '推荐服务说明', '从“一事一办”到“一次办好”\n让政务服务更有温度', 'textarea'],
    ['serviceArea.promotionButton', '推荐服务按钮', '查看办事指南'],
  ],
  '互动与部门动态': [
    ['interaction.title', '互动区域标题', '政民互动'],
    ['interaction.subtitle', '互动区域说明', '您的声音，我们倾听'],
    ['interaction.message', '留言入口名称', '我要留言'],
    ['interaction.messageSubtitle', '留言入口说明', '提交留言，由管理员查看'],
    ['interaction.survey', '征集入口名称', '意见征集'],
    ['interaction.surveySubtitle', '征集入口说明', '邀您共建美好晏阳'],
    ['interaction.responseTitle', '答复区域标题', '回应关切'],
    ['interaction.responseSubtitle', '答复区域说明', '关注民生热点　解答群众疑问'],
    ['interaction.departmentTitle', '部门区域标题', '部门动态'],
    ['interaction.hotlineTitle', '联系邮箱名称', '政务服务联系邮箱'],
    ['interaction.hotlineNumber', '联系邮箱', 'feedback@yanyn.cn'],
    ['interaction.hotlineDescription', '热线说明', '倾听诉求\n服务民生', 'textarea'],
  ],
  '专题卡片': [
    ['topicArea.title', '专题区域标题', '专题专栏'],
    ['topicArea.subtitle', '专题区域说明', '聚焦发展，记录晏阳'],
    ['topicArea.all', '全部专题入口', '全部专题'],
    ['topicCard.business.kicker', '营商卡片短标题', '惠企利民　服务发展'],
    ['topicCard.business.title', '营商卡片标题', '持续优化营商环境'],
    ['topicCard.business.detail', '营商卡片说明', '打造投资兴业的活力之城'],
    ['topicCard.green.kicker', '绿色卡片短标题', '绿水青山　美好家园'],
    ['topicCard.green.title', '绿色卡片标题', '绘就绿色发展新画卷'],
    ['topicCard.green.detail', '绿色卡片说明', '共建人与自然和谐的美丽晏阳'],
    ['topicCard.digital.kicker', '数字卡片短标题', '数字赋能　智慧服务'],
    ['topicCard.digital.title', '数字卡片标题', '数字政务让生活更便捷'],
    ['topicCard.digital.detail', '数字卡片说明', '数据多跑路　群众少跑腿'],
  ],
  '页脚': [
    ['footer.navigation', '页脚导航标题', '网站导航'],
    ['footer.organization', '机构入口名称', '机构职能'],
    ['footer.sitemap', '地图入口名称', '网站地图'],
    ['footer.about', '关于入口名称', '关于本站'],
    ['footer.statement', '声明入口名称', '网站声明'],
    ['footer.contact', '联系入口名称', '联系我们'],
    ['footer.help', '帮助入口名称', '网站帮助'],
    ['footer.brand', '页脚版权', '© 2025-2026 晏阳技术组'],
    ['footer.motto', '页脚简短说明', '公开 · 服务 · 互动'],
    ['footer.description', '虚构创作声明', '“晏阳联合政府” 属于虚构创作设定，与现实世界中的任何政府、政权、组织不存在对应关系。'],
    ['footer.notice', '页脚声明', ''],
    ['footer.attribution', '影像来源', '影像来源：晏阳城市建设服务器'],
  ],
  '详情与列表文案': [
    ['ui.more', '更多按钮', '更多'],
    ['ui.articleCategory', '资讯标题', '政务资讯'],
    ['ui.emptyColumn', '空栏目提示', '本栏目暂无已发布内容。'],
    ['ui.searchTitle', '搜索标题', '站内搜索'],
    ['ui.searchPlaceholder', '详情搜索提示', '请输入您关心的关键词'],
    ['ui.searchButton', '搜索按钮', '搜索'],
    ['ui.noSearchResults', '搜索无结果提示', '暂未找到相关内容'],
    ['ui.noSearchAdvice', '搜索建议', '请缩短关键词，或选择其他栏目再试。'],
    ['ui.defaultSource', '默认文章来源', '晏阳联合政府政务信息中心'],
    ['ui.articleNote', '示例文章说明', '本文为晏阳联合政府网站的示例资讯。'],
    ['ui.serviceCategory', '指南详情所属栏目', '政务服务 · 办事指南'],
    ['ui.serviceSuffix', '指南标题后缀', '办事指南'],
    ['ui.serviceTime', '办理时限标签', '办理时限：'],
    ['ui.serviceMaterials', '材料清单标题', '需要准备的材料'],
    ['ui.serviceSteps', '办理流程标题', '办理流程'],
    ['ui.serviceNotice', '指南页说明', '本页为办事指南示例。具体材料和受理安排以当地实际规定为准。'],
    ['ui.allServicesTitle', '全部服务详情标题', '办事服务'],
    ['ui.allServicesDescription', '全部服务详情说明', '选择事项，查看办理材料、流程和时限。'],
    ['ui.infoCategory', '栏目详情分类名称', '网站栏目'],
    ['ui.saveSuggestion', '建议入口按钮', '提交意见建议'],
    ['ui.queryPolicy', '政策查询按钮', '查询政策文件'],
    ['ui.topicSuffix', '专题标题后缀', '专题'],
    ['ui.responseCategory', '答复详情所属栏目', '政民互动 · 回应关切'],
    ['ui.responseStatus', '答复状态', '已答复'],
    ['ui.responseNote', '答复页说明', '本答复为门户演示内容。'],
    ['ui.skipLink', '跳至内容入口', '跳至主要内容'],
    ['ui.backToTop', '返回顶部按钮', '返回顶部'],
    ['ui.loadContentError', '内容加载失败提示', '无法载入网站内容，请确认网站服务正常运行后刷新。'],
    ['ui.loadArticlesError', '资讯加载失败提示', '无法载入最新资讯，请确认网站服务正常运行后刷新。'],
  ],
};

export const contentFields = Object.entries(groups).flatMap(([group, entries]) => entries.map(([key, label, defaultValue, type = 'text']) => ({ key, group, label, type, defaultValue, maxLength: type === 'textarea' ? 12000 : 1000 })));

function addField(key, group, label, defaultValue, type = 'text') {
  contentFields.push({ key, group, label, type, defaultValue, maxLength: type === 'textarea' ? 24000 : 1000 });
}

export const serviceIds = serviceDefaults.map(service => service.id);
for (const service of serviceDefaults) {
  const group = `办事指南：${service.name}`;
  for (const [property, label, type] of [['name', '事项名称', 'text'], ['description', '事项介绍', 'textarea'], ['materials', '材料清单（每行一项）', 'textarea'], ['steps', '办理步骤（每行一项）', 'textarea'], ['time', '办理时限', 'textarea']]) {
    addField(`services.${service.id}.${property}`, group, label, Array.isArray(service[property]) ? service[property].join('\n') : service[property], type);
  }
}

export const responseIds = responseDefaults.map(response => response.id);
for (const [index, response] of responseDefaults.entries()) {
  const group = `群众答复：第 ${index + 1} 条`;
  for (const [property, label, type] of [['question', '问题标题', 'text'], ['answer', '答复内容', 'textarea'], ['date', '答复日期', 'text']]) addField(`responses.${response.id}.${property}`, group, label, response[property], type);
}

const infoDefaults = [
  {
    "id": "政府信息公开",
    "fieldId": "disclosure",
    "label": "政府信息公开",
    "body": "坚持以公开为常态，围绕政府工作、公共服务和民生保障，及时公开政策文件、政府工作报告及重点领域信息。\n\n您可在首页查看公开指南、公开目录、年度政府工作报告和财政预决算等栏目。本站政策文件库支持按关键词与栏目检索。"
  },
  {
    "id": "信息公开指南",
    "fieldId": "guide",
    "label": "信息公开指南",
    "body": "本栏目介绍政府信息公开范围、获取方式以及依申请公开的办理步骤。主动公开的信息包括机构职责、规范性文件、规划计划、财政信息和公共服务事项。\n\n在本站首页点击“政策文件库”可检索示例政策；需要了解未主动公开的信息，可查看“依申请公开”栏目。"
  },
  {
    "id": "信息公开目录",
    "fieldId": "directory",
    "label": "信息公开目录",
    "body": "政务公开目录包含机构信息、政策法规、政府工作报告、财政预决算、重大项目、民生保障与公共服务等类别。\n\n目录按公开主题组织，帮助市民快捷查找信息。本示例门户已提供政策文件、政策解读与办事服务内容。"
  },
  {
    "id": "政府工作报告",
    "fieldId": "report",
    "label": "政府工作报告",
    "body": "2026年，晏阳围绕高质量发展，坚持把保障和改善民生放在突出位置，持续推进城市更新、生态保护与数字政务建设。\n\n主要工作包括：优化营商环境，完善企业全生命周期服务；建设宜居城市，推进社区更新和便民设施建设；提升公共服务，补齐教育、医疗、养老等领域服务短板。\n\n下一阶段将以群众和企业的实际感受检验工作成效，把民生实事办实办好。"
  },
  {
    "id": "财政预决算",
    "fieldId": "finance",
    "label": "财政预决算",
    "body": "本栏目按年度展示财政预算、预算执行与决算公开信息，方便公众了解财政资金安排和使用情况。\n\n公开范围涵盖公共预算、政府性基金预算、部门预算与“三公”经费等内容。本示例不使用实际财政数据。"
  },
  {
    "id": "重点领域公开",
    "fieldId": "key-areas",
    "label": "重点领域公开",
    "body": "重点关注教育、医疗卫生、社会保障、住房保障、生态环境和重大建设项目等群众关心的领域。\n\n本站可通过“民生资讯”“政策解读”栏目了解相关示例信息，也可在“政务服务”栏目查阅办理指南。"
  },
  {
    "id": "依申请公开",
    "fieldId": "application",
    "label": "依申请公开",
    "body": "提出申请时，应准确描述所需信息，说明信息名称、文号或有助于查询的线索，并选择方便获取信息的方式。\n\n受理后，将按照相关规定审查信息是否属于公开范围，并在法定期限内答复。本示例页面不受理真实信息公开申请。"
  },
  {
    "id": "高效办成一件事",
    "fieldId": "one-service",
    "label": "高效办成一件事",
    "body": "围绕群众和企业办事需求，整合关联事项，推动“一次告知、一表申请、一套材料、一窗受理”。\n\n常见服务场景包括企业开办、就业创业、社会保障、教育入学和养老服务。请从下方选择事项查看材料清单与办理流程。"
  },
  {
    "id": "意见征集",
    "fieldId": "survey",
    "label": "意见征集",
    "body": "让城市建设听见您的声音。现面向市民征集社区公共空间提升、绿色出行与养老助餐服务的意见建议。\n\n征集时间：2026年10月10日至10月31日。您可以围绕使用体验、设施布局和服务安排提出具体建议。通过下方入口提交的建议由本站管理员查看，不公开展示，不作为正式政务申请。"
  },
  {
    "id": "互动交流",
    "fieldId": "interaction",
    "label": "互动交流",
    "body": "本栏目提供咨询答复、意见征集与留言记录，帮助市民了解关心的问题。\n\n您可以通过“我要留言”提交建议、咨询或反馈，本站管理员可在后台查看，留言不会公开展示。首页“回应关切”提供教育入学、公交线路与养老服务等常见问题的示例答复。"
  },
  {
    "id": "机构职能",
    "fieldId": "organization",
    "label": "机构职能",
    "body": "晏阳联合政府统筹全市经济发展、城乡建设、社会事务与公共服务。市政务服务中心负责综合窗口、咨询指引与办事协同。\n\n教育、民政、人社、住建、交通、生态环境等部门按职责提供公共服务和政务信息。本站所展示的机构与职能为示例内容。"
  },
  {
    "id": "网站地图",
    "fieldId": "sitemap",
    "label": "网站地图",
    "body": "首页由政务动态、政务公开、政务服务、政民互动、城市风貌与专题专栏组成。点击下方入口即可前往相关栏目。"
  },
  {
    "id": "关于本站",
    "fieldId": "about",
    "label": "关于本站",
    "body": "本站以中国政府网的政务门户信息层级为参考，提供清晰、便捷的资讯阅读和服务查询体验。\n\n“晏阳”为虚构名称，新闻、政策与服务资料用于演示。留言会提交至本站供管理员查看，不公开展示。图片使用本地景观素材，页面不设置外部跳转。"
  },
  {
    "id": "网站声明",
    "fieldId": "statement",
    "label": "网站声明",
    "body": "本站为政府门户界面示例，示例文字不具有政策效力，不作为正式政务申请或审批的依据。\n\n留言会提交至本站，由管理员查看，不公开展示，也不代表真实政府部门受理。请勿填写身份证号、电话、住址等个人敏感信息。"
  },
  {
    "id": "联系我们",
    "fieldId": "contact",
    "label": "联系我们",
    "body": "您可以通过本站“政民互动”查阅示例咨询资料，也可以在“我要留言”中提交建议、咨询或反馈，由本站管理员查看。留言内容不公开展示。\n\n本演示网站没有真实的联系地址、邮箱或受理电话。首页热线数字用于展示政府门户常用服务栏目，留言不作为正式政务办理申请。"
  },
  {
    "id": "网站帮助",
    "fieldId": "help",
    "label": "网站帮助",
    "body": "查找信息：在顶部搜索框输入关键词，或点击热搜词。搜索结果可按政策文件、政策解读等栏目筛选。\n\n阅读与办事：点击新闻标题查看全文，点击服务图标查看材料和办理流程。详情可用右上角关闭按钮或 Esc 键关闭。\n\n留言：在“我要留言”填写标题和内容后提交，本站管理员可查看，内容不公开。提交成功后请保留回执编号；旧的本地留言不会自动提交。\n\n显示设置：顶部“长者模式”放大界面；“无障碍”增强链接辨识与阅读对比。城市图片可使用底部圆点与箭头切换。"
  },
  {
    "id": "专题专栏",
    "fieldId": "topics",
    "label": "专题专栏",
    "body": "专题专栏围绕营商环境、绿色发展和数字政务，将相关资讯与政策集中展示。您可以在首页专题卡片中选择感兴趣的主题。"
  }
];
export const infoSections = infoDefaults.filter(info => !['about', 'statement', 'contact'].includes(info.fieldId)).map(info => ({ id: info.id, labelKey: `info.${info.fieldId}.title`, bodyKey: `info.${info.fieldId}.body` }));
for (const info of infoDefaults) {
  addField(`info.${info.fieldId}.title`, `栏目详情：${info.label}`, '详情标题', info.label);
  addField(`info.${info.fieldId}.body`, `栏目详情：${info.label}`, '详情正文（空行分段）', info.body, 'textarea');
}

const topicDefaults = [
  {
    "id": "民生实事",
    "fieldId": "livelihood",
    "label": "民生实事",
    "description": "聚焦群众急难愁盼，让城市发展成果更多、更公平地惠及市民。",
    "ids": [
      "city-quality",
      "community-elderly-policy",
      "housing-renovation",
      "medical-insurance-guide",
      "school-admission-guide",
      "elderly-meals"
    ]
  },
  {
    "id": "绿色发展",
    "fieldId": "green",
    "label": "绿色发展",
    "description": "守护绿水青山，建设宜居城市，让自然与生活相融。",
    "ids": [
      "autumn-ecology",
      "green-community-policy",
      "green-policy-explained",
      "autumn-city-walk"
    ]
  },
  {
    "id": "营商环境",
    "fieldId": "business",
    "label": "营商环境",
    "description": "以企业需求为导向，让惠企政策更精准，让政务服务更高效。",
    "ids": [
      "business-environment",
      "government-service-measures",
      "service-policy-explained",
      "skills-policy"
    ]
  },
  {
    "id": "数字政务",
    "fieldId": "digital",
    "label": "数字政务",
    "description": "以数字化提升服务效能，让数据多跑路，让群众少跑腿。",
    "ids": [
      "digital-government",
      "government-service-measures",
      "service-policy-explained",
      "medical-insurance-guide"
    ]
  }
];
export const topicSections = topicDefaults.map(topic => ({ id: topic.id, nameKey: `topics.${topic.fieldId}.name`, descriptionKey: `topics.${topic.fieldId}.description`, ids: topic.ids }));
for (const topic of topicDefaults) {
  addField(`topics.${topic.fieldId}.name`, `专题详情：${topic.label}`, '专题名称', topic.label);
  addField(`topics.${topic.fieldId}.description`, `专题详情：${topic.label}`, '专题介绍', topic.description, 'textarea');
}

for (const [key, label, defaultValue, type = 'text'] of [
  [
    "ui.publishedAt",
    "发布时间标签",
    "发布时间："
  ],
  [
    "ui.source",
    "文章来源标签",
    "来源："
  ],
  [
    "ui.searchColumn",
    "搜索无关键词时的范围名称",
    "本栏目"
  ],
  [
    "ui.resultCount",
    "搜索结果数量格式",
    "共找到 {count} 条结果"
  ],
  [
    "ui.responseDate",
    "答复日期标签",
    "答复时间："
  ],
  [
    "ui.responseState",
    "答复办理状态标签",
    "办理状态："
  ],
  [
    "message.category",
    "留言页所属栏目",
    "政民互动 · 我要留言"
  ],
  [
    "message.title",
    "留言页标题",
    "您的声音，我们倾听"
  ],
  [
    "message.notice",
    "留言页提示",
    "留言将提交至本站，由管理员查看，不会公开展示。请勿填写身份证号、电话、住址等个人敏感信息。",
    "textarea"
  ],
  [
    "message.typeLabel",
    "留言类型标签",
    "留言类型"
  ],
  [
    "message.typeSuggestion",
    "建议类型名称",
    "意见建议"
  ],
  [
    "message.typeConsultation",
    "咨询类型名称",
    "办事咨询"
  ],
  [
    "message.typeFeedback",
    "反馈类型名称",
    "体验反馈"
  ],
  [
    "message.gameNameLabel",
    "游戏名称标签",
    "游戏名称（必填）"
  ],
  [
    "message.gameNamePlaceholder",
    "游戏名称输入提示",
    "请输入您的游戏名称（1–40字）"
  ],
  [
    "message.qqLabel",
    "QQ号标签",
    "QQ 号（必填）"
  ],
  [
    "message.qqPlaceholder",
    "QQ号输入提示",
    "请输入 5–12 位 QQ 号"
  ],
  [
    "message.identityNotice",
    "游戏名称和QQ号用途说明",
    "游戏名称和 QQ 号仅供本站管理员查看，用于核对和联系。"
  ],
  [
    "message.identityValidationError",
    "游戏名称和QQ号校验提示",
    "请填写1至40字的游戏名称，以及5至12位、不以0开头的QQ号。"
  ],
  [
    "message.titleLabel",
    "留言标题标签",
    "留言标题"
  ],
  [
    "message.titlePlaceholder",
    "留言标题提示",
    "请简要说明您的建议或问题"
  ],
  [
    "message.contentLabel",
    "留言内容标签",
    "留言内容"
  ],
  [
    "message.contentPlaceholder",
    "留言内容提示",
    "请填写具体内容（10–1000字）"
  ],
  [
    "message.footer",
    "留言页底部说明",
    "提交后由本站管理员查看，不作为正式政务办理申请。"
  ],
  [
    "message.save",
    "提交留言按钮",
    "提交留言"
  ],
  [
    "message.recordsCount",
    "浏览器留言记录数量格式",
    "您在此浏览器中有 {count} 条留言记录。"
  ],
  [
    "message.viewRecords",
    "查看记录按钮",
    "查看记录"
  ],
  [
    "message.validationError",
    "留言校验提示",
    "标题须为2至60字，内容须为10至1000字，请完善后提交。"
  ],
  [
    "message.storageError",
    "提交后回执保存失败提示",
    "留言已提交，但此浏览器未能保存回执。请记下编号，无需再次提交。"
  ],
  [
    "message.localCategory",
    "留言回执所属栏目",
    "政民互动 · 提交回执"
  ],
  [
    "message.savedTitle",
    "留言提交成功标题",
    "留言提交成功"
  ],
  [
    "message.savedNotice",
    "留言提交成功说明",
    "留言已发送至本站，管理员可查看；内容不会公开展示。"
  ],
  [
    "message.recordId",
    "记录编号标签",
    "记录编号："
  ],
  [
    "message.savedAt",
    "提交时间标签",
    "提交时间："
  ],
  [
    "message.savedTitleLabel",
    "提交的标题标签",
    "留言标题："
  ],
  [
    "message.viewAll",
    "查看留言记录按钮",
    "查看留言记录"
  ],
  [
    "message.recordsCategory",
    "留言记录所属栏目",
    "政民互动 · 留言记录"
  ],
  [
    "message.recordsTitle",
    "留言记录标题",
    "我的留言记录"
  ],
  [
    "message.recordsNotice",
    "留言记录说明",
    "这里保存当前浏览器的留言记录。“已提交”的留言已发送至本站；“本地未提交”为旧记录，不会自动发送。"
  ],
  [
    "message.empty",
    "留言空记录提示",
    "暂无留言记录"
  ],
  [
    "message.submitError",
    "留言提交失败提示",
    "留言未能提交，请确认网络和网站服务正常后重试。"
  ],
  [
    "message.submitted",
    "已提交留言状态",
    "已提交"
  ],
  [
    "message.localUnsubmitted",
    "旧本地留言状态",
    "本地未提交"
  ],
  [
    "display.exitSenior",
    "退出长者模式按钮",
    "退出长者模式"
  ],
  [
    "display.seniorOn",
    "长者模式开启提示",
    "已开启长者模式"
  ],
  [
    "display.seniorOff",
    "长者模式关闭提示",
    "已恢复标准显示"
  ],
  [
    "display.accessibilityOn",
    "无障碍开启提示",
    "已开启无障碍阅读模式"
  ],
  [
    "display.accessibilityOff",
    "无障碍关闭提示",
    "已恢复标准阅读模式"
  ]
]) addField(key, key.startsWith('message.') ? '留言与提交回执' : '操作与提示文案', label, defaultValue, type);

for (const [key, label, defaultValue] of [["header.hot1Query","热搜一搜索关键词","营商环境"],["header.hot2Query","热搜二搜索关键词","就业"],["header.hot3Query","热搜三搜索关键词","医保"],["headline.related1Query","关联热点一搜索关键词","营商环境"],["headline.related2Query","关联热点二搜索关键词","城市"],["headline.related3Query","关联热点三搜索关键词","民生"]]) addField(key, '热点搜索关键词', label, defaultValue);

// Retain legacy keys so existing snapshots remain importable, while removing retired UI.
for (const field of contentFields) {
  if (field.key === 'footer.motto') field.retired = true;
  if (['footer.about', 'footer.statement', 'footer.contact', 'footer.notice'].includes(field.key) || /^info\.(about|statement|contact)\./.test(field.key)) field.retired = true;
}

export const defaultSiteContent = { version: 1, values: Object.fromEntries(contentFields.map(field => [field.key, field.defaultValue])) };

// Upgrade unchanged installation defaults without replacing administrator-authored text.
export function migratePortalDefaults(content) {
  const values = { ...content.values };
  for (const [key, previous] of [['footer.brand', '晏阳联合政府'], ['footer.description', '晏阳联合政府网站 · 政务门户'], ['interaction.hotlineTitle', '政务服务便民热线'], ['interaction.hotlineNumber', '12345']]) {
    if (values[key] === previous) values[key] = defaultSiteContent.values[key];
  }
  return { ...content, values };
}

// Replace only the former sample captions; authored text (including blanks) is retained.
export const photoDefaultMigrations = [
  ['slides.0.alt', '湖畔柳树、绿色山林与古塔组成的山水风景'],
  ['slides.0.kicker', '山水之城 · 幸福之城'],
  ['slides.0.title', '一城山水满目新　宜居晏阳向未来'],
  ['slides.1.alt', '湖水、绿树与城市天际线相映的城市风光'],
  ['slides.1.kicker', '品质之城 · 宜居之城'],
  ['slides.1.title', '推窗见绿出门见景　共建美好家园'],
  ['slides.2.alt', '灯火辉映的滨江城市夜景'],
  ['slides.2.kicker', '活力之城 · 创新之城'],
  ['slides.2.title', '灯火映江城　点亮高质量发展新图景'],
  ['footer.attribution', '图片：Bjoertvedt、Yinweichen（CC BY-SA 4.0），DvTor8303（CC0）；经缩放处理'],
  ['gallery.note', '影像来源：用户提供的游戏建筑截图。'],
  ['footer.attribution', '城市影像：用户提供的游戏建筑截图，经尺寸优化处理。'],
  ['footer.notice', '本网站使用示例内容，可由管理员根据实际情况修改。'],
].map(([key, previousValue]) => ({ key, previousValue, value: defaultSiteContent.values[key] }));

// Update only unchanged defaults when installing server-backed feedback.
// Administrator-authored text must retain its existing value.
export const feedbackDefaultMigrations = [
  ['interaction.messageSubtitle', '诉求有回应，办理有回音'],
  ['ui.saveSuggestion', '保存意见建议'],
  ['info.survey.body', '让城市建设听见您的声音。现面向市民征集社区公共空间提升、绿色出行与养老助餐服务的意见建议。\n\n征集时间：2026年10月10日至10月31日。您可以围绕使用体验、设施布局和服务安排提出具体建议。此处为示例征集，不接收真实政务申请。'],
  ['info.interaction.body', '本栏目提供咨询答复、意见征集与留言记录，帮助市民了解关心的问题。\n\n我们已整理教育入学、公交线路与养老服务等常见问题答复，您可以在首页“回应关切”栏目查看。'],
  ['info.about.body', '本站以中国政府网的政务门户信息层级为参考，提供清晰、便捷的资讯阅读和服务查询体验。\n\n“晏阳”为虚构名称，新闻、政策、服务与互动内容均为演示资料。图片使用本地景观素材，页面不设置外部跳转。'],
  ['info.statement.body', '本站为政府门户界面示例，所载文字不具有政策效力，也不承担政务申请、审批或咨询受理功能。\n\n留言仅保存在当前浏览器中，不会发送至政府部门。请勿填写身份证号、电话、住址等个人信息。'],
  ['info.contact.body', '您可以通过本站“政民互动”了解示例咨询内容，也可以在“我要留言”中保存体验建议。\n\n本演示网站没有真实的联系地址、邮箱或受理电话。首页热线数字用于展示政府门户常用服务栏目。'],
  ['info.help.body', '查找信息：在顶部搜索框输入关键词，或点击热搜词。搜索结果可按政策文件、政策解读等栏目筛选。\n\n阅读与办事：点击新闻标题查看全文，点击服务图标查看材料和办理流程。详情可用右上角关闭按钮或 Esc 键关闭。\n\n显示设置：顶部“长者模式”放大界面；“无障碍”增强链接辨识与阅读对比。城市图片可使用底部圆点与箭头切换。'],
  ['message.notice', '本页面用于体验留言流程，留言只保存在当前浏览器，不会提交至政府部门。请不要填写任何个人敏感信息。'],
  ['message.footer', '仅在本机保存，不作为真实政务办理事项。'],
  ['message.save', '保存留言'],
  ['message.recordsCount', '您已有 {count} 条本地留言记录。'],
  ['message.validationError', '标题至少2字，内容至少10字，请补充后保存。'],
  ['message.storageError', '当前浏览器无法保存留言。请检查浏览器存储设置后重试。'],
  ['message.localCategory', '政民互动 · 本地留言'],
  ['message.savedTitle', '留言已保存在本机'],
  ['message.savedNotice', '这条留言没有发送至政府部门。'],
  ['message.savedAt', '保存时间：'],
  ['message.recordsCategory', '政民互动 · 本地记录'],
  ['message.recordsNotice', '以下记录仅保存在当前浏览器中，不包含真实办理状态。'],
  ['message.empty', '暂无本地留言记录']
].map(([key, previousValue]) => ({ key, previousValue, value: defaultSiteContent.values[key] }));

export function getContentText(content, key) {
  const field = contentFields.find(item => item.key === key);
  if (!field) return '';
  const value = content?.values?.[key];
  return typeof value === 'string' && value.length <= field.maxLength ? value : field.defaultValue;
}
