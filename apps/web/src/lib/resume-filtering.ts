type ResumeAgeLike = {
  age?: unknown
  ageNumber?: number
}

export function parseExperienceYears(value: string | undefined): number {
  if (!value) {
    return 0
  }

  // Recognize zero-experience patterns (Chinese + English)
  if (/应届|无经验|fresh grad|entry level|no experience|fresh graduate|beginner/i.test(value)) {
    return 0
  }

  const matched = value.match(/\d+(?:\.\d+)?/)
  if (!matched) {
    return 0
  }

  const parsed = Number(matched[0])
  return Number.isFinite(parsed) ? parsed : 0
}

function parseResumeAgeNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.trunc(value)
  }
  if (typeof value !== 'string') {
    return null
  }

  const withSuffix = value.match(/(\d+)\s*岁/)
  if (withSuffix?.[1]) {
    const parsed = Number(withSuffix[1])
    return Number.isFinite(parsed) ? parsed : null
  }

  const plain = value.match(/^(\d{1,3})$/)
  if (plain?.[1]) {
    const parsed = Number(plain[1])
    return Number.isFinite(parsed) ? parsed : null
  }

  return null
}

export function getResumeAge(resume: ResumeAgeLike): number | null {
  if (typeof resume.ageNumber === 'number' && Number.isFinite(resume.ageNumber) && resume.ageNumber > 0) {
    return Math.trunc(resume.ageNumber)
  }

  return parseResumeAgeNumber(resume.age)
}
