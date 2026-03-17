/* global console */

import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';
import process from 'node:process';
import test from 'node:test';
import vm from 'node:vm';

function loadPopupAutoSyncSummaryHelpers() {
  const filePath = path.join(process.cwd(), 'apps/browser-extension/popup-auto-sync-summary.js');
  const code = readFileSync(filePath, 'utf8');
  const context = { console };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(code, context, { filename: filePath });
  return context.__TR_POPUP_AUTO_SYNC_SUMMARY__;
}

const helpers = loadPopupAutoSyncSummaryHelpers();

test('builds a running seek summary with selected count and remaining capacity', () => {
  const summary = helpers.buildAutoSyncSummary({
    autoSync: 'running',
    autoSyncCount: 40,
    autoSyncPages: 2,
    autoSyncSelectedCount: 20,
    autoSyncTargetPageStart: 3,
    autoSyncTargetPageEnd: 5,
    autoSyncEffectivePageSize: 20,
    autoSyncRemainingCapacity: 60,
  });

  assert.deepEqual(JSON.parse(JSON.stringify(summary)), {
    autoSync: 'running',
    stateLabel: '进行中',
    mainText: '已采集 40 份 · 共 2 页 · 本页选中 20 份',
    detailText: '页窗 3-5 · 页容量 20 · 剩余容量 60',
  });
});

test('builds a completed seek summary with page-window stop reason', () => {
  const summary = helpers.buildAutoSyncSummary({
    autoSync: 'done',
    autoSyncCount: 100,
    autoSyncPages: 5,
    autoSyncSelectedCount: 20,
    autoSyncTargetPageStart: 1,
    autoSyncTargetPageEnd: 5,
    autoSyncEffectivePageSize: 20,
    autoSyncStopReason: 'page-window-reached',
  });

  assert.deepEqual(JSON.parse(JSON.stringify(summary)), {
    autoSync: 'done',
    stateLabel: '已完成',
    mainText: '已采集 100 份 · 共 5 页 · 本页选中 20 份',
    detailText: '页窗 1-5 · 页容量 20 · 命中页窗上限',
  });
});

test('returns a minimal fallback summary when only the state is available', () => {
  const summary = helpers.buildAutoSyncSummary({
    autoSync: 'failed',
    autoSyncStopReason: 'failed',
  });

  assert.deepEqual(JSON.parse(JSON.stringify(summary)), {
    autoSync: 'failed',
    stateLabel: '失败',
    mainText: '自动同步 失败',
    detailText: '同步失败',
  });
});

test('adds stored-summary metadata when rendering the last persisted result', () => {
  const summary = helpers.buildAutoSyncSummary({
    autoSync: 'done',
    autoSyncCount: 5,
    autoSyncPages: 1,
    autoSyncSelectedCount: 5,
    autoSyncStopReason: 'limit-reached',
    summarySource: 'stored',
    sourceKey: 'seek',
    persistedAt: '2026-03-17T08:21:35.000Z',
  });

  assert.deepEqual(JSON.parse(JSON.stringify(summary)), {
    autoSync: 'done',
    stateLabel: '已完成',
    mainText: '已采集 5 份 · 共 1 页 · 本页选中 5 份',
    detailText: '命中数量上限 · 最近一次记录 · 来源 SEEK · 记录于 2026-03-17 08:21',
  });
});

test('picks the preferred source summary when it is recent', () => {
  const summary = helpers.pickStoredAutoSyncSummary({
    summariesBySource: {
      seek: {
        autoSync: 'done',
        sourceKey: 'seek',
        persistedAt: '2026-03-17T08:31:00.000Z',
      },
      job5156: {
        autoSync: 'done',
        sourceKey: 'job5156',
        persistedAt: '2026-03-17T08:32:00.000Z',
      },
    },
    preferredSourceKey: 'seek',
    nowMs: Date.parse('2026-03-17T08:35:00.000Z'),
  });

  assert.deepEqual(JSON.parse(JSON.stringify(summary)), {
    autoSync: 'done',
    sourceKey: 'seek',
    persistedAt: '2026-03-17T08:31:00.000Z',
  });
});

test('returns the newest recent summary when no preferred source is available', () => {
  const summary = helpers.pickStoredAutoSyncSummary({
    summariesBySource: {
      seek: {
        autoSync: 'done',
        sourceKey: 'seek',
        persistedAt: '2026-03-17T08:31:00.000Z',
      },
      job5156: {
        autoSync: 'done',
        sourceKey: 'job5156',
        persistedAt: '2026-03-17T08:32:00.000Z',
      },
    },
    nowMs: Date.parse('2026-03-17T08:35:00.000Z'),
  });

  assert.deepEqual(JSON.parse(JSON.stringify(summary)), {
    autoSync: 'done',
    sourceKey: 'job5156',
    persistedAt: '2026-03-17T08:32:00.000Z',
  });
});

test('expires stale stored summaries and returns null when no recent preferred summary exists', () => {
  const summary = helpers.pickStoredAutoSyncSummary({
    summariesBySource: {
      seek: {
        autoSync: 'done',
        sourceKey: 'seek',
        persistedAt: '2026-03-15T08:31:00.000Z',
      },
      job5156: {
        autoSync: 'done',
        sourceKey: 'job5156',
        persistedAt: '2026-03-17T08:32:00.000Z',
      },
    },
    preferredSourceKey: 'seek',
    nowMs: Date.parse('2026-03-17T08:35:00.000Z'),
  });

  assert.equal(summary, null);
});

test('skips rendering when auto sync is absent or skipped', () => {
  assert.equal(helpers.buildAutoSyncSummary({ autoSync: '' }), null);
  assert.equal(helpers.buildAutoSyncSummary({ autoSync: 'skipped' }), null);
});
