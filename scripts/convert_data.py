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


# ---------------------------------------------------------------
# 通俗化命名：把学术味太重的正式名称换成大众熟悉的说法
# 目的是让非医学专业的读者也能一眼看懂
# ---------------------------------------------------------------
PLAIN_NAMES = {
    # 心血管
    "heart disorder": "心脏病",
    "coronary artery disorder": "冠心病",
    "coronary heart disease": "冠心病",
    "cardiac arrhythmia": "心律失常",
    "hypertensive disorder": "高血压",
    "high blood pressure": "高血压",
    "myocardial infarction": "心肌梗死",
    "heart attack": "心肌梗死",
    "congestive heart failure": "心力衰竭",
    "heart failure": "心力衰竭",
    "atrial fibrillation": "心房颤动",
    "stroke disorder": "脑卒中",
    "atherosclerosis": "动脉粥样硬化",
    "rheumatic heart disease": "风湿性心脏病",
    "myocarditis": "心肌炎",
    "pericarditis": "心包炎",
    "varicose disease": "静脉曲张",
    "varicose veins": "静脉曲张",
    "hemorrhoid": "痔疮",
    "hemorrhoids": "痔疮",
    "deep vein thrombosis": "深静脉血栓",
    "pulmonary embolism": "肺栓塞",

    # 消化
    "gastritis": "胃炎",
    "gastroenteritis": "肠胃炎",
    "gastric ulcer": "胃溃疡",
    "duodenal ulcer": "十二指肠溃疡",
    "peptic ulcer disease": "消化性溃疡",
    "constipation": "便秘",
    "constipation disorder": "便秘",
    "diarrhea": "腹泻",
    "diarrheal disease": "腹泻",
    "gallstone": "胆结石",
    "gallstones": "胆结石",
    "cholecystitis": "胆囊炎",
    "pancreatitis": "胰腺炎",
    "fatty liver disease": "脂肪肝",
    "non-alcoholic fatty liver": "脂肪肝",
    "food poisoning": "食物中毒",
    "dyspepsia": "消化不良",
    "irritable bowel syndrome": "肠易激综合征",
    "appendicitis": "阑尾炎",

    # 呼吸
    "common cold": "感冒",
    "bronchitis": "支气管炎",
    "sinusitis": "鼻窦炎",
    "tonsillitis": "扁桃体炎",
    "pharyngitis": "咽炎",
    "allergic rhinitis": "过敏性鼻炎",
    "hay fever": "花粉症",
    "cough": "咳嗽",
    "pneumonia": "肺炎",
    "pleurisy": "胸膜炎",
    "bronchiectasis": "支气管扩张",
    "asthma": "哮喘",
    "bronchial asthma": "哮喘",

    # 神经/疼痛
    "headache": "头痛",
    "tension headache": "紧张性头痛",
    "migraine disorder": "偏头痛",
    "migraine": "偏头痛",
    "neuropathy": "神经病变",
    "carpal tunnel syndrome": "腕管综合征",
    "sciatica": "坐骨神经痛",
    "dizziness": "头晕",
    "central nervous system origin vertigo": "眩晕",
    "vertigo": "眩晕",

    # 骨骼肌肉
    "chronic back pain": "背痛",
    "back pain": "背痛",
    "low back pain": "腰痛",
    "neck pain": "颈痛",
    "arthritis": "关节炎",
    "osteoarthritis": "骨关节炎",
    "rheumatoid arthritis": "类风湿关节炎",
    "gout": "痛风",
    "scoliosis": "脊柱侧弯",
    "cervical spondylosis": "颈椎病",
    "spondylosis, cervical": "颈椎病",
    "lumbar disc herniation": "腰椎间盘突出",
    "frozen shoulder": "肩周炎",
    "tendinitis": "腱炎",
    "muscle strain": "肌肉拉伤",
    "osteoporosis": "骨质疏松症",
    "fracture": "骨折",

    # 内分泌代谢
    "type 1 diabetes mellitus": "1型糖尿病",
    "type 2 diabetes mellitus": "2型糖尿病",
    "diabetes mellitus": "糖尿病",
    "hypoglycemia": "低血糖",
    "hyperlipidemia": "高脂血症",
    "familial hypercholesterolemia": "家族性高胆固醇血症",
    "thyroid disease": "甲状腺疾病",
    "goiter": "甲状腺肿",
    "thyroiditis": "甲状腺炎",
    "hypothyroidism": "甲状腺功能减退",
    "hyperthyroidism": "甲状腺功能亢进",
    "obesity disorder": "肥胖症",
    "obesity": "肥胖症",
    "metabolic syndrome": "代谢综合征",
    "cushing syndrome": "库欣综合征",
    "chronic primary adrenal insufficiency": "艾迪生病",

    # 泌尿
    "urinary tract infection": "尿路感染",
    "kidney stone": "肾结石",
    "cystitis": "膀胱炎",
    "prostatitis": "前列腺炎",
    "benign prostatic hyperplasia": "前列腺增生",
    "incontinence": "尿失禁",
    "chronic kidney disease": "慢性肾病",
    "diabetic kidney disease": "糖尿病肾病",
    "polycystic kidney disease": "多囊肾病",
    "lupus nephritis": "狼疮性肾炎",

    # 皮肤
    "acne": "痤疮",
    "atopic eczema": "湿疹",
    "eczema": "湿疹",
    "psoriasis": "银屑病",
    "urticaria": "荨麻疹",
    "dermatitis": "皮炎",
    "shingles": "带状疱疹",
    "fungal infection": "真菌感染",
    "warts": "疣",
    "alopecia": "脱发",
    "scleroderma": "硬皮病",

    # 眼科耳鼻喉
    "conjunctivitis": "结膜炎",
    "allergic conjunctivitis": "过敏性结膜炎",
    "dry eye syndrome": "干眼症",
    "myopia": "近视",
    "cataract": "白内障",
    "glaucoma": "青光眼",
    "age-related macular degeneration": "黄斑变性",
    "retinitis pigmentosa": "视网膜色素变性",
    "diabetic retinopathy": "糖尿病视网膜病变",
    "otitis media": "中耳炎",
    "tinnitus": "耳鸣",
    "hearing loss": "听力损失",
    "meniere disease": "梅尼耶病",

    # 精神心理
    "anxiety disorder": "焦虑障碍",
    "anxiety": "焦虑",
    "major depressive disorder": "重度抑郁症",
    "depression": "抑郁症",
    "insomnia": "失眠症",
    "stress": "应激",
    "panic disorder": "惊恐障碍",
    "obsessive-compulsive disorder": "强迫症",
    "schizophrenia": "精神分裂症",
    "bipolar disorder": "双相情感障碍",
    "autism spectrum disorder": "孤独症谱系障碍",
    "attention deficit-hyperactivity disorder": "多动症",
    "attention deficit hyperactivity disorder": "多动症",

    # 口腔
    "dental caries": "龋齿",
    "periodontitis": "牙周炎",
    "gingivitis": "牙龈炎",
    "mouth ulcer": "口腔溃疡",

    # 感染
    "influenza": "流行性感冒",
    "orthomyxoviridae infectious disease": "流行性感冒",
    "chickenpox": "水痘",
    "measles": "麻疹",
    "mumps": "流行性腮腺炎",
    "rubella": "风疹",
    "hepatitis a": "甲型肝炎",
    "hepatitis b virus infection": "乙型肝炎",
    "hepatitis c virus infection": "丙型肝炎",
    "tuberculosis": "结核病",
    "malaria": "疟疾",
    "dengue disease": "登革热",
    "leprosy": "麻风病",
    "shigellosis": "志贺菌病",
    "hiv infectious disease": "HIV感染",
    "covid-19": "新冠肺炎",
    "bacterial infectious disease with sepsis": "脓毒症",
    "sepsis": "脓毒症",

    # 血液
    "anemia": "贫血",
    "iron deficiency anemia": "缺铁性贫血",
    "sickle cell disease": "镰状细胞病",
    "thalassemia": "地中海贫血",
    "hemophilia": "血友病",
    "von willebrand disease": "血管性血友病",
    "inherited thrombocytopenia": "血小板减少症",
    "thrombosis": "血栓形成",

    # 其他高频
    "fatigue": "疲劳",
    "fever": "发热",
    "allergy": "过敏",
    "sleep apnea syndrome": "睡眠呼吸暂停",
    "multisite chronic pain": "慢性疼痛",
    "fibromyalgia": "纤维肌痛",
    "endometriosis": "子宫内膜异位症",
    "polycystic ovary syndrome": "多囊卵巢综合征",
    "male infertility": "男性不育",
    "sjogren syndrome": "干燥综合征",
    "systemic lupus erythematosus": "红斑狼疮",
    "ankylosing spondylitis": "强直性脊柱炎",
    "celiac disease": "乳糜泻",
    "gastroesophageal reflux disease": "胃食管反流",
    "cirrhosis of liver": "肝硬化",
    "ulcerative colitis": "溃疡性结肠炎",
    "crohn disease": "克罗恩病",
    "pulmonary fibrosis": "肺纤维化",
    "cystic fibrosis": "囊性纤维化",
    "chronic obstructive pulmonary disease": "慢阻肺",
    "amyotrophic lateral sclerosis": "渐冻症",
    "huntington disease": "亨廷顿病",
    "multiple sclerosis": "多发性硬化",
    "multiple sclerosis symptom measurement": "多发性硬化",
    "alzheimer disease": "阿尔茨海默病",
    "parkinson disease": "帕金森病",
    "epilepsy": "癫痫",
}

# 知名基因白名单：这些基因是教科书级别的，优先保留
FAMOUS_GENES = {
    # 肿瘤相关（最知名）
    "TP53", "BRCA1", "BRCA2", "EGFR", "ALK", "KRAS", "BRAF", "PTEN",
    "RB1", "APC", "MYC", "HER2", "ERBB2", "PIK3CA", "ATM", "CHEK2",
    "PALB2", "CDH1", "MLH1", "MSH2", "VHL", "NF1", "NF2", "WT1",
    # 心血管
    "APOE", "LDLR", "PCSK9", "ACE", "AGTR1", "HMGCR", "MYH7", "TTN",
    "SCN5A", "KCNQ1", "KCNH2", "LMNA", "FBN1", "COL3A1",
    # 代谢
    "INS", "INSR", "GCK", "HNF1A", "HNF4A", "KCNJ11", "ABCC8", "PPARG",
    "LEP", "LEPR", "MC4R", "FTO",
    # 神经
    "APP", "PSEN1", "PSEN2", "SNCA", "LRRK2", "PARK2", "HTT", "SOD1",
    "C9orf72", "FMR1", "MECP2", "SCN1A", "DMD", "SMN1",
    # 免疫
    "HLA-DRB1", "HLA-B", "IL23R", "NOD2", "ATG16L1", "IL2RA", "CTLA4",
    "PTPN22", "TNF", "IL6", "STAT3",
    # 血液
    "HBB", "HBA1", "F8", "F9", "F5", "VWF", "G6PD",
    # 呼吸
    "CFTR", "SERPINA1", "TGFB1",
    # 眼科
    "RHO", "ABCA4", "MYOC", "CRYAA",
    # 其他
    "ASS1", "GBA", "HEXA", "PAH", "GAA", "IDUA",
}


def build(raw):
    nodes = []
    links = []

    # ---- 疾病节点 ----
    seen_disease_names = {}
    for d in raw["diseases"]:
        en_lower = (d["name"] or "").lower()
        # 优先级：通俗名映射 > 中文名 > 原名
        zh = (PLAIN_NAMES.get(en_lower)
              or ZH_NAMES.get(d["name"])
              or ZH_NAMES.get(d.get("nameZh", ""))
              or d["name"])

        # 同名疾病去重：保留关联数最多的那个
        if zh in seen_disease_names:
            prev_id = seen_disease_names[zh]
            prev = next((n for n in nodes if n["id"] == prev_id), None)
            if prev and prev.get("totalAssoc", 0) >= d.get("totalAssoc", 0):
                continue
            # 新的关联更多，替换旧的
            nodes = [n for n in nodes if n["id"] != prev_id]
            links = [l for l in links if l["target"] != prev_id]

        seen_disease_names[zh] = d["id"]
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
            "famous": g["name"] in FAMOUS_GENES,
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
    if degrees:
        print(f"\n基因度数: 最高 {degrees[0]}, 中位 {degrees[len(degrees)//2]}, 最低 {degrees[-1]}")
        print(f"度数 >= 5 的基因: {sum(1 for d in degrees if d >= 5)}")
        print(f"度数 >= 10 的基因: {sum(1 for d in degrees if d >= 10)}")

    famous_count = sum(1 for g in genes if g.get("famous"))
    print(f"知名基因（白名单）: {famous_count}")

    # 疾病名称抽样展示
    print("\n疾病名称示例（前 25 个）:")
    for d in diseases[:25]:
        print(f"  {d['name']}")

    out = {
        "nodes": nodes,
        "links": links,
        "meta": {
            "diseases": len(diseases),
            "genes": len(genes),
            "links": len(links),
            "total": len(nodes),
            "famousGenes": famous_count,
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
