/**
 * 扩展功能模块：查找面板、路径探索、统计图表、疾病对比
 */

(function () {
  'use strict';

  const TYPE_CFG = {
    disease: { label: '疾病', color: '#ff5c8a', bg: 'rgba(255,92,138,.14)' },
    gene: { label: '基因', color: '#4db8ff', bg: 'rgba(77,184,255,.14)' },
    drug: { label: '药物', color: '#ffc857', bg: 'rgba(255,200,87,.14)' }
  };

  const TYPE_ORDER = { disease: 0, gene: 1, drug: 2 };

  let graph = null;
  let allNodes = [];
  let allLinks = [];

  /* ==================== 工具函数 ==================== */

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* 模糊匹配打分：完全匹配 &gt; 前缀 &gt; 包含 &gt; 描述命中 */
  function matchScore(node, q) {
    const ql = q.toLowerCase();
    const name = (node.name || '').toLowerCase();
    const en = (node.en || '').toLowerCase();
    const abbr = (node.abbr || '').toLowerCase();
    const desc = ((node.desc || '') + ' ' + (node.category || '') +
                  ' ' + (node.drugClass || '') + ' ' + (node.chromosome || '')).toLowerCase();

    if (name === ql || abbr === ql || en === ql) return 100;
    if (name.startsWith(ql) || abbr.startsWith(ql)) return 85;
    if (en.startsWith(ql)) return 80;
    if (name.includes(ql)) return 70;
    if (abbr.includes(ql)) return 65;
    if (en.includes(ql)) return 60;
    if (desc.includes(ql)) return 30;
    return 0;
  }

  function searchNodes(q) {
    if (!q.trim()) return [];
    return allNodes
      .map(n => ({ node: n, score: matchScore(n, q.trim()) }))
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score || TYPE_ORDER[a.node.type] - TYPE_ORDER[b.node.type])
      .slice(0, 24);
  }

  /* ==================== 查找面板 ==================== */

  let cmdActiveIndex = 0;
  let cmdItems = [];

  function openCommand() {
    const overlay = document.getElementById('commandOverlay');
    const input = document.getElementById('commandInput');
    overlay.classList.add('open');
    input.value = '';
    input.focus();
    renderCommandResults('');
  }

  function closeCommand() {
    document.getElementById('commandOverlay').classList.remove('open');
  }

  function renderCommandResults(q) {
    const body = document.getElementById('commandResults');
    cmdActiveIndex = 0;
    cmdItems = [];

    if (!q.trim()) {
      // 空状态：展示推荐 + 提示
      const suggestions = ['EGFR', 'TP53', '阿尔茨海默', '二甲双胍', '乳腺癌', 'BRAF', '高血压', '帕金森'];
      body.innerHTML = `
        <div class="command-group-label">试试搜索</div>
        <div style="display:flex;flex-wrap:wrap;gap:8px;padding:4px 14px 16px">
          ${suggestions.map(s => `<button class="compare-tag" data-suggest="${esc(s)}">${esc(s)}</button>`).join('')}
        </div>
        <div class="command-group-label">全部节点 · ${allNodes.length}</div>
        ${allNodes.slice().sort((a, b) => TYPE_ORDER[a.type] - TYPE_ORDER[b.type]).slice(0, 10).map((n, i) => {
          cmdItems.push(n);
          return cmdItemHtml(n, i);
        }).join('')}
      `;
      bindCommandItems(body);
      return;
    }

    const results = searchNodes(q);
    if (!results.length) {
      body.innerHTML = `<div class="command-empty">没有找到与「${esc(q)}」匹配的节点<br><span style="font-size:12px;opacity:.7">试试中文名、英文名或缩写</span></div>`;
      return;
    }

    // 按类型分组（只显示实际存在数据的类型）
    let html = '';
    ['disease', 'gene', 'drug'].forEach(type => {
      const group = results.filter(r => r.node.type === type);
      if (!group.length) return;
      html += `<div class="command-group-label">${TYPE_CFG[type].label} · ${group.length}</div>`;
      group.forEach(r => {
        const idx = cmdItems.length;
        cmdItems.push(r.node);
        html += cmdItemHtml(r.node, idx);
      });
    });

    body.innerHTML = html;
    bindCommandItems(body);
  }

  function cmdItemHtml(n, i) {
    const cfg = TYPE_CFG[n.type];
    const desc = n.desc ? n.desc.slice(0, 62) + (n.desc.length > 62 ? '…' : '') : '';
    return `
      <div class="command-item" data-idx="${i}" data-id="${n.id}">
        <span class="command-item__dot" style="background:${cfg.color};box-shadow:0 0 8px ${cfg.color}"></span>
        <div class="command-item__main">
          <div class="command-item__name">${esc(n.name)}${n.abbr ? ` <span class="command-item__en">${esc(n.abbr)}</span>` : ''}</div>
          <div class="command-item__desc">${esc(desc)}</div>
        </div>
        <span class="command-item__type" style="background:${cfg.bg};color:${cfg.color}">${cfg.label}</span>
      </div>`;
  }

  function bindCommandItems(body) {
    body.querySelectorAll('.command-item').forEach(el => {
      el.addEventListener('click', () => {
        const id = el.dataset.id;
        jumpToNode(id);
        closeCommand();
      });
      el.addEventListener('mouseenter', () => {
        body.querySelectorAll('.command-item').forEach(x => x.classList.remove('active'));
        el.classList.add('active');
        cmdActiveIndex = parseInt(el.dataset.idx, 10);
      });
    });

    body.querySelectorAll('[data-suggest]').forEach(btn => {
      btn.addEventListener('click', () => {
        const input = document.getElementById('commandInput');
        input.value = btn.dataset.suggest;
        renderCommandResults(btn.dataset.suggest);
        input.focus();
      });
    });
  }

  function navigateCommand(delta) {
    const items = document.querySelectorAll('#commandResults .command-item');
    if (!items.length) return;
    cmdActiveIndex = (cmdActiveIndex + delta + items.length) % items.length;
    items.forEach(x => x.classList.remove('active'));
    const el = items[cmdActiveIndex];
    if (el) {
      el.classList.add('active');
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  function jumpToNode(id) {
    if (!graph) return;
    const node = graph.nodes.find(n => n.id === id);
    if (!node) return;
    graph.selectNode(node);
    graph.focusNode(node);
    document.getElementById('graph').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ==================== 路径探索 ==================== */

  function populatePathSelects() {
    const from = document.getElementById('pathFrom');
    const to = document.getElementById('pathTo');
    const options = allNodes.slice()
      .sort((a, b) => TYPE_ORDER[a.type] - TYPE_ORDER[b.type] || a.name.localeCompare(b.name, 'zh'))
      .map(n => `<option value="${n.id}">[${TYPE_CFG[n.type].label}] ${esc(n.name)}</option>`)
      .join('');
    from.innerHTML = '<option value="">选择起点…</option>' + options;
    to.innerHTML = '<option value="">选择终点…</option>' + options;
  }

  function runPathQuery() {
    const fromId = document.getElementById('pathFrom').value;
    const toId = document.getElementById('pathTo').value;
    const result = document.getElementById('pathResult');

    if (!fromId || !toId) {
      result.innerHTML = `<div class="path-none">请先选择起点和终点</div>`;
      return;
    }
    if (fromId === toId) {
      result.innerHTML = `<div class="path-none">起点和终点不能相同</div>`;
      return;
    }
    if (!graph) return;

    const path = graph.findPath(fromId, toId);

    if (!path) {
      result.innerHTML = `<div class="path-none">这两个节点之间没有连通路径<br><span style="font-size:12px">说明它们在知识图谱中属于互不相关的生物学分支</span></div>`;
      graph.clearPath();
      return;
    }

    // 高亮路径
    graph.highlightPath(path);

    // 渲染路径链条
    let html = `<div class="path-summary">
      找到最短路径：经过 <strong>${path.length}</strong> 步，共 <strong>${path.nodes.length}</strong> 个节点
    </div><div class="path-chain">`;

    path.nodes.forEach((n, i) => {
      const cfg = TYPE_CFG[n.type];
      html += `
        <div class="path-step">
          <div class="path-step__node" style="background:${cfg.color}">${i + 1}</div>
          <div class="path-step__content">
            <div class="path-step__name" data-jump="${n.id}">${esc(n.name)}
              <span style="font-size:10.5px;color:${cfg.color};font-weight:600">· ${cfg.label}</span>
            </div>
            ${i < path.edges.length ? `<div class="path-step__rel">${esc(path.edges[i].relation)} — ${esc(path.edges[i].evidence || '')}</div>` : ''}
          </div>
        </div>`;
    });

    html += '</div>';
    result.innerHTML = html;

    result.querySelectorAll('[data-jump]').forEach(el => {
      el.addEventListener('click', () => {
        jumpToNode(el.dataset.jump);
        closeModal('pathModal');
      });
    });
  }

  /* ==================== 统计图表 ==================== */

  function drawDonut() {
    const canvas = document.getElementById('donutChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const size = 260;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = size + 'px';
    canvas.style.height = size + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // 按疾病分类统计（16 个系统），比只分「疾病/基因」更有信息量
    const catCount = {};
    allNodes.forEach(n => {
      if (n.type === 'disease') {
        const c = n.category || '其他';
        catCount[c] = (catCount[c] || 0) + 1;
      }
    });

    const totalDisease = Object.values(catCount).reduce((a, b) => a + b, 0);
    const total = totalDisease || 1;

    const cx = size / 2;
    const cy = size / 2;
    const outerR = size * 0.42;
    const innerR = size * 0.28;

    // 分类配色（16 色轮转）
    const PALETTE = [
      '#ff5c8a', '#4db8ff', '#ffc857', '#3ee8c4', '#a78bfa',
      '#fb7185', '#34d399', '#60a5fa', '#fbbf24', '#f472b6',
      '#22d3ee', '#c084fc', '#4ade80', '#fb923c', '#94a3b8', '#e879f9'
    ];

    const segments = Object.entries(catCount)
      .sort((a, b) => b[1] - a[1])
      .map(([name, value], i) => ({
        type: name,
        value,
        color: PALETTE[i % PALETTE.length]
      }));

    let startAngle = -Math.PI / 2;
    const gap = 0.016;

    segments.forEach(seg => {
      const angle = (seg.value / total) * Math.PI * 2;
      const endAngle = startAngle + angle - gap;

      // 扇形环
      ctx.beginPath();
      ctx.arc(cx, cy, outerR, startAngle, endAngle);
      ctx.arc(cx, cy, innerR, endAngle, startAngle, true);
      ctx.closePath();

      const grad = ctx.createRadialGradient(cx, cy, innerR, cx, cy, outerR);
      grad.addColorStop(0, seg.color + 'cc');
      grad.addColorStop(1, seg.color);
      ctx.fillStyle = grad;

      ctx.shadowColor = seg.color;
      ctx.shadowBlur = 12;
      ctx.fill();
      ctx.shadowBlur = 0;

      startAngle += angle;
    });

    // 内圈装饰
    ctx.beginPath();
    ctx.arc(cx, cy, innerR - 5, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(62,232,196,0.12)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // 把分类图例写进 DOM（替换原来的两项）
    const legendEl = document.querySelector('.donut-legend');
    if (legendEl) {
      legendEl.innerHTML = segments.map(s => `
        <div class="donut-legend__item" style="cursor:default">
          <span class="donut-legend__dot" style="background:${s.color}"></span>
          <span class="donut-legend__name" style="font-size:12px">${s.type}</span>
          <span class="donut-legend__val">${s.value}</span>
        </div>`).join('');
      legendEl.style.maxHeight = '190px';
      legendEl.style.overflowY = 'auto';
    }

    // 更新中心数字为「疾病总数」
    const donutCenter = document.querySelector('.donut-center__num');
    if (donutCenter) donutCenter.textContent = totalDisease;
    const donutLabel = document.querySelector('.donut-center__label');
    if (donutLabel) donutLabel.textContent = '种疾病';
  }

  function drawRankList() {
    const el = document.getElementById('hubRankList');
    if (!el) return;

    const degree = new Map();
    allNodes.forEach(n => degree.set(n.id, 0));
    allLinks.forEach(l => {
      degree.set(l.source, (degree.get(l.source) || 0) + 1);
      degree.set(l.target, (degree.get(l.target) || 0) + 1);
    });

    const ranked = allNodes
      .map(n => ({ node: n, deg: degree.get(n.id) || 0 }))
      .filter(r => r.deg > 0)
      .sort((a, b) => b.deg - a.deg)
      .slice(0, 8);

    const maxDeg = ranked[0] ? ranked[0].deg : 1;

    el.innerHTML = ranked.map((r, i) => {
      const cfg = TYPE_CFG[r.node.type];
      return `
        <div class="rank-item" data-id="${r.node.id}">
          <div class="rank-item__idx ${i < 3 ? 'top' : ''}">${i + 1}</div>
          <div class="rank-item__body">
            <div class="rank-item__name">
              ${esc(r.node.name)}
              <span style="font-size:10px;color:${cfg.color}">${cfg.label}</span>
            </div>
            <div class="rank-item__bar">
              <div class="rank-item__fill" style="width:0%;background:linear-gradient(90deg,${cfg.color}88,${cfg.color})"></div>
            </div>
          </div>
          <div class="rank-item__count">${r.deg}</div>
        </div>`;
    }).join('');

    // 动画填充
    requestAnimationFrame(() => {
      el.querySelectorAll('.rank-item').forEach((item, i) => {
        const fill = item.querySelector('.rank-item__fill');
        if (fill && ranked[i]) {
          setTimeout(() => {
            fill.style.width = (ranked[i].deg / maxDeg * 100) + '%';
          }, 60 + i * 55);
        }
      });
    });

    el.querySelectorAll('.rank-item').forEach(item => {
      item.addEventListener('click', () => jumpToNode(item.dataset.id));
    });
  }

  function drawRelationBars() {
    const el = document.getElementById('relationBarList');
    if (!el) return;

    const relCount = new Map();
    allLinks.forEach(l => {
      const key = l.relation;
      relCount.set(key, (relCount.get(key) || 0) + 1);
    });

    // 只统计出现次数 >= 1 的关系，取前 10
    const list = [...relCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    const max = list[0] ? list[0][1] : 1;

    el.innerHTML = list.map(([rel, count]) => `
      <div class="bar-item">
        <div class="bar-item__top">
          <span class="bar-item__label">${esc(rel)}</span>
          <span class="bar-item__val">${count}</span>
        </div>
        <div class="bar-item__track">
          <div class="bar-item__fill" style="width:0%"></div>
        </div>
      </div>
    `).join('');

    requestAnimationFrame(() => {
      el.querySelectorAll('.bar-item').forEach((item, i) => {
        const fill = item.querySelector('.bar-item__fill');
        if (fill && list[i]) {
          setTimeout(() => {
            fill.style.width = (list[i][1] / max * 100) + '%';
          }, 70 + i * 45);
        }
      });
    });
  }

  /* ==================== 疾病对比 ==================== */

  function populateCompareSelects() {
    const diseases = allNodes.filter(n => n.type === 'disease')
      .sort((a, b) => a.name.localeCompare(b.name, 'zh'));
    const options = diseases.map(n => `<option value="${n.id}">${esc(n.name)}</option>`).join('');
    const a = document.getElementById('compareA');
    const b = document.getElementById('compareB');
    if (a) a.innerHTML = '<option value="">选择疾病 A…</option>' + options;
    if (b) b.innerHTML = '<option value="">选择疾病 B…</option>' + options;
  }

  function neighborsOf(id, typeFilter) {
    const set = new Set();
    allLinks.forEach(l => {
      let otherId = null;
      if (l.source === id) otherId = l.target;
      else if (l.target === id) otherId = l.source;
      if (!otherId) return;
      const other = allNodes.find(n => n.id === otherId);
      if (other && (!typeFilter || other.type === typeFilter)) set.add(otherId);
    });
    return set;
  }

  function runCompare() {
    const aId = document.getElementById('compareA').value;
    const bId = document.getElementById('compareB').value;
    const out = document.getElementById('compareResult');

    if (!aId || !bId) {
      out.innerHTML = `<div class="compare-empty">
        <p>选择两种疾病开始对比</p></div>`;
      return;
    }
    if (aId === bId) {
      out.innerHTML = `<div class="compare-empty"><p>请选择两种不同的疾病</p></div>`;
      return;
    }

    const a = allNodes.find(n => n.id === aId);
    const b = allNodes.find(n => n.id === bId);

    const aGenes = neighborsOf(aId, 'gene');
    const bGenes = neighborsOf(bId, 'gene');
    const aDrugs = neighborsOf(aId, 'drug');
    const bDrugs = neighborsOf(bId, 'drug');

    const sharedGenes = [...aGenes].filter(id => bGenes.has(id));
    const sharedDrugs = [...aDrugs].filter(id => bDrugs.has(id));

    // 共同邻居（任意类型）
    const aAll = neighborsOf(aId);
    const bAll = neighborsOf(bId);
    const sharedAll = [...aAll].filter(id => bAll.has(id));

    const tagHtml = (ids, shared) => {
      if (!ids.length) return `<div class="compare-none">无</div>`;
      return ids.map(id => {
        const n = allNodes.find(x => x.id === id);
        if (!n) return '';
        return `<span class="compare-tag" data-jump="${id}">${esc(n.name)}</span>`;
      }).join('');
    };

    // 药物层：当前数据集可能不含药物节点，有数据才展示相关区块
    const hasDrugLayer = aDrugs.size > 0 || bDrugs.size > 0;

    out.innerHTML = `
      <div class="compare-grid">
        <div class="compare-box">
          <div class="compare-box__title">${esc(a.name)} · 关联基因</div>
          <div class="compare-box__list">${tagHtml([...aGenes], false)}</div>
        </div>
        <div class="compare-box">
          <div class="compare-box__title">${esc(b.name)} · 关联基因</div>
          <div class="compare-box__list">${tagHtml([...bGenes], false)}</div>
        </div>
        <div class="compare-box compare-box--shared">
          <div class="compare-box__title">共同基因 · ${sharedGenes.length}</div>
          <div class="compare-box__list">
            ${sharedGenes.length ? tagHtml(sharedGenes, true)
              : '<div class="compare-none">两者无共同基因</div>'}
          </div>
        </div>
        ${hasDrugLayer ? `
        <div class="compare-box">
          <div class="compare-box__title">${esc(a.name)} · 关联药物</div>
          <div class="compare-box__list">${tagHtml([...aDrugs], false)}</div>
        </div>
        <div class="compare-box">
          <div class="compare-box__title">${esc(b.name)} · 关联药物</div>
          <div class="compare-box__list">${tagHtml([...bDrugs], false)}</div>
        </div>
        <div class="compare-box compare-box--shared">
          <div class="compare-box__title">共同药物 · ${sharedDrugs.length}</div>
          <div class="compare-box__list">
            ${sharedDrugs.length ? tagHtml(sharedDrugs, true)
              : '<div class="compare-none">两者无共同药物</div>'}
          </div>
        </div>` : ''}
      </div>
      ${sharedAll.length ? `
        <div style="margin-top:16px;padding:13px 16px;background:rgba(62,232,196,.07);border:1px solid rgba(62,232,196,.24);border-radius:8px;font-size:12.8px;color:var(--accent)">
          两种疾病共有 <strong>${sharedAll.length}</strong> 个关联节点，提示它们可能存在共同的分子基础或治疗靶点。
        </div>` : `
        <div style="margin-top:16px;padding:13px 16px;background:rgba(255,255,255,.04);border:1px solid var(--border);border-radius:8px;font-size:12.8px;color:var(--text-muted)">
          两种疾病没有共享的关联节点，说明它们在当前图谱中属于相对独立的病理分支。
        </div>`}
    `;

    out.querySelectorAll('[data-jump]').forEach(el => {
      el.addEventListener('click', () => jumpToNode(el.dataset.jump));
    });
  }

  /* ==================== 弹窗管理 ==================== */

  function openModal(id) {
    document.getElementById(id).classList.add('open');
  }

  function closeModal(id) {
    document.getElementById(id).classList.remove('open');
  }

  /* ==================== 初始化 ==================== */

  function init(graphInstance) {
    graph = graphInstance;
    allNodes = graph.nodes;
    allLinks = graph.links;

    // --- 工具栏按钮 ---
    document.getElementById('btnSearch')?.addEventListener('click', openCommand);
    document.getElementById('btnPath')?.addEventListener('click', () => {
      populatePathSelects();
      document.getElementById('pathResult').innerHTML = '';
      openModal('pathModal');
    });
    document.getElementById('btnFit')?.addEventListener('click', () => {
      // 只调整视角，不触发重新布局
      graph.fitView();
    });
    document.getElementById('btnReset')?.addEventListener('click', () => {
      graph.resetView();
      graph.clearPath();
      graph.clearSelection();
      document.getElementById('detailPanel').classList.remove('open');
    });

    // --- 移动端浮动控制 ---
    document.getElementById('mobSearch')?.addEventListener('click', openCommand);

    document.getElementById('mobZoomIn')?.addEventListener('click', () => {
      const cx = graph.width / 2;
      const cy = graph.height / 2;
      const newScale = Math.min(4.5, graph.view.scale * 1.35);
      const k = newScale / graph.view.scale;
      graph.view.x = cx - (cx - graph.view.x) * k;
      graph.view.y = cy - (cy - graph.view.y) * k;
      graph.view.scale = newScale;
    });

    document.getElementById('mobZoomOut')?.addEventListener('click', () => {
      const cx = graph.width / 2;
      const cy = graph.height / 2;
      const newScale = Math.max(0.3, graph.view.scale / 1.35);
      const k = newScale / graph.view.scale;
      graph.view.x = cx - (cx - graph.view.x) * k;
      graph.view.y = cy - (cy - graph.view.y) * k;
      graph.view.scale = newScale;
    });

    document.getElementById('mobFit')?.addEventListener('click', () => graph.fitView());

    // --- 度数筛选 ---
    const degreeSel = document.getElementById('degreeFilter');
    if (degreeSel) {
      // 依据实际数据的度数分布动态生成选项
      const degrees = graph.nodes.map(n => n.degree).sort((a, b) => b - a);
      const maxDeg = degrees[0] || 1;
      const opts = [
        { v: 0, label: `全部 (${graph.nodes.length})` },
        { v: 2, label: '关联 ≥ 2' },
        { v: 3, label: '关联 ≥ 3' },
        { v: 5, label: '关联 ≥ 5' },
        { v: Math.max(3, Math.round(maxDeg * 0.5)), label: `关联 ≥ ${Math.max(3, Math.round(maxDeg * 0.5))}` },
        { v: Math.max(3, Math.round(maxDeg * 0.75)), label: `关联 ≥ ${Math.max(3, Math.round(maxDeg * 0.75))}` },
      ];
      // 去重
      const seen = new Set();
      const uniq = opts.filter(o => {
        const k = 'v' + o.v;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });

      const initTh = graph.degreeThreshold || 0;
      degreeSel.innerHTML = uniq.map(o => {
        const sel = o.v === initTh ? ' selected' : '';
        return `<option value="${o.v}"${sel}>${o.label}</option>`;
      }).join('');

      // 若初始阈值不在选项里，补一个
      if (!uniq.some(o => o.v === initTh) && initTh > 0) {
        const opt = document.createElement('option');
        opt.value = String(initTh);
        opt.textContent = `关联 ≥ ${initTh}（推荐）`;
        opt.selected = true;
        degreeSel.insertBefore(opt, degreeSel.firstChild.nextSibling);
      }

      degreeSel.addEventListener('change', () => {
        const val = parseInt(degreeSel.value, 10) || 0;
        graph.setDegreeThreshold(val);
        updateVisibleCount();
        setTimeout(() => graph.fitView(), 160);
      });
    }

    // --- 可见节点计数 ---
    function updateVisibleCount() {
      const vc = document.getElementById('visibleCount');
      const tc = document.getElementById('totalCount');
      if (vc) vc.textContent = graph.getVisibleCount();
      if (tc) tc.textContent = graph.nodes.length;
    }
    updateVisibleCount();
    // 移动端不轮询：只在筛选/搜索时被动更新，避免持续占用主线程
    if (!graph._isMobile) {
      setInterval(updateVisibleCount, 800);
    }

    // --- 查找面板事件 ---
    const overlay = document.getElementById('commandOverlay');
    const input = document.getElementById('commandInput');

    overlay?.addEventListener('click', (e) => {
      if (e.target === overlay) closeCommand();
    });

    input?.addEventListener('input', (e) => renderCommandResults(e.target.value));

    input?.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); navigateCommand(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); navigateCommand(-1); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        const active = document.querySelector('#commandResults .command-item.active')
                    || document.querySelector('#commandResults .command-item');
        if (active) {
          jumpToNode(active.dataset.id);
          closeCommand();
        }
      }
    });

    // 全局快捷键 Ctrl/Cmd + K
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        openCommand();
      }
      if (e.key === 'Escape') {
        closeCommand();
        closeModal('pathModal');
      }
    });

    // --- 路径面板事件 ---
    document.getElementById('pathClose')?.addEventListener('click', () => closeModal('pathModal'));
    document.getElementById('pathRun')?.addEventListener('click', runPathQuery);
    document.getElementById('pathClear')?.addEventListener('click', () => {
      graph.clearPath();
      document.getElementById('pathResult').innerHTML = '';
    });
    document.getElementById('pathModal')?.addEventListener('click', (e) => {
      if (e.target.id === 'pathModal') closeModal('pathModal');
    });

    // --- 统计图表 ---
    drawDonut();
    drawRankList();
    drawRelationBars();

    // 图例点击联动筛选
    document.querySelectorAll('.donut-legend__item').forEach(item => {
      item.addEventListener('click', () => {
        const type = item.dataset.type;
        const chip = document.querySelector(`.filter-chip[data-filter="${type}"]`);
        if (chip) {
          chip.click();
          document.getElementById('graph').scrollIntoView({ behavior: 'smooth' });
        }
      });
    });

    // --- 疾病对比 ---
    populateCompareSelects();
    document.getElementById('compareA')?.addEventListener('change', runCompare);
    document.getElementById('compareB')?.addEventListener('change', runCompare);
  }

  window.KGExtras = { init, openCommand, jumpToNode };
})();
