import type { MiddlewareHandler } from "hono";
import { callConvexQuery } from "../services/convex-utils.js";

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const CACHE_TTL_MS = 5_000;
const CONVEX_QUERY_PATH = "system_settings:isMaintenanceMode";

type CachedFlag = { value: boolean; fetchedAt: number };

let cached: CachedFlag | null = null;

async function fetchMaintenanceMode(): Promise<boolean> {
    const now = Date.now();
    if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
        return cached.value;
    }

    try {
        const value = await callConvexQuery(CONVEX_QUERY_PATH, {});
        const flag = value === true;
        cached = { value: flag, fetchedAt: now };
        return flag;
    } catch (err) {
        console.error(
            "[maintenance] Failed to query Convex for maintenance flag; defaulting to off",
            err,
        );
        // Fail open — don't block all writes if Convex is unreachable.
        // Still cache the "off" decision briefly so we don't hammer Convex on every write.
        cached = { value: false, fetchedAt: now };
        return false;
    }
}

/** Reset the in-process cache. Intended for tests; not part of the public API. */
export function _resetMaintenanceCache(): void {
    cached = null;
}

export const maintenanceGuard: MiddlewareHandler = async (c, next) => {
    if (!WRITE_METHODS.has(c.req.method)) {
        await next();
        return;
    }

    const isMaintenance = await fetchMaintenanceMode();
    if (isMaintenance) {
        return c.json(
            {
                success: false as const,
                error: "Maintenance mode active — writes are temporarily disabled",
            },
            503,
        );
    }
    await next();
};
