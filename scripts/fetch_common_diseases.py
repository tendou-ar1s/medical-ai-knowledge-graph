"""
补充抓取「耳熟能详」的常见病数据
目标：让图谱里的病名更贴近日常认知
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fetch_opentargets as F

# 通俗常见病（英文检索词）
COMMON_DISEASES = [
    # 心血管（最常被提及的）
    "heart disease", "coronary heart disease", "cardiac arrhythmia",
    "high blood pressure", "heart attack", "congestive heart failure",
    "myocarditis", "pericarditis", "rheumatic heart disease",
    "varicose veins", "hemorrhoids",
    # 消化系统（日常高频）
    "gastritis", "gastroenteritis", "gastric ulcer", "duodenal ulcer",
    "constipation", "diarrhea", "hemorrhoid", "gallstone",
    "cholecystitis", "pancreatitis", "hepatitis", "fatty liver disease",
    "food poisoning", "dyspepsia", "irritable bowel syndrome",
    # 呼吸系统
    "common cold", "bronchitis", "sinusitis", "tonsillitis",
    "pharyngitis", "allergic rhinitis", "hay fever", "cough",
    "pneumonia", "pleurisy", "bronchiectasis",
    # 神经/疼痛
    "headache", "tension headache", "migraine", "neuropathy",
    "carpal tunnel syndrome", "sciatica", "dizziness",
    # 骨骼肌肉
    "back pain", "low back pain", "neck pain", "arthritis",
    "rheumatoid arthritis", "gout", "scoliosis", "cervical spondylosis",
    "lumbar disc herniation", "frozen shoulder", "tendinitis",
    "muscle strain", "osteoporosis", "fracture",
    # 内分泌代谢
    "diabetes mellitus", "hypoglycemia", "hyperlipidemia",
    "thyroid disease", "goiter", "thyroiditis",
    # 泌尿
    "urinary tract infection", "kidney stone", "cystitis",
    "prostatitis", "benign prostatic hyperplasia", "incontinence",
    # 皮肤
    "acne", "eczema", "psoriasis", "urticaria", "dermatitis",
    "shingles", "fungal infection", "warts", "alopecia",
    # 眼科耳鼻喉
    "conjunctivitis", "dry eye syndrome", "myopia", "cataract",
    "glaucoma", "otitis media", "tinnitus", "vertigo", "hearing loss",
    # 精神心理
    "anxiety", "depression", "insomnia", "stress", "panic disorder",
    # 口腔
    "dental caries", "periodontitis", "gingivitis", "mouth ulcer",
    # 感染
    "influenza", "chickenpox", "measles", "mumps", "rubella",
    "hepatitis A", "hepatitis B", "tuberculosis", "malaria", "dengue",
    # 血液
    "anemia", "iron deficiency anemia", "thrombosis",
    # 其他高频
    "obesity", "metabolic syndrome", "fatigue", "fever", "allergy",
    "asthma", "bronchial asthma", "allergic conjunctivitis",
]


def load_existing():
    raw_path = os.path.join(os.path.dirname(__file__), "raw-opentargets.json")
    if os.path.exists(raw_path):
        with open(raw_path, "r", encoding="utf-8") as f:
            return json.load(f)
    return {"diseases": [], "genes": [], "links": []}


def main():
    print("=== 补充抓取常见病 ===")
    existing = load_existing()

    # 已有疾病 id 集合，避免重复
    existing_ids = {d["id"] for d in existing["diseases"]}
    existing_genes = {g["id"]: g for g in existing["genes"]}
    existing_links = {(l["source"], l["target"]) for l in existing["links"]}

    added_d = 0
    added_l = 0

    total = len(COMMON_DISEASES)
    for i, name in enumerate(COMMON_DISEASES, 1):
        print(f"[{i}/{total}] {name}", end=" ... ", flush=True)

        hit = F.search_disease(name)
        if not hit:
            print("未找到")
            continue

        did = hit["id"]
        if did in existing_ids:
            print(f"已存在: {hit['name'][:35]}")
            continue

        detail = F.get_disease_detail(did, max_targets=30)
        if not detail:
            print("详情失败")
            continue

        targets = detail.get("associatedTargets") or {}
        rows = targets.get("rows") or []

        desc = (detail.get("description") or "").strip()
        existing["diseases"].append({
            "id": did,
            "name": detail.get("name") or name,
            "nameZh": name,
            "desc": desc[:420],
            "totalAssoc": targets.get("count", 0),
            "targetCount": len(rows),
        })
        existing_ids.add(did)
        added_d += 1

        for row in rows:
            t = row.get("target") or {}
            sym = t.get("approvedSymbol")
            if not sym:
                continue
            gid = "g:" + sym
            score = row.get("score") or 0

            if gid not in existing_genes:
                existing_genes[gid] = {
                    "id": gid,
                    "name": sym,
                    "fullName": (t.get("approvedName") or "")[:90],
                    "biotype": t.get("biotype") or "",
                    "ensembl": t.get("id") or "",
                }

            key = (gid, "d:" + did)
            if key in existing_links:
                continue

            existing["links"].append({
                "source": gid,
                "target": "d:" + did,
                "relation": "疾病关联",
                "strength": round(min(10, max(1, score * 10)), 2),
                "evidence": f"Open Targets 关联评分 {score:.3f}",
            })
            existing_links.add(key)
            added_l += 1

        print(f"OK {detail.get('name','')[:32]} 靶点 {len(rows)}")

    existing["genes"] = list(existing_genes.values())
    existing["stats"] = {
        "diseases": len(existing["diseases"]),
        "genes": len(existing["genes"]),
        "links": len(existing["links"]),
    }

    out_path = os.path.join(os.path.dirname(__file__), "raw-opentargets.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(existing, f, ensure_ascii=False, indent=1)

    print(f"\n===== 完成 =====")
    print(f"新增疾病: {added_d}")
    print(f"新增关联: {added_l}")
    print(f"累计疾病: {existing['stats']['diseases']}")
    print(f"累计基因: {existing['stats']['genes']}")
    print(f"累计关联: {existing['stats']['links']}")


if __name__ == "__main__":
    main()
