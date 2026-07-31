import { z } from "@hono/zod-openapi";

/** Shared zod schemas for industry data entry payloads (read + admin write). */

export const CompanyEntrySchema = z.object({
  id: z.number(),
  nameCn: z.string().min(1),
  nameEn: z.string().optional(),
  type: z.string(),
  category: z.enum(["key_company", "ites_exhibitor", "agent"]),
});

export const KeywordEntrySchema = z.object({
  id: z.number(),
  keyword: z.string().min(1),
  english: z.string().optional(),
  category: z.enum([
    "machining",
    "lathe",
    "edm",
    "measurement",
    "smt",
    "3d_printing",
  ]),
});

export const BrandEntrySchema = z.object({
  id: z.number(),
  nameCn: z.string().min(1),
  nameEn: z.string().optional(),
  type: z.string(),
  origin: z.enum(["international", "domestic", "agent"]),
  familyId: z.string().optional(),
  aliases: z.array(z.string()).optional(),
  productClass: z.string().optional(),
});

export const UrlEntrySchema = z.union([
  z.string().url(),
  z.object({ url: z.string().url() }),
]);

export const EntryTypeSchema = z.enum(["company", "keyword", "brand", "url"]);
export type EntryType = z.infer<typeof EntryTypeSchema>;

export const IndustryDataEntryInputSchema = z.object({
  entryType: EntryTypeSchema,
  entryId: z.string().min(1),
  data: z.unknown(),
  sortOrder: z.number().optional(),
  companyKey: z.string().optional(),
});

export type IndustryDataEntryInput = z.infer<typeof IndustryDataEntryInputSchema>;

/**
 * Validate `data` against the schema for `entryType`. Throws ZodError on failure.
 */
export function validateEntryData(entryType: EntryType, data: unknown): unknown {
  switch (entryType) {
    case "company":
      return CompanyEntrySchema.parse(data);
    case "keyword":
      return KeywordEntrySchema.parse(data);
    case "brand":
      return BrandEntrySchema.parse(data);
    case "url": {
      const parsed = UrlEntrySchema.parse(data);
      return typeof parsed === "string" ? parsed : parsed.url;
    }
    default: {
      const _exhaustive: never = entryType;
      throw new Error(`Unknown entryType: ${_exhaustive}`);
    }
  }
}
