export function normalizeResumeText(value) {
  return typeof value === "string"
    ? value.replace(/[\u3000\s]+/g, " ").trim()
    : "";
}

export function stripHtmlTags(value) {
  return typeof value === "string" ? value.replace(/<[^>]*>/g, " ") : "";
}

export function normalizeResumeMultilineText(value) {
  if (typeof value !== "string") return "";
  return value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[\u3000\t ]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

export function buildWorkHistoryRawParts(parts) {
  return parts.filter(Boolean).join(" · ");
}
