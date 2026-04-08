import { JSDOM } from 'jsdom'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import workArrayFixture from './src/lib/__tests__/__fixtures__/job51-detail-work-array.json'

const CONTENT_EXPORTS_KEY = '__TR_BROWSER_EXTENSION_TEST__'

/**
 * @typedef {object} ButtonLike
 * @property {string | null} textContent
 * @property {(...args: unknown[]) => unknown} addEventListener
 * @property {(...args: unknown[]) => unknown} click
 */

/**
 * @typedef {object} QueryRootLike
 * @property {(selector: string) => Iterable<unknown> | ArrayLike<unknown>} querySelectorAll
 * @property {(selector: string) => unknown} querySelector
 */

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

/**
 * @param {unknown} node
 * @returns {ButtonLike | null}
 */
function toButtonLike(node) {
  return (
    Boolean(node) &&
    typeof node === 'object' &&
    'textContent' in node &&
    'addEventListener' in node &&
    'click' in node
  )
    ? /** @type {ButtonLike} */ (node)
    : null
}

/**
 * @param {QueryRootLike} root
 * @param {string} text
 * @returns {ButtonLike | null}
 */
function findButtonByText(root, text) {
  for (const node of Array.from(root.querySelectorAll('button'))) {
    const button = toButtonLike(node)
    if (button && (button.textContent || '').replace(/\s+/g, '').trim() === text) {
      return button
    }
  }
  return null
}

/**
 * @param {QueryRootLike} root
 * @param {string} selector
 * @returns {ButtonLike | null}
 */
function findButtonBySelector(root, selector) {
  return toButtonLike(root.querySelector(selector))
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
    searchCtx.window.document.body.innerHTML = '<div id="app"></div>'
    searchCtx.window.document.documentElement.removeAttribute('data-tr-auto-age')
    searchCtx.window.document.documentElement.removeAttribute('data-tr-auto-age-min')
    searchCtx.window.document.documentElement.removeAttribute('data-tr-auto-age-max')

    const apiSnapshot = searchCtx.window.__TR_RESUME_DATA__.getApiSnapshot()
    apiSnapshot.job51SearchRows = null
    apiSnapshot.job51LastSearchRequest = null
    apiSnapshot.job51DetailPayload = null
    apiSnapshot.lastSearchAt = null
  })

  afterAll(() => {
    searchCtx?.dom.window.close()
    delete globalThis.chrome
    delete globalThis[CONTENT_EXPORTS_KEY]
  })

  it('applies 51job extracted age filtering only after native age automation succeeds', () => {
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

    searchCtx.exports.setAutoAgeAttributes('done', 25, 40)

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

  it('leaves 51job extracted search results unfiltered when native age automation is not done', () => {
    searchCtx.window.__TR_RESUME_DATA__.getApiSnapshot().job51SearchRows = [
      {
        base_info: {
          resume_name: '张三',
          age: '37',
          userid: '51-in-range',
        },
      },
      {
        base_info: {
          resume_name: '李四',
          age: '24',
          userid: '51-out-range',
        },
      },
    ]

    expect(searchCtx.exports.extractResumes()).toMatchObject([
      {
        name: '张三',
        age: '37岁',
      },
      {
        name: '李四',
        age: '24岁',
      },
    ])
  })

  it('reads 51job search-result ages from displayage fallback fields', () => {
    searchCtx.window.__TR_RESUME_DATA__.getApiSnapshot().job51SearchRows = [
      {
        base_info: {
          resume_name: '张三',
          displayage: '37',
          userid: '51-displayage',
        },
      },
    ]

    expect(searchCtx.exports.extractResumes()).toMatchObject([
      {
        name: '张三',
        age: '37岁',
      },
    ])
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

  it('marks 51job native age automation degrade as failed', async () => {
    searchCtx.window.history.replaceState(
      {},
      '',
      'https://ehire.51job.com/search/result?tr_min_age=25&tr_max_age=40',
    )
    bindWindow(searchCtx.window)

    await searchCtx.exports.autoApplyAgeFilterFromUrl()

    expect(searchCtx.window.document.documentElement.getAttribute('data-tr-auto-age')).toBe('failed')
    expect(searchCtx.window.__TR_RESUME_DATA__.status()).toMatchObject({
      sourceKey: '51job',
      ageRange: { minAge: 25, maxAge: 40 },
      autoAge: 'failed',
    })
  })

  it('fails 51job native age automation for one-sided ranges', async () => {
    searchCtx.window.history.replaceState(
      {},
      '',
      'https://ehire.51job.com/Revision/talent/search?tr_min_age=25',
    )
    bindWindow(searchCtx.window)

    await searchCtx.exports.autoApplyAgeFilterFromUrl()

    expect(searchCtx.window.document.documentElement.getAttribute('data-tr-auto-age')).toBe('failed')
    expect(searchCtx.window.__TR_RESUME_DATA__.status()).toMatchObject({
      sourceKey: '51job',
      ageRange: { minAge: 25, maxAge: null },
      autoAge: 'failed',
    })
  })

  it('applies 51job native age automation when the age popper is present', async () => {
    searchCtx.window.history.replaceState(
      {},
      '',
      'https://ehire.51job.com/Revision/talent/search?tr_min_age=25&tr_max_age=40',
    )
    bindWindow(searchCtx.window)

    searchCtx.window.__TR_RESUME_DATA__.getApiSnapshot().job51SearchRows = [
      {
        base_info: {
          resume_name: '张三',
          age: '37',
          userid: '51-native-age-success',
        },
      },
    ]

    const ageWrapper = searchCtx.window.document.createElement('span')
    ageWrapper.className = 'el-popover__reference-wrapper'

    const ageReference = searchCtx.window.document.createElement('span')
    ageReference.className = 'el-popover__reference'
    ageReference.setAttribute('aria-describedby', 'job51-age-popper')

    const ageButton = searchCtx.window.document.createElement('button')
    ageButton.className = 'base-select-button'

    const ageLabel = searchCtx.window.document.createElement('span')
    ageLabel.className = 'base-select-label'
    ageLabel.textContent = '年龄'
    ageButton.appendChild(ageLabel)
    ageReference.appendChild(ageButton)
    ageWrapper.appendChild(ageReference)
    searchCtx.window.document.body.appendChild(ageWrapper)

    const agePopper = searchCtx.window.document.createElement('div')
    agePopper.id = 'job51-age-popper'
    agePopper.className = 'el-popover el-popper base-select-popper'
    agePopper.setAttribute('aria-hidden', 'true')
    agePopper.style.display = 'none'
    agePopper.innerHTML = `
      <div class="content-wrapper default">
        <div class="option-list">
          <div class="option-item-wrapper"><div class="option-item"><span class="option-item-label">25-30岁</span></div></div>
          <div class="option-item-wrapper"><div class="option-item"><span class="option-item-label">30-35岁</span></div></div>
          <div class="option-item-wrapper"><div class="option-item"><span class="option-item-label">35-45岁</span></div></div>
        </div>
        <div class="popover-custom-range">
          <button type="button" class="custom-button">自定义</button>
        </div>
      </div>
    `
    searchCtx.window.document.body.appendChild(agePopper)

    const confirmClick = vi.fn()
    const apiSnapshot = searchCtx.window.__TR_RESUME_DATA__.getApiSnapshot()

    ageButton.addEventListener('click', () => {
      agePopper.setAttribute('aria-hidden', 'false')
      agePopper.style.display = 'block'
    })

    agePopper.querySelector('.custom-button')?.addEventListener('click', () => {
      agePopper.innerHTML = `
        <div class="content-wrapper default">
          <div class="option-list">
            <div class="option-item-wrapper"><div class="option-item"><span class="option-item-label">25-30岁</span></div></div>
            <div class="option-item-wrapper"><div class="option-item"><span class="option-item-label">30-35岁</span></div></div>
            <div class="option-item-wrapper"><div class="option-item"><span class="option-item-label">35-45岁</span></div></div>
          </div>
          <div class="popover-custom-range">
            <div class="form-container">
              <div class="form-title">自定义</div>
              <form class="el-form form">
                <div class="candidate-filter-range-input el-input el-input--small">
                  <input type="number" placeholder="最低" class="el-input__inner">
                </div>
                <div class="candidate-filter-range-input el-input el-input--small">
                  <input type="number" placeholder="最高" class="el-input__inner">
                </div>
                <button type="button" class="el-button form-action-button el-button--primary el-button--small is-disabled" disabled>
                  <span>确定</span>
                </button>
              </form>
            </div>
          </div>
        </div>
      `

      const minInput = agePopper.querySelector('input[placeholder="最低"]')
      const maxInput = agePopper.querySelector('input[placeholder="最高"]')
      const confirmButton = agePopper.querySelector('button')
      const syncConfirmState = () => {
        const canConfirm = Boolean(minInput?.value && maxInput?.value)
        confirmButton.disabled = !canConfirm
        confirmButton.classList.toggle('is-disabled', !canConfirm)
      }

      minInput?.addEventListener('input', syncConfirmState)
      maxInput?.addEventListener('input', syncConfirmState)
      confirmButton.addEventListener('click', () => {
        confirmClick()
        apiSnapshot.job51LastSearchRequest = {
          age_from: 25,
          age_to: 40,
        }
        apiSnapshot.lastSearchAt = '2026-04-08T02:45:29.000Z'
      })
    })

    await searchCtx.exports.autoApplyAgeFilterFromUrl()

    const minInput = agePopper.querySelector('input[placeholder="最低"]')
    const maxInput = agePopper.querySelector('input[placeholder="最高"]')
    expect(minInput?.value).toBe('25')
    expect(maxInput?.value).toBe('40')
    expect(confirmClick).toHaveBeenCalledTimes(1)
    expect(searchCtx.window.document.documentElement.getAttribute('data-tr-auto-age')).toBe('done')
  }, 10000)

  it('waits for a fresh 51job filtered search refresh before resolving native age automation', async () => {
    searchCtx.window.history.replaceState(
      {},
      '',
      'https://ehire.51job.com/Revision/talent/search?tr_min_age=25&tr_max_age=40',
    )
    bindWindow(searchCtx.window)

    const apiSnapshot = searchCtx.window.__TR_RESUME_DATA__.getApiSnapshot()
    apiSnapshot.job51SearchRows = [
      {
        base_info: {
          resume_name: '旧结果',
          age: '47',
          userid: 'stale-over-age',
        },
      },
    ]
    apiSnapshot.lastSearchAt = '2026-04-08T02:43:04.000Z'

    const ageWrapper = searchCtx.window.document.createElement('span')
    ageWrapper.className = 'el-popover__reference-wrapper'

    const ageReference = searchCtx.window.document.createElement('span')
    ageReference.className = 'el-popover__reference'
    ageReference.setAttribute('aria-describedby', 'job51-age-refresh-popper')

    const ageButton = searchCtx.window.document.createElement('button')
    ageButton.className = 'base-select-button'

    const ageLabel = searchCtx.window.document.createElement('span')
    ageLabel.className = 'base-select-label'
    ageLabel.textContent = '年龄'
    ageButton.appendChild(ageLabel)
    ageReference.appendChild(ageButton)
    ageWrapper.appendChild(ageReference)
    searchCtx.window.document.body.appendChild(ageWrapper)

    const agePopper = searchCtx.window.document.createElement('div')
    agePopper.id = 'job51-age-refresh-popper'
    agePopper.className = 'el-popover el-popper base-select-popper'
    agePopper.setAttribute('aria-hidden', 'true')
    agePopper.style.display = 'none'
    agePopper.innerHTML = `
      <div class="content-wrapper default">
        <div class="option-list">
          <div class="option-item-wrapper"><div class="option-item"><span class="option-item-label">25-30岁</span></div></div>
          <div class="option-item-wrapper"><div class="option-item"><span class="option-item-label">30-35岁</span></div></div>
          <div class="option-item-wrapper"><div class="option-item"><span class="option-item-label">35-45岁</span></div></div>
        </div>
        <div class="popover-custom-range">
          <button type="button" class="custom-button">自定义</button>
        </div>
      </div>
    `
    searchCtx.window.document.body.appendChild(agePopper)

    let filteredRefreshCompleted = false

    ageButton.addEventListener('click', () => {
      agePopper.setAttribute('aria-hidden', 'false')
      agePopper.style.display = 'block'
    })

    agePopper.querySelector('.custom-button')?.addEventListener('click', () => {
      agePopper.innerHTML = `
        <div class="content-wrapper default">
          <div class="popover-custom-range">
            <div class="form-container">
              <div class="form-title">自定义</div>
              <form class="el-form form">
                <div class="candidate-filter-range-input el-input el-input--small">
                  <input type="number" placeholder="最低" class="el-input__inner">
                </div>
                <div class="candidate-filter-range-input el-input el-input--small">
                  <input type="number" placeholder="最高" class="el-input__inner">
                </div>
                <button type="button" class="el-button form-action-button el-button--primary el-button--small">
                  <span>确定</span>
                </button>
              </form>
            </div>
          </div>
        </div>
      `

      const confirmButton = findButtonByText(agePopper, '确定')
      confirmButton?.addEventListener('click', () => {
        searchCtx.window.setTimeout(() => {
          apiSnapshot.job51LastSearchRequest = {
            age_from: 25,
            age_to: 40,
          }
          apiSnapshot.job51SearchRows = [
            {
              base_info: {
                resume_name: '新结果',
                age: '37',
                userid: 'fresh-in-range',
              },
            },
          ]
          apiSnapshot.lastSearchAt = '2026-04-08T02:45:29.000Z'
          filteredRefreshCompleted = true
        }, 150)
      })
    })

    await searchCtx.exports.autoApplyAgeFilterFromUrl()

    expect(filteredRefreshCompleted).toBe(true)
    expect(apiSnapshot.job51LastSearchRequest).toMatchObject({
      age_from: 25,
      age_to: 40,
    })
    expect(searchCtx.exports.extractResumes()).toMatchObject([
      {
        name: '新结果',
        age: '37岁',
      },
    ])
    expect(searchCtx.window.document.documentElement.getAttribute('data-tr-auto-age')).toBe('done')
  }, 10000)

  it('invokes the 51job custom-range Vue confirm handler when the DOM click path is inert', async () => {
    searchCtx.window.history.replaceState(
      {},
      '',
      'https://ehire.51job.com/Revision/talent/search?tr_min_age=25&tr_max_age=40',
    )
    bindWindow(searchCtx.window)

    const apiSnapshot = searchCtx.window.__TR_RESUME_DATA__.getApiSnapshot()
    apiSnapshot.lastSearchAt = '2026-04-08T02:50:00.000Z'

    const ageWrapper = searchCtx.window.document.createElement('span')
    ageWrapper.className = 'el-popover__reference-wrapper'

    const ageReference = searchCtx.window.document.createElement('span')
    ageReference.className = 'el-popover__reference'
    ageReference.setAttribute('aria-describedby', 'job51-age-vue-confirm-popper')

    const ageButton = searchCtx.window.document.createElement('button')
    ageButton.className = 'base-select-button'

    const ageLabel = searchCtx.window.document.createElement('span')
    ageLabel.className = 'base-select-label'
    ageLabel.textContent = '年龄'
    ageButton.appendChild(ageLabel)
    ageReference.appendChild(ageButton)
    ageWrapper.appendChild(ageReference)
    searchCtx.window.document.body.appendChild(ageWrapper)

    const agePopper = searchCtx.window.document.createElement('div')
    agePopper.id = 'job51-age-vue-confirm-popper'
    agePopper.className = 'el-popover el-popper base-select-popper'
    agePopper.setAttribute('aria-hidden', 'true')
    agePopper.style.display = 'none'
    agePopper.innerHTML = `
      <div class="content-wrapper default">
        <div class="popover-custom-range">
          <button type="button" class="custom-button">自定义</button>
        </div>
      </div>
    `
    searchCtx.window.document.body.appendChild(agePopper)

    ageButton.addEventListener('click', () => {
      agePopper.setAttribute('aria-hidden', 'false')
      agePopper.style.display = 'block'
    })

    const onClickOk = vi.fn(() => {
      apiSnapshot.job51LastSearchRequest = {
        age_from: 25,
        age_to: 40,
      }
      apiSnapshot.job51SearchRows = [
        {
          base_info: {
            resume_name: 'Vue确认后的候选人',
            age: '36',
            userid: 'vue-confirm-success',
          },
        },
      ]
      apiSnapshot.lastSearchAt = '2026-04-08T02:50:30.000Z'
      ageLabel.textContent = '25-40岁'
    })

    findButtonBySelector(agePopper, '.custom-button')?.addEventListener('click', () => {
      agePopper.innerHTML = `
        <div class="content-wrapper default">
          <div class="popover-custom-range">
            <div class="form-container">
              <form class="el-form form">
                <div class="candidate-filter-range-input el-input el-input--small">
                  <input type="number" placeholder="最低" class="el-input__inner">
                </div>
                <div class="candidate-filter-range-input el-input el-input--small">
                  <input type="number" placeholder="最高" class="el-input__inner">
                </div>
                <button type="button" class="el-button form-action-button el-button--primary el-button--small">
                  <span>确定</span>
                </button>
              </form>
            </div>
          </div>
        </div>
      `

      const confirmButton = findButtonByText(agePopper, '确定')
      if (!confirmButton) {
        throw new Error('Expected confirm button for Vue confirm regression test')
      }

      confirmButton.click = vi.fn()

      const baseSelectCustomRangeVm = {
        $options: { name: 'BaseSelectCustomRange' },
        form: {
          leftValue: null,
          rightValue: null,
        },
        onClickOk,
        $parent: null,
      }
      const elFormItemVm = {
        $options: { name: 'ElFormItem' },
        $parent: baseSelectCustomRangeVm,
      }
      const elButtonVm = {
        $options: { name: 'ElButton' },
        $parent: elFormItemVm,
      }

      Object.defineProperty(confirmButton, '__vue__', {
        value: elButtonVm,
        configurable: true,
      })
    })

    await searchCtx.exports.autoApplyAgeFilterFromUrl()

    expect(onClickOk).toHaveBeenCalledTimes(1)
    expect(apiSnapshot.job51LastSearchRequest).toMatchObject({
      age_from: 25,
      age_to: 40,
    })
    expect(ageLabel.textContent).toBe('25-40岁')
    expect(searchCtx.window.document.documentElement.getAttribute('data-tr-auto-age')).toBe('done')
  }, 10000)

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
