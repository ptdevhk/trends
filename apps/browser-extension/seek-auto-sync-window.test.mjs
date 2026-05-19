import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

function loadSeekAutoSyncHelpers() {
  const filePath = path.join(process.cwd(), 'apps/browser-extension/seek-auto-sync-window.js');
  const code = readFileSync(filePath, 'utf8');
  const context = { console };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(code, context, { filename: filePath });
  return context.__TR_SEEK_AUTO_SYNC__;
}

const helpers = loadSeekAutoSyncHelpers();

test('stops at the earlier of limit-derived pages and maxPages', () => {
  const pageWindow = helpers.resolveSeekAutoSyncPageWindow({
    startPage: 1,
    limit: 100,
    maxPages: 10,
    requestedPageSize: 20,
  });

  assert.equal(pageWindow.startPage, 1);
  assert.equal(pageWindow.targetPageEnd, 5);
  assert.equal(pageWindow.effectivePageSize, 20);
  assert.equal(pageWindow.limitPageCount, 5);
  assert.equal(pageWindow.maxPages, 10);
  assert.equal(pageWindow.allowedPageCount, 5);
});

test('uses maxPages when there is no limit', () => {
  const pageWindow = helpers.resolveSeekAutoSyncPageWindow({
    startPage: 1,
    limit: 0,
    maxPages: 5,
    requestedPageSize: 20,
  });

  assert.equal(pageWindow.targetPageEnd, 5);
  assert.equal(pageWindow.allowedPageCount, 5);
});

test('respects the current start page for exact seek job urls', () => {
  const pageWindow = helpers.resolveSeekAutoSyncPageWindow({
    startPage: 3,
    limit: 40,
    maxPages: 10,
    requestedPageSize: 20,
  });

  assert.equal(pageWindow.startPage, 3);
  assert.equal(pageWindow.targetPageEnd, 4);
  assert.equal(pageWindow.allowedPageCount, 2);
});

test('keeps a non-first-page exact seek url on the same page when a small limit fits within one page', () => {
  const pageWindow = helpers.resolveSeekAutoSyncPageWindow({
    startPage: 3,
    limit: 5,
    maxPages: 10,
    requestedPageSize: 20,
  });
  const selection = helpers.resolveSeekAutoSyncCurrentPageSelection({
    limit: 5,
    totalSubmitted: 0,
    currentPageResumeCount: 20,
  });

  assert.equal(pageWindow.startPage, 3);
  assert.equal(pageWindow.targetPageEnd, 3);
  assert.equal(pageWindow.allowedPageCount, 1);
  assert.equal(selection.selectedCount, 5);
  assert.equal(selection.hitLimitWithinPage, true);
});

test('keeps a non-first-page exact seek url on the same page when maxPages is the tighter bound', () => {
  const pageWindow = helpers.resolveSeekAutoSyncPageWindow({
    startPage: 3,
    limit: 100,
    maxPages: 1,
    requestedPageSize: 20,
  });
  const selection = helpers.resolveSeekAutoSyncCurrentPageSelection({
    limit: 100,
    totalSubmitted: 0,
    currentPageResumeCount: 20,
  });

  assert.equal(pageWindow.startPage, 3);
  assert.equal(pageWindow.targetPageEnd, 3);
  assert.equal(pageWindow.allowedPageCount, 1);
  assert.equal(selection.selectedCount, 20);
  assert.equal(selection.hitLimitWithinPage, false);
});

test('falls back to the current candidate count when seek request size is unavailable', () => {
  const pageWindow = helpers.resolveSeekAutoSyncPageWindow({
    startPage: 1,
    limit: 45,
    maxPages: 10,
    requestedPageSize: null,
    currentPageCandidateCount: 15,
  });

  assert.equal(pageWindow.effectivePageSize, 15);
  assert.equal(pageWindow.limitPageCount, 3);
  assert.equal(pageWindow.targetPageEnd, 3);
});

test('falls back to the default page size when no runtime page size is available', () => {
  const pageWindow = helpers.resolveSeekAutoSyncPageWindow({
    startPage: 2,
    limit: 60,
    maxPages: 0,
    requestedPageSize: null,
    currentPageCandidateCount: 0,
  });

  assert.equal(pageWindow.effectivePageSize, 20);
  assert.equal(pageWindow.targetPageEnd, 4);
});

test('detects when the target page window has been reached', () => {
  assert.equal(helpers.isSeekAutoSyncPageWindowReached({
    currentPage: 5,
    targetPageEnd: 5,
  }), true);

  assert.equal(helpers.isSeekAutoSyncPageWindowReached({
    currentPage: 4,
    targetPageEnd: 5,
  }), false);
});

test('selects only the remaining mid-page subset when the limit is reached on the current page', () => {
  const selection = helpers.resolveSeekAutoSyncCurrentPageSelection({
    limit: 5,
    totalSubmitted: 0,
    currentPageResumeCount: 20,
  });

  assert.equal(selection.remainingCapacity, 5);
  assert.equal(selection.selectedCount, 5);
  assert.equal(selection.hitLimitWithinPage, true);
  assert.equal(selection.limitAlreadyReached, false);
});

test('reports when the limit has already been exhausted before the current page', () => {
  const selection = helpers.resolveSeekAutoSyncCurrentPageSelection({
    limit: 5,
    totalSubmitted: 5,
    currentPageResumeCount: 20,
  });

  assert.equal(selection.remainingCapacity, 0);
  assert.equal(selection.selectedCount, 0);
  assert.equal(selection.hitLimitWithinPage, true);
  assert.equal(selection.limitAlreadyReached, true);
});

// Talent-search defaults: 500 limit / 25 max-pages / page-size 20 (per recon).
// The page-window math is mode-agnostic — these cases lock in the seek
// talent-search lane's default ceilings.

test('talentsearch: 500 limit and 25 maxPages with size 20 caps at page 25', () => {
  const pageWindow = helpers.resolveSeekAutoSyncPageWindow({
    startPage: 1,
    limit: 500,
    maxPages: 25,
    requestedPageSize: 20,
  });

  assert.equal(pageWindow.startPage, 1);
  assert.equal(pageWindow.targetPageEnd, 25);
  assert.equal(pageWindow.allowedPageCount, 25);
  assert.equal(pageWindow.effectivePageSize, 20);
});

test('talentsearch: mid-page limit (37 with size 20) selects 17 on page 2', () => {
  const pageWindow = helpers.resolveSeekAutoSyncPageWindow({
    startPage: 1,
    limit: 37,
    maxPages: 25,
    requestedPageSize: 20,
  });
  const selection = helpers.resolveSeekAutoSyncCurrentPageSelection({
    limit: 37,
    totalSubmitted: 20,
    currentPageResumeCount: 20,
  });

  assert.equal(pageWindow.targetPageEnd, 2);
  assert.equal(pageWindow.limitPageCount, 2);
  assert.equal(selection.selectedCount, 17);
  assert.equal(selection.hitLimitWithinPage, true);
  assert.equal(selection.remainingCapacity, 17);
});

test('talentsearch: maxPages=10 with limit=500 caps at page 10', () => {
  const pageWindow = helpers.resolveSeekAutoSyncPageWindow({
    startPage: 1,
    limit: 500,
    maxPages: 10,
    requestedPageSize: 20,
  });

  assert.equal(pageWindow.targetPageEnd, 10);
  assert.equal(pageWindow.allowedPageCount, 10);
});

test('talentsearch: non-first-page start (page 5, limit 100, size 20) ends on page 9', () => {
  const pageWindow = helpers.resolveSeekAutoSyncPageWindow({
    startPage: 5,
    limit: 100,
    maxPages: 25,
    requestedPageSize: 20,
  });

  assert.equal(pageWindow.startPage, 5);
  assert.equal(pageWindow.targetPageEnd, 9);
  assert.equal(pageWindow.allowedPageCount, 5);
});
