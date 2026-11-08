/**
 * Barnes-Hut 四叉树 —— 将力导向布局的斥力计算从 O(n²) 降到 O(n log n)
 *
 * 性能要点：
 * 1. 用累加器避免递归返回临时对象（原实现每层都 new 一个 {fx,fy}）
 * 2. 用扁平化数组存储四叉树节点，减少对象开销
 * 3. theta 取 0.7 平衡精度与剪枝
 */

(function () {
  'use strict';

  const THETA = 0.7;
  // 斥力常数：需要与精确算法 (5200 / d²) 保持同一量级。
  // 四叉树把远处节点聚合，单次计算覆盖很多 body，因此常数相应放大。
  const GRAVITY = 5200;
  const MIN_DIST2 = 100;
  const MAX_DEPTH = 22;

  /**
   * 四叉树（扁平数组实现）
   * 每个节点用 7 个平行数组存储，避免大量小对象
   */
  class QuadTree {
    constructor(w, h) {
      this.w = w;
      this.h = h;
      this.reset();
    }

    reset() {
      this.size = 0;
      this.cap = 2048;
      // 边界
      this.x0 = new Float64Array(this.cap);
      this.y0 = new Float64Array(this.cap);
      this.x1 = new Float64Array(this.cap);
      this.y1 = new Float64Array(this.cap);
      // 质量与质心
      this.mass = new Float64Array(this.cap);
      this.cx = new Float64Array(this.cap);
      this.cy = new Float64Array(this.cap);
      // 结构：children 存首个子节点索引（4个连续），-1 表示叶子
      this.child = new Int32Array(this.cap).fill(-1);
      // 叶子存 body 索引，-1 表示空
      this.body = new Int32Array(this.cap).fill(-1);
      // 重合点的额外质量（坐标完全相同时堆叠）
      this.extra = new Float64Array(this.cap);
      // 叶子节点持有的 body 坐标（用于计算质心）
      this._leafX = new Float64Array(this.cap);
      this._leafY = new Float64Array(this.cap);
    }

    _grow() {
      const ncap = this.cap * 2;
      const grow = (arr, Type) => {
        const n = new Type(ncap);
        n.set(arr);
        return n;
      };
      this.x0 = grow(this.x0, Float64Array);
      this.y0 = grow(this.y0, Float64Array);
      this.x1 = grow(this.x1, Float64Array);
      this.y1 = grow(this.y1, Float64Array);
      this.mass = grow(this.mass, Float64Array);
      this.cx = grow(this.cx, Float64Array);
      this.cy = grow(this.cy, Float64Array);
      const nc = new Int32Array(ncap).fill(-1); nc.set(this.child); this.child = nc;
      const nb = new Int32Array(ncap).fill(-1); nb.set(this.body); this.body = nb;
      const ne = new Float64Array(ncap); ne.set(this.extra); this.extra = ne;
      const lx = new Float64Array(ncap); lx.set(this._leafX); this._leafX = lx;
      const ly = new Float64Array(ncap); ly.set(this._leafY); this._leafY = ly;
      this.cap = ncap;
    }

    _alloc(x0, y0, x1, y1) {
      if (this.size >= this.cap) this._grow();
      const i = this.size++;
      this.x0[i] = x0; this.y0[i] = y0; this.x1[i] = x1; this.y1[i] = y1;
      this.mass[i] = 0;
      this.cx[i] = 0; this.cy[i] = 0;
      this.child[i] = -1;
      this.body[i] = -1;
      this.extra[i] = 0;
      this._leafX[i] = 0;
      this._leafY[i] = 0;
      return i;
    }

    build(bodies) {
      this.reset();
      const root = this._alloc(0, 0, this.w, this.h);

      for (let b = 0; b < bodies.length; b++) {
        this._insert(root, b, bodies, 0);
      }
      this._accumulate(root);
      return root;
    }

    _insert(nodeIdx, bodyIdx, bodies, depth) {
      const bx = bodies[bodyIdx].x;
      const by = bodies[bodyIdx].y;

      // 叶子且为空：直接放入
      if (this.child[nodeIdx] === -1) {
        if (this.body[nodeIdx] === -1) {
          this.body[nodeIdx] = bodyIdx;
          this.extra[nodeIdx] = 0;
          // 记录坐标，供 _accumulate 计算质心
          this._leafX[nodeIdx] = bx;
          this._leafY[nodeIdx] = by;
          return;
        }

        // 深度保护：过深则把新节点也堆在这个叶子上，避免栈溢出
        if (depth >= MAX_DEPTH) {
          // 用链表方式累积在同一点
          this.extra[nodeIdx] = (this.extra[nodeIdx] || 0) + 1;
          return;
        }

        // 叶子已有 body：分裂后重新分配两者
        const existing = this.body[nodeIdx];
        this.body[nodeIdx] = -1;
        this._subdivide(nodeIdx);
        this._insert(nodeIdx, existing, bodies, depth + 1);
        this._insert(nodeIdx, bodyIdx, bodies, depth + 1);
        return;
      }

      // 内部节点：找合适子节点
      const c = this.child[nodeIdx];
      const mx = (this.x0[nodeIdx] + this.x1[nodeIdx]) / 2;
      const my = (this.y0[nodeIdx] + this.y1[nodeIdx]) / 2;

      let pick;
      if (bx < mx) pick = (by < my) ? c : c + 2;
      else pick = (by < my) ? c + 1 : c + 3;

      this._insert(pick, bodyIdx, bodies, depth + 1);
    }

    _subdivide(nodeIdx) {
      const x0 = this.x0[nodeIdx];
      const y0 = this.y0[nodeIdx];
      const x1 = this.x1[nodeIdx];
      const y1 = this.y1[nodeIdx];
      const mx = (x0 + x1) / 2;
      const my = (y0 + y1) / 2;

      const c0 = this._alloc(x0, y0, mx, my);
      this._alloc(mx, y0, x1, my);
      this._alloc(x0, my, mx, y1);
      this._alloc(mx, my, x1, y1);

      this.child[nodeIdx] = c0;
    }

    _accumulate(nodeIdx) {
      const c = this.child[nodeIdx];
      if (c === -1) {
        if (this.body[nodeIdx] !== -1) {
          // 主 body 质量为 1，加上重合堆叠的额外质量
          this.mass[nodeIdx] = 1 + (this.extra[nodeIdx] || 0);
          // 关键：叶子节点的质心必须设为该 body 的坐标，
          // 否则父节点的质心累加会全部变成 0。
          this.cx[nodeIdx] = this._leafX[nodeIdx];
          this.cy[nodeIdx] = this._leafY[nodeIdx];
        } else {
          this.mass[nodeIdx] = 0;
        }
        return;
      }

      let mass = 0;
      let cx = 0;
      let cy = 0;
      for (let i = 0; i < 4; i++) {
        this._accumulate(c + i);
        const m = this.mass[c + i];
        if (m > 0) {
          mass += m;
          cx += this.cx[c + i] * m;
          cy += this.cy[c + i] * m;
        }
      }
      this.mass[nodeIdx] = mass;
      if (mass > 0) {
        this.cx[nodeIdx] = cx / mass;
        this.cy[nodeIdx] = cy / mass;
      }
    }

    /**
     * 计算单个 body 受到的斥力
     * @param {number} bx body 的 x
     * @param {number} by body 的 y
     * @param {number} selfIdx body 在构建数组中的索引（用于排除自身）
     * @returns {{fx:number, fy:number}}
     */
    applyTo(bx, by, selfIdx) {
      let fx = 0;
      let fy = 0;

      const stack = QUAD_STACK;
      let sp = 0;
      stack[sp++] = 0; // 根节点

      while (sp > 0) {
        const nodeIdx = stack[--sp];
        let m = this.mass[nodeIdx];
        if (m === 0) continue;

        let ncx = this.cx[nodeIdx];
        let ncy = this.cy[nodeIdx];
        let isLeaf = this.child[nodeIdx] === -1;

        // 当前节点就是自己所在的叶子：从质量和质心中扣除自身
        if (isLeaf && this.body[nodeIdx] === selfIdx) {
          const extra = this.extra[nodeIdx] || 0;
          m = m - 1;              // 减去自己的质量
          if (m <= 0) continue;   // 只剩自己，无斥力
          // 质心按剩余质量重算（其余都是与自己完全重合的点）
          ncx = bx;
          ncy = by;
        }

        const dx = bx - ncx;
        const dy = by - ncy;
        const d2 = dx * dx + dy * dy;

        const size = this.x1[nodeIdx] - this.x0[nodeIdx];

        // 足够远 → 当作单一质点
        if (isLeaf || ((size * size) / (d2 || 1)) < THETA * THETA) {
          const dd = Math.max(d2, MIN_DIST2);
          const f = (GRAVITY * m) / dd;
          const d = Math.sqrt(dd);
          // 斥力方向：从质心指向自身（即远离对方）
          fx += (dx / d) * f;
          fy += (dy / d) * f;
          continue;
        }

        // 展开子节点
        const c = this.child[nodeIdx];
        stack[sp++] = c;
        stack[sp++] = c + 1;
        stack[sp++] = c + 2;
        stack[sp++] = c + 3;
      }

      return { fx, fy };
    }
  }

  // 栈复用，避免每次调用都分配
  const QUAD_STACK = new Int32Array(8192);

  // 复用实例
  let treeInstance = null;

  const BarnesHutTree = {
    /**
     * 构建四叉树
     * @param {Array} bodies 必须已带 idx 字段（0..n-1）
     */
    build(bodies, w, h) {
      if (!treeInstance) {
        treeInstance = new QuadTree(w, h);
      } else if (treeInstance.w !== w || treeInstance.h !== h) {
        treeInstance.w = w;
        treeInstance.h = h;
      }
      treeInstance.build(bodies);
      return treeInstance;
    },

    /**
     * 对单个 body 施加斥力，直接写回 vx/vy
     * @param {object} body 代理点
     * @param {object} tree 四叉树
     * @param {number} alpha 温度
     * @param {number} scale 斥力倍率（大图需要更强斥力）
     */
    applyRepulsion(body, tree, alpha, scale) {
      const r = tree.applyTo(body.x, body.y, body.idx);
      const k = (scale || 1) * alpha;
      // r 是「远离质心」方向的斥力，直接加到速度上
      body.node.vx += r.fx * k;
      body.node.vy += r.fy * k;
    }
  };

  window.BarnesHutTree = BarnesHutTree;
})();
