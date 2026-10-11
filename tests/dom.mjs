// DOM 粘合集成测试：用极简 DOM 桩真实跑一遍 apply()，
// 验证「每个组件一行状态」的挂载、多组件场景、重放与清理。
// 运行：node tests/dom.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, '..', 'client.js'), 'utf8');

let failed = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) console.log(`ok   ${name}`);
  else { failed++; console.log(`FAIL ${name}\n  actual   ${a}\n  expected ${e}`); }
}

// ───────────────────────── 极简 DOM ─────────────────────────
const SVG_NS = 'http://www.w3.org/2000/svg';
function makeEl(tag, ns) {
  const node = {
    tagName: tag, ns: ns || null, children: [], attrs: {}, style: {},
    _text: '', _raw: null, parentElement: null,
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; },
    appendChild(c) { c.parentElement = this; this.children.push(c); return c; },
    remove() {
      const p = this.parentElement;
      if (p === null) return;
      const i = p.children.indexOf(this);
      if (i >= 0) p.children.splice(i, 1);
      this.parentElement = null;
    },
    get textContent() {
      if (this.tagName === '#text') return this._raw === null ? '' : this._raw;
      if (this._raw !== null) return this._raw;
      let s = '';
      for (const c of this.children) s += c.textContent;
      return s;
    },
    // 注意：真实 DOM 里设置 textContent 不会改变元素的 tagName，
    // 所以这里只记原始文本，绝不把它降级成文本节点（否则选择器就匹配不到了）。
    set textContent(v) { this.children = []; this._raw = String(v); },
  };
  node.querySelector = (sel) => descendants(node).find((n) => matches(n, sel)) || null;
  node.querySelectorAll = (sel) => descendants(node).filter((n) => matches(n, sel));
  return node;
}
function descendants(node) {
  const out = [];
  (function walk(n) { for (const c of n.children) { out.push(c); walk(c); } })(node);
  return out;
}
function matches(n, sel) {
  if (n.tagName === '#text') return false;
  if (sel.startsWith('[')) return n.getAttribute(sel.slice(1, -1)) !== null;
  if (sel.startsWith('.')) {
    const cls = n.getAttribute('class');
    return cls !== null && cls.split(/\s+/).indexOf(sel.slice(1)) >= 0;
  }
  return n.tagName === sel;
}

const html = makeEl('html');
const head = makeEl('head');
html.appendChild(head);
const body = makeEl('body');
html.appendChild(body);

const documentStub = {
  documentElement: html, head,
  createElement: (t) => makeEl(t),
  createElementNS: (ns, t) => makeEl(t, ns),
  createTextNode: (t) => { const n = makeEl('#text'); n.textContent = t; return n; },  getElementById: (id) => descendants(html).find((n) => n.getAttribute('id') === id) || null,
  querySelector: (sel) => (matches(html, sel) ? html : descendants(html).find((n) => matches(n, sel)) || null),
  querySelectorAll: (sel) => descendants(html).filter((n) => matches(n, sel)),
};

let timerSeq = 0;
const timers = new Map();
function setTimeoutStub(fn) { const id = ++timerSeq; timers.set(id, fn); return id; }
function clearTimeoutStub(id) { timers.delete(id); }
function flushTimers(max = 10) {
  for (let i = 0; i < max && timers.size > 0; i++) {
    const batch = [...timers.values()];
    timers.clear();
    for (const fn of batch) fn();
  }
}

const observers = [];
function MutationObserverStub(cb) { this.cb = cb; observers.push(this); }
MutationObserverStub.prototype.observe = function () {};
MutationObserverStub.prototype.disconnect = function () { this.disconnected = true; };

// ───────────────────────── 模拟官方卡片 DOM ─────────────────────────
function makeCard(name) {
  const card = makeEl('li');
  card.setAttribute('data-plugin-package', name);
  const head = makeEl('div');
  const main = makeEl('div');          // cardMain：承载行挂在这里
  const titleRow = makeEl('div');
  const button = makeEl('button');
  button.textContent = name;
  titleRow.appendChild(button);
  main.appendChild(titleRow);
  const desc = makeEl('span');          // cardDesc
  desc.textContent = '描述';
  main.appendChild(desc);
  head.appendChild(main);
  card.appendChild(head);
  return { card, main };
}
const panel = makeEl('section');
panel.setAttribute('data-plugin-panel', 'true');
body.appendChild(panel);
const cards = {
  one: makeCard('one'),   // 单组件 → 运行中
  multi: makeCard('multi'), // 三组件 → 运行中/已关闭/运行中
  none: makeCard('none'), // 无 rows → 不占位
};
for (const k of Object.keys(cards)) panel.appendChild(cards[k].card);

// ───────────────────────── 加载 client.js ─────────────────────────
let registered = null;
const win = { __ModuleLoader__: { load: (e) => { registered = e; } } };
new Function('window', 'document', 'MutationObserver', 'setTimeout', 'clearTimeout', source)(
  win, documentStub, MutationObserverStub, setTimeoutStub, clearTimeoutStub
);

// 官方字典：插件应优先绑它，因此文案必须与详情页同源
const officialDict = {
  partOff: '已关闭', rowStateIdle: '未运行', rowPhasePending: '等待依赖',
  rowPhaseLoading: '加载中', rowPhaseActive: '运行中', rowPhaseFailed: '异常',
  rowPhaseUnloading: '卸载中',
};
let bindCalls = 0;
const bundles = [
  { name: 'one', rows: [{ rowId: 'a', moduleName: 'mod-a', entryId: 'e1' }] },
  { name: 'multi', rows: [
      { rowId: 'b', moduleName: 'mod-b', entryId: 'e2' },
      { rowId: 'c', moduleName: 'mod-c', entryId: 'e3' },
      { rowId: 'd', moduleName: 'mod-d', entryId: 'e4' },
    ] },
  { name: 'none', rows: [] },
];
const plugins = [
  { entryId: 'e1', enabled: true, fiberPhase: 'active' },
  { entryId: 'e2', enabled: true, fiberPhase: 'active' },
  { entryId: 'e3', enabled: false, fiberPhase: null },
  { entryId: 'e4', enabled: true, fiberPhase: 'active' },
];
const disposers = [];
let changedCb = null;
const ctx = {
  // 真实 cordis 里服务是经 ctx.get() 免注入读取的；桩也要走同一条路径，
  // 否则测不到出货代码实际用的取值方式。
  get: (name) => {
    if (name === 'remote') return ctx.remote;
    if (name === 'remote.pluginManager') return ctx.remote.pluginManager;
    if (name === 'locale') return ctx.locale;
    return undefined;
  },
  remote: {
    pluginManager: {
      listBundles: async () => ({ ok: true, value: bundles }),
      listPlugins: async () => ({ ok: true, value: plugins }),
    },
    $on: (name, cb) => {
      if (name === 'plugin-manager/changed') changedCb = cb;
      return () => { changedCb = null; };
    },
  },
  locale: {
    bind: (ns) => {
      bindCalls++;
      return (k) => (Object.prototype.hasOwnProperty.call(officialDict, k) ? officialDict[k] : k);
    },
    resolveText: (t) => (typeof t === 'string' ? t : 'zh'),
    subscribe: () => () => {},
  },
  effect: (fn) => { disposers.push(fn()); },
};

const mod = registered.factory();
check('inject 为空（不阻塞启动门禁）', mod.inject, []);
mod.apply(ctx);

await new Promise((r) => setImmediate(r));
flushTimers();

function listOf(name) { return cards[name].main.querySelector('[data-subitem-list]'); }
function itemsOf(name) { return cards[name].main.querySelectorAll('[data-subitem]'); }

check('绑定了官方命名空间', bindCalls > 0, true);

// 单组件
check('单组件有承载行', listOf('one') !== null, true);
check('单组件一条', itemsOf('one').length, 1);
check('单组件文案', itemsOf('one')[0].textContent, 'mod-a运行中');
check('单组件状态点', itemsOf('one')[0].querySelector('.' + 'dsx-dot').getAttribute('data-state'), 'done');

// 多组件：一个包里有几个就显示几个
check('多组件三条', itemsOf('multi').length, 3);
check('多组件第1条', itemsOf('multi')[0].textContent, 'mod-b运行中');
check('多组件第2条已关闭', itemsOf('multi')[1].textContent, 'mod-c已关闭');
check('多组件第2条点', itemsOf('multi')[1].querySelector('.dsx-dot').getAttribute('data-state'), 'idle');
check('多组件第3条', itemsOf('multi')[2].textContent, 'mod-d运行中');

// 无 rows 不占位
check('无子项不占位', listOf('none'), null);
check('样式只注入一次', documentStub.querySelectorAll('style').length, 1);

// 承载行挂在 cardMain（描述下面），不是 titleRow 里
check('挂在 cardMain', listOf('one').parentElement === cards.one.main, true);

// React 重渲染抹掉后应重放
for (const n of ['one', 'multi']) { const l = listOf(n); if (l) l.remove(); }
check('抹掉后无承载行', documentStub.querySelectorAll('[data-subitem-list]').length, 0);
observers[0].cb();
flushTimers();
check('重放后单组件回来', listOf('one') !== null, true);
check('重放后多组件回来', itemsOf('multi').length, 3);

// 宿主状态变化（子项被关掉）后，卡片上的状态必须跟着更新
check('变化前文案', itemsOf('one')[0].textContent, 'mod-a运行中');
plugins[0] = { entryId: 'e1', enabled: false, fiberPhase: null };
check('已注册 changed 回调', typeof changedCb, 'function');
changedCb();
await new Promise((r) => setImmediate(r));
flushTimers();
check('变化后文案', itemsOf('one')[0].textContent, 'mod-a已关闭');
check('变化后状态点', itemsOf('one')[0].querySelector('.dsx-dot').getAttribute('data-state'), 'idle');

// disposer 必须清干净
for (const d of disposers) d();
check('卸载后承载行清空', documentStub.querySelectorAll('[data-subitem-list]').length, 0);
check('卸载后样式清空', documentStub.querySelectorAll('style').length, 0);
check('卸载后断开 observer', observers[0].disconnected, true);

if (failed > 0) { console.log(`\n${failed} 项失败`); process.exit(1); }
console.log('\n全部通过');
