(() => {
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
    formatAutoSyncState,
    formatAutoSyncStopReason,
    formatAutoSyncSourceKey,
    formatAutoSyncPersistedAt,
    buildAutoSyncSummary,
  });
})();
