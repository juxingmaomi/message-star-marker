(async () => {
  const REPO = 'juxingmaomi/message-star-marker';
  const VERSION = 'v0.5.6';
  const URL = `https://cdn.jsdelivr.net/gh/${REPO}@${VERSION}/index.js`;

  const loaderState = {
    repo: REPO,
    loadedTag: VERSION,
    source: 'manual',
    url: URL,
    requestedAt: new Date().toISOString(),
  };
  window.__TH_MESSAGE_STAR_MARKER_LOADER__ = loaderState;

  function popup(type, message) {
    try {
      let toastr = window.toastr;
      try {
        if (!toastr && window.parent && window.parent !== window) {
          toastr = window.parent.toastr;
        }
      } catch (_) {}
      if (toastr && typeof toastr[type] === 'function') {
        toastr[type](message);
        return;
      }
      if (type === 'error') {
        alert(message);
        return;
      }
      console.log(`[message-star-marker] ${message}`);
    } catch (error) {
      console.warn('[message-star-marker] Popup failed.', error);
    }
  }

  try {
    await import(URL);
    loaderState.loadedAt = new Date().toISOString();
    popup('success', `楼层星心标记已加载 ${VERSION}`);
  } catch (error) {
    loaderState.error = String(error && error.message || error);
    console.error('[message-star-marker] Load failed.', error);
    popup('error', `楼层星心标记 ${VERSION} 加载失败。请确认 GitHub 仓库已经发布这个版本，或稍后再试。`);
  }
})();
