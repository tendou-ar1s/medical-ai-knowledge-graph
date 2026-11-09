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


def compute_layout(nodes, links, width=2800, height=1600):
    """星云式散点布局"""
    diseases = [n for n in nodes if n["type"] == "disease"]
    all_genes = [n for n in nodes if n["type"] == "gene"]

    # ---- 基因裁剪：只保留关联度足够高的基因 ----
    # 全量 2971 个基因里绝大多数只关联 1 个疾病，对理解图谱没帮助，
    # 反而把画面挤满。这里只留「度数 >= 2」的基因，
    # 总数控制在 1000 节点左右（199 疾病 + 约 800 基因）。
    gene_degree = {}
    for l in links:
        gene_degree[l["source"]] = gene_degree.get(l["source"], 0) + 1

    MIN_GENE_DEGREE = 2
    genes = [g for g in all_genes if gene_degree.get(g["id"], 0) >= MIN_GENE_DEGREE]

    GENE_BUDGET = 800
    if len(genes) > GENE_BUDGET:
        genes.sort(key=lambda g: gene_degree.get(g["id"], 0), reverse=True)
        genes = genes[:GENE_BUDGET]

    keep_gene_ids = {g["id"] for g in genes}
    keep_node_ids = {d["id"] for d in diseases} | keep_gene_ids

    print(f"  疾病 {len(diseases)} + 基因 {len(genes)}（原 {len(all_genes)}）= {len(keep_node_ids)} 节点")

    kept_links = [
        l for l in links
        if l["source"] in keep_gene_ids and l["target"] in keep_node_ids
    ]
    nodes[:] = [n for n in nodes if n["id"] in keep_node_ids]
    links[:] = kept_links

    # 重新取引用（nodes 已被替换）
    diseases = [n for n in nodes if n["type"] == "disease"]

    # 按系统分组（星云布局需要）
    groups = {}
    for d in diseases:
        sys_name = classify(d["name"])
        groups.setdefault(sys_name, []).append(d)

    sys_list = [s for s in SYSTEM_ORDER if s in groups]

    # ---- 星云分布 ----
    # 不用规则的环形，改成多个自然聚集的「星团」：
    # 每个疾病系统是一团，团与团之间错落分布，整体像星空。
    import random
    random.seed(20261109)      # 固定种子，保证布局可复现

    cx, cy = width / 2, height / 2

    # 生成若干星团中心（错落分布，不是圆周）
    n_clusters = max(len(sys_list), 9)
    cluster_centers = []
    for i in range(n_clusters):
        # 用黄金角 + 随机扰动，形成自然的散落感
        ang = i * 2.399963 + random.uniform(-0.5, 0.5)
        rad = min(width, height) * random.uniform(0.10, 0.36)
        cluster_centers.append({
            "x": cx + math.cos(ang) * rad * 1.7,
            "y": cy + math.sin(ang) * rad
        })

    # 疾病按系统分配到星团
    sys_to_cluster = {}
    for si, sys_name in enumerate(sys_list):
        sys_to_cluster[sys_name] = cluster_centers[si % n_clusters]

    for d in diseases:
        sys_name = classify(d["name"])
        c = sys_to_cluster.get(sys_name) or cluster_centers[len(diseases) % n_clusters]
        # 在星团内用高斯散布
        gauss_r = min(width, height) * 0.085
        d["x"] = c["x"] + random.gauss(0, gauss_r) * 1.5
        d["y"] = c["y"] + random.gauss(0, gauss_r)
        d["_ang"] = math.atan2(d["y"] - cy, d["x"] - cx)

    # 基因：围绕它关联的疾病散开，形成星云的「尘埃」层
    disease_by_id = {d["id"]: d for d in diseases}
    gene_anchors = {}
    for l in links:
        d = disease_by_id.get(l["target"])
        if d and "x" in d:
            gene_anchors.setdefault(l["source"], []).append((d["x"], d["y"]))

    for gi, g in enumerate(genes):
        anchors = gene_anchors.get(g["id"])
        if anchors:
            ax = sum(a[0] for a in anchors) / len(anchors)
            ay = sum(a[1] for a in anchors) / len(anchors)
            # 离关联疾病越远越稀疏
            spread = min(width, height) * (0.05 + min(len(anchors), 6) * 0.012)
            g["x"] = ax + random.gauss(0, spread) * 1.5
            g["y"] = ay + random.gauss(0, spread)
        else:
            # 孤立基因：撒在整个画布的星空中
            g["x"] = random.uniform(40, width - 40)
            g["y"] = random.uniform(40, height - 40)

    # 按系统分组
    groups = {}
    # ---- 3. 碰撞消解与收尾 ----
    # 星云布局追求「星星点点」的通透感，间距要够大。
    disease_by_id = {d["id"]: d for d in diseases}
    gene_degree = {}
    for l in links:
        gene_degree[l["source"]] = gene_degree.get(l["source"], 0) + 1

    focus_genes = [g for g in genes if gene_degree.get(g["id"], 0) >= 8]
    focus = diseases + focus_genes

    print(f"  精细排布节点: {len(diseases)} 疾病 + {len(focus_genes)} 高连接基因")

    for _ in range(90):
        moved = False
        for i in range(len(focus)):
            a = focus[i]
            for j in range(i + 1, len(focus)):
                b = focus[j]
                dx = b["x"] - a["x"]
                dy = b["y"] - a["y"]
                d2 = dx * dx + dy * dy
                if a["type"] == "disease" and b["type"] == "disease":
                    min_d = 175
                elif a["type"] == "disease" or b["type"] == "disease":
                    min_d = 100
                else:
                    min_d = 62
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
    data["meta"]["layoutWidth"] = 2800
    data["meta"]["layoutHeight"] = 1600
    data["meta"]["diseases"] = sum(1 for n in data["nodes"] if n["type"] == "disease")
    data["meta"]["genes"] = sum(1 for n in data["nodes"] if n["type"] == "gene")
    data["meta"]["links"] = len(data["links"])
    data["meta"]["total"] = len(data["nodes"])

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
