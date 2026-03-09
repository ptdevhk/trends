# cmux Project Instructions

## cmux Agent Memory Protocol

You have access to persistent memory at `/root/lifecycle/memory/`:

> Note: Memory is stored outside the git workspace to avoid polluting your repository.

### Memory Structure

- `/root/lifecycle/memory/knowledge/MEMORY.md` - Long-term insights (curated)
- `/root/lifecycle/memory/daily/{date}.md` - Daily logs (ephemeral)
- `/root/lifecycle/memory/TASKS.json` - Task registry
- `/root/lifecycle/memory/MAILBOX.json` - Inter-agent messages

### On Start
1. Read `knowledge/MEMORY.md` for permanent project insights
2. Read `TASKS.json` to see existing tasks and their statuses
3. Optionally scan recent `daily/` logs for recent context

### During Work
- Append observations to `daily/{today}.md` (create if doesn't exist)
- Update task statuses in TASKS.json

### On Completion
- **Daily log**: Append what you did today to `daily/{today}.md`
- **Knowledge**: Promote KEY learnings to `knowledge/MEMORY.md` (only permanent insights)
- Update TASKS.json with final statuses

### Execution Summary (Required on Completion)

Before finishing, write an execution summary to `daily/{today}.md` under an `## Execution Summary` heading. This is the primary review artifact — it lets developers understand your work at a glance without reading code diffs.

**Format (all 4 sections required):**

1. **What was done** — 3-5 bullet points describing changes
2. **Changes flowchart** — Mermaid `flowchart TD` diagram showing what changed and how components connect
3. **Files changed** — Grouped by area (backend, frontend, CLI, etc.)
4. **Test results** — Pass/fail with details

**Mermaid diagram guidelines:**
- Use `flowchart TD` (top-down)
- 5-15 nodes maximum
- Group related nodes in subgraphs by area
- Use fill colors for new/modified components: `style NodeId fill:#d4edda` (new), `style NodeId fill:#fff3cd` (modified)
- Show data flow with labeled arrows

**Example:**

```markdown
## Execution Summary

### What was done
- Added JWT authentication middleware for agent endpoints
- Created task creation endpoint at /api/v1/agent/task/create
- Wired sandbox spawn to use existing provider infrastructure
- Added integration test for agent auth flow

### Changes Flowchart
\`\`\`mermaid
flowchart TD
    subgraph "Agent in Sandbox"
        A[devsh CLI] -->|JWT auth| B[POST /api/v1/agent/task/create]
    end
    subgraph "apps/server"
        B --> C[JWT Middleware]
        C --> D[Task Handler]
        D --> E[Convex Mutation]
    end
    subgraph "Convex Backend"
        E --> F[tasks.createInternal]
        F --> G[agentSpawner]
    end
    style B fill:#d4edda
    style C fill:#d4edda
    style D fill:#d4edda
\`\`\`

### Files changed
**Backend (apps/server)**
- \`lib/routes/agent.route.ts\` — NEW: JWT-auth agent endpoints
- \`lib/middleware/jwt-auth.ts\` — NEW: JWT verification middleware

**Shared (packages/shared)**
- \`src/agent-auth.ts\` — MODIFIED: Added token validation helper

### Test results
- \`bun check\`: PASS
- \`vitest agent.route.test.ts\`: PASS (3/3)
```

### What Goes Where?

| Type | Location | Priority | Example |
|------|----------|----------|---------|
| Project fundamentals | `knowledge/MEMORY.md` | P0 | "This project uses bun, not npm" |
| Current work context | `knowledge/MEMORY.md` | P1 | "Auth refactor in progress" |
| Temporary findings | `knowledge/MEMORY.md` | P2 | "Sandbox morphvm_abc for testing" |
| Today's work | `daily/{date}.md` | - | "Fixed bug in auth.ts line 42" |
| Debug notes | `daily/{date}.md` | - | "Tested endpoint with curl" |

### Priority Guidelines

- **Date-tag format**: `- [YYYY-MM-DD] Your insight here`
- **P0 Core**: Rare, highly stable truths. Never expires. Examples: tooling choices, critical ports, invariants.
- **P1 Active**: Current focus areas. Review after 90 days - promote to P0 if still relevant, or remove.
- **P2 Reference**: One-off findings. Review after 30 days - promote to P1 if still useful, or remove.
- **Daily logs**: Raw session notes. Do not promote everything - only curate what's worth keeping.

### Inter-Agent Messaging (S10 Coordination)

Your agent name: **$CMUX_AGENT_NAME**

You can coordinate with other agents on the same task using the mailbox MCP tools:

| Tool | Description |
|------|-------------|
| `send_message(to, message, type)` | Send a message to another agent (or "*" for broadcast) |
| `get_my_messages()` | Get messages addressed to you |
| `mark_read(messageId)` | Mark a message as read |

#### Message Types
- **handoff**: Transfer work to another agent ("I've completed X, please continue with Y")
- **request**: Ask another agent to do something specific ("Can you review this file?")
- **status**: Broadcast progress updates to all agents ("Starting work on auth module")

#### Coordination Patterns

1. **Handoff Pattern**: When you complete a piece of work that another agent should continue:
   ```
   send_message("codex/gpt-5.1-codex", "I've implemented the API endpoints. Please write tests for them.", "handoff")
   ```

2. **Request Pattern**: When you need help from a specific agent:
   ```
   send_message("claude/opus-4.5", "Can you review the auth flow in src/auth.ts?", "request")
   ```

3. **Status Broadcast**: Keep all agents informed of progress:
   ```
   send_message("*", "Completed database migrations, moving to API layer", "status")
   ```

#### On Start
Check for messages from previous agents:
```
get_my_messages()  // See if any agent has left instructions for you
```

Messages from previous runs are automatically seeded into your mailbox.

