(() => {
  /** @type {Window & { __trResumeHookInstalled?: boolean }} */
  const trWindow = window;
  if (trWindow.__trResumeHookInstalled) return;
  trWindow.__trResumeHookInstalled = true;
  try {
    document.documentElement?.setAttribute("data-tr-page-hook", "true");
  } catch {
    // ignore
  }

  const SOURCE = "tr-resume-api";
  const EXTERNAL_ACCESS_KEY = "__TR_RESUME_DATA__";
  const PAGE_BRIDGE_REQUEST_EVENT = "trResumeBridgeRequest";
  const PAGE_BRIDGE_RESPONSE_EVENT = "trResumeBridgeResponse";
  const PAGE_BRIDGE_REQUEST_ATTR = "data-tr-resume-bridge-request";
  const PAGE_BRIDGE_RESPONSE_ATTR = "data-tr-resume-bridge-response";

  let pageBridgeRequestCount = 0;

  const getGraphqlOperations = (requestBody) => {
    if (Array.isArray(requestBody)) {
      return requestBody.filter((entry) => entry && typeof entry === "object");
    }
    if (requestBody && typeof requestBody === "object") {
      return [requestBody];
    }
    return [];
  };

  const findGraphqlOperation = (requestBody, matcher) =>
    getGraphqlOperations(requestBody).find((entry) => {
      if (!entry || typeof entry !== "object") return false;
      if (typeof matcher === "string") {
        return entry.operationName === matcher;
      }
      return matcher(entry);
    }) || null;

  const isSeekRecommendedCandidatesOperation = (entry) => {
    const operationName =
      typeof entry?.operationName === "string" ? entry.operationName : "";
    if (operationName === "GetTalentSearchRecommendedCandidates") return true;
    const query = typeof entry?.query === "string" ? entry.query : "";
    return query.includes("talentSearchRecommendedCandidatesV2");
  };

  const classify = (url, requestBody) => {
    if (!url) return null;
    if (url.includes("/api/search/resume/v2/attach/resume/info"))
      return { kind: "attach", sourceKey: "job5156" };
    if (url.includes("/api/search/resume/v2/chat/info"))
      return { kind: "chat", sourceKey: "job5156" };
    if (url.includes("/api/search/resume/v2/talent/insight/info"))
      return { kind: "insight", sourceKey: "job5156" };
    if (url.includes("/api/search/resume/v2"))
      return { kind: "search", sourceKey: "job5156" };
    if (url.includes("/graphql")) {
      const recommendedOperation = findGraphqlOperation(
        requestBody,
        isSeekRecommendedCandidatesOperation,
      );
      if (recommendedOperation) {
        return {
          kind: "seekRecommendedCandidates",
          sourceKey: "seek",
          operationName:
            typeof recommendedOperation.operationName === "string"
              ? recommendedOperation.operationName
              : "GetTalentSearchRecommendedCandidates",
          operation: recommendedOperation,
        };
      }
      const profileOperation = findGraphqlOperation(
        requestBody,
        "GetTalentSearchProfileCompleteV2",
      );
      if (profileOperation) {
        return {
          kind: "seekProfile",
          sourceKey: "seek",
          operationName: "GetTalentSearchProfileCompleteV2",
          operation: profileOperation,
        };
      }
    }
    return null;
  };

  const normalizeUrl = (input) => {
    try {
      const raw =
        typeof input === "string" ? input : (input && input.url) || "";
      return raw ? new URL(raw, window.location.href).href : "";
    } catch {
      return "";
    }
  };

  const parseJsonString = (value) => {
    if (typeof value !== "string") {
      return null;
    }
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  };

  const isGraphqlRequest = (url) => url.includes("/graphql");

  const parseRequestBody = async (input, init) => {
    const initBody = parseJsonString(init?.body);
    if (initBody) return initBody;
    if (typeof Request !== "undefined" && input instanceof Request) {
      try {
        return parseJsonString(await input.clone().text());
      } catch {
        return null;
      }
    }
    return null;
  };

  const post = (message) => {
    try {
      window.postMessage({ source: SOURCE, ...message }, "*");
    } catch {
      // ignore
    }
  };

  const sanitizeSeekRequestBody = (operation) => {
    if (!operation || typeof operation !== "object") return null;
    const input = operation.variables?.input;
    const language = operation.variables?.language;
    return {
      operationName:
        typeof operation.operationName === "string"
          ? operation.operationName
          : "",
      variables: {
        input:
          input && typeof input === "object"
            ? {
                jobId: input.jobId,
                page: input.page,
                size: input.size,
                userSessionId: input.userSessionId,
                searchId: input.searchId,
                countryCode: input.countryCode,
                profileId: input.profileId,
                keywords: input.keywords,
              }
            : undefined,
        language: typeof language === "string" ? language : undefined,
      },
    };
  };

  const capture = (classification, url, payload) => {
    if (!classification || !payload) return;
    post({
      kind: classification.kind,
      sourceKey: classification.sourceKey,
      operationName: classification.operationName || "",
      url,
      payload,
      request:
        classification.sourceKey === "seek"
          ? sanitizeSeekRequestBody(classification.operation)
          : undefined,
    });
  };

  const readAttr = (name) => document.documentElement.getAttribute(name) || "";
  const getSourceKey = () => {
    const hostname = window.location.hostname.toLowerCase();
    if (hostname === "hr.job5156.com") return "job5156";
    if (hostname.endsWith(".employer.seek.com")) return "seek";
    return "unknown";
  };
  const parsePositiveInt = (value) => {
    const parsed = Number.parseInt(String(value || "").trim(), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  };
  const parseBridgeResponse = () => {
    const raw = readAttr(PAGE_BRIDGE_RESPONSE_ATTR);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  };
  const dispatchBridgeRequest = (method, args = []) => {
    const requestId = `${Date.now()}-${(pageBridgeRequestCount += 1)}`;
    document.documentElement.setAttribute(
      PAGE_BRIDGE_REQUEST_ATTR,
      JSON.stringify({ id: requestId, method, args }),
    );
    document.documentElement.removeAttribute(PAGE_BRIDGE_RESPONSE_ATTR);
    window.dispatchEvent(new CustomEvent(PAGE_BRIDGE_REQUEST_EVENT));
    return requestId;
  };
  const cleanupBridgeAttributes = () => {
    document.documentElement.removeAttribute(PAGE_BRIDGE_REQUEST_ATTR);
    document.documentElement.removeAttribute(PAGE_BRIDGE_RESPONSE_ATTR);
  };
  const requestContentScriptSync = (method, args = []) => {
    const requestId = dispatchBridgeRequest(method, args);
    const payload = parseBridgeResponse();
    cleanupBridgeAttributes();

    if (!payload || payload.id !== requestId) {
      throw new Error(`Bridge unavailable: ${method}`);
    }
    if (!payload.ok) {
      throw new Error(payload.error || `Bridge call failed: ${method}`);
    }
    return payload.value;
  };
  const requestContentScriptAsync = (method, args = [], options = {}) =>
    new Promise((resolve, reject) => {
      let requestId = null;
      const timeoutMs = parsePositiveInt(options.timeoutMs) || 5000;

      const cleanup = () => {
        window.removeEventListener(PAGE_BRIDGE_RESPONSE_EVENT, onResponse);
        clearTimeout(timeoutId);
        cleanupBridgeAttributes();
      };

      const onResponse = () => {
        const payload = parseBridgeResponse();
        if (!payload || payload.id !== requestId) return;
        cleanup();
        if (payload.ok) {
          resolve(payload.value);
          return;
        }
        reject(new Error(payload.error || `Bridge call failed: ${method}`));
      };

      const timeoutId = window.setTimeout(() => {
        cleanup();
        reject(new Error(`Bridge timeout: ${method}`));
      }, timeoutMs);

      window.addEventListener(PAGE_BRIDGE_RESPONSE_EVENT, onResponse);
      requestId = dispatchBridgeRequest(method, args);
    });
  const getSeekCardCount = () =>
    document.querySelectorAll(
      'a[href*="/talentsearch/profile/"][href*="profilePosition="]',
    ).length;
  const getSeekPaginationInfo = () => {
    const currentPage =
      parsePositiveInt(
        new URL(window.location.href).searchParams.get("pageNumber"),
      ) || 1;
    const pagination = document.querySelector(
      'nav[aria-label="Pagination of results"]',
    );
    if (!pagination) {
      return {
        currentPage,
        totalPages: currentPage,
        hasNextPage: false,
        totalItems: 0,
      };
    }

    const links = Array.from(pagination.querySelectorAll("a"));
    const pageNumbers = links
      .map((node) => {
        const label = node.getAttribute("aria-label") || "";
        const text = node.textContent?.trim() || "";
        const match = label.match(/page\s+(\d+)/i) || text.match(/^(\d+)$/);
        return match ? Number(match[1]) : 0;
      })
      .filter((value) => Number.isFinite(value) && value > 0);
    const totalPages = Math.max(
      pageNumbers.length > 0 ? Math.max(...pageNumbers) : 0,
      currentPage,
    );
    const nextLink =
      links.find(
        (node) => (node.textContent || "").trim().toLowerCase() === "next",
      ) || null;
    const hasNextPage =
      totalPages > currentPage &&
      !!nextLink &&
      !nextLink.hasAttribute("disabled") &&
      !nextLink.classList.contains("disabled") &&
      !nextLink.classList.contains("is-disabled") &&
      nextLink.getAttribute("aria-disabled") !== "true" &&
      nextLink.getAttribute("aria-hidden") !== "true" &&
      nextLink.getAttribute("tabindex") !== "-1";

    return {
      currentPage,
      totalPages,
      hasNextPage,
      totalItems: 0,
    };
  };
  const getPaginationInfo = () => {
    if (getSourceKey() === "seek") {
      return getSeekPaginationInfo();
    }

    const pagination = document.querySelector(".el-pagination");
    if (!pagination) {
      return {
        currentPage: 1,
        totalPages: 1,
        hasNextPage: false,
        totalItems: 0,
      };
    }

    const activePage =
      Number(
        pagination.querySelector(".el-pager li.active")?.textContent?.trim() ||
          "1",
      ) || 1;
    const pageNumbers = Array.from(pagination.querySelectorAll(".el-pager li"))
      .map((node) => Number(node.textContent?.trim() || "0"))
      .filter((value) => Number.isFinite(value) && value > 0);
    const totalPages =
      pageNumbers.length > 0 ? Math.max(...pageNumbers) : activePage;
    const nextPageButton = pagination.querySelector(".btn-next");
    const hasNextPage =
      !!nextPageButton && !nextPageButton.classList.contains("disabled");

    return {
      currentPage: activePage,
      totalPages,
      hasNextPage,
      totalItems: 0,
    };
  };
  const buildFallbackStatus = () => {
    const sourceKey = getSourceKey();
    const apiSnapshotCount = Number(readAttr("data-tr-api-rows") || "0") || 0;
    const cardCount =
      sourceKey === "seek"
        ? Math.max(apiSnapshotCount, getSeekCardCount())
        : document.querySelectorAll(".list-content__li_part").length;

    return {
      extensionLoaded: readAttr("data-tr-resume-hook") === "true",
      extensionVersion: "page-bridge",
      sourceKey,
      apiSnapshotCount,
      domReady:
        sourceKey === "seek"
          ? apiSnapshotCount > 0
          : document.querySelector(
              ".el-checkbox-group.resume-search-item-list-content-block",
            ) !== null,
      loggedIn: !document.querySelector('.login-btn, [href*="login"]'),
      cardCount,
      autoSearch: readAttr("data-tr-auto-search"),
      autoLocation: readAttr("data-tr-auto-location"),
      autoAge: readAttr("data-tr-auto-age"),
      autoExport: readAttr("data-tr-auto-export"),
      pagination: getPaginationInfo(),
      timestamp: new Date().toISOString(),
    };
  };

  if (!trWindow[EXTERNAL_ACCESS_KEY]) {
    const accessor = {
      extract: () => requestContentScriptSync("extract"),
      extractRaw: (options) =>
        requestContentScriptSync("extractRaw", [options]),
      collect: (options) =>
        requestContentScriptAsync("collect", [options], { timeoutMs: 180000 }),
      getApiSnapshot: () => requestContentScriptSync("getApiSnapshot"),
      getPaginationInfo: () => requestContentScriptSync("getPaginationInfo"),
      isReady: () => requestContentScriptSync("isReady"),
      isLoggedIn: () => requestContentScriptSync("isLoggedIn"),
      status: () => {
        try {
          return requestContentScriptSync("status");
        } catch {
          return buildFallbackStatus();
        }
      },
      syncToServer: (resumesOverride) =>
        requestContentScriptAsync("syncToServer", [resumesOverride]),
      goToNextPage: () => requestContentScriptSync("goToNextPage"),
    };

    Object.defineProperty(accessor, "version", {
      configurable: true,
      enumerable: true,
      get() {
        try {
          return (
            requestContentScriptSync("status")?.extensionVersion ||
            "page-bridge"
          );
        } catch {
          return "page-bridge";
        }
      },
    });

    trWindow[EXTERNAL_ACCESS_KEY] = accessor;
  }

  if (trWindow.fetch) {
    const originalFetch = trWindow.fetch;
    trWindow.fetch = function (...args) {
      const requestUrl = normalizeUrl(args[0]);
      if (!isGraphqlRequest(requestUrl)) {
        return originalFetch.apply(this, args);
      }

      return Promise.resolve(parseRequestBody(args[0], args[1])).then(
        (requestBody) =>
          originalFetch.apply(this, args).then((res) => {
            try {
              const classification = classify(requestUrl, requestBody);
              if (classification) {
                res
                  .clone()
                  .json()
                  .then((data) => capture(classification, requestUrl, data))
                  .catch(() => {});
              }
            } catch {
              // ignore
            }
            return res;
          }),
      );
    };
  }

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    /** @type {XMLHttpRequest & { __tr_url?: string, __tr_body?: unknown }} */ (
      this
    ).__tr_url = url;
    return originalOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function (...args) {
    const body = args[0];
    /** @type {XMLHttpRequest & { __tr_body?: unknown }} */ (this).__tr_body =
      parseJsonString(body);

    this.addEventListener("load", function () {
      try {
        const request =
          /** @type {XMLHttpRequest & { __tr_url?: string, __tr_body?: unknown }} */ (
            this
          );
        const url = normalizeUrl(request.__tr_url);
        const classification = classify(url, request.__tr_body);
        if (!classification) return;
        let data = null;
        if (this.responseType === "json" && this.response) {
          data = this.response;
        } else if (typeof this.responseText === "string") {
          const text = this.responseText.trim();
          if (text && (text[0] === "{" || text[0] === "[")) {
            data = JSON.parse(text);
          }
        }
        if (!data) return;
        capture(classification, url, data);
      } catch {
        // ignore
      }
    });
    return originalSend.apply(this, args);
  };
})();
