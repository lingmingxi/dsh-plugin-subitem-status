// 设置页包来源标签回归：纯 Node DOM 桩，无安装、网络或本机依赖。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8');
let checks = 0;
function check(name, actual, expected) {
  assert.deepEqual(actual, expected, name);
  checks++;
  console.log(`ok   ${name}`);
}
function descendants(node) {
  return node.children.flatMap((child) => [child, ...descendants(child)]);
}
function matches(node, selector) {
  const attr = /^\[([^=\]]+)(?:="([^"]*)")?\]$/.exec(selector);
  if (attr) return node.getAttribute(attr[1]) !== null &&
    (attr[2] === undefined || node.getAttribute(attr[1]) === attr[2]);
  return node.tagName === selector;
}
function element(tagName) {
  return {
    tagName, children: [], attrs: {}, style: {}, parentElement: null, raw: '',
    setAttribute(key, value) { this.attrs[key] = String(value); },
    getAttribute(key) { return Object.hasOwn(this.attrs, key) ? this.attrs[key] : null; },
    removeAttribute(key) { delete this.attrs[key]; },
    appendChild(child) {
      if (child.parentElement) child.remove();
      child.parentElement = this;
      this.children.push(child);
      return child;
    },
    remove() {
      if (this.parentElement) {
        const siblings = this.parentElement.children;
        siblings.splice(siblings.indexOf(this), 1);
        this.parentElement = null;
      }
    },
    get textContent() { return this.raw + this.children.map((child) => child.textContent).join(''); },
    set textContent(value) {
      for (const child of this.children) child.parentElement = null;
      this.children = [];
      this.raw = String(value);
    },
    querySelectorAll(selector) { return descendants(this).filter((node) => matches(node, selector)); },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
  };
}
function entry(id, label, registrant, order = 0) {
  return { options: { id, label, order }, registrant };
}
async function fixture(sections, tabRows = [], moduleIds = [], navLabels = sections.map((row) =>
  typeof row.options.label === 'function' ? row.options.label() : row.options.label)) {
  const html = element('html');
  const head = html.appendChild(element('head'));
  const body = html.appendChild(element('body'));
  // 错误 modal 放在前面，证明 equals 选择器不会误装饰其他对话框。
  const other = body.appendChild(element('section'));
  other.setAttribute('data-shortcut-modal', 'other');
  const dialog = body.appendChild(element('section'));
  dialog.setAttribute('data-shortcut-modal', 'settings');
  const nav = dialog.appendChild(element('nav'));
  const buttons = navLabels.map((label) => {
    const button = nav.appendChild(element('button'));
    button.appendChild(element('span')).textContent = label;
    return button;
  });
  const document = {
    documentElement: html, head,
    createElement: element,
    querySelector: (selector) => html.querySelector(selector),
    querySelectorAll: (selector) => html.querySelectorAll(selector),
  };
  const timers = new Map();
  let seq = 0;
  const disposers = [];
  const observers = [];
  function Observer(callback) { this.callback = callback; observers.push(this); }
  Observer.prototype.observe = function () {};
  Observer.prototype.disconnect = function () { this.disconnected = true; };
  let registered;
  new Function('window', 'document', 'MutationObserver', 'setTimeout', 'clearTimeout', source)(
    { __ModuleLoader__: { load(value) { registered = value; } } }, document, Observer,
    (callback) => { const id = ++seq; timers.set(id, callback); return id; },
    (id) => timers.delete(id),
  );
  const services = {
    slots: { entries: (slot) => slot === 'settings.section' ? sections :
      slot === 'settings.plugins.tab' ? tabRows : [] },
    modules: { manifest: { modules: moduleIds.map((id) => ({ id })) } },
    'remote.pluginManager': {
      listBundles: async () => ({ ok: true, value: [] }),
      listPlugins: async () => ({ ok: true, value: [] }),
    },
  };
  registered.factory().apply({ get: (name) => services[name], effect: (fn) => disposers.push(fn()) });
  async function flush() {
    await new Promise((resolve) => setImmediate(resolve));
    for (let iteration = 0; timers.size && iteration < 12; iteration++) {
      const batch = [...timers.values()];
      timers.clear();
      for (const callback of batch) callback();
      await new Promise((resolve) => setImmediate(resolve));
    }
    assert.equal(timers.size, 0, '定时器应收敛');
  }
  await flush();
  return { html, dialog, buttons, observers, flush,
    note: (node) => node.querySelector('[data-dsx-package-label]'),
    tab(id, controls) {
      const button = dialog.appendChild(element('button'));
      button.setAttribute('role', 'tab');
      button.setAttribute('id', id);
      button.setAttribute('aria-controls', controls);
      button.textContent = '同名标签';
      return button;
    },
    async replay() { for (const observer of observers) observer.callback(); await flush(); },
    dispose() { for (const disposer of disposers) disposer(); },
  };
}

const longPackage = '@example/a-very-long-portable-plugin-package-name';
const f = await fixture([
  entry('scoped', () => '长包名', longPackage + '/client/settings', 0),
  entry('plain', '子路径', 'portable-plugin/client', 1),
  entry('unknown', '未知', 'undeclared-plugin', 2),
  entry('windows', 'Windows 来源', 'L:/private-local-install/plugins/client.js', 3),
  entry('unix', 'Unix 来源', '/home/private-user/plugins/client.js', 4),
], [
  entry('alpha', '同名标签', longPackage + '/client'),
  entry('beta', '同名标签', 'portable-plugin/client'),
], [longPackage + '/client', 'portable-plugin']);
check('scoped 长包名保持完整并去掉子路径', f.note(f.buttons[0]).textContent, longPackage);
check('普通包去掉子路径', f.note(f.buttons[1]).textContent, 'portable-plugin');
check('未知 registrant 不伪装成来源', f.note(f.buttons[2]).textContent, '包名未声明');
check('Windows 本机路径不输出', f.note(f.buttons[3]).textContent, '包名未声明');
check('Unix 本机路径不输出', f.note(f.buttons[4]).textContent, '包名未声明');
check('未知来源 title 不泄露原始路径', f.note(f.buttons[3]).getAttribute('title'),
  '此配置页面未声明可识别的 npm 包来源');
check('来源标签完整包名放入 title', f.note(f.buttons[0]).getAttribute('title'), '提供者包：' + longPackage);
check('正确 modal 外不添加标签', f.html.querySelector('[data-shortcut-modal="other"]').children.length, 0);
const good = f.tab('settings-tab-alpha', 'settings-panel-alpha');
const goodBeta = f.tab('another-tab-beta', 'another-panel-beta');
const badControls = f.tab('settings-tab-alpha', 'other-panel-alpha');
const badId = f.tab('settings-tab-no-alpha', 'settings-panel-alpha');
const unknownTab = f.tab('settings-tab-unregistered', 'settings-panel-unregistered');
await f.replay();
check('tab id 与 aria-controls 双重匹配', f.note(good).textContent, longPackage);
check('同名 tab 通过 id 区分来源', f.note(goodBeta).textContent, 'portable-plugin');
check('aria-controls 前缀不匹配不猜来源', f.note(badControls), null);
check('id 前缀与 panel 不匹配不猜来源', f.note(badId), null);
check('未知 tab id 不猜来源', f.note(unknownTab), null);
const count = f.html.querySelectorAll('[data-dsx-package-label]').length;
await f.replay();
await f.replay();
check('重放不重复添加标签', f.html.querySelectorAll('[data-dsx-package-label]').length, count);
f.note(f.buttons[0]).remove();
await f.replay();
check('React 抹掉标签后重建', f.note(f.buttons[0]).textContent, longPackage);
f.dispose();
check('卸载清空所有标签', f.html.querySelectorAll('[data-dsx-package-label]').length, 0);
check('卸载清空所有 button 标记', f.html.querySelectorAll('[data-dsx-package-button]').length, 0);
check('卸载断开 observer', f.observers.every((observer) => observer.disconnected), true);

const mismatch = await fixture([entry('only', '唯一', 'portable-plugin')], [], ['portable-plugin'], ['唯一', '额外']);
check('nav 按钮数量不等时全部跳过', mismatch.html.querySelectorAll('[data-dsx-package-label]').length, 0);
mismatch.dispose();
const wrongTitle = await fixture([entry('only', '注册标题', 'portable-plugin')], [], ['portable-plugin'], ['不同标题']);
check('nav 原始标题不匹配时跳过', wrongTitle.note(wrongTitle.buttons[0]), null);
wrongTitle.dispose();
const knownFallback = await fixture([entry('dsh-balance', '余额', 'mf')], [], ['dsh-feature-toggles']);
check('mf 已知 id 且 manifest 存在时映射实际提供包', knownFallback.note(knownFallback.buttons[0]).textContent, 'dsh-feature-toggles');
knownFallback.dispose();
const absentFallback = await fixture([entry('dsh-balance', '余额', 'mf')]);
check('mf 已知 id 但 manifest 缺失时不推测包名', absentFallback.note(absentFallback.buttons[0]).textContent, '包名未声明');
absentFallback.dispose();
const explicitProvider = await fixture([entry('dsh-balance', '余额', 'alternate-provider/client')], [],
  ['alternate-provider', 'dsh-feature-toggles']);
check('已知 id 优先经核验的自声明 registrant 而非 fallback', explicitProvider.note(explicitProvider.buttons[0]).textContent, 'alternate-provider');
explicitProvider.dispose();
console.log(`\n全部通过（${checks} 项）`);
