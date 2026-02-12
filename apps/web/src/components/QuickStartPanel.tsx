import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { JobDescriptionSelect } from "./JobDescriptionSelect";
import { KeywordChips } from "./KeywordChips";

const COMMON_LOCATIONS = [
  "广东", "东莞", "深圳", "广州", "佛山", "惠州", "苏州", "无锡", "常州", "昆山", "上海",
];

interface QuickStartPanelProps {
  onApplyConfig?: (config: {
    location: string;
    keywords: string[];
    jobDescriptionId?: string;
  }) => void;
  defaultLocation?: string;
  defaultKeywords?: string[];
  jobDescriptionId?: string;
  onJobChange?: (value: string) => void;
  extraActions?: React.ReactNode;
}

export function QuickStartPanel({
  onApplyConfig,
  defaultLocation = "广东",
  defaultKeywords = [],
  jobDescriptionId = "",
  onJobChange,
  extraActions,
}: QuickStartPanelProps) {
  const { t } = useTranslation();

  const [location, setLocation] = useState(defaultLocation);
  const [selectedKeywords, setSelectedKeywords] = useState<string[]>(defaultKeywords);
  const [customKeyword, setCustomKeyword] = useState("");



  // Auto-emit updates when location or keywords changes
  useEffect(() => {
    const normalizedKeywords = selectedKeywords.map((k) => k.trim()).filter(Boolean);
    const effectiveJobDescriptionId = normalizedKeywords.length > 0
      ? undefined
      : (jobDescriptionId || undefined);

    const timer = setTimeout(() => {
      onApplyConfig?.({
        location,
        keywords: normalizedKeywords,
        jobDescriptionId: effectiveJobDescriptionId,
      });
    }, 500);
    return () => clearTimeout(timer);
  }, [location, selectedKeywords, jobDescriptionId, onApplyConfig]);

  useEffect(() => {
    if (!jobDescriptionId) {
      return;
    }
    setSelectedKeywords([]);
    setCustomKeyword("");
  }, [jobDescriptionId]);


  const handleKeywordsChange = useCallback((keywords: string[]) => {
    setSelectedKeywords(keywords);
    setCustomKeyword(keywords.join(' '));
    if (keywords.length > 0 && jobDescriptionId) {
      onJobChange?.("");
    }
  }, [jobDescriptionId, onJobChange]);

  const handleJobChange = useCallback((value: string) => {
    onJobChange?.(value);
    if (value) {
      setSelectedKeywords([]);
      setCustomKeyword("");
    }
  }, [onJobChange]);


  return (
    <div className="rounded-lg bg-background border px-4 py-4 shadow-sm">
      <div className="flex flex-col gap-4">
        {/* Top Row: Location, Job Select, Analyze Button */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-4 flex-1">
            {/* Location */}
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium whitespace-nowrap">
                {t("quickStart.location", "位置")}
              </label>
              <div className="relative w-32 sm:w-40">
                <input
                  type="text"
                  value={location}
                  onChange={(event) => setLocation(event.target.value)}
                  placeholder="广东"
                  list="location-suggestions"
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                />
                <datalist id="location-suggestions">
                  {COMMON_LOCATIONS.map((loc) => (
                    <option key={loc} value={loc} />
                  ))}
                </datalist>
              </div>
            </div>

            {/* Custom Keywords Input (Moved here) */}
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium whitespace-nowrap text-muted-foreground">
                {t("quickStart.customKeywords", "关键词")}
              </label>
              <div className="flex items-center gap-1">
                <input
                  type="text"
                  value={customKeyword}
                  onChange={(e) => {
                    const val = e.target.value;
                    setCustomKeyword(val);
                    // Split by space/comma, filter empty
                    const parts = val.split(/[\s,]+/).filter(Boolean);
                    setSelectedKeywords(parts);
                    if (parts.length > 0 && jobDescriptionId) {
                      onJobChange?.("");
                    }
                  }}
                  placeholder={t("quickStart.customKeywordPlaceholder", "关键词 (空格分隔)...")}
                  className="h-9 w-full sm:w-64 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
            </div>

            {/* Manual Job Select */}
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium whitespace-nowrap text-muted-foreground">
                {t("quickStart.manualJd", "手动职位(可选)")}
              </label>
              <div className="w-48">
                <JobDescriptionSelect
                  value={jobDescriptionId}
                  onChange={handleJobChange}
                  disabled={!onJobChange}
                />
              </div>
            </div>
          </div>

          {/* Right side actions (Analyze All) */}
          <div className="flex-shrink-0">
            {extraActions}
          </div>
        </div>

        {/* Second Row: Hot Keywords */}
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium text-muted-foreground whitespace-nowrap">
            {t("quickStart.hotKeywords", "热门关键词")}
          </label>
          <KeywordChips value={selectedKeywords} onChange={handleKeywordsChange} />
        </div>


      </div>
    </div>
  );
}
