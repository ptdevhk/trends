# Dev Docs Usage

This folder stores cached upstream documentation for quick reference and LLM context.

## Quick usage

- Refresh docs: `make fetch-docs` (or `./dev-docs/fetch-docs.sh`).
- Add/update sources: edit `dev-docs/packages.yaml`, then re-run fetch.
- Commit regenerated `dev-docs/*/llms.txt` files so CI stays in sync.

See `dev-docs/README.md` for details and grep helpers.
