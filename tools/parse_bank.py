# -*- coding: utf-8 -*-
"""Parse the 600-question docx question bank into structured JSON + JS bundle.

Outputs:
  data/questions.json   - canonical structured bank
  src/questions.js      - same data as `globalThis.QUESTION_BANK` (works from file://)
  data/parse_report.txt - QA report
"""
import json
import re
from docx import Document

SRC = r'3_技能鉴定初级题库（2018年新版）.docx'
OUT_JSON = r'data\questions.json'
OUT_JS = r'src\questions.js'
REPORT = r'data\parse_report.txt'

doc = Document(SRC)
paras = [p.text for p in doc.paragraphs]

SEC_RE = re.compile(r'^[一二三四五六七八九十]\s*[:：]\s*(.+?)\(共\s*(\d+)\s*小题')
NUM_RE = re.compile(r'^\s*(\d+)\s*[.．、]\s*')
SCORE_RE = re.compile(r'[（(]\s*([\d.]+)\s*分\s*[)）]\s*$')
OPT_RE = re.compile(r'^[\s\u3000]*([A-HＡ-Ｈ])\s*[:：．.]\s*(.*)$')
ANS_RE = re.compile(r'答案\s*[:：]\s*([A-Ha-h]?)\s*$')
JUDGE_BLANK_RE = re.compile(r'^[（(]\s*[)）]\s*')

# --- automatic knowledge-point tagging (keyword scoring) -------------------
CATEGORY_RULES = [
    ('加油卡业务', ['加油卡', '充值', '积分', '圈存', '圈提', '灰卡', '白卡', '记名卡',
                    '发卡', '售卡', '卡账户', '备用金', '预个人化', '密码', '开卡', '挂失']),
    ('加油机与设备', ['加油机', '加油枪', '潜油泵', '流量计', '拉断阀', '电磁阀', '油气回收',
                      '油气分离器', '集气罩', '防爆', '油路', '电路', '视油器', '万向接头',
                      '泵码', '紧急切断阀', '静电释放']),
    ('人民币与验钞', ['人民币', '验钞机', '假币', '水印', '安全线', '钞票', '防伪', '光变油墨',
                      '紫光', '磁性', '点钞', '变造币', '拼凑币', '纸币']),
    ('便利店运营', ['便利店', '陈列', '理货', '临期', '商品', '收货', '库存', '货架', '促销',
                    '价格标签', '贵重商品', '上货', '盘点', '订货', '退货']),
    ('客户服务', ['顾客', '客户', '服务', '投诉', '唱收唱付', '销售技巧', '纠纷', '满意',
                  '问候', '接待', '预订', '失物', '遗失物品']),
    ('安全与消防', ['消防', '灭火器', '火灾', '安全', '应急', '抢劫', '跑单', '偷盗', '报警',
                    '消防沙', '吸油', '冒油', '漏油', '警示', '防护', '危险']),
    ('汽车与油品', ['汽车', '发动机', '机油', '燃油', '油箱', '润滑油', '燃料', '柴油', '汽油',
                    '油品', '计量', '油表']),
    ('财务与发票', ['发票', '增值税', '税', '财务', '报销', '银行', '进账单', '转账', '支付']),
    ('站务与现场管理', ['加油站', '巡检', '交接班', '卫生间', '厨房', '淋浴', '清洁', '设备',
                        '台账', '记录', '管理', '规范']),
]

sections = []
current = None
for idx, raw in enumerate(paras):
    text = raw.replace('\r', '')
    m = SEC_RE.match(text.strip())
    if m:
        current = {'title': m.group(1).strip(), 'declared': int(m.group(2)), 'raw': []}
        sections.append(current)
        continue
    if current is not None and text.strip():
        current['raw'].append((idx, text))

questions = []
anomalies = []


def norm(s: str) -> str:
    s = s.replace('\u3000', ' ').replace('\xa0', ' ')
    s = re.sub(r'[ \t]+', ' ', s)
    return s.strip()


def categorize(text: str) -> str:
    best, best_score = '其他', 0
    for name, words in CATEGORY_RULES:
        score = sum(1 for w in words if w in text)
        if score > best_score:
            best, best_score = name, score
    return best


qid = 0
for sec in sections:
    qtype = 'judge' if '判断' in sec['title'] else 'single'
    for idx, text in sec['raw']:
        lines = text.split('\n')
        num = None
        m = NUM_RE.match(lines[0])
        if m:
            num = int(m.group(1))
        options = []
        answer = ''
        stem_lines = []
        for li, l in enumerate(lines):
            ls = l.strip()
            if not ls:
                continue
            if '答案' in ls:
                am = ANS_RE.search(ls)
                if am:
                    answer = am.group(1).upper()
                    continue
            om = OPT_RE.match(l)
            if om:
                options.append({'key': om.group(1), 'text': norm(om.group(2))})
                continue
            if not options:
                if li == 0:
                    ls = NUM_RE.sub('', ls)
                stem_lines.append(norm(ls))
        stem = ' '.join(x for x in stem_lines if x)
        sm = SCORE_RE.search(stem)
        score = float(sm.group(1)) if sm else 0.5
        stem = SCORE_RE.sub('', stem).strip()
        if qtype == 'judge':
            stem = JUDGE_BLANK_RE.sub('', stem).strip()
        qid += 1
        q = {
            'id': qid,
            'no': num,
            'type': qtype,
            'stem': stem,
            'options': options,
            'answer': answer,
            'score': score,
            'category': categorize(stem + ' ' + ' '.join(o['text'] for o in options)),
        }
        questions.append(q)
        if not answer:
            anomalies.append(f'#{qid} (第{num}题) 缺少答案: {stem[:60]}')
        elif answer not in [o['key'] for o in options]:
            anomalies.append(f'#{qid} (第{num}题) 答案 {answer} 不在选项中: {stem[:60]}')
        if len(options) < 2:
            anomalies.append(f'#{qid} (第{num}题) 选项不足 ({len(options)}): {stem[:60]}')

by_stem = {}
for q in questions:
    by_stem.setdefault(q['stem'], []).append(q)
dup_groups = {k: v for k, v in by_stem.items() if len(v) > 1}
for stem, qs in dup_groups.items():
    answers = {q['answer'] for q in qs if q['answer']}
    if len(answers) > 1:
        anomalies.append('同题不同答案: ' + stem[:60] + ' -> ' + str([(q['id'], q['answer']) for q in qs]))

cat_counts = {}
for q in questions:
    cat_counts[q['category']] = cat_counts.get(q['category'], 0) + 1

data = {
    'meta': {
        'title': '新版技能鉴定初级（2018年新版）',
        'source': SRC,
        'total': len(questions),
        'singleCount': sum(1 for q in questions if q['type'] == 'single'),
        'judgeCount': sum(1 for q in questions if q['type'] == 'judge'),
        'duplicateStemGroups': len(dup_groups),
        'categories': cat_counts,
    },
    'questions': questions,
}

with open(OUT_JSON, 'w', encoding='utf-8') as f:
    json.dump(data, f, ensure_ascii=False, indent=1)
with open(OUT_JS, 'w', encoding='utf-8') as f:
    f.write('/* Auto-generated from %s. Do not edit by hand. */\n' % SRC)
    f.write('globalThis.QUESTION_BANK = ')
    json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
    f.write(';\n')
with open(REPORT, 'w', encoding='utf-8') as f:
    f.write(f'total={len(questions)} single={data["meta"]["singleCount"]} '
            f'judge={data["meta"]["judgeCount"]} anomalies={len(anomalies)}\n')
    f.write(f'section declared: {[(s["title"], s["declared"], len(s["raw"])) for s in sections]}\n')
    f.write(f'duplicate stem groups={len(dup_groups)}\n')
    f.write('categories: ' + json.dumps(cat_counts, ensure_ascii=False) + '\n')
    f.write('\n'.join(anomalies))

print(f'total={len(questions)} single={data["meta"]["singleCount"]} '
      f'judge={data["meta"]["judgeCount"]} anomalies={len(anomalies)}')
