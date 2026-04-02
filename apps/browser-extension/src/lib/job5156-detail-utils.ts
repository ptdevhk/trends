// @ts-nocheck
import { normalizeResumeText } from './resume-text-utils'

const SECTION_SELECTORS = [
  'section',
  '.section',
  '.resume-section',
  '.module',
  '.card',
  '.block',
  '.resume-view-layout',
  '[class*="section"]',
  '[class*="module"]',
  '[class*="block"]',
]

const HEADING_SELECTOR = [
  'h1',
  'h2',
  'h3',
  'h4',
  '.title',
  '.section-title',
  '.module-title',
  '.resume-view-layout__title',
  '[class*="title"]',
].join(', ')

const WORK_HISTORY_PLACEHOLDER_PATTERN = /^[（(]?\d+(?:年(?:\d+个?月?)?|个月?|月)?[）)]?$/u
const EDUCATION_LIKE_PATTERN = /(本科|大专|中专|硕士|博士|研究生|MBA|EMBA|学校|学院|大学|学历)/u
const WORK_LIKE_PATTERN = /(公司|经理|工程师|销售|主管|总监|主任|技术|客户|负责|部门|离职原因|CNC|数控|机械|设备|项目)/iu
const DATE_LIKE_PATTERN = /(?:19|20)\d{2}(?:[-./年]\d{1,2})?|至今|目前|present|current/iu

/**
 * @param {unknown} value
 * @returns {value is Element}
 */
function isElement(value) {
  return Boolean(
    value
      && typeof value === 'object'
      && 'nodeType' in value
      && value.nodeType === 1
      && 'querySelectorAll' in value
  )
}

/**
 * @param {Element} root
 * @param {string} selector
 * @returns {Element[]}
 */
function queryAllSafe(root, selector) {
  try {
    return Array.from(root.querySelectorAll(selector)).filter(isElement)
  } catch {
    return []
  }
}

/**
 * @param {unknown} root
 * @param {RegExp} headingPattern
 * @param {string[]} primarySelectors
 * @param {string[]} [fallbackSelectors]
 * @returns {Element[]}
 */
export function collectJob5156SectionItemsByHeading(
  root,
  headingPattern,
  primarySelectors,
  fallbackSelectors = [],
) {
  if (!isElement(root)) {
    return []
  }

  const sections = queryAllSafe(root, SECTION_SELECTORS.join(', '))
  for (const section of sections) {
    const currentSection = /** @type {Element} */ (section)
    const heading = normalizeResumeText(currentSection.querySelector(HEADING_SELECTOR)?.textContent || '')
    if (!heading || !headingPattern.test(heading)) {
      continue
    }

    for (const selector of primarySelectors) {
      const matches = queryAllSafe(currentSection, selector)
      if (matches.length > 0) {
        return matches
      }
    }

    for (const selector of fallbackSelectors) {
      const matches = queryAllSafe(currentSection, selector)
      if (matches.length > 0) {
        return matches
      }
    }

    break
  }

  return []
}

/**
 * @param {string} value
 * @returns {boolean}
 */
function isPlaceholderDurationText(value) {
  const normalized = value.replace(/[\s·]+/g, '')
  return WORK_HISTORY_PLACEHOLDER_PATTERN.test(normalized)
}

/**
 * @param {{
 *   raw?: string
 *   companyName?: string
 *   jobTitle?: string
 *   description?: string
 *   startDate?: string
 *   endDate?: string
 * } | null | undefined} entry
 * @returns {boolean}
 */
export function isMeaningfulJob5156WorkHistoryEntry(entry) {
  if (!entry) {
    return false
  }

  const companyName = normalizeResumeText(entry.companyName || '')
  const jobTitle = normalizeResumeText(entry.jobTitle || '')
  const description = normalizeResumeText(entry.description || '')
  const startDate = normalizeResumeText(entry.startDate || '')
  const endDate = normalizeResumeText(entry.endDate || '')
  const raw = normalizeResumeText(entry.raw || '')
  const text = [raw, description].filter(Boolean).join(' ')
  const hasIdentity = Boolean(companyName || jobTitle || description)
  const hasDate = DATE_LIKE_PATTERN.test(`${startDate} ${endDate}`.trim())

  if (hasIdentity) {
    return true
  }

  if (!text) {
    return false
  }

  if (isPlaceholderDurationText(text)) {
    return false
  }

  if (EDUCATION_LIKE_PATTERN.test(text) && !WORK_LIKE_PATTERN.test(text) && !companyName && !jobTitle) {
    return false
  }

  if (hasDate && text.length > 0) {
    return true
  }

  return true
}
