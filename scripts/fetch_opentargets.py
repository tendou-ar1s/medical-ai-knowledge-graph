"""
从 Open Targets Platform 批量抓取真实生物医学知识图谱数据
输出：疾病-基因关联 + 疾病元信息
"""
import json
import time
import urllib.request
import urllib.error

API = "https://api.platform.opentargets.org/api/v4/graphql"

# 常见疾病清单（英文名 -> 用于 Open Targets 搜索）
COMMON_DISEASES = [
    "breast cancer", "lung adenocarcinoma", "colorectal cancer", "prostate cancer",
    "stomach cancer", "liver cancer", "pancreatic cancer", "ovarian cancer",
    "cervical cancer", "bladder cancer", "kidney cancer", "thyroid cancer",
    "esophageal cancer", "brain cancer", "leukemia", "lymphoma",
    "multiple myeloma", "melanoma", "sarcoma", "head and neck cancer",
    "type 2 diabetes mellitus", "type 1 diabetes mellitus", "obesity",
    "hypercholesterolemia", "hypertension", "coronary artery disease",
    "myocardial infarction", "heart failure", "atrial fibrillation", "stroke",
    "atherosclerosis", "cardiomyopathy", "peripheral arterial disease",
    "alzheimer disease", "parkinson disease", "multiple sclerosis",
    "amyotrophic lateral sclerosis", "epilepsy", "schizophrenia",
    "major depressive disorder", "bipolar disorder", "autism spectrum disorder",
    "attention deficit hyperactivity disorder", "migraine", "huntington disease",
    "asthma", "chronic obstructive pulmonary disease", "pulmonary fibrosis",
    "cystic fibrosis", "tuberculosis", "pneumonia",
    "crohn disease", "ulcerative colitis", "irritable bowel syndrome",
    "celiac disease", "gastroesophageal reflux disease", "hepatitis B",
    "hepatitis C", "cirrhosis", "nonalcoholic fatty liver disease",
    "rheumatoid arthritis", "osteoarthritis", "osteoporosis", "gout",
    "psoriasis", "systemic lupus erythematosus", "ankylosing spondylitis",
    "lupus nephritis", "Sjogren syndrome", "scleroderma",
    "chronic kidney disease", "diabetic nephropathy", "polycystic kidney disease",
    "glaucoma", "age-related macular degeneration", "cataract",
    "retinitis pigmentosa", "diabetic retinopathy",
    "hypothyroidism", "hyperthyroidism", "Cushing syndrome", "Addison disease",
    "anxiety disorder", "obsessive-compulsive disorder", "insomnia",
    "chronic pain", "fibromyalgia", "endometriosis", "polycystic ovary syndrome",
    "male infertility", "anemia", "sickle cell disease", "thalassemia",
    "hemophilia", "von Willebrand disease", "thrombocytopenia",
    "sepsis", "HIV infectious disease", "COVID-19", "influenza",
    "malaria", "dengue fever", "leprosy", "shigellosis",
    "gastric ulcer", "peptic ulcer disease", "appendicitis",
    "benign prostatic hyperplasia", "varicose vein", "deep vein thrombosis",
    "pulmonary embolism", "sleep apnea", "vertigo", "tinnitus",
]


def gql(query: str, retries: int = 3) -> dict:
    payload = json.dumps({"query": query}).encode("utf-8")
    for attempt in range(retries):
        try:
            req = urllib.request.Request(
                API,
                data=payload,
                headers={"Content-Type": "application/json", "User-Agent": "BiomedKG/1.0"},
            )
            with urllib.request.urlopen(req, timeout=45) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception as e:
            if attempt == retries - 1:
                raise
            time.sleep(2 * (attempt + 1))
    return {}


def search_disease(name: str):
    """搜索疾病，返回最匹配的 MONDO/EFO ID"""
    esc = name.replace('"', '\\"')
    q = (
        '{ search(queryString: "%s", entityNames: ["disease"], page: {index:0, size:3}) '
        '{ hits { id name entity } } }' % esc
    )
    try:
        r = gql(q)
        hits = r.get("data", {}).get("search", {}).get("hits", [])
        for h in hits:
            nid = h.get("id", "")
            if nid.startswith(("MONDO_", "EFO_", "Orphanet_")):
                return {"id": nid, "name": h.get("name")}
        return hits[0] if hits else None
    except Exception as e:
        print("  search failed:", e)
        return None


def get_disease_detail(disease_id: str, max_targets: int = 40):
    """获取疾病详情与关联靶点"""
    q = (
        '{ disease(efoId: "%s") { id name description '
        "associatedTargets(page: {index:0, size:%d}) { count rows { "
        "target { id approvedSymbol approvedName biotype } score } } } }"
    ) % (disease_id, max_targets)
    try:
        r = gql(q)
        return r.get("data", {}).get("disease")
    except Exception as e:
        print("  detail failed:", e)
        return None


def main():
    out_diseases = []
    out_genes = {}
    out_links = []
    seen_gene = set()

    total = len(COMMON_DISEASES)
    for i, name in enumerate(COMMON_DISEASES, 1):
        print(f"[{i}/{total}] {name}", end=" ... ", flush=True)
        hit = search_disease(name)
        if not hit:
            print("未找到")
            continue

        detail = get_disease_detail(hit["id"], max_targets=40)
        if not detail:
            print("详情失败")
            continue

        did = detail["id"]
        dname = detail.get("name") or name
        targets = detail.get("associatedTargets", {}) or {}
        rows = targets.get("rows", []) or []
        total_assoc = targets.get("count", 0)

        # 疾病节点
        desc = (detail.get("description") or "").strip()
        out_diseases.append({
            "id": "d:" + did,
            "name": dname,
            "nameZh": name,
            "desc": desc[:420],
            "totalAssoc": total_assoc,
            "targetCount": len(rows),
        })

        # 靶点 + 关联
        added = 0
        for row in rows:
            t = row.get("target") or {}
            sym = t.get("approvedSymbol")
            if not sym:
                continue
            gid = "g:" + sym
            score = row.get("score") or 0

            if gid not in out_genes:
                out_genes[gid] = {
                    "id": gid,
                    "name": sym,
                    "fullName": (t.get("approvedName") or "")[:90],
                    "biotype": t.get("biotype") or "",
                    "ensembl": t.get("id") or "",
                }
            out_links.append({
                "source": gid,
                "target": "d:" + did,
                "relation": "疾病关联",
                "strength": round(min(10, max(1, score * 10)), 2),
                "evidence": f"Open Targets 关联评分 {score:.3f}",
            })
            added += 1

        print(f"OK  {dname[:38]}  靶点 {added} / 总 {total_assoc}")
        time.sleep(0.35)

    result = {
        "diseases": out_diseases,
        "genes": list(out_genes.values()),
        "links": out_links,
        "stats": {
            "diseases": len(out_diseases),
            "genes": len(out_genes),
            "links": len(out_links),
        },
    }

    with open("raw-opentargets.json", "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=1)

    print("\n===== 完成 =====")
    print(f"疾病: {len(out_diseases)}")
    print(f"基因: {len(out_genes)}")
    print(f"关联: {len(out_links)}")


if __name__ == "__main__":
    main()
