import { z } from "@hono/zod-openapi";

function isPlaceholderExternalIdentity(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === "unknown" || normalized === "externalid:unknown";
}

export const ExactResumeTargetSchema = z.object({
  referenceResumeId: z.string().trim().min(1).optional(),
  currentResumeId: z.string().trim().min(1).optional(),
  profileResumeId: z.string().trim().min(1).optional(),
  profileUrl: z.string().trim().min(1).optional(),
  externalId: z.string().trim().min(1)
    .refine((value) => !isPlaceholderExternalIdentity(value), "Placeholder external IDs are not stable selectors")
    .optional(),
  identityKey: z.string().trim().min(1)
    .refine((value) => !isPlaceholderExternalIdentity(value), "Placeholder external identity keys are not stable selectors")
    .optional(),
  source: z.string().trim().min(1).optional(),
}).strict();

export const ExactResumeResolvedSelectorSchema = z.object({
  kind: z.enum(["currentResumeId", "profileUrl", "profileResumeId", "externalId", "identityKey"]),
  value: z.string().min(1),
});

export const ExactResumeResolvedTargetSchema = z.object({
  referenceResumeId: z.string().optional(),
  currentResumeId: z.string().min(1),
  profileResumeId: z.string().optional(),
  profileUrl: z.string().optional(),
  externalId: z.string(),
  source: z.string(),
  canonicalIdentityKey: z.string().min(1),
  outcome: z.literal("resolved"),
  selectors: z.array(ExactResumeResolvedSelectorSchema).min(1),
});

export const ExactResumeResolutionSchema = z.object({
  requested: z.number().int().positive(),
  resolved: z.number().int().positive(),
  resumeIds: z.array(z.string().min(1)).min(1),
  targets: z.array(ExactResumeResolvedTargetSchema).min(1),
});
