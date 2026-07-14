(async () => {
  const REPO = 'juxingmaomi/message-star-marker';
  const VERSION = 'reader-v0.1.8';
  const URL = `https://cdn.jsdelivr.net/gh/${REPO}@${VERSION}/reader.js`;

  const loaderState = {
    repo: REPO,
    loadedTag: VERSION,
    source: 'manual',
    url: URL,
    requestedAt: new Date().toISOString(),
  };
  window.__TH_MESSAGE_STAR_MARKER_READER_LOADER__ = loaderState;

  function popup(type, message) {
    try {
      let toastr = window.toastr;
      try {
        if (!toastr && window.parent && window.parent !== window) toastr = window.parent.toastr;
      } catch (_) {}
      if (toastr && typeof toastr[type] === 'function') {
        toastr[type](message);
        return;
      }
      if (type === 'error') {
        alert(message);
        return;
      }
      console.info(`[message-star-marker-reader] ${message}`);
    } catch (error) {
      console.warn('[message-star-marker-reader] Popup failed.', error);
    }
  }

  try {
    await import(URL);
    loaderState.loadedAt = new Date().toISOString();
    popup('success', `楼层书签阅读器已加载 ${VERSION}`);
  } catch (error) {
    loaderState.error = String(error && error.message || error);
    console.error('[message-star-marker-reader] Load failed.', error);
    popup('error', `楼层书签阅读器 ${VERSION} 加载失败。请稍后重试，或暂时切回原来的楼层书签跳转。`);
  }
})();
