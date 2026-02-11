/**
 * QuickStartPanel - Minimal Human-in-the-Loop Input
 * 
 * User provides only: Location + Keywords
 * System auto-matches: JD → Filter Preset → Suggested Filters
 */

import { useState, useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Settings2, FilePlus } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useQuery } from 'convex/react'
import { api } from '../../../../packages/convex/convex/_generated/api'
import type { Id } from '../../../../packages/convex/convex/_generated/dataModel'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { JobDescriptionEditor } from './JobDescriptionEditor'
import { JobDescriptionSelect } from './JobDescriptionSelect'
import { KeywordChips } from './KeywordChips'

const API_BASE = import.meta.env.VITE_API_URL || ''

// Common locations for precision machinery industry
const COMMON_LOCATIONS = [
    '广东',
    '东莞', '深圳', '广州', '佛山', '惠州',
    '苏州', '无锡', '常州', '昆山', '上海'
]

function toJobDescriptionId(value: string): Id<'job_descriptions'> | null {
    if (value.length <= 20 || value.includes('-')) {
        return null
    }
    return value as Id<'job_descriptions'>
}

interface AutoMatchResult {
    matched?: string
    title?: string
    confidence: number
    matchedKeywords: string[]
    filterPreset?: string
    suggestedFilters?: {
        minExperience?: number
        maxExperience?: number | null
        education?: string[]
        salaryRange?: { min?: number; max?: number }
    }
}

interface QuickStartPanelProps {
    onApplyConfig?: (config: {
        location: string
        keywords: string[]
        jobDescriptionId?: string
        filterPreset?: string
        filters?: AutoMatchResult['suggestedFilters']
    }) => void
    defaultLocation?: string
    defaultKeywords?: string[]
    jobDescriptionId?: string
    onJobChange?: (value: string) => void
}

export function QuickStartPanel({
    onApplyConfig,
    defaultLocation = '广东',
    defaultKeywords = [],
    jobDescriptionId = '',
    onJobChange,
}: QuickStartPanelProps) {
    const { t } = useTranslation()

    const [location, setLocation] = useState(defaultLocation)
    const [selectedKeywords, setSelectedKeywords] = useState<string[]>(defaultKeywords)
    const [matchResult, setMatchResult] = useState<AutoMatchResult | null>(null)
    const [loading, setLoading] = useState(false)
    const [hasSearched, setHasSearched] = useState(false)

    // Editor State
    const [showEditor, setShowEditor] = useState(false)
    const [editorData, setEditorData] = useState<{ id?: Id<'job_descriptions'>, title: string, content: string, type: 'system' | 'custom' } | undefined>(undefined)

    // Use useQuery for custom JDs (if matchResult is a custom/convex ID)
    // We assume system JDs are simple strings, Convex IDs are ~32 chars
    const matchedCustomId = matchResult?.matched ? toJobDescriptionId(matchResult.matched) : null
    const customJDQuery = useQuery(api.job_descriptions.get, matchedCustomId ? { id: matchedCustomId } : 'skip')

    const handleModify = async () => {
        if (!matchResult?.matched) {
            // No match? Open as new custom JD
            setEditorData({
                title: 'Custom JD',
                content: `# Job Requirements
- Education: [e.g. Bachelor's Degree]
- Experience: [e.g. 3+ years in Sales]
- Skills: [e.g. Communication, Negotiation]
- Location: ${location || '[City]'}

# Key Responsibilities
- [Responsibility 1]
- [Responsibility 2]

# Preferred Qualifications
- [Nice-to-have skill]`,
                type: 'custom'
            });
            setShowEditor(true);
            return;
        }

        setLoading(true);
        try {
            if (matchedCustomId && customJDQuery) {
                // It's a custom JD and we have data from Convex
                setEditorData({
                    id: matchedCustomId,
                    title: customJDQuery.title,
                    content: customJDQuery.content,
                    type: 'custom'
                });
                setShowEditor(true);
            } else {
                // It's a system JD or we need to fetch via API
                const response = await fetch(`${API_BASE}/api/job-descriptions/${matchResult.matched}`);
                if (response.ok) {
                    const data = await response.json();
                    if (data.success) {
                        setEditorData({
                            title: data.item?.title || matchResult.title || '',
                            content: data.content || '',
                            type: 'system'
                        });
                        setShowEditor(true);
                    }
                }
            }
        } catch (e) {
            console.error("Failed to load JD content", e);
        } finally {
            setLoading(false);
        }
    };

    // Auto-match when location or keywords change (debounced)
    useEffect(() => {
        const keywords = selectedKeywords.map((keyword) => keyword.trim()).filter(Boolean)
        if (keywords.length === 0) {
            setMatchResult(null)
            setHasSearched(false)
            return
        }

        const timer = setTimeout(async () => {
            setLoading(true)
            try {
                const response = await fetch(`${API_BASE}/api/job-descriptions/match`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ keywords, location: location || undefined }),
                })
                if (response.ok) {
                    const data = await response.json()
                    if (data.success) {
                        setMatchResult({
                            matched: data.matched,
                            title: data.title,
                            confidence: data.confidence,
                            matchedKeywords: data.matchedKeywords,
                            filterPreset: data.filterPreset,
                            suggestedFilters: data.suggestedFilters,
                        })
                    }
                }
            } catch (error) {
                console.error('Failed to auto-match job description', error)
            } finally {
                setLoading(false)
                setHasSearched(true)
            }
        }, 500)

        return () => clearTimeout(timer)
    }, [selectedKeywords, location])

    const handleApply = useCallback(() => {
        const keywords = selectedKeywords.map((keyword) => keyword.trim()).filter(Boolean)
        onApplyConfig?.({
            location,
            keywords,
            jobDescriptionId: jobDescriptionId || matchResult?.matched,
            filterPreset: matchResult?.filterPreset,
            filters: matchResult?.suggestedFilters,
        })
    }, [jobDescriptionId, location, matchResult, onApplyConfig, selectedKeywords])

    const hasKeywords = selectedKeywords.some((keyword) => keyword.trim().length > 0)

    const confidenceColor = matchResult?.confidence
        ? matchResult.confidence >= 0.7
            ? 'text-green-600 dark:text-green-400'
            : matchResult.confidence >= 0.4
                ? 'text-yellow-600 dark:text-yellow-400'
                : 'text-orange-600 dark:text-orange-400'
        : ''

    return (
        <div className="rounded-lg bg-muted/30 px-6 py-5">
            <p className="mb-3 text-xs text-muted-foreground">
                {t('quickStart.hint', '输入位置和关键词，系统自动配置')}
            </p>

            <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                    <div className="sm:w-44">
                        <label className="mb-1 block text-sm font-medium text-muted-foreground">
                            {t('quickStart.location', '位置')}
                        </label>
                        <div className="relative">
                            <input
                                type="text"
                                value={location}
                                onChange={(e) => setLocation(e.target.value)}
                                placeholder="广东"
                                list="location-suggestions"
                                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                            />
                            <datalist id="location-suggestions">
                                {COMMON_LOCATIONS.map((loc) => (
                                    <option key={loc} value={loc} />
                                ))}
                            </datalist>
                        </div>
                    </div>

                    <Button
                        onClick={handleApply}
                        disabled={!hasKeywords}
                        className="sm:w-auto"
                    >
                        {t('quickStart.apply', '使用此配置')}
                    </Button>
                </div>

                <div>
                    <label className="mb-1 block text-sm font-medium text-muted-foreground">
                        {t('quickStart.keywords', '关键词')}
                    </label>
                    <KeywordChips
                        value={selectedKeywords}
                        onChange={setSelectedKeywords}
                    />
                </div>

                <div className="max-w-sm">
                    <label className="mb-1 block text-xs text-muted-foreground">
                        {t('quickStart.manualJd', '手动职位（可选）')}
                    </label>
                    <JobDescriptionSelect
                        value={jobDescriptionId}
                        onChange={(value) => onJobChange?.(value)}
                        disabled={!onJobChange}
                    />
                </div>
            </div>

                {/* Match Result */}
                {hasSearched && (
                    <div className="mt-4 p-3 rounded-md bg-background/60 border border-border/50">
                        {loading ? (
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                <div className="h-4 w-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                                {t('quickStart.matching', '正在匹配...')}
                            </div>
                        ) : (
                            <div className="flex flex-col gap-2">
                                {matchResult?.matched ? (
                                    <>
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <span className="text-sm font-medium">
                                                ⚡ {t('quickStart.matchedJD', '已匹配')}:
                                            </span>
                                            <span className="text-sm font-semibold text-primary">
                                                {matchResult.title || matchResult.matched}
                                            </span>
                                            <span className={cn('text-xs', confidenceColor)}>
                                                ({Math.round(matchResult.confidence * 100)}% {t('quickStart.confidence', '匹配度')})
                                            </span>
                                        </div>

                                        {matchResult.suggestedFilters && (
                                            <div className="flex items-center flex-wrap gap-2 text-xs text-muted-foreground">
                                                {matchResult.suggestedFilters.minExperience !== undefined && (
                                                    <span className="px-2 py-0.5 rounded bg-muted">
                                                        {matchResult.suggestedFilters.minExperience}年+
                                                    </span>
                                                )}
                                                {matchResult.suggestedFilters.education?.length && (
                                                    <span className="px-2 py-0.5 rounded bg-muted">
                                                        {matchResult.suggestedFilters.education.join('/')}
                                                    </span>
                                                )}
                                                {matchResult.suggestedFilters.salaryRange && (
                                                    <span className="px-2 py-0.5 rounded bg-muted">
                                                        {matchResult.suggestedFilters.salaryRange.min?.toLocaleString()}-
                                                        {matchResult.suggestedFilters.salaryRange.max?.toLocaleString()}
                                                    </span>
                                                )}
                                                {matchResult.filterPreset && (
                                                    <span className="px-2 py-0.5 rounded bg-primary/10 text-primary">
                                                        {matchResult.filterPreset}
                                                    </span>
                                                )}
                                            </div>
                                        )}
                                    </>
                                ) : (
                                    <div className="text-sm text-muted-foreground">
                                        {hasKeywords
                                            ? t('quickStart.noMatch', '未找到匹配的职位描述，将使用默认配置')
                                            : t('quickStart.enterKeywords', '请输入关键词开始匹配')
                                        }
                                    </div>
                                )}

                                <div className="flex gap-2 mt-2">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="h-7 text-xs"
                                        onClick={handleModify}
                                    >
                                        <Settings2 className="h-3 w-3 mr-1" />
                                        {t('quickStart.modify', '修改配置')}
                                    </Button>

                                    {matchResult?.matched && (
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            className="h-7 text-xs"
                                            onClick={() => {
                                                setEditorData({
                                                    title: 'Custom JD',
                                                    content: `# Job Requirements
- Education: [e.g. Bachelor's Degree]
- Experience: [e.g. 3+ years in Sales]
- Skills: [e.g. Communication, Negotiation]
- Location: ${location || '[City]'}

# Key Responsibilities
- [Responsibility 1]
- [Responsibility 2]

# Preferred Qualifications
- [Nice-to-have skill]`,
                                                    type: 'custom'
                                                });
                                                setShowEditor(true);
                                            }}
                                        >
                                            <FilePlus className="h-3 w-3 mr-1" />
                                            {t('quickStart.createCustom', '创建自定义配置')}
                                        </Button>
                                    )}
                                    <Link
                                        to="/config/jds"
                                        className="inline-flex items-center h-7 text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
                                    >
                                        {t('quickStart.manageJds')}
                                    </Link>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* Advanced Panel (collapsed by default) */}
                {matchResult && (
                    <div className="mt-3 p-3 rounded-md border border-dashed border-border text-sm">
                        <p className="text-muted-foreground mb-2">
                            {t('quickStart.matchDetails')}
                        </p>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                            <div>
                                <span className="text-muted-foreground">{t('quickStart.labelJd')}: </span>
                                <span>{matchResult.matched}</span>
                            </div>
                            <div>
                                <span className="text-muted-foreground">{t('quickStart.labelPreset')}: </span>
                                <span>{matchResult.filterPreset || '-'}</span>
                            </div>
                            <div>
                                <span className="text-muted-foreground">{t('quickStart.labelMatchedKeywords')}: </span>
                                <span>{matchResult.matchedKeywords.join(', ') || '-'}</span>
                            </div>
                        </div>
                    </div>
                )}

            <JobDescriptionEditor
                open={showEditor}
                onOpenChange={setShowEditor}
                initialData={editorData}
                onSaveSuccess={(newId) => {
                    if (matchResult) {
                        setMatchResult({
                            ...matchResult,
                            matched: newId,
                            title: editorData?.title || matchResult.title,
                        });
                    }
                    // Auto-apply or just confirm? User likely wants to apply.
                    // For now, let them click "Apply" manually, but maybe highlight it.
                }}
            />
        </div>
    )
}
