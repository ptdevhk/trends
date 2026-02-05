import { describe, expect, it } from "vitest";

import { ResumesQuerySchema } from "../../schemas/resumes";

describe("ResumesQuerySchema CSV delimiter handling", () => {
    const parseLocations = (value: string): string[] => {
        const result = ResumesQuerySchema.parse({ locations: value });
        return result.locations ?? [];
    };

    it("splits ASCII and Chinese comma variants", () => {
        expect(parseLocations("东莞,深圳")).toEqual(["东莞", "深圳"]);
        expect(parseLocations("东莞，深圳")).toEqual(["东莞", "深圳"]);
        expect(parseLocations("东莞、深圳")).toEqual(["东莞", "深圳"]);
        expect(parseLocations("东莞,深圳，广州、佛山")).toEqual(["东莞", "深圳", "广州", "佛山"]);
    });
});
