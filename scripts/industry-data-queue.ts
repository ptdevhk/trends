/**
 * Offline industry-data unresolved queue CLI (R2).
 *
 * Usage:
 *   bunx tsx scripts/industry-data-queue.ts list [--min-count N] [--priority-only] [--root PATH]
 *   bunx tsx scripts/industry-data-queue.ts record --surface TEXT [--reason miss|low_confidence_keyword] [--score N] [--root PATH]
 *
 * Zero external API calls. Reads/writes output/industry-data/unresolved-queue.json.
 */

import path from "node:path";

import {
  filterAggregates,
  type UnresolvedReason,
} from "../apps/api/src/services/industry-unresolved-queue.js";
import {
  appendUnresolvedEvents,
  defaultUnresolvedQueuePath,
  readUnresolvedQueue,
} from "../apps/api/src/services/industry-unresolved-store.js";
import { IndustryDataService } from "../apps/api/src/services/industry-data-service.js";
import { makeUnresolvedEvent } from "../apps/api/src/services/industry-unresolved-queue.js";

function argValue(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx < 0 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(name);
}

function printHelp(): void {
  console.log(`industry-data-queue — offline unresolved entity queue

Commands:
  list     List aggregated unresolved keys
  record   Record a surface via resolve + optional persist

Options:
  --root PATH           Project root (default: cwd)
  --min-count N         Filter aggregates (default: 1)
  --priority-only       Only show priority stub hits
  --surface TEXT        Surface form for record
  --reason REASON       miss | low_confidence_keyword (default: auto from resolve)
  --score N             Nearby score for priority stub
  --dry-run             record without writing sidecar
`);
}

function main(): void {
  const args = process.argv.slice(2);
  const cmd = args[0];
  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
    printHelp();
    process.exit(cmd ? 0 : 1);
  }

  const root = path.resolve(argValue(args, "--root") ?? process.cwd());
  const queuePath = defaultUnresolvedQueuePath(root);

  if (cmd === "list") {
    const minCount = Number(argValue(args, "--min-count") ?? "1");
    const priorityOnly = hasFlag(args, "--priority-only");
    const file = readUnresolvedQueue(queuePath);
    const rows = filterAggregates(file.aggregates, {
      minCount: Number.isFinite(minCount) ? minCount : 1,
      priorityOnly,
    });
    console.log(
      JSON.stringify(
        {
          path: queuePath,
          updatedAt: file.updatedAt,
          eventCount: file.events.length,
          rows,
        },
        null,
        2
      )
    );
    return;
  }

  if (cmd === "record") {
    const surface = argValue(args, "--surface");
    if (!surface) {
      console.error("--surface is required for record");
      process.exit(1);
    }
    const scoreRaw = argValue(args, "--score");
    const nearbyScore =
      scoreRaw !== undefined && Number.isFinite(Number(scoreRaw))
        ? Number(scoreRaw)
        : undefined;
    const reasonArg = argValue(args, "--reason") as UnresolvedReason | undefined;
    const dryRun = hasFlag(args, "--dry-run");

    const service = new IndustryDataService(root);
    const { resolved, unresolved } = service.resolveWithUnresolvedHint(
      surface,
      nearbyScore
    );

    let event = unresolved;
    if (!event && reasonArg) {
      event = makeUnresolvedEvent(surface, reasonArg, nearbyScore);
    }

    if (!event) {
      console.log(
        JSON.stringify(
          {
            ok: true,
            wrote: false,
            reason: "resolved_without_unresolved",
            resolved,
          },
          null,
          2
        )
      );
      return;
    }

    if (reasonArg) {
      event = makeUnresolvedEvent(surface, reasonArg, nearbyScore);
    }

    if (dryRun) {
      console.log(JSON.stringify({ ok: true, dryRun: true, event, resolved }, null, 2));
      return;
    }

    const file = appendUnresolvedEvents(queuePath, [event]);
    console.log(
      JSON.stringify(
        {
          ok: true,
          wrote: true,
          path: queuePath,
          event,
          resolved,
          aggregateCount: file.aggregates.length,
        },
        null,
        2
      )
    );
    return;
  }

  console.error(`Unknown command: ${cmd}`);
  printHelp();
  process.exit(1);
}

main();
