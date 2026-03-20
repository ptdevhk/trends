# Resume Collection Pipeline (Extension → Samples → Import)

This pipeline is used to refresh deterministic samples under `output/resumes/samples/` and to support end-to-end resume screening flows.

## Data Flow

1. User/search automation loads `https://hr.job5156.com/search`.
2. Extension captures API rows and normalizes:
   - `resumeId`, `perUserId` (dedupe)
   - structured resume fields for export
3. Auto-export writes artifacts (CSV/JSON/MD/raw payload) for verification.
4. Sample-refresh workflow stores JSON with provenance metadata:
   - `metadata.sourceUrl`
   - `metadata.searchCriteria`
5. Downstream tooling imports samples into storage (Convex + SQLite) for screening and QA.

## Sample Generation (preferred)

Use URL parameters for reproducible exports:

```
https://hr.job5156.com/search?keyword=销售&tr_auto_export=json&tr_sample_name=sample-initial
```

The JSON export should include provenance metadata for replay.

## CDP Sample Refresh Commands

From repo root:

```bash
make refresh-sample                          # default: 销售 -> sample-initial.json
make refresh-sample KEYWORD=python SAMPLE=sample-python
make refresh-sample ALLOW_EMPTY=1            # allow saving empty sample
```

CDP reads via:
- `window.__TR_RESUME_DATA__.extract()`
- `window.__TR_RESUME_DATA__.status()`

## Key Files

- `apps/browser-extension/CLAUDE.md` — canonical extension agent notes (source)
- `apps/browser-extension/scripts/cmux-setup-profile.sh` — container profile setup
- `scripts/refresh-sample.sh` — CDP-driven sample refresh entrypoint
- `output/resumes/samples/*.json` — sample artifacts consumed by dev/QA flows

