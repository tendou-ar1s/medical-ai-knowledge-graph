/**
 * 主控制逻辑：图谱初始化、详情面板、交互、动画
 */

(function () {
  'use strict';

  const TYPE_CONFIG = {
    disease: { label: '疾病', color: '#ff5c8a', bg: 'rgba(255, 92, 138, 0.14)' },
    gene: { label: '基因', color: '#4db8ff', bg: 'rgba(77, 184, 255, 0.14)' },
    drug: { label: '药物', color: '#ffc857', bg: 'rgba(255, 200, 87, 0.14)' }
  };

  let graph = null;

  /* ============ 数字滚动动画 ============ */
  function animateCounters() {
    document.querySelectorAll('[data-count]').forEach(el => {
      const target = parseInt(el.dataset.count, 10);
      const duration = 1600;
      const start = performance.now();

      function step(now) {
        const t = Math.min((now - start) / duration, 1);
        const ease = 1 - Math.pow(1 - t, 3);
        el.textContent = Math.round(target * ease);
        if (t < 1) requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    });
  }

  /* ============ 用真实数据同步页面上所有统计数字 ============ */
  function syncCounts() {
    if (!window.GRAPH_DATA) return;
    const d = window.GRAPH_DATA;

    const counts = { disease: 0, gene: 0, drug: 0 };
    d.nodes.forEach(n => { if (counts[n.type] != null) counts[n.type]++; });

    // 疾病分类数（按 category 字段统计）
    const categories = new Set();
    d.nodes.forEach(n => {
      if (n.type === 'disease' && n.category) categories.add(n.category);
    });

    // Hero 四项统计：节点 / 关联 / 疾病 / 分类
    const heroNums = document.querySelectorAll('.hero__stat-num');
    if (heroNums.length >= 4) {
      heroNums[0].dataset.count = d.nodes.length;
      heroNums[1].dataset.count = d.links.length;
      heroNums[2].dataset.count = counts.disease;
      heroNums[3].dataset.count = categories.size || 4;
    }

    // 筛选器计数
    const chipCounts = { all: d.nodes.length, disease: counts.disease, gene: counts.gene, drug: counts.drug };
    document.querySelectorAll('.filter-chip').forEach(chip => {
      const c = chip.querySelector('.filter-chip__count');
      if (c) c.textContent = chipCounts[chip.dataset.filter] ?? 0;
    });

    // 环形图中心数
    const donutNum = document.querySelector('.donut-center__num');
    if (donutNum) donutNum.textContent = d.nodes.length;

    // 环形图图例数值（只更新实际存在的项）
    const legendMap = { disease: counts.disease, gene: counts.gene, drug: counts.drug };
    document.querySelectorAll('.donut-legend__item').forEach(item => {
      const v = item.querySelector('.donut-legend__val');
      if (v) {
        const t = item.dataset.type;
        v.textContent = legendMap[t] != null ? legendMap[t] : 0;
      }
    });

    // 命令面板里的「全部节点」计数
    const cmdLabel = document.querySelector('.command-group-label');
    if (cmdLabel && cmdLabel.textContent.includes('全部节点')) {
      cmdLabel.textContent = `全部节点 · ${d.nodes.length}`;
    }
  }

  /* ============ 滚动入场动画 ============ */
  function initReveal() {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry, idx) => {
        if (entry.isIntersecting) {
          setTimeout(() => {
            entry.target.classList.add('visible');
          }, idx * 90);
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -60px 0px' });

    document.querySelectorAll('.reveal').forEach(el => observer.observe(el));
  }

  /* ============ 导航栏滚动效果 ============ */
  function initNav() {
    const nav = document.getElementById('nav');
    const links = document.querySelectorAll('.nav__links a');
    const sections = ['hero', 'graph', 'stats', 'compare', 'insights', 'ai'];

    window.addEventListener('scroll', () => {
      const y = window.scrollY;

      if (y > 60) nav.classList.add('nav--scrolled');
      else nav.classList.remove('nav--scrolled');

      // 高亮当前区块
      let current = 'hero';
      sections.forEach(id => {
        const el = document.getElementById(id);
        if (el && el.offsetTop - 200 <= y) current = id;
      });
      links.forEach(a => {
        a.classList.toggle('active', a.getAttribute('href') === '#' + current);
      });
    }, { passive: true });
  }

  /* ============ 详情面板 ============ */
  function showDetail(node, relations) {
    const panel = document.getElementById('detailPanel');
    const typeEl = document.getElementById('detailType');
    const titleEl = document.getElementById('detailTitle');
    const enEl = document.getElementById('detailEn');
    const bodyEl = document.getElementById('detailBody');

    if (!node) {
      panel.classList.remove('open');
      return;
    }

    const cfg = TYPE_CONFIG[node.type] || TYPE_CONFIG.gene;

    // 类型标签
    typeEl.textContent = cfg.label;
    typeEl.style.background = cfg.bg;
    typeEl.style.color = cfg.color;
    typeEl.style.border = `1px solid ${cfg.color}44`;

    titleEl.textContent = node.name;
    enEl.textContent = node.en || '';

    // 构建内容
    let html = '';

    // 基本信息
    if (node.type === 'disease') {
      html += `
        <div class="detail-stats" style="margin-bottom:20px">
          <div class="detail-stat">
            <div class="detail-stat__k">疾病分类</div>
            <div class="detail-stat__v">${node.category || '未分类'}</div>
          </div>
          <div class="detail-stat">
            <div class="detail-stat__k">流行病学</div>
            <div class="detail-stat__v" style="font-size:11px;line-height:1.5">${node.prevalence || '暂无数据'}</div>
          </div>
        </div>`;
    } else if (node.type === 'gene') {
      const deg = relations.filter(r => r.node.type === 'disease').length;
      html += `
        <div class="detail-stats" style="margin-bottom:20px">
          <div class="detail-stat">
            <div class="detail-stat__k">关联疾病数</div>
            <div class="detail-stat__v">${deg} 种</div>
          </div>
          <div class="detail-stat">
            <div class="detail-stat__k">基因类型</div>
            <div class="detail-stat__v" style="font-size:11px">${node.famous ? '★ 经典标志基因' : 'protein_coding'}</div>
          </div>
        </div>`;
    } else {
      html += `
        <div class="detail-stats" style="margin-bottom:20px">
          <div class="detail-stat">
            <div class="detail-stat__k">药物类别</div>
            <div class="detail-stat__v" style="font-size:11.5px">${node.drugClass || '—'}</div>
          </div>
          <div class="detail-stat">
            <div class="detail-stat__k">上市批准</div>
            <div class="detail-stat__v" style="font-size:11.5px">${node.approval || '—'}</div>
          </div>
        </div>`;
    }

    // 概述（优先中文，兜底英文）
    const descText = node.descZh || node.desc || '';
    if (descText) {
      html += `
        <div class="detail-block">
          <div class="detail-block__label">疾病概述</div>
          <div class="detail-block__text">${descText}</div>
        </div>`;
    }

    // 基因英文全名（放在概述后，作为补充信息）
    if (node.type === 'gene' && node.en) {
      html += `
        <div class="detail-block">
          <div class="detail-block__label">基因全称</div>
          <div class="detail-block__text" style="font-family:var(--font-mono);font-size:12px;color:var(--text-muted)">${node.en}</div>
        </div>`;
    }

    // 机制/功能
    if (node.mechanism) {
      html += `
        <div class="detail-block">
          <div class="detail-block__label">病理机制</div>
          <div class="detail-block__text">${node.mechanism}</div>
        </div>`;
    }
    if (node.geneFunc) {
      html += `
        <div class="detail-block">
          <div class="detail-block__label">基因功能</div>
          <div class="detail-block__text">${node.geneFunc}</div>
        </div>`;
    }
    if (node.target) {
      html += `
        <div class="detail-block">
          <div class="detail-block__label">作用靶点</div>
          <div class="detail-block__text">${node.target}</div>
        </div>`;
    }

    // 临床信息
    if (node.clinical) {
      html += `
        <div class="detail-block">
          <div class="detail-block__label">临床意义</div>
          <div class="detail-block__text">${node.clinical}</div>
        </div>`;
    }
    if (node.notes) {
      html += `
        <div class="detail-block">
          <div class="detail-block__label">临床备注</div>
          <div class="detail-block__text">${node.notes}</div>
        </div>`;
    }

    // 关键统计
    if (node.stats && Object.keys(node.stats).length) {
      html += `
        <div class="detail-block">
          <div class="detail-block__label">关键数据</div>
          <div class="detail-stats">
            ${Object.entries(node.stats).map(([k, v]) => `
              <div class="detail-stat">
                <div class="detail-stat__k">${k}</div>
                <div class="detail-stat__v" style="font-size:12px">${v}</div>
              </div>`).join('')}
          </div>
        </div>`;
    }

    // 关联关系
    if (relations && relations.length) {
      html += `
        <div class="detail-block">
          <div class="detail-block__label">关联节点 · ${relations.length}</div>
          <div class="rel-list">
            ${relations.map(r => {
              const rc = TYPE_CONFIG[r.node.type] || TYPE_CONFIG.gene;
              const arrow = r.direction === 'out' ? '→' : '←';
              return `
                <div class="rel-item" data-node-id="${r.node.id}">
                  <div class="rel-item__top">
                    <span class="rel-item__name">${arrow} ${r.node.name}</span>
                    <span class="rel-item__tag" style="background:${rc.bg};color:${rc.color}">${r.relation}</span>
                  </div>
                  <div class="rel-item__evidence">${r.evidence || ''}</div>
                </div>`;
            }).join('')}
          </div>
        </div>`;
    }

    bodyEl.innerHTML = html;
    bodyEl.scrollTop = 0;
    panel.classList.add('open');

    // 关联项点击跳转
    bodyEl.querySelectorAll('.rel-item').forEach(item => {
      item.addEventListener('click', () => {
        const id = item.dataset.nodeId;
        const target = graph.nodes.find(n => n.id === id);
        if (target) {
          graph.selectNode(target);
          graph.focusNode(target);
        }
      });
    });
  }

  /* ============ 知识图谱初始化 ============ */
  function initGraph() {
    const canvas = document.getElementById('graphCanvas');
    if (!canvas || !window.GRAPH_DATA) return;

    graph = new window.KnowledgeGraph(canvas, window.GRAPH_DATA, {
      onSelect: (node, relations) => showDetail(node, relations)
    });

    // 暴露实例，便于调试与外部功能模块调用
    window.__graph = graph;

    // 关闭面板
    document.getElementById('detailClose').addEventListener('click', () => {
      graph.clearSelection();
      showDetail(null);
    });

    // 过滤器
    document.querySelectorAll('.filter-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        graph.setFilter(chip.dataset.filter);
        // 筛选后自动适配视图
        setTimeout(() => graph.fitView(), 120);
      });
    });

    // ESC 关闭面板
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && graph.selected) {
        graph.clearSelection();
        showDetail(null);
      }
    });
  }

  /* ============ 图谱重新进入视野时激活 ============ */
  function initGraphObserver() {
    const stage = document.querySelector('.graph-stage');
    if (!stage) return;

    const obs = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting && graph) {
          // 进入视野时校准画布尺寸（静态布局下只重绘，不重排）
          graph._resize();
          graph.requestRender();
        }
      });
    }, { threshold: 0.12 });

    obs.observe(stage);

    // 页面完全加载后再校准一次，修正首屏测量误差
    window.addEventListener('load', () => {
      if (graph) {
        graph._resize();
        graph.requestRender();
      }
    });

    // 字体加载完成后重绘（避免标签用默认字体测量）
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => {
        if (graph) graph._render();
      });
    }
  }

  /* ============ 启动 ============ */
  function boot() {
    syncCounts();       // 先用真实数据同步所有统计
    animateCounters();
    initReveal();
    initNav();
    initGraph();
    initGraphObserver();

    // 初始化扩展功能（查找 / 路径 / 统计 / 对比）
    if (window.KGExtras && graph) {
      window.KGExtras.init(graph);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
