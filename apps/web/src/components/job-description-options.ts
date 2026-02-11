export interface JobDescriptionOption {
  value: string
  label: string
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
}

export function buildJobDescriptionOptions({
  placeholderLabel,
  convexJobDescriptions,
  systemJobDescriptions,
}: BuildJobDescriptionOptionsParams): JobDescriptionOption[] {
  const customOptions = convexJobDescriptions
    .filter((item) => item.type === 'custom' && item.enabled !== false)
    .map((item) => ({
      value: item._id,
      label: `✨ ${item.title} (Custom)`,
    }))

  const systemOptions = systemJobDescriptions.map((item) => ({
    value: item.name,
    label: `${item.title || item.name} (System)`,
  }))

  return [
    { value: '', label: placeholderLabel },
    ...customOptions,
    ...systemOptions,
  ]
}
