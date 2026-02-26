(() => {
  function $(id) {
    return /** @type {HTMLElement | null} */ (document.getElementById(id));
  }

  const serverUrlInput = /** @type {HTMLInputElement | null} */ ($("server-url"));
  const serverTokenInput = /** @type {HTMLInputElement | null} */ ($("server-token"));
  const btnTest = /** @type {HTMLButtonElement | null} */ ($("btn-test"));
  const btnSave = /** @type {HTMLButtonElement | null} */ ($("btn-save"));
  const statusDot = /** @type {HTMLElement | null} */ ($("status-dot"));
  const statusText = /** @type {HTMLElement | null} */ ($("status-text"));
  const messageBar = /** @type {HTMLElement | null} */ ($("message"));
  const messageText = /** @type {HTMLElement | null} */ ($("message-text"));

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

  async function testHealth(serverUrl) {
    const url = normalizeServerUrl(serverUrl);
    if (!url) {
      return { success: false, error: "请先填写 Server URL" };
    }

    try {
      const response = await fetch(`${url}/health`, {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        const text = await response.text();
        return { success: false, error: `Health check failed (${response.status}): ${text}` };
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: error?.message ? String(error.message) : String(error) };
    }
  }

  async function loadConfig() {
    return new Promise((resolve) => {
      chrome.storage.local.get({ serverUrl: "", serverToken: "" }, (items) => resolve(items));
    });
  }

  async function saveConfig(serverUrl, serverToken) {
    return new Promise((resolve) => {
      chrome.storage.local.set(
        { serverUrl: normalizeServerUrl(serverUrl), serverToken: String(serverToken || "") },
        () => resolve(true),
      );
    });
  }

  document.addEventListener("DOMContentLoaded", async () => {
    const items = /** @type {{ serverUrl?: string; serverToken?: string }} */ (await loadConfig());
    if (serverUrlInput) serverUrlInput.value = items.serverUrl || "";
    if (serverTokenInput) serverTokenInput.value = items.serverToken || "";

    setConnectionStatus(false, "未测试");

    if (btnTest) {
      btnTest.addEventListener("click", async () => {
        if (btnTest) btnTest.disabled = true;
        showMessage("正在测试连接...", "info");
        const result = await testHealth(serverUrlInput?.value || "");
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
        if (!normalizeServerUrl(serverUrl)) {
          showMessage("请填写 Server URL", "error");
          if (btnSave) btnSave.disabled = false;
          return;
        }
        await saveConfig(serverUrl, serverToken);
        showMessage("✅ 已保存", "success");
        if (btnSave) btnSave.disabled = false;
      });
    }
  });
})();
