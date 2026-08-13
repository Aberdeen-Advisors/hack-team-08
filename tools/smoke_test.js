/*
 * PortfolioIQ - headless smoke test.
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
  + ' TABS, setTab(t){TAB=t}, render, openAsset, rationale,'
  + ' views:{exec:vExec,spend:vSpend,redun:vRedun,explore:vExplore,risk:vRisk,'
  + '        ai:vAI,recs:vRecs,scen:vScen,road:vRoad,data:vData}};';

/* ---- minimal DOM stub -------------------------------------------------- */
const noop = () => {};
const el = () => new Proxy({
  innerHTML: '', textContent: '', value: '', style: {}, dataset: {}, files: [],
  classList: {add: noop, remove: noop}, querySelectorAll: () => [], click: noop,
  focus: noop, setSelectionRange: noop, appendChild: noop
}, {get: (t, k) => (k in t ? t[k] : noop), set: (t, k, v) => (t[k] = v, true)});

const sandbox = {
  console,
  document: {getElementById: el, querySelectorAll: () => [], addEventListener: noop,
             createElement: el, body: el()},
  window: {scrollTo: noop},
  Blob: function(){}, URL: {createObjectURL: () => '', revokeObjectURL: noop},
  DOMParser: function(){}, TextDecoder: function(){}, DecompressionStream: undefined,
  Response: function(){}, Math, Date, JSON, parseFloat, parseInt, isFinite, Set, Map,
  Object, Array, String, Number, Boolean, Error, RegExp, Intl
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(script, sandbox, {filename: 'portfolioiq.js'});

/* ---- assertions -------------------------------------------------------- */
const X = sandbox.__X;
const {ASSETS, BYID, PLAN, GROUPS, SC} = X;
let fails = 0, checks = 0;
const money = n => '$' + (n / 1e6).toFixed(1) + 'M';

function check(label, cond, detail){
  checks++;
  if (!cond){ fails++; console.log('  FAIL  ' + label + (detail ? '  -> ' + detail : '')); }
  else console.log('  ok    ' + label + (detail ? '  (' + detail + ')' : ''));
}

console.log('\nPortfolioIQ smoke test\n' + '='.repeat(60));

const spend = ASSETS.reduce((s, a) => s + a.cost, 0);
console.log('assets %d | spend %s | groups %d'.replace('%d', ASSETS.length)
  .replace('%s', money(spend)).replace('%d', GROUPS.length));

check('600 assets ingested', ASSETS.length === 600, ASSETS.length + '');
check('spend matches source workbook', Math.round(spend) === 753330500, '$' + spend.toLocaleString());
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
