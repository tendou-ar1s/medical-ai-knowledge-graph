/**
 * 3D 力导向布局引擎（球面分布 + 透视投影）
 *
 * 为什么用 3D：
 *   2D 里 2410 个节点必然挤成平面饱和 —— 节点只能往四边推，
 *   形成「框状条带」。3D 里节点分布在球壳上，表面积为 4πr²，
 *   同样节点数下每个节点的可用空间大幅增加，视觉层次也更清晰。
 *
 * 但它不是真 3D 渲染：仍然用 Canvas 2D 绘制，
 * 只是把 (x,y,z) 透视投影到屏幕，用大小的缩放表现远近。
 * 这样既有立体感，又能保持原有引擎的性能与交互逻辑。
 */

(function () {
  'use strict';

  const SPHERE_RADIUS = 1;      // 归一化球半径
  const MAX_V = 0.06;           // 速度上限（归一化单位）

  class Layout3D {
    constructor(nodeCount) {
      this.nodeCount = nodeCount;
      // 3D 坐标归一化到 [-1, 1] 的球体内
      this.positions = [];
      this.velocities = [];
      this.init();
    }

    init() {
      const n = this.nodeCount;
      // 用 Fibonacci 球面均匀分布：比随机分布更均匀，避免极点聚集
      const golden = Math.PI * (3 - Math.sqrt(5));

      for (let i = 0; i < n; i++) {
        // 球面均匀点
        const y = 1 - (i / Math.max(n - 1, 1)) * 2;   // -1 → 1
        const radiusAtY = Math.sqrt(Math.max(0, 1 - y * y));
        const theta = golden * i;

        // 半径略微分层，让内部也有节点，形成体积感
        const layer = 0.55 + Math.random() * 0.45;

        this.positions.push({
          x: Math.cos(theta) * radiusAtY * layer,
          y: y * layer,
          z: Math.sin(theta) * radiusAtY * layer
        });
        this.velocities.push({ x: 0, y: 0, z: 0 });
      }
    }

    /**
     * 迭代一步物理
     * @param {Array} links [{source: 索引, target: 索引, strength}]
     * @param {number} alpha 温度
     */
    step(links, alpha) {
      const pos = this.positions;
      const vel = this.velocities;
      const n = pos.length;

      // ---- 1. 斥力（近似：用球面距离 + 分桶加速）----
      // 全对全在 3D 里更贵，用网格分桶做邻域计算
      const CELL = 0.28;
      const buckets = new Map();
      for (let i = 0; i < n; i++) {
        const p = pos[i];
        const key = `${Math.floor(p.x / CELL)},${Math.floor(p.y / CELL)},${Math.floor(p.z / CELL)}`;
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(i);
      }

      const REP = 0.00085 * alpha;

      for (let i = 0; i < n; i++) {
        const pi = pos[i];
        const cx = Math.floor(pi.x / CELL);
        const cy = Math.floor(pi.y / CELL);
        const cz = Math.floor(pi.z / CELL);

        // 只与相邻 27 个格子里的节点算斥力
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            for (let dz = -1; dz <= 1; dz++) {
              const bucket = buckets.get(`${cx + dx},${cy + dy},${cz + dz}`);
              if (!bucket) continue;
              for (let k = 0; k < bucket.length; k++) {
                const j = bucket[k];
                if (j <= i) continue;
                const pj = pos[j];
                let ddx = pi.x - pj.x;
                let ddy = pi.y - pj.y;
                let ddz = pi.z - pj.z;
                let d2 = ddx * ddx + ddy * ddy + ddz * ddz;
                if (d2 < 1e-5) {
                  // 完全重合：给一个随机微扰
                  ddx = (Math.random() - 0.5) * 0.01;
                  ddy = (Math.random() - 0.5) * 0.01;
                  ddz = (Math.random() - 0.5) * 0.01;
                  d2 = 1e-5;
                }
                const d = Math.sqrt(d2);
                const f = REP / Math.max(d2, 0.0025);
                const fx = (ddx / d) * f;
                const fy = (ddy / d) * f;
                const fz = (ddz / d) * f;

                vel[i].x += fx; vel[i].y += fy; vel[i].z += fz;
                vel[j].x -= fx; vel[j].y -= fy; vel[j].z -= fz;
              }
            }
          }
        }
      }

      // ---- 2. 边引力 ----
      const EDGE_K = 0.0042 * alpha;
      for (let e = 0; e < links.length; e++) {
        const link = links[e];
        const a = link.source;
        const b = link.target;
        if (a == null || b == null) continue;

        const pa = pos[a], pb = pos[b];
        const dx = pb.x - pa.x, dy = pb.y - pa.y, dz = pb.z - pa.z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-4;

        // 强关联的边希望更短
        const targetD = 0.28 - Math.min(link.strength || 3, 10) * 0.012;
        const f = ((d - targetD) / d) * EDGE_K;

        vel[a].x += dx * f; vel[a].y += dy * f; vel[a].z += dz * f;
        vel[b].x -= dx * f; vel[b].y -= dy * f; vel[b].z -= dz * f;
      }

      // ---- 3. 球面向心力：把节点拉回球壳，形成球形外观 ----
      const SHELL_K = 0.02 * alpha;
      for (let i = 0; i < n; i++) {
        const p = pos[i];
        const r = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z) || 1e-4;
        // 目标半径在 0.62~1.0 之间，按索引错开形成厚度
        const targetR = 0.62 + (i % 7) / 7 * 0.38;
        const f = (targetR - r) * SHELL_K;
        vel[i].x += (p.x / r) * f;
        vel[i].y += (p.y / r) * f;
        vel[i].z += (p.z / r) * f;
      }

      // ---- 4. 积分 + 阻尼 ----
      for (let i = 0; i < n; i++) {
        const v = vel[i];
        // 速度钳制
        const sp = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
        if (sp > MAX_V) {
          const k = MAX_V / sp;
          v.x *= k; v.y *= k; v.z *= k;
        }
        v.x *= 0.90; v.y *= 0.90; v.z *= 0.90;
        pos[i].x += v.x;
        pos[i].y += v.y;
        pos[i].z += v.z;
      }
    }

    /**
     * 把 3D 坐标投影成屏幕坐标
     * @param {number} cx 屏幕中心 x
     * @param {number} cy 屏幕中心 y
     * @param {number} radius 球在屏幕上的半径
     * @param {number} rotX 绕 X 轴旋转（俯仰）
     * @param {number} rotY 绕 Y 轴旋转（偏航）
     * @param {number} zoom 缩放
     * @returns {Array<{sx, sy, scale, depth}>}
     */
    project(cx, cy, radius, rotX, rotY, zoom) {
      const cosX = Math.cos(rotX), sinX = Math.sin(rotX);
      const cosY = Math.cos(rotY), sinY = Math.sin(rotY);
      const out = new Array(this.positions.length);

      // 透视参数：越大越"平"，越小立体感越强
      const PERSPECTIVE = 2.6;

      for (let i = 0; i < this.positions.length; i++) {
        const p = this.positions[i];

        // 先绕 Y 轴旋转
        let x = p.x * cosY + p.z * sinY;
        let z = -p.x * sinY + p.z * cosY;
        let y = p.y;

        // 再绕 X 轴旋转
        const y2 = y * cosX - z * sinX;
        const z2 = y * sinX + z * cosX;
        y = y2;
        z = z2;

        // 透视投影：z 越大（越靠近观察者）投影越大
        const persp = PERSPECTIVE / (PERSPECTIVE - z);
        const sx = cx + x * radius * zoom * persp;
        const sy = cy + y * radius * zoom * persp;

        out[i] = {
          sx,
          sy,
          scale: persp,          // 用于节点大小
          depth: z               // -1(远) ~ 1(近)
        };
      }

      return out;
    }
  }

  window.Layout3D = Layout3D;
})();
