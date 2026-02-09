(() => {
  /** @type {Window & { __trResumeHookInstalled?: boolean }} */
  const trWindow = window;
  if (trWindow.__trResumeHookInstalled) return;
  trWindow.__trResumeHookInstalled = true;

  const SOURCE = 'tr-resume-api';
  const EXTERNAL_ACCESS_KEY = '__TR_RESUME_DATA__';

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

  const readAttr = (name) => document.documentElement.getAttribute(name) || '';
  const getPaginationInfo = () => {
    const pagination = document.querySelector('.el-pagination');
    if (!pagination) {
      return {
        currentPage: 1,
        totalPages: 1,
        hasNextPage: false,
        totalItems: 0
      };
    }

    const activePage = Number(
      pagination.querySelector('.el-pager li.active')?.textContent?.trim() || '1'
    ) || 1;
    const pageNumbers = Array.from(pagination.querySelectorAll('.el-pager li'))
      .map((node) => Number(node.textContent?.trim() || '0'))
      .filter((value) => Number.isFinite(value) && value > 0);
    const totalPages = pageNumbers.length > 0 ? Math.max(...pageNumbers) : activePage;
    const nextPageButton = pagination.querySelector('.btn-next');
    const hasNextPage = !!nextPageButton && !nextPageButton.classList.contains('disabled');

    return {
      currentPage: activePage,
      totalPages,
      hasNextPage,
      totalItems: 0
    };
  };

  if (!trWindow[EXTERNAL_ACCESS_KEY]) {
    trWindow[EXTERNAL_ACCESS_KEY] = {
      status: () => ({
        extensionLoaded: readAttr('data-tr-resume-hook') === 'true',
        extensionVersion: 'page-bridge',
        apiSnapshotCount: Number(readAttr('data-tr-api-rows') || '0') || 0,
        domReady: document.querySelector('.el-checkbox-group.resume-search-item-list-content-block') !== null,
        loggedIn: !document.querySelector('.login-btn, [href*="login"]'),
        cardCount: document.querySelectorAll('.list-content__li_part').length,
        autoSearch: readAttr('data-tr-auto-search'),
        autoLocation: readAttr('data-tr-auto-location'),
        autoExport: readAttr('data-tr-auto-export'),
        pagination: getPaginationInfo(),
        timestamp: new Date().toISOString()
      })
    };
  }

  if (trWindow.fetch) {
    const originalFetch = trWindow.fetch;
    trWindow.fetch = function(...args) {
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
    /** @type {XMLHttpRequest & { __tr_url?: string }} */ (this).__tr_url = url;
    return originalOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function(...args) {
    this.addEventListener('load', function() {
      try {
        const url = normalizeUrl(/** @type {XMLHttpRequest & { __tr_url?: string }} */ (this).__tr_url);
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
