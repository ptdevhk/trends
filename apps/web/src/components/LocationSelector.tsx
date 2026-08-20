import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { ChevronDown, ChevronUp, X } from "lucide-react"
import { useIndustryKeywords } from "@/hooks/useIndustryKeywords"

interface LocationSelectorProps {
    value: string
    onChange: (value: string) => void
    placeholder?: string
    id?: string
}

export function LocationSelector({ value, onChange, placeholder, id }: LocationSelectorProps) {
    const { t } = useTranslation()
    const { grouped } = useIndustryKeywords()
    const availableLocationKeywords = grouped.location || []
    const [expanded, setExpanded] = useState(false)

    const activeLocations = useMemo(() => {
        return value
            .split(/[\s,，、]+/)
            .map((loc) => loc.trim())
            .filter((loc) => loc.length > 0)
    }, [value])

    const toggleLocation = (locationTag: string) => {
        if (activeLocations.includes(locationTag)) {
            const newLocations = activeLocations.filter((l) => l !== locationTag)
            onChange(newLocations.join(","))
        } else {
            const suffix = value.trim().length > 0 ? "," : ""
            let newValue = value.trim()
            if (newValue.endsWith(',') || newValue.endsWith('，') || newValue.endsWith('、')) {
                newValue = newValue + locationTag
            } else {
                newValue = newValue + suffix + locationTag
            }
            onChange(newValue)
        }
    }

    return (
        <div className="grid gap-2">
            <div className="flex gap-2 relative">
                <Input
                    id={id}
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    placeholder={placeholder}
                    className="pr-16"
                />
                {value.trim().length > 0 && (
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        data-testid="location-clear-button"
                        className="absolute right-9 top-0 h-9 w-9 text-muted-foreground hover:bg-transparent"
                        onClick={() => onChange('')}
                        aria-label={t('quickStart.clearLocations', { defaultValue: 'Clear locations' })}
                    >
                        <X className="h-4 w-4" />
                    </Button>
                )}
                {availableLocationKeywords.length > 0 && (
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="absolute right-0 top-0 h-9 w-9 text-muted-foreground hover:bg-transparent"
                        onClick={() => setExpanded(!expanded)}
                        aria-expanded={expanded}
                        aria-controls="location-keywords-tray"
                        aria-label={expanded
                            ? t('quickStart.hideLocationKeywords', { defaultValue: 'Hide location keywords' })
                            : t('quickStart.showLocationKeywords', { defaultValue: 'Show location keywords' })}
                    >
                        {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        {activeLocations.length > 0 && (
                            <span data-testid="location-count-badge" className="ml-1 rounded-full bg-green-600 px-1.5 text-[10px] text-white leading-4">
                                {activeLocations.length}
                            </span>
                        )}
                    </Button>
                )}
            </div>
            {availableLocationKeywords.length > 0 && (
                <div
                    id="location-keywords-tray"
                    className={`flex flex-wrap gap-2 mt-1 relative overflow-hidden transition-[max-height] duration-200 ease-in-out ${expanded ? "max-h-[500px]" : "max-h-[30px]"}`}
                >
                    {availableLocationKeywords.map((tagObj) => {
                        const tag = tagObj.keyword
                        const selected = activeLocations.includes(tag)
                        return (
                            <button
                                key={tag}
                                type="button"
                                onClick={() => toggleLocation(tag)}
                                aria-pressed={selected}
                                className={`rounded-full border px-3 py-1 text-xs transition-colors ${selected ? "border-green-700 bg-green-600 text-white" : "border-green-300 text-green-700 hover:bg-green-50"}`}
                            >
                                {tag}
                            </button>
                        )
                    })}
                </div>
            )}
        </div>
    )
}
