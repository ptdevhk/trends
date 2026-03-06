import { useState } from "react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { ChevronDown, ChevronUp } from "lucide-react"
import { useIndustryKeywords } from "@/hooks/useIndustryKeywords"

interface LocationSelectorProps {
    value: string
    onChange: (value: string) => void
    placeholder?: string
    id?: string
}

export function LocationSelector({ value, onChange, placeholder, id }: LocationSelectorProps) {
    const { grouped } = useIndustryKeywords()
    const availableLocationKeywords = grouped.location || []
    const [expanded, setExpanded] = useState(false)

    return (
        <div className="grid gap-2">
            <div className="flex gap-2 relative">
                <Input
                    id={id}
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    placeholder={placeholder}
                />
                {availableLocationKeywords.length > 0 && (
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="absolute right-0 top-0 h-9 w-9 text-muted-foreground hover:bg-transparent"
                        onClick={() => setExpanded(!expanded)}
                    >
                        {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </Button>
                )}
            </div>
            {availableLocationKeywords.length > 0 && expanded && (
                <div className="flex flex-wrap gap-2 mt-1">
                    {availableLocationKeywords.map((tagObj) => {
                        const tag = tagObj.keyword
                        const selected = value.trim() === tag
                        return (
                            <button
                                key={tag}
                                type="button"
                                onClick={() => onChange(selected ? "" : tag)}
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
