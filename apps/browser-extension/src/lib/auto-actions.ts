/**
 * Auto-actions — automatic age filter, location, search, export, and sync
 * orchestration. Dependencies injected from content.ts.
 *
 * Created as Phase 4 of content.ts extraction.
 */

export interface AutoActionsDeps extends Record<string, unknown> {
  activateElement: (el: unknown) => void;
  fireMouseEvent: (el: unknown, type: string) => void;
  setInputValue: (el: unknown, value: string) => void;
  apiSnapshot: Record<string, unknown>;
  getCurrentSourceKey: () => string;
  getCurrentAgeRange: () => { enabled: boolean; minAge?: number; maxAge?: number };
  SOURCE_KEYS: Record<string, string>;
  isElementVisible: (el: unknown) => boolean;
  resolveJob51AgeFilterDropdown: (ageBlock: unknown) => unknown;
  ensureJob51AgeCustomRangeInputs: (selectBox: unknown, options?: Record<string, unknown>) => Promise<void>;
  applyJob51AgeCustomRangeViaVue: (confirmButton: unknown, options: Record<string, unknown>) => Promise<boolean>;
  waitForJob51AgeFilterRefresh: (previousLastSearchAt: unknown, options: Record<string, unknown>) => Promise<boolean>;
  waitForExtractionData: (options?: Record<string, unknown>) => Promise<unknown>;
  asHTMLElement: (el: unknown) => HTMLElement | null;
  SELECTORS: Record<string, string>;
  AUTO_LOCATION_PARAM: string;
  AUTO_SEARCH_PARAM: string;
  AUTO_KEYWORD_MODE_PARAM: string;
  KEYWORD_MODE_SPACED: string;
  normalizeKeyword: (value: string) => string;
  normalizeKeywordMode: (mode: string) => string;
  getKeywordMode: () => Promise<string>;
  normalizeSeekLocationLabel: (label: string) => string;
  hasJob51SearchSnapshot: () => boolean;
  isJob51EmptySearchPromptVisible: () => boolean;
  parseAutoLocationValues: (raw: string) => string[];
  extractResumes: () => unknown[];
  extractResumesRaw: (options?: Record<string, unknown>) => Record<string, unknown>;
  isJob51DetailPage: () => boolean;
  isJob5156DetailPage: () => boolean;
  isSeekProfileMode: () => boolean;
  enrich51JobSearchResumesWithDetail: (resumes: unknown[]) => Promise<unknown[]>;
  enrichJob5156SearchResumesWithDetail: (resumes: unknown[]) => Promise<unknown[]>;
  enrichSeekResumesWithDetail: (resumes: unknown[]) => Promise<unknown[]>;
  buildSubmitMetadata: (options?: Record<string, unknown>) => Record<string, unknown>;
  loadCollectionGuards: () => Promise<Record<string, unknown>>;
  parseGuardFieldNames: (csv: string) => string[];
  applyCollectionGuards: (resume: unknown, fields: string[]) => unknown;
  AUTO_EXPORT_PARAM: string;
  AUTO_SYNC_PARAM: string;
  buildExportMetadata: (resumes: unknown[]) => Record<string, unknown>;
  buildExportFilename: () => string;
  document: Document;
  window: Window;
}

export function createAutoActions(deps: AutoActionsDeps) {
  const {
    activateElement,
    fireMouseEvent,
    setInputValue,
    apiSnapshot,
    getCurrentSourceKey,
    getCurrentAgeRange,
    SOURCE_KEYS,
    isElementVisible,
    resolveJob51AgeFilterDropdown,
    ensureJob51AgeCustomRangeInputs,
    applyJob51AgeCustomRangeViaVue,
    waitForJob51AgeFilterRefresh,
    waitForExtractionData,
    asHTMLElement,
    SELECTORS,
    AUTO_LOCATION_PARAM,
    AUTO_SEARCH_PARAM,
    AUTO_KEYWORD_MODE_PARAM,
    KEYWORD_MODE_SPACED,
    normalizeKeyword,
    normalizeKeywordMode,
    getKeywordMode,
    normalizeSeekLocationLabel,
    hasJob51SearchSnapshot,
    isJob51EmptySearchPromptVisible,
    parseAutoLocationValues,
    extractResumes,
    extractResumesRaw,
    isJob51DetailPage,
    isJob5156DetailPage,
    isSeekProfileMode,
    enrich51JobSearchResumesWithDetail,
    enrichJob5156SearchResumesWithDetail,
    enrichSeekResumesWithDetail,
    buildSubmitMetadata,
    AUTO_EXPORT_PARAM,
    AUTO_SYNC_PARAM,
    buildExportMetadata,
    buildExportFilename,
    document: doc,
    window: win,
    loadCollectionGuards,
    parseGuardFieldNames,
    applyCollectionGuards,
  } = deps;

  // ── setAutoAgeAttributes ──

  function setAutoAgeAttributes(status: string, minAge?: number | null, maxAge?: number | null) {
    try {
      doc.documentElement.setAttribute("data-tr-auto-age", status);
      const normalizedMin =
        typeof minAge === "number" && Number.isFinite(minAge)
          ? Math.trunc(minAge)
          : null;
      const normalizedMax =
        typeof maxAge === "number" && Number.isFinite(maxAge)
          ? Math.trunc(maxAge)
          : null;
      if (normalizedMin !== null || normalizedMax !== null) {
        doc.documentElement.setAttribute(
          "data-tr-age-range",
          `${normalizedMin !== null ? normalizedMin : ""}-${normalizedMax !== null ? normalizedMax : ""}`,
        );
      } else {
        doc.documentElement.removeAttribute("data-tr-age-range");
      }
    } catch (e) {
      console.warn("[tr-auto-actions]", "setAutoAgeAttributes: DOM attribute set failed", e?.message || e);
    }
  }

  // ── findAgeFilterBlock ──

  function findAgeFilterBlock() {
    if (getCurrentSourceKey() === SOURCE_KEYS.JOB51) {
      const labels = doc.querySelectorAll(".base-select-label");
      const label = Array.from(labels).find(
        (node) => ((node as Element).textContent || "").replace(/\s+/g, "").trim() === "年龄",
      );
      if (label) {
        return (
          (label as Element).closest(".el-popover__reference") ||
          (label as Element).closest(".base-select-button") ||
          (label as Element).closest(".el-popover__reference-wrapper")
        );
      }
    }

    const titles = doc.querySelectorAll(".base-input-block__title__text");
    const label = Array.from(titles).find(
      (node) => ((node as Element).textContent || "").replace(/\s+/g, "").trim() === "年龄",
    );
    return label ? (label as Element).closest(".base-input-block") : null;
  }

  // ── openAgeFilterDropdown ──

  function openAgeFilterDropdown(ageBlock: Element) {
    if (getCurrentSourceKey() === SOURCE_KEYS.JOB51) {
      const trigger =
        ageBlock.querySelector(".base-select-button") ||
        (ageBlock.matches?.(".base-select-button") ? ageBlock : null) ||
        ageBlock;
      activateElement(trigger);
      return;
    }

    const title = ageBlock.querySelector(".base-input-block__title") || ageBlock;
    ["mouseenter", "mouseover", "mousedown", "mouseup", "click"].forEach((type) =>
      fireMouseEvent(title, type),
    );
  }

  // ── resolveAgeSelectBox ──

  function resolveAgeSelectBox(ageBlock: Element) {
    return getCurrentSourceKey() === SOURCE_KEYS.JOB51
      ? resolveJob51AgeFilterDropdown(ageBlock)
      : ageBlock.querySelector(".base-input-block__select_box");
  }

  // ── waitForAgeFilterDropdown ──

  async function waitForAgeFilterDropdown(ageBlock: Element, { timeoutMs = 4000 }: Record<string, unknown> = {}) {
    const timeout = typeof timeoutMs === "number" ? timeoutMs : 4000;
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const selectBox = resolveAgeSelectBox(ageBlock);
      if (selectBox && isElementVisible(selectBox)) {
        return selectBox;
      }
      openAgeFilterDropdown(ageBlock);
      await new Promise((resolve) => setTimeout(resolve, 120));
    }

    const finalSelectBox = resolveAgeSelectBox(ageBlock);
    return finalSelectBox && isElementVisible(finalSelectBox) ? finalSelectBox : null;
  }

  // ── resolveAgeFilterActions ──

  function resolveAgeFilterActions(selectBox: Element) {
    const minInput = selectBox.querySelector('input[placeholder="最低"]');
    const maxInput = selectBox.querySelector('input[placeholder="最高"]');
    const buttons = Array.from(selectBox.querySelectorAll("button"));
    const confirmButton = buttons.find((button) => {
      const text = (button as HTMLElement).textContent || "";
      return text.replace(/\s+/g, "").trim() === "确定" || text.replace(/\s+/g, "").trim() === "確定";
    });
    const cancelButton = buttons.find((button) => {
      const text = ((button as HTMLElement).textContent || "").replace(/\s+/g, "").trim();
      return text === "取消";
    });

    return { minInput, maxInput, confirmButton, cancelButton };
  }

  // ── autoApplyAgeFilterFromUrl ──

  async function autoApplyAgeFilterFromUrl() {
    const sourceKey = getCurrentSourceKey();
    const range = getCurrentAgeRange();
    if (!range.enabled) {
      setAutoAgeAttributes("skipped");
      return;
    }

    const minAge = range.minAge;
    const maxAge = range.maxAge;
    if (
      typeof minAge === "number" &&
      typeof maxAge === "number" &&
      minAge > maxAge
    ) {
      setAutoAgeAttributes("failed", minAge, maxAge);
      console.warn("🎯 [Auto Age] Invalid age range (minAge > maxAge):", {
        minAge,
        maxAge,
      });
      return;
    }

    if (
      sourceKey === SOURCE_KEYS.JOB51 &&
      (typeof minAge !== "number" || typeof maxAge !== "number")
    ) {
      setAutoAgeAttributes("failed", minAge, maxAge);
      console.warn(
        "🎯 [Auto Age] 51job native age filter requires both min and max ages.",
        { minAge, maxAge },
      );
      return;
    }

    const ageBlock = findAgeFilterBlock();
    if (!ageBlock) {
      if (sourceKey === SOURCE_KEYS.JOB51) {
        setAutoAgeAttributes("failed", minAge, maxAge);
        console.warn(
          "🎯 [Auto Age] 51job age filter control not found.",
        );
        return;
      }
      setAutoAgeAttributes("failed", minAge, maxAge);
      console.warn(
        "🎯 [Auto Age] Age filter control not found; skipping native age filter apply.",
      );
      return;
    }

    const selectBox = await waitForAgeFilterDropdown(ageBlock, {
      timeoutMs: 5000,
    });
    if (!selectBox) {
      if (sourceKey === SOURCE_KEYS.JOB51) {
        setAutoAgeAttributes("failed", minAge, maxAge);
        console.warn(
          "🎯 [Auto Age] 51job age filter dropdown did not open.",
        );
        return;
      }
      setAutoAgeAttributes("failed", minAge, maxAge);
      console.warn("🎯 [Auto Age] Failed to open age filter dropdown.");
      return;
    }

    if (sourceKey === SOURCE_KEYS.JOB51) {
      await ensureJob51AgeCustomRangeInputs(selectBox as Element, {
        timeoutMs: 2500,
      });
    }

    const { minInput, maxInput, confirmButton, cancelButton } =
      resolveAgeFilterActions(selectBox as Element);
    if (!minInput || !maxInput || !confirmButton) {
      if (sourceKey === SOURCE_KEYS.JOB51) {
        setAutoAgeAttributes("failed", minAge, maxAge);
        if (cancelButton) {
          activateElement(cancelButton);
        }
        console.warn(
          "🎯 [Auto Age] 51job age filter inputs/buttons not found.",
        );
        return;
      }
      setAutoAgeAttributes("failed", minAge, maxAge);
      if (cancelButton) {
        activateElement(cancelButton);
      }
      console.warn(
        "🎯 [Auto Age] Age filter inputs/buttons not found; skipping native age filter apply.",
      );
      return;
    }

    setInputValue(minInput, typeof minAge === "number" ? String(minAge) : "");
    setInputValue(maxInput, typeof maxAge === "number" ? String(maxAge) : "");
    const previousLastSearchAt = apiSnapshot.lastSearchAt;
    const appliedViaVue =
      sourceKey === SOURCE_KEYS.JOB51
        ? await applyJob51AgeCustomRangeViaVue(confirmButton, {
            minAge,
            maxAge,
          })
        : false;
    if (!appliedViaVue) {
      activateElement(confirmButton);
    }

    try {
      if (sourceKey === SOURCE_KEYS.JOB51) {
        const refreshed = await waitForJob51AgeFilterRefresh(previousLastSearchAt, {
          minAge,
          maxAge,
          timeoutMs: 5000,
        });
        if (!refreshed) {
          setAutoAgeAttributes("failed", minAge, maxAge);
          console.warn(
            "🎯 [Auto Age] Applied 51job age filter, but no filtered search refresh was observed.",
            { minAge, maxAge },
          );
          return;
        }
      } else {
        await waitForExtractionData({ timeoutMs: 15000 });
      }
    } catch (error) {
      console.warn(
        "🎯 [Auto Age] Applied age filter, but waiting for results timed out:",
        error,
      );
    }

    setAutoAgeAttributes("done", minAge, maxAge);
  }

  // ── Province token helpers ──

  const PROVINCE_TOKENS = new Set([
    "北京",
    "天津",
    "上海",
    "重庆",
    "河北",
    "山西",
    "辽宁",
    "吉林",
    "黑龙江",
    "江苏",
    "浙江",
    "安徽",
    "福建",
    "江西",
    "山东",
    "河南",
    "湖北",
    "湖南",
    "广东",
    "海南",
    "四川",
    "贵州",
    "云南",
    "陕西",
    "甘肃",
    "青海",
    "台湾",
    "内蒙古",
    "广西",
    "西藏",
    "宁夏",
    "新疆",
    "香港",
    "澳门",
  ]);

  function normalizeProvinceToken(value) {
    if (!value) return "";
    return value
      .trim()
      .replace(/特别行政区$/g, "")
      .replace(/壮族自治区$/g, "")
      .replace(/回族自治区$/g, "")
      .replace(/维吾尔自治区$/g, "")
      .replace(/自治区$/g, "")
      .replace(/省$/g, "")
      .replace(/市$/g, "");
  }

  function isProvinceToken(value) {
    const normalized = normalizeProvinceToken(value);
    return normalized ? PROVINCE_TOKENS.has(normalized) : false;
  }

  // ── waitForSearchElements ──

  function waitForSearchElements({ timeoutMs = 8000 }: Record<string, unknown> = {}): Promise<{ input: Element; button: Element }> {
    const timeout = typeof timeoutMs === "number" ? timeoutMs : 8000;
    return new Promise((resolve, reject) => {
      let done = false;
      const deadline = Date.now() + timeout;

      const check = () => {
        if (done) return;
        const sourceKey = getCurrentSourceKey();
        const inputSel =
          sourceKey === SOURCE_KEYS.JOB51
            ? SELECTORS.job51SearchInput
            : SELECTORS.searchInput;
        const buttonSel =
          sourceKey === SOURCE_KEYS.JOB51
            ? SELECTORS.job51SearchButton
            : SELECTORS.searchButton;
        const input = doc.querySelector(inputSel);
        const button = doc.querySelector(buttonSel);
        if (input && button) {
          done = true;
          cleanup();
          resolve({ input, button });
        } else if (Date.now() > deadline) {
          done = true;
          cleanup();
          reject(new Error("Timed out waiting for search controls"));
        }
      };

      const cleanup = () => {
        clearInterval(intervalId);
        observer.disconnect();
      };

      const intervalId = setInterval(check, 300);
      const observer = new MutationObserver(check);
      observer.observe(doc.body || doc.documentElement, {
        childList: true,
        subtree: true,
      });
      check();
    });
  }

  // ── waitForAreaModal ──

  function waitForAreaModal({ timeoutMs = 8000 }: Record<string, unknown> = {}): Promise<Element> {
    const timeout = typeof timeoutMs === "number" ? timeoutMs : 8000;
    return new Promise((resolve, reject) => {
      let done = false;
      const deadline = Date.now() + timeout;

      const check = () => {
        if (done) return;
        const modal = doc.querySelector(SELECTORS.areaModal);
        if (modal && isElementVisible(modal)) {
          done = true;
          cleanup();
          resolve(modal);
        } else if (Date.now() > deadline) {
          done = true;
          cleanup();
          reject(new Error("Timed out waiting for area selector modal"));
        }
      };

      const cleanup = () => {
        clearInterval(intervalId);
        observer.disconnect();
      };

      const intervalId = setInterval(check, 300);
      const observer = new MutationObserver(check);
      observer.observe(doc.body || doc.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
      });
      check();
    });
  }

  // ── getAreaItemText ──

  function getAreaItemText(item: Element | null) {
    if (!item) return "";
    const source = item.querySelector("span") || item;
    const clone = source.cloneNode(true) as Element;
    clone.querySelectorAll(".select-num").forEach((node) => node.remove());
    return (
      (clone.textContent || "")
        .replace(/[\uE000-\uF8FF]/g, "")
        .replace(/\s+/g, " ")
        .trim()
    );
  }

  // ── findAreaItemByText ──

  function findAreaItemByText(container: Element | null, text: string) {
    if (!container || !text) return null;
    const target = text.replace(/\s+/g, " ").trim();
    const normalizedTarget = normalizeSeekLocationLabel(target);
    const itemSelector = `${SELECTORS.areaItem}, ${SELECTORS.areaDistrictItem}`;
    const items = container.querySelectorAll(itemSelector);
    let normalizedMatch = null;
    for (const item of items) {
      const itemText = getAreaItemText(item);
      if (itemText === target) return asHTMLElement(item);
      if (!normalizedMatch) {
        const normalizedItemText = normalizeSeekLocationLabel(itemText);
        if (
          normalizedTarget &&
          normalizedItemText &&
          (normalizedItemText === normalizedTarget ||
            normalizedItemText.includes(normalizedTarget) ||
            normalizedTarget.includes(normalizedItemText))
        ) {
          normalizedMatch = asHTMLElement(item);
        }
      }
    }
    return normalizedMatch;
  }

  // ── waitForAreaItems ──

  function waitForAreaItems(
    blockSelector: string,
    { timeoutMs = 5000, itemSelector }: Record<string, unknown> = {},
  ): Promise<{ block: Element; items: Element[] }> {
    const timeout = typeof timeoutMs === "number" ? timeoutMs : 5000;
    return new Promise((resolve, reject) => {
      let done = false;
      const deadline = Date.now() + timeout;
      const targetSelector =
        (typeof itemSelector === "string" && itemSelector) || `${SELECTORS.areaItem}, ${SELECTORS.areaDistrictItem}`;

      const check = () => {
        if (done) return;
        const block = doc.querySelector(blockSelector);
        const items = block ? block.querySelectorAll(targetSelector) : [];
        if (block && items.length > 0) {
          done = true;
          cleanup();
          resolve({ block, items: Array.from(items) });
        } else if (Date.now() > deadline) {
          done = true;
          cleanup();
          reject(
            new Error(`Timed out waiting for area items in ${blockSelector}`),
          );
        }
      };

      const cleanup = () => {
        clearInterval(intervalId);
        observer.disconnect();
      };

      const intervalId = setInterval(check, 300);
      const observer = new MutationObserver(check);
      observer.observe(doc.body || doc.documentElement, {
        childList: true,
        subtree: true,
      });
      check();
    });
  }

  // ── waitForAreaTrigger ──

  function waitForAreaTrigger({ timeoutMs = 8000 }: Record<string, unknown> = {}): Promise<HTMLElement> {
    const timeout = typeof timeoutMs === "number" ? timeoutMs : 8000;
    return new Promise((resolve, reject) => {
      let done = false;
      const deadline = Date.now() + timeout;

      const check = () => {
        if (done) return;
        const trigger = asHTMLElement(
          doc.querySelector(SELECTORS.areaTrigger),
        );
        if (trigger && isElementVisible(trigger)) {
          done = true;
          cleanup();
          resolve(trigger);
        } else if (Date.now() > deadline) {
          done = true;
          cleanup();
          reject(new Error("Timed out waiting for area trigger"));
        }
      };

      const cleanup = () => {
        clearInterval(intervalId);
        observer.disconnect();
      };

      const intervalId = setInterval(check, 300);
      const observer = new MutationObserver(check);
      observer.observe(doc.body || doc.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
      });
      check();
    });
  }

  // ── setAutoSearchAttributes ──

  function setAutoSearchAttributes(status: string, keyword?: string) {
    try {
      doc.documentElement.setAttribute("data-tr-auto-search", status);
      if (keyword) {
        doc.documentElement.setAttribute("data-tr-search-keyword", keyword);
      } else {
        doc.documentElement.removeAttribute("data-tr-search-keyword");
      }
    } catch (e) {
      console.warn("[tr-auto-actions]", "setAutoSearchAttributes: DOM attribute set failed", e?.message || e);
    }
  }

  // ── setAutoLocationAttributes ──

  function setAutoLocationAttributes(status: string, location?: string) {
    try {
      doc.documentElement.setAttribute("data-tr-auto-location", status);
      if (location) {
        doc.documentElement.setAttribute("data-tr-location-value", location);
      } else {
        doc.documentElement.removeAttribute("data-tr-location-value");
      }
    } catch (e) {
      console.warn("[tr-auto-actions]", "setAutoLocationAttributes: DOM attribute set failed", e?.message || e);
    }
  }

  // ── canSkipAutoLocationForSeekPage ──

  function canSkipAutoLocationForSeekPage() {
    if (getCurrentSourceKey() !== SOURCE_KEYS.SEEK) return false;
    return win.location.pathname.includes("/candidates/recommended");
  }

  // ── autoSelectLocation ──

  async function autoSelectLocation() {
    const params = new URLSearchParams(win.location.search || "");
    const locationRaw = (params.get(AUTO_LOCATION_PARAM) || "").trim();
    const parsedLocations = parseAutoLocationValues(locationRaw);

    if (parsedLocations.length === 0) {
      setAutoLocationAttributes("skipped", "");
      return;
    }

    console.log("🎯 [Auto Location] Selecting locations:", parsedLocations);

    let modal = doc.querySelector(SELECTORS.areaModal);
    if (!isElementVisible(modal)) {
      let trigger;
      try {
        trigger = await waitForAreaTrigger({});
      } catch {
        if (canSkipAutoLocationForSeekPage()) {
          setAutoLocationAttributes("skipped", locationRaw);
          console.warn(
            "🎯 [Auto Location] Trigger not found; skipping on SEEK recommended page",
          );
        } else {
          setAutoLocationAttributes("failed", locationRaw);
          console.warn("🎯 [Auto Location] Trigger not found");
        }
        return;
      }
      trigger.click();
      try {
        modal = await waitForAreaModal({});
      } catch (error) {
        if (canSkipAutoLocationForSeekPage()) {
          setAutoLocationAttributes("skipped", locationRaw);
          console.warn(
            "🎯 [Auto Location] Area selector not ready; skipping on SEEK recommended page:",
            error,
          );
        } else {
          setAutoLocationAttributes("failed", locationRaw);
          console.warn("🎯 [Auto Location] Area selector not ready:", error);
        }
        return;
      }
    }

    const provinceBlock = modal.querySelector(SELECTORS.areaProvinceBlock);
    const confirmBtn = asHTMLElement(
      modal.querySelector(SELECTORS.areaConfirmBtn),
    );
    const cancelBtn = asHTMLElement(modal.querySelector(SELECTORS.areaCancelBtn));
    if (!provinceBlock || !confirmBtn || !cancelBtn) {
      if (canSkipAutoLocationForSeekPage()) {
        setAutoLocationAttributes("skipped", locationRaw);
        console.warn(
          "🎯 [Auto Location] Missing modal controls; skipping on SEEK recommended page",
        );
      } else {
        setAutoLocationAttributes("failed", locationRaw);
        console.warn("🎯 [Auto Location] Missing modal controls");
      }
      return;
    }
    const locationsToSelect = parsedLocations.filter((location, index) => {
      const next = parsedLocations[index + 1];
      return !(next && isProvinceToken(location) && !isProvinceToken(next));
    });

    const selectAllDistrictAndConfirm = async (loc) => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      const { block: districtBlock } = await waitForAreaItems(
        SELECTORS.areaDistrictBlock,
        {
          itemSelector: SELECTORS.areaDistrictItem,
          timeoutMs: 5000,
        },
      );
      const districtItems = Array.from(
        districtBlock.querySelectorAll(SELECTORS.areaDistrictItem),
      );
      const selectAllDistrict =
        findAreaItemByText(districtBlock, `全${loc}`) ||
        asHTMLElement(
          districtItems.find((item) => getAreaItemText(item).startsWith("全")) ||
            null,
        );
      if (!selectAllDistrict) return false;
      selectAllDistrict.click();
      return true;
    };

    const tryCityFlow = async (loc) => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      const { block: cityBlock } = await waitForAreaItems(
        SELECTORS.areaCityBlock,
        {
          itemSelector: SELECTORS.areaItem,
          timeoutMs: 5000,
        },
      );
      const cityMatch = findAreaItemByText(cityBlock, loc);
      if (!cityMatch) return false;
      cityMatch.click();

      if (cityMatch.textContent.trim().startsWith("全")) {
        return true;
      }

      return await selectAllDistrictAndConfirm(loc);
    };

    // Keep track of which locations we've successfully selected
    const successLocations = [];
    const failedLocations = [];

    for (const location of locationsToSelect) {
      let found = false;
      const provinceMatch = findAreaItemByText(provinceBlock, location);

      if (provinceMatch) {
        provinceMatch.click();
        await new Promise((resolve) => setTimeout(resolve, 300));
        try {
          const { block: cityBlock } = await waitForAreaItems(
            SELECTORS.areaCityBlock,
            {
              itemSelector: SELECTORS.areaItem,
              timeoutMs: 5000,
            },
          );
          const cityItems = Array.from(
            cityBlock.querySelectorAll(SELECTORS.areaItem),
          );
          const selectAllCity =
            findAreaItemByText(cityBlock, `全${location}`) ||
            findAreaItemByText(cityBlock, location) ||
            asHTMLElement(
              cityItems.find((item) => getAreaItemText(item).startsWith("全")) ||
                null,
            );
          if (selectAllCity) {
            selectAllCity.click();
            if (selectAllCity.textContent.trim().startsWith("全")) {
              found = true;
            } else if (await selectAllDistrictAndConfirm(location)) {
              found = true;
            }
          }
        } catch {
          // Continue to city-level fallback.
        }
      }

      if (!found) {
        const hotCities = findAreaItemByText(provinceBlock, "热门城市");
        if (hotCities) {
          hotCities.click();
          try {
            if (await tryCityFlow(location)) {
              found = true;
            }
          } catch {
            // Continue to province scan fallback.
          }
        }
      }

      if (!found) {
        const provinceItems = Array.from(
          provinceBlock.querySelectorAll(SELECTORS.areaItem),
        );
        for (const province of provinceItems) {
          const hotCities = findAreaItemByText(provinceBlock, "热门城市");
          if (hotCities && province === hotCities) continue;
          const provinceEl = asHTMLElement(province);
          if (!provinceEl) continue;
          provinceEl.click();
          try {
            if (await tryCityFlow(location)) {
              found = true;
              break;
            }
          } catch {
            // Continue scanning other provinces.
          }
        }
      }

      if (found) {
        successLocations.push(location);
      } else {
        failedLocations.push(location);
        console.warn("🎯 [Auto Location] Location not found:", location);
      }
    }

    // Final confirmation step
    if (successLocations.length > 0) {
      confirmBtn.click();
      setAutoLocationAttributes("done", successLocations.join(","));
    } else {
      cancelBtn.click();
      if (canSkipAutoLocationForSeekPage()) {
        setAutoLocationAttributes("skipped", locationRaw);
      } else {
        setAutoLocationAttributes("failed", locationRaw);
      }
    }
  }

  // ── autoSearchFromUrl ──

  async function autoSearchFromUrl() {
    const params = new URLSearchParams(win.location.search || "");
    const urlKeywordMode = params.get(AUTO_KEYWORD_MODE_PARAM);
    const keywordMode = normalizeKeywordMode(
      urlKeywordMode || (await getKeywordMode()),
    );
    let keyword = normalizeKeyword(params.get(AUTO_SEARCH_PARAM) || "");
    if (keyword && keywordMode !== KEYWORD_MODE_SPACED) {
      keyword = keyword.replace(/\s+/g, "");
    }
    if (!keyword) {
      setAutoSearchAttributes("skipped", "");
      return;
    }

    let input;
    let button;
    try {
      ({ input, button } = await waitForSearchElements());
    } catch (error) {
      console.warn("🎯 [Auto Search] Search controls not ready:", error);
      setAutoSearchAttributes("skipped", keyword);
      return;
    }

    let currentValue = normalizeKeyword(input.value || "");
    if (keywordMode !== KEYWORD_MODE_SPACED) {
      currentValue = currentValue.replace(/\s+/g, "");
    }
    const shouldForceJob51Search =
      getCurrentSourceKey() === SOURCE_KEYS.JOB51 &&
      currentValue === keyword &&
      !hasJob51SearchSnapshot() &&
      isJob51EmptySearchPromptVisible();
    if (currentValue === keyword && !shouldForceJob51Search) {
      setAutoSearchAttributes("skipped", keyword);
      return;
    }

    console.log(
      "🎯 [Auto Search] Searching for:",
      keyword,
      `(mode=${keywordMode})`,
    );
    setInputValue(input, keyword);
    button.click();
    setAutoSearchAttributes("done", keyword);

    try {
      const count = await waitForExtractionData({});
      console.log("🎯 [Auto Search] Done, found", count, "results");
    } catch (error) {
      console.warn(
        "🎯 [Auto Search] Search triggered, waiting for results timed out:",
        error,
      );
    }
  }

  // ── autoExportTriggered (module-level flag, moved inline) ──

  let autoExportTriggered = false;

  // ── normalizeCardText ──

  function normalizeCardText(text) {
    if (!text) return "";
    return text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .join("\n");
  }

  // ── rawToMarkdown ──

  function rawToMarkdown(rawPayload) {
    const lines = [];
    lines.push("# Resume Dump (Raw)");
    lines.push("");
    lines.push(`- URL: ${rawPayload.url}`);
    lines.push(`- Extracted: ${rawPayload.extractedAt}`);
    lines.push(`- Count: ${rawPayload.count}`);
    lines.push("");

    rawPayload.cards.forEach((card, idx) => {
      const indexLabel = String(idx + 1).padStart(2, "0");
      lines.push(`## Card ${indexLabel}`);
      if (card.resumeId || card.perUserId) {
        lines.push(`- resumeId: ${card.resumeId || ""}`);
        lines.push(`- perUserId: ${card.perUserId || ""}`);
        lines.push("");
      }
      lines.push("```text");
      const normalized = normalizeCardText(card.text);
      lines.push(normalized || "(empty)");
      lines.push("```");
      lines.push("");
    });

    return lines.join("\n");
  }

  // ── resumesToCSV ──

  function resumesToCSV(resumes) {
    if (resumes.length === 0) return "";

    const headers = [
      "序号",
      "resumeId",
      "perUserId",
      "姓名",
      "年龄",
      "工作经验",
      "学历",
      "所在地",
      "自我评价",
      "期望薪资",
      "活跃状态",
      "求职意向",
      "简历链接",
      "提取时间",
    ];
    const rows = resumes.map((r, i) =>
      [
        i + 1,
        r.resumeId || "",
        r.perUserId || "",
        r.name,
        r.age,
        r.experience,
        r.education,
        r.location,
        r.selfIntro,
        r.expectedSalary,
        r.activityStatus,
        r.jobIntention?.replace(/,/g, ";").substring(0, 100),
        r.profileUrl,
        r.extractedAt,
      ]
        .map((cell) => `"${String(cell || "").replace(/"/g, '""')}"`)
        .join(","),
    );

    return [headers.join(","), ...rows].join("\n");
  }

  // ── makeRandomId ──

  function makeRandomId() {
    try {
      if (globalThis.crypto?.randomUUID)
        return globalThis.crypto.randomUUID().split("-")[0];
    } catch {
      // ignore
    }
    return Math.random().toString(16).slice(2, 10);
  }

  // ── downloadFile ──

  async function downloadFile(content, filename, mimeType, saveAs = false) {
    const response = await chrome.runtime.sendMessage({
      action: "downloadFile",
      content: content,
      filename: filename,
      mimeType: mimeType,
      saveAs: !!saveAs,
    });
    if (response?.success) return response;
    throw new Error(response?.error || "Download failed");
  }

  // ── getExtensionVersion ──

  function getExtensionVersion() {
    try {
      return chrome?.runtime?.getManifest?.().version || SOURCE_KEYS.UNKNOWN;
    } catch (e) {
      console.warn("[tr-auto-actions]", "getExtensionVersion: chrome.runtime.getManifest failed", e?.message || e);
      return SOURCE_KEYS.UNKNOWN;
    }
  }

  // ── parseAutoExportMode ──

  function parseAutoExportMode(value: string | undefined): Record<string, boolean> {
    if (!value) return { enabled: false };
    const mode = String(value).trim().toLowerCase();
    if (!mode) return { enabled: false };

    const config = {
      enabled: true,
      logStructured: false,
      logRaw: false,
      downloadCsv: false,
      downloadJson: false,
      downloadRawJson: false,
      downloadMarkdown: false,
      saveAs: false,
      rawIncludePage: false,
    };

    if (mode === "1" || mode === "true") {
      config.downloadMarkdown = true;
      return config;
    }
    if (mode === "console" || mode === "log") {
      config.logStructured = true;
      return config;
    }
    if (mode === "csv") {
      config.downloadCsv = true;
      return config;
    }
    if (mode === "json") {
      config.downloadJson = true;
      return config;
    }
    if (mode === "both" || mode === "all") {
      config.downloadCsv = true;
      config.downloadJson = mode === "all";
      config.logStructured = true;
      return config;
    }
    if (mode === "raw") {
      config.logRaw = true;
      return config;
    }
    if (mode === "raw_json" || mode === "rawjson") {
      config.downloadRawJson = true;
      return config;
    }
    if (mode === "md" || mode === "markdown") {
      config.downloadMarkdown = true;
      return config;
    }

    const tokens = mode
      .split(/[,+|]/)
      .map((token) => token.trim())
      .filter(Boolean);

    for (const token of tokens) {
      if (token === "console" || token === "log") config.logStructured = true;
      if (token === "csv") config.downloadCsv = true;
      if (token === "json") config.downloadJson = true;
      if (token === "raw") config.logRaw = true;
      if (token === "rawjson" || token === "raw_json")
        config.downloadRawJson = true;
      if (token === "md" || token === "markdown") config.downloadMarkdown = true;
      if (token === "page" || token === "rawpage") config.rawIncludePage = true;
      if (token === "saveas") config.saveAs = true;
    }

    if (
      !config.logStructured &&
      !config.logRaw &&
      !config.downloadCsv &&
      !config.downloadJson &&
      !config.downloadRawJson &&
      !config.downloadMarkdown
    ) {
      config.downloadMarkdown = true;
    }

    return config;
  }

  // ── getAutoExportConfig ──

  function getAutoExportConfig() {
    const params = new URLSearchParams(win.location.search || "");
    const paramValue = params.get(AUTO_EXPORT_PARAM);
    if (paramValue) return parseAutoExportMode(paramValue);

    try {
      const localValue = win.localStorage?.getItem(AUTO_EXPORT_PARAM);
      return parseAutoExportMode(localValue);
    } catch (e) {
      console.warn("[tr-auto-actions]", "getAutoExportConfig: localStorage access failed", e?.message || e);
      return { enabled: false };
    }
  }

  // ── parseAutoSyncFlag ──

  function parseAutoSyncFlag(value) {
    if (!value) return false;
    const normalized = String(value).trim().toLowerCase();
    return (
      normalized === "1" ||
      normalized === "true" ||
      normalized === "yes" ||
      normalized === "on"
    );
  }

  // ── getAutoSyncEnabled ──

  function getAutoSyncEnabled() {
    const params = new URLSearchParams(win.location.search || "");
    if (params.has(AUTO_SYNC_PARAM)) {
      return parseAutoSyncFlag(params.get(AUTO_SYNC_PARAM));
    }

    try {
      const captured = sessionStorage.getItem("tr_auto_sync_captured");
      if (captured !== null) {
        return parseAutoSyncFlag(captured);
      }
    } catch {
      // sessionStorage may not be available in all contexts
    }

    try {
      const localValue = win.localStorage?.getItem(AUTO_SYNC_PARAM);
      return parseAutoSyncFlag(localValue);
    } catch (e) {
      console.warn("[tr-auto-actions]", "getAutoSyncEnabled: localStorage access failed", e?.message || e);
      return false;
    }
  }



  async function runAutoExportIfEnabled() {
    if (autoExportTriggered) return;
    const config = getAutoExportConfig();
    if (!config.enabled) return;
    autoExportTriggered = true;

    try {
      await waitForExtractionData({});
      const resumes = extractResumes();
      if (config.logStructured) {
        console.log("🎯 [Auto Export] Extracted resumes", {
          count: resumes.length,
          resumes,
        });
      }

      try {
        doc.documentElement.setAttribute("data-tr-auto-export", "done");
        doc.documentElement.setAttribute(
          "data-tr-auto-export-count",
          String(resumes.length),
        );
      } catch (e) {
        console.warn("[tr-auto-actions]", "runAutoExportIfEnabled: DOM attribute set failed", e?.message || e);
      }

      let rawPayload = null;
      if (
        config.logRaw ||
        config.downloadRawJson ||
        config.downloadMarkdown ||
        config.rawIncludePage
      ) {
        rawPayload = extractResumesRaw({ includePage: config.rawIncludePage });
        if (config.logRaw) {
          console.log("🎯 [Auto Export] Raw resumes", rawPayload);
        }
        if (config.downloadRawJson) {
          const timestamp = new Date().toISOString().slice(0, 10);
          const filename = `resumes_raw_${timestamp}_${makeRandomId()}.json`;
          await downloadFile(
            JSON.stringify(rawPayload, null, 2),
            filename,
            "application/json",
            config.saveAs,
          );
          console.log("🎯 [Auto Export] Raw JSON download triggered:", filename);
        }
        if (config.downloadMarkdown) {
          const markdown = rawToMarkdown(rawPayload);
          const timestamp = new Date().toISOString().slice(0, 10);
          const filename = `resumes_md_${timestamp}_${makeRandomId()}.md`;
          await downloadFile(markdown, filename, "text/markdown", config.saveAs);
          console.log("🎯 [Auto Export] Markdown download triggered:", filename);
        }
      }

      if (config.downloadCsv) {
        const csv = resumesToCSV(resumes);
        const timestamp = new Date().toISOString().slice(0, 10);
        const filename = `resumes_${timestamp}_${makeRandomId()}.csv`;
        await downloadFile(csv, filename, "text/csv", config.saveAs);
        console.log("🎯 [Auto Export] CSV download triggered:", filename);
      }

      if (config.downloadJson) {
        const metadata = buildExportMetadata(resumes);
        const payload = { metadata, data: resumes };
        const json = JSON.stringify(payload, null, 2);
        const filename = buildExportFilename();
        await downloadFile(json, filename, "application/json", config.saveAs);
        console.log("🎯 [Auto Export] JSON download triggered:", filename);
      }
    } catch (error) {
      console.warn("🎯 [Auto Export] Failed:", error);
      try {
        doc.documentElement.setAttribute("data-tr-auto-export", "failed");
      } catch (e) {
        console.warn("[tr-auto-actions]", "runAutoExportIfEnabled: fallback attribute set failed", e?.message || e);
      }
    }
  }

  // ── syncCurrentPageToServer ──

  async function applyCurrentSourceCollectionGuards(resumes: unknown[]): Promise<unknown[]> {
    if (!Array.isArray(resumes) || resumes.length === 0) return resumes;
    const sourceKey = getCurrentSourceKey();
    if (
      sourceKey !== SOURCE_KEYS.JOB51 &&
      sourceKey !== SOURCE_KEYS.JOB5156 &&
      sourceKey !== SOURCE_KEYS.SEEK
    ) {
      return resumes;
    }
    const collectionGuards = await loadCollectionGuards();
    const guards =
      collectionGuards && typeof collectionGuards === "object"
        ? (collectionGuards as Record<string, unknown>)[sourceKey]
        : undefined;
    const guardFields = parseGuardFieldNames(typeof guards === "string" ? guards : "");
    if (guardFields.length === 0) return resumes;
    return resumes.map((resume) => applyCollectionGuards(resume, guardFields));
  }

  async function syncCurrentPageToServer(resumesOverride) {
    let resumes = Array.isArray(resumesOverride)
      ? resumesOverride
      : extractResumes();
    const shouldEnrichFromCurrentPage = !Array.isArray(resumesOverride);
    if (
      shouldEnrichFromCurrentPage &&
      getCurrentSourceKey() === SOURCE_KEYS.JOB51 &&
      !isJob51DetailPage() &&
      resumes.length > 0
    ) {
      resumes = await enrich51JobSearchResumesWithDetail(resumes);
    }
    if (
      shouldEnrichFromCurrentPage &&
      getCurrentSourceKey() === SOURCE_KEYS.JOB5156 &&
      !isJob5156DetailPage() &&
      resumes.length > 0
    ) {
      resumes = await enrichJob5156SearchResumesWithDetail(resumes);
    }
    if (
      shouldEnrichFromCurrentPage &&
      getCurrentSourceKey() === SOURCE_KEYS.SEEK &&
      !isSeekProfileMode() &&
      resumes.length > 0
    ) {
      resumes = await enrichSeekResumesWithDetail(resumes);
    }
    resumes = await applyCurrentSourceCollectionGuards(resumes);
    const metadata = buildSubmitMetadata({
      seekCaptureMode:
        Array.isArray(resumesOverride) &&
        win.location.pathname.includes("/candidates/recommended")
          ? "graphql-list"
          : undefined,
    });
    return chrome.runtime.sendMessage({
      action: "syncToServer",
      metadata,
      resumes,
    });
  }

  // ── resolveAutoSyncErrorStatus ──

  function resolveAutoSyncErrorStatus(errorLike) {
    const rawError =
      typeof errorLike === "string"
        ? errorLike
        : errorLike?.error || errorLike?.message || String(errorLike || "");
    const message = String(rawError).trim() || "Unknown error";
    const lowerMessage = message.toLowerCase();

    if (
      message.includes("搜索访问太快") ||
      message.includes("60分钟后再试")
    ) {
      return {
        message: "51job 已触发访问限制",
        hint: "扩展已停止自动翻页。至少等待60分钟后重试，并保持小页数、小批量。",
      };
    }

    if (message === "Server token not configured") {
      return {
        message: "Token 未配置",
        hint: "点击此提示打开扩展设置并填写 Token",
      };
    }

    if (message.includes("401") || lowerMessage.includes("unauthorized")) {
      return {
        message: "认证失败 - Token 无效或已过期",
        hint: "点击此提示打开扩展设置并更新 Token",
      };
    }

    if (message === "Server URL not configured") {
      return {
        message: "服务器地址未配置",
        hint: "点击此提示打开扩展设置并填写服务器地址",
      };
    }

    if (
      lowerMessage.includes("failed to fetch") ||
      lowerMessage.includes("networkerror") ||
      lowerMessage.includes("network error") ||
      lowerMessage.includes("err_network") ||
      lowerMessage.includes("load failed") ||
      lowerMessage.includes("connection")
    ) {
      return {
        message: "无法连接服务器",
        hint: "请检查网络连接和服务器状态后重试",
      };
    }

    return {
      message: `同步失败: ${message}`,
      hint: "点击此提示打开扩展设置排查问题",
    };
  }

  // ── resolveAutoSyncStopReason ──

  function resolveAutoSyncStopReason(errorLike) {
    const rawError =
      typeof errorLike === "string"
        ? errorLike
        : errorLike?.error || errorLike?.message || String(errorLike || "");
    const message = String(rawError).trim();
    if (
      message.includes("搜索访问太快") ||
      message.includes("60分钟后再试")
    ) {
      return "job51-rate-limited";
    }
    return "failed";
  }

  return {
    findAgeFilterBlock,
    openAgeFilterDropdown,
    resolveAgeSelectBox,
    waitForAgeFilterDropdown,
    resolveAgeFilterActions,
    autoApplyAgeFilterFromUrl,
    setAutoAgeAttributes,
    autoSelectLocation,
    autoSearchFromUrl,
    normalizeCardText,
    rawToMarkdown,
    resumesToCSV,
    makeRandomId,
    downloadFile,
    getExtensionVersion,
    parseAutoExportMode,
    getAutoExportConfig,
    parseAutoSyncFlag,
    getAutoSyncEnabled,
    runAutoExportIfEnabled,
    syncCurrentPageToServer,
    resolveAutoSyncErrorStatus,
    resolveAutoSyncStopReason,
  };
}
