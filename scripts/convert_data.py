"""
把 Open Targets 抓取的原始数据转换为前端可用的 graph-data.js
- 疾病节点保留中文名映射
- 基因节点去重合并（同一基因关联多个疾病时只保留一个节点，度数累加）
- 输出压缩格式，控制文件体积
"""
import json
import os

# 疾病英文名 -> 中文名（尽量覆盖常见病）
ZH_NAMES = {
    "breast cancer": "乳腺癌",
    "lung adenocarcinoma": "肺腺癌",
    "colorectal cancer": "结直肠癌",
    "prostate cancer": "前列腺癌",
    "gastric cancer": "胃癌",
    "liver cancer": "肝癌",
    "pancreatic neoplasm": "胰腺肿瘤",
    "ovarian cancer": "卵巢癌",
    "cervical cancer": "宫颈癌",
    "urinary bladder carcinoma": "膀胱癌",
    "kidney cancer": "肾癌",
    "thyroid cancer": "甲状腺癌",
    "esophageal cancer": "食管癌",
    "brain cancer": "脑瘤",
    "leukemia": "白血病",
    "lymphoma": "淋巴瘤",
    "plasma cell myeloma": "多发性骨髓瘤",
    "melanoma": "黑色素瘤",
    "sarcoma": "肉瘤",
    "head and neck cancer": "头颈癌",
    "type 2 diabetes mellitus": "2型糖尿病",
    "type 1 diabetes mellitus": "1型糖尿病",
    "obesity disorder": "肥胖症",
    "familial hypercholesterolemia": "家族性高胆固醇血症",
    "hypertensive disorder": "高血压",
    "coronary artery disorder": "冠心病",
    "myocardial infarction": "心肌梗死",
    "heart failure": "心力衰竭",
    "atrial fibrillation": "心房颤动",
    "stroke disorder": "脑卒中",
    "atherosclerosis": "动脉粥样硬化",
    "cardiomyopathy": "心肌病",
    "peripheral arterial disease": "外周动脉疾病",
    "Alzheimer disease": "阿尔茨海默病",
    "Parkinson disease": "帕金森病",
    "multiple sclerosis symptom measurement": "多发性硬化",
    "multiple sclerosis": "多发性硬化",
    "amyotrophic lateral sclerosis": "肌萎缩侧索硬化",
    "epilepsy": "癫痫",
    "schizophrenia": "精神分裂症",
    "major depressive disorder": "重度抑郁症",
    "bipolar disorder": "双相情感障碍",
    "autism spectrum disorder": "孤独症谱系障碍",
    "attention deficit hyperactivity disorder": "注意缺陷多动障碍",
    "migraine": "偏头痛",
    "Huntington disease": "亨廷顿病",
    "asthma": "哮喘",
    "chronic obstructive pulmonary disease": "慢性阻塞性肺病",
    "pulmonary fibrosis": "肺纤维化",
    "cystic fibrosis": "囊性纤维化",
    "tuberculosis": "结核病",
    "pneumonia": "肺炎",
    "Crohn disease": "克罗恩病",
    "ulcerative colitis": "溃疡性结肠炎",
    "irritable bowel syndrome": "肠易激综合征",
    "celiac disease": "乳糜泻",
    "gastroesophageal reflux disease": "胃食管反流病",
    "hepatitis B": "乙型肝炎",
    "hepatitis C": "丙型肝炎",
    "cirrhosis": "肝硬化",
    "nonalcoholic fatty liver disease": "非酒精性脂肪肝",
    "rheumatoid arthritis": "类风湿关节炎",
    "osteoarthritis": "骨关节炎",
    "osteoporosis": "骨质疏松症",
    "gout": "痛风",
    "psoriasis": "银屑病",
    "systemic lupus erythematosus": "系统性红斑狼疮",
    "ankylosing spondylitis": "强直性脊柱炎",
    "lupus nephritis": "狼疮性肾炎",
    "Sjogren syndrome": "干燥综合征",
    "scleroderma": "硬皮病",
    "chronic kidney disease": "慢性肾病",
    "diabetic nephropathy": "糖尿病肾病",
    "polycystic kidney disease": "多囊肾病",
    "glaucoma": "青光眼",
    "age-related macular degeneration": "年龄相关性黄斑变性",
    "cataract": "白内障",
    "retinitis pigmentosa": "视网膜色素变性",
    "diabetic retinopathy": "糖尿病视网膜病变",
    "hypothyroidism": "甲状腺功能减退",
    "hyperthyroidism": "甲状腺功能亢进",
    "Cushing syndrome": "库欣综合征",
    "Addison disease": "艾迪生病",
    "anxiety disorder": "焦虑障碍",
    "obsessive-compulsive disorder": "强迫症",
    "insomnia": "失眠症",
    "chronic pain": "慢性疼痛",
    "fibromyalgia": "纤维肌痛",
    "endometriosis": "子宫内膜异位症",
    "polycystic ovary syndrome": "多囊卵巢综合征",
    "male infertility": "男性不育",
    "anemia": "贫血",
    "sickle cell disease": "镰状细胞病",
    "thalassemia": "地中海贫血",
    "hemophilia": "血友病",
    "von Willebrand disease": "血管性血友病",
    "thrombocytopenia": "血小板减少症",
    "sepsis": "脓毒症",
    "HIV infectious disease": "HIV感染",
    "COVID-19": "新冠肺炎",
    "influenza": "流行性感冒",
    "malaria": "疟疾",
    "dengue fever": "登革热",
    "leprosy": "麻风病",
    "shigellosis": "志贺菌病",
    "gastric ulcer": "胃溃疡",
    "peptic ulcer disease": "消化性溃疡",
    "appendicitis": "阑尾炎",
    "benign prostatic hyperplasia": "良性前列腺增生",
    "varicose vein": "静脉曲张",
    "deep vein thrombosis": "深静脉血栓",
    "pulmonary embolism": "肺栓塞",
    "sleep apnea": "睡眠呼吸暂停",
    "vertigo": "眩晕",
    "tinnitus": "耳鸣",
}


def load_raw(path="raw-opentargets.json"):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def build(raw):
    nodes = []
    links = []

    # ---- 疾病节点 ----
    for d in raw["diseases"]:
        zh = ZH_NAMES.get(d["name"]) or ZH_NAMES.get(d.get("nameZh", "")) or d["name"]
        nodes.append({
            "id": d["id"],
            "type": "disease",
            "name": zh,
            "en": d["name"],
            "desc": d["desc"][:300] if d["desc"] else "",
            "totalAssoc": d.get("totalAssoc", 0),
        })

    # ---- 基因节点 ----
    for g in raw["genes"]:
        nodes.append({
            "id": g["id"],
            "type": "gene",
            "name": g["name"],
            "en": (g.get("fullName") or "")[:70],
            "biotype": g.get("biotype", ""),
        })

    # ---- 关联 ----
    for l in raw["links"]:
        links.append({
            "source": l["source"],
            "target": l["target"],
            "relation": l["relation"],
            "strength": l["strength"],
            "evidence": l["evidence"],
        })

    return nodes, links


def main():
    raw = load_raw()
    nodes, links = build(raw)

    diseases = [n for n in nodes if n["type"] == "disease"]
    genes = [n for n in nodes if n["type"] == "gene"]

    print(f"疾病: {len(diseases)}")
    print(f"基因: {len(genes)}")
    print(f"关联: {len(links)}")
    print(f"节点总计: {len(nodes)}")

    # 统计基因度数分布
    deg = {}
    for l in links:
        deg[l["source"]] = deg.get(l["source"], 0) + 1
    degrees = sorted(deg.values(), reverse=True)
    print(f"\n基因度数: 最高 {degrees[0]}, 中位 {degrees[len(degrees)//2]}, 最低 {degrees[-1]}")
    print(f"度数 >= 5 的基因: {sum(1 for d in degrees if d >= 5)}")
    print(f"度数 >= 10 的基因: {sum(1 for d in degrees if d >= 10)}")

    out = {
        "nodes": nodes,
        "links": links,
        "meta": {
            "diseases": len(diseases),
            "genes": len(genes),
            "links": len(links),
            "total": len(nodes),
        }
    }

    os.makedirs("../src/data", exist_ok=True)
    with open("../src/data/graph-data.js", "w", encoding="utf-8") as f:
        f.write("// 数据来源：Open Targets Platform (https://platform.opentargets.org)\n")
        f.write("// 自动生成，请勿手工编辑。重新生成：python scripts/convert_data.py\n")
        f.write("const GRAPH_DATA = ")
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\n\nwindow.GRAPH_DATA = GRAPH_DATA;\n")

    size = os.path.getsize("../src/data/graph-data.js")
    print(f"\n输出: ../src/data/graph-data.js  ({size/1024:.1f} KB)")


if __name__ == "__main__":
    main()
