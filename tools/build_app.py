"""
AppWise Insights - build step.

Assembles the distributable single-file application by inlining the brand fonts
and the bundled dataset into the template. The output opens from the filesystem
with no server, no build tooling and no network access.

    py tools/build_app.py
    py tools/build_app.py --preview "C:/path/to/agent/workdir/_appwise_preview.html"

The optional --preview target writes a second copy of the build somewhere else.
Its purpose is narrow: the Claude Code browser pane only executes JavaScript for
files inside the session working directory, and only offers the element-selection
tool on a live page. When the repo lives outside that directory, a copy there is
the only way to preview or point at elements. Rebuilding refreshes the copy, so
it can never drift from the real build.
"""

import argparse
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

TEMPLATE = os.path.join(ROOT, 'src', 'index.template.html')
FONTS = os.path.join(ROOT, 'src', 'fonts.css')
DATA = os.path.join(ROOT, 'data', 'portfolio.json')
OUT = os.path.join(ROOT, 'index.html')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--preview', metavar='PATH',
                    help='also write the build here (see module docstring)')
    args = ap.parse_args()

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

    if args.preview:
        os.makedirs(os.path.dirname(os.path.abspath(args.preview)), exist_ok=True)
        open(args.preview, 'w', encoding='utf-8').write(html)
        print('preview copy -> %s' % args.preview)

    rows = json.loads(open(DATA, encoding='utf-8').read())['rows']
    print('built %s' % OUT)
    print('  assets   : %d' % len(rows))
    print('  fonts    : %.1f KB' % (len(fonts) / 1024))
    print('  data     : %.1f KB' % (len(data) / 1024))
    print('  total    : %.1f KB' % (os.path.getsize(OUT) / 1024))


if __name__ == '__main__':
    main()
