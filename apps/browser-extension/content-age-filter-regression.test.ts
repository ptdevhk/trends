import { JSDOM } from 'jsdom'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import workArrayFixture from './src/lib/__tests__/__fixtures__/job51-detail-work-array.json'

const CONTENT_EXPORTS_KEY = '__TR_BROWSER_EXTENSION_TEST__'

function installChromeStub(window) {
  const storageGet = vi.fn((defaults, callback) => callback(defaults))
  const runtimeSendMessage = vi.fn(async () => ({ ok: true }))
  const runtimeOnMessageAddListener = vi.fn()
  const runtimeOnMessageRemoveListener = vi.fn()

  const chromeStub = {
    storage: {
      local: {
        get: storageGet,
        set: vi.fn((_, callback) => callback?.()),
        remove: vi.fn((_, callback) => callback?.()),
      },
    },
    runtime: {
      id: 'test-extension-id',
      getURL: vi.fn((path) => `chrome-extension://test-extension-id/${path}`),
      sendMessage: runtimeSendMessage,
      onMessage: {
        addListener: runtimeOnMessageAddListener,
        removeListener: runtimeOnMessageRemoveListener,
      },
    },
  }

  Object.defineProperty(window, 'chrome', {
    value: chromeStub,
    configurable: true,
  })
  Object.defineProperty(globalThis, 'chrome', {
    value: chromeStub,
    configurable: true,
  })
}

function setGlobalValue(key, value) {
  Object.defineProperty(globalThis, key, {
    value,
    configurable: true,
    writable: true,
  })
}

function bindWindow(window) {
  setGlobalValue('window', window)
  setGlobalValue('document', window.document)
  Object.defineProperty(globalThis, 'navigator', {
    value: window.navigator,
    configurable: true,
  })
  Object.defineProperty(globalThis, 'location', {
    value: window.location,
    configurable: true,
  })
}

async function createHarness(url) {
  const dom = new JSDOM('<html><body><div id="app"></div></body></html>', {
    url,
    pretendToBeVisual: true,
  })
  const { window } = dom

  bindWindow(window)
  setGlobalValue(CONTENT_EXPORTS_KEY, {})
  Object.defineProperty(window, CONTENT_EXPORTS_KEY, {
    value: globalThis[CONTENT_EXPORTS_KEY],
    configurable: true,
  })

  installChromeStub(window)
  await import('./src/content')

  const exports = globalThis[CONTENT_EXPORTS_KEY]?.content
  if (!exports) {
    throw new Error('Failed to load test exports from content.ts')
  }

  return { dom, window, exports }
}

describe('content age-filter regressions', () => {
  let searchCtx

  beforeAll(async () => {
    searchCtx = await createHarness(
      'https://ehire.51job.com/search/result?tr_min_age=25&tr_max_age=40',
    )
  })

  beforeEach(() => {
    bindWindow(searchCtx.window)
    searchCtx.window.document.documentElement.removeAttribute('data-tr-auto-age')
    searchCtx.window.document.documentElement.removeAttribute('data-tr-auto-age-min')
    searchCtx.window.document.documentElement.removeAttribute('data-tr-auto-age-max')

    const apiSnapshot = searchCtx.window.__TR_RESUME_DATA__.getApiSnapshot()
    apiSnapshot.job51SearchRows = null
    apiSnapshot.job51DetailPayload = null
  })

  afterAll(() => {
    searchCtx?.dom.window.close()
    delete globalThis.chrome
    delete globalThis[CONTENT_EXPORTS_KEY]
  })

  it('keeps 51job final-result age filtering active for url-supplied search results', () => {
    searchCtx.window.__TR_RESUME_DATA__.getApiSnapshot().job51SearchRows = [
      {
        base_info: {
          resume_name: '张三',
          age: '37',
          work_year_value: '9年',
          top_degree_value: '大专',
          userid: '51-in-range',
        },
        recent_work_info: {
          recent_position: '销售经理',
        },
      },
      {
        base_info: {
          resume_name: '李四',
          age: '24',
          userid: '51-out-range',
        },
      },
      {
        base_info: {
          resume_name: '王五',
          age: 'unknown',
          userid: '51-unknown-age',
        },
      },
    ]

    expect(searchCtx.exports.extractResumes()).toMatchObject([
      {
        name: '张三',
        age: '37岁',
      },
    ])
    expect(searchCtx.window.__TR_RESUME_DATA__.status()).toMatchObject({
      sourceKey: '51job',
      ageRange: { minAge: 25, maxAge: 40 },
    })
  })

  it('keeps 51job final-result age filtering active for detail payloads', () => {
    searchCtx.window.history.replaceState(
      {},
      '',
      'https://ehire.51job.com/Revision/talent/resume/detail?contentType=&resumeId=123456&tr_min_age=25&tr_max_age=40',
    )
    bindWindow(searchCtx.window)
    searchCtx.window.__TR_RESUME_DATA__.getApiSnapshot().job51DetailPayload = workArrayFixture

    expect(searchCtx.exports.extractJob51DetailResume()).toMatchObject([
      {
        name: '袁先生',
        age: '37岁',
        resumeId: '123456',
      },
    ])
  })

  it('excludes unparseable 51job detail ages when final filtering is enabled', () => {
    searchCtx.window.history.replaceState(
      {},
      '',
      'https://ehire.51job.com/Revision/talent/resume/detail?contentType=&resumeId=999&tr_min_age=25&tr_max_age=40',
    )
    bindWindow(searchCtx.window)
    searchCtx.window.__TR_RESUME_DATA__.getApiSnapshot().job51DetailPayload = {
      data: {
        base_info: {
          userid: '999',
          resume_name: '测试候选人',
          age: 'unknown',
        },
      },
    }

    expect(searchCtx.exports.extractJob51DetailResume()).toEqual([])
  })

  it('marks 51job native age automation degrade as filtered-only', async () => {
    searchCtx.window.history.replaceState(
      {},
      '',
      'https://ehire.51job.com/search/result?tr_min_age=25&tr_max_age=40',
    )
    bindWindow(searchCtx.window)

    await searchCtx.exports.autoApplyAgeFilterFromUrl()

    expect(searchCtx.window.document.documentElement.getAttribute('data-tr-auto-age')).toBe('filtered-only')
    expect(searchCtx.window.__TR_RESUME_DATA__.status()).toMatchObject({
      sourceKey: '51job',
      ageRange: { minAge: 25, maxAge: 40 },
      autoAge: 'filtered-only',
    })
  })

  it('keeps Job5156 native age automation failures as failed', async () => {
    const originalWindow = globalThis.window
    const originalDocument = globalThis.document
    const originalLocation = globalThis.location

    const job5156Dom = new JSDOM('<html><body><div id="app"></div></body></html>', {
      url: 'https://hr.job5156.com/search?tr_min_age=25&tr_max_age=40',
      pretendToBeVisual: true,
    })

    bindWindow(job5156Dom.window)
    searchCtx.window.document.documentElement.removeAttribute('data-tr-auto-age')
    searchCtx.window.document.documentElement.removeAttribute('data-tr-auto-age-min')
    searchCtx.window.document.documentElement.removeAttribute('data-tr-auto-age-max')

    await searchCtx.exports.autoApplyAgeFilterFromUrl()

    expect(searchCtx.exports.getExternalAccessorStatus()).toMatchObject({
      sourceKey: 'job5156',
      ageRange: { minAge: 25, maxAge: 40 },
      autoAge: 'failed',
    })

    setGlobalValue('window', originalWindow)
    setGlobalValue('document', originalDocument)
    Object.defineProperty(globalThis, 'location', {
      value: originalLocation,
      configurable: true,
    })
    job5156Dom.window.close()
  })
})
