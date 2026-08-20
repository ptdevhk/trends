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
import { LocationSelector } from "@/components/LocationSelector"
import { KeywordInput } from "@/components/KeywordInput"
import {
    CANONICAL_INDUSTRY_TAGS,
    DEFAULT_MIN_EXPERIENCE,
    formatKeywordInput,
    generateStructuredJobDescriptionContent,
    normalizeOptionalString,
    parseKeywordQuery,
} from "@trends/shared"
import {
    hasStructuredSeedFields,
    parseOptionalNumber,
    sanitizeIndustryTags,
    type StructuredSeedFields,
} from "@/lib/jd-editor-utils"
import { reportUiError } from '@/lib/ui-error-reporting'
import { toast } from 'sonner'
import { isImeComposition } from '@/lib/utils'

const INDUSTRY_TAG_OPTIONS = CANONICAL_INDUSTRY_TAGS

interface JobDescriptionEditorProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    initialData?: {
        id?: Id<'job_descriptions'> // If editing existing custom JD
        title: string
        content: string
        type: "system" | "custom"
    } & StructuredSeedFields
    onSaveSuccess?: (newId: string, savedFields?: StructuredSeedFields & { title?: string, customKeywords?: string[] }) => void
}

export function JobDescriptionEditor({ open, onOpenChange, initialData, onSaveSuccess }: JobDescriptionEditorProps) {
    const { t } = useTranslation()
    const { slug } = useWorkspace()
    const createJD = useMutation(api.job_descriptions.create)
    const updateJD = useMutation(api.job_descriptions.update)

    const [title, setTitle] = useState("")
    const [location, setLocation] = useState("")
    const [industryTags, setIndustryTags] = useState<string[]>([])
    const [customKeywordsText, setCustomKeywordsText] = useState("")
    const customKeywords = useMemo(() => parseKeywordQuery(customKeywordsText).keywords, [customKeywordsText])

    const [minExperience, setMinExperience] = useState(String(DEFAULT_MIN_EXPERIENCE))
    const [maxExperience, setMaxExperience] = useState("")
    const [minAge, setMinAge] = useState("")
    const [maxAge, setMaxAge] = useState("")
    const [content, setContent] = useState("")
    const [loading, setLoading] = useState(false)
    const [titleError, setTitleError] = useState<string | null>(null)
    const [contentError, setContentError] = useState<string | null>(null)
    const [advancedMode, setAdvancedMode] = useState(false)
    const [advancedContentTouched, setAdvancedContentTouched] = useState(false)

    const parsedMinExperience = parseOptionalNumber(minExperience)
    const parsedMaxExperience = parseOptionalNumber(maxExperience)
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
            setCustomKeywordsText(formatKeywordInput(initialData.customKeywords ?? []))
            setMinExperience(typeof initialData.minExperience === "number" ? String(initialData.minExperience) : defaultMinExperience)
            setMaxExperience(typeof initialData.maxExperience === "number" ? String(initialData.maxExperience) : "")
            setMinAge(typeof initialData.minAge === "number" ? String(initialData.minAge) : "")
            setMaxAge(typeof initialData.maxAge === "number" ? String(initialData.maxAge) : "")
            setContent(initialData.content)
            setAdvancedMode(!hasStructured)
            setAdvancedContentTouched(!hasStructured)
        } else if (open) {
            setTitle("")
            setLocation("")
            setIndustryTags([])
            setCustomKeywordsText("")
            setMinExperience(String(DEFAULT_MIN_EXPERIENCE))
            setMaxExperience("")
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
                setContent(generateStructuredJobDescriptionContent({
                    title: title.trim(),
                    location,
                    industryTags,
                    customKeywords,
                    minExperience: normalizedMinExperience,
                    maxExperience: parsedMaxExperience,
                    minAge: parsedMinAge,
                    maxAge: parsedMaxAge,
                }))
            }
            return !current
        })
    }

    const handleSave = async () => {
        setTitleError(null)
        setContentError(null)

        const normalizedTitle = title.trim()
        if (!normalizedTitle) {
            setTitleError(t('jdEditor.titleRequired', { defaultValue: 'Job title is required' }))
            return
        }

        const normalizedLocation = normalizeOptionalString(location)
        const normalizedIndustryTags = sanitizeIndustryTags(industryTags)
        const normalizedMaxExperience = typeof parsedMaxExperience === "number" ? Math.max(parsedMaxExperience, 0) : undefined
        const normalizedMinAge = typeof parsedMinAge === "number" ? Math.max(parsedMinAge, 0) : undefined
        const normalizedMaxAge = typeof parsedMaxAge === "number" ? Math.max(parsedMaxAge, 0) : undefined
        const generatedContent = generateStructuredJobDescriptionContent({
            title: normalizedTitle,
            location: normalizedLocation,
            industryTags: normalizedIndustryTags,
            customKeywords: customKeywords,
            minExperience: normalizedMinExperience,
            maxExperience: normalizedMaxExperience,
            minAge: normalizedMinAge,
            maxAge: normalizedMaxAge,
        })
        const contentToSave = advancedMode ? content : generatedContent
        if (!contentToSave.trim()) {
            setContentError(t('jdEditor.contentRequired', { defaultValue: 'Job description content is required' }))
            return
        }

        setLoading(true)
        try {
            const payload = {
                title: normalizedTitle,
                content: contentToSave,
                location: normalizedLocation,
                industryTags: normalizedIndustryTags.length > 0 ? normalizedIndustryTags : undefined,
                customKeywords: customKeywords.length > 0 ? customKeywords : undefined,
                minExperience: advancedMode
                    ? (typeof parsedMinExperience === "number" ? Math.max(parsedMinExperience, 0) : undefined)
                    : normalizedMinExperience,
                maxExperience: advancedMode
                    ? (typeof parsedMaxExperience === "number" ? Math.max(parsedMaxExperience, 0) : undefined)
                    : normalizedMaxExperience,
                minAge: normalizedMinAge,
                maxAge: normalizedMaxAge,
            }

            let newId
            if (initialData?.type === "custom" && initialData.id) {
                await updateJD({
                    id: initialData.id,
                    ...payload,
                    location: payload.location ?? null,
                    industryTags: payload.industryTags ?? null,
                    customKeywords: payload.customKeywords ?? null,
                    minExperience: payload.minExperience ?? null,
                    maxExperience: payload.maxExperience ?? null,
                    minAge: payload.minAge ?? null,
                    maxAge: payload.maxAge ?? null,
                })
                newId = initialData.id
            } else {
                newId = await createJD({
                    ...payload,
                    type: "custom",
                    workspaceSlug: slug,
                })
            }
            onSaveSuccess?.(newId, {
                title: payload.title,
                location: payload.location,
                industryTags: payload.industryTags,
                customKeywords: payload.customKeywords,
                minExperience: payload.minExperience,
                maxExperience: payload.maxExperience,
                minAge: payload.minAge,
                maxAge: payload.maxAge,
            })
            onOpenChange(false)
        } catch (error) {
            reportUiError("Failed to save JD", error)
            toast.error(error instanceof Error ? error.message : t('jdEditor.saveFailed', { defaultValue: 'Failed to save job description' }))
        } finally {
            setLoading(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{initialData?.type === "custom" ? t("jdEditor.editTitle", { defaultValue: "Edit Job Description" }) : t("jdEditor.createTitle", { defaultValue: "Create Custom Job Description" })}</DialogTitle>
                    <DialogDescription>
                        {t("jdEditor.description", { defaultValue: "Define role requirements and matching criteria for better AI analysis." })}
                    </DialogDescription>
                </DialogHeader>
                <form
                    onSubmit={(event) => { event.preventDefault(); void handleSave() }}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter' && isImeComposition(event)) {
                            event.preventDefault()
                        }
                    }}
                >
                <div className="grid gap-4 py-4">
                    <div className="grid gap-2">
                        <Label htmlFor="title">{t("jdEditor.post", { defaultValue: "Job Title" })}</Label>
                        <Input id="title" value={title} autoFocus onChange={(e) => { setTitle(e.target.value); setTitleError(null) }} placeholder={t("jdEditor.postPlaceholder", { defaultValue: "e.g. Senior Backend Engineer" })} aria-invalid={titleError ? true : undefined} aria-describedby={titleError ? "title-error" : undefined} />
                        {titleError ? (
                            <p id="title-error" role="alert" className="text-xs font-medium text-destructive">{titleError}</p>
                        ) : null}
                    </div>

                    <div className="grid gap-2">
                        <Label htmlFor="location">{t("jdEditor.location", { defaultValue: "地区" })}</Label>
                        <LocationSelector
                            id="location"
                            value={location}
                            onChange={setLocation}
                            placeholder={t("jdEditor.locationPlaceholder", { defaultValue: "e.g. Dongguan" })}
                        />
                    </div>

                    <div className="grid gap-2">
                        <Label>{t("jdEditor.industryTags", { defaultValue: "Industry Tags" })}</Label>
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
                        <Label>{t("jdEditor.customKeywords", { defaultValue: "关键词" })}</Label>
                        <KeywordInput
                            value={customKeywordsText}
                            onChange={setCustomKeywordsText}
                            placeholder={t("jdEditor.customKeywordsPlaceholder", { defaultValue: "e.g. 机床 车床" })}
                        />
                    </div>

                    <div className="grid gap-2">
                        <div className="grid grid-cols-2 gap-3">
                            <div className="grid gap-2">
                                <Label htmlFor="minExperience">{t("jdEditor.minRelatedExp", { defaultValue: "最低相关经验(年)" })}</Label>
                                <Input
                                    id="minExperience"
                                    type="number"
                                    min={0}
                                    value={minExperience}
                                    onChange={(e) => setMinExperience(e.target.value)}
                                />
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="maxExperience">{t("jdEditor.maxRelatedExp", { defaultValue: "最高相关经验(年)" })}</Label>
                                <Input
                                    id="maxExperience"
                                    type="number"
                                    min={0}
                                    value={maxExperience}
                                    onChange={(e) => setMaxExperience(e.target.value)}
                                />
                            </div>
                        </div>
                        <span className="text-xs text-muted-foreground">{t("jdEditor.defaultExp", { defaultValue: "Default: min 1 year" })}</span>
                    </div>

                    <div className="grid gap-2">
                        <div className="grid grid-cols-2 gap-3">
                            <div className="grid gap-2">
                                <Label htmlFor="minAge">{t("jdEditor.minAge", { defaultValue: "Min Age" })}</Label>
                                <Input
                                    id="minAge"
                                    type="number"
                                    min={0}
                                    value={minAge}
                                    onChange={(e) => setMinAge(e.target.value)}
                                />
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="maxAge">{t("jdEditor.maxAge", { defaultValue: "Max Age" })}</Label>
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
                            {advancedMode ? t("jdEditor.simpleMode", { defaultValue: "Basic Info" }) : t("jdEditor.advancedMode", { defaultValue: "Advanced" })}
                        </Button>
                    </div>

                    {advancedMode && (
                        <div className="grid gap-2">
                            <Label htmlFor="content">{t("jdEditor.advancedMode", { defaultValue: "Advanced" })}</Label>
                            <Textarea
                                id="content"
                                value={content}
                                onChange={(e) => {
                                    setContent(e.target.value)
                                    setAdvancedContentTouched(true)
                                    setContentError(null)
                                }}
                                placeholder={t("jdEditor.contentPlaceholder", { defaultValue: "Paste the job description markdown here..." })}
                                className="min-h-[280px] font-mono text-sm"
                                aria-invalid={contentError ? true : undefined}
                                aria-describedby={contentError ? "content-error" : undefined}
                            />
                            {contentError ? (
                                <p id="content-error" role="alert" className="text-xs font-medium text-destructive">{contentError}</p>
                            ) : null}
                        </div>
                    )}
                </div>
                <DialogFooter>
                    <Button variant="outline" type="button" onClick={() => onOpenChange(false)}>{t("jdManagement.cancel", { defaultValue: "Cancel" })}</Button>
                    <Button type="submit" disabled={loading}>{loading ? t("searchProfiles.saving", { defaultValue: "Saving..." }) : t("searchProfiles.save", { defaultValue: "Save" })}</Button>
                </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}
