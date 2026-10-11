// dsh-plugin-subitem-status —— 把插件详情页「包含的组件」里的状态标记
// （● 运行中 / ● 已关闭 / ● 未运行 / ● 异常 …）原样搬到插件列表的卡片上。
//
// 动机：插件页的卡片只反映 bundle 级开关。包开着，但里面某个组件没跑起来，
// 卡片上完全看不出来，必须点进详情页才发现。
//
// 做法：纯客户端增强，不覆盖 DSH 内核。
//   · 数据来自 remote.pluginManager 命名空间的 listBundles() / listPlugins()，
//     与官方插件页读的是同一份 Host 事实；服务一律用 ctx.get() 读取（不写 inject），
//     缺失时只是不显示徽标，绝不会让本 entry 卡住 Web UI 的启动门禁。
//   · 状态文案直接绑官方字典命名空间 pluginManager（partOff / rowStateIdle /
//     rowPhase*），因此与详情页一字不差；官方改措辞这里跟着变。
//   · 状态点的 DOM 与 CSS 按官方 StateDot / rowState 抄写（类名换成自己的
//     前缀，只引用 --dsw-alias-* token）——插件不得 require 客户端原语包。
//   · 只在已渲染的卡片上补一行；不搬动 React 自己的节点，被重渲染抹掉时由
//     MutationObserver 重放。类名是 CSS-module 哈希，故只用稳定 data-* 属性定位。
//
// 纯逻辑挂在 window.__dshSubitemStatusCore 上（无副作用），便于 node 侧单测。
(function () {
  'use strict';

  var LIST_ATTR = 'data-subitem-list';
  var ITEM_ATTR = 'data-subitem';
  var STYLE_ID = 'dsh-plugin-subitem-status-style';
  var PREFIX = 'dsx';

  // ───────────────────────── 纯逻辑（可测） ─────────────────────────

  /** 官方 PHASE_KEYS：fiber phase → 字典键。 */
  var PHASE_KEYS = {
    pending: 'rowPhasePending',
    loading: 'rowPhaseLoading',
    active: 'rowPhaseActive',
    failed: 'rowPhaseFailed',
    unloading: 'rowPhaseUnloading'
  };

  /** 官方 PHASE_STATES：fiber phase → StateDot 的 data-state。 */
  var PHASE_STATES = {
    pending: 'idle',
    loading: 'ongoing',
    active: 'done',
    failed: 'error',
    unloading: 'ongoing'
  };

  /**
   * 与官方 packageView 同口径地取一个 row 的 live 状态。
   * row 没有 live entry 时，官方把 enabled 视为 false。
   * @param {object} row Host 的 BundleRowInfo。
   * @param {Array} plugins Host 的 live plugin entries。
   * @returns {{enabled:boolean, phase:string|null}}
   */
  function rowView(row, plugins) {
    var live = null;
    if (row && row.entryId !== undefined && row.entryId !== null) {
      var list = Array.isArray(plugins) ? plugins : [];
      for (var i = 0; i < list.length; i++) {
        if (list[i] && list[i].entryId === row.entryId) { live = list[i]; break; }
      }
    }
    return {
      enabled: live ? live.enabled === true : false,
      phase: live ? live.fiberPhase : null
    };
  }

  /**
   * 官方 rowStateText / rowDotState 的合成结果：文案键 + 点的形态。
   * @param {boolean} enabled 子项是否启用。
   * @param {string|null} phase fiber phase。
   * @returns {{key:string, dot:string}}
   */
  function stateOf(enabled, phase) {
    if (!enabled) return { key: 'partOff', dot: 'idle' };
    if (phase === null || phase === undefined) return { key: 'rowStateIdle', dot: 'idle' };
    return {
      key: PHASE_KEYS[phase] !== undefined ? PHASE_KEYS[phase] : 'rowStateIdle',
      dot: PHASE_STATES[phase] !== undefined ? PHASE_STATES[phase] : 'idle'
    };
  }

  /**
   * 官方 rowText 的标题口径：本地化标题优先，回落模块名。
   * @param {object} row Host 的 BundleRowInfo。
   * @param {Function} resolveText 官方 locale 的本地化文本解析器。
   * @returns {string}
   */
  function titleOf(row, resolveText) {
    var raw = row && row.meta ? row.meta.title : undefined;
    var fallback = row && row.moduleName ? row.moduleName : '';
    if (raw === undefined || raw === null) return fallback;
    if (typeof raw === 'string') return raw;
    try { return resolveText ? resolveText(raw) : fallback; } catch (e) { return fallback; }
  }

  /**
   * 一个 bundle 的全部子项视图，顺序与详情页「包含的组件」一致。
   * @param {object} bundle Host 的 BundleInfo。
   * @param {Array} plugins Host 的 live plugin entries。
   * @param {Function} resolveText 官方 locale 的本地化文本解析器。
   * @returns {Array<{title:string, key:string, dot:string}>}
   */
  function buildItems(bundle, plugins, resolveText) {
    var rows = bundle && Array.isArray(bundle.rows) ? bundle.rows : [];
    var out = [];
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i] || {};
      var view = rowView(row, plugins);
      var state = stateOf(view.enabled, view.phase);
      out.push({ title: titleOf(row, resolveText), key: state.key, dot: state.dot });
    }
    return out;
  }

  /**
   * 官方字典的兜底副本：绑定失败时用，措辞与官方 zh/en 一致。
   * 正常路径下文案来自官方命名空间本身，不走这里。
   */
  var FALLBACK = {
    partOff: '已关闭',
    rowStateIdle: '未运行',
    rowPhasePending: '等待依赖',
    rowPhaseLoading: '加载中',
    rowPhaseActive: '运行中',
    rowPhaseFailed: '异常',
    rowPhaseUnloading: '卸载中'
  };

  if (typeof window !== 'undefined') {
    window.__dshSubitemStatusCore = {
      LIST_ATTR: LIST_ATTR,
      ITEM_ATTR: ITEM_ATTR,
      PHASE_KEYS: PHASE_KEYS,
      PHASE_STATES: PHASE_STATES,
      FALLBACK: FALLBACK,
      rowView: rowView,
      stateOf: stateOf,
      titleOf: titleOf,
      buildItems: buildItems
    };
  }

  // ───────────────────────── 样式（抄官方 StateDot / rowState） ─────────────────────────

  var CSS = [
    // 承载行：跟在卡片描述下面，多个组件自动换行
    '[data-subitem-list]{display:flex;flex-wrap:wrap;align-items:center;gap:4px 14px;}',
    '[data-dsx-package-label]{display:block;font-size:10px;line-height:14px;color:var(--dsw-alias-label-tertiary);font-weight:400;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%;}',
    '[data-dsx-package-button]{height:auto!important;min-height:40px;padding-top:6px;padding-bottom:6px;}',
    '[data-dsx-package-button][role="tab"]{flex-direction:column;align-items:flex-start;}',
    '[data-subitem]{display:inline-flex;align-items:center;gap:6px;min-width:0;}',
    '[data-subitem] .' + PREFIX + '-name{',
    'color:var(--dsw-alias-label-tertiary);font-size:12.5px;line-height:18px;',
    'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:16em;}',
    // 官方 .rowState
    '.' + PREFIX + '-state{',
    'color:var(--dsw-alias-label-secondary);white-space:nowrap;flex:none;',
    'align-items:center;gap:6px;font-size:12.5px;line-height:18px;display:inline-flex;}',
    '[data-subitem][data-state="failed"] .' + PREFIX + '-state{',
    'color:var(--dsw-alias-state-error-primary);}',
    // 官方 StateDot .dot
    '.' + PREFIX + '-dot{position:relative;display:inline-block;flex:none;}',
    '.' + PREFIX + '-dot::after{',
    'content:"";position:absolute;inset:20%;border-radius:50%;',
    'corner-shape:round;background:currentColor;}',
    '.' + PREFIX + '-dot[data-state="done"]{color:var(--dsw-alias-state-success-primary);}',
    '.' + PREFIX + '-dot[data-state="warning"]{color:var(--dsw-alias-state-warn-primary);}',
    '.' + PREFIX + '-dot[data-state="error"]{color:var(--dsw-alias-state-error-primary);}',
    '.' + PREFIX + '-dot[data-state="idle"]{color:var(--dsw-alias-state-idle-primary);}',
    // 官方 StateDot .spinner（ongoing 是唯一非圆点形态）
    '.' + PREFIX + '-spinner{flex:none;color:var(--dsw-alias-label-tertiary);}',
    '.' + PREFIX + '-spinnerMotion{transform-origin:center;animation:' + PREFIX + '-spin 1.5s linear infinite;}',
    '.' + PREFIX + '-spinnerTrack,.' + PREFIX + '-spinnerArc{',
    'fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;}',
    '.' + PREFIX + '-spinnerTrack{opacity:.25;}',
    '.' + PREFIX + '-spinnerArc{',
    'stroke-dasharray:12 150;animation:' + PREFIX + '-dash 1.5s ease-in-out infinite;}',
    '@keyframes ' + PREFIX + '-spin{to{transform:rotate(360deg);}}',
    '@keyframes ' + PREFIX + '-dash{',
    '0%{stroke-dasharray:12 150;stroke-dashoffset:0;}',
    '50%{stroke-dasharray:24 150;stroke-dashoffset:-6;}',
    '100%{stroke-dasharray:12 150;stroke-dashoffset:0;}}',
    '@media (prefers-reduced-motion:reduce){',
    '.' + PREFIX + '-spinnerMotion,.' + PREFIX + '-spinnerArc{animation:none;}',
    '.' + PREFIX + '-spinnerArc{stroke-dasharray:18 150;stroke-dashoffset:-3;}}'
  ].join('');

  // ───────────────────────── DOM 粘合 ─────────────────────────

  var styleNode = null;
  var lastCardKey = null;
  var data = null;
  var fetching = false;
  var pendingFetch = false;
  var timer = null;
  var ctxRef = null;
  var translate = null;
  var rendering = false;
  var retryTimer = null;
  var retryDelay = 0;
  var generation = 0;

  /**
   * 取一个服务，**不依赖 inject 声明**。
   *
   * Cordis 的 `ctx` 是注入代理：读一个没写进 `inject` 的属性会直接抛
   * `cannot get property "..." without inject`；而把命名空间写进 `inject`，
   * 又会在该服务尚未挂载时让 fiber 停在 pending —— 两种都会卡死整个 Web UI
   * 的启动门禁（boot gate 要求每个 entry 都 active，一个不合格就整页打不开）。
   * `ctx.get()` 是官方提供的免注入读取：服务缺失时返回 undefined，不抛错、不 pending。
   * 拿不到服务时本插件只是不显示徽标，绝不影响启动。
   * @param {object} ctx 客户端上下文。
   * @param {string} name 服务名（如 'remote.pluginManager'）。
   * @returns {any} 服务对象；取不到时为 null。
   */
  function safeGet(ctx, name) {
    if (!ctx) return null;
    try {
      if (typeof ctx.get === 'function') {
        var value = ctx.get(name);
        if (value !== undefined && value !== null) return value;
      }
    } catch (e) { /* 落到下面的直接读取 */ }
    // 老版本 cordis 没有 ctx.get 时的退路：直接读，被注入代理拒绝就放弃。
    try {
      if (name === 'remote') return ctx.remote || null;
      if (name === 'locale') return ctx.locale || null;
    } catch (e) { /* 注入代理拒绝，说明该服务不可用 */ }
    return null;
  }

  function injectStyle() {
    if (typeof document === 'undefined') return;
    if (styleNode !== null && styleNode.parentElement !== null) return;
    var tag = document.createElement('style');
    tag.id = STYLE_ID;
    tag.setAttribute('data-plugin', 'dsh-plugin-subitem-status');
    tag.textContent = CSS;
    document.head.appendChild(tag);
    styleNode = tag;
  }

  /**
   * 文案取值：优先问官方命名空间 pluginManager（与详情页完全同源），
   * 绑定失败或键未命中时回落到同措辞副本。
   * @param {object} ctx 客户端上下文。
   * @returns {Function} key → 文案。
   */
  function makeTranslate(ctx) {
    var official = null;
    try {
      var locale = safeGet(ctx, 'locale');
      if (locale && typeof locale.bind === 'function') official = locale.bind('pluginManager');
    } catch (e) { official = null; }
    return function (key) {
      if (official !== null) {
        try {
          var s = official(key);
          // 官方字典里没有这个键时会原样返回键名，那就用兜底。
          if (typeof s === 'string' && s !== '' && s !== key) return s;
        } catch (e) { /* 落到兜底 */ }
      }
      return Object.prototype.hasOwnProperty.call(FALLBACK, key) ? FALLBACK[key] : key;
    };
  }

  function schedule(delay) {
    if (timer !== null) return;
    timer = setTimeout(function () {
      timer = null;
      try { render(); } catch (e) { /* 绝不因本插件破坏插件页 */ }
    }, typeof delay === 'number' ? delay : 150);
  }

  function fetchData(done) {
    var ctx = ctxRef;
    var pm = safeGet(ctx, 'remote.pluginManager');
    if (pm === null) { done(null); return; }
    var bundles, plugins;
    try {
      bundles = pm.listBundles();
      plugins = pm.listPlugins();
    } catch (e) {
      if (bundles) Promise.resolve(bundles).catch(function () {});
      done(null); return;
    }
    Promise.all([bundles, plugins]).then(function (res) {
      var b = res[0], p = res[1];
      if (!b || !b.ok || !p || !p.ok) { done(null); return; }
      var resolveText = null;
      try {
        var locale = safeGet(ctx, 'locale');
        resolveText = locale && locale.resolveText;
      } catch (e) { resolveText = null; }
      var byName = Object.create(null);
      var list = b.value || [];
      for (var i = 0; i < list.length; i++) {
        var one = list[i];
        if (!one || typeof one.name !== 'string') continue;
        byName[one.name] = buildItems(one, p.value, resolveText);
      }
      done(byName);
    }).catch(function () { done(null); });
  }

  function requestFetch() {
    if (ctxRef === null) return;
    if (fetching) { pendingFetch = true; return; }
    var started = generation;
    fetching = true;
    fetchData(function (byName) {
      if (ctxRef === null || started !== generation) return;
      fetching = false;
      if (byName === null) {
        // 读取失败（命名空间尚未就绪、连接刚断、Host 报错）：清掉卡片指纹并交给
        // 退避重试，不再排渲染 —— 否则「渲染→拉取→失败→渲染」会立刻重来一遍。
        lastCardKey = null;
        pendingFetch = false;
        scheduleRetry();
        return;
      }
      data = byName;
      retryDelay = 0;
      if (retryTimer !== null) { clearTimeout(retryTimer); retryTimer = null; }
      if (pendingFetch) {
        pendingFetch = false;
        requestFetch();
        return;
      }
      schedule(0);
    });
  }

  /** 失败后的退避重试：1s、2s、4s…最多 30s；成功后清零。 */
  function scheduleRetry() {
    if (retryTimer !== null) return;
    retryDelay = retryDelay === 0 ? 1000 : Math.min(retryDelay * 2, 30000);
    retryTimer = setTimeout(function () {
      retryTimer = null;
      if (data !== null) return;
      requestFetch();
    }, retryDelay);
  }

  /** 承载行的宿主：卡片标题行的父节点（cardMain），类名哈希化后只能用结构定位。 */
  function listHost(card) {
    var btn = card.querySelector('button');
    if (!btn || !btn.parentElement) return null;
    return btn.parentElement.parentElement || btn.parentElement;
  }

  /** 官方 StateDot 的等价节点：ongoing 是 svg 转环，其余是 span 圆点。 */
  function makeDot(state) {
    if (state === 'ongoing') {
      var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', PREFIX + '-spinner');
      svg.setAttribute('data-state', 'ongoing');
      svg.setAttribute('width', '14');
      svg.setAttribute('height', '14');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('aria-hidden', 'true');
      var g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('class', PREFIX + '-spinnerMotion');
      for (var i = 0; i < 2; i++) {
        var c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        c.setAttribute('class', i === 0 ? PREFIX + '-spinnerTrack' : PREFIX + '-spinnerArc');
        c.setAttribute('cx', '12');
        c.setAttribute('cy', '12');
        c.setAttribute('r', '9.5');
        g.appendChild(c);
      }
      svg.appendChild(g);
      return svg;
    }
    var dot = document.createElement('span');
    dot.setAttribute('class', PREFIX + '-dot');
    dot.setAttribute('data-state', state);
    dot.style.width = '10px';
    dot.style.height = '10px';
    dot.setAttribute('aria-hidden', 'true');
    return dot;
  }

  /** 按子项视图重建承载行内容。 */
  function fillList(list, items) {
    list.textContent = '';
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var wrap = document.createElement('span');
      wrap.setAttribute(ITEM_ATTR, '');
      if (item.dot === 'error') wrap.setAttribute('data-state', 'failed');

      var name = document.createElement('span');
      name.setAttribute('class', PREFIX + '-name');
      name.textContent = item.title;

      var state = document.createElement('span');
      state.setAttribute('class', PREFIX + '-state');
      state.appendChild(makeDot(item.dot));
      state.appendChild(document.createTextNode(translate(item.key)));

      wrap.appendChild(name);
      wrap.appendChild(state);
      list.appendChild(wrap);
    }
  }

  // 压缩后 registrant 可能只是 mf：以下已按注册源码核实，证据见 settings-providers.json。
  // 仅作诊断兜底，仍需当前模块清单核验；不作为防伪或权限认证。
  var SETTINGS_PROVIDERS = {
    'settings.section': {
      'general': '@deepseek-ai/dsh-client-ui-settings-general',
      'account': '@deepseek-ai/dsh-client-ui-settings-account',
      'models': '@deepseek-ai/dsh-client-ui-settings-models',
      'plugins': '@deepseek-ai/dsh-client-ui-settings-plugins',
      'pet-settings': 'dsh-pet-settings', 'dsh-phone': 'dsh-phone',
      'dsh-feature-toggles': 'dsh-feature-toggles', 'dsh-balance': 'dsh-feature-toggles',
      'codex-subscription': 'dsh-codex-subscription',
      'agent-presets': '@deepseek-ai/dsh-client-ui-agent-preset',
      'dock': 'dsh-dock-settings', 'plugin-shield': 'dsh-plugin-shield',
      'memes': 'dsh-meme', 'font-custom': 'dsh-font-custom',
      'easy-persona': '@deepseek-ai/dsh-easy-setup', 'easy-migration': '@deepseek-ai/dsh-easy-setup',
      'auto-compact': 'dsh-auto-compact', 'composer-dynamic-island': 'dsh-composer-dynamic-island',
      'change-review': 'dsh-change-review', 'dsh-undo': 'dsh-undo-savepoint',
      'wallpaper-engine': 'dsh-plugin-wallpaper-engine'
    },
    'settings.plugins.tab': {
      'all': '@deepseek-ai/dsh-client-ui-settings-plugin-inventory',
      'skin': '@deepseek-ai/dsh-skin-switch', 'market': 'dsh-unified-market',
      'feature-pack': 'dsh-unified-market', 'eac-plugin-suite': 'eac-plugin-suite'
    }
  };

  /** 注册来源是诊断信息，不是防伪认证；只解析合法 npm 模块名，绝不输出本机路径。 */
  function packageOf(registrant) {
    if (typeof registrant !== 'string') return null;
    var match = /^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)(?:\/.*)?$/.exec(registrant);
    if (!match) return null;
    var parts = registrant.split('/');
    var packageName = registrant.charAt(0) === '@' ? parts.slice(0, 2).join('/') : parts[0];
    var modules = safeGet(ctxRef, 'modules');
    try {
      var manifest = modules && modules.manifest && modules.manifest.modules;
      if (!Array.isArray(manifest)) return null;
      for (var i = 0; i < manifest.length; i++) {
        var moduleId = manifest[i].id;
        if (moduleId === registrant || moduleId === packageName ||
            (typeof moduleId === 'string' && moduleId.indexOf(packageName + '/') === 0)) return packageName;
      }
    } catch (e) { /* 不将无法核对的诊断标签伪装为包名 */ }
    return null;
  }

  function settingsRows(slot) {
    var registry = safeGet(ctxRef, 'slots');
    if (!registry || typeof registry.entries !== 'function') return [];
    try {
      return registry.entries(slot).map(function (entry) {
        var label = entry.options.label;
        return { id: entry.options.id, order: entry.options.order || 0,
          label: typeof label === 'function' ? label() : label,
          packageName: packageOf(entry.registrant) ||
            ((entry.registrant === 'mf' || !entry.registrant) &&
             Object.prototype.hasOwnProperty.call(SETTINGS_PROVIDERS[slot] || {}, entry.options.id)
              ? packageOf(SETTINGS_PROVIDERS[slot][entry.options.id]) : null) };
      }).sort(function (a, b) { return a.order - b.order; });
    } catch (e) { return []; }
  }

  function addPackageLabel(button, host, row) {
    var text = row.packageName || '包名未声明';
    var note = host.querySelector('[data-dsx-package-label]');
    if (note && note.textContent === text) return;
    if (note) note.remove();
    note = document.createElement('small');
    note.setAttribute('data-dsx-package-label', '');
    note.setAttribute('aria-hidden', 'true');
    note.setAttribute('title', row.packageName ? '提供者包：' + text : '此配置页面未声明可识别的 npm 包来源');
    note.textContent = text;
    button.setAttribute('data-dsx-package-button', '');
    host.appendChild(note);
  }

  function renderSettings() {
    var dialog = document.querySelector('[data-shortcut-modal="settings"]');
    if (!dialog) return;
    var nav = dialog.querySelector('nav');
    var rows = settingsRows('settings.section');
    if (nav) {
      var buttons = nav.querySelectorAll('button');
      // 官方 nav 没有 row id 属性：同时校验数量、原始标题和注册顺序，结构变化则不猜。
      if (buttons.length === rows.length) {
        for (var i = 0; i < rows.length; i++) {
          var label = buttons[i].querySelector('span');
          if (!label) continue;
          var note = label.querySelector('[data-dsx-package-label]');
          var text = label.textContent;
          if (note) text = text.slice(0, text.length - note.textContent.length);
          if (text === rows[i].label) addPackageLabel(buttons[i], label, rows[i]);
        }
      }
    }
    var tabs = dialog.querySelectorAll('[role="tab"]');
    var tabRows = settingsRows('settings.plugins.tab');
    for (var t = 0; t < tabs.length; t++) {
      var id = tabs[t].getAttribute('id') || '';
      var controls = tabs[t].getAttribute('aria-controls') || '';
      for (var r = 0; r < tabRows.length; r++) {
        var row = tabRows[r];
        if (typeof row.id !== 'string') continue;
        var suffix = '-tab-' + row.id;
        if (id.slice(-suffix.length) !== suffix) continue;
        var prefix = id.slice(0, -suffix.length);
        if (controls !== prefix + '-panel-' + row.id) continue;
        addPackageLabel(tabs[t], tabs[t], row);
        break;
      }
    }
  }

  function render() {
    if (typeof document === 'undefined' || ctxRef === null) return;
    try { renderSettings(); } catch (e) { /* 结构或注册服务变化时安全降级 */ }
    var panel = document.querySelector('[data-plugin-panel]');
    if (panel === null) return;
    var cards = panel.querySelectorAll('[data-plugin-package]');
    if (cards.length === 0) return;

    var names = [];
    for (var i = 0; i < cards.length; i++) names.push(cards[i].getAttribute('data-plugin-package'));
    var key = names.join('\n');
    if (key !== lastCardKey) {
      lastCardKey = key;
      requestFetch();
    }
    if (data === null) return;

    rendering = true;
    try {
      for (var k = 0; k < cards.length; k++) {
        var card = cards[k];
        var name = card.getAttribute('data-plugin-package');
        var items = Object.prototype.hasOwnProperty.call(data, name) ? data[name] : null;
        var existing = card.querySelector('[' + LIST_ATTR + ']');

        // 没有子项可显示（未安装的官方包读不到 patch 行）时不占位。
        if (items === null || items.length === 0) {
          if (existing !== null) existing.remove();
          continue;
        }

        var sig = items.length + '|';
        for (var j = 0; j < items.length; j++) {
          sig += items[j].title + '\u0001' + items[j].key + '\u0001' + items[j].dot + '\u0001' + translate(items[j].key) + '\u0002';
        }
        if (existing !== null && existing.getAttribute('data-sig') === sig) continue;

        var host = listHost(card);
        if (host === null) continue;
        var list = document.createElement('div');
        list.setAttribute(LIST_ATTR, '');
        list.setAttribute('data-sig', sig);
        fillList(list, items);
        if (existing !== null) existing.remove();
        host.appendChild(list);
      }
    } finally {
      rendering = false;
    }
  }

  function apply(ctx) {
    generation++;
    fetching = false;
    pendingFetch = false;
    ctxRef = ctx;
    translate = makeTranslate(ctx);
    try { injectStyle(); } catch (e) { /* DOM 尚未就绪不阻塞启动 */ }

    var observer = null;
    if (typeof MutationObserver !== 'undefined') {
      try {
        observer = new MutationObserver(function () {
          // MutationObserver 异步回调；幂等签名阻止重复写入。
          if (rendering || ctxRef === null) return;
          schedule();
        });
        observer.observe(document.documentElement, { childList: true, subtree: true });
      } catch (e) {
        if (observer !== null) observer.disconnect();
        observer = null;
      }
    }

    ctx.effect(function () {
      var offChanged = null;
      try {
        var remote = safeGet(ctx, 'remote');
        if (remote && typeof remote.$on === 'function') {
          offChanged = remote.$on('plugin-manager/changed', function () {
            data = null;
            lastCardKey = null;
            requestFetch();
          });
        }
      } catch (e) { offChanged = null; }

      // 语言切换后子项标题与状态文案都要跟着变。
      var offLocale = null;
      try {
        var locale = safeGet(ctx, 'locale');
        if (locale && typeof locale.subscribe === 'function') {
          offLocale = locale.subscribe(function () {
            data = null;
            lastCardKey = null;
            requestFetch();
          });
        }
      } catch (e) { offLocale = null; }

      return function () {
        generation++;
        ctxRef = null;
        fetching = false;
        pendingFetch = false;
        if (timer !== null) { clearTimeout(timer); timer = null; }
        if (retryTimer !== null) { clearTimeout(retryTimer); retryTimer = null; }
        if (observer !== null) observer.disconnect();
        if (typeof offChanged === 'function') offChanged();
        if (typeof offLocale === 'function') offLocale();
        var lists = typeof document === 'undefined' ? [] : document.querySelectorAll('[' + LIST_ATTR + ']');
        for (var i = 0; i < lists.length; i++) lists[i].remove();
        if (typeof document !== 'undefined') {
          var notes = document.querySelectorAll('[data-dsx-package-label]');
          for (var n = 0; n < notes.length; n++) notes[n].remove();
          var marked = document.querySelectorAll('[data-dsx-package-button]');
          for (var m = 0; m < marked.length; m++) marked[m].removeAttribute('data-dsx-package-button');
        }
        if (styleNode !== null) { styleNode.remove(); styleNode = null; }
        ctxRef = null;
        translate = null;
        data = null;
        lastCardKey = null;
        retryDelay = 0;
        rendering = false;
      };
    });

    requestFetch();
    schedule(300);
  }

  window.__ModuleLoader__.load({
    id: 'dsh-plugin-subitem-status',
    factory: function () {
      // inject 必须留空：本插件用到的 remote / locale / remote.pluginManager 全部走
      // ctx.get() 惰性读取（见 safeGet 的注释）。把服务写进 inject 有两种卡死风险：
      //   · 读未声明的属性 → 注入代理抛错 → fiber failed；
      //   · 声明了但服务尚未挂载 → fiber pending。
      // 两者都会让 boot gate 判定本 entry 未激活，从而**整页打不开**。
      // 留空 + ctx.get：任何服务缺失都只是不显示徽标，绝不阻塞启动。
      return { inject: [], apply: apply };
    }
  });
})();
