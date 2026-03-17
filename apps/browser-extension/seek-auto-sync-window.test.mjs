/* global console, process */

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
