// segmentit 2.0.3 ships no types and no "exports" map. Only the ESM build is
// used: the deep subpath is fs-free (dictionaries inlined at build time),
// while the CJS "main" entry reads dictionaries via require("fs") at load
// and cannot run in the Convex runtime. See the a4 design-gate record in
// ~/wiki/projects/trends/work/2026-08-19-cjk-search-fixes/.
declare module "segmentit/dist/esm/segmentit.js" {
    export class Segment {}
    export function useDefault(instance: Segment): {
        doSegment: (value: string) => Array<{ w: string }>;
    };
}
