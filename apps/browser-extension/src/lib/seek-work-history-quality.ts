const SEEK_WORK_HISTORY_LABEL_PATTERN =
  /\b(?:key\s+)?(?:responsibilit(?:y|ies)|accomplishments?|achievements?|duties)\b/giu;

export function isMeaningfulSeekWorkHistoryDescription(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return false;

  const contentWithoutSectionLabels = normalized
    .replace(SEEK_WORK_HISTORY_LABEL_PATTERN, "")
    .replace(/[\s:：;；,，/|·•\-–—]+/gu, "");

  return contentWithoutSectionLabels.length > 0;
}
