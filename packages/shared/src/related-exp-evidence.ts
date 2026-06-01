export const RELATED_EXP_EVIDENCE_CEILINGS = {
  adjacentProductSales: 55,
  noTargetDomainSales: 30,
  noDirectSales: 30,
} as const

export type RelatedExpEvidenceClassification =
  | 'not_applicable'
  | 'direct_machine_tool_sales'
  | 'adjacent_product_sales'
  | 'direct_sales_without_target_domain'
  | 'target_domain_without_direct_sales'
  | 'no_direct_sales'

export type RelatedExpEvidenceGateResult = {
  applies: boolean
  classification: RelatedExpEvidenceClassification
  ceiling?: number
}

export type RelatedExpTargetContext = {
  keywords?: string[]
  jobTitle?: string
  jobDescription?: string
}

export type RelatedExpMatchedWorkEntry = {
  companyName?: string
  jobTitle?: string
  years?: number
  industryVerified?: boolean
  matchedSignals?: string[]
  directRoleMatch?: boolean
}

export type RelatedExpRoleSignal = {
  type?: string
  verifyIn?: string
  matchedSignals?: string[]
  matchedWorkEntries?: RelatedExpMatchedWorkEntry[]
}

export type RelatedExpResumeEvidence = {
  ingestData?: RelatedExpIngestData
  content?: {
    ingestData?: RelatedExpIngestData
  }
}

type RelatedExpIngestData = {
  evidenceText?: string
  companyHits?: string[]
  roleSignals?: RelatedExpRoleSignal[]
}

type DirectSalesEntryEvidence = {
  entry: RelatedExpMatchedWorkEntry
  text: string
}

type ResolveRelatedExpEvidenceGateInput = {
  target?: RelatedExpTargetContext
  resume?: unknown
}

const SALES_TARGET_TERMS = [
  '销售',
  'sales',
  'account',
  'business development',
  '客户开发',
  '渠道',
  '大客户',
]

const CNC_TARGET_TERMS = [
  'cnc',
  '数控',
  '机床',
  '加工中心',
  '车床',
  'machine tool',
  'machining center',
  'lathe',
]

const DIRECT_SALES_TERMS = [
  '销售工程师',
  '销售经理',
  '销售主管',
  '销售专员',
  '销售代表',
  '大客户销售',
  '客户代表',
  '客户经理',
  '业务开发',
  '业务拓展',
  '区域销售',
  '渠道销售',
  'sales engineer',
  'sales manager',
  'account manager',
  'key account',
  'business development',
  'channel sales',
]

const AUXILIARY_SALES_TERMS = [
  '配合销售',
  '协助销售',
  '支持销售',
  '辅助销售',
  '售前支持',
  '销售助理',
  'support sales',
  'sales support',
  'sales assistant',
  'pre-sales',
  'presales',
]

const DIRECT_SALES_DUTY_TERMS = [
  '客户开发',
  '开发客户',
  '客户洽谈',
  '客户跟踪',
  '客户维护',
  '商务',
  '合同',
  '回款',
  '订单',
  '成交',
  '销售业绩',
  '销售目标',
  '市场营销',
  '市场推广',
  '渠道',
  '代理商',
  '经销商',
  '区域销售',
  '业务开发',
  '拓客',
]

const SUPPORT_ONLY_DUTY_TERMS = [
  '售后服务',
  '交机',
  '软件培训',
  '客户报修',
  '故障判断',
  '维修',
  '维护维修',
  '技术支持',
  '安装调试',
  '调试',
  '编程',
  '操作',
  '培训',
]

const COMPLETE_MACHINE_TOOL_PRODUCT_TERMS = [
  'cnc机床',
  '数控机床',
  '数控车床',
  '机床设备',
  '机床整机',
  '加工中心',
  '车床',
  '磨床',
  '铣床',
  '镗铣床',
  '慢走丝',
  '中走丝',
  '火花机',
  '线切割设备',
  '冲床',
  'machine tool',
  'machining center',
  'cnc machine',
  'lathe',
  'grinder',
  'milling machine',
]

const ADJACENT_PRODUCT_TERMS = [
  '电主轴',
  '主轴',
  '刀具',
  '量具',
  '夹具',
  '治具',
  '工具',
  '刀塔',
  'spindle',
  'tooling',
  'cutting tool',
  'gauge',
  'fixture',
  'sandvik',
  '山特维克',
]

const MACHINE_TOOL_COMPANY_TERMS = [
  '机床',
  '数控',
  '机械',
  'machine',
]

const STRONG_MACHINE_TOOL_COMPANY_TERMS = [
  '机床',
  '数控',
  'machine tool',
]

const COMPANY_EQUIPMENT_SALES_TERMS = [
  '公司设备',
  '设备销售',
  '销售设备',
  '设备在',
  '市场营销',
  '销售工作',
  '销售合同',
  '客户销售',
  '客户开发',
  '合同签订',
  '市场推广',
]

const COMPLETE_MACHINE_TOOL_SALE_PATTERNS = [
  /(?:销售(?!工程师|经理|主管|专员|代表|助理)|负责|代理|推广|经销|售卖|卖出|订单|项目)[^。；;|]{0,40}(?:cnc机床|数控机床|机床设备|机床整机|加工中心|数控车床|车床|磨床|铣床|镗铣床|慢走丝|中走丝|火花机|线切割设备|冲床|machine tool|machining center|cnc machine|lathe|grinder|milling machine)/iu,
  /(?:cnc机床|数控机床|机床设备|机床整机|加工中心|数控车床|车床|磨床|铣床|镗铣床|慢走丝|中走丝|火花机|线切割设备|冲床|machine tool|machining center|cnc machine|lathe|grinder|milling machine)[^。；;|]{0,40}(?:销售|售卖|卖出|客户|订单|项目|业务)/iu,
  /(?:销售(?!工程师|经理|主管|专员|代表|助理)|负责|代理|推广|经销|售卖|卖出)[^。；;|]{0,30}(?:马扎克|mazak|斗山|doosan|兄弟|brother|津上|tsugami|沙迪克|sodick|现代威亚|hyundai wia|哈斯|haas)/iu,
  /(?:马扎克|mazak|斗山|doosan|兄弟|brother|津上|tsugami|沙迪克|sodick|现代威亚|hyundai wia|哈斯|haas)[^。；;|]{0,30}(?:销售|代理|经销|订单|项目)/iu,
]

const NON_PRODUCT_MACHINE_TOOL_CONTEXT_PATTERNS = [
  /[^。；;|]{0,30}(?:机床厂|机床供应链|机床系统|数控系统|控制系统|cnc系统)[^。；;|]{0,30}/giu,
]

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function includesAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term.toLowerCase()))
}

function hasAnyPattern(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text))
}

function toStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }

  const strings = value.filter((item): item is string => typeof item === 'string')
  return strings.length > 0 ? strings : undefined
}

function toMatchedWorkEntries(value: unknown): RelatedExpMatchedWorkEntry[] | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }

  const entries = value
    .filter((item): item is Record<string, unknown> => isRecord(item))
    .map((item) => ({
      companyName: typeof item.companyName === 'string' ? item.companyName : undefined,
      jobTitle: typeof item.jobTitle === 'string' ? item.jobTitle : undefined,
      years: typeof item.years === 'number' && Number.isFinite(item.years) ? item.years : undefined,
      industryVerified: typeof item.industryVerified === 'boolean' ? item.industryVerified : undefined,
      matchedSignals: toStringArray(item.matchedSignals),
      directRoleMatch: typeof item.directRoleMatch === 'boolean' ? item.directRoleMatch : undefined,
    }))

  return entries.length > 0 ? entries : undefined
}

function toRoleSignals(value: unknown): RelatedExpRoleSignal[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .filter((item): item is Record<string, unknown> => isRecord(item))
    .map((item) => ({
      type: typeof item.type === 'string' ? item.type : undefined,
      verifyIn: typeof item.verifyIn === 'string' ? item.verifyIn : undefined,
      matchedSignals: toStringArray(item.matchedSignals),
      matchedWorkEntries: toMatchedWorkEntries(item.matchedWorkEntries),
    }))
}

function resolveIngestData(resume: unknown): RelatedExpIngestData {
  if (!isRecord(resume)) {
    return {}
  }

  const rootIngestData = isRecord(resume.ingestData) ? resume.ingestData : undefined
  const content = isRecord(resume.content) ? resume.content : undefined
  const contentIngestData = isRecord(content?.ingestData) ? content.ingestData : undefined
  const ingestData = rootIngestData ?? contentIngestData
  if (!ingestData) {
    return {}
  }

  return {
    evidenceText: typeof ingestData.evidenceText === 'string' ? ingestData.evidenceText : undefined,
    companyHits: toStringArray(ingestData.companyHits),
    roleSignals: toRoleSignals(ingestData.roleSignals),
  }
}

function buildTargetText(target: RelatedExpTargetContext | undefined): string {
  if (!target) {
    return ''
  }

  return [
    ...(target.keywords ?? []),
    target.jobTitle,
    target.jobDescription,
  ]
    .map(normalizeText)
    .filter(Boolean)
    .join(' ')
}

function isCncSalesTarget(target: RelatedExpTargetContext | undefined): boolean {
  const text = buildTargetText(target)
  return includesAny(text, SALES_TARGET_TERMS) && includesAny(text, CNC_TARGET_TERMS)
}

function splitEvidenceSegments(evidenceText: string | undefined): string[] {
  return normalizeText(evidenceText)
    .split(/\s*\|\|\s*|\n+/)
    .map((segment) => segment.trim())
    .filter(Boolean)
}

function entryIdentityParts(entry: RelatedExpMatchedWorkEntry): string[] {
  return [entry.companyName, entry.jobTitle]
    .map(normalizeText)
    .filter(Boolean)
}

function buildEntryText(entry: RelatedExpMatchedWorkEntry, segments: string[]): string {
  const identityParts = entryIdentityParts(entry)
  const matchedSegments = identityParts.length > 0
    ? segments.filter((segment) => identityParts.some((part) => segment.includes(part)))
    : []
  return [
    ...matchedSegments,
    entry.companyName,
    entry.jobTitle,
    ...(entry.matchedSignals ?? []),
  ]
    .map(normalizeText)
    .filter(Boolean)
    .join(' ')
}

function isDirectSalesEntry(entry: RelatedExpMatchedWorkEntry, entryText: string): boolean {
  if (entry.directRoleMatch === false) {
    return false
  }

  const titleAndSignals = [
    entry.jobTitle,
    ...(entry.matchedSignals ?? []),
  ]
    .map(normalizeText)
    .filter(Boolean)
    .join(' ')

  if (includesAny(titleAndSignals, AUXILIARY_SALES_TERMS)) {
    return false
  }

  const companyName = normalizeText(entry.companyName)
  const isMachineToolSalesManager = includesAny(companyName, STRONG_MACHINE_TOOL_COMPANY_TERMS)
    && includesAny(titleAndSignals, ['销售经理', 'sales manager'])
  if (
    includesAny(entryText, SUPPORT_ONLY_DUTY_TERMS)
    && !includesAny(entryText, DIRECT_SALES_DUTY_TERMS)
    && !isMachineToolSalesManager
  ) {
    return false
  }

  if (entry.directRoleMatch === true) {
    return true
  }

  return includesAny(titleAndSignals || entryText, DIRECT_SALES_TERMS)
}

function resolveDirectSalesEntries(ingestData: RelatedExpIngestData): DirectSalesEntryEvidence[] {
  const segments = splitEvidenceSegments(ingestData.evidenceText)
  const roleSignals = ingestData.roleSignals ?? []

  return roleSignals
    .filter((signal) => normalizeText(signal.type) === 'sales')
    .flatMap((signal) => signal.matchedWorkEntries ?? [])
    .map((entry) => ({ entry, text: buildEntryText(entry, segments) }))
    .filter(({ entry, text }) => isDirectSalesEntry(entry, text))
    .filter(({ text }) => Boolean(text))
}

function isSameCompany(left: string, right: string): boolean {
  return left.length > 0 && right.length > 0 && (left.includes(right) || right.includes(left))
}

function hasMachineToolCompanyHit(entry: RelatedExpMatchedWorkEntry, companyHits: string[] | undefined): boolean {
  const companyName = normalizeText(entry.companyName)
  if (!companyName) {
    return false
  }

  if (includesAny(companyName, STRONG_MACHINE_TOOL_COMPANY_TERMS)) {
    return true
  }

  if (!includesAny(companyName, MACHINE_TOOL_COMPANY_TERMS)) {
    return false
  }

  return (companyHits ?? [])
    .map(normalizeText)
    .some((companyHit) => isSameCompany(companyName, companyHit))
}

function withoutNonProductMachineToolContext(text: string): string {
  return NON_PRODUCT_MACHINE_TOOL_CONTEXT_PATTERNS.reduce(
    (nextText, pattern) => nextText.replace(pattern, ' '),
    text,
  )
}

function hasCompleteMachineToolSalesEvidence(
  directSalesEntry: DirectSalesEntryEvidence,
  ingestData: RelatedExpIngestData,
): boolean {
  const { entry, text } = directSalesEntry
  const productEvidenceText = withoutNonProductMachineToolContext(text)
  if (hasAnyPattern(productEvidenceText, COMPLETE_MACHINE_TOOL_SALE_PATTERNS)) {
    return true
  }

  return hasMachineToolCompanyHit(entry, ingestData.companyHits)
    && includesAny(text, COMPANY_EQUIPMENT_SALES_TERMS)
}

export function resolveRelatedExpEvidenceGate(
  input: ResolveRelatedExpEvidenceGateInput,
): RelatedExpEvidenceGateResult {
  if (!isCncSalesTarget(input.target)) {
    return { applies: false, classification: 'not_applicable' }
  }

  const ingestData = resolveIngestData(input.resume)
  const evidenceText = normalizeText(ingestData.evidenceText)
  const directSalesEntries = resolveDirectSalesEntries(ingestData)

  if (directSalesEntries.some((entry) => hasCompleteMachineToolSalesEvidence(entry, ingestData))) {
    return { applies: true, classification: 'direct_machine_tool_sales' }
  }

  if (directSalesEntries.some(({ text }) => includesAny(text, ADJACENT_PRODUCT_TERMS))) {
    return {
      applies: true,
      classification: 'adjacent_product_sales',
      ceiling: RELATED_EXP_EVIDENCE_CEILINGS.adjacentProductSales,
    }
  }

  if (directSalesEntries.length > 0) {
    return {
      applies: true,
      classification: 'direct_sales_without_target_domain',
      ceiling: RELATED_EXP_EVIDENCE_CEILINGS.noTargetDomainSales,
    }
  }

  if (includesAny(evidenceText, [...COMPLETE_MACHINE_TOOL_PRODUCT_TERMS, ...CNC_TARGET_TERMS])) {
    return {
      applies: true,
      classification: 'target_domain_without_direct_sales',
      ceiling: RELATED_EXP_EVIDENCE_CEILINGS.noDirectSales,
    }
  }

  return {
    applies: true,
    classification: 'no_direct_sales',
    ceiling: RELATED_EXP_EVIDENCE_CEILINGS.noDirectSales,
  }
}
