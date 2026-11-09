/**
 * 力导向知识图谱渲染引擎
 * 纯 Canvas 2D 实现，无第三方依赖
 */

(function () {
  'use strict';

  const COLORS = {
    disease: { main: '#ff5c8a', glow: 'rgba(255, 92, 138, 0.55)', dim: 'rgba(255, 92, 138, 0.14)' },
    gene: { main: '#4db8ff', glow: 'rgba(77, 184, 255, 0.55)', dim: 'rgba(77, 184, 255, 0.14)' },
    drug: { main: '#ffc857', glow: 'rgba(255, 200, 87, 0.55)', dim: 'rgba(255, 200, 87, 0.14)' }
  };

  const TYPE_LABEL = {
    disease: '疾病',
    gene: '基因',
    drug: '药物'
  };

  class KnowledgeGraph {
    constructor(canvas, data, options = {}) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d', { alpha: true });
      this.data = data;
      this.onSelect = options.onSelect || function () {};

      this.nodes = [];
      this.links = [];
      this.hovered = null;
      this.selected = null;
      this.filter = 'all';
      this.searchTerm = '';

      // ---- 设备能力检测 ----
      // 移动端 GPU / CPU 都弱，需要显著降低渲染与计算开销，
      // 否则 2410 节点的力导向图会让浏览器判定「页面无响应」。
      // 用多重判据，任一命中即视为移动端（宁可误判为移动端，也不能漏判）。
      let isMobile = false;
      try {
        isMobile = /Android|iPhone|iPad|iPod|Mobile|Windows Phone|HarmonyOS/i.test(navigator.userAgent)
          || (navigator.maxTouchPoints > 1 && window.innerWidth <= 900)
          || window.innerWidth <= 640;
      } catch (e) {
        isMobile = true;   // 检测失败时保守降级
      }
      this._isMobile = isMobile;

      // 移动端 DPR 限制在 1.5：画布像素量降低约 44%，绘制快很多
      const maxDpr = isMobile ? 1.5 : 2;
      this.dpr = Math.min(window.devicePixelRatio || 1, maxDpr);

      // 移动端帧率节流：不必追 60fps，30fps 足够顺滑且省电
      this._frameInterval = isMobile ? 33 : 16;
      this._lastFrameTime = 0;

      // 移动端自动提高度数阈值，减少可见节点
      this._mobileNodeCap = isMobile ? 180 : Infinity;

      this.width = 0;
      this.height = 0;

      // 视图变换
      this.view = { x: 0, y: 0, scale: 1 };
      this.isDragging = false;
      this.dragStart = null;
      this.dragMoved = false;

      // 物理参数
      this.alpha = 1;
      this.alphaDecay = 0.018;
      this.alphaMin = 0.004;

      this.tickCount = 0;
      this.rafId = null;
      this.particles = [];

      this._resize = this._resize.bind(this);
      this._animate = this._animate.bind(this);

      this.init();
    }

    init() {
      // 先测量尺寸，再建图——建图时的初始坐标依赖真实画布宽高
      this._resize();

      this._buildGraph();
      this._resize(); // 建图后再校准一次

      window.addEventListener('resize', this._resize);
      this._bindEvents();

      // ---- 布局准备 ----
      const n = this.nodes.length;
      const isMobile = this._isMobile;
      const hasPrecomputed =
        this.data.meta && this.data.meta.layout === 'static-radial';

      if (hasPrecomputed) {
        // 数据自带确定性布局坐标（按疾病系统分区的环形布局）
        // 物理模拟完全不需要跑：直接冻结，画面立刻定格。
        this._freezeLayout();
        this.view.x = 0;
        this.view.y = 0;
        this.view.scale = 1;
        this._render();
        this._animate();
        return;
      }

      // ---- 兜底：预跑物理模拟，把布局一次性算好 ----
      // 分批执行避免阻塞主线程（用 setTimeout 而不是 requestIdleCallback，
      // 后者在页面繁忙时可能永不触发）。
      // 步数给足：静态布局只有这一次机会，收敛得越充分越好看
      const warmup = isMobile
        ? (n > 1500 ? 90 : 180)
        : (n > 1500 ? 260 : 400);
      const BATCH = isMobile ? 6 : 16;

      // 让温度衰减更慢，保证足够的迭代次数走得动
      this.alphaDecay = 0.008;

      let done = 0;
      const runBatch = () => {
        try {
          const end = Math.min(done + BATCH, warmup);
          for (; done < end; done++) {
            this._simulate();
            if (this.alpha < this.alphaMin) break;
          }
        } catch (err) {
          console.warn('[graph] warmup step failed', err);
          this._finishWarmup();
          return;
        }

        if (done < warmup && this.alpha >= this.alphaMin) {
          this._warmupTimer = setTimeout(runBatch, 0);
        } else {
          this._finishWarmup();
        }
      };

      // 预热完成后：归一化坐标 → 冻结布局 → 自适应视图
      this._finishWarmup = () => {
        // 把剩余温度一次性耗尽
        this.alpha = 0;

        // ---- 布局后处理：经纬度归一化 + 均匀展开 ----
        try {
          const visible = this.nodes.filter(nd => nd.visible);

          if (visible.length) {
            // 1) 先按可见节点的包围盒做线性映射
            let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
            visible.forEach(nd => {
              minX = Math.min(minX, nd.x);
              maxX = Math.max(maxX, nd.x);
              minY = Math.min(minY, nd.y);
              maxY = Math.max(maxY, nd.y);
            });
            const spanX = Math.max(maxX - minX, 1);
            const spanY = Math.max(maxY - minY, 1);
            const padX = this.width * 0.07;
            const padY = this.height * 0.07;
            const usableW = this.width - padX * 2;
            const usableH = this.height - padY * 2;

            // 保持纵横比地缩放，并居中
            const k = Math.min(usableW / spanX, usableH / spanY);
            const drawW = spanX * k;
            const drawH = spanY * k;
            const offX = padX + (usableW - drawW) / 2;
            const offY = padY + (usableH - drawH) / 2;

            visible.forEach(nd => {
              nd.x = offX + (nd.x - minX) * k;
              nd.y = offY + (nd.y - minY) * k;
            });

            // 2) 二次均衡：把节点从中心向外做轻微径向展开，
            //    避免中间过密、边缘过空。
            const cx0 = this.width / 2;
            const cy0 = this.height / 2;
            const maxR = Math.min(usableW, usableH) / 2;

            visible.forEach(nd => {
              const dx = nd.x - cx0;
              const dy = nd.y - cy0;
              const r = Math.hypot(dx, dy) || 1;
              const nr = maxR * Math.pow(Math.min(r / maxR, 1), 0.88);
              nd.x = cx0 + (dx / r) * nr;
              nd.y = cy0 + (dy / r) * nr;
            });
          }
        } catch (e) {
          console.warn('[graph] normalize failed', e);
        }

        this._freezeLayout();

        // 坐标已铺满画布，视图归位即可
        this.view.x = 0;
        this.view.y = 0;
        this.view.scale = 1;
        this.requestRender();
      };

      this.alpha = Math.max(this.alpha, 0.9);
      runBatch();

      // 立即同步绘制首帧，保证无头截图等场景也能看到图形
      this._render();

      this._animate();
    }

    _buildGraph() {
      const w = this.canvas.clientWidth || 1200;
      const h = this.canvas.clientHeight || 700;
      const cx = w / 2;
      const cy = h / 2;
      const radius = Math.min(w, h) * 0.32;

      // 按画布宽高比拉伸：画布越扁，横向铺得越开，
      // 否则所有节点会挤成一条竖线（边引力把大家往中间拽）。
      const aspect = w / Math.max(h, 1);
      const stretchX = Math.min(Math.max(aspect * 1.5, 1.2), 3.0);

      // 初始化节点位置：三种类型分居三个扇区，有利于形成清晰分簇
      const typeAngles = { disease: -Math.PI / 2, gene: Math.PI / 6, drug: Math.PI * 5 / 6 };
      const typeCounts = { disease: 0, gene: 0, drug: 0 };
      const typeTotals = {
        disease: this.data.nodes.filter(n => n.type === 'disease').length,
        gene: this.data.nodes.filter(n => n.type === 'gene').length,
        drug: this.data.nodes.filter(n => n.type === 'drug').length
      };

      // 一次性统计每个节点的度数（避免对每个节点都遍历全部边导致的 O(n×m)）
      const degreeMap = new Map();
      this.data.links.forEach(l => {
        degreeMap.set(l.source, (degreeMap.get(l.source) || 0) + 1);
        degreeMap.set(l.target, (degreeMap.get(l.target) || 0) + 1);
      });

      // 数据里是否带了预计算布局坐标（静态环形布局）
      const hasPrecomputed =
        this.data.meta && this.data.meta.layout === 'static-radial';
      const LW = hasPrecomputed ? (this.data.meta.layoutWidth || 1400) : 0;
      const LH = hasPrecomputed ? (this.data.meta.layoutHeight || 800) : 0;

      this.nodes = this.data.nodes.map((n, i) => {
        const baseAngle = typeAngles[n.type] ?? 0;
        const idx = typeCounts[n.type]++;
        const total = typeTotals[n.type] || 1;

        // 度数直接查表，O(1)
        const degree = degreeMap.get(n.id) || 0;

        let px;
        let py;

        if (hasPrecomputed && typeof n.x === 'number' && typeof n.y === 'number') {
          // 直接用预计算的静态坐标，按画布尺寸等比映射
          px = (n.x / LW) * w;
          py = (n.y / LH) * h;
        } else {
          // 兜底：分类型 + 分层的径向分布
          const t = total > 1 ? idx / (total - 1) : 0.5;
          const sectorSpan = Math.PI * 0.62;
          const angle = baseAngle + (t - 0.5) * sectorSpan;
          const rings = Math.min(6, Math.max(2, Math.ceil(Math.sqrt(total) / 2)));
          const ringIdx = idx % rings;
          const ringRatio = rings > 1 ? ringIdx / (rings - 1) : 0.5;
          const r = radius * (0.32 + ringRatio * 0.68);
          const jitter = (Math.random() - 0.5) * 0.14;
          px = cx + Math.cos(angle + jitter) * r * stretchX;
          py = cy + Math.sin(angle + jitter) * r;
        }

        return {
          ...n,
          x: px,
          y: py,
          vx: 0,
          vy: 0,
          degree,
          // 球体整体缩小：静态布局下画布已放大，节点不需要那么大
          radius: n.type === 'disease' ? 5.2 + Math.min(degree, 12) * 0.38
                : n.type === 'gene' ? 2.6 + Math.min(degree, 10) * 0.42
                : 3.5 + Math.min(degree, 10) * 0.5,
          baseRadius: 0,
          visible: true,
          opacity: 1
        };
      });

      // 建立 id -> node 映射
      this.nodeMap = new Map(this.nodes.map(n => [n.id, n]));
      this.nodes.forEach(n => { n.baseRadius = n.radius; });

      // 建立链接（引用节点对象）
      this.links = this.data.links
        .map(l => {
          const s = this.nodeMap.get(l.source);
          const t = this.nodeMap.get(l.target);
          if (!s || !t) return null;
          return {
            ...l,
            sourceNode: s,
            targetNode: t,
            opacity: 0.16,
            visible: true
          };
        })
        .filter(Boolean);

      // 邻接表
      this.adjacency = new Map();
      this.nodes.forEach(n => this.adjacency.set(n.id, new Set()));
      this.links.forEach(l => {
        this.adjacency.get(l.source)?.add(l.target);
        this.adjacency.get(l.target)?.add(l.source);
      });

      // 度数筛选：总节点已控制在 1000 左右，默认几乎全部展示
      this.degreeThreshold = 0;
      if (this.nodes.length > 600) {
        const degs = this.nodes.map(n => n.degree).sort((a, b) => b - a);
        // 桌面显示约 700 个（几乎全部），移动端约 300 个
        const target = this._isMobile
          ? Math.min(300, Math.floor(this.nodes.length * 0.35))
          : Math.min(700, Math.floor(this.nodes.length * 0.75));
        const cut = degs[Math.min(target, degs.length - 1)];
        this.degreeThreshold = Math.max(1, cut);
      }

      // 已知名基因白名单（教科书级，如 TP53 / BRCA1 / EGFR）
      // 这些基因即使在低度数时也优先显示，因为它们更容易被理解
      this.famousGenes = new Set();
      this.nodes.forEach(n => {
        if (n.type === 'gene' && n.famous) this.famousGenes.add(n.id);
      });

      // 初始化粒子（沿边流动的光点）
      this._initParticles();

      // 应用初始可见性
      this._updateVisibility();
    }

    _initParticles() {
      this.particles = [];
      // 移动端跳过粒子动画：省下大量绘制调用
      if (this._isMobile) return;
      const particleCount = Math.min(this.links.length * 2, 90);
      for (let i = 0; i < particleCount; i++) {
        const link = this.links[Math.floor(Math.random() * this.links.length)];
        if (!link) continue;
        this.particles.push({
          link,
          t: Math.random(),
          speed: 0.0012 + Math.random() * 0.0028,
          size: 1.1 + Math.random() * 1.5,
          alpha: 0.2 + Math.random() * 0.5
        });
      }
    }

    _resize() {
      // 依次尝试多个尺寸来源：布局盒 → clientWidth → 父元素 → 兜底值
      let w = 0;
      let h = 0;

      const rect = this.canvas.getBoundingClientRect();
      if (rect.width > 10 && rect.height > 10) {
        w = rect.width;
        h = rect.height;
      }
      if (!w && this.canvas.clientWidth > 10) {
        w = this.canvas.clientWidth;
        h = this.canvas.clientHeight;
      }
      if (!w && this.canvas.parentElement) {
        const pr = this.canvas.parentElement.getBoundingClientRect();
        if (pr.width > 10 && pr.height > 10) {
          w = pr.width;
          h = pr.height;
        }
      }
      if (!w) {
        w = Math.min(window.innerWidth || 1280, 1400);
        h = 640;
      }

      this.width = w;
      this.height = h;
      this.canvas.width = Math.round(w * this.dpr);
      this.canvas.height = Math.round(h * this.dpr);
      this.canvas.style.width = w + 'px';
      this.canvas.style.height = h + 'px';
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      // 静态布局：尺寸变化只重绘，不重新激活物理模拟
      if (this.nodes && this.nodes.length) this.requestRender();
    }

    _bindEvents() {
      const c = this.canvas;

      // 鼠标移动：悬停检测
      c.addEventListener('mousemove', (e) => {
        const rect = c.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;

        if (this.isDragging) {
          const dx = mx - this.dragStart.x;
          const dy = my - this.dragStart.y;
          if (Math.abs(dx) > 3 || Math.abs(dy) > 3) this.dragMoved = true;
          this.view.x += dx;
          this.view.y += dy;
          this.dragStart = { x: mx, y: my };
          this.requestRender();
          return;
        }

        const hit = this._hitTest(mx, my);
        if (hit !== this.hovered) {
          this.hovered = hit;
          c.style.cursor = hit ? 'pointer' : 'grab';
          this.requestRender();
        }
      });

      c.addEventListener('mousedown', (e) => {
        const rect = c.getBoundingClientRect();
        this.dragStart = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        this.dragMoved = false;
        this.isDragging = true;
      });

      window.addEventListener('mouseup', (e) => {
        if (!this.isDragging) return;
        this.isDragging = false;

        if (!this.dragMoved) {
          const rect = c.getBoundingClientRect();
          const mx = e.clientX - rect.left;
          const my = e.clientY - rect.top;
          const hit = this._hitTest(mx, my);
          if (hit) {
            this.selectNode(hit);
          } else {
            this.clearSelection();
          }
        }
        c.style.cursor = 'grab';
        this.requestRender();
      });

      c.addEventListener('mouseleave', () => {
        this.hovered = null;
        this.isDragging = false;
      });

      // 滚轮缩放
      c.addEventListener('wheel', (e) => {
        e.preventDefault();
        const rect = c.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;

        const zoomFactor = e.deltaY < 0 ? 1.09 : 0.917;
        const newScale = Math.max(0.32, Math.min(3.2, this.view.scale * zoomFactor));

        // 以鼠标位置为中心缩放
        const ratio = newScale / this.view.scale;
        this.view.x = mx - (mx - this.view.x) * ratio;
        this.view.y = my - (my - this.view.y) * ratio;
        this.view.scale = newScale;
        this.requestRender();
      }, { passive: false });

      // ============ 触摸支持（移动端核心交互）============
      // 要点：
      //   1. 所有触摸事件必须 preventDefault，否则手指拖动会带着整个网页滚动
      //   2. 双指做「捏合缩放」，单指做「拖拽平移」
      //   3. 用 pointer 事件统一处理，兼容性与精度更好
      const getDist = (t1, t2) =>
        Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);

      let touchMode = null;      // 'pan' | 'pinch'
      let panStart = null;
      let pinchStart = null;
      let tapCandidate = null;

      const onTouchStart = (e) => {
        e.preventDefault();

        if (e.touches.length >= 2) {
          // 双指捏合开始
          touchMode = 'pinch';
          const rect = c.getBoundingClientRect();
          pinchStart = {
            dist: getDist(e.touches[0], e.touches[1]),
            scale: this.view.scale,
            // 以两指中点为缩放锚点
            cx: (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left,
            cy: (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top,
            viewX: this.view.x,
            viewY: this.view.y
          };
          tapCandidate = null;
        } else if (e.touches.length === 1) {
          touchMode = 'pan';
          panStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
          tapCandidate = {
            x: e.touches[0].clientX,
            y: e.touches[0].clientY,
            time: Date.now(),
            moved: false
          };
          pinchStart = null;
        }
      };

      const onTouchMove = (e) => {
        e.preventDefault();

        if (touchMode === 'pinch' && e.touches.length >= 2 && pinchStart) {
          const newDist = getDist(e.touches[0], e.touches[1]);
          if (pinchStart.dist < 1) return;
          const ratio = newDist / pinchStart.dist;
          const newScale = Math.max(0.3, Math.min(4.5, pinchStart.scale * ratio));

          // 围绕捏合中点缩放
          const k = newScale / pinchStart.scale;
          this.view.x = pinchStart.cx - (pinchStart.cx - pinchStart.viewX) * k;
          this.view.y = pinchStart.cy - (pinchStart.cy - pinchStart.viewY) * k;
          this.view.scale = newScale;
          this.requestRender();
          return;
        }

        if (touchMode === 'pan' && e.touches.length === 1 && panStart) {
          const dx = e.touches[0].clientX - panStart.x;
          const dy = e.touches[0].clientY - panStart.y;

          if (tapCandidate && (Math.abs(dx) > 6 || Math.abs(dy) > 6)) {
            tapCandidate.moved = true;
          }
          // 位移跟随手指，不乘系数，手感更自然
          this.view.x += dx;
          this.view.y += dy;
          panStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
          this.requestRender();
        }
      };

      const onTouchEnd = (e) => {
        e.preventDefault();

        // 判定为「轻点」：时间短、位移小、单指
        if (tapCandidate && !tapCandidate.moved &&
            Date.now() - tapCandidate.time < 320 &&
            e.touches.length === 0) {
          const rect = c.getBoundingClientRect();
          const mx = tapCandidate.x - rect.left;
          const my = tapCandidate.y - rect.top;
          const hit = this._hitTest(mx, my);
          if (hit) this.selectNode(hit);
          else this.clearSelection();
        }

        if (e.touches.length === 0) {
          touchMode = null;
          panStart = null;
          pinchStart = null;
          tapCandidate = null;
        } else if (e.touches.length === 1) {
          // 从双指松到单指：切换回平移，避免跳变
          touchMode = 'pan';
          panStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
          pinchStart = null;
        }
      };

      // passive: false 是关键：不加就无法 preventDefault
      c.addEventListener('touchstart', onTouchStart, { passive: false });
      c.addEventListener('touchmove', onTouchMove, { passive: false });
      c.addEventListener('touchend', onTouchEnd, { passive: false });
      c.addEventListener('touchcancel', onTouchEnd, { passive: false });

      // 阻止 canvas 上的手势缩放被浏览器接管
      c.addEventListener('gesturestart', (e) => e.preventDefault(), { passive: false });
      c.addEventListener('gesturechange', (e) => e.preventDefault(), { passive: false });
    }

    _hitTest(mx, my) {
      // 从后往前（上层优先），只检测可见节点，取最近的一个
      let best = null;
      let bestDist = Infinity;
      for (let i = this.nodes.length - 1; i >= 0; i--) {
        const n = this.nodes[i];
        if (!n.visible) continue;
        const sx = n.x * this.view.scale + this.view.x;
        const sy = n.y * this.view.scale + this.view.y;
        // 小节点放大点击热区，大规模图谱下更好点中
        const r = Math.max(n.radius * this.view.scale, 5) + 7;
        const dx = mx - sx;
        const dy = my - sy;
        const d2 = dx * dx + dy * dy;
        if (d2 <= r * r && d2 < bestDist) {
          best = n;
          bestDist = d2;
        }
      }
      return best;
    }

    selectNode(node) {
      this.selected = node;
      this.onSelect(node, this._getRelations(node));
      this.requestRender();
    }

    clearSelection() {
      this.selected = null;
      this.onSelect(null, null);
      this.requestRender();
    }

    _getRelations(node) {
      const rels = [];
      this.links.forEach(l => {
        if (l.sourceNode.id === node.id) {
          rels.push({
            node: l.targetNode,
            relation: l.relation,
            evidence: l.evidence,
            strength: l.strength,
            direction: 'out',
            link: l
          });
        } else if (l.targetNode.id === node.id) {
          rels.push({
            node: l.sourceNode,
            relation: l.relation,
            evidence: l.evidence,
            strength: l.strength,
            direction: 'in',
            link: l
          });
        }
      });
      return rels.sort((a, b) => b.strength - a.strength);
    }

    /* ============ 路径查找（BFS 最短路径） ============ */

    findPath(startId, endId) {
      if (startId === endId) return null;
      const start = this.nodeMap.get(startId);
      const end = this.nodeMap.get(endId);
      if (!start || !end) return null;

      // BFS 广度优先，保证是最短路径（按边数）
      const queue = [[startId]];
      const visited = new Set([startId]);
      const parentMap = new Map();

      while (queue.length) {
        const path = queue.shift();
        const current = path[path.length - 1];

        if (current === endId) {
          // 重建路径与边
          const nodes = path.map(id => this.nodeMap.get(id));
          const edges = [];
          for (let i = 0; i < path.length - 1; i++) {
            const link = this.links.find(
              l => (l.sourceNode.id === path[i] && l.targetNode.id === path[i + 1]) ||
                   (l.targetNode.id === path[i] && l.sourceNode.id === path[i + 1])
            );
            if (link) edges.push(link);
          }
          return { nodes, edges, length: path.length - 1 };
        }

        const neighbors = this.adjacency.get(current) || new Set();
        for (const nb of neighbors) {
          if (!visited.has(nb)) {
            visited.add(nb);
            parentMap.set(nb, current);
            queue.push([...path, nb]);
          }
        }
      }
      return null; // 无通路
    }

    /* 高亮一条路径（只改变绘制，不改变布局） */
    highlightPath(path) {
      this.highlightedPath = path;
      this.requestRender();
    }

    clearPath() {
      this.highlightedPath = null;
      this.requestRender();
    }

    /* 视角自适应：让所有可见节点铺满画布 */
    fitView(padding = 80) {
      const visible = this.nodes.filter(n => n.visible);
      if (!visible.length) return;

      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      visible.forEach(n => {
        minX = Math.min(minX, n.x - n.radius);
        maxX = Math.max(maxX, n.x + n.radius);
        minY = Math.min(minY, n.y - n.radius);
        maxY = Math.max(maxY, n.y + n.radius);
      });

      const w = maxX - minX + padding * 2;
      const h = maxY - minY + padding * 2;
      if (w <= 0 || h <= 0) return;

      // 关键：必须能缩小到把所有节点收进视野
      const scale = Math.min(this.width / w, this.height / h);
      const cx2 = (minX + maxX) / 2;
      const cy2 = (minY + maxY) / 2;

      const targetScale = Math.max(0.15, Math.min(2.2, scale));
      const targetX = this.width / 2 - cx2 * targetScale;
      const targetY = this.height / 2 - cy2 * targetScale;

      this._animateView(targetX, targetY, targetScale);
    }

    _animateView(targetX, targetY, targetScale, duration = 520) {
      const sx = this.view.x, sy = this.view.y, ss = this.view.scale;
      const start = performance.now();
      const step = (now) => {
        const t = Math.min((now - start) / duration, 1);
        const ease = 1 - Math.pow(1 - t, 3);
        this.view.x = sx + (targetX - sx) * ease;
        this.view.y = sy + (targetY - sy) * ease;
        this.view.scale = ss + (targetScale - ss) * ease;
        this.requestRender();
        if (t < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }

    focusNode(node) {
      const targetScale = Math.max(this.view.scale, 1.15);
      const targetX = this.width / 2 - node.x * targetScale;
      const targetY = this.height / 2 - node.y * targetScale;
      this._animateView(targetX, targetY, targetScale, 480);
    }

    setFilter(type) {
      this.filter = type;
      this._updateVisibility();
      this.requestRender();
    }

    setSearch(term) {
      this.searchTerm = (term || '').trim().toLowerCase();
      this._updateVisibility();
      this.requestRender();
    }

    _updateVisibility() {
      const famous = this.famousGenes || new Set();

      this.nodes.forEach(n => {
        let visible = true;
        if (this.filter !== 'all' && n.type !== this.filter) visible = false;
        if (visible && this.searchTerm) {
          const hay = (n.name + ' ' + (n.en || '') + ' ' + (n.abbr || '') + ' ' + (n.desc || '')).toLowerCase();
          if (!hay.includes(this.searchTerm)) visible = false;
        }
        // 度数阈值：大规模图谱下隐藏低相关性的边角节点，
        // 但知名基因（TP53/BRCA1 等）例外，它们更容易被理解
        if (visible && this.degreeThreshold > 0 &&
            n.degree < this.degreeThreshold && !famous.has(n.id)) {
          visible = false;
        }
        n.visible = visible;
      });

      this.links.forEach(l => {
        l.visible = l.sourceNode.visible && l.targetNode.visible;
      });
    }

    /* 按度数动态筛选：只保留关联数 >= 阈值的节点 */
    setDegreeThreshold(minDegree) {
      this.degreeThreshold = minDegree;
      this._updateVisibility();
      this.requestRender();
      return this.nodes.filter(n => n.visible).length;
    }

    /* 展开某个节点的所有邻居（增量展开） */
    expandNode(nodeId) {
      const node = this.nodeMap.get(nodeId);
      if (!node) return 0;

      const neighbors = this.adjacency.get(nodeId) || new Set();
      let revealed = 0;

      node.visible = this.filter === 'all' || node.type === this.filter;
      neighbors.forEach(nbId => {
        const nb = this.nodeMap.get(nbId);
        if (nb && !nb.visible) {
          nb.visible = this.filter === 'all' || nb.type === this.filter;
          if (nb.visible) revealed++;
        }
      });

      this.links.forEach(l => {
        l.visible = l.sourceNode.visible && l.targetNode.visible;
      });

      if (revealed) this.requestRender();
      return revealed;
    }

    /* 统计当前可见节点数 */
    getVisibleCount() {
      return this.nodes.filter(n => n.visible).length;
    }

    resetView() {
      // 只重置视角，不动布局
      this._animateView(0, 0, 1, 460);
    }

    /* ============ 物理模拟 ============ */

    /* 精确斥力：节点少时使用，结果最准确 */
    _repulsionExact(nodes) {
      const k = 5200 * (this._repulsionScale || 1);
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j];
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          let dist2 = dx * dx + dy * dy;
          if (dist2 < 1) { dist2 = 1; }
          if (dist2 > 360000) continue; // 600px 外忽略

          const dist = Math.sqrt(dist2);
          const force = (k * this.alpha) / dist2;
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;

          a.vx -= fx; a.vy -= fy;
          b.vx += fx; b.vy += fy;
        }
      }
    }

    /* Barnes-Hut 近似斥力：节点多时使用，O(n log n) */
    _repulsionBarnesHut(nodes) {
      if (!window.BarnesHutTree) {
        // 兜底：四叉树未加载时退化为精确算法（会慢但不会错）
        this._repulsionExact(nodes);
        return;
      }

      // 世界边界略大于画布，容纳飞出范围的节点
      const pad = 1200;
      const w = this.width + pad * 2;
      const h = this.height + pad * 2;
      const offsetX = -pad;
      const offsetY = -pad;

      // 建树用的代理点（坐标平移 + 索引），避免改动原始节点
      const proxies = nodes.map((n, i) => ({
        node: n,
        idx: i,
        x: n.x - offsetX,
        y: n.y - offsetY
      }));

      const tree = window.BarnesHutTree.build(proxies, w, h);

      const scale = this._repulsionScale || 1;
      for (let i = 0; i < proxies.length; i++) {
        window.BarnesHutTree.applyRepulsion(proxies[i], tree, this.alpha, scale);
      }
    }

    _simulate() {
      if (this.alpha < this.alphaMin) return;

      const nodes = this.nodes;
      const cx = this.width / 2;
      const cy = this.height / 2;

      // 大图需要更强斥力才能把节点推开，但过强会把节点弹飞。
      // 静态布局下取中间值，配合 fitView 缩放收进画布。
      const n = nodes.length;
      this._repulsionScale = n > 1500 ? 1.6 : (n > 500 ? 1.35 : 1.1);

      // ---- 斥力 ----
      // 节点数少时用精确的 O(n²)，多时切换到 Barnes-Hut 的 O(n log n)
      if (n <= 260) {
        this._repulsionExact(nodes);
      } else {
        this._repulsionBarnesHut(nodes);
      }

      // 各向异性铺展：宽画布下横向推得更用力，
      // 抵消边引力把整团节点拉成竖条的倾向。
      const aspectBoost = Math.min(this.width / Math.max(this.height, 1), 2.5);
      if (aspectBoost > 1.1) {
        const kx = (aspectBoost - 1) * 0.55;
        for (let i = 0; i < n; i++) {
          const nd = nodes[i];
          const dx = nd.x - cx;
          nd.vx += Math.sign(dx || (Math.random() - 0.5)) * Math.abs(dx / this.width) * kx * this.alpha;
        }
      }

      // 引力（沿边）
      // 静态布局追求「舒展」而非「紧凑」，所以边引力要弱、目标距离要大，
      // 否则所有节点会被拉成密集的一团。
      this.links.forEach(l => {
        const a = l.sourceNode;
        const b = l.targetNode;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        // 目标边距放大，强关联略近
        const targetDist = 240 - Math.min(l.strength, 10) * 10;
        // 引力系数调低，让斥力主导分布
        const force = ((dist - targetDist) / dist) * 0.018 * this.alpha;
        const fx = dx * force;
        const fy = dy * force;

        a.vx += fx; a.vy += fy;
        b.vx -= fx; b.vy -= fy;
      });

      // 簇内聚：同类型节点相互吸引，形成清晰的三簇
      const typeCenters = this._typeCenters || (this._typeCenters = {});
      ['disease', 'gene', 'drug'].forEach(t => {
        const group = nodes.filter(n => n.type === t);
        if (!group.length) return;
        let mx = 0, my = 0;
        group.forEach(n => { mx += n.x; my += n.y; });
        mx /= group.length; my /= group.length;
        typeCenters[t] = { x: mx, y: my };
      });

      nodes.forEach(n => {
        const c = typeCenters[n.type];
        if (!c) return;
        n.vx += (c.x - n.x) * 0.0018 * this.alpha;
        n.vy += (c.y - n.y) * 0.0018 * this.alpha;
      });

      // 向心力（保持在画布中心，但力度要小，否则会挤成一团）
      nodes.forEach(n => {
        n.vx += (cx - n.x) * 0.0012 * this.alpha;
        n.vy += (cy - n.y) * 0.0012 * this.alpha;
      });

      // 应用速度 + 阻尼
      const MAX_V = 22;   // 速度上限，防止数值爆炸
      const cxPad = this.width * 0.5;
      const cyPad = this.height * 0.5;
      // 软边界：允许节点适度超出可视区，越界越深回拉越强。
      // 硬截断会把节点压成贴边的「条带」，是之前布局难看的根源。
      // 横向给更大范围，避免画布宽而节点堆成竖条。
      const SOFT_RX = this.width * 0.72;
      const SOFT_RY = this.height * 0.55;
      // 硬上限：无论如何不能飞出这个范围（兜底，防意外）
      const HARD_RX = this.width * 1.6;
      const HARD_RY = this.height * 1.6;

      nodes.forEach(n => {
        // 速度钳制
        if (n.vx > MAX_V) n.vx = MAX_V;
        else if (n.vx < -MAX_V) n.vx = -MAX_V;
        if (n.vy > MAX_V) n.vy = MAX_V;
        else if (n.vy < -MAX_V) n.vy = -MAX_V;

        // 软边界回拉：按超出比例的平方递增，越远拽得越狠
        const dx = n.x - cxPad;
        const dy = n.y - cyPad;
        const overX = Math.abs(dx) - SOFT_RX;
        const overY = Math.abs(dy) - SOFT_RY;

        if (overX > 0) {
          const t = Math.min(overX / SOFT_RX, 1.5);
          n.vx -= Math.sign(dx) * t * t * 14.0;
        }
        if (overY > 0) {
          const t = Math.min(overY / SOFT_RY, 1.5);
          n.vy -= Math.sign(dy) * t * t * 14.0;
        }

        n.vx *= 0.86;
        n.vy *= 0.86;
        n.x += n.vx;
        n.y += n.vy;

        // 硬上限兜底
        if (Math.abs(n.x - cxPad) > HARD_RX) {
          n.x = cxPad + Math.sign(n.x - cxPad) * HARD_RX;
          n.vx = 0;
        }
        if (Math.abs(n.y - cyPad) > HARD_RY) {
          n.y = cyPad + Math.sign(n.y - cyPad) * HARD_RY;
          n.vy = 0;
        }
      });

      this.alpha -= this.alpha * this.alphaDecay;
      this.tickCount++;
    }

    /* ============ 渲染 ============ */

    /*
     * 静态布局模式：
     *   布局在初始化阶段一次算好，之后永久冻结，节点不再漂移。
     *   渲染也只在「需要重绘」时才画（悬停、选中、缩放、平移、路径高亮），
     *   其余时间完全静止，既好看又不耗电。
     */
    _animate(now) {
      this.rafId = requestAnimationFrame(this._animate);

      // 布局已收敛：不再做物理计算
      if (this._layoutFrozen) {
        // 只有被标记为需要重绘时才画一帧
        if (this._needsRender) {
          this._needsRender = false;
          this._render();
        }
        return;
      }

      // 帧率节流
      if (this._frameInterval > 16) {
        if (!now) now = performance.now();
        if (now - this._lastFrameTime < this._frameInterval) return;
        this._lastFrameTime = now;
      }

      if (document.hidden) return;

      this._simulate();
      this._render();

      // 温度降到阈值以下 → 冻结布局
      if (this.alpha < this.alphaMin) {
        this._freezeLayout();
      }
    }

    /* 立即冻结当前布局（停止所有物理计算） */
    _freezeLayout() {
      if (this._layoutFrozen) return;
      this._layoutFrozen = true;
      this.alpha = 0;
      // 速度清零，确保画面上绝不会有残余抖动
      this.nodes.forEach(n => { n.vx = 0; n.vy = 0; });
      this._needsRender = true;
    }

    /* 请求重绘（不改变布局） */
    requestRender() {
      this._needsRender = true;
    }

    _render() {
      const ctx = this.ctx;
      const { width, height, view } = this;

      ctx.clearRect(0, 0, width, height);

      ctx.save();
      ctx.translate(view.x, view.y);
      ctx.scale(view.scale, view.scale);

      const selId = this.selected ? this.selected.id : null;
      const neighbors = selId ? this.adjacency.get(selId) : null;
      const hoverId = this.hovered ? this.hovered.id : null;
      const hoverNeighbors = hoverId ? this.adjacency.get(hoverId) : null;

      // 路径高亮集合
      const pathNodeIds = this.highlightedPath
        ? new Set(this.highlightedPath.nodes.map(n => n.id))
        : null;
      const pathLinkSet = this.highlightedPath
        ? new Set(this.highlightedPath.edges)
        : null;
      const hasPath = !!pathNodeIds;

      // ---- 1. 绘制连线 ----
      this.links.forEach(l => {
        if (!l.visible) return;

        const a = l.sourceNode;
        const b = l.targetNode;

        // 视野裁剪：两端都在屏幕外则跳过
        const ax = a.x * view.scale + view.x;
        const ay = a.y * view.scale + view.y;
        const bx = b.x * view.scale + view.x;
        const by = b.y * view.scale + view.y;
        const m = 40;
        if ((ax < -m && bx < -m) || (ax > width + m && bx > width + m) ||
            (ay < -m && by < -m) || (ay > height + m && by > height + m)) {
          return;
        }

        const isHovered = hoverId && (a.id === hoverId || b.id === hoverId);
        const inPath = pathLinkSet && pathLinkSet.has(l);
        const isHighlighted = selId && (a.id === selId || b.id === selId);

        let alpha;
        let strokeW;

        if (hasPath) {
          // 有路径时：路径上的边极亮，其它全部压暗
          alpha = inPath ? 0.95 : 0.045;
          strokeW = inPath ? 3.2 : 0.7;
        } else if (selId) {
          alpha = isHighlighted ? 0.78 : 0.04;
          strokeW = isHighlighted ? 2.0 + l.strength * 0.16 : 0.8 + l.strength * 0.08;
        } else if (hoverId) {
          alpha = isHovered ? 0.55 : 0.06;
          strokeW = isHovered ? 2.0 + l.strength * 0.16 : 0.8 + l.strength * 0.08;
        } else {
          // 常态连线：整体调淡，避免画面被线条填满，突出节点与标签
          alpha = 0.10 + Math.min(l.strength, 10) / 10 * 0.12;
          strokeW = 0.6 + l.strength * 0.06;
        }

        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        // 轻微曲线让图更有层次
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const curve = 0.06;
        ctx.quadraticCurveTo(mx - dy * curve, my + dx * curve, b.x, b.y);

        // 路径边：先画一层发光底，再画实线
        if (inPath) {
          ctx.save();
          ctx.shadowColor = 'rgba(62, 232, 196, 0.9)';
          ctx.shadowBlur = 16;
          ctx.strokeStyle = 'rgba(62, 232, 196, 0.95)';
          ctx.lineWidth = strokeW;
          ctx.stroke();
          ctx.restore();
          ctx.save();
          ctx.strokeStyle = 'rgba(210, 255, 245, 0.95)';
          ctx.lineWidth = Math.max(1.2, strokeW * 0.45);
          ctx.stroke();
          ctx.restore();
        } else if (isHighlighted) {
          const grad = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
          const ca = COLORS[a.type]?.main || '#3ee8c4';
          const cb = COLORS[b.type]?.main || '#3ee8c4';
          grad.addColorStop(0, this._hexAlpha(ca, alpha));
          grad.addColorStop(1, this._hexAlpha(cb, alpha));
          ctx.strokeStyle = grad;
          ctx.lineWidth = strokeW;
          ctx.stroke();
        } else {
          ctx.strokeStyle = `rgba(120, 170, 220, ${alpha})`;
          ctx.lineWidth = strokeW;
          ctx.stroke();
        }
      });

      // ---- 2. 连线上的静态光点 ----
      // 静态布局模式下不做动画：每个粒子固定在边上某个位置，
      // 只作为装饰性光点，不会流动。
      if (!selId && !hasPath) {
        this.particles.forEach(p => {
          if (!p.link.visible) return;

          const a = p.link.sourceNode;
          const b = p.link.targetNode;
          const px = a.x + (b.x - a.x) * p.t;
          const py = a.y + (b.y - a.y) * p.t;

          ctx.beginPath();
          ctx.arc(px, py, p.size, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(62, 232, 196, ${p.alpha * 0.55})`;
          ctx.fill();
        });
      }

      // ---- 3. 绘制节点 ----
      // 排序策略：疾病优先（标签先占位），然后基因，最后选中的置顶。
      // 这样标签防重叠时，疾病名不会被基因名挤掉。
      const sorted = [...this.nodes].sort((a, b) => {
        const aScore = (a.id === selId ? 3 : 0) + (a.id === hoverId ? 2 : 0)
                     + (a.type === 'disease' ? 1 : 0);
        const bScore = (b.id === selId ? 3 : 0) + (b.id === hoverId ? 2 : 0)
                     + (b.type === 'disease' ? 1 : 0);
        return aScore - bScore;
      });

      // 标签占用区域，用于防重叠
      const labelBoxes = [];

      sorted.forEach(n => {
        if (!n.visible) return;

        // ---- LOD 视口裁剪 ----
        // 把节点坐标换算到屏幕坐标，视野外的直接跳过（大幅减少绘制开销）
        const screenX = n.x * view.scale + view.x;
        const screenY = n.y * view.scale + view.y;
        const screenR = n.radius * view.scale;
        const margin = 60;
        if (screenX < -margin || screenX > width + margin ||
            screenY < -margin || screenY > height + margin) {
          return;
        }
        // 极小时不画发光层（细节不可见，省 GPU）
        const tinyNode = screenR < 2.6;

        const color = COLORS[n.type] || COLORS.gene;
        const isSel = n.id === selId;
        const isHov = n.id === hoverId;
        const inPath = pathNodeIds && pathNodeIds.has(n.id);
        const isNeighbor = (neighbors && neighbors.has(n.id)) || (hoverNeighbors && hoverNeighbors.has(n.id));

        // 有路径高亮时，非路径节点全部压暗
        const dimmed = hasPath
          ? !inPath
          : (selId && !isSel && !(neighbors && neighbors.has(n.id)));

        let radius = n.radius;
        if (isSel) radius *= 1.42;
        else if (isHov) radius *= 1.24;
        else if (inPath) radius *= 1.18;

        ctx.globalAlpha = dimmed ? (hasPath ? 0.1 : 0.16) : 1;

        // 外发光（极小节点跳过，节省开销）
        if (tinyNode && !inPath && !isSel) {
          // 只画一个纯色小圆
          ctx.beginPath();
          ctx.arc(n.x, n.y, radius, 0, Math.PI * 2);
          ctx.fillStyle = color.main;
          ctx.fill();
          ctx.globalAlpha = 1;
          return;
        }

        if (inPath) {
          const glowR = radius * 3.6;
          const g = ctx.createRadialGradient(n.x, n.y, radius * 0.5, n.x, n.y, glowR);
          g.addColorStop(0, 'rgba(62, 232, 196, 0.55)');
          g.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.beginPath();
          ctx.arc(n.x, n.y, glowR, 0, Math.PI * 2);
          ctx.fillStyle = g;
          ctx.fill();
        } else if (isSel || isHov || isNeighbor) {
          const glowR = radius * (isSel ? 3.4 : 2.4);
          const g = ctx.createRadialGradient(n.x, n.y, radius * 0.5, n.x, n.y, glowR);
          g.addColorStop(0, color.glow);
          g.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.beginPath();
          ctx.arc(n.x, n.y, glowR, 0, Math.PI * 2);
          ctx.fillStyle = g;
          ctx.fill();
        } else {
          const glowR = radius * 1.9;
          const g = ctx.createRadialGradient(n.x, n.y, radius * 0.4, n.x, n.y, glowR);
          g.addColorStop(0, color.dim);
          g.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.beginPath();
          ctx.arc(n.x, n.y, glowR, 0, Math.PI * 2);
          ctx.fillStyle = g;
          ctx.fill();
        }

        // 主体圆
        const grad = ctx.createRadialGradient(
          n.x - radius * 0.32, n.y - radius * 0.32, radius * 0.12,
          n.x, n.y, radius
        );
        grad.addColorStop(0, this._lighten(color.main, 0.42));
        grad.addColorStop(0.65, color.main);
        grad.addColorStop(1, this._darken(color.main, 0.32));

        ctx.beginPath();
        ctx.arc(n.x, n.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = grad;
        ctx.fill();

        // 描边
        if (inPath) {
          ctx.strokeStyle = '#7dffe0';
          ctx.lineWidth = 2.8;
        } else {
          ctx.strokeStyle = isSel ? '#ffffff' : this._hexAlpha(color.main, 0.85);
          ctx.lineWidth = isSel ? 2.4 : 1.1;
        }
        ctx.stroke();

        // 选中标记：静态双环（不做脉冲动画，避免画面持续抖动）
        if (isSel) {
          ctx.beginPath();
          ctx.arc(n.x, n.y, radius * 1.55, 0, Math.PI * 2);
          ctx.strokeStyle = this._hexAlpha(color.main, 0.4);
          ctx.lineWidth = 1.4;
          ctx.stroke();

          ctx.beginPath();
          ctx.arc(n.x, n.y, radius * 1.9, 0, Math.PI * 2);
          ctx.strokeStyle = this._hexAlpha(color.main, 0.16);
          ctx.lineWidth = 1;
          ctx.stroke();
        }

        // 标签显示策略
        // 静态布局下画面不缩放，所以按「绝对可读性」判断：
        // 疾病名几乎总是显示（它们是骨架），基因名只在节点足够大时显示。
        const scale = view.scale;
        let showLabel;
        if (inPath || isSel || isHov) {
          showLabel = true;
        } else if (n.type === 'disease') {
          // 疾病节点：屏幕上半径够大就显示名字
          showLabel = screenR >= 4.5;
        } else if (n.type === 'gene') {
          // 基因节点：只有度数很高或放大后才显示
          showLabel = (n.degree >= 10 && screenR >= 5) || scale > 1.6;
        } else {
          showLabel = screenR >= 5;
        }

        if (showLabel) {
          const fontSize = Math.max(9.5, 11.5 / Math.max(view.scale, 0.65));
          ctx.font = `600 ${fontSize}px "Inter", "Noto Sans SC", sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';

          const labelY = n.y + radius + 7 / view.scale;
          const text = n.name;

          // ---- 标签防重叠 ----
          // 记录已绘制标签的包围盒，重叠时跳过（选中/悬停的强制绘制）
          if (!isSel && !isHov && !inPath && labelBoxes) {
            const tw = ctx.measureText(text).width;
            const box = {
              x1: n.x - tw / 2,
              x2: n.x + tw / 2,
              y1: labelY,
              y2: labelY + fontSize
            };
            let clash = false;
            for (let bi = 0; bi < labelBoxes.length; bi++) {
              const b = labelBoxes[bi];
              if (!(box.x2 < b.x1 || box.x1 > b.x2 || box.y2 < b.y1 || box.y1 > b.y2)) {
                clash = true;
                break;
              }
            }
            if (clash) {
              ctx.globalAlpha = 1;
              return;
            }
            labelBoxes.push(box);
          }

          // 文字描边保证可读
          ctx.strokeStyle = 'rgba(5, 8, 15, 0.92)';
          ctx.lineWidth = 3.2;
          ctx.lineJoin = 'round';
          ctx.strokeText(text, n.x, labelY);

          ctx.fillStyle = (isSel || inPath) ? '#ffffff'
                        : (dimmed ? 'rgba(232,240,251,0.3)' : 'rgba(232,240,251,0.9)');
          ctx.fillText(text, n.x, labelY);
        }

        ctx.globalAlpha = 1;
      });

      ctx.restore();
    }

    /* ============ 颜色工具 ============ */

    _hexAlpha(hex, alpha) {
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    _lighten(hex, amt) {
      const r = Math.min(255, Math.round(parseInt(hex.slice(1, 3), 16) + 255 * amt));
      const g = Math.min(255, Math.round(parseInt(hex.slice(3, 5), 16) + 255 * amt));
      const b = Math.min(255, Math.round(parseInt(hex.slice(5, 7), 16) + 255 * amt));
      return `rgb(${r}, ${g}, ${b})`;
    }

    _darken(hex, amt) {
      const r = Math.max(0, Math.round(parseInt(hex.slice(1, 3), 16) * (1 - amt)));
      const g = Math.max(0, Math.round(parseInt(hex.slice(3, 5), 16) * (1 - amt)));
      const b = Math.max(0, Math.round(parseInt(hex.slice(5, 7), 16) * (1 - amt)));
      return `rgb(${r}, ${g}, ${b})`;
    }

    destroy() {
      if (this.rafId) cancelAnimationFrame(this.rafId);
      window.removeEventListener('resize', this._resize);
    }
  }

  window.KnowledgeGraph = KnowledgeGraph;
  window.GRAPH_COLORS = COLORS;
  window.GRAPH_TYPE_LABEL = TYPE_LABEL;
})();
