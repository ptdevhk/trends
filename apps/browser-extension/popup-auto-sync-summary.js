(() => {
  const DEFAULT_STORED_AUTO_SYNC_SUMMARY_MAX_AGE_MS = 24 * 60 * 60 * 1000;

  /**
   * @param {string} autoSync
   * @returns {string}
   */
  function formatAutoSyncState(autoSync) {
    switch (autoSync) {
      case 'running':
        return '进行中';
      case 'done':
        return '已完成';
      case 'cancelled':
        return '已取消';
      case 'failed':
        return '失败';
      default:
        return '';
    }
  }

  /**
   * @param {string | null | undefined} stopReason
   * @returns {string}
   */
  function formatAutoSyncStopReason(stopReason) {
    switch (stopReason) {
      case 'limit-reached':
        return '命中数量上限';
      case 'page-window-reached':
        return '命中页窗上限';
      case 'max-pages-reached':
        return '命中页数上限';
      case 'no-next-page':
        return '已到最后一页';
      case 'cancelled':
        return '用户取消';
      case 'failed':
        return '同步失败';
      default:
        return '';
    }
  }

  /**
   * @param {string | null | undefined} sourceKey
   * @returns {string}
   */
  function formatAutoSyncSourceKey(sourceKey) {
    if (sourceKey === 'seek') return 'SEEK';
    if (sourceKey === 'job5156') return 'Job5156';
    return '';
  }

  /**
   * @param {string | null | undefined} persistedAt
   * @returns {string}
   */
  function formatAutoSyncPersistedAt(persistedAt) {
    if (typeof persistedAt !== 'string') return '';
    const trimmed = persistedAt.trim();
    if (!trimmed) return '';
    return trimmed
      .replace('T', ' ')
      .replace(/\.\d+Z?$/u, '')
      .replace(/Z$/u, '')
      .slice(0, 16);
  }

  /**
   * @param {unknown} value
   * @returns {Record<string, unknown> | null}
   */
  function normalizeStoredAutoSyncSummary(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    return /** @type {Record<string, unknown>} */ (value);
  }

  /**
   * @param {Record<string, unknown> | null | undefined} summariesBySource
   * @returns {Array<Record<string, unknown>>}
   */
  function listStoredAutoSyncSummaries(summariesBySource) {
    if (!summariesBySource || typeof summariesBySource !== 'object' || Array.isArray(summariesBySource)) {
      return [];
    }

    const summaries = /** @type {Array<Record<string, unknown>>} */ ([]);
    for (const value of Object.values(summariesBySource)) {
      const summary = normalizeStoredAutoSyncSummary(value);
      if (summary) {
        summaries.push(summary);
      }
    }
    return summaries;
  }

  /**
   * @param {unknown} value
   * @returns {number | null}
   */
  function parsePersistedAtMs(value) {
    if (typeof value !== 'string') return null;
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? timestamp : null;
  }

  /**
   * @param {{
   *   summariesBySource?: Record<string, unknown> | null;
   *   preferredSourceKey?: string | null;
   *   nowMs?: number;
   *   maxAgeMs?: number;
   * }} [options]
   * @returns {Record<string, unknown> | null}
   */
  function pickStoredAutoSyncSummary(options = {}) {
    const {
      summariesBySource = null,
      preferredSourceKey = '',
      nowMs = Date.now(),
      maxAgeMs = DEFAULT_STORED_AUTO_SYNC_SUMMARY_MAX_AGE_MS,
    } = options;
    const candidates = listStoredAutoSyncSummaries(summariesBySource)
      .map((summary) => ({
        summary,
        persistedAtMs: parsePersistedAtMs(summary.persistedAt),
      }))
      .filter(({ summary, persistedAtMs }) => {
        const autoSync = typeof summary.autoSync === 'string' ? summary.autoSync : '';
        if (!autoSync || autoSync === 'skipped') return false;
        if (!Number.isFinite(persistedAtMs)) return false;
        return nowMs - persistedAtMs <= maxAgeMs;
      })
      .sort((left, right) => /** @type {number} */ (right.persistedAtMs) - /** @type {number} */ (left.persistedAtMs));

    if (!candidates.length) {
      return null;
    }

    const normalizedPreferredSourceKey = typeof preferredSourceKey === 'string' ? preferredSourceKey.trim() : '';
    if (normalizedPreferredSourceKey) {
      const matched = candidates.find(({ summary }) => summary.sourceKey === normalizedPreferredSourceKey);
      return matched ? matched.summary : null;
    }

    return candidates[0]?.summary || null;
  }

  /**
   * @param {{
   *   autoSync?: string;
   *   autoSyncCount?: number | null;
   *   autoSyncPages?: number | null;
   *   autoSyncSelectedCount?: number | null;
   *   autoSyncTargetPageStart?: number | null;
   *   autoSyncTargetPageEnd?: number | null;
   *   autoSyncEffectivePageSize?: number | null;
   *   autoSyncRemainingCapacity?: number | null;
   *   autoSyncStopReason?: string | null;
   *   summarySource?: string | null;
   *   sourceKey?: string | null;
   *   persistedAt?: string | null;
   * }} [status]
   * @returns {{ autoSync: string; stateLabel: string; mainText: string; detailText: string } | null}
   */
  function buildAutoSyncSummary(status = {}) {
    const autoSync = typeof status?.autoSync === 'string' ? status.autoSync : '';
    if (!autoSync || autoSync === 'skipped') {
      return null;
    }

    const stateLabel = formatAutoSyncState(autoSync) || autoSync;
    const mainParts = [];
    const detailParts = [];

    if (typeof status.autoSyncCount === 'number') {
      mainParts.push(`已采集 ${status.autoSyncCount} 份`);
    }
    if (typeof status.autoSyncPages === 'number' && status.autoSyncPages > 0) {
      mainParts.push(`共 ${status.autoSyncPages} 页`);
    }
    if (typeof status.autoSyncSelectedCount === 'number' && status.autoSyncSelectedCount > 0) {
      mainParts.push(`本页选中 ${status.autoSyncSelectedCount} 份`);
    }

    if (
      typeof status.autoSyncTargetPageStart === 'number'
      && typeof status.autoSyncTargetPageEnd === 'number'
      && status.autoSyncTargetPageStart > 0
      && status.autoSyncTargetPageEnd > 0
    ) {
      detailParts.push(`页窗 ${status.autoSyncTargetPageStart}-${status.autoSyncTargetPageEnd}`);
    }
    if (typeof status.autoSyncEffectivePageSize === 'number' && status.autoSyncEffectivePageSize > 0) {
      detailParts.push(`页容量 ${status.autoSyncEffectivePageSize}`);
    }
    if (autoSync === 'running' && typeof status.autoSyncRemainingCapacity === 'number' && status.autoSyncRemainingCapacity > 0) {
      detailParts.push(`剩余容量 ${status.autoSyncRemainingCapacity}`);
    }

    const stopReasonLabel = formatAutoSyncStopReason(status.autoSyncStopReason);
    if (stopReasonLabel) {
      detailParts.push(stopReasonLabel);
    }
    if (status.summarySource === 'stored') {
      detailParts.push('最近一次记录');
      const sourceKeyLabel = formatAutoSyncSourceKey(status.sourceKey);
      if (sourceKeyLabel) {
        detailParts.push(`来源 ${sourceKeyLabel}`);
      }
      const persistedAtLabel = formatAutoSyncPersistedAt(status.persistedAt);
      if (persistedAtLabel) {
        detailParts.push(`记录于 ${persistedAtLabel}`);
      }
    }

    return {
      autoSync,
      stateLabel,
      mainText: mainParts.join(' · ') || `自动同步 ${stateLabel}`,
      detailText: detailParts.join(' · ')
    };
  }

  globalThis.__TR_POPUP_AUTO_SYNC_SUMMARY__ = Object.freeze({
    DEFAULT_STORED_AUTO_SYNC_SUMMARY_MAX_AGE_MS,
    formatAutoSyncState,
    formatAutoSyncStopReason,
    formatAutoSyncSourceKey,
    formatAutoSyncPersistedAt,
    normalizeStoredAutoSyncSummary,
    listStoredAutoSyncSummaries,
    parsePersistedAtMs,
    pickStoredAutoSyncSummary,
    buildAutoSyncSummary,
  });
})();
