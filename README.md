# BiomedKG · 生物医学知识图谱

> 医学人工智能课程作业 —— 基于真实数据库的疾病-基因关联知识图谱可视化平台

一个**纯静态、零框架依赖**的交互式知识图谱网站，数据来自 Open Targets Platform 真实数据库。

在线访问：**http://47.99.114.48**

---

## 项目亮点

- **2410 个真实知识节点** — 114 种疾病 × 2296 个基因，覆盖 11 大疾病系统
- **4536 条真实关联** — 每条边都带 Open Targets 相关性评分与证据
- **Barnes-Hut 四叉树** — 把力导向布局从 O(n²) 优化到 O(n log n)，5000 节点仍可 60fps
- **零依赖** — 原生 HTML + CSS + Canvas，不打包、不装 node_modules
- **移动端适配** — 触摸手势、双指缩放、底部抽屉、自动性能降级

---

## 功能

### 知识图谱（核心）

- **力导向布局**：疾病节点大而醒目，基因节点小而密集，自动成簇
- **交互**：拖拽平移、滚轮/双指缩放、点击节点展开详情
- **度数筛选**：按关联数过滤，默认显示 391 个核心节点（移动端 122 个）
- **路径查找**：BFS 最短路径算法，任选两节点展示完整关联链并高亮
- **实时高亮**：悬停/选中时相关节点与边高亮，无关的自动淡化

### 全局查找（`Ctrl + K`）

- 智能模糊匹配：支持中文名、英文名、缩写、描述内容
- 加权排序：完全匹配 > 前缀 > 包含 > 描述命中
- 按疾病/基因自动分组，键盘导航（`↑↓` 选择，`Enter` 定位）

### 疾病对比

选择两种疾病，自动分析：
- 各自的关联基因
- **共同基因**（共享的分子基础）
- 提示可能存在的共同治疗靶点

### 数据统计

- 节点类型分布环形图
- 枢纽节点 Top 8 排行（按关联数）
- 关系类型分布柱状图

---

## 数据来源

| 数据源 | 用途 | 链接 |
|---|---|---|
| **Open Targets Platform** | 疾病-基因关联、疾病元信息 | [platform.opentargets.org](https://platform.opentargets.org) |
| **MONDO 本体** | 疾病标准分类与 ID | [monarch-initiative/mondo](https://github.com/monarch-initiative/mondo) |
| DisGeNET / DrugBank / ClinVar | 参考对照 | — |

### 数据规模

```
疾病    114 种（覆盖 11 大系统）
基因   2296 个
关联   4536 条（带相关性评分 0–1）
```

**疾病覆盖范围**：肿瘤 20 种、代谢内分泌 8 种、心血管 10 种、神经 8 种、精神 6 种、呼吸 5 种、消化 9 种、免疫风湿 6 种、泌尿 4 种、眼科 4 种、感染 8 种。

---

## 技术实现

### 架构

```
纯静态前端
├── index.html          页面结构
├── css/style.css       样式（深色科技感 + 移动端适配）
├── js/
│   ├── barnes-hut.js   四叉树（O(n log n) 斥力计算）
│   ├── graph.js        力导向渲染引擎
│   ├── extras.js       查找 / 路径 / 统计 / 对比
│   ├── main.js         主逻辑与状态管理
│   └── layout3d.js     3D 布局（可选，未启用）
└── data/
    └── graph-data.js   知识图谱数据
```

**服务器端**：只有 nginx 托管静态文件，无任何后端进程（不使用 Python/Node/数据库）。

### Barnes-Hut 算法

力导向布局的核心是节点斥力计算，朴素实现是 O(n²)：

```
5000 节点 → 12,497,500 次/帧  ← 直接卡死
```

Barnes-Hut 用四叉树把远处节点聚合为质心，降到 O(n log n)：

| 节点数 | 精确算法 | Barnes-Hut | 加速 |
|---|---|---|---|
| 1000 | 6.9 ms | 2.6 ms | 2.6x |
| 2000 | 22.7 ms | 2.4 ms | 9.5x |
| 5000 | 85.9 ms | 5.6 ms | 15.4x |

### 性能优化清单

| 优化 | 说明 |
|---|---|
| **四叉树** | 斥力 O(n²) → O(n log n) |
| **视口裁剪** | 屏幕外节点/边不绘制 |
| **LOD 分层** | 小节点跳过发光层 |
| **软边界约束** | 渐进回拉替代硬截断，避免节点挤成边框条带 |
| **度数预计算** | 避免 O(n×m) 的重复遍历 |
| **移动端降级** | DPR 减半、节点数 1/3、关闭粒子、30fps 节流 |
| **异步预热** | 物理模拟分批执行，不阻塞主线程 |

---

## 本地运行

项目是纯静态的，但**必须通过 HTTP 访问**（`file://` 协议下模块加载会被 CORS 拦截）：

```bash
# 方式一：Python
cd src
python -m http.server 8080

# 方式二：Node
npx serve src
```

然后打开 `http://localhost:8080`

---

## 重新抓取数据

```bash
cd scripts

# 1. 从 Open Targets 抓取原始数据（约 8 分钟，114 个疾病）
python fetch_opentargets.py

# 2. 转换为前端格式
python convert_data.py
```

抓取脚本会生成 `raw-opentargets.json`，转换后输出到 `src/data/graph-data.js`。

**扩展数据**：修改 `fetch_opentargets.py` 里的 `COMMON_DISEASES` 列表即可，每个疾病默认取 40 个关联靶点。

---

## 部署

```bash
# 上传到服务器
scp -r src/* root@your-server:/var/www/medical-kg/

# nginx 配置
server {
    listen 80;
    root /var/www/medical-kg;
    index index.html;

    gzip on;
    gzip_types text/css application/javascript application/json;

    location = /index.html {
        add_header Cache-Control "no-cache";
    }
}
```

服务器资源占用：**nginx 约 27MB 内存**，站点文件约 1.1MB。

---

## 浏览器支持

| 浏览器 | 状态 |
|---|---|
| Chrome / Edge（桌面） | ✅ 完整支持 |
| Safari（桌面） | ✅ 完整支持 |
| Chrome（Android） | ✅ 完整支持 |
| Safari（iOS） | ✅ 完整支持 |
| Edge（Android） | ⚠️ 需较新版本 |

---

## 已知限制

- **药物节点为 0**：当前数据只抓取了疾病-基因关联，药物层待补充
- **移动端只显示 122 个节点**：手机屏幕限制下的主动取舍，可在筛选器调整
- **数据非实时**：Open Targets 数据定期更新，本地为快照

---

## 许可证

MIT

数据版权归 Open Targets Platform 及各原始数据库所有，本项目仅用于教学演示，**不构成任何医疗建议**。
