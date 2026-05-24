// @ts-nocheck
import type { Selectors } from "./types";

export interface PaginationInfo {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  hasNextPage: boolean;
}

export interface NextPageButtonState {
  exists: boolean;
  text?: string;
  href?: string;
  className?: string;
  disabledAttr?: string;
  ariaDisabled?: string;
  isDisabledClass?: boolean;
  isIsDisabledClass?: boolean;
  source?: string;
  currentPage?: number;
  totalPages?: number;
  hasNextPage?: boolean;
}

export interface PaginationUtilsDeps {
  getCurrentSourceKey: () => string;
  SOURCE_KEYS: Record<string, string>;
  isJob51DetailPage: () => boolean;
  isJob5156DetailPage: () => boolean;
  isJob51DetailReady: () => boolean;
  isJob5156DetailReady: () => boolean;
  getSeekPaginationInfo: () => PaginationInfo;
  getSeekNextPageLinkForMode: () => HTMLElement | null;
  getCurrentSeekMode: () => string;
  apiSnapshot: {
    job51LastSearchRequest?: any;
    job51Total?: number;
    job51SearchRows?: any[];
  };
  normalizeOptionalPositiveInt: (val: any) => number | undefined;
  doc: Document;
  win: Window;
  SELECTORS: Selectors;
}

export function createPaginationUtils(deps: PaginationUtilsDeps) {
  const {
    getCurrentSourceKey,
    SOURCE_KEYS,
    isJob51DetailPage,
    isJob5156DetailPage,
    isJob51DetailReady,
    isJob5156DetailReady,
    getSeekPaginationInfo,
    getSeekNextPageLinkForMode,
    getCurrentSeekMode,
    apiSnapshot,
    normalizeOptionalPositiveInt,
    doc,
    win,
    SELECTORS,
  } = deps;

  function getPaginationInfo(): PaginationInfo {
    const sourceKey = getCurrentSourceKey();
    if (sourceKey === SOURCE_KEYS.SEEK) {
      return getSeekPaginationInfo();
    }

    if (isJob51DetailPage()) {
      return {
        currentPage: 1,
        totalPages: 1,
        totalItems: isJob51DetailReady() ? 1 : 0,
        hasNextPage: false,
      };
    }

    if (sourceKey === SOURCE_KEYS.JOB51) {
      // 51job eHire uses infinite scroll, not Element UI pagination.
      // Derive current page from the captured API request's page_index.
      const req = apiSnapshot.job51LastSearchRequest;
      const currentPage =
        normalizeOptionalPositiveInt(
          req?.page_index ?? req?.pageIndex ?? req?.pageno,
        ) || 1;
      const pageSize =
        normalizeOptionalPositiveInt(
          req?.page_size ?? req?.pageSize ?? req?.pagesize,
        ) || 50;
      const total =
        typeof apiSnapshot.job51Total === "number" && apiSnapshot.job51Total > 0
          ? apiSnapshot.job51Total
          : 0;
      const hasData =
        Array.isArray(apiSnapshot.job51SearchRows) &&
        apiSnapshot.job51SearchRows.length > 0;
      let totalPages = currentPage;
      if (total > 0) {
        totalPages = Math.ceil(total / pageSize);
      } else if (hasData) {
        totalPages = currentPage + 1;
      }
      return {
        currentPage,
        totalPages,
        totalItems: total,
        hasNextPage: total > 0 ? currentPage < totalPages : (hasData && currentPage < totalPages),
      };
    }

    if (isJob5156DetailPage()) {
      return {
        currentPage: 1,
        totalPages: 1,
        totalItems: isJob5156DetailReady() ? 1 : 0,
        hasNextPage: false,
      };
    }

    const pagination = doc.querySelector(SELECTORS.pagination);
    if (!pagination)
      return { currentPage: 1, totalPages: 1, totalItems: 0, hasNextPage: false };

    const totalText = pagination.textContent || "";
    const totalMatch = totalText.match(/\u5171\s*([\d,\uff0c]+)\s*\u6761/);
    const totalItems = totalMatch
      ? Number.parseInt(String(totalMatch[1]).replace(/[\uff0c,]/g, ""), 10) || 0
      : 0;

    const activePage = pagination.querySelector(
      ".is-active, .active, .el-pager li.active",
    );
    const currentPage = activePage
      ? Number.parseInt(activePage.textContent || "", 10) || 1
      : 1;

    const pagerItems = Array.from(pagination.querySelectorAll(".el-pager li"));
    const pageNumbers = pagerItems
      .map((item) => Number.parseInt(item.textContent || "", 10))
      .filter((value) => Number.isFinite(value) && value > 0);
    const totalPagesFromPager =
      pageNumbers.length > 0 ? Math.max(...pageNumbers) : 0;
    const totalPagesFromTotal = totalItems > 0 ? Math.ceil(totalItems / 20) : 0;
    const totalPages = Math.max(
      totalPagesFromTotal,
      totalPagesFromPager,
      currentPage,
    );

    return {
      currentPage,
      totalPages,
      totalItems,
      hasNextPage: totalPages > currentPage,
    };
  }

  function getNextPageButtonState(): NextPageButtonState {
    const sourceKey = getCurrentSourceKey();
    if (sourceKey === SOURCE_KEYS.SEEK) {
      const nextBtn = getSeekNextPageLinkForMode();
      if (!nextBtn) {
        return {
          exists: false,
        };
      }
      return {
        exists: true,
        text: nextBtn.textContent || "",
        href: nextBtn.getAttribute("href") || "",
        className: nextBtn.className || "",
        disabledAttr: nextBtn.getAttribute("disabled") || "",
        ariaDisabled: nextBtn.getAttribute("aria-disabled") || "",
        isDisabledClass: nextBtn.classList.contains("disabled"),
        isIsDisabledClass: nextBtn.classList.contains("is-disabled"),
      };
    }
    if (sourceKey === SOURCE_KEYS.JOB51) {
      const pagination = getPaginationInfo();
      return {
        exists: pagination.hasNextPage,
        source: "51job-api",
        currentPage: pagination.currentPage,
        totalPages: pagination.totalPages,
        hasNextPage: pagination.hasNextPage,
      };
    }
    const nextBtn = doc.querySelector(SELECTORS.nextPageBtn);
    if (!nextBtn) {
      return {
        exists: false,
      };
    }
    return {
      exists: true,
      text: nextBtn.textContent || "",
      href: nextBtn.getAttribute("href") || "",
      className: nextBtn.className || "",
      disabledAttr: nextBtn.getAttribute("disabled") || "",
      ariaDisabled: nextBtn.getAttribute("aria-disabled") || "",
      isDisabledClass: nextBtn.classList.contains("disabled"),
      isIsDisabledClass: nextBtn.classList.contains("is-disabled"),
    };
  }

  function waitForPagination({ timeoutMs = 8000 }: { timeoutMs?: number } = {}): Promise<boolean> {
    // Job51 uses infinite scroll - no pagination controls to wait for
    if (getCurrentSourceKey() === SOURCE_KEYS.JOB51) {
      return Promise.resolve(true);
    }

    return new Promise((resolve, reject) => {
      let done = false;
      const deadline = Date.now() + timeoutMs;

      const check = () => {
        if (done) return;
        const isSeek = getCurrentSourceKey() === SOURCE_KEYS.SEEK;
        const seekTalentSearch = isSeek && getCurrentSeekMode() === "talentsearch";
        const pagination = doc.querySelector(
          isSeek
            ? (seekTalentSearch
                ? SELECTORS.seekTalentSearchPagination
                : SELECTORS.seekPagination)
            : SELECTORS.pagination,
        );
        const nextBtn = isSeek
          ? getSeekNextPageLinkForMode()
          : doc.querySelector(SELECTORS.nextPageBtn);
        if (pagination && nextBtn) {
          done = true;
          cleanup();
          resolve(true);
        } else if (Date.now() > deadline) {
          done = true;
          cleanup();
          reject(new Error("Timed out waiting for pagination controls"));
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

  return {
    getPaginationInfo,
    getNextPageButtonState,
    waitForPagination,
  };
}
