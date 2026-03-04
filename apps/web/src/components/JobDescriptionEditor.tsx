import { useEffect, useMemo, useState } from "react"
import { useMutation } from "convex/react"
import { api } from "../../../../packages/convex/convex/_generated/api"
import type { Id } from "../../../../packages/convex/convex/_generated/dataModel"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { useWorkspace } from "@/contexts/WorkspaceContext"
import { useTranslation } from "react-i18next"

const INDUSTRY_TAG_OPTIONS = ["machinery", "cnc", "sales", "automation", "metrology", "software"] as const
const DEFAULT_MIN_EXPERIENCE = 1

type StructuredSeedFields = {
    location?: string
    industryTags?: string[]
    minExperience?: number
    minAge?: number
    maxAge?: number
}

type JdContentFields = {
    title: string
    location?: string
    industryTags?: string[]
    minExperience?: number
    minAge?: number
    maxAge?: number
}

function normalizeOptionalString(value: string | undefined): string | undefined {
    if (!value) {
        return undefined
    }
    const normalized = value.trim()
    return normalized.length > 0 ? normalized : undefined
}

function parseOptionalNumber(value: string): number | undefined {
    const normalized = value.trim()
    if (!normalized) {
        return undefined
    }
    const parsed = Number(normalized)
    if (!Number.isFinite(parsed)) {
        return undefined
    }
    return Math.trunc(parsed)
}

function sanitizeIndustryTags(values: string[] | undefined): string[] {
    if (!Array.isArray(values)) {
        return []
    }

    const allowed = new Set<string>(INDUSTRY_TAG_OPTIONS)
    const selected = new Set<string>()
    values.forEach((value) => {
        const token = value.trim()
        if (allowed.has(token)) {
            selected.add(token)
        }
    })
    return Array.from(selected)
}

function hasStructuredSeedFields(fields: StructuredSeedFields | undefined): boolean {
    if (!fields) {
        return false
    }

    if (normalizeOptionalString(fields.location)) {
        return true
    }

    if ((fields.industryTags?.length ?? 0) > 0) {
        return true
    }

    return (
        typeof fields.minExperience === "number"
        || typeof fields.minAge === "number"
        || typeof fields.maxAge === "number"
    )
}

function toYamlString(value: string): string {
    return JSON.stringify(value)
}

function extractTitleKeywords(title: string): string[] {
    const normalized = title.trim()
    if (!normalized) {
        return []
    }

    const parts = normalized
        .split(/[\s,，、|/()（）]+/)
        .map((part) => part.trim())
        .filter((part) => part.length > 0)
    const unique = new Set<string>()

    parts.forEach((part) => {
        if (/^[a-z0-9#+.-]+$/i.test(part)) {
            unique.add(part.toUpperCase())
            return
        }

        if (part.length >= 2) {
            unique.add(part)
        }
    })

    if (unique.size === 0) {
        unique.add(normalized)
    }

    return Array.from(unique).slice(0, 8)
}

function generateJdContent(fields: JdContentFields): string {
    const title = fields.title.trim()
    const location = normalizeOptionalString(fields.location)
    const industryTags = sanitizeIndustryTags(fields.industryTags)
    const minExperience = fields.minExperience ?? DEFAULT_MIN_EXPERIENCE
    const minAge = fields.minAge
    const maxAge = fields.maxAge
    const keywords = extractTitleKeywords(title)

    const lines: string[] = [
        "---",
        `title: ${toYamlString(title)}`,
        "status: active",
    ]

    if (location) {
        lines.push(`location: ${toYamlString(location)}`)
    }

    if (industryTags.length > 0) {
        lines.push("industry_tags:")
        industryTags.forEach((tag) => {
            lines.push(`  - ${toYamlString(tag)}`)
        })
    }

    lines.push("auto_match:")
    lines.push("  keywords:")
    keywords.forEach((keyword) => {
        lines.push(`    - ${toYamlString(keyword)}`)
    })
    lines.push("  locations:")
    if (location) {
        lines.push(`    - ${toYamlString(location)}`)
    }
    lines.push("  priority: 60")
    lines.push("  suggested_filters:")
    lines.push(`    minExperience: ${minExperience}`)
    if (typeof minAge === "number") {
        lines.push(`    minAge: ${minAge}`)
    }
    if (typeof maxAge === "number") {
        lines.push(`    maxAge: ${maxAge}`)
    }

    lines.push("---")
    lines.push("")
    lines.push("# 职位描述")
    lines.push("")
    lines.push(`请补充「${title}」的岗位职责。`)
    lines.push("")
    lines.push("# 任职要求")
    lines.push("")
    lines.push(`- 相关经验：${minExperience}+ 年`)
    if (typeof minAge === "number" || typeof maxAge === "number") {
        const min = typeof minAge === "number" ? minAge : "-"
        const max = typeof maxAge === "number" ? maxAge : "-"
        lines.push(`- 年龄范围：${min}-${max}`)
    }
    if (industryTags.length > 0) {
        lines.push(`- 行业方向：${industryTags.join(" / ")}`)
    }
    lines.push("")
    lines.push("# 关键词")
    lines.push("")
    lines.push(keywords.join(", "))

    return lines.join("\n")
}

interface JobDescriptionEditorProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    initialData?: {
        id?: Id<'job_descriptions'> // If editing existing custom JD
        title: string
        content: string
        type: "system" | "custom"
    } & StructuredSeedFields
    onSaveSuccess?: (newId: string) => void
}

export function JobDescriptionEditor({ open, onOpenChange, initialData, onSaveSuccess }: JobDescriptionEditorProps) {
    const { t } = useTranslation()
    const { slug } = useWorkspace()
    const createJD = useMutation(api.job_descriptions.create)
    const updateJD = useMutation(api.job_descriptions.update)

    const [title, setTitle] = useState("")
    const [location, setLocation] = useState("")
    const [industryTags, setIndustryTags] = useState<string[]>([])
    const [minExperience, setMinExperience] = useState(String(DEFAULT_MIN_EXPERIENCE))
    const [minAge, setMinAge] = useState("")
    const [maxAge, setMaxAge] = useState("")
    const [content, setContent] = useState("")
    const [loading, setLoading] = useState(false)
    const [advancedMode, setAdvancedMode] = useState(false)
    const [advancedContentTouched, setAdvancedContentTouched] = useState(false)

    const parsedMinExperience = parseOptionalNumber(minExperience)
    const parsedMinAge = parseOptionalNumber(minAge)
    const parsedMaxAge = parseOptionalNumber(maxAge)
    const normalizedMinExperience = useMemo(() => {
        if (typeof parsedMinExperience !== "number") {
            return DEFAULT_MIN_EXPERIENCE
        }
        return Math.max(parsedMinExperience, DEFAULT_MIN_EXPERIENCE)
    }, [parsedMinExperience])

    useEffect(() => {
        if (open && initialData) {
            const hasStructured = hasStructuredSeedFields(initialData)
            const defaultMinExperience = hasStructured ? String(DEFAULT_MIN_EXPERIENCE) : ""
            setTitle(initialData.title + (initialData.type === "system" ? " (Custom Copy)" : ""))
            setLocation(initialData.location ?? "")
            setIndustryTags(sanitizeIndustryTags(initialData.industryTags))
            setMinExperience(typeof initialData.minExperience === "number" ? String(initialData.minExperience) : defaultMinExperience)
            setMinAge(typeof initialData.minAge === "number" ? String(initialData.minAge) : "")
            setMaxAge(typeof initialData.maxAge === "number" ? String(initialData.maxAge) : "")
            setContent(initialData.content)
            setAdvancedMode(!hasStructured)
            setAdvancedContentTouched(!hasStructured)
        } else if (open) {
            setTitle("")
            setLocation("")
            setIndustryTags([])
            setMinExperience(String(DEFAULT_MIN_EXPERIENCE))
            setMinAge("")
            setMaxAge("")
            setContent("")
            setAdvancedMode(false)
            setAdvancedContentTouched(false)
        }
    }, [open, initialData])

    const toggleIndustryTag = (tag: string) => {
        setIndustryTags((current) => {
            if (current.includes(tag)) {
                return current.filter((item) => item !== tag)
            }
            return [...current, tag]
        })
    }

    const toggleAdvancedMode = () => {
        setAdvancedMode((current) => {
            if (!current && !advancedContentTouched) {
                setContent(generateJdContent({
                    title: title.trim(),
                    location,
                    industryTags,
                    minExperience: normalizedMinExperience,
                    minAge: parsedMinAge,
                    maxAge: parsedMaxAge,
                }))
            }
            return !current
        })
    }

    const handleSave = async () => {
        const normalizedTitle = title.trim()
        if (!normalizedTitle) {
            return
        }

        const normalizedLocation = normalizeOptionalString(location)
        const normalizedIndustryTags = sanitizeIndustryTags(industryTags)
        const normalizedMinAge = typeof parsedMinAge === "number" ? Math.max(parsedMinAge, 0) : undefined
        const normalizedMaxAge = typeof parsedMaxAge === "number" ? Math.max(parsedMaxAge, 0) : undefined
        const generatedContent = generateJdContent({
            title: normalizedTitle,
            location: normalizedLocation,
            industryTags: normalizedIndustryTags,
            minExperience: normalizedMinExperience,
            minAge: normalizedMinAge,
            maxAge: normalizedMaxAge,
        })
        const contentToSave = advancedMode ? content : generatedContent
        if (!contentToSave.trim()) {
            return
        }

        setLoading(true)
        try {
            const payload = {
                title: normalizedTitle,
                content: contentToSave,
                location: normalizedLocation,
                industryTags: normalizedIndustryTags.length > 0 ? normalizedIndustryTags : undefined,
                minExperience: advancedMode
                    ? (typeof parsedMinExperience === "number" ? Math.max(parsedMinExperience, 0) : undefined)
                    : normalizedMinExperience,
                minAge: normalizedMinAge,
                maxAge: normalizedMaxAge,
            }

            let newId
            if (initialData?.type === "custom" && initialData.id) {
                await updateJD({
                    id: initialData.id,
                    ...payload,
                })
                newId = initialData.id
            } else {
                newId = await createJD({
                    ...payload,
                    type: "custom",
                    workspaceSlug: slug,
                })
            }
            onSaveSuccess?.(newId)
            onOpenChange(false)
        } catch (error) {
            console.error("Failed to save JD", error)
        } finally {
            setLoading(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[600px]">
                <DialogHeader>
                    <DialogTitle>{initialData?.type === "custom" ? t("jdEditor.editTitle", "Edit Job Description") : t("jdEditor.createTitle", "Create Custom Job Description")}</DialogTitle>
                    <DialogDescription>
                        {t("jdEditor.description", "Define role requirements and matching criteria for better AI analysis.")}
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="grid gap-2">
                        <Label htmlFor="title">{t("jdEditor.post", "Job Title")}</Label>
                        <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("jdEditor.postPlaceholder", "e.g. Senior Backend Engineer")} />
                    </div>

                    <div className="grid gap-2">
                        <Label htmlFor="location">{t("jdEditor.location", "Location")}</Label>
                        <Input id="location" value={location} onChange={(e) => setLocation(e.target.value)} placeholder={t("jdEditor.locationPlaceholder", "e.g. Dongguan")} />
                    </div>

                    <div className="grid gap-2">
                        <Label>{t("jdEditor.industryTags", "Industry Tags")}</Label>
                        <div className="flex flex-wrap gap-2">
                            {INDUSTRY_TAG_OPTIONS.map((tag) => {
                                const selected = industryTags.includes(tag)
                                return (
                                    <button
                                        key={tag}
                                        type="button"
                                        onClick={() => toggleIndustryTag(tag)}
                                        className={`rounded-full border px-3 py-1 text-xs transition-colors ${selected ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"}`}
                                    >
                                        {selected ? "✓ " : ""}{tag}
                                    </button>
                                )
                            })}
                        </div>
                    </div>

                    <div className="grid gap-2">
                        <Label htmlFor="minExperience">{t("jdEditor.relatedExp", "Related Experience")}</Label>
                        <div className="flex items-center gap-2">
                            <Input
                                id="minExperience"
                                type="number"
                                min={0}
                                value={minExperience}
                                onChange={(e) => setMinExperience(e.target.value)}
                                className="w-28"
                            />
                            <span className="text-sm text-muted-foreground">{t("jdEditor.years", "yrs")}</span>
                            <span className="text-xs text-muted-foreground">{t("jdEditor.defaultExp", "Default: min 1 year")}</span>
                        </div>
                    </div>

                    <div className="grid gap-2">
                        <div className="grid grid-cols-2 gap-3">
                            <div className="grid gap-2">
                                <Label htmlFor="minAge">{t("jdEditor.minAge", "Min Age")}</Label>
                                <Input
                                    id="minAge"
                                    type="number"
                                    min={0}
                                    value={minAge}
                                    onChange={(e) => setMinAge(e.target.value)}
                                />
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="maxAge">{t("jdEditor.maxAge", "Max Age")}</Label>
                                <Input
                                    id="maxAge"
                                    type="number"
                                    min={0}
                                    value={maxAge}
                                    onChange={(e) => setMaxAge(e.target.value)}
                                />
                            </div>
                        </div>
                    </div>

                    <div className="pt-1">
                        <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={toggleAdvancedMode}>
                            {advancedMode ? t("jdEditor.simpleMode", "Basic Info") : t("jdEditor.advancedMode", "Advanced")}
                        </Button>
                    </div>

                    {advancedMode && (
                        <div className="grid gap-2">
                            <Label htmlFor="content">{t("jdEditor.advancedMode", "Advanced")}</Label>
                            <Textarea
                                id="content"
                                value={content}
                                onChange={(e) => {
                                    setContent(e.target.value)
                                    setAdvancedContentTouched(true)
                                }}
                                placeholder={t("jdEditor.contentPlaceholder", "Paste the job description markdown here...")}
                                className="min-h-[280px] font-mono text-sm"
                            />
                        </div>
                    )}
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>{t("jdManagement.cancel", "Cancel")}</Button>
                    <Button onClick={handleSave} disabled={loading}>{loading ? t("searchProfiles.saving", "Saving...") : t("searchProfiles.save", "Save")}</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
