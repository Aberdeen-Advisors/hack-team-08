"""
PortfolioIQ - build step.

Assembles the distributable single-file application by inlining the brand fonts
and the bundled dataset into the template. The output opens from the filesystem
with no server, no build tooling and no network access.

    py tools/build_app.py
"""

import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

TEMPLATE = os.path.join(ROOT, 'src', 'index.template.html')
FONTS = os.path.join(ROOT, 'src', 'fonts.css')
DATA = os.path.join(ROOT, 'data', 'portfolio.json')
OUT = os.path.join(ROOT, 'index.html')


def main():
    html = open(TEMPLATE, encoding='utf-8').read()
    fonts = open(FONTS, encoding='utf-8').read() if os.path.exists(FONTS) else ''
    data = open(DATA, encoding='utf-8').read()

    for token in ('/*__FONTS__*/', '/*__DATA__*/'):
        if token not in html:
            raise SystemExit('template is missing placeholder %s' % token)

    # Guard against the data payload breaking out of the <script> element.
    data = data.replace('</script', '<\\/script')

    html = html.replace('/*__FONTS__*/', fonts).replace('/*__DATA__*/', data)
    open(OUT, 'w', encoding='utf-8').write(html)

    rows = json.loads(open(DATA, encoding='utf-8').read())['rows']
    print('built %s' % OUT)
    print('  assets   : %d' % len(rows))
    print('  fonts    : %.1f KB' % (len(fonts) / 1024))
    print('  data     : %.1f KB' % (len(data) / 1024))
    print('  total    : %.1f KB' % (os.path.getsize(OUT) / 1024))


if __name__ == '__main__':
    main()
