import { useCallback, useEffect, useMemo, useState } from "react";
import { rawApiClient } from "@/lib/api-helpers";

export type KeywordCategory =
  | "machining"
  | "lathe"
  | "edm"
  | "measurement"
  | "smt"
  | "3d_printing"
  | "custom";

export type IndustryKeyword = {
  id: number | string;
  keyword: string;
  english?: string;
  category: KeywordCategory;
};

type IndustryKeywordsResponse = {
  success: boolean;
  data?: Array<{
    id: number;
    keyword: string;
    english?: string;
    category: "machining" | "lathe" | "edm" | "measurement" | "smt" | "3d_printing";
  }>;
};

type CustomKeywordTag = {
  id: string;
  keyword: string;
  english?: string;
  category: string;
};

type CustomKeywordsResponse = {
  success: boolean;
  tags?: CustomKeywordTag[];
};

export const CATEGORY_ORDER: KeywordCategory[] = [
  "machining",
  "lathe",
  "edm",
  "measurement",
  "smt",
  "3d_printing",
  "custom",
];

export const CATEGORY_LABELS: Record<KeywordCategory, string> = {
  machining: "加工中心",
  lathe: "车床",
  edm: "火花机/线切割",
  measurement: "测量扫描",
  smt: "SMT",
  "3d_printing": "3D打印",
  custom: "自定义",
};

function createGroupedKeywords(): Record<KeywordCategory, IndustryKeyword[]> {
  return {
    machining: [],
    lathe: [],
    edm: [],
    measurement: [],
    smt: [],
    "3d_printing": [],
    custom: [],
  };
}

function normalizeCategory(category: string): KeywordCategory {
  if (
    category === "machining" ||
    category === "lathe" ||
    category === "edm" ||
    category === "measurement" ||
    category === "smt" ||
    category === "3d_printing" ||
    category === "custom"
  ) {
    return category;
  }
  return "custom";
}

export function useIndustryKeywords() {
  const [keywords, setKeywords] = useState<IndustryKeyword[]>([]);
  const [customKeywords, setCustomKeywords] = useState<IndustryKeyword[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchKeywords = useCallback(async () => {
    setLoading(true);
    setError(null);

    const [industryResponse, customResponse] = await Promise.all([
      rawApiClient.GET<IndustryKeywordsResponse>("/api/industry/keywords"),
      rawApiClient.GET<CustomKeywordsResponse>("/api/config/custom-keywords"),
    ]);

    const { data: industryData, error: industryError } = industryResponse;
    if (industryError || !industryData?.success) {
      setKeywords([]);
      setCustomKeywords([]);
      setError("Failed to load industry keywords");
      setLoading(false);
      return;
    }

    setKeywords(Array.isArray(industryData.data) ? industryData.data : []);

    const { data: customData, error: customError } = customResponse;
    if (customError || !customData?.success) {
      console.error("Failed to load custom keywords", customError);
      setCustomKeywords([]);
      setLoading(false);
      return;
    }

    const mappedCustomKeywords: IndustryKeyword[] = [];
    if (Array.isArray(customData.tags)) {
      for (const tag of customData.tags) {
        const keyword = tag.keyword?.trim();
        if (!keyword) continue;
        mappedCustomKeywords.push({
          id: tag.id,
          keyword,
          english: tag.english?.trim() || undefined,
          category: normalizeCategory(tag.category),
        });
      }
    }

    setCustomKeywords(mappedCustomKeywords);
    setLoading(false);
  }, []);

  useEffect(() => {
    void fetchKeywords();
  }, [fetchKeywords]);

  const allKeywords = useMemo(
    () => [...keywords, ...customKeywords],
    [keywords, customKeywords]
  );

  const grouped = useMemo(() => {
    const groups = createGroupedKeywords();
    for (const item of allKeywords) {
      groups[item.category].push(item);
    }
    return groups;
  }, [allKeywords]);

  const hotKeywords = useMemo(() => {
    return CATEGORY_ORDER.flatMap((category) => grouped[category].slice(0, 3));
  }, [grouped]);

  return {
    keywords: allKeywords,
    grouped,
    hotKeywords,
    loading,
    error,
    refresh: fetchKeywords,
  };
}
