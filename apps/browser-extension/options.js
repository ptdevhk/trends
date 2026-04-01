(() => {
  function $(id) {
    return /** @type {HTMLElement | null} */ (document.getElementById(id));
  }

  const serverUrlInput = /** @type {HTMLInputElement | null} */ ($("server-url"));
  const serverTokenInput = /** @type {HTMLInputElement | null} */ ($("server-token"));
  const keywordModeConcatInput = /** @type {HTMLInputElement | null} */ ($("keyword-mode-concat"));
  const keywordModeSpacedInput = /** @type {HTMLInputElement | null} */ ($("keyword-mode-spaced"));
  const collectLimitInput = /** @type {HTMLInputElement | null} */ ($("collect-limit"));
  const maxPagesInput = /** @type {HTMLInputElement | null} */ ($("max-pages"));
  const guardJob5156Input = /** @type {HTMLTextAreaElement | null} */ ($("guard-job5156"));
  const guard51jobInput = /** @type {HTMLTextAreaElement | null} */ ($("guard-51job"));
  const guardSeekInput = /** @type {HTMLTextAreaElement | null} */ ($("guard-seek"));
  const btnTest = /** @type {HTMLButtonElement | null} */ ($("btn-test"));
  const btnSave = /** @type {HTMLButtonElement | null} */ ($("btn-save"));
  const statusDot = /** @type {HTMLElement | null} */ ($("status-dot"));
  const statusText = /** @type {HTMLElement | null} */ ($("status-text"));
  const messageBar = /** @type {HTMLElement | null} */ ($("message"));
  const messageText = /** @type {HTMLElement | null} */ ($("message-text"));
  const DEFAULT_SERVER_URL = "https://trends.pt-mes.com";
  const DEFAULT_KEYWORD_MODE = "concat";
  const KEYWORD_MODE_SPACED = "spaced";
  const DEFAULT_COLLECTION_GUARDS = {
    job5156: "experience,jobIntention,selfIntro",
    "51job": "experience,jobIntention,selfIntro",
    seek: "experience,jobIntention,selfIntro",
  };

  function normalizeKeywordMode(value) {
    return value === KEYWORD_MODE_SPACED ? KEYWORD_MODE_SPACED : DEFAULT_KEYWORD_MODE;
  }

  function normalizeCollectionLimit(value) {
    const parsed = Number.parseInt(String(value || "").trim(), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }

  function normalizeGuardCsv(value) {
    if (typeof value !== "string") return "";
    return value
      .split(",")
      .map((field) => field.trim())
      .filter(Boolean)
      .join(",");
  }

  function showMessage(text, type) {
    if (!messageBar || !messageText) return;
    messageBar.className = `status-bar ${type || "info"}`;
    messageText.textContent = text;
    messageBar.classList.remove("hidden");
  }

  function setConnectionStatus(connected, text) {
    if (statusDot) {
      statusDot.className = connected ? "dot connected" : "dot";
    }
    if (statusText) {
      statusText.textContent = text;
    }
  }

  function normalizeServerUrl(value) {
    const raw = typeof value === "string" ? value.trim() : "";
    if (!raw) return "";
    return raw.replace(/\/+$/, "");
  }

  async function testConnection(serverUrl, serverToken) {
    const url = normalizeServerUrl(serverUrl);
    if (!url) return { success: false, error: "请先填写 Server URL" };

    try {
      const response = await fetch(`${url}/health`, {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        return { success: false, error: `服务器不可达 (${response.status})` };
      }
    } catch (error) {
      return {
        success: false,
        error: `无法连接服务器: ${error?.message ? String(error.message) : String(error)}`,
      };
    }

    const token = typeof serverToken === "string" ? serverToken.trim() : "";
    if (!token) return { success: false, error: "请填写 Auth Token" };

    try {
      const response = await fetch(`${url}/api/resumes/verify-token`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
        },
      });
      if (response.status === 401) {
        return { success: false, error: "Token 无效" };
      }
      if (!response.ok) {
        return { success: false, error: `Token 验证失败 (${response.status})` };
      }
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: `Token 验证出错: ${error?.message ? String(error.message) : String(error)}`,
      };
    }
  }

  async function loadConfig() {
    return new Promise((resolve) => {
      chrome.storage.local.get(
        {
          serverUrl: "",
          serverToken: "",
          keywordMode: DEFAULT_KEYWORD_MODE,
          collectLimit: 0,
          maxPages: 0,
          collectionGuards: DEFAULT_COLLECTION_GUARDS,
        },
        (items) => resolve(items),
      );
    });
  }

  async function saveConfig(serverUrl, serverToken, keywordMode, collectLimit, maxPages, collectionGuards) {
    return new Promise((resolve) => {
      chrome.storage.local.set(
        {
          serverUrl: normalizeServerUrl(serverUrl),
          serverToken: String(serverToken || ""),
          keywordMode: normalizeKeywordMode(keywordMode),
          collectLimit: normalizeCollectionLimit(collectLimit),
          maxPages: normalizeCollectionLimit(maxPages),
          collectionGuards: {
            job5156: normalizeGuardCsv(collectionGuards?.job5156) || DEFAULT_COLLECTION_GUARDS.job5156,
            "51job": normalizeGuardCsv(collectionGuards?.["51job"]) || DEFAULT_COLLECTION_GUARDS["51job"],
            seek: normalizeGuardCsv(collectionGuards?.seek) || DEFAULT_COLLECTION_GUARDS.seek,
          },
        },
        () => resolve(true),
      );
    });
  }

  document.addEventListener("DOMContentLoaded", async () => {
    const items = /** @type {{ serverUrl?: string; serverToken?: string; keywordMode?: string; collectLimit?: number; maxPages?: number; collectionGuards?: { job5156?: string; "51job"?: string; seek?: string } }} */ (await loadConfig());
    const keywordMode = normalizeKeywordMode(items.keywordMode);
    const collectionGuards = items.collectionGuards || DEFAULT_COLLECTION_GUARDS;
    if (serverUrlInput) serverUrlInput.value = items.serverUrl || DEFAULT_SERVER_URL;
    if (serverTokenInput) serverTokenInput.value = items.serverToken || "";
    if (keywordModeConcatInput) keywordModeConcatInput.checked = keywordMode !== KEYWORD_MODE_SPACED;
    if (keywordModeSpacedInput) keywordModeSpacedInput.checked = keywordMode === KEYWORD_MODE_SPACED;
    if (collectLimitInput) collectLimitInput.value = String(normalizeCollectionLimit(items.collectLimit));
    if (maxPagesInput) maxPagesInput.value = String(normalizeCollectionLimit(items.maxPages));
    if (guardJob5156Input) guardJob5156Input.value = collectionGuards.job5156 || DEFAULT_COLLECTION_GUARDS.job5156;
    if (guard51jobInput) guard51jobInput.value = collectionGuards["51job"] || DEFAULT_COLLECTION_GUARDS["51job"];
    if (guardSeekInput) guardSeekInput.value = collectionGuards.seek || DEFAULT_COLLECTION_GUARDS.seek;

    setConnectionStatus(false, "未测试");

    if (btnTest) {
      btnTest.addEventListener("click", async () => {
        if (btnTest) btnTest.disabled = true;
        showMessage("正在测试连接...", "info");
        const result = await testConnection(serverUrlInput?.value || "", serverTokenInput?.value || "");
        if (result.success) {
          setConnectionStatus(true, "已连接");
          showMessage("✅ 连接成功", "success");
        } else {
          setConnectionStatus(false, "未连接");
          showMessage(result.error || "连接失败", "error");
        }
        if (btnTest) btnTest.disabled = false;
      });
    }

    if (btnSave) {
      btnSave.addEventListener("click", async () => {
        if (btnSave) btnSave.disabled = true;
        const serverUrl = serverUrlInput?.value || "";
        const serverToken = serverTokenInput?.value || "";
        const keywordMode = keywordModeSpacedInput?.checked ? KEYWORD_MODE_SPACED : DEFAULT_KEYWORD_MODE;
        const collectLimit = collectLimitInput?.value || "";
        const maxPages = maxPagesInput?.value || "";
        await saveConfig(serverUrl, serverToken, keywordMode, collectLimit, maxPages, {
          job5156: guardJob5156Input?.value || "",
          "51job": guard51jobInput?.value || "",
          seek: guardSeekInput?.value || "",
        });
        showMessage("✅ 已保存", "success");
        if (btnSave) btnSave.disabled = false;
      });
    }
  });
})();
