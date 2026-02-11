import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { JobDescriptionSelect } from "./JobDescriptionSelect";
import { KeywordChips } from "./KeywordChips";

const COMMON_LOCATIONS = [
  "广东",
  "东莞",
  "深圳",
  "广州",
  "佛山",
  "惠州",
  "苏州",
  "无锡",
  "常州",
  "昆山",
  "上海",
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
}

export function QuickStartPanel({
  onApplyConfig,
  defaultLocation = "广东",
  defaultKeywords = [],
  jobDescriptionId = "",
  onJobChange,
}: QuickStartPanelProps) {
  const { t } = useTranslation();

  const [location, setLocation] = useState(defaultLocation);
  const [selectedKeywords, setSelectedKeywords] = useState<string[]>(defaultKeywords);

  const handleApply = useCallback(() => {
    onApplyConfig?.({
      location,
      keywords: selectedKeywords.map((keyword) => keyword.trim()).filter(Boolean),
      jobDescriptionId: jobDescriptionId || undefined,
    });
  }, [jobDescriptionId, location, onApplyConfig, selectedKeywords]);

  const hasKeywords = selectedKeywords.some((keyword) => keyword.trim().length > 0);
  const canApply = hasKeywords || Boolean(jobDescriptionId);

  return (
    <div className="rounded-lg bg-muted/30 px-6 py-5">
      <p className="mb-3 text-xs text-muted-foreground">
        {t("quickStart.hint", "输入位置和关键词，系统自动配置")}
      </p>

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="sm:w-44">
            <label className="mb-1 block text-sm font-medium text-muted-foreground">
              {t("quickStart.location", "位置")}
            </label>
            <div className="relative">
              <input
                type="text"
                value={location}
                onChange={(event) => setLocation(event.target.value)}
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

          <Button onClick={handleApply} disabled={!canApply} className="sm:w-auto">
            {t("quickStart.apply", "使用此配置")}
          </Button>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-muted-foreground">
            {t("quickStart.keywords", "关键词")}
          </label>
          <KeywordChips value={selectedKeywords} onChange={setSelectedKeywords} />
        </div>

        <div className="max-w-sm">
          <label className="mb-1 block text-xs text-muted-foreground">
            {t("quickStart.manualJd", "手动职位（可选）")}
          </label>
          <JobDescriptionSelect
            value={jobDescriptionId}
            onChange={(value) => onJobChange?.(value)}
            disabled={!onJobChange}
          />
        </div>
      </div>
    </div>
  );
}
