(() => {
  /** @type {Window & { __trResumeHookInstalled?: boolean }} */
  const trWindow = window;
  if (trWindow.__trResumeHookInstalled) return;
  trWindow.__trResumeHookInstalled = true;
  try {
    document.documentElement?.setAttribute("data-tr-page-hook", "true");
  } catch (e) {
    console.warn("[tr-page-hook] setAttribute failed", e?.message || e);
  }

  // Hook history.replaceState to restore SEEK params (roleTitles, keywords, etc.)
  // immediately when SEEK's SPA strips them via replaceState. This runs in the
  // MAIN world BEFORE SEEK's SPA reads the URL for GraphQL requests.
  try {
    const seekParamNames = ["keywords", "roleTitles", "matchAll", "tr_max_age"];
    const savedParams = {};
    for (const p of seekParamNames) {
      const v = sessionStorage.getItem(`tr_seek_param_${p}`);
      if (v !== null) savedParams[p] = v;
    }
    if (Object.keys(savedParams).length > 0) {
      const origReplaceState = history.replaceState.bind(history);
      history.replaceState = function (state, unused, url) {
        if (url != null) {
          try {
            const patched = new URL(url, window.location.href);
            let changed = false;
            for (const [k, v] of Object.entries(savedParams)) {
              if (!patched.searchParams.has(k)) {
                patched.searchParams.set(k, v);
                changed = true;
              }
            }
            if (changed) {
              return origReplaceState(state, unused, patched.toString());
            }
          } catch { /* ignore parse errors */ }
        }
        return origReplaceState(state, unused, url);
      };
    }
  } catch (e) {
    console.warn("[tr-page-hook] replaceState hook failed", e?.message || e);
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

  const isSeekTalentSearchOperation = (entry) => {
    const operationName =
      typeof entry?.operationName === "string" ? entry.operationName : "";
    if (operationName === "SearchProfilesByNaturalLanguage") return true;
    const query = typeof entry?.query === "string" ? entry.query : "";
    return /talentSearchProfilesNaturalLanguageSearch\s*\(/i.test(query);
  };

  const isSeekProfileV3Operation = (entry) => {
    const operationName =
      typeof entry?.operationName === "string" ? entry.operationName : "";
    if (operationName === "GetTalentSearchProfileCompleteV3") return true;
    const query = typeof entry?.query === "string" ? entry.query : "";
    return /talentSearchProfileV3\s*\(/i.test(query);
  };

  const headersToObject = (headers) => {
    if (!headers) {
      return {};
    }

    const result = {};
    if (typeof Headers !== "undefined" && headers instanceof Headers) {
      headers.forEach((value, key) => {
        result[key.toLowerCase()] = value;
      });
      return result;
    }

    if (Array.isArray(headers)) {
      for (const entry of headers) {
        if (!Array.isArray(entry) || entry.length < 2) continue;
        const [key, value] = entry;
        if (typeof key !== "string") continue;
        result[key.toLowerCase()] = Array.isArray(value) ? value.join(", ") : String(value);
      }
      return result;
    }

    if (typeof headers === "object") {
      for (const [key, value] of Object.entries(headers)) {
        result[key.toLowerCase()] = Array.isArray(value) ? value.join(", ") : String(value);
      }
    }

    return result;
  };

  const mergeRequestHeaders = (...sources) => {
    const merged = {};
    for (const source of sources) {
      const headers = headersToObject(source);
      for (const [key, value] of Object.entries(headers)) {
        if (typeof value !== "string") continue;
        merged[key] = value;
      }
    }
    return merged;
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
    if (url.includes("ehire.51job.com") || url.includes("ehirej.51job.com")) {
      try {
        const pathname = new URL(url).pathname.toLowerCase();
        if (pathname.includes("/resumedtl/getresume")) {
          return { kind: "job51detail", sourceKey: "51job" };
        }
        if (
          pathname.includes("/talent_hunt_resume_list") ||
          pathname.includes("/talent/search") ||
          pathname.includes("/talent/list") ||
          pathname.includes("/resume/search") ||
          pathname.includes("/resume/list") ||
          pathname.includes("/candidate/search") ||
          pathname.includes("/candidate/list") ||
          pathname.includes("/search/talent") ||
          pathname.includes("/search/resume")
        ) {
          return { kind: "job51search", sourceKey: "51job" };
        }
      } catch (e) {
        console.warn("[tr-page-hook] URL parse failed for classify", e?.message || e);
      }
    }
    if (url.includes("/graphql")) {
      const talentSearchOperation = findGraphqlOperation(
        requestBody,
        isSeekTalentSearchOperation,
      );
      if (talentSearchOperation) {
        return {
          kind: "seekTalentSearch",
          sourceKey: "seek",
          operationName:
            typeof talentSearchOperation.operationName === "string"
              ? talentSearchOperation.operationName
              : "SearchProfilesByNaturalLanguage",
          operation: talentSearchOperation,
        };
      }
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
      const profileV3Operation = findGraphqlOperation(
        requestBody,
        isSeekProfileV3Operation,
      );
      if (profileV3Operation) {
        return {
          kind: "seekProfile",
          sourceKey: "seek",
          operationName: "GetTalentSearchProfileCompleteV3",
          operation: profileV3Operation,
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
    } catch (e) {
      console.warn("[tr-page-hook] normalizeUrl failed", e?.message || e);
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
      // non-JSON string — expected for many XHR bodies
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
      } catch (e) {
        console.warn("[tr-page-hook] parseRequestBody clone failed", e?.message || e);
        return null;
      }
    }
    return null;
  };

  const post = (message) => {
    try {
      window.postMessage({ source: SOURCE, ...message }, "*");
    } catch (e) {
      console.warn("[tr-page-hook] postMessage failed", e?.message || e);
    }
  };

  const sanitizeSeekRequestBody = (operation) => {
    if (!operation || typeof operation !== "object") return null;
    const opName =
      typeof operation.operationName === "string" ? operation.operationName : "";
    const language = operation.variables?.language;
    const locale = operation.variables?.locale;

    if (opName === "SearchProfilesByNaturalLanguage") {
      const input = operation.variables?.input;
      if (!input || typeof input !== "object") {
        return {
          operationName: opName,
          variables: { language: typeof language === "string" ? language : undefined },
        };
      }
      return {
        operationName: opName,
        variables: {
          input: {
            roleTitles: input.roleTitles && typeof input.roleTitles === "object"
              ? {
                  values: Array.isArray(input.roleTitles.values) ? input.roleTitles.values : undefined,
                  matchLatestOnly: typeof input.roleTitles.matchLatestOnly === "boolean"
                    ? input.roleTitles.matchLatestOnly
                    : undefined,
                }
              : undefined,
            companyNames: input.companyNames && typeof input.companyNames === "object"
              ? {
                  values: Array.isArray(input.companyNames.values) ? input.companyNames.values : undefined,
                  matchLatestOnly: typeof input.companyNames.matchLatestOnly === "boolean"
                    ? input.companyNames.matchLatestOnly
                    : undefined,
                }
              : undefined,
            keywords: input.keywords && typeof input.keywords === "object"
              ? {
                  values: Array.isArray(input.keywords.values) ? input.keywords.values : undefined,
                  matchAll: typeof input.keywords.matchAll === "boolean"
                    ? input.keywords.matchAll
                    : undefined,
                }
              : undefined,
            locations: Array.isArray(input.locations) ? input.locations : undefined,
            salary: input.salary && typeof input.salary === "object"
              ? {
                  frequency: typeof input.salary.frequency === "string" ? input.salary.frequency : undefined,
                  includeUnspecified: typeof input.salary.includeUnspecified === "boolean"
                    ? input.salary.includeUnspecified
                    : undefined,
                  range: input.salary.range && typeof input.salary.range === "object"
                    ? {
                        minimum: typeof input.salary.range.minimum === "number"
                          ? input.salary.range.minimum
                          : undefined,
                        maximum: typeof input.salary.range.maximum === "number"
                          ? input.salary.range.maximum
                          : undefined,
                      }
                    : undefined,
                }
              : undefined,
            pageNumber: typeof input.pageNumber === "number" ? input.pageNumber : undefined,
            pageSize: typeof input.pageSize === "number" ? input.pageSize : undefined,
            originalNaturalLanguageQuery:
              typeof input.originalNaturalLanguageQuery === "string"
                ? input.originalNaturalLanguageQuery
                : undefined,
            countryCode: typeof input.countryCode === "string" ? input.countryCode : undefined,
            sortBy: typeof input.sortBy === "string" ? input.sortBy : undefined,
          },
          language: typeof language === "string" ? language : undefined,
          locale: typeof locale === "string" ? locale : undefined,
        },
      };
    }

    // Recommended (V2) and profile (V2/V3) keep the existing shape:
    const input = operation.variables?.input;
    return {
      operationName: opName,
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
                profileGuid: input.profileGuid,
                keywords: input.keywords,
              }
            : undefined,
        language: typeof language === "string" ? language : undefined,
      },
    };
  };

  /**
   * Inject roleTitles from sessionStorage into a SearchProfilesByNaturalLanguage
   * request body when SEEK's SPA strips the URL parameter before the first
   * GraphQL request fires. Reads `tr_seek_param_roleTitles` (comma-separated)
   * saved by the content script at document_start.
   *
   * Returns a NEW object when injection is needed (so callers can detect via !==).
   * Returns the original body unchanged when no injection is needed.
   */
  const injectSeekRoleTitles = (body) => {
    try {
      if (!body || typeof body !== "object") return body;
      if (body.operationName !== "SearchProfilesByNaturalLanguage") return body;
      const input = body.variables?.input;
      if (!input || typeof input !== "object") return body;
      const hasRoleTitles =
        input.roleTitles &&
        typeof input.roleTitles === "object" &&
        Array.isArray(input.roleTitles.values) &&
        input.roleTitles.values.length > 0;
      if (hasRoleTitles) return body;

      const stored = sessionStorage.getItem("tr_seek_param_roleTitles");
      if (!stored) return body;
      const values = stored
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (values.length === 0) return body;

      // Return a NEW object so the caller can detect the change via !==.
      const patched = JSON.parse(JSON.stringify(body));
      patched.variables.input.roleTitles = {
        values,
        matchLatestOnly:
          input.roleTitles && typeof input.roleTitles.matchLatestOnly === "boolean"
            ? input.roleTitles.matchLatestOnly
            : false,
      };
      console.log("[tr-page-hook] Injected roleTitles:", values);
      return patched;
    } catch (e) {
      console.warn("[tr-page-hook] injectSeekRoleTitles failed", e?.message || e);
    }
    return body;
  };

  const capture = (classification, url, payload, requestHeaders, request) => {
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
          : request && typeof request === "object"
            ? request
            : undefined,
      requestHeaders: requestHeaders && typeof requestHeaders === "object"
        ? requestHeaders
        : undefined,
    });
  };

  const readAttr = (name) => document.documentElement.getAttribute(name) || "";
  const getSourceKey = () => {
    const hostname = window.location.hostname.toLowerCase();
    if (hostname === "hr.job5156.com") return "job5156";
    if (hostname.endsWith(".employer.seek.com")) return "seek";
    if (hostname === "ehire.51job.com") return "51job";
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
    } catch (e) {
      console.warn("[tr-page-hook] bridge response parse failed", e?.message || e);
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
        : sourceKey === "51job"
          ? apiSnapshotCount
          : document.querySelectorAll(".list-content__li_part").length;

    return {
      extensionLoaded: readAttr("data-tr-resume-hook") === "true",
      extensionVersion: "page-bridge",
      sourceKey,
      apiSnapshotCount,
      domReady:
        sourceKey === "seek" || sourceKey === "51job"
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
        } catch (e) {
          console.warn("[tr-page-hook] status() fell back to buildFallbackStatus", e?.message || e);
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
          // bridge unavailable — expected when content script hasn't loaded yet
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
      const is51jobFetch =
        requestUrl.includes("ehire.51job.com") ||
        requestUrl.includes("ehirej.51job.com");
      if (!isGraphqlRequest(requestUrl) && !is51jobFetch) {
      return originalFetch.apply(this, args);
    }

    return Promise.resolve(parseRequestBody(args[0], args[1])).then(
      (requestBody) => {
        const requestHeaders = mergeRequestHeaders(
          typeof Request !== "undefined" && args[0] instanceof Request
            ? args[0].headers
            : undefined,
          typeof args[1] === "object" && args[1] !== null ? args[1].headers : undefined,
        );
        // Inject roleTitles from sessionStorage before SEEK's SPA sends the
        // first GraphQL request (which fires before the content script can
        // restore stripped URL params).
        const patchedBody = injectSeekRoleTitles(requestBody);
        if (patchedBody !== requestBody) {
          const patched = JSON.stringify(patchedBody);
          if (typeof Request !== "undefined" && args[0] instanceof Request) {
            args = [new Request(args[0], { body: patched }), args[1]];
          } else if (typeof args[1] === "object" && args[1] !== null) {
            args[1] = { ...args[1], body: patched };
          }
        }
          return originalFetch.apply(this, args).then((res) => {
            try {
              const classification = classify(requestUrl, requestBody);
              if (classification) {
                res
                  .clone()
                  .json()
                  .then((data) => capture(classification, requestUrl, data, requestHeaders, requestBody))
                  .catch((e) => { console.warn("[tr-page-hook] fetch response.json() failed", e?.message || e); });
              }
            } catch (e) {
              console.warn("[tr-page-hook] fetch capture failed", e?.message || e);
            }
            return res;
          });
        },
      );
    };
  }

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  const originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    /** @type {XMLHttpRequest & { __tr_url?: string, __tr_body?: unknown, __tr_requestHeaders?: Record<string, string> }} */ (
      this
    ).__tr_url = url;
    /** @type {XMLHttpRequest & { __tr_requestHeaders?: Record<string, string> }} */ (
      this
    ).__tr_requestHeaders = {};
    return originalOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    /** @type {XMLHttpRequest & { __tr_requestHeaders?: Record<string, string> }} */ (
      this
    ).__tr_requestHeaders ||= {};
    if (typeof name === "string") {
      const headers = /** @type {XMLHttpRequest & { __tr_requestHeaders?: Record<string, string> }} */ (
        this
      ).__tr_requestHeaders;
      const key = name.toLowerCase();
      const nextValue = String(value);
      headers[key] = headers[key] ? `${headers[key]}, ${nextValue}` : nextValue;
    }
    return originalSetRequestHeader.call(this, name, value);
  };
  // 51job infinite-scroll next-page trigger.
  // Content script sends a postMessage with action "trJob51NextPageRequest";
  // page-hook (MAIN world) receives it via the shared "message" event and calls
  // the Vue component's listToBottom() which increments page_index and fetches
  // the next page.
  // Must match JOB51_NEXT_PAGE_EVENT / CONTENT_SCRIPT_SOURCE in content.ts.
  // Content script postMessage sets event.source to null (Chrome cross-world
  // behavior), so we cannot guard on event.source !== window here.
  // Guard against iframe-originated messages: allow null (content script) and
  // window (same-origin), reject other sources. The data.source field is our
  // protocol-level identity check instead.
  window.addEventListener('message', (event) => {
    if (event.source !== null && event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== 'tr-resume-content-script') return;
    if (data.action !== 'trJob51NextPageRequest') return;
    try {
      const container = /** @type {HTMLElement & {__vue__?: {listToBottom: Function}} } */ (
        document.querySelector('.talent-search-container')
      );
      if (!container) return;
      const vm = container.__vue__;
      if (vm && typeof vm.listToBottom === 'function') {
        vm.listToBottom();
      }
    } catch (e) {
      console.warn('[tr] 51job next-page trigger failed', e);
    }
  });

  XMLHttpRequest.prototype.send = function (...args) {
    const body = parseJsonString(args[0]);
    // Inject roleTitles from sessionStorage for SEEK GraphQL requests sent via XHR.
    const patchedBody = injectSeekRoleTitles(body);
    if (patchedBody !== body) {
      args[0] = JSON.stringify(patchedBody);
    }
    /** @type {XMLHttpRequest & { __tr_body?: unknown }} */ (this).__tr_body =
      patchedBody;

    this.addEventListener("load", function () {
      try {
        const request =
          /** @type {XMLHttpRequest & { __tr_url?: string, __tr_body?: unknown, __tr_requestHeaders?: Record<string, string> }} */ (
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
        capture(classification, url, data, request.__tr_requestHeaders, request.__tr_body);
      } catch (e) {
        console.warn("[tr-page-hook] XHR load capture failed", e?.message || e);
      }
    });
    return originalSend.apply(this, args);
  };
})();
