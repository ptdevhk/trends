// @ts-nocheck
/**
 * Auto-actions — automatic age filter, location, search, export, and sync
 * orchestration. Dependencies injected from content.ts.
 *
 * Created as Phase 4 of content.ts extraction.
 */

export function createAutoActions(deps) {
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
    document: doc,
    window: win,
  } = deps;

  // ── setAutoAgeAttributes ──

  function setAutoAgeAttributes(status, minAge, maxAge) {
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
    } catch {
      // ignore
    }
  }

  // ── findAgeFilterBlock ──

  function findAgeFilterBlock() {
    if (getCurrentSourceKey() === SOURCE_KEYS.JOB51) {
      const labels = doc.querySelectorAll(".base-select-label");
      const label = Array.from(labels).find(
        (node) => (node.textContent || "").replace(/\s+/g, "").trim() === "年龄",
      );
      if (label) {
        return (
          label.closest(".el-popover__reference") ||
          label.closest(".base-select-button") ||
          label.closest(".el-popover__reference-wrapper")
        );
      }
    }

    const titles = doc.querySelectorAll(".base-input-block__title__text");
    const label = Array.from(titles).find(
      (node) => (node.textContent || "").replace(/\s+/g, "").trim() === "年龄",
    );
    return label ? label.closest(".base-input-block") : null;
  }

  // ── openAgeFilterDropdown ──

  function openAgeFilterDropdown(ageBlock) {
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

  function resolveAgeSelectBox(ageBlock) {
    return getCurrentSourceKey() === SOURCE_KEYS.JOB51
      ? resolveJob51AgeFilterDropdown(ageBlock)
      : ageBlock.querySelector(".base-input-block__select_box");
  }

  // ── waitForAgeFilterDropdown ──

  async function waitForAgeFilterDropdown(ageBlock, { timeoutMs = 4000 } = {}) {
    const deadline = Date.now() + timeoutMs;
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

  function resolveAgeFilterActions(selectBox) {
    const minInput = selectBox.querySelector('input[placeholder="最低"]');
    const maxInput = selectBox.querySelector('input[placeholder="最高"]');
    const buttons = Array.from(selectBox.querySelectorAll("button"));
    const confirmButton = buttons.find((button) => {
      const text = (button.textContent || "").replace(/\s+/g, "").trim();
      return text === "确定" || text === "確定";
    });
    const cancelButton = buttons.find((button) => {
      const text = (button.textContent || "").replace(/\s+/g, "").trim();
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
      await ensureJob51AgeCustomRangeInputs(selectBox, {
        timeoutMs: 2500,
      });
    }

    const { minInput, maxInput, confirmButton, cancelButton } =
      resolveAgeFilterActions(selectBox);
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

  function waitForSearchElements({ timeoutMs = 8000 } = {}) {
    return new Promise((resolve, reject) => {
      let done = false;
      const deadline = Date.now() + timeoutMs;

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

  function waitForAreaModal({ timeoutMs = 8000 } = {}) {
    return new Promise((resolve, reject) => {
      let done = false;
      const deadline = Date.now() + timeoutMs;

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

  function getAreaItemText(item) {
    if (!item) return "";
    const source = item.querySelector("span") || item;
    const clone = source.cloneNode(true);
    clone.querySelectorAll(".select-num").forEach((node) => node.remove());
    return (
      (clone.textContent || "")
        .replace(/[\uE000-\uF8FF]/g, "")
        .replace(/\s+/g, " ")
        .trim()
    );
  }

  // ── findAreaItemByText ──

  function findAreaItemByText(container, text) {
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
    blockSelector,
    { timeoutMs = 5000, itemSelector } = {},
  ) {
    return new Promise((resolve, reject) => {
      let done = false;
      const deadline = Date.now() + timeoutMs;
      const targetSelector =
        itemSelector || `${SELECTORS.areaItem}, ${SELECTORS.areaDistrictItem}`;

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

  function waitForAreaTrigger({ timeoutMs = 8000 } = {}) {
    return new Promise((resolve, reject) => {
      let done = false;
      const deadline = Date.now() + timeoutMs;

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

  function setAutoSearchAttributes(status, keyword) {
    try {
      doc.documentElement.setAttribute("data-tr-auto-search", status);
      if (keyword) {
        doc.documentElement.setAttribute("data-tr-search-keyword", keyword);
      } else {
        doc.documentElement.removeAttribute("data-tr-search-keyword");
      }
    } catch {
      // ignore
    }
  }

  // ── setAutoLocationAttributes ──

  function setAutoLocationAttributes(status, location) {
    try {
      doc.documentElement.setAttribute("data-tr-auto-location", status);
      if (location) {
        doc.documentElement.setAttribute("data-tr-location-value", location);
      } else {
        doc.documentElement.removeAttribute("data-tr-location-value");
      }
    } catch {
      // ignore
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

  return {
    findAgeFilterBlock,
    openAgeFilterDropdown,
    resolveAgeSelectBox,
    waitForAgeFilterDropdown,
    resolveAgeFilterActions,
    autoApplyAgeFilterFromUrl,
    autoSelectLocation,
    autoSearchFromUrl,
  };
}
