// == TavernHelper Script ==
// name: 楼层星心标记
// author: Codex
// version: v0.4.1
// description: 在 AI 消息楼层的三点按钮旁添加星星和爱心，可点亮/取消；状态保存到聊天消息 extra 中。
// ==
(function () {
  'use strict';

  const SCRIPT_NAME = '楼层星心标记';
  const SCRIPT_VERSION = 'v0.4.1';
  const BUTTON_NAME = '星心刷新';
  const GLOBAL_INSTANCE_KEY = '__th_message_star_marker_instance_v1__';
  const STYLE_ID = 'th-message-star-marker-style-v3';
  const BADGE_ID = 'th-message-star-marker-loaded-badge';
  const BUTTON_CLASS = 'th-message-marker-btn';
  const ACTIVE_CLASS = 'th-message-marker-active';
  const EXTRA_KEY = 'thMessageMarker';

  const MARKERS = [
    { type: 'star', symbol: '★', activeColor: '#f2a900', onTitle: '取消星标', offTitle: '星标未读' },
    { type: 'heart', symbol: '♥', activeColor: '#df4f73', onTitle: '取消爱心', offTitle: '爱心标记' },
  ];

  const runtime = {
    observer: null,
    scanTimer: null,
    saveTimers: new Map(),
    weakIds: new WeakMap(),
    nextWeakId: 1,
    stopping: false,
  };

  function getHostWindow() {
    let current = window;
    let best = window;
    let bestArea = getWindowArea(window);
    for (let index = 0; index < 8; index += 1) {
      try {
        if (!current.parent || current.parent === current || !current.parent.document) break;
        current = current.parent;
        const area = getWindowArea(current);
        if (area >= bestArea) {
          best = current;
          bestArea = area;
        }
      } catch (error) {
        break;
      }
    }
    return best;
  }

  function getWindowArea(targetWindow) {
    try {
      const doc = targetWindow.document;
      const width = targetWindow.innerWidth || doc.documentElement.clientWidth || doc.body && doc.body.clientWidth || 0;
      const height = targetWindow.innerHeight || doc.documentElement.clientHeight || doc.body && doc.body.clientHeight || 0;
      return Math.max(0, width) * Math.max(0, height);
    } catch (error) {
      return 0;
    }
  }

  function getHostDocument() {
    const host = getHostWindow();
    return host.document || document;
  }

  function getTavernContext() {
    const host = getHostWindow();
    try {
      if (host.SillyTavern && typeof host.SillyTavern.getContext === 'function') {
        return host.SillyTavern.getContext();
      }
    } catch (error) {
      // Some builds expose SillyTavern lazily.
    }
    try {
      if (typeof host.getContext === 'function') return host.getContext();
    } catch (error) {
      // Continue with DOM fallbacks.
    }
    return null;
  }

  function getTavernHelper() {
    const host = getHostWindow();
    return window.TavernHelper || host.TavernHelper || null;
  }

  function notify(type, message) {
    const host = getHostWindow();
    let toastr = null;
    try {
      toastr = host.toastr || window.toastr;
    } catch (error) {
      toastr = window.toastr || null;
    }
    if (toastr && typeof toastr[type] === 'function') {
      toastr[type](message);
      return;
    }
    if (type === 'error') console.error(`[${SCRIPT_NAME}] ${message}`);
    else if (type === 'warning') console.warn(`[${SCRIPT_NAME}] ${message}`);
    else console.log(`[${SCRIPT_NAME}] ${message}`);
  }

  function isElementVisible(element) {
    if (!element || !element.isConnected) return false;
    const host = getHostWindow();
    const style = host.getComputedStyle ? host.getComputedStyle(element) : null;
    if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function getChatContainer() {
    const doc = getHostDocument();
    return doc.getElementById('chat')
      || doc.querySelector('#chat')
      || doc.querySelector('[data-testid="chat"]')
      || doc.body;
  }

  function getMessageNodes() {
    const root = getChatContainer();
    if (!root) return [];
    const nodes = Array.from(root.querySelectorAll('.mes'));
    if (nodes.length) return nodes.filter((node) => node.isConnected);
    return Array.from(root.querySelectorAll('[data-message-id], .message')).filter((node) => node.isConnected);
  }

  function getRawMesid(node) {
    if (!node) return '';
    const dataset = node.dataset || {};
    return String(
      node.getAttribute('mesid')
      || dataset.mesid
      || dataset.messageId
      || dataset.mesId
      || ''
    ).trim();
  }

  function getMessageIndex(node) {
    const rawMesid = getRawMesid(node);
    const numeric = Number(rawMesid);
    if (Number.isInteger(numeric) && numeric >= 0) return numeric;

    const nodes = getMessageNodes();
    const index = nodes.indexOf(node);
    return index >= 0 ? index : null;
  }

  function getMessageRecord(node) {
    const context = getTavernContext();
    const index = getMessageIndex(node);
    if (!context || !Array.isArray(context.chat) || !Number.isInteger(index)) return null;
    return context.chat[index] || null;
  }

  function isUserMessage(node) {
    if (!node) return false;
    const record = getMessageRecord(node);
    if (record && record.is_user === true) return true;

    const classList = node.classList;
    if (classList && (classList.contains('user_mes') || classList.contains('user-message'))) return true;
    const dataset = node.dataset || {};
    if (dataset.isUser === 'true' || dataset.role === 'user') return true;
    const attr = String(node.getAttribute('is_user') || node.getAttribute('data-is-user') || '').toLowerCase();
    return attr === 'true' || attr === '1';
  }

  function isAssistantMessage(node) {
    if (!node) return false;
    if (isUserMessage(node)) return false;
    const record = getMessageRecord(node);
    if (record && record.is_system === true) return false;
    if (node.classList && (node.classList.contains('system_mes') || node.classList.contains('sys_mes'))) return false;
    return true;
  }

  function getWeakNodeId(node) {
    if (!runtime.weakIds.has(node)) {
      runtime.weakIds.set(node, runtime.nextWeakId);
      runtime.nextWeakId += 1;
    }
    return runtime.weakIds.get(node);
  }

  function getFallbackKey(node) {
    const context = getTavernContext();
    const parts = [
      context && context.chatId,
      context && context.characterId,
      context && context.groupId,
      getRawMesid(node),
      getWeakNodeId(node),
    ];
    return parts.map((part) => String(part == null ? 'unknown' : part).trim() || 'unknown').join('|');
  }

  function getMarkerState(node, ensure) {
    const record = getMessageRecord(node);
    if (record) {
      if (!record.extra || typeof record.extra !== 'object') {
        if (!ensure) return {};
        record.extra = {};
      }
      if (!record.extra[EXTRA_KEY] || typeof record.extra[EXTRA_KEY] !== 'object') {
        if (!ensure) return {};
        record.extra[EXTRA_KEY] = {};
      }
      return record.extra[EXTRA_KEY];
    }

    const host = getHostWindow();
    if (!host[GLOBAL_INSTANCE_KEY]) return {};
    if (!host[GLOBAL_INSTANCE_KEY].fallbackMarks) host[GLOBAL_INSTANCE_KEY].fallbackMarks = {};
    const key = getFallbackKey(node);
    if (!host[GLOBAL_INSTANCE_KEY].fallbackMarks[key]) host[GLOBAL_INSTANCE_KEY].fallbackMarks[key] = {};
    return host[GLOBAL_INSTANCE_KEY].fallbackMarks[key];
  }

  async function saveChat() {
    const context = getTavernContext();
    const th = getTavernHelper();
    try {
      if (context && typeof context.saveChat === 'function') {
        await Promise.resolve(context.saveChat());
        return;
      }
      if (th && typeof th.saveChat === 'function') {
        await Promise.resolve(th.saveChat());
      }
    } catch (error) {
      console.warn(`[${SCRIPT_NAME}] 保存聊天失败`, error);
      notify('warning', '楼层标记已显示，但保存聊天失败。');
    }
  }

  function scheduleSave(node) {
    const index = getMessageIndex(node);
    const key = Number.isInteger(index) ? String(index) : getFallbackKey(node);
    const oldTimer = runtime.saveTimers.get(key);
    if (oldTimer) clearTimeout(oldTimer);
    const timer = setTimeout(() => {
      runtime.saveTimers.delete(key);
      saveChat();
    }, 180);
    runtime.saveTimers.set(key, timer);
  }

  function setMarker(node, markerType, value) {
    const state = getMarkerState(node, true);
    if (value) {
      state[markerType] = {
        marked: true,
        markedAt: new Date().toISOString(),
        version: SCRIPT_VERSION,
      };
    } else {
      delete state[markerType];
    }

    const record = getMessageRecord(node);
    if (record) {
      record.extra = record.extra && typeof record.extra === 'object' ? record.extra : {};
      record.extra[EXTRA_KEY] = state;
    }
    scheduleSave(node);
  }

  function isMarked(node, markerType) {
    const state = getMarkerState(node, false);
    const value = state && state[markerType];
    if (value && typeof value === 'object') return value.marked !== false;
    return value === true;
  }

  function syncButton(button, node, marker) {
    const active = isMarked(node, marker.type);
    button.classList.toggle(ACTIVE_CLASS, active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
    button.title = active ? marker.onTitle : marker.offTitle;
    button.setAttribute('aria-label', button.title);
    button.style.setProperty('--th-marker-active-color', marker.activeColor);
  }

  function createButton(node, marker) {
    const doc = getHostDocument();
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = `${BUTTON_CLASS} ${BUTTON_CLASS}-${marker.type}`;
    button.dataset.thMessageMarker = marker.type;
    button.textContent = marker.symbol;
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const next = !isMarked(node, marker.type);
      setMarker(node, marker.type, next);
      syncButton(button, node, marker);
    });
    return button;
  }

  function getButtonContainer(node) {
    return node.querySelector('.mes_buttons')
      || node.querySelector('.mes_buttons_container')
      || node.querySelector('.mes_controls')
      || node.querySelector('.mes_block')
      || node.querySelector('.mes_header')
      || node.querySelector('.ch_name')
      || node;
  }

  function getBeforeNode(container) {
    if (!container) return null;
    const candidates = [
      '.extraMesButtonsHint',
      '.extraMesButtons',
      '.mes_options',
      '.mes_menu',
      '.fa-ellipsis',
      '.fa-ellipsis-v',
      '.fa-ellipsis-h',
      '[data-action="extra"]',
      '[data-action="menu"]',
    ];
    for (const selector of candidates) {
      const found = container.querySelector(selector);
      if (found) return found.closest('button, .menu_button, .mes_button, span, div') || found;
    }
    return null;
  }

  function attachButtons(node) {
    if (!isAssistantMessage(node)) return;

    const container = getButtonContainer(node);
    if (!container) return;

    if (container === node && node.dataset.thMarkerFallbackContainer !== 'true') {
      node.dataset.thMarkerFallbackContainer = 'true';
      node.style.position = node.style.position || 'relative';
    }

    const beforeNode = getBeforeNode(container);
    MARKERS.forEach((marker) => {
      let button = node.querySelector(`.${BUTTON_CLASS}[data-th-message-marker="${marker.type}"]`);
      if (!button) {
        button = createButton(node, marker);
        if (beforeNode && beforeNode.parentNode === container) {
          container.insertBefore(button, beforeNode);
        } else {
          container.appendChild(button);
        }
      }
      syncButton(button, node, marker);
    });
  }

  function scanMessages() {
    runtime.scanTimer = null;
    getMessageNodes().forEach(attachButtons);
  }

  function scheduleScan(delay) {
    if (runtime.scanTimer) return;
    runtime.scanTimer = setTimeout(scanMessages, delay == null ? 80 : delay);
  }

  function injectStyle() {
    const doc = getHostDocument();
    let style = doc.getElementById(STYLE_ID);
    if (!style) {
      style = doc.createElement('style');
      style.id = STYLE_ID;
      doc.head.appendChild(style);
    }
    style.textContent = `
      .${BUTTON_CLASS} {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        min-width: 28px;
        margin: 0 1px;
        padding: 0;
        border: 0;
        border-radius: 5px;
        background: transparent;
        color: currentColor;
        cursor: pointer;
        font-family: Arial, "Microsoft YaHei", sans-serif;
        font-size: 21px;
        font-weight: 800;
        line-height: 1;
        opacity: 0.42;
        vertical-align: middle;
      }
      .${BUTTON_CLASS}:hover,
      .${BUTTON_CLASS}:focus-visible {
        background: rgba(245, 183, 66, 0.14);
        color: var(--th-marker-active-color);
        opacity: 0.95;
        outline: none;
      }
      .${BUTTON_CLASS}.${ACTIVE_CLASS} {
        color: var(--th-marker-active-color);
        opacity: 1;
        text-shadow: 0 0 5px currentColor;
      }
      #${BADGE_ID} {
        position: fixed;
        right: 8px;
        bottom: 8px;
        z-index: 2147483647;
        padding: 3px 7px;
        border: 1px solid rgba(120, 150, 140, 0.55);
        border-radius: 7px;
        background: rgba(20, 28, 24, 0.84);
        color: #e9fff3;
        font: 12px/1.4 Arial, "Microsoft YaHei", sans-serif;
        opacity: 0.72;
        pointer-events: none;
      }
    `;
  }

  function showLoadedBadge() {
    const doc = getHostDocument();
    if (!doc.body || doc.getElementById(BADGE_ID)) return;
    const badge = doc.createElement('div');
    badge.id = BADGE_ID;
    badge.textContent = '星心✓';
    doc.body.appendChild(badge);
    setTimeout(() => {
      if (badge && badge.parentNode) badge.remove();
    }, 6500);
  }

  function installObserver() {
    const root = getChatContainer();
    if (!root) return;
    if (runtime.observer) runtime.observer.disconnect();
    const Observer = getHostWindow().MutationObserver || window.MutationObserver;
    if (!Observer) return;
    runtime.observer = new Observer(() => scheduleScan(60));
    runtime.observer.observe(root, { childList: true, subtree: true });
  }

  function clearTimers() {
    if (runtime.scanTimer) clearTimeout(runtime.scanTimer);
    runtime.scanTimer = null;
    runtime.saveTimers.forEach((timer) => clearTimeout(timer));
    runtime.saveTimers.clear();
  }

  function removeOwnedDom() {
    const doc = getHostDocument();
    doc.querySelectorAll(`.${BUTTON_CLASS}`).forEach((node) => node.remove());
    const style = doc.getElementById(STYLE_ID);
    if (style) style.remove();
    const badge = doc.getElementById(BADGE_ID);
    if (badge) badge.remove();
  }

  function stopInstance() {
    if (runtime.stopping) return;
    runtime.stopping = true;
    clearTimers();
    if (runtime.observer) runtime.observer.disconnect();
    runtime.observer = null;
    removeOwnedDom();
    const host = getHostWindow();
    if (host[GLOBAL_INSTANCE_KEY] && host[GLOBAL_INSTANCE_KEY].instanceId === runtime.instanceId) {
      delete host[GLOBAL_INSTANCE_KEY];
    }
  }

  function claimGlobalInstance() {
    const host = getHostWindow();
    const previous = host[GLOBAL_INSTANCE_KEY];
    if (previous && previous.instanceId !== runtime.instanceId && typeof previous.stop === 'function') {
      try {
        previous.stop();
      } catch (error) {
        console.warn(`[${SCRIPT_NAME}] 清理旧实例失败`, error);
      }
    }
    host[GLOBAL_INSTANCE_KEY] = {
      instanceId: runtime.instanceId,
      version: SCRIPT_VERSION,
      fallbackMarks: previous && previous.fallbackMarks || {},
      stop: stopInstance,
      refresh: scanMessages,
      getMarkedRecords: () => {
        const context = getTavernContext();
        const chat = context && Array.isArray(context.chat) ? context.chat : [];
        return chat
          .map((record, index) => ({ index, marker: record && record.extra && record.extra[EXTRA_KEY] }))
          .filter((item) => item.marker && (item.marker.star || item.marker.heart));
      },
    };
  }

  function registerTavernHelperButton() {
    const handler = () => {
      scanMessages();
      const count = getMessageNodes().filter(isAssistantMessage).length;
      notify(count ? 'success' : 'warning', count ? `已刷新星心按钮：找到 ${count} 个 AI 楼层` : '已运行，但没有找到 AI 楼层。');
    };
    try {
      if (typeof appendInexistentScriptButtons === 'function') {
        appendInexistentScriptButtons([{ name: BUTTON_NAME, visible: true }]);
      }
      if (typeof eventOnButton === 'function') {
        eventOnButton(BUTTON_NAME, handler);
      }
      if (typeof getButtonEvent === 'function' && typeof eventOn === 'function') {
        eventOn(getButtonEvent(BUTTON_NAME), handler);
      }
    } catch (error) {
      console.warn(`[${SCRIPT_NAME}] 注册酒馆助手按钮失败`, error);
    }
  }

  function register() {
    runtime.instanceId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    claimGlobalInstance();

    const doc = getHostDocument();
    if (!doc.head || !doc.body) {
      setTimeout(register, 120);
      return;
    }

    injectStyle();
    showLoadedBadge();
    registerTavernHelperButton();
    installObserver();
    scanMessages();
    [300, 900, 1800, 3500].forEach((delay) => setTimeout(scanMessages, delay));
    notify('success', `${SCRIPT_NAME} 已加载`);
  }

  window.addEventListener('pagehide', stopInstance, { once: true });
  window.addEventListener('unload', stopInstance, { once: true });

  const initialDocument = getHostDocument();
  if (initialDocument.readyState === 'loading') {
    initialDocument.addEventListener('DOMContentLoaded', register, { once: true });
  } else {
    register();
  }
})();
