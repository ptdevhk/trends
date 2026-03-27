import { useCallback, useEffect, useMemo, useState } from "react";
import { rawApiClient } from "@/lib/api-helpers";

export type KeywordMarket = "CN" | "MY";
export type ConfigSourceOrigin = "system" | "workspace";
export type WorkflowSeedCollectionSourceType = "job5156" | "seek";

export type KeywordCategory =
  | "machining"
  | "lathe"
  | "edm"
  | "measurement"
  | "smt"
  | "3d_printing"
  | "location"
  | "brand"
  | "custom";

export type IndustryKeyword = {
  id: number | string;
  keyword: string;
  english?: string;
  category: KeywordCategory;
  markets?: KeywordMarket[];
  visible?: boolean;
  source?: ConfigSourceOrigin;
};

type IndustryKeywordsResponse = {
  success: boolean;
  data?: Array<{
    id: number;
    keyword: string;
    english?: string;
    category:
      | "machining"
      | "lathe"
      | "edm"
      | "measurement"
      | "smt"
      | "3d_printing";
  }>;
};

type BrandItem = {
  id: number;
  nameCn: string;
  nameEn?: string;
  type: string;
  origin: string;
};

type BrandsResponse = {
  success: boolean;
  count?: number;
  data?: BrandItem[];
};

type CustomKeywordTag = {
  id: string;
  keyword: string;
  english?: string;
  category: string;
  markets?: KeywordMarket[];
  visible?: boolean;
  source?: ConfigSourceOrigin;
};

type SystemLocationItem = {
  id: string;
  keyword: string;
  level: "province" | "city";
  parentKeyword?: string;
  visible: boolean;
  markets?: KeywordMarket[];
};

type CustomKeywordWorkflowSeed = {
  id: string;
  label: string;
  market: KeywordMarket;
  location: string;
  keywords: string[];
  collectionSource: {
    type: WorkflowSeedCollectionSourceType;
    exactUrl?: string;
  };
  collectUrl?: string;
  visible?: boolean;
  source?: ConfigSourceOrigin;
};

type CustomKeywordsResponse = {
  success: boolean;
  categories?: Array<{
    id: string;
    name: string;
    icon?: string;
  }>;
  tags?: CustomKeywordTag[];
  systemLocations?: SystemLocationItem[];
  workflowSeeds?: CustomKeywordWorkflowSeed[];
};

function getKeywordFingerprint(keyword: string): string {
  return keyword.trim().toLowerCase();
}

function isHotKeywordSeed(item: IndustryKeyword): boolean {
  return (
    item.source === "system" &&
    typeof item.id === "string" &&
    item.id.startsWith("seed-")
  );
}

function deduplicateKeywords(items: IndustryKeyword[]): IndustryKeyword[] {
  const seen = new Set<string>();
  const deduplicated: IndustryKeyword[] = [];
  for (const item of items) {
    const keyword = item.keyword.trim();
    if (!keyword) {
      continue;
    }
    const dedupeKey = `${item.category}:${getKeywordFingerprint(keyword)}`;
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    deduplicated.push({
      ...item,
      keyword,
    });
  }
  return deduplicated;
}

export const CATEGORY_ORDER: KeywordCategory[] = [
  "machining",
  "lathe",
  "edm",
  "measurement",
  "smt",
  "3d_printing",
  "location",
  "brand",
  "custom",
];

export const CATEGORY_LABELS: Record<KeywordCategory, string> = {
  machining: "加工中心",
  lathe: "车床",
  edm: "火花机/线切割",
  measurement: "测量扫描",
  smt: "SMT",
  "3d_printing": "3D打印",
  location: "地区",
  brand: "品牌",
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
    location: [],
    brand: [],
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
    category === "location" ||
    category === "brand" ||
    category === "custom"
  ) {
    return category;
  }
  return "custom";
}

export function useIndustryKeywords() {
  const [keywords, setKeywords] = useState<IndustryKeyword[]>([]);
  const [customKeywords, setCustomKeywords] = useState<IndustryKeyword[]>([]);
  const [systemLocationKeywords, setSystemLocationKeywords] = useState<
    IndustryKeyword[]
  >([]);
  const [workflowSeeds, setWorkflowSeeds] = useState<
    CustomKeywordWorkflowSeed[]
  >([]);
  const [brandKeywords, setBrandKeywords] = useState<IndustryKeyword[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchKeywords = useCallback(async () => {
    setLoading(true);
    setError(null);

    const [industryResponse, customResponse, brandResponse] = await Promise.all(
      [
        rawApiClient.GET<IndustryKeywordsResponse>("/api/industry/keywords"),
        rawApiClient.GET<CustomKeywordsResponse>("/api/config/custom-keywords"),
        rawApiClient.GET<BrandsResponse>("/api/industry/brands"),
      ],
    );

    const { data: industryData, error: industryError } = industryResponse;
    if (industryError || !industryData?.success) {
      setKeywords([]);
      setCustomKeywords([]);
      setSystemLocationKeywords([]);
      setWorkflowSeeds([]);
      setBrandKeywords([]);
      setError("Failed to load industry keywords");
      setLoading(false);
      return;
    }

    setKeywords(Array.isArray(industryData.data) ? industryData.data : []);

    const { data: customData, error: customError } = customResponse;
    if (customError || !customData?.success) {
      console.error("Failed to load custom keywords", customError);
      setCustomKeywords([]);
      setSystemLocationKeywords([]);
      setWorkflowSeeds([]);
    } else {
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
            markets: tag.markets?.length ? tag.markets : undefined,
            visible: tag.visible,
            source: tag.source,
          });
        }
      }
      setCustomKeywords(
        mappedCustomKeywords.filter((item) => item.visible !== false),
      );

      const mappedSystemLocationKeywords: IndustryKeyword[] = [];
      if (Array.isArray(customData.systemLocations)) {
        for (const item of customData.systemLocations) {
          const keyword = item.keyword?.trim();
          if (!keyword || !item.visible) continue;
          mappedSystemLocationKeywords.push({
            id: item.id,
            keyword,
            category: "location",
            markets: item.markets?.length ? item.markets : undefined,
          });
        }
      }
      setSystemLocationKeywords(mappedSystemLocationKeywords);

      const mappedWorkflowSeeds = Array.isArray(customData.workflowSeeds)
        ? customData.workflowSeeds.filter((item) => item.visible !== false)
        : [];
      setWorkflowSeeds(mappedWorkflowSeeds);
    }

    const { data: brandData, error: brandError } = brandResponse;
    if (brandError || !brandData?.success) {
      console.error("Failed to load brand keywords", brandError);
      setBrandKeywords([]);
    } else {
      const mappedBrands: IndustryKeyword[] = [];
      if (Array.isArray(brandData.data)) {
        for (const item of brandData.data) {
          const keyword = item.nameCn?.trim();
          if (!keyword) continue;
          mappedBrands.push({
            id: item.id,
            keyword,
            english: item.nameEn?.trim() || undefined,
            category: "brand",
          });
        }
      }
      setBrandKeywords(mappedBrands);
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    void fetchKeywords();
  }, [fetchKeywords]);

  const allKeywords = useMemo(() => {
    // Custom keywords take priority over brand keywords with the same text
    const customSet = new Set(
      customKeywords.map((item) => getKeywordFingerprint(item.keyword)),
    );
    const deduplicatedBrands = brandKeywords.filter(
      (item) => !customSet.has(getKeywordFingerprint(item.keyword)),
    );
    return deduplicateKeywords([
      ...keywords,
      ...deduplicatedBrands,
      ...customKeywords,
      ...systemLocationKeywords,
    ]);
  }, [keywords, customKeywords, brandKeywords, systemLocationKeywords]);

  const grouped = useMemo(() => {
    const groups = createGroupedKeywords();
    for (const item of allKeywords) {
      groups[item.category].push(item);
    }
    return groups;
  }, [allKeywords]);

  const hotKeywords = useMemo(() => {
    return customKeywords.filter(isHotKeywordSeed);
  }, [customKeywords]);

  return {
    keywords: allKeywords,
    grouped,
    hotKeywords,
    workflowSeeds,
    loading,
    error,
    refresh: fetchKeywords,
  };
}
