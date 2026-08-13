"""
AppWise Insights - data preparation.

Reads the source application inventory (the Hackathon Mock Data workbook) and adds
ONLY the three enrichments agreed with the business:

  1. Key            -> Application ID          (required to express dependency edges)
  2. Type           -> Asset Type              (Application / SaaS / AI Tool / AI Agent / Platform / Custom)
  3. Contract timing-> Contract Start Date, Contract End Date, Auto Renew, Notice Period Days

It also varies the sub-capability tokens per application. In the source file every row
inside a category carries the identical three tokens, which makes "Business Capability"
a duplicate of "Category" and useless for overlap detection. Here each application covers
a realistic SUBSET of its category's capabilities, plus occasional bleed into an adjacent
category - so functional overlap becomes a percentage rather than all-or-nothing.

Risk and dependencies are deliberately NOT added here. Those are inferred by the
application at ingest time (see docs/METHODOLOGY.md).

Outputs: data/portfolio_enriched.csv, data/portfolio_enriched.xlsx, data/portfolio.json
Deterministic: seeded, so reruns reproduce byte-identical output.
"""

import argparse
import csv
import json
import os
import random
import re
import sys
import zipfile
from datetime import date, timedelta
from xml.etree import ElementTree as ET

NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
SEED = 20260813
ASOF = date(2026, 8, 13)

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, 'data')

SRC = sys.argv[1] if len(sys.argv) > 1 else \
    r'C:\Users\MauricioBueno\Documents\Hackathon Mock Data - Copilot.xlsx'


# --------------------------------------------------------------------------
# read the source workbook (stdlib only - no openpyxl dependency)
# --------------------------------------------------------------------------

def read_xlsx(path):
    z = zipfile.ZipFile(path)
    shared = []
    if 'xl/sharedStrings.xml' in z.namelist():
        for si in ET.fromstring(z.read('xl/sharedStrings.xml')).findall(NS + 'si'):
            shared.append(''.join(t.text or '' for t in si.iter(NS + 't')))

    def colnum(ref):
        n = 0
        for ch in re.match(r'([A-Z]+)', ref or 'A').group(1):
            n = n * 26 + (ord(ch) - 64)
        return n - 1

    def cellval(c):
        t, v = c.get('t'), c.find(NS + 'v')
        if t == 's' and v is not None:
            return shared[int(v.text)]
        isel = c.find(NS + 'is')
        if isel is not None:
            return ''.join(x.text or '' for x in isel.iter(NS + 't'))
        return v.text if v is not None else ''

    rows = []
    for r in ET.fromstring(z.read('xl/worksheets/sheet1.xml')).iter(NS + 'row'):
        cells = {colnum(c.get('r')): cellval(c) for c in r.iter(NS + 'c')}
        if not cells:
            continue
        width = max(cells) + 1
        vals = [(cells.get(i) or '').strip() for i in range(width)]
        if any(vals):
            rows.append(vals)
    hdr = rows[0]
    return hdr, [r + [''] * (len(hdr) - len(r)) for r in rows[1:]]


# --------------------------------------------------------------------------
# capability model
# --------------------------------------------------------------------------

# Adjacent categories genuinely share capability surface. Used for capability
# "bleed" so overlap groups are not perfectly aligned to Category.
ADJACENT = {
    'CRM': ['Sales Enablement', 'Marketing', 'Customer Service'],
    'Sales Enablement': ['CRM', 'Marketing'],
    'Marketing': ['CRM', 'Analytics & BI'],
    'Customer Service': ['CRM', 'Collaboration'],
    'ERP': ['Finance', 'Industry Operations'],
    'Finance': ['ERP', 'Analytics & BI'],
    'HR & Talent': ['Collaboration', 'Legal & Compliance'],
    'Analytics & BI': ['Data Platform', 'Marketing'],
    'Data Platform': ['Analytics & BI', 'AI & Automation'],
    'AI & Automation': ['Data Platform', 'Engineering', 'Collaboration'],
    'Cybersecurity': ['IT Operations', 'Legal & Compliance'],
    'IT Operations': ['Cybersecurity', 'Engineering'],
    'Engineering': ['IT Operations', 'AI & Automation'],
    'Collaboration': ['Customer Service', 'HR & Talent'],
    'Legal & Compliance': ['Cybersecurity', 'HR & Talent'],
    'Industry Operations': ['ERP', 'IT Operations'],
}

AI_VENDORS = {'OpenAI', 'Anthropic'}
PLATFORM_VENDORS = {'AWS', 'Databricks', 'Snowflake', 'Oracle', 'IBM', 'Google', 'Microsoft'}
PLATFORM_CATS = {'Data Platform', 'IT Operations', 'Engineering'}
AGENT_HINTS = ('Automation', 'Agent', 'Hub', 'Bot')


def asset_type(name, vendor, category, rng):
    """Classify the row into the populations the CIO actually reasons about."""
    if vendor == 'Internal IT':
        return 'Custom Application'
    if category == 'AI & Automation':
        return 'AI Agent' if any(h in name for h in AGENT_HINTS) and rng.random() < 0.55 else 'AI Tool'
    if vendor in AI_VENDORS:
        # An AI vendor sitting outside the AI category is exactly the sprawl we want to surface.
        return 'AI Tool'
    if vendor in PLATFORM_VENDORS and category in PLATFORM_CATS:
        return 'Platform'
    return 'SaaS Subscription'


def capability_subset(tokens, category, cat_tokens, rng):
    """
    Pick the capabilities this application genuinely covers.

    ~50% cover the full category footprint (suite products), the rest cover a
    partial footprint (point solutions). A minority also bleed one capability
    from an adjacent category, which is how real overlap actually looks.
    """
    r = rng.random()
    if r < 0.50:
        covered = list(tokens)
    elif r < 0.82:
        covered = rng.sample(tokens, 2)
    else:
        covered = rng.sample(tokens, 1)
    covered = [t for t in tokens if t in covered]  # keep source order

    if rng.random() < 0.22:
        for adj in rng.sample(ADJACENT.get(category, []), 1):
            pool = [t for t in cat_tokens.get(adj, []) if t not in covered]
            if pool:
                covered.append(rng.choice(pool))
    return covered


NAME_VARIANTS = ['One', 'Suite', 'Edge', 'Pro', 'Core', 'Cloud', 'Hub', '360']


def extend_portfolio(rows, idx, count, rng):
    """
    Synthesise additional applications so the estate can be sized past the 600 rows
    the source workbook supplies.

    Every field is drawn from the SOURCE distributions rather than invented: the
    category mix, the vendors that genuinely appear in each category, the owner and
    department pools, the criticality and contract-term mixes, and per-category cost
    and licence ranges. A new row is therefore statistically indistinguishable from
    the originals, which matters because the whole portfolio is scored together -
    additions drawn from thin air would distort every percentile in the engine.

    The 600 source rows are never modified. New rows continue the numbering.
    """
    cat_i, ven_i = idx['Category'], idx['Vendor']
    cost_i, tcv_i = idx['Total Annual Cost'], idx['Total Contract Value']
    acq_i, use_i = idx['Licenses Acquired'], idx['Licenses in Use']
    a90_i, crit_i = idx['Licenses in Use ( last 90 Days)'], idx['Business Criticality']
    yrs_i, cap_i = idx['Contract Duration in Years'], idx['Business Capability']
    own_i, dept_i = idx['Business Owner'], idx['Dept Owner']
    name_i = idx['Application Name']

    by_cat = {}
    for r in rows:
        by_cat.setdefault(r[cat_i], []).append(r)

    cats = [r[cat_i] for r in rows]
    owners = sorted({r[own_i] for r in rows})
    depts = sorted({r[dept_i] for r in rows})
    crits = [r[crit_i] for r in rows]
    terms = [r[yrs_i] for r in rows]

    out = []
    for n in range(count):
        cat = rng.choice(cats)
        peers = by_cat[cat]
        shape = rng.choice(peers)                       # a same-category row to borrow scale from

        num = len(rows) + n + 1
        name = '%s %s %03d' % (cat, rng.choice(NAME_VARIANTS), num)
        vendor = rng.choice([p[ven_i] for p in peers])  # only vendors real in this category

        years = int(rng.choice(terms))
        cost = int(float(shape[cost_i]) * rng.uniform(0.55, 1.75) / 100) * 100
        cost = max(11000, cost)
        tcv = int(cost * years * rng.uniform(0.94, 1.06) / 100) * 100

        acq = max(12, int(float(shape[acq_i]) * rng.uniform(0.5, 1.8)))
        src_acq = max(1.0, float(shape[acq_i]))
        use = int(acq * min(1.0, float(shape[use_i]) / src_acq * rng.uniform(0.8, 1.2)))
        a90_ratio = float(shape[a90_i]) / max(1.0, float(shape[use_i])) if float(shape[use_i]) else 0.0
        a90 = int(use * min(1.0, a90_ratio * rng.uniform(0.8, 1.15)))

        row = [''] * len(rows[0])
        row[name_i] = name
        row[ven_i] = vendor
        row[cat_i] = cat
        row[cap_i] = shape[cap_i]                       # the category's canonical token list
        row[own_i] = rng.choice(owners)
        row[dept_i] = rng.choice(depts)
        row[yrs_i] = str(years)
        row[cost_i] = str(cost)
        row[tcv_i] = str(tcv)
        row[acq_i] = str(acq)
        row[use_i] = str(use)
        row[a90_i] = str(a90)
        row[crit_i] = rng.choice(crits)
        out.append(row)
    return out


def add_years(d, years):
    try:
        return d.replace(year=d.year + years)
    except ValueError:          # 29 Feb
        return d.replace(year=d.year + years, day=28)


# --------------------------------------------------------------------------
# build
# --------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--total', type=int, default=800,
                    help='target portfolio size; rows beyond the source are synthesised '
                         'from the source distributions (default 800)')
    args = ap.parse_args()

    rng = random.Random(SEED)
    hdr, rows = read_xlsx(SRC)
    idx = {h: i for i, h in enumerate(hdr)}
    source_count = len(rows)

    if args.total > source_count:
        rows = rows + extend_portfolio(rows, idx, args.total - source_count, rng)
    elif args.total < source_count:
        rows = rows[:args.total]

    cat_tokens = {}
    for r in rows:
        cat_tokens.setdefault(r[idx['Category']], [t.strip() for t in r[idx['Business Capability']].split(';') if t.strip()])

    new_cols = ['Application ID', 'Asset Type', 'Capabilities Covered',
                'Contract Start Date', 'Contract End Date', 'Auto Renew', 'Notice Period Days']
    out_hdr = ['Application ID', 'Asset Type'] + hdr + \
              ['Capabilities Covered', 'Contract Start Date', 'Contract End Date',
               'Auto Renew', 'Notice Period Days']

    out = []
    for i, r in enumerate(rows, start=1):
        name = r[idx['Application Name']]
        vendor = r[idx['Vendor']]
        category = r[idx['Category']]
        years = int(float(r[idx['Contract Duration in Years']] or 1))

        aid = 'APP-%03d' % i
        atype = asset_type(name, vendor, category, rng)

        tokens = [t.strip() for t in r[idx['Business Capability']].split(';') if t.strip()]
        covered = capability_subset(tokens, category, cat_tokens, rng)

        # Contracts are mid-flight: place the start somewhere inside the term so
        # renewal dates spread realistically across the next few years.
        elapsed_days = rng.randint(0, max(1, years * 365 - 30))
        start = ASOF - timedelta(days=elapsed_days)
        end = add_years(start, years)
        notice = rng.choice([30, 30, 60, 60, 90, 90, 90, 120])
        auto = 'TRUE' if rng.random() < 0.68 else 'FALSE'

        out.append([aid, atype] + r + [';'.join(covered),
                                       start.isoformat(), end.isoformat(), auto, str(notice)])

    os.makedirs(OUT, exist_ok=True)

    with open(os.path.join(OUT, 'portfolio_enriched.csv'), 'w', newline='', encoding='utf-8') as f:
        w = csv.writer(f)
        w.writerow(out_hdr)
        w.writerows(out)

    write_xlsx(os.path.join(OUT, 'portfolio_enriched.xlsx'), out_hdr, out)

    numeric = {'Contract Duration in Years', 'Total Annual Cost', 'Total Contract Value',
               'Licenses Acquired', 'Licenses in Use', 'Licenses in Use ( last 90 Days)',
               'Notice Period Days'}
    ni = [out_hdr.index(c) for c in numeric if c in out_hdr]
    packed = []
    for r in out:
        row = list(r)
        for i in ni:
            row[i] = int(float(row[i] or 0))
        packed.append(row)

    with open(os.path.join(OUT, 'portfolio.json'), 'w', encoding='utf-8') as f:
        json.dump({'asOf': ASOF.isoformat(), 'cols': out_hdr, 'rows': packed},
                  f, separators=(',', ':'))

    print('rows      : %d (%d source + %d synthesised)' % (len(out), source_count, len(out) - source_count))
    print('columns   : %d (13 source + %d added)' % (len(out_hdr), len(out_hdr) - 13))
    print('spend     : $%s' % f"{sum(float(r[out_hdr.index('Total Annual Cost')]) for r in out):,.0f}")
    types = {}
    for r in out:
        types[r[1]] = types.get(r[1], 0) + 1
    for k in sorted(types, key=lambda k: -types[k]):
        print('  %-20s %d' % (k, types[k]))
    ends = sorted(r[out_hdr.index('Contract End Date')] for r in out)
    print('renewals  : %s .. %s' % (ends[0], ends[-1]))


# --------------------------------------------------------------------------
# minimal xlsx writer (inline strings, stdlib only)
# --------------------------------------------------------------------------

def _esc(s):
    return (s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;'))


def write_xlsx(path, hdr, rows):
    def colref(i):
        s = ''
        i += 1
        while i:
            i, rem = divmod(i - 1, 26)
            s = chr(65 + rem) + s
        return s

    NUMERIC = re.compile(r'^-?\d+(\.\d+)?$')
    parts = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
             '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
             '<sheetData>']
    allrows = [hdr] + rows
    for ri, r in enumerate(allrows, start=1):
        parts.append('<row r="%d">' % ri)
        for ci, v in enumerate(r):
            ref = '%s%d' % (colref(ci), ri)
            v = '' if v is None else str(v)
            if ri > 1 and NUMERIC.match(v):
                parts.append('<c r="%s"><v>%s</v></c>' % (ref, v))
            else:
                parts.append('<c r="%s" t="inlineStr"><is><t xml:space="preserve">%s</t></is></c>'
                             % (ref, _esc(v)))
        parts.append('</row>')
    parts.append('</sheetData></worksheet>')
    sheet = ''.join(parts)

    wb = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
          '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
          'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
          '<sheets><sheet name="Application Portfolio" sheetId="1" r:id="rId1"/></sheets></workbook>')
    wbrels = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
              '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
              '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/'
              'relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>')
    ct = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
          '<Default Extension="xml" ContentType="application/xml"/>'
          '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-'
          'officedocument.spreadsheetml.sheet.main+xml"/>'
          '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-'
          'officedocument.spreadsheetml.worksheet+xml"/></Types>')
    rels = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/'
            'relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')

    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('[Content_Types].xml', ct)
        z.writestr('_rels/.rels', rels)
        z.writestr('xl/workbook.xml', wb)
        z.writestr('xl/_rels/workbook.xml.rels', wbrels)
        z.writestr('xl/worksheets/sheet1.xml', sheet)


if __name__ == '__main__':
    main()
