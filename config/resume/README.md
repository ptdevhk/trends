# Resume Screening Config

This folder contains active runtime configuration for resume screening.

Files:
- agents.json5: Optional AI review runtime tuning (stage names, thresholds, batching, concurrency, retries).
- session.json5: Session scope and reset policy.
- filter-presets.json5: Quick filter bundles.
- field-usage-policy.json5: Canonical per-surface resume field visibility/usage policy.
- skills_words.txt: Legacy keyword groups (used by parser.ts).
- skills.md: Curated skill taxonomy, synonyms, experience signals (used by the background ingest workflow).
- ai-prompts.md: Canonical zh-Hans resume AI prompt source used to generate the shared runtime artifact.
- ai-prompts.en.md: English locale variant for the generated resume AI prompt runtime.
