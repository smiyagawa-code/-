# Lepont デモ用の架空データ（sales-vault/ACS株式会社/demo/*.csv）から src/source.js を作る。
# 使い方: python3 tools/build_source.py <demo フォルダ>
# CSV はすべて架空データ（README 参照）。本物の顧客データは入れない。
import csv, glob, json, os, sys

demo = sys.argv[1]
out = os.path.join(os.path.dirname(__file__), '..', 'src', 'source.js')
MAKERS = ['SMC株式会社', '東和空圧工業株式会社', '中央精密機器株式会社']

def read(path):
    with open(path, encoding='utf-8-sig') as f:
        return list(csv.DictReader(f))

inv = {}
for path in sorted(glob.glob(os.path.join(demo, '*_在庫データ_*.csv'))):
    maker = os.path.basename(path).split('_')[0]
    for r in read(path):
        inv[r['品目コード']] = (maker, r)

fc = read(glob.glob(os.path.join(demo, 'フォーキャストデータ_*.csv'))[0])
ship = read(glob.glob(os.path.join(demo, '出荷実績データ_*.csv'))[0])

equips, persons = [], []
def idx(lst, v):
    if v not in lst: lst.append(v)
    return lst.index(v)

demand = {}
for r in fc:
    d = demand.setdefault(r['品目コード'], {'eq': idx(equips, r['用途設備名']), 'p': idx(persons, r['発注担当者']), 'price': int(r['参考単価']), 'q': {}})
    d['q'][r['対象年月']] = int(r['予定使用数量'])

months = sorted({r['対象年月'] for r in ship})
ships = {}
for r in ship:
    ships.setdefault(r['品目コード'], {})[r['対象年月']] = int(r['出荷実績数量'])

rows = []
for code, (maker, r) in inv.items():
    d = demand[code]
    rows.append([
        code, r['品名'], r['カテゴリ'], MAKERS.index(maker),
        int(r['有効在庫数']), int(r['入荷予定数'] or 0), r['次回入荷予定日'], int(r['発注リードタイム_日数']),
        int(r['最小発注ロット']), r['単位'], d['price'], d['eq'], d['p'],
        [d['q'].get(m, 0) for m in ('2026-09', '2026-10', '2026-11')],
        [ships[code][m] for m in months],
    ])

customer = fc[0]['顧客名']
due = sorted({r['希望納期'] for r in fc})
with open(out, 'w', encoding='utf-8') as f:
    f.write('// 自動生成（tools/build_source.py）。手で直さない。元は sales-vault/ACS株式会社/demo の架空 CSV。\n')
    f.write('// 品目: [品目コード, 品名, カテゴリ, メーカー番号, 有効在庫数, 入荷予定数, 次回入荷予定日, 発注LT_日, 最小発注ロット, 単位, 参考単価_円, 用途設備番号, 発注担当者番号, [9月確定, 10月内示, 11月内示], [出荷実績 12か月]]\n')
    for name, val in [('MAKERS', MAKERS), ('EQUIPS', equips), ('PERSONS', persons), ('SHIP_MONTHS', months), ('DUE_DATES', due), ('CUSTOMER', customer), ('BASE_DATE', '2026-09-05')]:
        f.write(f'export const {name} = {json.dumps(val, ensure_ascii=False)};\n')
    f.write('export const ITEMS = [\n')
    for row in rows:
        f.write('  ' + json.dumps(row, ensure_ascii=False) + ',\n')
    f.write('];\n')
print(len(rows), 'items', equips, persons, due)
