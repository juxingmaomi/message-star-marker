// == TavernHelper Script ==
// name: 楼层星心标记
// author: Codex
// version: v0.4.4
// description: 在 AI 消息楼层的三点按钮旁添加星星和爱心，可点亮/取消；状态保存到聊天消息 extra 中。
// ==
(function () {
  'use strict';

  const SCRIPT_NAME = '楼层星心标记';
  const SCRIPT_VERSION = 'v0.4.4';
  const BUTTON_NAME = '星心面板';
  const GLOBAL_INSTANCE_KEY = '__th_message_star_marker_instance_v1__';
  const STYLE_ID = 'th-message-star-marker-style-v3';
  const BADGE_ID = 'th-message-star-marker-loaded-badge';
  const PANEL_ID = 'th-message-star-marker-panel';
  const FLOATING_BUTTON_ID = 'th-message-star-marker-floating-button';
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

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function decodeHtmlEntities(value) {
    const doc = getHostDocument();
    const textarea = doc.createElement('textarea');
    textarea.innerHTML = String(value || '');
    return textarea.value;
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

  function isMarkerValueActive(value) {
    if (value && typeof value === 'object') return value.marked !== false;
    return value === true;
  }

  function getRecordMarker(record) {
    return record && record.extra && record.extra[EXTRA_KEY] && typeof record.extra[EXTRA_KEY] === 'object'
      ? record.extra[EXTRA_KEY]
      : {};
  }

  function getRecordText(record) {
    if (!record) return '';
    const swipeIndex = Number(record.swipe_id);
    if (Array.isArray(record.swipes) && Number.isInteger(swipeIndex) && typeof record.swipes[swipeIndex] === 'string') {
      return record.swipes[swipeIndex];
    }
    return String(record.mes || record.message || record.text || '');
  }

  function getSceneTitle(record) {
    const text = getRecordText(record);
    const match = /<\s*Scene_Title\s*>([\s\S]*?)<\s*\/\s*Scene_Title\s*>/i.exec(text);
    if (!match) return '';
    return decodeHtmlEntities(match[1]).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, 80);
  }

  function collectMarkedItems(filterType) {
    const context = getTavernContext();
    const chat = context && Array.isArray(context.chat) ? context.chat : [];
    const filter = MARKERS.some((marker) => marker.type === filterType) ? filterType : 'all';
    return chat.reduce((items, record, index) => {
      const markerState = getRecordMarker(record);
      const activeMarkers = MARKERS.filter((marker) => isMarkerValueActive(markerState[marker.type]));
      if (!activeMarkers.length) return items;
      if (filter !== 'all' && !activeMarkers.some((marker) => marker.type === filter)) return items;
      items.push({
        index,
        floor: index + 1,
        title: getSceneTitle(record),
        markers: activeMarkers,
      });
      return items;
    }, []);
  }

  function findMessageNodeByIndex(index) {
    const numericIndex = Number(index);
    if (!Number.isInteger(numericIndex)) return null;
    return getMessageNodes().find((node) => getMessageIndex(node) === numericIndex) || null;
  }

  function jumpToMessage(index) {
    scanMessages();
    const node = findMessageNodeByIndex(index);
    if (!node) {
      notify('warning', `没有找到第 ${Number(index) + 1} 楼。`);
      return;
    }
    try {
      node.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (error) {
      node.scrollIntoView();
    }
    node.classList.add('th-message-marker-jump-highlight');
    setTimeout(() => node.classList.remove('th-message-marker-jump-highlight'), 1600);
  }

  function removeRecordMarker(index, markerType) {
    const context = getTavernContext();
    const chat = context && Array.isArray(context.chat) ? context.chat : [];
    const numericIndex = Number(index);
    const record = Number.isInteger(numericIndex) ? chat[numericIndex] : null;
    if (!record || !record.extra || !record.extra[EXTRA_KEY]) return;
    delete record.extra[EXTRA_KEY][markerType];
    if (!record.extra[EXTRA_KEY].star && !record.extra[EXTRA_KEY].heart) {
      delete record.extra[EXTRA_KEY];
    }
    saveChat();
    scanMessages();
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
      .th-message-marker-jump-highlight {
        outline: 2px solid rgba(242, 169, 0, 0.72) !important;
        outline-offset: 3px !important;
        transition: outline-color 0.2s ease;
      }
      #${PANEL_ID} {
        position: fixed;
        right: 14px;
        bottom: calc(env(safe-area-inset-bottom, 0px) + 72px);
        z-index: 2147483646;
        width: min(340px, calc(100vw - 24px));
        max-height: min(520px, calc(100vh - 96px));
        display: flex;
        flex-direction: column;
        overflow: hidden;
        border: 1px solid rgba(120, 150, 140, 0.45);
        border-radius: 10px;
        background: rgba(22, 30, 27, 0.96);
        color: #edf6ef;
        box-shadow: 0 10px 26px rgba(0, 0, 0, 0.26);
        font-family: Arial, "Microsoft YaHei", sans-serif;
      }
      #${PANEL_ID} * {
        box-sizing: border-box;
      }
      .th-message-marker-panel-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 10px 12px;
        border-bottom: 1px solid rgba(120, 150, 140, 0.25);
      }
      .th-message-marker-panel-title {
        font-size: 14px;
        font-weight: 800;
      }
      .th-message-marker-panel-close {
        width: 28px;
        height: 28px;
        border: 0;
        border-radius: 6px;
        background: rgba(255, 255, 255, 0.08);
        color: inherit;
        cursor: pointer;
        font-size: 18px;
        line-height: 1;
      }
      .th-message-marker-panel-tabs {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 6px;
        padding: 10px 12px 6px;
      }
      .th-message-marker-panel-tab {
        height: 30px;
        border: 1px solid rgba(120, 150, 140, 0.36);
        border-radius: 7px;
        background: rgba(255, 255, 255, 0.05);
        color: inherit;
        cursor: pointer;
        font-size: 13px;
      }
      .th-message-marker-panel-tab[aria-pressed="true"] {
        border-color: rgba(242, 169, 0, 0.7);
        background: rgba(242, 169, 0, 0.14);
      }
      .th-message-marker-panel-list {
        display: grid;
        gap: 6px;
        min-height: 0;
        overflow: auto;
        padding: 8px 12px 12px;
      }
      .th-message-marker-panel-empty {
        padding: 18px 8px;
        color: rgba(237, 246, 239, 0.68);
        text-align: center;
        font-size: 13px;
      }
      .th-message-marker-panel-item {
        display: grid;
        grid-template-columns: 1fr auto;
        align-items: center;
        gap: 8px;
        min-height: 38px;
        padding: 6px 8px;
        border: 1px solid rgba(120, 150, 140, 0.22);
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.045);
      }
      .th-message-marker-panel-jump {
        min-width: 0;
        height: 30px;
        border: 0;
        background: transparent;
        color: inherit;
        cursor: pointer;
        text-align: left;
        font-size: 14px;
        font-weight: 700;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .th-message-marker-panel-title-text {
        color: rgba(237, 246, 239, 0.72);
        font-weight: 600;
      }
      .th-message-marker-panel-actions {
        display: inline-flex;
        align-items: center;
        gap: 4px;
      }
      .th-message-marker-panel-remove {
        width: 30px;
        height: 30px;
        border: 0;
        border-radius: 6px;
        background: rgba(255, 255, 255, 0.07);
        color: var(--th-marker-active-color);
        cursor: pointer;
        font-size: 18px;
        font-weight: 800;
        line-height: 1;
      }
      .th-message-marker-panel-remove:hover,
      .th-message-marker-panel-close:hover,
      .th-message-marker-panel-jump:hover {
        background: rgba(255, 255, 255, 0.12);
      }
      #${FLOATING_BUTTON_ID} {
        position: fixed;
        right: 10px;
        bottom: calc(env(safe-area-inset-bottom, 0px) + 40px);
        z-index: 2147483645;
        min-width: 46px;
        height: 30px;
        padding: 0 8px;
        border: 1px solid rgba(120, 150, 140, 0.55);
        border-radius: 8px;
        background: rgba(22, 30, 27, 0.88);
        color: #edf6ef;
        cursor: pointer;
        font: 13px/1 Arial, "Microsoft YaHei", sans-serif;
        opacity: 0.72;
      }
      #${FLOATING_BUTTON_ID}:hover {
        opacity: 1;
        background: rgba(22, 30, 27, 0.96);
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

  function ensureFloatingPanelButton() {
    const doc = getHostDocument();
    if (!doc.body) return;
    let button = doc.getElementById(FLOATING_BUTTON_ID);
    if (!button) {
      button = doc.createElement('button');
      button.id = FLOATING_BUTTON_ID;
      button.type = 'button';
      button.textContent = '星心';
      button.title = '打开星心列表';
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        toggleMarkerPanel();
      });
      doc.body.appendChild(button);
    }
  }

  function closeMarkerPanel() {
    const panel = getHostDocument().getElementById(PANEL_ID);
    if (panel) panel.remove();
  }

  function buildPanelHtml(filterType) {
    const filter = MARKERS.some((marker) => marker.type === filterType) ? filterType : 'all';
    const items = collectMarkedItems(filter);
    const tabs = [
      { type: 'all', label: '全部' },
      { type: 'star', label: '星标' },
      { type: 'heart', label: '爱心' },
    ];
    const listHtml = items.length
      ? items.map((item) => {
        const actions = item.markers.map((marker) => (
          `<button type="button" class="th-message-marker-panel-remove" data-action="remove-marker" data-index="${item.index}" data-marker-type="${marker.type}" style="--th-marker-active-color:${marker.activeColor}" title="取消${marker.symbol}" aria-label="取消${marker.symbol}">${marker.symbol}</button>`
        )).join('');
        return `
          <div class="th-message-marker-panel-item">
            <button type="button" class="th-message-marker-panel-jump" data-action="jump-marker" data-index="${item.index}">
              <span class="th-message-marker-panel-floor">第 ${item.floor} 楼</span>
              ${item.title ? `<span class="th-message-marker-panel-title-text"> · ${escapeHtml(item.title)}</span>` : ''}
            </button>
            <div class="th-message-marker-panel-actions">${actions}</div>
          </div>`;
      }).join('')
      : '<div class="th-message-marker-panel-empty">当前筛选没有标记楼层</div>';

    return `
      <div class="th-message-marker-panel-head">
        <div class="th-message-marker-panel-title">星心列表</div>
        <button type="button" class="th-message-marker-panel-close" data-action="close-marker-panel" aria-label="关闭">×</button>
      </div>
      <div class="th-message-marker-panel-tabs">
        ${tabs.map((tab) => `<button type="button" class="th-message-marker-panel-tab" data-action="filter-marker" data-filter="${tab.type}" aria-pressed="${tab.type === filter ? 'true' : 'false'}">${tab.label}</button>`).join('')}
      </div>
      <div class="th-message-marker-panel-list">${listHtml}</div>`;
  }

  function renderMarkerPanel(filterType) {
    const doc = getHostDocument();
    if (!doc.body) return null;
    let panel = doc.getElementById(PANEL_ID);
    if (!panel) {
      panel = doc.createElement('div');
      panel.id = PANEL_ID;
      panel.addEventListener('click', (event) => {
        const actionNode = event.target && event.target.closest ? event.target.closest('[data-action]') : null;
        if (!actionNode || !panel.contains(actionNode)) return;
        const action = actionNode.dataset.action;
        if (action === 'close-marker-panel') {
          closeMarkerPanel();
        } else if (action === 'filter-marker') {
          panel.dataset.filter = actionNode.dataset.filter || 'all';
          panel.innerHTML = buildPanelHtml(panel.dataset.filter);
        } else if (action === 'jump-marker') {
          jumpToMessage(actionNode.dataset.index);
        } else if (action === 'remove-marker') {
          removeRecordMarker(actionNode.dataset.index, actionNode.dataset.markerType);
          panel.innerHTML = buildPanelHtml(panel.dataset.filter || 'all');
        }
      });
      doc.body.appendChild(panel);
    }
    panel.dataset.filter = filterType || panel.dataset.filter || 'all';
    panel.innerHTML = buildPanelHtml(panel.dataset.filter);
    return panel;
  }

  function toggleMarkerPanel() {
    scanMessages();
    renderMarkerPanel('all');
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
    const panel = doc.getElementById(PANEL_ID);
    if (panel) panel.remove();
    const floatingButton = doc.getElementById(FLOATING_BUTTON_ID);
    if (floatingButton) floatingButton.remove();
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
      openList: () => renderMarkerPanel('all'),
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
      toggleMarkerPanel();
    };
    try {
      if (typeof appendInexistentScriptButtons === 'function' && typeof getButtonEvent === 'function' && typeof eventOn === 'function') {
        appendInexistentScriptButtons([{ name: BUTTON_NAME, visible: true }]);
        eventOn(getButtonEvent(BUTTON_NAME), handler);
      } else if (typeof eventOnButton === 'function') {
        eventOnButton(BUTTON_NAME, handler);
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
    ensureFloatingPanelButton();
    setTimeout(registerTavernHelperButton, 1000);
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
