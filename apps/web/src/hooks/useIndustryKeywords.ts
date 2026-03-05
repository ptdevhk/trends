import { useCallback, useEffect, useMemo, useState } from "react";
import { rawApiClient } from "@/lib/api-helpers";

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
};

type SystemLocationItem = {
  id: string;
  keyword: string;
  level: "province" | "city";
  parentKeyword?: string;
  visible: boolean;
};

type CustomKeywordsResponse = {
  success: boolean;
  tags?: CustomKeywordTag[];
  systemLocations?: SystemLocationItem[];
};

function deduplicateKeywords(items: IndustryKeyword[]): IndustryKeyword[] {
  const seen = new Set<string>();
  const deduplicated: IndustryKeyword[] = [];
  for (const item of items) {
    const keyword = item.keyword.trim();
    if (!keyword) {
      continue;
    }
    const dedupeKey = `${item.category}:${keyword.toLowerCase()}`;
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
  location: "地点",
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
  const [systemLocationKeywords, setSystemLocationKeywords] = useState<IndustryKeyword[]>([]);
  const [brandKeywords, setBrandKeywords] = useState<IndustryKeyword[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchKeywords = useCallback(async () => {
    setLoading(true);
    setError(null);

    const [industryResponse, customResponse, brandResponse] = await Promise.all([
      rawApiClient.GET<IndustryKeywordsResponse>("/api/industry/keywords"),
      rawApiClient.GET<CustomKeywordsResponse>("/api/config/custom-keywords"),
      rawApiClient.GET<BrandsResponse>("/api/industry/brands"),
    ]);

    const { data: industryData, error: industryError } = industryResponse;
    if (industryError || !industryData?.success) {
      setKeywords([]);
      setCustomKeywords([]);
      setSystemLocationKeywords([]);
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
          });
        }
      }
      setCustomKeywords(mappedCustomKeywords);

      const mappedSystemLocationKeywords: IndustryKeyword[] = [];
      if (Array.isArray(customData.systemLocations)) {
        for (const item of customData.systemLocations) {
          const keyword = item.keyword?.trim();
          if (!keyword || !item.visible) continue;
          mappedSystemLocationKeywords.push({
            id: item.id,
            keyword,
            category: "location",
          });
        }
      }
      setSystemLocationKeywords(mappedSystemLocationKeywords);
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
      customKeywords.map((item) => item.keyword.toLowerCase())
    );
    const deduplicatedBrands = brandKeywords.filter(
      (item) => !customSet.has(item.keyword.toLowerCase())
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
    const customSet = new Set(customKeywords.map((item) => item.keyword));
    const categoryChips = CATEGORY_ORDER
      .filter((category) => category !== "custom")
      .flatMap((category) => grouped[category].slice(0, 3));
    const filteredCategoryChips = categoryChips.filter(
      (chip) => !customSet.has(chip.keyword)
    );

    return [...customKeywords, ...filteredCategoryChips];
  }, [customKeywords, grouped]);

  return {
    keywords: allKeywords,
    grouped,
    hotKeywords,
    loading,
    error,
    refresh: fetchKeywords,
  };
}
