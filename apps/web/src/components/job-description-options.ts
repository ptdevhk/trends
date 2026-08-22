export interface JobDescriptionOption {
  value: string
  label: string
  /** Translated optgroup label; options with the same group render as one <optgroup>. */
  group?: string
}

export interface SystemJobDescriptionItem {
  name: string
  title?: string
}

export interface ConvexJobDescriptionItem {
  _id: string
  title: string
  type: string
  enabled?: boolean
}

interface BuildJobDescriptionOptionsParams {
  placeholderLabel: string
  convexJobDescriptions: ConvexJobDescriptionItem[]
  systemJobDescriptions: SystemJobDescriptionItem[]
  customLabel: string
  systemLabel: string
}

export function buildJobDescriptionOptions({
  placeholderLabel,
  convexJobDescriptions,
  systemJobDescriptions,
  customLabel,
  systemLabel,
}: BuildJobDescriptionOptionsParams): JobDescriptionOption[] {
  const customOptions = convexJobDescriptions
    .filter((item) => item.type === 'custom' && item.enabled !== false)
    .map((item) => ({
      value: item._id,
      label: `✨ ${item.title}`,
      group: customLabel,
    }))

  const systemOptions = systemJobDescriptions.map((item) => ({
    value: item.name,
    label: `${item.title || item.name}`,
    group: systemLabel,
  }))

  return [
    { value: '', label: placeholderLabel },
    ...customOptions,
    ...systemOptions,
  ]
}
