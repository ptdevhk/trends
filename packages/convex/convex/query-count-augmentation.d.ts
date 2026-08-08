// Type-surface shim for Query.count().
//
// The Convex runtime supports `db.query(table).count()` (syscall "1.0/count",
// verified in convex 1.39.1 query_impl.js), but the public `convex/server`
// type surface omits it in every published version through 1.43.0 — `count`
// is declared only on the internal QueryImpl class, never on the exported
// Query/QueryInitializer interfaces. Without this augmentation, budget-safe
// row counts (e.g. coverage queries that must not `.collect()` a 9k-row
// table) fail to typecheck.
//
// Referenced from companies.ts (via triple-slash) because that file is also
// compiled inside the apps/web program through the `_generated/api` import
// chain, which does not include this directory's files otherwise.
//
// Remove this file if a future convex release declares `count` on the public
// Query interface.

import "convex/server";

declare module "convex/server" {
  interface Query<TableInfo extends GenericTableInfo> {
    count(): Promise<number>;
  }
}
