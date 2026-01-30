(() => {
  if (window.__trResumeHookInstalled) return;
  window.__trResumeHookInstalled = true;

  const SOURCE = 'tr-resume-api';

  const classify = (url) => {
    if (!url) return null;
    if (url.includes('/api/search/resume/v2/attach/resume/info')) return 'attach';
    if (url.includes('/api/search/resume/v2/chat/info')) return 'chat';
    if (url.includes('/api/search/resume/v2/talent/insight/info')) return 'insight';
    if (url.includes('/api/search/resume/v2')) return 'search';
    return null;
  };

  const normalizeUrl = (input) => {
    try {
      const raw = typeof input === 'string' ? input : (input && input.url) || '';
      return raw ? new URL(raw, window.location.href).href : '';
    } catch {
      return '';
    }
  };

  const post = (kind, url, payload) => {
    try {
      window.postMessage({ source: SOURCE, kind, url, payload }, '*');
    } catch {
      // ignore
    }
  };

  const capture = (url, payload) => {
    const kind = classify(url);
    if (!kind || !payload) return;
    post(kind, url, payload);
  };

  if (window.fetch) {
    const originalFetch = window.fetch;
    window.fetch = function(...args) {
      return originalFetch.apply(this, args).then((res) => {
        try {
          const url = normalizeUrl(args[0]);
          if (classify(url)) {
            res.clone().json().then((data) => capture(url, data)).catch(() => {});
          }
        } catch {
          // ignore
        }
        return res;
      });
    };
  }

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    this.__tr_url = url;
    return originalOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function(...args) {
    this.addEventListener('load', function() {
      try {
        const url = normalizeUrl(this.__tr_url);
        if (!classify(url)) return;
        let data = null;
        if (this.responseType === 'json' && this.response) {
          data = this.response;
        } else if (typeof this.responseText === 'string') {
          const text = this.responseText.trim();
          if (text && (text[0] === '{' || text[0] === '[')) {
            data = JSON.parse(text);
          }
        }
        if (!data) return;
        capture(url, data);
      } catch {
        // ignore
      }
    });
    return originalSend.apply(this, args);
  };
})();
