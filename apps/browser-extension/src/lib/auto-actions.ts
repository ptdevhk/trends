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

  return {
    findAgeFilterBlock,
    openAgeFilterDropdown,
    resolveAgeSelectBox,
    waitForAgeFilterDropdown,
    resolveAgeFilterActions,
    autoApplyAgeFilterFromUrl,
  };
}
