/**
 * Tests for the ingest-compute epoch registry + the T3 company-key
 * projection epoch (a separate counter: bumping the projection epoch must NOT
 * mass-trigger isComputeStale reingest).
 */
import { describe, expect, it } from "vitest";
import {
    COMPANY_KEY_PROJECTION_EPOCH_HISTORY,
    CURRENT_COMPANY_KEY_PROJECTION_EPOCH,
    CURRENT_INGEST_COMPUTE_EPOCH,
    INGEST_COMPUTE_EPOCH_HISTORY,
    isCompanyKeyProjectionStale,
    isComputeStale,
} from "../ingest-compute-epoch.js";

describe("ingest-compute-epoch registry", () => {
    it("CURRENT matches the newest history entry and epochs strictly increase", () => {
        expect(INGEST_COMPUTE_EPOCH_HISTORY.length).toBeGreaterThan(0);
        expect(CURRENT_INGEST_COMPUTE_EPOCH).toBe(
            INGEST_COMPUTE_EPOCH_HISTORY[INGEST_COMPUTE_EPOCH_HISTORY.length - 1]!.epoch,
        );
        for (let i = 1; i < INGEST_COMPUTE_EPOCH_HISTORY.length; i += 1) {
            expect(INGEST_COMPUTE_EPOCH_HISTORY[i]!.epoch).toBeGreaterThan(
                INGEST_COMPUTE_EPOCH_HISTORY[i - 1]!.epoch,
            );
        }
        for (const entry of INGEST_COMPUTE_EPOCH_HISTORY) {
            expect(entry.reason.length).toBeGreaterThan(0);
            expect(entry.introduced).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        }
    });

    it("company-key projection epoch registry is independent of the ingest compute epoch", () => {
        expect(COMPANY_KEY_PROJECTION_EPOCH_HISTORY.length).toBeGreaterThan(0);
        expect(CURRENT_COMPANY_KEY_PROJECTION_EPOCH).toBe(
            COMPANY_KEY_PROJECTION_EPOCH_HISTORY[COMPANY_KEY_PROJECTION_EPOCH_HISTORY.length - 1]!.epoch,
        );
        // The projection counter shares the registry shape but must never be
        // conflated with the compute epoch: bumping it must not flip
        // isComputeStale (that would mass-trigger a full reingest).
        expect(CURRENT_COMPANY_KEY_PROJECTION_EPOCH).not.toBe(CURRENT_INGEST_COMPUTE_EPOCH);
    });
});

describe("isCompanyKeyProjectionStale", () => {
    it("treats missing or null projections as stale", () => {
        expect(isCompanyKeyProjectionStale(undefined)).toBe(true);
        expect(isCompanyKeyProjectionStale(null)).toBe(true);
    });

    it("treats non-numeric or non-finite epochs as stale", () => {
        expect(isCompanyKeyProjectionStale({})).toBe(true);
        expect(isCompanyKeyProjectionStale({ epoch: "1" as unknown as number })).toBe(true);
        expect(isCompanyKeyProjectionStale({ epoch: Number.NaN })).toBe(true);
        expect(isCompanyKeyProjectionStale({ epoch: Number.POSITIVE_INFINITY })).toBe(true);
    });

    it("treats behind-current epochs as stale and current-or-newer as fresh", () => {
        const current = CURRENT_COMPANY_KEY_PROJECTION_EPOCH;
        expect(isCompanyKeyProjectionStale({ epoch: 0 })).toBe(true);
        expect(isCompanyKeyProjectionStale({ epoch: current - 1 })).toBe(true);
        expect(isCompanyKeyProjectionStale({ epoch: current })).toBe(false);
        // Future epochs (rolled-back code) stay fresh until the registry catches up.
        expect(isCompanyKeyProjectionStale({ epoch: current + 1 })).toBe(false);
    });

    it("honors an explicit current epoch argument", () => {
        expect(isCompanyKeyProjectionStale({ epoch: 2 }, 3)).toBe(true);
        expect(isCompanyKeyProjectionStale({ epoch: 3 }, 3)).toBe(false);
    });

    it("never treats the projection as compute-stale signal", () => {
        // A projection-only field must not affect the ingest-compute epoch.
        expect(isComputeStale({ ingestComputeEpoch: CURRENT_INGEST_COMPUTE_EPOCH })).toBe(false);
    });
});
