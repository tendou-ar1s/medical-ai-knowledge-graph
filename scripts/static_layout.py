"""
静态确定性布局：按疾病系统分组的环形布局
不依赖物理模拟，位置完全可预测，视觉上整洁有序
"""

import json
import math
import os

# 疾病系统分类：把疾病归入人体系统，作为布局的分区依据
SYSTEM_MAP = {
    "肿瘤": [
        "癌", "肉瘤", "瘤", "白血病", "淋巴瘤", "骨髓瘤",
    ],
    "心血管": [
        "高血压", "冠心病", "心肌", "心力衰竭", "心律", "房颤", "心房颤动",
        "脑卒中", "动脉", "静脉", "血栓", "栓塞", "曲张", "痔疮", "心脏病",
        "心包", "风湿性心脏", "低血压",
    ],
    "消化": [
        "胃炎", "胃溃疡", "肠", "肝硬化", "肝", "胆", "胰", "阑尾",
        "便秘", "腹泻", "消化不良", "食物中毒", "食道", "食管", "消化性溃疡",
        "克罗恩", "乳糜", "反流", "脂肪肝",
    ],
    "呼吸": [
        "哮喘", "肺", "支气管", "感冒", "咳嗽", "鼻", "咽", "扁桃体",
        "胸膜", "慢阻肺", "呼吸",
    ],
    "神经精神": [
        "阿尔茨海默", "帕金森", "癫痫", "偏头痛", "头痛", "卒中", "神经",
        "眩晕", "头晕", "睡眠", "抑郁", "焦虑", "精神", "双相", "孤独症",
        "多动", "强迫", "惊恐", "应激", "失眠", "渐冻", "多发性硬化",
        "亨廷顿", "痴呆", "认知",
    ],
    "骨骼肌肉": [
        "关节炎", "骨质疏松", "痛风", "脊柱", "颈椎", "腰椎", "肩周",
        "骨", "肌肉", "腱", "背痛", "腰痛", "颈痛", "坐骨", "腕管", "骨折",
    ],
    "内分泌代谢": [
        "糖尿病", "肥胖", "甲状腺", "胆固醇", "血脂", "代谢", "库欣",
        "艾迪生", "低血糖", "胰岛素", "高脂",
    ],
    "泌尿": [
        "肾", "膀胱", "尿", "前列腺", "输尿",
    ],
    "皮肤": [
        "痤疮", "湿疹", "银屑病", "荨麻疹", "皮炎", "带状疱疹", "真菌",
        "疣", "脱发", "硬皮病", "红斑狼疮", "过敏",
    ],
    "眼耳鼻喉": [
        "青光眼", "白内障", "近视", "黄斑", "视网膜", "结膜炎", "干眼",
        "中耳炎", "耳鸣", "听力", "梅尼耶",
    ],
    "口腔": [
        "龋齿", "牙", "口腔", "牙龈",
    ],
    "血液免疫": [
        "贫血", "地中海", "镰状", "血友病", "血小板", "风湿", "系统性",
        "干燥", "强直", "狼疮", "免疫",
    ],
    "感染": [
        "结核", "肝炎", "HIV", "新冠", "流感", "疟疾", "登革热", "麻风",
        "志贺", "水痘", "麻疹", "腮腺炎", "风疹", "脓毒", "感染", "肺炎",
    ],
}

SYSTEM_ORDER = [
    "肿瘤", "心血管", "神经精神", "消化", "呼吸",
    "内分泌代谢", "骨骼肌肉", "泌尿", "血液免疫", "皮肤",
    "眼耳鼻喉", "口腔", "感染", "其他",
]


def classify(name: str) -> str:
    """把疾病名归类到人体系统"""
    for sys_name, keywords in SYSTEM_MAP.items():
        for kw in keywords:
            if kw in name:
                return sys_name
    return "其他"


def compute_layout(nodes, links, width=1400, height=800):
    """
    确定性环形布局：
      1. 疾病按系统分到 N 个扇区
      2. 每个系统占一个扇区，疾病均匀分布在该扇区的中环
      3. 基因放在它关联疾病的重心附近（外环）
    """
    diseases = [n for n in nodes if n["type"] == "disease"]
    genes = [n for n in nodes if n["type"] == "gene"]

    # 按系统分组
    groups = {}
    for d in diseases:
        sys_name = classify(d["name"])
        groups.setdefault(sys_name, []).append(d)

    sys_list = [s for s in SYSTEM_ORDER if s in groups]
    n_sys = len(sys_list)

    cx, cy = width / 2, height / 2
    R_inner = min(width, height) * 0.16    # 疾病内环
    R_mid = min(width, height) * 0.36      # 疾病外环
    R_gene = min(width, height) * 0.47     # 基因层

    # ---- 1. 疾病排布 ----
    # 每个系统占一个扇区，扇区内的疾病分内外两圈错开，
    # 避免所有疾病挤在同一条弧上导致标签重叠。
    sector = (math.pi * 2) / max(n_sys, 1)
    for si, sys_name in enumerate(sys_list):
        members = groups[sys_name]
        base = si * sector - math.pi / 2
        span = sector * 0.92          # 留出扇区间隙
        n_m = len(members)

        for i, d in enumerate(members):
            t = (i + 0.5) / n_m
            ang = base + (t - 0.5) * span

            # 内外圈交替：偶数在内圈，奇数在外圈
            ring = i % 2
            ring_r = R_inner if ring == 0 else R_mid
            # 再按三档做半径细分，进一步散开
            sub = (i // 2) % 3
            r = ring_r + (sub - 1) * min(width, height) * 0.055

            d["x"] = cx + math.cos(ang) * r
            d["y"] = cy + math.sin(ang) * r
            d["_ang"] = ang
            d["_sys"] = sys_name

    # ---- 2. 基因排布 ----
    # 建疾病 -> 基因 的映射
    disease_by_id = {d["id"]: d for d in diseases}
    gene_anchor = {}
    for l in links:
        src, tgt = l["source"], l["target"]
        d = disease_by_id.get(tgt)
        if not d or "_ang" not in d:
            continue
        gene_anchor.setdefault(src, []).append(d["_ang"])

    for gi, g in enumerate(genes):
        angs = gene_anchor.get(g["id"])
        if angs:
            # 关联多个疾病：取角度平均（处理跨 0 度）
            sx = sum(math.cos(a) for a in angs)
            sy = sum(math.sin(a) for a in angs)
            ang = math.atan2(sy, sx)
            # 关联越多越靠内
            pull = min(len(angs) / 8, 1.0)
            r = R_gene * (1.0 - pull * 0.34)
        else:
            # 孤立基因：均匀撒在外圈
            ang = (gi / max(len(genes), 1)) * math.pi * 2
            r = R_gene * 1.06

        # 同半径重叠打散
        jitter = ((gi * 2.399963) % (math.pi * 2)) * 0.06
        g["x"] = cx + math.cos(ang + jitter) * r
        g["y"] = cy + math.sin(ang + jitter) * r

    # ---- 3. 碰撞消解与收尾 ----
    # 说明：全量 O(n²) 在 3000+ 节点上太慢。
    # 前端默认只显示度数较高的核心节点，所以只对「会显示出来」的
    # 疾病 + 高度数基因做精细碰撞消解，其余基因保持均匀分布即可。
    disease_by_id = {d["id"]: d for d in diseases}
    gene_degree = {}
    for l in links:
        gene_degree[l["source"]] = gene_degree.get(l["source"], 0) + 1

    # 选出前端大概率会显示的基因（度数 >= 10）
    focus_genes = [g for g in genes if gene_degree.get(g["id"], 0) >= 10]
    focus = diseases + focus_genes

    print(f"  精细排布节点: {len(diseases)} 疾病 + {len(focus_genes)} 高连接基因")

    for _ in range(100):
        moved = False
        for i in range(len(focus)):
            a = focus[i]
            for j in range(i + 1, len(focus)):
                b = focus[j]
                dx = b["x"] - a["x"]
                dy = b["y"] - a["y"]
                d2 = dx * dx + dy * dy
                if a["type"] == "disease" and b["type"] == "disease":
                    min_d = 76
                elif a["type"] == "disease" or b["type"] == "disease":
                    min_d = 44
                else:
                    min_d = 28
                if d2 < min_d * min_d:
                    d = math.sqrt(d2) or 0.01
                    push = (min_d - d) / 2
                    ux, uy = dx / d, dy / d
                    a["x"] -= ux * push
                    a["y"] -= uy * push
                    b["x"] += ux * push
                    b["y"] += uy * push
                    moved = True
        if not moved:
            break

    # ---- 4. 收尾：把所有节点压回画布内 ----
    all_nodes = diseases + genes
    xs = [n["x"] for n in all_nodes]
    ys = [n["y"] for n in all_nodes]
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)
    pad = 45
    span_x = max(max_x - min_x, 1)
    span_y = max(max_y - min_y, 1)
    k = min((width - pad * 2) / span_x, (height - pad * 2) / span_y, 1.0)
    off_x = pad + ((width - pad * 2) - span_x * k) / 2
    off_y = pad + ((height - pad * 2) - span_y * k) / 2
    for n in all_nodes:
        n["x"] = off_x + (n["x"] - min_x) * k
        n["y"] = off_y + (n["y"] - min_y) * k

    return nodes


def main():
    base = os.path.dirname(__file__)
    src = os.path.join(base, "..", "src", "data", "graph-data.js")

    with open(src, "r", encoding="utf-8") as f:
        raw = f.read()

    # 提取 JSON 部分
    start = raw.index("const GRAPH_DATA = ") + len("const GRAPH_DATA = ")
    end = raw.index(";\n\nwindow.GRAPH_DATA")
    data = json.loads(raw[start:end])

    compute_layout(data["nodes"], data["links"])

    # 统计各系统分布
    groups = {}
    for n in data["nodes"]:
        if n["type"] == "disease" and "_sys" in n:
            groups[n["_sys"]] = groups.get(n["_sys"], 0) + 1
    print("=== 疾病系统分布 ===")
    for k in SYSTEM_ORDER:
        if k in groups:
            print(f"  {k:8} {groups[k]:3} 种")

    # 写入坐标（保留在节点里，前端直接用）
    for n in data["nodes"]:
        n.pop("_ang", None)
        n.pop("_sys", None)
        n["x"] = round(n.get("x", 0), 1)
        n["y"] = round(n.get("y", 0), 1)
    data["meta"]["layout"] = "static-radial"
    data["meta"]["layoutWidth"] = 1400
    data["meta"]["layoutHeight"] = 800

    out = "// 数据来源：Open Targets Platform (https://platform.opentargets.org)\n"
    out += "// 自动生成，请勿手工编辑。重新生成：python scripts/convert_data.py\n"
    out += "// 布局：静态环形（按疾病系统分区），坐标已预计算\n"
    out += "const GRAPH_DATA = " + json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    out += ";\n\nwindow.GRAPH_DATA = GRAPH_DATA;\n"

    with open(src, "w", encoding="utf-8") as f:
        f.write(out)

    print(f"\n输出: {src}  ({os.path.getsize(src)/1024:.1f} KB)")


if __name__ == "__main__":
    main()
