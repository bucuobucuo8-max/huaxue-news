/* =========================
   新闻数据区:后续只改这里即可替换新闻
   ========================= */
const CATEGORY_LABEL = {
  award: "奖项",
  product: "产品",
  company: "公司",
  research: "研究"
};

const NEWS = [
  {
    time: "09:40",
    type: "award",
    title: "2026 年诺贝尔化学奖授予点击化学与生物正交化学方向",
    summary: "奖项表彰三位科学家在高效分子连接与活体兼容反应上的奠基贡献。委员会认为相关工具已显著改变药物标记、材料改性与化学生物学实验方式。",
    source: "Nobel Prize",
    url: "https://www.nobelprize.org/prizes/chemistry/",
    important: true
  },
  {
    time: "09:05",
    type: "research",
    title: "单原子催化剂在温和条件下实现高效甲烷活化",
    summary: "研究团队通过载体缺陷调控稳定孤立金属位点，在低温区间内提升 C-H 键活化选择性。作者称该策略有望降低天然气转化过程的能耗与副反应。",
    source: "Nature Chemistry",
    url: "https://www.nature.com/nchem/",
    important: true
  },
  {
    time: "08:48",
    type: "company",
    title: "巴斯夫宣布新一代低碳裂解装置进入中试阶段",
    summary: "公司表示新装置将电加热与催化剂再生流程耦合，目标是把基础烯烃生产碳排放继续下移。中试数据将用于评估未来十年欧洲化工园区改造路线。",
    source: "BASF",
    url: "https://www.basf.com/global/en/media/news-releases",
    important: false
  },
  {
    time: "08:20",
    type: "product",
    title: "陶氏推出可回收交联聚乙烯包装材料",
    summary: "新材料在保持耐热与阻隔性能的同时，可通过现有回收流进行再加工。品牌方试点将覆盖食品软包装与工业缠绕膜两类高频场景。",
    source: "Dow",
    url: "https://www.dow.com/en-us/news/press-releases.html",
    important: false
  },
  {
    time: "07:56",
    type: "research",
    title: "固态电解质界面离子传输成像取得新进展",
    summary: "研究人员利用原位显微谱学追踪晶界附近离子迁移路径，观察到局部应力与传输阻塞的直接关联。该结果为高倍率固态电池界面设计提供了新的结构依据。",
    source: "Science",
    url: "https://www.science.org/journal/science",
    important: true
  },
  {
    time: "07:31",
    type: "company",
    title: "药明康德扩建连续流化学工艺开发平台",
    summary: "新增平台将面向高危反应、强放热反应与光化学转化提供更小持液量的工艺验证。公司称连续流方案可缩短从路线确认到安全放大的衔接周期。",
    source: "WuXi AppTec",
    url: "https://www.wuxiapptec.com/news",
    important: false
  },
  {
    time: "07:05",
    type: "award",
    title: "ACS 授予绿色化学挑战奖给无溶剂聚合工艺团队",
    summary: "获奖工艺以减少溶剂使用和降低纯化负担为核心亮点。评审意见提到，该路线在实验室放大与工业废水减量之间取得了较好的平衡。",
    source: "American Chemical Society",
    url: "https://www.acs.org/content/acs/en/pressroom.html",
    important: false
  },
  {
    time: "06:42",
    type: "product",
    title: "科思创发布生物基聚碳酸酯薄膜新品",
    summary: "新品面向电子显示与汽车内饰表面保护，强调低黄变与耐刮擦。官方资料称部分原料来自质量平衡认证的生物基供应链。",
    source: "Covestro",
    url: "https://www.covestro.com/en/news",
    important: false
  },
  {
    time: "06:18",
    type: "research",
    title: "光驱动二氧化碳还原体系实现更长稳定运行",
    summary: "团队通过分子催化剂锚定与界面亲水疏水平衡，减缓了活性位点失活。连续测试显示产物选择性保持时间较此前体系明显延长。",
    source: "MIT News",
    url: "https://news.mit.edu/topic/chemistry",
    important: false
  },
  {
    time: "05:55",
    type: "company",
    title: "LG 化学与电池材料伙伴签署锂盐供应备忘录",
    summary: "双方计划围绕高纯度锂盐提纯、杂质控制和海外产能协同展开合作。公告强调供应稳定性将优先服务于下一代高镍体系。",
    source: "LG Chem",
    url: "https://www.lgchem.com/main/index",
    important: false
  }
];
