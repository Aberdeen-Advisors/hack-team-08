/*
 * AppWise Insights - headless smoke test.
 *
 * Loads the built index.html, stubs just enough DOM for the module to evaluate,
 * then exercises the inference engine and optimiser and asserts the numbers are
 * internally consistent. Run:  node tools/smoke_test.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const script = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'))
  /* Top-level let/const live in the lexical scope, not on the vm global. Export via
     getters, not values - PLAN and ASSETS are REASSIGNED by the engine, so a plain
     snapshot would silently keep reading the first object forever. */
  + '\n;globalThis.__X = {get ASSETS(){return ASSETS}, get BYID(){return BYID},'
  + ' get PLAN(){return PLAN}, get GROUPS(){return GROUPS}, SC, ASOF, infer, buildScenario,'
  + ' TABS, setTab(t){TAB=t}, render, openAsset, rationale, reasoning,'
  + ' get REDFILT(){return REDFILT}, setRed(c,k){REDFILT={cat:c,cap:k,touched:true}},'
  + ' setSpend(v,i){SPENDFILT={vendor:v,idle:i}}, setExec(d){EXECFILT={disp:d}},'
  + ' setAI(c){AIFILT={cap:c}}, aiPurpose, topRiskDriver,'
  + ' setRec(d){RECFILT={disp:d}}, scopeBanner, planScope,'
  + ' templateWorkbook, TEMPLATE_COLS, TEMPLATE_SAMPLES, crc32, mapColumns, RAW,'
  + ' views:{exec:vExec,spend:vSpend,redun:vRedun,'
  + '        ai:vAI,recs:vRecs,scen:vScen,road:vRoad,data:vData}};';

/* ---- minimal DOM stub -------------------------------------------------- */
const noop = () => {};
const el = () => new Proxy({
  innerHTML: '', textContent: '', value: '', style: {}, dataset: {}, files: [],
  classList: {add: noop, remove: noop, toggle: noop}, querySelectorAll: () => [], click: noop,
  focus: noop, setSelectionRange: noop, appendChild: noop
}, {get: (t, k) => (k in t ? t[k] : noop), set: (t, k, v) => (t[k] = v, true)});

const sandbox = {
  console,
  document: {getElementById: el, querySelectorAll: () => [], addEventListener: noop,
             createElement: el, body: el()},
  window: {scrollTo: noop},
  Blob: function(){}, URL: {createObjectURL: () => '', revokeObjectURL: noop},
  DOMParser: function(){}, DecompressionStream: undefined,
  /* real codecs - the template writer encodes XML parts and the tests decode them */
  TextEncoder, TextDecoder,
  Uint8Array, Uint32Array, DataView, ArrayBuffer,
  Response: function(){}, Math, Date, JSON, parseFloat, parseInt, isFinite, Set, Map,
  Object, Array, String, Number, Boolean, Error, RegExp, Intl
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(script, sandbox, {filename: 'appwise-insights.js'});

/* ---- assertions -------------------------------------------------------- */
const X = sandbox.__X;
const {ASSETS, BYID, PLAN, GROUPS, SC} = X;
let fails = 0, checks = 0;
const money = n => '$' + (n / 1e6).toFixed(1) + 'M';
/* matches the app's money0(): full precision with thousands separators */
const moneyExact = n => '$' + Math.round(n).toLocaleString('en-US');

function check(label, cond, detail){
  checks++;
  if (!cond){ fails++; console.log('  FAIL  ' + label + (detail ? '  -> ' + detail : '')); }
  else console.log('  ok    ' + label + (detail ? '  (' + detail + ')' : ''));
}

console.log('\nAppWise Insights smoke test\n' + '='.repeat(60));

const spend = ASSETS.reduce((s, a) => s + a.cost, 0);
console.log('assets %d | spend %s | groups %d'.replace('%d', ASSETS.length)
  .replace('%s', money(spend)).replace('%d', GROUPS.length));

check('800 assets ingested', ASSETS.length === 800, ASSETS.length + '');
/* 600 rows from the source workbook plus 200 synthesised from its own distributions.
   Deterministic, so an exact total is a valid regression guard on the generator. */
check('spend matches the generated dataset', Math.round(spend) === 1041530100,
  '$' + spend.toLocaleString());
check('the 600 source applications are still present and unmodified',
  ASSETS.slice(0, 600).every((a, i) => a.id === 'APP-' + String(i + 1).padStart(3, '0')) &&
  Math.round(ASSETS.slice(0, 600).reduce((s, a) => s + a.cost, 0)) === 753330500,
  'source subtotal $753,330,500 intact');
check('every asset has a disposition',
  ASSETS.every(a => ['Invest', 'Consolidate', 'Replace', 'Retire'].includes(a.disp)));
check('every asset scored 0-100',
  ASSETS.every(a => a.value >= 0 && a.value <= 100 && a.risk >= 0 && a.risk <= 100));
check('dependency edges built',
  ASSETS.reduce((s, a) => s + a.dependsOn.length, 0) > 500,
  ASSETS.reduce((s, a) => s + a.dependsOn.length, 0) + ' edges');
check('no asset depends on itself', ASSETS.every(a => !a.dependsOn.includes(a.id)));
check('graph is symmetric',
  ASSETS.every(a => a.dependsOn.every(id => BYID[id].usedBy.includes(a.id))));
check('blast radius computed', ASSETS.some(a => a.blast > 0),
  'max ' + Math.max(...ASSETS.map(a => a.blast)));

/* Acyclicity. Regression guard: the first cut let identity depend on infrastructure
   and infrastructure depend on identity, so every asset transitively reached every
   other and blast radius degenerated to 600. */
let cyclic = null;
{
  const WHITE = 0, GREY = 1, BLACK = 2, mark = {};
  ASSETS.forEach(a => mark[a.id] = WHITE);
  const visit = (id, trail) => {
    if (mark[id] === GREY) return (cyclic = trail.concat(id).slice(-5).join(' -> ')), true;
    if (mark[id] === BLACK) return false;
    mark[id] = GREY;
    for (const d of BYID[id].dependsOn) if (visit(d, trail.concat(id))) return true;
    mark[id] = BLACK;
    return false;
  };
  ASSETS.some(a => visit(a.id, []));
}
check('dependency graph is acyclic', cyclic === null, cyclic || 'no cycles');

const blasts = ASSETS.map(a => a.blast).sort((x, y) => x - y);
const p = q => blasts[Math.floor(blasts.length * q)];
console.log(`  blast radius distribution: p50=${p(.5)} p75=${p(.75)} p90=${p(.9)} p99=${p(.99)} max=${blasts[blasts.length-1]}`);
check('blast radius is not degenerate', p(.5) < ASSETS.length * 0.25,
  'median ' + p(.5) + ' of ' + ASSETS.length);

const dispCount = {};
ASSETS.forEach(a => dispCount[a.disp] = (dispCount[a.disp] || 0) + 1);
console.log('  dispositions:', JSON.stringify(dispCount), '| guardrail-protected:',
  ASSETS.filter(a => a.locked).length);
check('all four dispositions are represented',
  ['Invest','Consolidate','Replace','Retire'].every(d => dispCount[d] > 0));

/* the core guardrail promise */
const violations = ASSETS.filter(a => a.disp === 'Retire' && a.locked);
check('GUARDRAIL: no protected asset is retired', violations.length === 0,
  violations.length + ' violations');
const mc = ASSETS.filter(a => a.crit === 'Mission Critical' && a.disp === 'Retire');
check('GUARDRAIL: no mission-critical asset retired', mc.length === 0, mc.length + ' violations');
const rev = ASSETS.filter(a => a.revenue && a.disp === 'Retire');
check('GUARDRAIL: no revenue-bearing asset retired', rev.length === 0, rev.length + ' violations');

check('savings are net of exit cost', ASSETS.every(a => a.net <= a.gross || a.gross === 0));
check('plan reaches the 15% target', PLAN.met,
  PLAN.pctOfSpend.toFixed(1) + '% = ' + money(PLAN.savings));
check('plan respects disruption tolerance',
  PLAN.picked.every(a => a.disruption <= SC.tolerance || a.disp === 'Invest'),
  'peak ' + Math.max(...PLAN.picked.map(a => a.disruption)));
check('plan respects the contract horizon',
  PLAN.picked.every(a => (a.actionDate - X.ASOF) / 864e5 <= SC.horizon * 31),
  'latest ' + PLAN.picked.map(a => a.actionDate).sort((x, y) => y - x)[0].toISOString().slice(0, 10));
check('deferred savings are tracked, not dropped', PLAN.deferred.length > 0,
  PLAN.deferred.length + ' assets, ' + money(PLAN.deferred.reduce((s, a) => s + a.net, 0)));
check('every overlap group has one survivor',
  GROUPS.every(g => g.members.filter(a => a.isSurvivor).length === 1));
check('AI population classified',
  ASSETS.filter(a => a.isAI).length > 0,
  ASSETS.filter(a => a.isAI).length + ' AI assets, ' +
  ASSETS.filter(a => a.aiGov && a.aiGov.startsWith('Shadow')).length + ' shadow');

/* determinism: re-running the engine must reproduce identical output */
const before = ASSETS.map(a => a.id + a.disp + a.net + a.blast).join('|');
X.infer();
const after = X.ASSETS.map(a => a.id + a.disp + a.net + a.blast).join('|');
check('engine is deterministic across reruns', before === after);

/* ---- every tab must render ---------------------------------------------- */
console.log('\nRender');
for (const t of X.TABS){
  checks++;
  try {
    const html = X.views[t.id]();
    if (!html || html.length < 400) throw new Error('output too short (' + (html || '').length + ' chars)');
    if (/undefined|NaN|\[object Object\]/.test(html))
      throw new Error('placeholder leaked: ' + html.match(/.{0,40}(undefined|NaN|\[object Object\]).{0,40}/)[0].trim());
    console.log(`  ok    ${t.t.padEnd(22)} ${String(html.length).padStart(7)} chars`);
  } catch (e){ fails++; console.log(`  FAIL  ${t.t.padEnd(22)} ${e.message}`); }
}

/* full render path including event wiring */
checks++;
try { X.TABS.forEach(t => { X.setTab(t.id); X.render(); }); console.log('  ok    full render + wire cycle'); }
catch (e){ fails++; console.log('  FAIL  full render + wire cycle -> ' + e.message); }

/* drawer, across a spread of asset shapes */
checks++;
try {
  const sample = [ASSETS[0], ASSETS.find(a => a.isAI), ASSETS.find(a => a.blast > 50),
                  ASSETS.find(a => a.disp === 'Retire'), ASSETS.find(a => a.isSurvivor),
                  ASSETS.find(a => a.locked)].filter(Boolean);
  sample.forEach(a => X.openAsset(a.id));
  console.log('  ok    asset drawer over ' + sample.length + ' asset shapes');
} catch (e){ fails++; console.log('  FAIL  asset drawer -> ' + e.message); }

/* every asset produces a non-empty rationale */
check('every asset has a rationale', ASSETS.every(a => X.rationale(a).length > 5));

/* reasoning(): 2-3 sentences, no leaked placeholders, for all 600 */
{
  const bad = ASSETS.map(a => ({a, t: X.reasoning(a)}))
    .filter(({t}) => {
      const sentences = (t.match(/\.\s|\.$/g) || []).length;
      return sentences < 2 || sentences > 3 || t.length < 60 ||
             /undefined|NaN|\[object/.test(t);
    });
  check('reasoning() returns 2-3 clean sentences for all 600 assets', bad.length === 0,
    bad.length ? bad[0].a.name + ': ' + bad[0].t.slice(0, 90) : 'checked ' + ASSETS.length);
}

/* ---- redundancy filter: every category and every capability ------------- */
console.log('\nRedundancy filter');
{
  const cats = [...new Set(ASSETS.map(a => a.cat))];
  const caps = [...new Set(ASSETS.flatMap(a => a.covered))];
  let empties = 0, errors = 0, worst = null;

  const exercise = (c, k) => {
    X.setRed(c, k);
    const html = X.views.redun();
    const n = ASSETS.filter(a => (!c || a.cat === c) && (!k || a.covered.includes(k))).length;
    const shownRows = (html.match(/data-id="/g) || []).length;
    if (n >= 2 && shownRows !== Math.min(n, 40))
      throw new Error(`expected ${Math.min(n, 40)} table rows, rendered ${shownRows}`);
    if (n === 0) empties++;
    if (!worst || html.length > worst.len) worst = {sel: (c || 'all') + ' / ' + (k || 'all'), len: html.length};
  };

  cats.forEach(c => { try { exercise(c, ''); } catch(e){ errors++; console.log('  FAIL  cat ' + c + ' -> ' + e.message); } });
  caps.forEach(k => { try { exercise('', k); } catch(e){ errors++; console.log('  FAIL  cap ' + k + ' -> ' + e.message); } });
  try { exercise('', ''); } catch(e){ errors++; console.log('  FAIL  all/all -> ' + e.message); }

  checks++; if (errors) fails += errors;
  else console.log(`  ok    ${cats.length} categories + ${caps.length} capabilities + all/all render`);
  check('no filter combination yields an empty table', empties === 0, empties + ' empty');
  console.log(`  largest view: ${worst.sel} at ${worst.len.toLocaleString()} chars`);

  /* KPI reconciliation: in-scope spend on the card must equal the sum of the rows */
  X.setRed('CRM', '');
  const crm = ASSETS.filter(a => a.cat === 'CRM');
  const crmSpend = crm.reduce((s, a) => s + a.cost, 0);
  const html = X.views.redun();
  const shown = html.match(/\$([\d.]+)M annual spend/);
  check('applications KPI reconciles with the underlying rows',
    shown && Math.abs(parseFloat(shown[1]) - crmSpend / 1e6) < 0.1,
    shown ? `card $${shown[1]}M vs rows $${(crmSpend/1e6).toFixed(1)}M` : 'card not found');

  const vShown = html.match(/Vendor count<\/div><div class="v"[^>]*>(\d+)/);
  const crmVendors = new Set(crm.map(a => a.vendor)).size;
  check('vendor count KPI reconciles with the underlying rows',
    vShown && +vShown[1] === crmVendors,
    vShown ? `card ${vShown[1]} vs rows ${crmVendors}` : 'card not found');

  /* Regression: the KPI cards must all describe the same population. A cross-category
     selection once showed "1 overlapping application, $152K in overlap" beside
     "$2.5M consolidation savings" because savings read portfolio-level dispositions. */
  X.setRed('', 'Asset Management');
  const h2 = X.views.redun();
  const dupN = +(h2.match(/Overlapping applications<\/div><div class="v"[^>]*>(\d+)/) || [])[1];
  const saveNote = h2.match(/from (?:those (\d+)|that (one)), net of exit/);
  const saveN = saveNote ? (saveNote[1] ? +saveNote[1] : 1) : null;
  check('KPI cards describe one consistent population',
    saveN === dupN, `overlap card ${dupN} vs savings card ${saveN === null ? '?' : saveN}`);

  X.setRed('', '');
}

/* ---- import template ---------------------------------------------------- */
console.log('\nImport template');
{
  /* CRC32 known-answer test - a wrong table produces a file Excel refuses to open */
  check('CRC32 matches the specification check value',
    X.crc32(new TextEncoder().encode('123456789')) === 0xCBF43926,
    '0x' + X.crc32(new TextEncoder().encode('123456789')).toString(16).toUpperCase());

  const headers = X.TEMPLATE_COLS.map(c => c[0]);
  check('template columns match the bundled dataset exactly',
    JSON.stringify(headers) === JSON.stringify(X.RAW.cols),
    headers.length + ' columns, same names and order');

  /* the point of the template: a filled copy must satisfy the importer */
  const m = X.mapColumns(headers);
  check('every required field resolves from the template headers',
    ['name','cost','crit'].every(k => m[k] !== undefined),
    'name/cost/crit all mapped');
  check('template maps as many fields as the bundled sample',
    Object.keys(m).length === Object.keys(X.mapColumns(X.RAW.cols)).length,
    Object.keys(m).length + ' fields');

  const required = X.TEMPLATE_COLS.filter(c => c[1] === 'REQUIRED').map(c => c[0]);
  check('exactly three columns are marked required', required.length === 3, required.join(', '));
  check('every template column carries a requirement, purpose and example',
    X.TEMPLATE_COLS.every(c => c.length === 4 && c.every(v => v && String(v).trim())));
  check('sample rows have one value per column',
    X.TEMPLATE_SAMPLES.every(r => r.length === headers.length),
    X.TEMPLATE_SAMPLES.length + ' sample rows');

  /* structural validity of the generated workbook */
  const wb = X.templateWorkbook();
  const dv = new DataView(wb.buffer, wb.byteOffset, wb.byteLength);
  check('workbook is a well-formed zip', dv.getUint32(0, true) === 0x04034b50,
    (wb.length / 1024).toFixed(1) + ' KB');
  let eocd = -1;
  for (let i = wb.length - 22; i >= 0; i--) if (dv.getUint32(i, true) === 0x06054b50){ eocd = i; break; }
  check('zip central directory is present and complete',
    eocd > 0 && dv.getUint16(eocd + 10, true) === 6,
    (eocd > 0 ? dv.getUint16(eocd + 10, true) : 0) + ' entries');
  const text = new TextDecoder().decode(wb);
  check('workbook declares both sheets',
    text.includes('Application Portfolio') && text.includes('Field Guide'));
  check('workbook carries the headers and sample data',
    headers.every(h => text.includes(h.replace(/&/g, '&amp;'))) &&
    text.includes('Copilot for Service'));
}

/* ---- optimiser: holistic evaluation, precise targeting, priority order --- */
console.log('\nOptimiser');
{
  const orig = X.SC.target;
  const rows = [];
  for (let t = 5; t <= 35; t++){
    X.SC.target = t; X.buildScenario();
    rows.push({t, pct: X.PLAN.pctOfSpend, n: X.PLAN.picked.length, savings: X.PLAN.savings,
               evaluated: X.PLAN.evaluated, met: X.PLAN.met,
               bad: X.PLAN.picked.filter(a => a.disp === 'Retire' && a.locked).length});
  }
  const worst = rows.reduce((w, r) => Math.abs(r.pct - r.t) > Math.abs(w.pct - w.t) ? r : w);
  check('every target from 5-35% lands within 0.5pp of the request',
    rows.every(r => Math.abs(r.pct - r.t) <= 0.5),
    `worst: ${worst.t}% -> ${worst.pct.toFixed(2)}% (${(worst.pct - worst.t >= 0 ? '+' : '')}${(worst.pct - worst.t).toFixed(2)}pp)`);

  check('every target is met', rows.every(r => r.met));

  /* the 16/17/18% collision: three different requests, one identical plan */
  const sigs = rows.map(r => r.pct.toFixed(2) + '|' + r.n);
  const dupes = sigs.filter((s, i) => sigs.indexOf(s) !== i);
  check('no two targets collapse onto an identical plan', dupes.length === 0,
    dupes.length ? dupes[0] + ' repeated' : `${rows.length} distinct plans`);

  check('the whole candidate set is evaluated, not a prefix',
    rows.every(r => r.evaluated === ASSETS.filter(a => a.net > 0).length),
    rows[0].evaluated + ' candidates every time');

  check('GUARDRAIL holds across the full target sweep',
    rows.every(r => r.bad === 0));

  /* Savings must rise strictly with the target - that is the real invariant.
     Action COUNT is allowed to dip by one: this is a fit-based selection, so a
     larger target can admit one bigger action in place of two smaller ones. */
  check('a higher target always yields more savings',
    rows.every((r, i) => i === 0 || r.savings > rows[i-1].savings),
    `$${(rows[0].savings/1e6).toFixed(1)}M at 5% -> $${(rows[rows.length-1].savings/1e6).toFixed(1)}M at 35%`);
  /* A denser candidate pool lets the fit pass swap several small actions for fewer
     larger ones, so allow a small dip in absolute or relative terms - but nothing
     that would suggest the selection had genuinely lost coverage. */
  const dips = rows.filter((r, i) => i > 0 && r.n < rows[i-1].n - Math.max(2, rows[i-1].n * 0.1));
  check('action count never falls sharply between adjacent targets', dips.length === 0,
    `${rows[0].n} actions at 5% -> ${rows[rows.length-1].n} at 35%`);

  X.SC.target = orig; X.buildScenario();

  /* priority ordering must respect all three stated criteria */
  const dominated = [];
  const sample = ASSETS.filter(a => a.net > 0).slice(0, 220);
  for (const a of sample) for (const b of sample){
    if (a === b) continue;
    if (a.net > b.net && a.daysToAction < b.daysToAction && a.disruption < b.disruption
        && a.priority < b.priority) dominated.push(a.name + ' < ' + b.name);
  }
  check('priority ordering is monotonic on all three criteria', dominated.length === 0,
    dominated.length ? dominated[0] : 'no dominated pairs');

  check('priority weights sum to 1',
    Math.abs(ASSETS[0].priorityParts.value / (ASSETS[0].net / Math.max(...ASSETS.map(a=>a.net))) - 0.50) < 1e-9);

  /* every candidate outside the plan carries exactly one accurate reason */
  const codes = {guardrail:0, ceiling:0, deferred:0, surplus:0};
  const wrong = X.PLAN.excluded.filter(a => {
    if (!(a.planReason in codes)) return true;
    codes[a.planReason]++;
    if (a.planReason === 'guardrail') return !(X.SC.protect && a.locked && a.disp !== 'Invest');
    if (a.planReason === 'deferred')  return false;
    if (a.planReason === 'ceiling')   return !(a.disruption > X.SC.tolerance);
    return false;
  });
  check('every excluded asset carries one accurate reason code', wrong.length === 0,
    JSON.stringify(codes));
  check('assets in the plan carry no exclusion reason',
    X.PLAN.picked.every(a => a.planReason === null));

  /* the scope toggle must actually narrow every table */
  const wide = {}, narrow = {};
  X.SC.planOnly = false; ['spend','redun','ai','recs','road'].forEach(v => wide[v] = (X.views[v]().match(/data-id="/g)||[]).length);
  X.SC.planOnly = true;  ['spend','redun','ai','recs','road'].forEach(v => narrow[v] = (X.views[v]().match(/data-id="/g)||[]).length);
  X.SC.planOnly = false;
  check('In plan only narrows every asset table',
    ['redun','ai','recs','road'].every(v => narrow[v] < wide[v]),
    ['spend','redun','ai','recs','road'].map(v => `${v} ${wide[v]}->${narrow[v]}`).join(', '));
  /* Technology spend's worst-cost table is capped at 10 rows, so scoping changes
     WHICH rows appear rather than how many - assert on identity, not count. */
  X.SC.planOnly = false; const wideIds = X.views.spend().match(/data-id="[^"]+"/g).join();
  X.SC.planOnly = true;  const narrowIds = X.views.spend().match(/data-id="[^"]+"/g).join();
  X.SC.planOnly = false;
  check('In plan only changes which rows Technology spend shows', wideIds !== narrowIds);

  /* an emptied table must explain itself rather than reading as broken */
  X.SC.planOnly = true;
  const banner = X.scopeBanner();
  X.SC.planOnly = false;
  check('scoping announces itself, and the banner is empty when unscoped',
    /In plan only/.test(banner) && banner.includes(String(X.PLAN.picked.length))
      && X.scopeBanner() === '',
    'banner names the ' + X.PLAN.picked.length + ' plan actions');

  check('planScope is a no-op when the toggle is off',
    X.planScope(ASSETS).length === ASSETS.length);
}

/* ---- savings scenarios --------------------------------------------------- */
console.log('\nSavings scenarios');
{
  const html = X.views.scen();
  check('disruption tolerance control card is gone',
    !/id="sTol"/.test(html) && !/Maximum disruption score/.test(html));
  check('exclusion table reports dependencies, not disruption',
    /<th[^>]*>Dependencies<\/th>/.test(html) && !/<th[^>]*>Disrupt<\/th>/.test(html));
  check('dependency counts match the graph',
    PLAN.excluded.sort((a, b) => b.net - a.net).slice(0, 12)
      .every(a => html.includes(`>${a.dependsOn.length + a.usedBy.length}</td>`)),
    'top 12 rows');
  check('the two remaining sliders still drive the plan',
    /id="sTarget"/.test(html) && /id="sHor"/.test(html));

  /* the plan table must list every action and foot to the headline savings */
  check('plan savings table lists every action in the plan',
    PLAN.picked.every(a => html.includes(`data-id="${a.id}"`)),
    PLAN.picked.length + ' actions');
  check('plan savings table foots to the headline figure',
    html.includes(moneyExact(PLAN.savings)), moneyExact(PLAN.savings));
  check('plan savings rows are ordered by net saving',
    (() => {
      const order = [...html.matchAll(/data-id="([^"]+)"/g)].map(m => m[1])
        .slice(0, PLAN.picked.length).map(id => BYID[id].net);
      return order.every((n, i) => i === 0 || order[i-1] >= n);
    })());
  check('plan, deferred and not-in-plan partition the candidates without overlap',
    PLAN.picked.length + PLAN.excluded.length === PLAN.evaluated &&
    PLAN.picked.every(a => !PLAN.excluded.includes(a)),
    `${PLAN.picked.length} + ${PLAN.excluded.length} = ${PLAN.evaluated}`);
}

/* ---- recommendations: KPI filtering and drawer risk detail -------------- */
console.log('\nRecommendations');
{
  let errs = 0;
  ['Invest','Consolidate','Replace','Retire'].forEach(d => {
    X.setRec(d);
    const html = X.views.recs();
    const set = ASSETS.filter(a => a.disp === d);
    const rows = (html.match(/data-id="/g) || []).length;
    if (rows !== Math.min(set.length, 600)){
      errs++; console.log(`  FAIL  ${d}: ${rows} rows, expected ${Math.min(set.length, 600)}`); }
    /* the filtered table must contain nothing but that disposition */
    const pills = (html.match(/class="pill p-(\w+)"/g) || []).map(m => m.match(/p-(\w+)/)[1]);
    const foreign = pills.filter(p => p !== d);
    if (foreign.length){ errs++; console.log(`  FAIL  ${d}: ${foreign.length} foreign pills`); }
  });
  checks++; if (errs) fails += errs;
  else console.log('  ok    each KPI card filters the table to its own disposition');

  X.setRec('');
  const all = X.views.recs();
  check('unfiltered view shows the top 300 across all dispositions',
    (all.match(/data-id="/g) || []).length === 300);

  /* the removed columns must be gone, and the renamed one present */
  check('Disrupt and Blast columns are gone from the table',
    !/<th[^>]*>Disrupt<\/th>/.test(all) && !/<th[^>]*>Blast<\/th>/.test(all));
  check('Earliest column is spelled out as Earliest action date',
    /<th[^>]*>Earliest action date<\/th>/.test(all) && !/<th[^>]*>Earliest<\/th>/.test(all));

  /* selecting an application must surface risk and dependency detail */
  check('every asset yields a named top risk driver',
    ASSETS.every(a => X.topRiskDriver(a).length > 3 && !/undefined/.test(X.topRiskDriver(a))),
    'e.g. ' + X.topRiskDriver(ASSETS.find(a => a.risk >= 45)));
}

/* ---- AI & agents analysis ----------------------------------------------- */
console.log('\nAI & agents analysis');
{
  const ai = ASSETS.filter(a => a.isAI);
  const tools = ai.filter(a => a.type === 'AI Tool');
  const agents = ai.filter(a => a.type === 'AI Agent');
  check('AI population splits into tools and agents',
    tools.length + agents.length === ai.length && tools.length > 0 && agents.length > 0,
    `${tools.length} tools + ${agents.length} agents = ${ai.length}`);

  check('every AI asset has inferred token usage',
    ai.every(a => Number.isFinite(a.tokens) && a.tokens >= 0) &&
    ASSETS.filter(a => !a.isAI).every(a => a.tokens === undefined),
    'total ' + (ai.reduce((s, a) => s + a.tokens, 0) / 1e12).toFixed(2) + 'T tokens');

  /* the whole point of the split: agents burn far more per user than tools */
  const perUser = set => {
    const u = set.reduce((s, a) => s + a.act, 0);
    return u ? set.reduce((s, a) => s + a.tokens, 0) / u : 0;
  };
  check('agents consume more tokens per user than assistive tools',
    perUser(agents) > perUser(tools) * 3,
    `${(perUser(agents)/1e6).toFixed(0)}M vs ${(perUser(tools)/1e6).toFixed(0)}M per user`);

  check('zero-adoption AI assets report zero tokens',
    ai.filter(a => a.act === 0).every(a => a.tokens === 0),
    ai.filter(a => a.act === 0).length + ' with no active users');

  /* every capability must drill down, and the leader must be in its own set */
  const byCap = {};
  ai.forEach(a => a.covered.forEach(c => (byCap[c] = byCap[c] || []).push(a)));
  const caps = Object.keys(byCap);
  let errs = 0;
  caps.forEach(c => {
    X.setAI(c);
    const html = X.views.ai();
    const rows = (html.match(/data-id="/g) || []).length;
    /* drill-down rows + the full inventory table */
    if (rows !== byCap[c].length + ai.length){
      errs++; console.log(`  FAIL  ${c}: ${rows} rows, expected ${byCap[c].length + ai.length}`); }
    if (!html.includes(moneyExact(byCap[c].reduce((s, a) => s + a.cost, 0)))){
      errs++; console.log(`  FAIL  ${c}: capability spend missing from footer`); }
  });
  checks++; if (errs) fails += errs;
  else console.log(`  ok    all ${caps.length} AI capabilities drill down, footers reconcile`);

  /* duplicity: an asset leading any capability must never be counted duplicative */
  const leaderOf = {};
  Object.entries(byCap).forEach(([c, list]) =>
    leaderOf[c] = list.reduce((x, y) => y.fitScore > x.fitScore ? y : x));
  const leaders = new Set(Object.values(leaderOf).map(a => a.id));
  const dup = ai.filter(a => a.covered.length && a.covered.every(c => leaderOf[c] !== a));
  check('duplicity never flags an asset that leads a capability',
    dup.every(a => !leaders.has(a.id)),
    `${dup.length} duplicative of ${ai.length}, ${leaders.size} leaders`);

  check('every AI asset has a purpose statement',
    ai.every(a => X.aiPurpose(a).length > 25 && !/undefined/.test(X.aiPurpose(a))));

  /* copy defects that only show on specific data shapes */
  const grammar = caps.map(c => { X.setAI(c); return {c, html: X.views.ai()}; });
  check('no singular/plural grammar faults in the drill-down header',
    grammar.every(g => !/\b1 (vendors|AI assets)\b/.test(g.html)),
    (grammar.find(g => /\b1 (vendors|AI assets)\b/.test(g.html)) || {}).c || 'checked ' + caps.length);
  check('vendor and model are not printed twice when identical',
    grammar.every(g => !/\(([A-Za-z ]+), \1 model\)/.test(g.html)));
  check('the capability drill-down is closed until a capability is chosen',
    (X.setAI(''), !/AI asset[s]?, \d+ vendor/.test(X.views.ai())));

  X.setAI('');
}

/* ---- executive summary: disposition drill-down and target stepper ------- */
console.log('\nExecutive summary');
{
  let errs = 0;
  ['Invest','Consolidate','Replace','Retire'].forEach(d => {
    X.setExec(d);
    const html = X.views.exec();
    /* must mirror the view's own ordering, or the top-60 subtotal will not match */
    const set = ASSETS.filter(a => a.disp === d).sort((x, y) => y.net - x.net || y.cost - x.cost);
    const rows = (html.match(/data-id="/g) || []).length;
    const expect = Math.min(set.length, 60) + Math.min(X.PLAN.picked.filter(a=>a.disp!=='Invest').length, 12);
    if (rows !== expect){ errs++; console.log(`  FAIL  ${d}: ${rows} rows, expected ${expect}`); }
    if (!html.includes(moneyExact(set.slice(0,60).reduce((s,a)=>s+a.cost,0)))){
      errs++; console.log(`  FAIL  ${d}: subtotal missing from footer`); }
  });
  checks++; if (errs) fails += errs;
  else console.log('  ok    all four dispositions drill down, footers reconcile');
  X.setExec('');

  /* the target stepper must actually move the plan, and stay inside its bounds */
  const orig = X.SC.target;
  const seen = [];
  [5, 12, 15, 22, 30, 40].forEach(t => {
    X.SC.target = t; X.buildScenario();
    seen.push({t, pct: +X.PLAN.pctOfSpend.toFixed(1), met: X.PLAN.met});
  });
  check('target stepper changes the plan across its full range',
    new Set(seen.map(s => s.pct)).size >= 5,
    seen.map(s => `${s.t}%→${s.pct}%`).join(' '));
  check('every reachable target is met without breaking guardrails',
    seen.every(s => s.met) &&
    X.PLAN.picked.every(a => !(a.disp === 'Retire' && a.locked)));
  X.SC.target = orig; X.buildScenario();
}

/* ---- technology spend: vendor drill-down and idle-seat evidence --------- */
console.log('\nTechnology spend');
{
  const vendors = [...new Set(ASSETS.map(a => a.vendor))];
  let errs = 0;
  vendors.forEach(v => {
    X.setSpend(v, false);
    const html = X.views.spend();
    const own = ASSETS.filter(a => a.vendor === v);
    const rows = (html.match(/data-id="/g) || []).length;
    /* vendor table rows + the 10 rows of the worst-cost-per-user table */
    if (rows !== own.length + 10){ errs++; console.log(`  FAIL  ${v}: ${rows} rows, expected ${own.length + 10}`); }
    const tot = own.reduce((s, a) => s + a.cost, 0);
    if (!html.includes(moneyExact(tot))){ errs++; console.log(`  FAIL  ${v}: total ${moneyExact(tot)} not in footer`); }
  });
  checks++; if (errs) fails += errs;
  else console.log(`  ok    all ${vendors.length} vendors drill down, footers reconcile`);

  /* the idle-seat table must actually account for the KPI it explains */
  X.setSpend('', true);
  const html = X.views.spend();
  const idle = ASSETS.filter(a => a.idleCost > 0);
  const idleTotal = ASSETS.reduce((s, a) => s + a.idleCost, 0);
  check('idle-seat breakdown reconciles to the KPI',
    html.includes(moneyExact(idleTotal)),
    `${idle.length} apps, ${moneyExact(idleTotal)}`);
  check('idle-seat rows are all non-zero and sorted by cost', (() => {
    const sorted = [...idle].sort((a, b) => b.idleCost - a.idleCost).slice(0, 60);
    return sorted.every(a => a.idleCost > 0) &&
           sorted.every((a, i) => i === 0 || sorted[i-1].idleCost >= a.idleCost);
  })(), `top 60 of ${idle.length}`);
  check('idle seats equal acquired minus active',
    ASSETS.every(a => a.idleSeats === Math.max(0, a.acq - a.act)));

  /* an unknown vendor must warn, not silently render an empty table */
  X.setSpend('NotARealVendor', false);
  check('unknown vendor search warns rather than failing silently',
    /No vendor matches/.test(X.views.spend()));

  X.setSpend('', false);
}

/* Regression: never assert an asset "would retire on the evidence" unless it
   actually meets the retire test. This was claimed of a 66%-utilised, value-75 asset. */
{
  const liars = ASSETS.filter(a => /would retire on the evidence/.test(X.reasoning(a)))
                      .filter(a => !(a.value < 34 && a.util < 0.35));
  check('"would retire" is only claimed where the retire test actually passes',
    liars.length === 0,
    liars.length ? `${liars[0].name}: value ${liars[0].value}, util ${(liars[0].util*100).toFixed(0)}%`
                 : 'checked all 600');
}

/* ---- scenario sweep ---------------------------------------------------- */
console.log('\nScenario sweep');
console.log('  target  horizon  tol   achieved      savings   actions  guardrail');
for (const [t, h, tol] of [[10,12,50],[15,24,62],[20,24,62],[15,48,62],[25,48,85],[30,12,40]]){
  Object.assign(X.SC, {target: t, horizon: h, tolerance: tol});
  X.buildScenario();
  const p = X.PLAN;
  const bad = p.picked.filter(a => a.disp === 'Retire' && a.locked).length;
  if (bad) fails++;
  checks++;
  console.log(`  ${String(t).padStart(4)}%  ${String(h).padStart(5)}mo  ${String(tol).padStart(3)}   ` +
    `${(p.pctOfSpend.toFixed(1) + '%').padStart(7)} ${p.met ? 'MET ' : 'SHORT'}  ` +
    `${money(p.savings).padStart(8)}  ${String(p.picked.length).padStart(6)}   ${bad ? 'VIOLATED' : 'held'}`);
}

console.log('\n' + '='.repeat(60));
console.log(fails ? `${fails} of ${checks} checks FAILED` : `all ${checks} checks passed`);
process.exit(fails ? 1 : 0);
