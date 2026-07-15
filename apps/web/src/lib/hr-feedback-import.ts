import Papa from 'papaparse'

export type HrFeedbackRow = {
  resumeId: string
  name?: string
  comments: string
  profileUrl?: string
  rowNumber: number
}

type HeaderIndexes = {
  resumeId: number
  name: number
  comments: number
  profileUrl: number
  jobIntention: number
}

const ID_HEADERS = new Set(['id', 'resumeid', 'resume', 'candidateid'])
const NAME_HEADERS = new Set(['name', 'candidatename', '姓名'])
const COMMENT_HEADERS = new Set(['comments', 'comment', 'note', 'notes', 'remarks', 'usercomment', 'feedback', '意見', '备注', '備註'])
const PROFILE_URL_HEADERS = new Set(['profileurl', 'profile_url', 'url', 'profilink', '简历链接'])
const JOB_INTENTION_HEADERS = new Set(['jobintention', 'job_intention', 'intention', '求职意向'])

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_-]/g, '')
}

function detectDelimiter(raw: string): ',' | '\t' {
  const firstDataLine = raw.split(/\r?\n/).find((line) => line.trim().length > 0) ?? ''
  return firstDataLine.includes('\t') ? '\t' : ','
}

function resolveHeaderIndexes(record: string[]): HeaderIndexes | null {
  const normalized = record.map(normalizeHeader)
  const resumeId = normalized.findIndex((value) => ID_HEADERS.has(value))
  if (resumeId < 0) {
    return null
  }

  const name = normalized.findIndex((value) => NAME_HEADERS.has(value))
  const comments = normalized.findIndex((value) => COMMENT_HEADERS.has(value))
  const profileUrl = normalized.findIndex((value) => PROFILE_URL_HEADERS.has(value))
  const jobIntention = normalized.findIndex((value) => JOB_INTENTION_HEADERS.has(value))
  return {
    resumeId,
    name: name >= 0 ? name : 1,
    comments: comments >= 0 ? comments : 2,
    profileUrl,
    jobIntention,
  }
}

function readField(record: string[], index: number): string {
  if (index < 0) {
    return ''
  }
  return record[index]?.trim() ?? ''
}

/**
 * Prefer explicit comment columns. For export CSVs used as HR notes
 * (User Comment empty, notes parked in Job Intention), fall back to job intention.
 */
function resolveComments(record: string[], indexes: HeaderIndexes): string {
  const explicit = readField(record, indexes.comments)
  if (explicit) {
    return explicit
  }
  return readField(record, indexes.jobIntention)
}

export function parseHrFeedbackRows(raw: string): HrFeedbackRow[] {
  const delimiter = detectDelimiter(raw)
  const parsed = Papa.parse<string[]>(raw, {
    delimiter,
    skipEmptyLines: 'greedy',
  })

  if (parsed.errors.length > 0) {
    throw new Error(parsed.errors[0]?.message ?? 'Failed to parse feedback rows')
  }

  const rows: HrFeedbackRow[] = []
  let headerIndexes: HeaderIndexes = {
    resumeId: 0,
    name: 1,
    comments: 2,
    profileUrl: -1,
    jobIntention: -1,
  }

  parsed.data.forEach((record, index) => {
    if (record.every((field) => field.trim().length === 0)) {
      return
    }

    if (rows.length === 0) {
      const resolved = resolveHeaderIndexes(record)
      if (resolved) {
        headerIndexes = resolved
        return
      }
    }

    const resumeId = readField(record, headerIndexes.resumeId)
    const comments = resolveComments(record, headerIndexes)
    const profileUrl = readField(record, headerIndexes.profileUrl) || undefined
    if (!resumeId && !comments && !profileUrl) {
      return
    }

    rows.push({
      resumeId,
      name: readField(record, headerIndexes.name) || undefined,
      comments,
      profileUrl,
      rowNumber: index + 1,
    })
  })

  return rows
}
