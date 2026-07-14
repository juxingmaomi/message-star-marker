// == TavernHelper Script ==
// name: 楼层书签阅读器（试验版）
// author: Codex
// version: reader-v0.1.7
// description: 为 AI 消息添加四种书签，并在独立浮层中安全阅读单条 AI 回复。
// ==
(function () {
  'use strict';

  const SCRIPT_NAME = '楼层书签阅读器';
  const SCRIPT_VERSION = 'reader-v0.1.7';
  const BUTTON_NAME = '楼层书签阅读器';
  const GLOBAL_INSTANCE_KEY = '__th_message_star_marker_instance_v1__';
  const STYLE_ID = 'th-message-marker-reader-style-v1';
  const BADGE_ID = 'th-message-marker-reader-loaded-badge';
  const PANEL_ID = 'th-message-marker-reader-list';
  const READER_ID = 'th-message-marker-reader';
  const FLOATING_BUTTON_ID = 'th-message-marker-reader-floating-button';
  const BUTTON_CLASS = 'th-message-marker-btn';
  const FOOTER_CLASS = 'th-message-marker-footer';
  const ACTIVE_CLASS = 'th-message-marker-active';
  const EXTRA_KEY = 'thMessageMarker';
  const MAX_READER_IFRAMES = 6;
  const READER_IFRAME_MESSAGE = 'th-message-marker-reader-iframe-height';

  const MARKERS = [
    { type: 'qa', symbol: '问答', textual: true, activeColor: '#2f91b4', onTitle: '取消问答标记', offTitle: '标记为问答' },
    { type: 'letter', symbol: '来信', textual: true, activeColor: '#4f9b68', onTitle: '取消来信标记', offTitle: '标记为来信' },
    { type: 'star', symbol: '★', textual: false, activeColor: '#f2a900', onTitle: '取消星标', offTitle: '星标未读' },
    { type: 'heart', symbol: '♥', textual: false, activeColor: '#df4f73', onTitle: '取消爱心', offTitle: '爱心标记' },
  ];

  const runtime = {
    observer: null,
    scanTimer: null,
    saveTimers: new Map(),
    buttonSubscription: null,
    readerIndex: null,
    floatingPosition: null,
    panelPosition: null,
    viewportHandler: null,
    iframeMessageHandler: null,
    readerFrames: new Map(),
    stopping: false,
  };

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
      // Continue without a context until the next scan.
    }
    return null;
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
    else console.info(`[${SCRIPT_NAME}] ${message}`);
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
    const textarea = getHostDocument().createElement('textarea');
    textarea.innerHTML = String(value || '');
    return textarea.value;
  }

  function getChat() {
    const context = getTavernContext();
    return context && Array.isArray(context.chat) ? context.chat : [];
  }

  function getChatContainer() {
    const doc = getHostDocument();
    return doc.getElementById('chat') || doc.querySelector('[data-testid="chat"]');
  }

  function getMessageNodes() {
    const root = getChatContainer();
    if (!root) return [];
    return Array.from(root.querySelectorAll('.mes')).filter((node) => node.isConnected);
  }

  function getMessageIndex(node) {
    if (!node) return null;
    const raw = String(node.getAttribute('mesid') || node.dataset && (node.dataset.mesid || node.dataset.messageId) || '').trim();
    const numeric = Number(raw);
    if (Number.isInteger(numeric) && numeric >= 0) return numeric;
    const index = getMessageNodes().indexOf(node);
    return index >= 0 ? index : null;
  }

  function getMessageRecord(node) {
    const index = getMessageIndex(node);
    return Number.isInteger(index) ? getChat()[index] || null : null;
  }

  function isAssistantRecord(record) {
    return Boolean(record && record.is_user !== true && record.is_system !== true);
  }

  function isAssistantMessage(node) {
    const record = getMessageRecord(node);
    if (record) return isAssistantRecord(record);
    if (!node || node.classList.contains('user_mes') || node.classList.contains('system_mes')) return false;
    return String(node.getAttribute('is_user') || '').toLowerCase() !== 'true';
  }

  function isMarkerValueActive(value) {
    if (value && typeof value === 'object') return value.marked !== false;
    return value === true;
  }

  function getRecordMarker(record, ensure) {
    if (!record) return {};
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

  function isRecordMarked(record, markerType) {
    return isMarkerValueActive(getRecordMarker(record, false)[markerType]);
  }

  async function saveChat() {
    const context = getTavernContext();
    if (!context || typeof context.saveChat !== 'function') {
      notify('warning', '当前无法连接聊天保存接口，书签可能不会持久保存。');
      return;
    }
    try {
      await Promise.resolve(context.saveChat());
    } catch (error) {
      console.warn(`[${SCRIPT_NAME}] 保存聊天失败`, error);
      notify('warning', '书签已经显示，但保存聊天失败。');
    }
  }

  function scheduleSave(index) {
    const key = String(index);
    const oldTimer = runtime.saveTimers.get(key);
    if (oldTimer) clearTimeout(oldTimer);
    const timer = setTimeout(() => {
      runtime.saveTimers.delete(key);
      saveChat();
    }, 180);
    runtime.saveTimers.set(key, timer);
  }

  function setRecordMarker(index, markerType, value) {
    const numericIndex = Number(index);
    const record = Number.isInteger(numericIndex) ? getChat()[numericIndex] : null;
    const marker = MARKERS.find((item) => item.type === markerType);
    if (!isAssistantRecord(record) || !marker) return false;

    const state = getRecordMarker(record, true);
    if (value) {
      state[markerType] = {
        marked: true,
        markedAt: new Date().toISOString(),
        version: SCRIPT_VERSION,
      };
    } else {
      delete state[markerType];
      if (!Object.keys(state).length) delete record.extra[EXTRA_KEY];
    }

    scheduleSave(numericIndex);
    scanMessages();
    refreshOpenPanel();
    if (runtime.readerIndex === numericIndex) renderReader(numericIndex);
    return true;
  }

  function getRecordText(record) {
    if (!record) return '';
    const swipeIndex = Number(record.swipe_id);
    if (Array.isArray(record.swipes) && Number.isInteger(swipeIndex) && typeof record.swipes[swipeIndex] === 'string') {
      return record.swipes[swipeIndex];
    }
    return String(record.mes || record.message || record.text || '');
  }

  function getDisplayText(record) {
    if (record && record.extra && typeof record.extra.display_text === 'string') return record.extra.display_text;
    return getRecordText(record);
  }

  function getSceneTitle(record) {
    const match = /<\s*Scene_Title\s*>([\s\S]*?)<\s*\/\s*Scene_Title\s*>/i.exec(getRecordText(record));
    if (!match) return '';
    return decodeHtmlEntities(match[1]).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, 80);
  }

  function formatReaderMessage(record, index) {
    const text = getDisplayText(record);
    const context = getTavernContext();
    if (context && typeof context.messageFormatting === 'function') {
      try {
        // The reader deliberately ignores regex depth so historical floors keep display-only formatting.
        return context.messageFormatting(text, record.name || '', false, false, -1, {}, false);
      } catch (error) {
        console.warn(`[${SCRIPT_NAME}] 消息格式化失败，改用纯文本显示`, error);
      }
    }
    return escapeHtml(text).replace(/\r?\n/g, '<br>');
  }

  function isFrontendCode(value) {
    const text = String(value || '').toLowerCase();
    return ['html>', '<head>', '<body'].some((tag) => text.includes(tag));
  }

  function buildReaderIframeDocument(source, token) {
    const tokenJson = JSON.stringify(token);
    const bridge = `<script>(function(){
      const token=${tokenJson};
      let lastHeight=0;
      let pendingFrame=0;
      const measureHeight=()=>{
        const body=document.body;
        if(!body)return 80;
        let marker=document.getElementById('th-reader-content-end');
        if(!marker){
          marker=document.createElement('div');
          marker.id='th-reader-content-end';
          marker.setAttribute('aria-hidden','true');
          marker.style.cssText='display:block;clear:both;width:0;height:0;margin:0;padding:0;border:0;';
          body.appendChild(marker);
        }
        const bodyTop=body.getBoundingClientRect().top;
        const markerBottom=marker.getBoundingClientRect().bottom;
        return Math.ceil(Math.max(markerBottom-bodyTop,80));
      };
      const sendHeight=()=>{
        pendingFrame=0;
        const height=measureHeight();
        if(Math.abs(height-lastHeight)<2)return;
        lastHeight=height;
        parent.postMessage({type:${JSON.stringify(READER_IFRAME_MESSAGE)},token,height},'*');
      };
      const scheduleHeight=()=>{
        if(pendingFrame)return;
        pendingFrame=requestAnimationFrame(sendHeight);
      };
      addEventListener('load',sendHeight);
      addEventListener('resize',scheduleHeight);
      document.addEventListener('toggle',()=>{
        scheduleHeight();
        [80,240,500].forEach(delay=>setTimeout(sendHeight,delay));
      },true);
      document.addEventListener('transitionend',scheduleHeight,true);
      if(typeof ResizeObserver==='function'){
        const observer=new ResizeObserver(scheduleHeight);
        if(document.body)observer.observe(document.body);
      }
      [0,80,240,800,1600].forEach(delay=>setTimeout(sendHeight,delay));
    })();</scr` + `ipt>`;
    const headExtras = `<meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style data-th-reader-frame>*,*::before,*::after{box-sizing:border-box}html,body{margin:0;padding:0;max-width:100%}img,video,canvas,svg{max-width:100%}</style>`;
    let html = String(source || '');
    const hasDocumentShell = /<!doctype\b|<html\b|<head\b|<body\b/i.test(html);
    if (!hasDocumentShell) {
      return `<!DOCTYPE html><html><head><meta charset="utf-8">${headExtras}</head><body>${html}${bridge}</body></html>`;
    }
    if (/<\/head\s*>/i.test(html)) html = html.replace(/<\/head\s*>/i, `${headExtras}</head>`);
    else html = `${headExtras}${html}`;
    if (/<\/body\s*>/i.test(html)) html = html.replace(/<\/body\s*>/i, `${bridge}</body>`);
    else html += bridge;
    return html;
  }

  function clearReaderFrames() {
    runtime.readerFrames.forEach((iframe) => {
      try {
        iframe.srcdoc = '';
      } catch (error) {
        // Removing the reader also tears down the isolated document.
      }
    });
    runtime.readerFrames.clear();
  }

  function renderReaderFrontendBlocks(content, index) {
    if (!content) return 0;
    let rendered = 0;
    const pres = Array.from(content.querySelectorAll('pre'));
    pres.forEach((pre, blockIndex) => {
      if (rendered >= MAX_READER_IFRAMES) return;
      const code = pre.querySelector('code');
      const source = code ? code.textContent : pre.textContent;
      if (!isFrontendCode(source)) return;

      const token = `${runtime.instanceId}-${index}-${blockIndex}-${Math.random().toString(36).slice(2, 8)}`;
      const wrapper = getHostDocument().createElement('div');
      wrapper.className = 'th-message-marker-reader-frame-wrap';
      const iframe = getHostDocument().createElement('iframe');
      iframe.className = 'th-message-marker-reader-frame';
      iframe.title = `第 ${index + 1} 楼美化内容 ${rendered + 1}`;
      iframe.loading = 'lazy';
      iframe.referrerPolicy = 'no-referrer';
      iframe.setAttribute('sandbox', 'allow-scripts allow-forms allow-modals');
      iframe.srcdoc = buildReaderIframeDocument(source, token);
      wrapper.appendChild(iframe);
      pre.replaceWith(wrapper);
      runtime.readerFrames.set(token, iframe);
      rendered += 1;
    });
    return rendered;
  }

  function bindReaderIframeMessages() {
    if (runtime.iframeMessageHandler) return;
    runtime.iframeMessageHandler = (event) => {
      const data = event && event.data;
      if (!data || data.type !== READER_IFRAME_MESSAGE || typeof data.token !== 'string') return;
      const iframe = runtime.readerFrames.get(data.token);
      if (!iframe || event.source !== iframe.contentWindow) return;
      const height = Math.min(Math.max(Number(data.height) || 80, 80), 3000);
      iframe.style.height = `${height}px`;
    };
    getHostWindow().addEventListener('message', runtime.iframeMessageHandler);
  }

  function unbindReaderIframeMessages() {
    if (!runtime.iframeMessageHandler) return;
    getHostWindow().removeEventListener('message', runtime.iframeMessageHandler);
    runtime.iframeMessageHandler = null;
  }

  function collectMarkedItems(filterType) {
    const filter = MARKERS.some((marker) => marker.type === filterType) ? filterType : 'all';
    return getChat().reduce((items, record, index) => {
      if (!isAssistantRecord(record)) return items;
      const activeMarkers = MARKERS.filter((marker) => isRecordMarked(record, marker.type));
      if (!activeMarkers.length) return items;
      if (filter !== 'all' && !activeMarkers.some((marker) => marker.type === filter)) return items;
      items.push({ index, floor: index + 1, title: getSceneTitle(record), markers: activeMarkers });
      return items;
    }, []);
  }

  function syncButton(button, record, marker) {
    const active = isRecordMarked(record, marker.type);
    button.classList.toggle(ACTIVE_CLASS, active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
    button.title = active ? marker.onTitle : marker.offTitle;
    button.setAttribute('aria-label', button.title);
    button.style.setProperty('--th-marker-active-color', marker.activeColor);
  }

  function syncMarkerButtons(node, marker) {
    const record = getMessageRecord(node);
    node.querySelectorAll(`.${BUTTON_CLASS}[data-th-message-marker="${marker.type}"]`)
      .forEach((button) => syncButton(button, record, marker));
  }

  function createMessageButton(node, marker, placement) {
    const button = getHostDocument().createElement('button');
    button.type = 'button';
    button.className = `${BUTTON_CLASS} ${BUTTON_CLASS}-${marker.type}`;
    if (marker.textual) button.classList.add(`${BUTTON_CLASS}-text`);
    button.dataset.thMessageMarker = marker.type;
    button.dataset.thMarkerPlacement = placement;
    button.textContent = marker.symbol;
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const index = getMessageIndex(node);
      const record = Number.isInteger(index) ? getChat()[index] : null;
      if (!record) return;
      setRecordMarker(index, marker.type, !isRecordMarked(record, marker.type));
      syncMarkerButtons(node, marker);
    });
    return button;
  }

  function getButtonContainer(node) {
    return node.querySelector('.mes_buttons')
      || node.querySelector('.mes_buttons_container')
      || node.querySelector('.mes_controls')
      || node.querySelector('.mes_header')
      || node.querySelector('.ch_name')
      || node;
  }

  function getBeforeNode(container) {
    const selectors = [
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
    for (const selector of selectors) {
      const found = container.querySelector(selector);
      if (found) return found.closest('button, .menu_button, .mes_button, span, div') || found;
    }
    return null;
  }

  function attachButtons(node) {
    if (!isAssistantMessage(node)) return;
    const record = getMessageRecord(node);
    const container = getButtonContainer(node);
    if (!container) return;

    const beforeNode = getBeforeNode(container);
    MARKERS.forEach((marker) => {
      let button = container.querySelector(`.${BUTTON_CLASS}[data-th-message-marker="${marker.type}"][data-th-marker-placement="top"]`);
      if (!button) {
        button = createMessageButton(node, marker, 'top');
        if (beforeNode && beforeNode.parentNode === container) container.insertBefore(button, beforeNode);
        else container.appendChild(button);
      }
      syncButton(button, record, marker);
    });

    const footerHost = node.querySelector('.mes_block') || node;
    let footer = Array.from(footerHost.children || []).find((child) => child.classList && child.classList.contains(FOOTER_CLASS));
    if (!footer) {
      footer = getHostDocument().createElement('div');
      footer.className = FOOTER_CLASS;
      footer.setAttribute('aria-label', '楼层书签');
      footerHost.appendChild(footer);
    }
    MARKERS.forEach((marker) => {
      let button = footer.querySelector(`.${BUTTON_CLASS}[data-th-message-marker="${marker.type}"]`);
      if (!button) {
        button = createMessageButton(node, marker, 'bottom');
        footer.appendChild(button);
      }
      syncButton(button, record, marker);
    });
  }

  function scanMessages() {
    if (runtime.stopping) return;
    getMessageNodes().forEach(attachButtons);
    ensureFloatingButton();
  }

  function scheduleScan(delay) {
    if (runtime.scanTimer) clearTimeout(runtime.scanTimer);
    runtime.scanTimer = setTimeout(() => {
      runtime.scanTimer = null;
      scanMessages();
    }, delay || 50);
  }

  function markerButtonsHtml(index, placement) {
    const record = getChat()[index];
    return MARKERS.map((marker) => {
      const active = isRecordMarked(record, marker.type);
      const classes = ['th-message-marker-reader-marker'];
      if (marker.textual) classes.push('th-message-marker-reader-marker-text');
      if (active) classes.push(ACTIVE_CLASS);
      const title = active ? marker.onTitle : marker.offTitle;
      return `<button type="button" class="${classes.join(' ')}" data-action="toggle-reader-marker" data-index="${index}" data-marker-type="${marker.type}" data-placement="${placement}" aria-pressed="${active ? 'true' : 'false'}" aria-label="${escapeHtml(title)}" title="${escapeHtml(title)}" style="--th-marker-active-color:${marker.activeColor}">${marker.symbol}</button>`;
    }).join('');
  }

  function findAdjacentAssistantIndex(index, direction) {
    const chat = getChat();
    const step = direction < 0 ? -1 : 1;
    for (let cursor = index + step; cursor >= 0 && cursor < chat.length; cursor += step) {
      if (isAssistantRecord(chat[cursor])) return cursor;
    }
    return null;
  }

  function buildReaderHtml(index) {
    const record = getChat()[index];
    if (!isAssistantRecord(record)) return '';
    const previousIndex = findAdjacentAssistantIndex(index, -1);
    const nextIndex = findAdjacentAssistantIndex(index, 1);
    const sceneTitle = getSceneTitle(record);
    const displayTitle = sceneTitle || record.name || `第 ${index + 1} 楼`;
    return `
      <div class="th-message-marker-reader-dialog" role="dialog" aria-modal="true" aria-label="楼层书签阅读器">
        <header class="th-message-marker-reader-head">
          <div class="th-message-marker-reader-heading">
            <span class="th-message-marker-reader-floor">第 ${index + 1} 楼</span>
            <span class="th-message-marker-reader-title">${escapeHtml(displayTitle)}</span>
          </div>
          <button type="button" class="th-message-marker-reader-close" data-action="close-reader" aria-label="关闭" title="关闭">×</button>
        </header>
        <div class="th-message-marker-reader-marker-row" aria-label="顶部楼层书签">${markerButtonsHtml(index, 'top')}</div>
        <div class="th-message-marker-reader-content mes_text" data-reader-message-id="${index}">${formatReaderMessage(record, index)}</div>
        <div class="th-message-marker-reader-marker-row th-message-marker-reader-marker-row-bottom" aria-label="底部楼层书签">
          <button type="button" class="th-message-marker-reader-list-button" data-action="open-reader-list">书签列表</button>
          <div class="th-message-marker-reader-marker-group">${markerButtonsHtml(index, 'bottom')}</div>
        </div>
        <footer class="th-message-marker-reader-nav">
          <button type="button" class="th-message-marker-reader-nav-button" data-action="reader-previous" ${previousIndex == null ? 'disabled' : ''}>‹ 上一层</button>
          <span class="th-message-marker-reader-position">${index + 1} / ${getChat().length}</span>
          <button type="button" class="th-message-marker-reader-nav-button" data-action="reader-next" ${nextIndex == null ? 'disabled' : ''}>下一层 ›</button>
        </footer>
      </div>`;
  }

  function getOverlayMountTarget() {
    const doc = getHostDocument();
    const host = getHostWindow();
    const isMobile = host.matchMedia && host.matchMedia('(max-width: 700px)').matches;
    return isMobile ? doc.getElementById('movingDivs') || doc.body : doc.body;
  }

  function getViewportMetrics() {
    const host = getHostWindow();
    const viewport = host.visualViewport;
    return {
      width: Math.max(1, viewport && viewport.width || host.innerWidth || 1),
      height: Math.max(1, viewport && viewport.height || host.innerHeight || 1),
      top: Math.max(0, viewport && viewport.offsetTop || 0),
    };
  }

  function clampFloatingButton(button) {
    if (!button || !runtime.floatingPosition) return;
    const viewport = getViewportMetrics();
    const width = button.offsetWidth || 50;
    const height = button.offsetHeight || 50;
    runtime.floatingPosition.left = Math.min(Math.max(8, runtime.floatingPosition.left), Math.max(8, viewport.width - width - 8));
    runtime.floatingPosition.top = Math.min(Math.max(viewport.top + 8, runtime.floatingPosition.top), Math.max(viewport.top + 8, viewport.top + viewport.height - height - 8));
    button.style.left = `${runtime.floatingPosition.left}px`;
    button.style.top = `${runtime.floatingPosition.top}px`;
    button.style.right = 'auto';
    button.style.bottom = 'auto';
  }

  function syncViewportMetrics() {
    const doc = getHostDocument();
    const viewport = getViewportMetrics();
    doc.documentElement.style.setProperty('--th-reader-visual-height', `${Math.round(viewport.height)}px`);
    doc.documentElement.style.setProperty('--th-reader-visual-top', `${Math.round(viewport.top)}px`);
    clampFloatingButton(doc.getElementById(FLOATING_BUTTON_ID));
    applyMarkerPanelPosition(doc.getElementById(PANEL_ID));
  }

  function bindViewportSync() {
    if (runtime.viewportHandler) return;
    const host = getHostWindow();
    runtime.viewportHandler = () => syncViewportMetrics();
    host.addEventListener('resize', runtime.viewportHandler, { passive: true });
    if (host.visualViewport) {
      host.visualViewport.addEventListener('resize', runtime.viewportHandler, { passive: true });
      host.visualViewport.addEventListener('scroll', runtime.viewportHandler, { passive: true });
    }
    syncViewportMetrics();
  }

  function unbindViewportSync() {
    if (!runtime.viewportHandler) return;
    const host = getHostWindow();
    host.removeEventListener('resize', runtime.viewportHandler);
    if (host.visualViewport) {
      host.visualViewport.removeEventListener('resize', runtime.viewportHandler);
      host.visualViewport.removeEventListener('scroll', runtime.viewportHandler);
    }
    runtime.viewportHandler = null;
  }

  function updateFloatingButtonVisibility() {
    const doc = getHostDocument();
    const button = doc.getElementById(FLOATING_BUTTON_ID);
    if (!button) return;
    const overlayOpen = Boolean(doc.getElementById(PANEL_ID) || doc.getElementById(READER_ID));
    button.style.display = overlayOpen ? 'none' : 'inline-flex';
  }

  function bindFloatingButton(button) {
    if (!button || button.dataset.thReaderDragBound === 'true') return;
    button.dataset.thReaderDragBound = 'true';
    let pointerId = null;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;
    let moved = false;

    button.addEventListener('pointerdown', (event) => {
      if (event.button != null && event.button !== 0) return;
      const rect = button.getBoundingClientRect();
      pointerId = event.pointerId;
      startX = event.clientX;
      startY = event.clientY;
      startLeft = rect.left;
      startTop = rect.top;
      moved = false;
      button.setPointerCapture && button.setPointerCapture(pointerId);
      event.preventDefault();
    });

    button.addEventListener('pointermove', (event) => {
      if (pointerId == null || event.pointerId !== pointerId) return;
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      if (!moved && Math.hypot(dx, dy) < 5) return;
      moved = true;
      runtime.floatingPosition = { left: startLeft + dx, top: startTop + dy };
      clampFloatingButton(button);
      event.preventDefault();
    });

    const finish = (event) => {
      if (pointerId == null || event.pointerId !== pointerId) return;
      button.releasePointerCapture && button.releasePointerCapture(pointerId);
      pointerId = null;
      if (!moved) toggleMarkerPanel();
      event.preventDefault();
    };
    button.addEventListener('pointerup', finish);
    button.addEventListener('pointercancel', () => { pointerId = null; });
    button.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      toggleMarkerPanel();
    });
  }

  function ensureFloatingButton() {
    const doc = getHostDocument();
    if (!doc.body) return null;
    let button = doc.getElementById(FLOATING_BUTTON_ID);
    if (!button) {
      button = doc.createElement('button');
      button.id = FLOATING_BUTTON_ID;
      button.type = 'button';
      button.textContent = '🐵';
      button.title = '打开楼层书签列表';
      button.setAttribute('aria-label', '打开楼层书签列表');
      doc.body.appendChild(button);
      bindFloatingButton(button);
    }
    clampFloatingButton(button);
    updateFloatingButtonVisibility();
    return button;
  }

  function isDesktopPanelDragEnabled() {
    const host = getHostWindow();
    return !host.matchMedia || host.matchMedia('(min-width: 701px)').matches;
  }

  function clampPanelPosition(panel, left, top) {
    const viewport = getViewportMetrics();
    const width = panel && panel.offsetWidth || 360;
    const height = panel && panel.offsetHeight || 320;
    return {
      left: Math.min(Math.max(8, left), Math.max(8, viewport.width - width - 8)),
      top: Math.min(Math.max(viewport.top + 8, top), Math.max(viewport.top + 8, viewport.top + viewport.height - height - 8)),
    };
  }

  function applyMarkerPanelPosition(panel) {
    if (!panel) return;
    if (!isDesktopPanelDragEnabled()) {
      panel.style.removeProperty('left');
      panel.style.removeProperty('top');
      panel.style.removeProperty('right');
      panel.style.removeProperty('bottom');
      return;
    }
    if (!runtime.panelPosition) return;
    runtime.panelPosition = clampPanelPosition(panel, runtime.panelPosition.left, runtime.panelPosition.top);
    panel.style.left = `${runtime.panelPosition.left}px`;
    panel.style.top = `${runtime.panelPosition.top}px`;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
  }

  function bindMarkerPanelDrag(panel) {
    if (!panel || panel.dataset.thReaderPanelDragBound === 'true') return;
    panel.dataset.thReaderPanelDragBound = 'true';
    let pointerId = null;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;
    let pendingPosition = null;
    let frame = null;

    const paint = () => {
      frame = null;
      if (!pendingPosition || !panel.isConnected) return;
      panel.style.left = `${pendingPosition.left}px`;
      panel.style.top = `${pendingPosition.top}px`;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
    };

    panel.addEventListener('pointerdown', (event) => {
      if (!isDesktopPanelDragEnabled()) return;
      const head = event.target && event.target.closest ? event.target.closest('.th-message-marker-panel-head') : null;
      if (!head || event.target.closest('button')) return;
      const rect = panel.getBoundingClientRect();
      pointerId = event.pointerId;
      startX = event.clientX;
      startY = event.clientY;
      startLeft = rect.left;
      startTop = rect.top;
      pendingPosition = { left: rect.left, top: rect.top };
      panel.classList.add('th-message-marker-panel-dragging');
      panel.setPointerCapture && panel.setPointerCapture(pointerId);
      event.preventDefault();
    });

    panel.addEventListener('pointermove', (event) => {
      if (pointerId == null || event.pointerId !== pointerId || !isDesktopPanelDragEnabled()) return;
      pendingPosition = clampPanelPosition(panel, startLeft + event.clientX - startX, startTop + event.clientY - startY);
      if (frame == null) frame = getHostWindow().requestAnimationFrame(paint);
      event.preventDefault();
    });

    const finish = (event) => {
      if (pointerId == null || event.pointerId !== pointerId) return;
      if (frame != null) {
        getHostWindow().cancelAnimationFrame(frame);
        frame = null;
      }
      paint();
      if (pendingPosition) runtime.panelPosition = pendingPosition;
      panel.releasePointerCapture && panel.releasePointerCapture(pointerId);
      pointerId = null;
      panel.classList.remove('th-message-marker-panel-dragging');
      event.preventDefault();
    };
    panel.addEventListener('pointerup', finish);
    panel.addEventListener('pointercancel', finish);
  }

  function closeReader() {
    clearReaderFrames();
    const reader = getHostDocument().getElementById(READER_ID);
    if (reader) reader.remove();
    runtime.readerIndex = null;
    updateFloatingButtonVisibility();
  }

  function renderReader(index) {
    const numericIndex = Number(index);
    const record = Number.isInteger(numericIndex) ? getChat()[numericIndex] : null;
    if (!isAssistantRecord(record)) {
      closeReader();
      notify('warning', '没有找到这个 AI 楼层。');
      return null;
    }

    const doc = getHostDocument();
    let reader = doc.getElementById(READER_ID);
    if (!reader) {
      reader = doc.createElement('div');
      reader.id = READER_ID;
      reader.addEventListener('click', (event) => {
        const actionNode = event.target && event.target.closest ? event.target.closest('[data-action]') : null;
        if (!actionNode || !reader.contains(actionNode)) return;
        const action = actionNode.dataset.action;
        if (action === 'close-reader') {
          closeReader();
        } else if (action === 'reader-previous' || action === 'reader-next') {
          const direction = action === 'reader-previous' ? -1 : 1;
          const adjacentIndex = findAdjacentAssistantIndex(runtime.readerIndex, direction);
          if (adjacentIndex != null) renderReader(adjacentIndex);
        } else if (action === 'open-reader-list') {
          const panel = getHostDocument().getElementById(PANEL_ID);
          if (panel) closeMarkerPanel();
          else renderMarkerPanel('all');
        } else if (action === 'toggle-reader-marker') {
          const markerType = actionNode.dataset.markerType;
          const current = getChat()[runtime.readerIndex];
          setRecordMarker(runtime.readerIndex, markerType, !isRecordMarked(current, markerType));
        }
      });
      getOverlayMountTarget().appendChild(reader);
    }

    runtime.readerIndex = numericIndex;
    clearReaderFrames();
    reader.innerHTML = buildReaderHtml(numericIndex);
    const content = reader.querySelector('.th-message-marker-reader-content');
    if (content) {
      renderReaderFrontendBlocks(content, numericIndex);
      content.scrollTop = 0;
    }
    updateFloatingButtonVisibility();
    return reader;
  }

  function openReader(index) {
    closeMarkerPanel();
    return renderReader(index);
  }

  function closeMarkerPanel() {
    const panel = getHostDocument().getElementById(PANEL_ID);
    if (panel) panel.remove();
    updateFloatingButtonVisibility();
  }

  function buildPanelHtml(filterType) {
    const filter = MARKERS.some((marker) => marker.type === filterType) ? filterType : 'all';
    const tabs = [
      { type: 'all', label: '全部' },
      { type: 'qa', label: '问答' },
      { type: 'letter', label: '来信' },
      { type: 'star', label: '星标' },
      { type: 'heart', label: '爱心' },
    ];
    const items = collectMarkedItems(filter);
    const listHtml = items.length ? items.map((item) => {
      const actions = item.markers.map((marker) => (
        `<button type="button" class="th-message-marker-panel-remove" data-action="remove-marker" data-index="${item.index}" data-marker-type="${marker.type}" style="--th-marker-active-color:${marker.activeColor}" title="取消${escapeHtml(marker.symbol)}" aria-label="取消${escapeHtml(marker.symbol)}">${marker.symbol}</button>`
      )).join('');
      return `
        <div class="th-message-marker-panel-item">
          <button type="button" class="th-message-marker-panel-open" data-action="open-reader" data-index="${item.index}">
            <span>第 ${item.floor} 楼</span>
            ${item.title ? `<span class="th-message-marker-panel-title-text"> · ${escapeHtml(item.title)}</span>` : ''}
          </button>
          <div class="th-message-marker-panel-actions">${actions}</div>
        </div>`;
    }).join('') : '<div class="th-message-marker-panel-empty">当前筛选没有标记楼层</div>';

    return `
      <div class="th-message-marker-panel-head">
        <div class="th-message-marker-panel-title">楼层书签阅读器</div>
        <button type="button" class="th-message-marker-panel-close" data-action="close-marker-panel" aria-label="关闭" title="关闭">×</button>
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
          applyMarkerPanelPosition(panel);
        } else if (action === 'open-reader') {
          openReader(actionNode.dataset.index);
        } else if (action === 'remove-marker') {
          setRecordMarker(actionNode.dataset.index, actionNode.dataset.markerType, false);
        }
      });
      bindMarkerPanelDrag(panel);
      getOverlayMountTarget().appendChild(panel);
    }
    panel.dataset.filter = filterType || panel.dataset.filter || 'all';
    panel.innerHTML = buildPanelHtml(panel.dataset.filter);
    applyMarkerPanelPosition(panel);
    updateFloatingButtonVisibility();
    return panel;
  }

  function refreshOpenPanel() {
    const panel = getHostDocument().getElementById(PANEL_ID);
    if (panel) {
      panel.innerHTML = buildPanelHtml(panel.dataset.filter || 'all');
      applyMarkerPanelPosition(panel);
    }
  }

  function toggleMarkerPanel() {
    const panel = getHostDocument().getElementById(PANEL_ID);
    if (panel) {
      closeMarkerPanel();
      return;
    }
    scanMessages();
    renderMarkerPanel('all');
  }

  function injectStyle() {
    const doc = getHostDocument();
    if (!doc.head || doc.getElementById(STYLE_ID)) return;
    const style = doc.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .${BUTTON_CLASS},
      .th-message-marker-reader-marker {
        --th-marker-active-color: #f2a900;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 30px;
        min-width: 30px;
        height: 30px;
        padding: 0;
        border: 0;
        border-radius: 6px;
        background: transparent;
        color: #8b9290;
        cursor: pointer;
        font-family: Arial, "Microsoft YaHei", sans-serif;
        font-size: 21px;
        font-weight: 800;
        line-height: 1;
        letter-spacing: 0;
        opacity: 0.48;
        vertical-align: middle;
      }
      .${BUTTON_CLASS}-text,
      .th-message-marker-reader-marker-text {
        width: auto;
        min-width: 42px;
        padding: 0 6px;
        font-size: 13px;
        font-weight: 700;
      }
      .${BUTTON_CLASS}:hover,
      .${BUTTON_CLASS}:focus-visible,
      .th-message-marker-reader-marker:hover,
      .th-message-marker-reader-marker:focus-visible {
        background: rgba(245, 183, 66, 0.14);
        opacity: 0.95;
        outline: none;
      }
      .${BUTTON_CLASS}.${ACTIVE_CLASS},
      .th-message-marker-reader-marker.${ACTIVE_CLASS} {
        color: var(--th-marker-active-color);
        opacity: 1;
        text-shadow: none;
      }
      .${FOOTER_CLASS} {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 3px;
        width: 100%;
        min-height: 34px;
        margin-top: 8px;
        padding: 3px 8px 3px 0;
        box-sizing: border-box;
      }
      #${PANEL_ID},
      #${READER_ID},
      #${FLOATING_BUTTON_ID} {
        box-sizing: border-box;
        color: var(--SmartThemeBodyColor, #edf6ef);
        font-family: Arial, "Microsoft YaHei", sans-serif;
        letter-spacing: 0;
      }
      #${PANEL_ID} * ,
      #${READER_ID} * {
        box-sizing: border-box;
      }
      #${FLOATING_BUTTON_ID} {
        position: fixed;
        right: 14px;
        bottom: calc(env(safe-area-inset-bottom, 0px) + 154px);
        z-index: 2147483645;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 50px;
        height: 50px;
        padding: 0;
        border: 1px solid #d4a72c;
        border-radius: 14px;
        background: #f2c84b;
        color: inherit;
        box-shadow: none;
        cursor: grab;
        touch-action: none;
        user-select: none;
        -webkit-user-select: none;
        -webkit-tap-highlight-color: transparent;
        font-size: 27px;
        line-height: 1;
      }
      #${FLOATING_BUTTON_ID}:active {
        cursor: grabbing;
      }
      #${FLOATING_BUTTON_ID}:hover,
      #${FLOATING_BUTTON_ID}:focus-visible {
        background: #f6d768;
        outline: none;
      }
      #${PANEL_ID} {
        position: fixed;
        right: 14px;
        bottom: calc(env(safe-area-inset-bottom, 0px) + 72px);
        z-index: 2147483647;
        width: min(360px, calc(100vw - 24px));
        max-height: min(540px, calc(100dvh - 96px));
        display: flex;
        flex-direction: column;
        overflow: hidden;
        border: 1px solid #111;
        border-radius: 8px;
        background: var(--SmartThemeBlurTintColor, rgba(22, 30, 27, 0.97));
        box-shadow: none;
        backdrop-filter: blur(var(--SmartThemeBlurStrength, 8px));
      }
      .th-message-marker-panel-head,
      .th-message-marker-reader-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        min-height: 46px;
        padding: 8px 12px;
        border-bottom: 1px solid var(--SmartThemeBorderColor, rgba(120, 150, 140, 0.28));
      }
      @media (min-width: 701px) {
        .th-message-marker-panel-head {
          cursor: grab;
          touch-action: none;
          user-select: none;
          -webkit-user-select: none;
        }
        #${PANEL_ID}.th-message-marker-panel-dragging .th-message-marker-panel-head {
          cursor: grabbing;
        }
        .th-message-marker-panel-head button {
          cursor: pointer;
        }
      }
      .th-message-marker-panel-title {
        font-size: 14px;
        font-weight: 800;
      }
      .th-message-marker-panel-close,
      .th-message-marker-reader-close {
        flex: 0 0 30px;
        width: 30px;
        height: 30px;
        padding: 0;
        border: 0;
        border-radius: 6px;
        background: rgba(255, 255, 255, 0.08);
        color: inherit;
        cursor: pointer;
        font-size: 21px;
        line-height: 1;
      }
      .th-message-marker-panel-tabs {
        display: grid;
        grid-template-columns: repeat(5, minmax(0, 1fr));
        gap: 5px;
        padding: 10px 10px 6px;
      }
      .th-message-marker-panel-tab,
      .th-message-marker-reader-nav-button {
        min-width: 0;
        height: 32px;
        border: 1px solid var(--SmartThemeBorderColor, rgba(120, 150, 140, 0.36));
        border-radius: 6px;
        background: rgba(255, 255, 255, 0.06);
        color: inherit;
        cursor: pointer;
        font-size: 13px;
      }
      .th-message-marker-panel-tab[aria-pressed="true"] {
        border-color: rgba(242, 169, 0, 0.72);
        background: rgba(242, 169, 0, 0.15);
      }
      .th-message-marker-panel-list {
        display: grid;
        gap: 6px;
        min-height: 0;
        overflow: auto;
        padding: 7px 10px 10px;
      }
      .th-message-marker-panel-empty {
        padding: 18px 8px;
        color: color-mix(in srgb, currentColor 68%, transparent);
        text-align: center;
        font-size: 13px;
      }
      .th-message-marker-panel-item {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: center;
        gap: 6px;
        min-height: 40px;
        padding: 5px 7px;
        border: 1px solid var(--SmartThemeBorderColor, rgba(120, 150, 140, 0.24));
        border-radius: 7px;
        background: rgba(255, 255, 255, 0.045);
      }
      .th-message-marker-panel-open {
        min-width: 0;
        height: 32px;
        padding: 0;
        overflow: hidden;
        border: 0;
        background: transparent;
        color: inherit;
        cursor: pointer;
        text-align: left;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 14px;
        font-weight: 700;
      }
      .th-message-marker-panel-title-text {
        opacity: 0.72;
        font-weight: 600;
      }
      .th-message-marker-panel-actions {
        display: inline-flex;
        align-items: center;
        gap: 3px;
      }
      .th-message-marker-panel-remove {
        width: auto;
        min-width: 30px;
        height: 30px;
        padding: 0 4px;
        border: 0;
        border-radius: 6px;
        background: rgba(255, 255, 255, 0.07);
        color: var(--th-marker-active-color);
        cursor: pointer;
        font-size: 16px;
        font-weight: 800;
        line-height: 1;
      }
      .th-message-marker-panel-close:hover,
      .th-message-marker-reader-close:hover,
      .th-message-marker-panel-open:hover,
      .th-message-marker-panel-remove:hover,
      .th-message-marker-reader-nav-button:not(:disabled):hover {
        background: rgba(255, 255, 255, 0.12);
      }
      #${READER_ID} {
        position: fixed;
        inset: 0;
        z-index: 2147483646;
        display: grid;
        place-items: center;
        padding: 20px;
        pointer-events: none;
      }
      .th-message-marker-reader-dialog {
        width: min(50vw, 900px);
        min-width: 520px;
        max-height: 88dvh;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        border: 1px solid #111;
        border-radius: 8px;
        background: var(--SmartThemeBlurTintColor, rgba(22, 30, 27, 0.98));
        box-shadow: none;
        backdrop-filter: blur(var(--SmartThemeBlurStrength, 8px));
        pointer-events: auto;
      }
      .th-message-marker-reader-heading {
        min-width: 0;
        display: flex;
        align-items: baseline;
        gap: 9px;
      }
      .th-message-marker-reader-floor {
        flex: 0 0 auto;
        font-size: 13px;
        font-weight: 800;
        opacity: 0.78;
      }
      .th-message-marker-reader-title {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 15px;
        font-weight: 800;
      }
      .th-message-marker-reader-marker-row {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 4px;
        min-height: 42px;
        padding: 5px 12px;
        border-bottom: 1px solid var(--SmartThemeBorderColor, rgba(120, 150, 140, 0.22));
      }
      .th-message-marker-reader-marker-row-bottom {
        justify-content: space-between;
        border-top: 1px solid var(--SmartThemeBorderColor, rgba(120, 150, 140, 0.22));
        border-bottom: 0;
      }
      .th-message-marker-reader-marker-group {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 4px;
      }
      .th-message-marker-reader-list-button {
        flex: 0 0 auto;
        min-width: 82px;
        height: 30px;
        padding: 0 10px;
        border: 1px solid var(--SmartThemeBorderColor, rgba(120, 150, 140, 0.36));
        border-radius: 6px;
        background: rgba(255, 255, 255, 0.06);
        color: inherit;
        cursor: pointer;
        font-size: 13px;
        font-weight: 700;
        letter-spacing: 0;
      }
      .th-message-marker-reader-list-button:hover,
      .th-message-marker-reader-list-button:focus-visible {
        background: rgba(255, 255, 255, 0.12);
        outline: none;
      }
      .th-message-marker-reader-content {
        flex: 1 1 auto;
        min-height: 180px;
        overflow: auto;
        padding: 18px 20px;
        color: inherit;
        font-size: 0.95em;
        line-height: 1.75;
        overflow-wrap: anywhere;
        white-space: normal;
      }
      .th-message-marker-reader-content > :first-child {
        margin-top: 0;
      }
      .th-message-marker-reader-content > :last-child {
        margin-bottom: 0;
      }
      .th-message-marker-reader-content q {
        quotes: none;
      }
      .th-message-marker-reader-content q::before,
      .th-message-marker-reader-content q::after {
        content: none !important;
      }
      .th-message-marker-reader-frame-wrap {
        width: 100%;
        margin: 0;
        overflow: hidden;
      }
      .th-message-marker-reader-frame {
        display: block;
        width: 100%;
        height: 480px;
        border: 0;
        background: transparent;
      }
      .th-message-marker-reader-nav {
        display: grid;
        grid-template-columns: minmax(96px, 1fr) auto minmax(96px, 1fr);
        align-items: center;
        gap: 10px;
        padding: 9px 12px calc(9px + env(safe-area-inset-bottom, 0px));
        border-top: 1px solid var(--SmartThemeBorderColor, rgba(120, 150, 140, 0.28));
      }
      .th-message-marker-reader-nav-button:disabled {
        cursor: default;
        opacity: 0.34;
      }
      .th-message-marker-reader-position {
        min-width: 72px;
        text-align: center;
        font-size: 12px;
        opacity: 0.72;
        white-space: nowrap;
      }
      #${BADGE_ID} {
        position: fixed;
        right: 8px;
        bottom: 8px;
        z-index: 2147483647;
        padding: 3px 7px;
        border: 1px solid var(--SmartThemeBorderColor, rgba(120, 150, 140, 0.55));
        border-radius: 6px;
        background: rgba(20, 28, 24, 0.88);
        color: #e9fff3;
        font: 12px/1.4 Arial, "Microsoft YaHei", sans-serif;
        opacity: 0.76;
        pointer-events: none;
      }
      @media (max-width: 700px) {
        #${FLOATING_BUTTON_ID} {
          top: calc(var(--th-reader-visual-top, 0px) + 112px);
          right: 12px;
          bottom: auto;
        }
        #${PANEL_ID} {
          right: 8px;
          bottom: calc(env(safe-area-inset-bottom, 0px) + 126px);
          width: calc(100vw - 16px);
          max-height: min(540px, calc(var(--th-reader-visual-height, 100dvh) - 150px));
        }
        #${READER_ID} {
          inset: auto 0 auto 0;
          top: var(--th-reader-visual-top, 0px);
          height: var(--th-reader-visual-height, 100dvh);
          padding: 8px;
        }
        .th-message-marker-reader-dialog {
          width: calc(100vw - 16px);
          min-width: 0;
          max-height: calc(var(--th-reader-visual-height, 100dvh) - 16px);
        }
        .th-message-marker-reader-content {
          min-height: 0;
          padding: 14px 12px;
        }
        .th-message-marker-reader-nav {
          grid-template-columns: minmax(82px, 1fr) auto minmax(82px, 1fr);
          gap: 6px;
          padding-inline: 8px;
        }
      }
    `;
    doc.head.appendChild(style);
  }

  function showLoadedBadge() {
    const doc = getHostDocument();
    if (!doc.body || doc.getElementById(BADGE_ID)) return;
    const badge = doc.createElement('div');
    badge.id = BADGE_ID;
    badge.textContent = '阅读器✓';
    doc.body.appendChild(badge);
    setTimeout(() => badge.remove(), 5000);
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

  function removeOwnedDom() {
    const doc = getHostDocument();
    doc.querySelectorAll(`.${BUTTON_CLASS}`).forEach((node) => node.remove());
    doc.querySelectorAll(`.${FOOTER_CLASS}`).forEach((node) => node.remove());
    [STYLE_ID, BADGE_ID, PANEL_ID, READER_ID, FLOATING_BUTTON_ID].forEach((id) => {
      const node = doc.getElementById(id);
      if (node) node.remove();
    });
  }

  function clearTimers() {
    if (runtime.scanTimer) clearTimeout(runtime.scanTimer);
    runtime.scanTimer = null;
    const hadPendingSave = runtime.saveTimers.size > 0;
    runtime.saveTimers.forEach((timer) => clearTimeout(timer));
    runtime.saveTimers.clear();
    if (hadPendingSave) saveChat();
  }

  function stopInstance() {
    if (runtime.stopping) return;
    runtime.stopping = true;
    clearTimers();
    if (runtime.observer) runtime.observer.disconnect();
    runtime.observer = null;
    unbindReaderIframeMessages();
    clearReaderFrames();
    unbindViewportSync();
    if (runtime.buttonSubscription && typeof runtime.buttonSubscription.stop === 'function') {
      runtime.buttonSubscription.stop();
    }
    runtime.buttonSubscription = null;
    removeOwnedDom();
    const doc = getHostDocument();
    doc.documentElement.style.removeProperty('--th-reader-visual-height');
    doc.documentElement.style.removeProperty('--th-reader-visual-top');
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
      stop: stopInstance,
      refresh: scanMessages,
      openList: () => renderMarkerPanel('all'),
      openReader,
      getMarkedRecords: () => collectMarkedItems('all'),
    };
  }

  function registerTavernHelperButton() {
    try {
      if (typeof window.getButtonEvent !== 'function' || typeof window.eventOn !== 'function') return false;
      runtime.buttonSubscription = window.eventOn(window.getButtonEvent(BUTTON_NAME), toggleMarkerPanel);
      return true;
    } catch (error) {
      console.warn(`[${SCRIPT_NAME}] 注册酒馆助手按钮失败`, error);
      return false;
    }
  }

  function register() {
    const doc = getHostDocument();
    if (!doc.head || !doc.body) {
      setTimeout(register, 120);
      return;
    }

    runtime.instanceId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    runtime.stopping = false;
    claimGlobalInstance();

    injectStyle();
    bindViewportSync();
    bindReaderIframeMessages();
    ensureFloatingButton();
    showLoadedBadge();
    const buttonRegistered = registerTavernHelperButton();
    installObserver();
    scanMessages();
    [300, 900, 1800].forEach((delay) => setTimeout(scanMessages, delay));
    console.info(`[${SCRIPT_NAME}] ${SCRIPT_VERSION} 初始化完成，按钮事件：${buttonRegistered ? '已注册' : '未注册'}`);
    if (!buttonRegistered) notify('warning', '没有找到“楼层书签阅读器”脚本按钮，请确认入口 JSON 的按钮名称。');
  }

  window.addEventListener('pagehide', stopInstance, { once: true });
  const initialDocument = getHostDocument();
  if (initialDocument.readyState === 'loading') {
    initialDocument.addEventListener('DOMContentLoaded', register, { once: true });
  } else {
    register();
  }
})();
