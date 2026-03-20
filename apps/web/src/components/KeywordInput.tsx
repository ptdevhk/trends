import { formatKeywordInput, normalizeKeywordPhrases, parseKeywordQuery } from "@trends/shared"
import { useMemo, useState } from "react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { ChevronDown, ChevronUp } from "lucide-react"
import { useIndustryKeywords } from "@/hooks/useIndustryKeywords"

interface KeywordInputProps {
    value: string
    onChange: (value: string) => void
    placeholder?: string
    id?: string
}

export function KeywordInput({ value, onChange, placeholder, id }: KeywordInputProps) {
    const { grouped } = useIndustryKeywords()
    const availableCustomKeywords = grouped.custom || []
    const [expanded, setExpanded] = useState(false)

    const activeKeywords = useMemo(() => parseKeywordQuery(value).keywords, [value])

    const toggleKeyword = (keyword: string) => {
        const normalizedKeyword = keyword.trim()
        if (!normalizedKeyword) {
            return
        }

        if (activeKeywords.includes(normalizedKeyword)) {
            onChange(formatKeywordInput(activeKeywords.filter((k) => k !== normalizedKeyword)))
            return
        }

        onChange(formatKeywordInput(normalizeKeywordPhrases([...activeKeywords, normalizedKeyword])))
    }

    return (
        <div className="grid gap-2">
            <div className="flex gap-2 relative">
                <Input
                    id={id}
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    placeholder={placeholder}
                />
                {availableCustomKeywords.length > 0 && (
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
            {availableCustomKeywords.length > 0 && (
                <div
                    className={`flex flex-wrap gap-2 mt-1 relative overflow-hidden transition-[max-height] duration-200 ease-in-out ${expanded ? "max-h-[500px]" : "max-h-[30px]"}`}
                >
                    {availableCustomKeywords.map((tagObj) => {
                        const tag = tagObj.keyword
                        const selected = activeKeywords.includes(tag)
                        return (
                            <button
                                key={tag}
                                type="button"
                                onClick={() => toggleKeyword(tag)}
                                className={`rounded-full border px-3 py-1 text-xs transition-colors ${selected ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"}`}
                            >
                                {selected ? "✓ " : ""}{tag}
                            </button>
                        )
                    })}
                </div>
            )}
        </div>
    )
}
