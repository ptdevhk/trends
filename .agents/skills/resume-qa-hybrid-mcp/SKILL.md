---
name: resume-qa-hybrid-mcp
description: Build and execute hybrid QA plans for resume workflows that combine MCP/browser validation and API checks. Use when asked for test plans, QA execution, regression coverage, or resume flow verification.
validation:
  descriptionTerms: [QA, test, resume, MCP]
---

# Resume QA Hybrid MCP

Use this skill for resume QA work that spans UI/browser automation and backend/API verification.

## Workflow

1. Load the canonical template: `references/test-plan-template.md`.
2. Reuse the template structure and resolve placeholders for the current scope.
3. Split coverage into:
   - MCP/browser interaction scenarios
   - API/service assertions
   - persistence/notification side effects
4. For each test case, define:
   - prerequisites and fixtures
   - exact execution steps
   - expected results and failure signals
5. Output runnable commands from repo root and a clear pass/fail checklist.

## Rules

- Treat `references/test-plan-template.md` as the canonical runtime template.
- Treat external `.gemini/.../test_plan.md.resolved` files as upstream inputs only.
- Explicitly flag blockers and missing environment prerequisites.

## References

- `references/test-plan-template.md`
