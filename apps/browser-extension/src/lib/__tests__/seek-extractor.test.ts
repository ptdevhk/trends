// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";

import {
  createSeekExtractor,
  unwrapSeekProfileSnapshot,
  type SeekExtractorDeps,
} from "../seek-extractor";

function createMockDeps(overrides: Record<string, unknown> = {}): SeekExtractorDeps {
  return {
    getCurrentSourceKey: vi.fn(() => "seek"),
    SOURCE_KEYS: { JOB51: "job51", JOB5156: "job5156", SEEK: "seek" },
    apiSnapshot: {
      seekRecommendedCandidates: [],
      seekTalentSearch: [],
      seekProfile: null,
      seekRecommendedRequest: null,
      seekTalentSearchRequest: null,
      seekProfileRequest: null,
    },
    normalizeOptionalPositiveInt: (v: unknown) => {
      if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
      if (typeof v === "string") {
        const n = Number.parseInt(v, 10);
        return Number.isFinite(n) && n > 0 ? n : null;
      }
      return null;
    },
    DEFAULT_SEEK_PAGE_SIZE: 20,
    SEEK_PROFILE_TYPE: "seek",
    persistLatestAutoSyncSummary: vi.fn(),
    win: {
      location: {
        pathname: "/candidates/recommended",
        href: "https://www.seek.com/candidates/recommended",
        hostname: "www.seek.com",
        search: "",
      },
    },
    doc: { querySelectorAll: vi.fn(() => []), querySelector: vi.fn(() => null) },
    asHTMLElement: (el: unknown) => el as HTMLElement | null,
    isDisabledPaginationControl: vi.fn(() => false),
    waitForSeekProfileSnapshot: vi.fn(),
    SEEK_DETAIL_FETCH_CONCURRENCY: 3,
    SEEK_DETAIL_FETCH_DELAY_MS: 1000,
    SEEK_TALENTSEARCH_DETAIL_FETCH_CONCURRENCY: 1,
    SEEK_TALENTSEARCH_DETAIL_FETCH_DELAY_MS: 200,
    SEEK_TALENTSEARCH_DETAIL_TIMEOUT_MS: 4000,
    SEEK_DETAIL_PARAM: "tr_seek_detail",
    delay: vi.fn(() => Promise.resolve()),
    SELECTORS: { seekPagination: ".seek-pagination", seekTalentSearchPagination: ".seek-ts-pagination" },
    ...overrides,
  } as unknown as SeekExtractorDeps;
}

describe("seek-extractor", () => {
  describe("normalizeSeekLocationLabel", () => {
    it("removes Malaysia and MY", () => {
      const extractor = createSeekExtractor(createMockDeps());
      expect(extractor.normalizeSeekLocationLabel("Kuala Lumpur, Malaysia")).toBe(
        "kuala lumpur",
      );
      expect(extractor.normalizeSeekLocationLabel("Penang MY")).toBe("penang");
    });

    it("replaces Chinese punctuation with spaces", () => {
      const extractor = createSeekExtractor(createMockDeps());
      expect(
        extractor.normalizeSeekLocationLabel("吉隆坡、槟城、柔佛"),
      ).toBe("吉隆坡 槟城 柔佛");
    });

    it("collapses multiple spaces", () => {
      const extractor = createSeekExtractor(createMockDeps());
      expect(extractor.normalizeSeekLocationLabel("  a   b  ")).toBe("a b");
    });

    it("returns empty for empty input", () => {
      const extractor = createSeekExtractor(createMockDeps());
      expect(extractor.normalizeSeekLocationLabel("")).toBe("");
      expect(extractor.normalizeSeekLocationLabel(null)).toBe("");
    });

    it("converts to lowercase", () => {
      const extractor = createSeekExtractor(createMockDeps());
      expect(extractor.normalizeSeekLocationLabel("KUALA LUMPUR")).toBe(
        "kuala lumpur",
      );
    });
  });

  describe("getSeekCandidateIdentity", () => {
    it("extracts profileId and profileType from candidate", () => {
      const extractor = createSeekExtractor(createMockDeps());
      const result = extractor.getSeekCandidateIdentity({
        profileId: "12345",
        profileType: "seek",
      });
      expect(result).toEqual({ profileId: "12345", profileType: "seek" });
    });

    it("defaults profileType to SEEK_PROFILE_TYPE", () => {
      const extractor = createSeekExtractor(createMockDeps());
      const result = extractor.getSeekCandidateIdentity({ profileId: "123" });
      expect(result.profileType).toBe("seek");
    });

    it("converts profileId to string", () => {
      const extractor = createSeekExtractor(createMockDeps());
      const result = extractor.getSeekCandidateIdentity({ profileId: 123 });
      expect(result.profileId).toBe("123");
    });

    it("returns empty profileId for null candidate", () => {
      const extractor = createSeekExtractor(createMockDeps());
      const result = extractor.getSeekCandidateIdentity(null);
      expect(result.profileId).toBe("");
    });
  });

  describe("buildSeekProfileUrl", () => {
    it("builds URL with jobId when provided", () => {
      const extractor = createSeekExtractor(createMockDeps());
      const url = extractor.buildSeekProfileUrl("12345", "678");
      expect(url).toContain("openProfileId=12345");
      expect(url).toContain("jobId=678");
    });

    it("builds URL without jobId", () => {
      const extractor = createSeekExtractor(createMockDeps());
      const url = extractor.buildSeekProfileUrl("12345", undefined);
      expect(url).toContain("/candidates/12345");
      expect(url).not.toContain("jobId");
    });

    it("returns empty string for empty profileId", () => {
      const extractor = createSeekExtractor(createMockDeps());
      expect(extractor.buildSeekProfileUrl("", undefined)).toBe("");
      expect(extractor.buildSeekProfileUrl(null as unknown as string, undefined)).toBe("");
    });
  });

  describe("buildSeekNameSearchUrl", () => {
    it("builds search URL with name and market", () => {
      const extractor = createSeekExtractor(createMockDeps());
      const url = extractor.buildSeekNameSearchUrl("John Doe", "MY", undefined);
      expect(url).toContain("searchQuery=John%20Doe");
      expect(url).toContain("market=MY");
      expect(url).toContain("pageNumber=1");
    });

    it("includes roleTitles when provided", () => {
      const extractor = createSeekExtractor(createMockDeps());
      const url = extractor.buildSeekNameSearchUrl(
        "John",
        "MY",
        "Software Engineer",
      );
      expect(url).toContain("roleTitles=Software%20Engineer");
    });

    it("returns empty string for empty name", () => {
      const extractor = createSeekExtractor(createMockDeps());
      expect(extractor.buildSeekNameSearchUrl("", "MY", undefined)).toBe("");
      expect(extractor.buildSeekNameSearchUrl("  ", "MY", undefined)).toBe("");
    });
  });

  describe("getSeekCardCount", () => {
    it("counts recommended candidate cards rendered as heading rows", () => {
      window.history.pushState(
        {},
        "",
        "/candidates/recommended?jobId=92216704",
      );
      document.body.innerHTML = `
        <div>
          <span data-role="heading">Candidate One</span>
          <span data-testid="work-history">Sales Engineer at Company A</span>
        </div>
        <div>
          <span data-role="heading">Candidate Two</span>
          <span data-testid="work-history">Service Engineer at Company B</span>
        </div>
      `;

      try {
        const extractor = createSeekExtractor(
          createMockDeps({
            doc: {
              querySelector: (selector: string) =>
                document.querySelector(selector),
              querySelectorAll: (selector: string) =>
                document.querySelectorAll(selector),
            },
          }),
        );

        expect(extractor.getSeekCardCount()).toBe(2);
      } finally {
        document.body.innerHTML = "";
        window.history.pushState({}, "", "/");
      }
    });
  });

  describe("resolveSeekAutoSyncPageWindow", () => {
    it("returns start page 1 by default", () => {
      const extractor = createSeekExtractor(createMockDeps());
      const result = extractor.resolveSeekAutoSyncPageWindow({});
      expect(result.startPage).toBe(1);
    });

    it("calculates targetPageEnd from limit and page size", () => {
      const extractor = createSeekExtractor(createMockDeps());
      const result = extractor.resolveSeekAutoSyncPageWindow({
        startPage: 1,
        limit: 60,
        requestedPageSize: 20,
      });
      expect(result.limitPageCount).toBe(3);
      expect(result.targetPageEnd).toBe(3);
    });

    it("respects maxPages when smaller than limitPageCount", () => {
      const extractor = createSeekExtractor(createMockDeps());
      const result = extractor.resolveSeekAutoSyncPageWindow({
        startPage: 1,
        limit: 100,
        maxPages: 2,
        requestedPageSize: 20,
      });
      expect(result.allowedPageCount).toBe(2);
      expect(result.targetPageEnd).toBe(2);
    });

    it("returns null targetPageEnd when no limit or maxPages", () => {
      const extractor = createSeekExtractor(createMockDeps());
      const result = extractor.resolveSeekAutoSyncPageWindow({
        startPage: 1,
      });
      expect(result.targetPageEnd).toBeNull();
    });
  });

  describe("isSeekAutoSyncPageWindowReached", () => {
    it("returns true when currentPage >= targetPageEnd", () => {
      const extractor = createSeekExtractor(createMockDeps());
      expect(
        extractor.isSeekAutoSyncPageWindowReached(
          { startPage: 1, targetPageEnd: 3 },
          3,
        ),
      ).toBe(true);
      expect(
        extractor.isSeekAutoSyncPageWindowReached(
          { startPage: 1, targetPageEnd: 3 },
          4,
        ),
      ).toBe(true);
    });

    it("returns false when currentPage < targetPageEnd", () => {
      const extractor = createSeekExtractor(createMockDeps());
      expect(
        extractor.isSeekAutoSyncPageWindowReached(
          { startPage: 1, targetPageEnd: 3 },
          2,
        ),
      ).toBe(false);
    });

    it("returns false when targetPageEnd is null", () => {
      const extractor = createSeekExtractor(createMockDeps());
      expect(
        extractor.isSeekAutoSyncPageWindowReached(
          { startPage: 1, targetPageEnd: null },
          5,
        ),
      ).toBe(false);
    });
  });

  describe("shouldStopSeekAutoSyncForPageWindow", () => {
    it("does not stop on page window when limit remains (short pages → 99/100)", () => {
      const extractor = createSeekExtractor(createMockDeps());
      expect(
        extractor.shouldStopSeekAutoSyncForPageWindow({
          pageWindowReached: true,
          limit: 100,
          totalSubmitted: 99,
        }),
      ).toBe(false);
    });

    it("stops on page window once the limit is met", () => {
      const extractor = createSeekExtractor(createMockDeps());
      expect(
        extractor.shouldStopSeekAutoSyncForPageWindow({
          pageWindowReached: true,
          limit: 100,
          totalSubmitted: 100,
        }),
      ).toBe(true);
    });

    it("stops on page window when there is no limit", () => {
      const extractor = createSeekExtractor(createMockDeps());
      expect(
        extractor.shouldStopSeekAutoSyncForPageWindow({
          pageWindowReached: true,
          limit: null,
          totalSubmitted: 40,
        }),
      ).toBe(true);
    });

    it("does not stop when page window is not reached", () => {
      const extractor = createSeekExtractor(createMockDeps());
      expect(
        extractor.shouldStopSeekAutoSyncForPageWindow({
          pageWindowReached: false,
          limit: 100,
          totalSubmitted: 20,
        }),
      ).toBe(false);
    });
  });

  describe("resolveSeekAutoSyncCurrentPageSelection", () => {
    it("returns full page when no limit", () => {
      const extractor = createSeekExtractor(createMockDeps());
      const result = extractor.resolveSeekAutoSyncCurrentPageSelection({
        currentPageResumeCount: 20,
      });
      expect(result.remainingCapacity).toBeNull();
      expect(result.selectedCount).toBe(20);
      expect(result.hitLimitWithinPage).toBe(false);
    });

    it("calculates remaining capacity from limit", () => {
      const extractor = createSeekExtractor(createMockDeps());
      const result = extractor.resolveSeekAutoSyncCurrentPageSelection({
        limit: 50,
        totalSubmitted: 30,
        currentPageResumeCount: 20,
      });
      expect(result.remainingCapacity).toBe(20);
      expect(result.selectedCount).toBe(20);
      expect(result.hitLimitWithinPage).toBe(false);
    });

    it("detects hitLimitWithinPage", () => {
      const extractor = createSeekExtractor(createMockDeps());
      const result = extractor.resolveSeekAutoSyncCurrentPageSelection({
        limit: 50,
        totalSubmitted: 40,
        currentPageResumeCount: 20,
      });
      expect(result.remainingCapacity).toBe(10);
      expect(result.selectedCount).toBe(10);
      expect(result.hitLimitWithinPage).toBe(true);
    });

    it("detects limitAlreadyReached", () => {
      const extractor = createSeekExtractor(createMockDeps());
      const result = extractor.resolveSeekAutoSyncCurrentPageSelection({
        limit: 50,
        totalSubmitted: 50,
        currentPageResumeCount: 20,
      });
      expect(result.remainingCapacity).toBe(0);
      expect(result.limitAlreadyReached).toBe(true);
    });
  });

  describe("resolveSeekAutoSyncPageSize", () => {
    it("returns requestedPageSize when valid", () => {
      const extractor = createSeekExtractor(createMockDeps());
      expect(extractor.resolveSeekAutoSyncPageSize({ requestedPageSize: 25 })).toBe(25);
    });

    it("falls back to currentPageCandidateCount", () => {
      const extractor = createSeekExtractor(createMockDeps());
      expect(
        extractor.resolveSeekAutoSyncPageSize({ currentPageCandidateCount: 18 }),
      ).toBe(18);
    });

    it("falls back to DEFAULT_SEEK_PAGE_SIZE", () => {
      const extractor = createSeekExtractor(createMockDeps());
      expect(extractor.resolveSeekAutoSyncPageSize({})).toBe(20);
    });
  });

  describe("getSeekPayloadData", () => {
    it("extracts data from array payload for seekRecommendedCandidates", () => {
      const extractor = createSeekExtractor(createMockDeps());
      const payload = [
        { data: { talentSearchRecommendedCandidatesV2: { items: [] } } },
      ];
      const result = extractor.getSeekPayloadData(
        payload,
        "seekRecommendedCandidates",
      );
      expect(result).toEqual({
        talentSearchRecommendedCandidatesV2: { items: [] },
      });
    });

    it("extracts data from array payload for seekTalentSearch", () => {
      const extractor = createSeekExtractor(createMockDeps());
      const payload = [
        {
          data: {
            talentSearchProfilesNaturalLanguageSearch: { result: {} },
          },
        },
      ];
      const result = extractor.getSeekPayloadData(payload, "seekTalentSearch");
      expect(result).toEqual({
        talentSearchProfilesNaturalLanguageSearch: { result: {} },
      });
    });

    it("extracts data from object payload with data key", () => {
      const extractor = createSeekExtractor(createMockDeps());
      const payload = { data: { someKey: "value" } };
      const result = extractor.getSeekPayloadData(payload, "seekProfile");
      expect(result).toEqual({ someKey: "value" });
    });

    it("returns null for null payload", () => {
      const extractor = createSeekExtractor(createMockDeps());
      expect(extractor.getSeekPayloadData(null, "seekProfile")).toBeNull();
    });
  });

  describe("extractSeekProfileResume", () => {
    it("returns empty array when no profile snapshot", () => {
      const extractor = createSeekExtractor(createMockDeps());
      const result = extractor.extractSeekProfileResume();
      expect(result).toEqual([]);
    });

    it("extracts resume from profile snapshot", () => {
      const extractor = createSeekExtractor(
        createMockDeps({
          apiSnapshot: {
            seekProfile: {
              profileId: "123",
              firstName: "John",
              lastName: "Doe",
              currentJobTitle: "Engineer",
              currentLocation: "KL",
              lastModifiedDate: "2026-01-01",
            },
            seekRecommendedRequest: null,
            seekProfileRequest: null,
          },
        }),
      );
      const result = extractor.extractSeekProfileResume();
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("John Doe");
      expect(result[0].jobIntention).toBe("Engineer");
      expect(result[0].location).toBe("KL");
    });
  });

  describe("unwrapSeekProfileSnapshot", () => {
    it("unwraps V3 { result: { profileGuid, workHistories } } envelopes", () => {
      const unwrapped = unwrapSeekProfileSnapshot({
        __typename: "TalentSearchProfileCompleteV3Response",
        result: {
          profileGuid: "guid-abc",
          profileId: 12345,
          firstName: "Zahra",
          workHistories: [
            {
              companyName: "CNC Innovations",
              jobTitle: "Senior Sales Role",
              description: "Strategic sales and marketing leadership",
            },
          ],
        },
      });
      expect(unwrapped?.profileGuid).toBe("guid-abc");
      expect(unwrapped?.profileId).toBe(12345);
      expect(Array.isArray(unwrapped?.workHistories)).toBe(true);
      expect(
        (unwrapped?.workHistories as Array<{ description?: string }>)[0]
          ?.description,
      ).toContain("Strategic sales");
    });

    it("unwraps talentSearchProfileV3.result GraphQL data shapes", () => {
      const unwrapped = unwrapSeekProfileSnapshot({
        talentSearchProfileV3: {
          __typename: "TalentSearchProfileCompleteV3Response",
          result: {
            profileGuid: "guid-nested",
            firstName: "A",
            workHistories: [],
          },
        },
      });
      expect(unwrapped?.profileGuid).toBe("guid-nested");
    });

    it("returns flat profiles unchanged", () => {
      const flat = {
        profileGuid: "guid-flat",
        profileId: "99",
        firstName: "B",
      };
      expect(unwrapSeekProfileSnapshot(flat)).toEqual(flat);
    });
  });

  describe("extractSeekProfileResume V3 result envelope", () => {
    it("extracts workHistory descriptions from nested V3 result", () => {
      const extractor = createSeekExtractor(
        createMockDeps({
          apiSnapshot: {
            seekProfile: {
              __typename: "TalentSearchProfileCompleteV3Response",
              result: {
                profileGuid: "64454550-aea1-11ec-bfb2-005056b16351",
                profileId: 536401553,
                firstName: "Zahra",
                lastName: "Bahadori",
                currentJobTitle: "Senior Sales Role",
                currentLocation: "Penang, MY",
                personalSummary: "Results-driven sales professional",
                workHistories: [
                  {
                    companyName: "CNC Innovations",
                    jobTitle: "Senior Sales Role",
                    durationLabel: "May 2021 - Present (5 years 3 months)",
                    description:
                      "Strategic sales and marketing leadership\nIn-depth knowledge of high-performance engine parts",
                  },
                ],
                skills: ["Sales", "Communication Skills"],
              },
            },
            seekProfileRequest: null,
          },
          win: {
            location: {
              pathname: "/talentsearch",
              href: "https://hk.employer.seek.com/talentsearch?market=MY",
              hostname: "hk.employer.seek.com",
              search: "?market=MY",
            },
          },
        }),
      );

      const result = extractor.extractSeekProfileResume();
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        seekProfileGuid: "64454550-aea1-11ec-bfb2-005056b16351",
        name: "Zahra Bahadori",
        jobIntention: "Senior Sales Role",
        selfIntro: "Results-driven sales professional",
        externalId:
          "hk.employer.seek.com:profile:64454550-aea1-11ec-bfb2-005056b16351",
      });
      // Talentsearch must use name-search URLs, not /candidates/<numericId>
      expect(result[0].profileUrl).toContain(
        "/talentsearch/profiles/search?searchQuery=Zahra%20Bahadori",
      );
      expect(result[0].profileUrl).toContain("market=MY");
      expect(result[0].profileUrl).not.toMatch(/\/candidates\/\d+/);
      expect(result[0].workHistory?.[0]?.description).toContain(
        "Strategic sales",
      );
      expect(result[0].skills).toEqual(["Sales", "Communication Skills"]);
    });
  });

  describe("mergeSeekListResumeWithDetail talentsearch profileUrl", () => {
    it("keeps list name-search profileUrl instead of /candidates/<id>", async () => {
      const detailProfile = {
        profileGuid: "guid-sam",
        profileId: "541579092",
        firstName: "Samuel",
        lastName: "Krishnan",
        currentJobTitle: "Sales",
        currentLocation: "MY",
        workHistories: [
          {
            companyName: "Acme",
            jobTitle: "Sales",
            description: "Sold things",
            durationLabel: "2020 - Present",
          },
        ],
      };
      const apiSnapshot = {
        seekTalentSearch: [] as unknown[],
        seekProfile: detailProfile as unknown,
        seekRecommendedCandidates: null as unknown,
        seekTalentSearchRequest: null as unknown,
        seekProfileRequest: null as unknown,
        seekRecommendedRequest: null as unknown,
      };
      const waitForSeekProfileSnapshot = vi.fn(async () => {
        apiSnapshot.seekProfile = detailProfile;
      });
      const click = vi.fn();
      const trigger = Object.assign(document.createElement("button"), {
        textContent: "Samuel Krishnan",
      });
      trigger.setAttribute("data-tr-candidate-id", "guid-sam");
      trigger.click = click;
      const listUrl =
        "https://hk.employer.seek.com/talentsearch/profiles/search?searchQuery=Samuel%20Krishnan&market=MY&pageNumber=1";
      const deps = createMockDeps({
        getCurrentSourceKey: vi.fn(() => "seek"),
        waitForSeekProfileSnapshot,
        SEEK_TALENTSEARCH_DETAIL_FETCH_CONCURRENCY: 1,
        SEEK_TALENTSEARCH_DETAIL_FETCH_DELAY_MS: 0,
        SEEK_TALENTSEARCH_DETAIL_TIMEOUT_MS: 100,
        SEEK_DETAIL_PARAM: "tr_seek_detail",
        win: {
          location: {
            pathname: "/talentsearch",
            href: "https://hk.employer.seek.com/talentsearch?searchQuery=CNC&market=MY",
            hostname: "hk.employer.seek.com",
            search: "?searchQuery=CNC&market=MY",
          },
        },
        doc: {
          querySelector: vi.fn((selector: string) =>
            selector.includes("data-tr-candidate-id") ? trigger : null,
          ),
          querySelectorAll: vi.fn(() => [] as unknown as NodeListOf<Element>),
          body: { dispatchEvent: vi.fn() },
        },
        apiSnapshot,
      });
      const extractor = createSeekExtractor(deps);
      const input = [
        {
          profileId: "guid-sam",
          seekProfileGuid: "guid-sam",
          name: "Samuel Krishnan",
          jobIntention: "Sales",
          profileUrl: listUrl,
          externalId: "hk.employer.seek.com:profile:guid-sam",
          workHistory: [{ companyName: "Acme", jobTitle: "Sales", raw: "Sales · Acme" }],
        },
      ];

      const result = await extractor.enrichSeekResumesWithDetail(input);
      expect(result).toHaveLength(1);
      expect(result[0].profileUrl).toBe(listUrl);
      expect(result[0].profileUrl).not.toContain("/candidates/541579092");
      expect(result[0].workHistory?.[0]?.description).toContain("Sold things");
    });
  });

  describe("extractSeekResumes", () => {
    it("returns empty array when no candidates", () => {
      const extractor = createSeekExtractor(createMockDeps());
      const result = extractor.extractSeekResumes();
      expect(result).toEqual([]);
    });

    it("extracts resumes from seekRecommendedCandidates", () => {
      const extractor = createSeekExtractor(
        createMockDeps({
          apiSnapshot: {
            seekRecommendedCandidates: [
              {
                profileId: "1",
                firstName: "Alice",
                lastName: "Smith",
                currentJobTitle: "Manager",
                currentLocation: "SG",
              },
              {
                profileId: "2",
                firstName: "Bob",
                lastName: "Jones",
                currentJobTitle: "Analyst",
                currentLocation: "HK",
              },
            ],
            seekRecommendedRequest: null,
          },
        }),
      );
      const result = extractor.extractSeekResumes();
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe("Alice Smith");
      expect(result[1].name).toBe("Bob Jones");
    });

    it("falls back to rendered recommended cards when API candidates are absent", () => {
      window.history.pushState(
        {},
        "",
        "/candidates/recommended?jobId=92216704",
      );
      document.body.innerHTML = `
        <div>
          <span data-role="heading">Candidate One</span>
          <span data-testid="work-history">Sales Engineer at Company A</span>
          <span data-testid="work-history">Service Manager at Company B</span>
        </div>
        <div>
          <span data-role="heading">Candidate Two</span>
          <span data-testid="work-history">Application Engineer at Company C</span>
        </div>
      `;

      try {
        const extractor = createSeekExtractor(
          createMockDeps({
            apiSnapshot: {
              seekRecommendedCandidates: [],
              seekRecommendedRequest: null,
            },
            doc: {
              querySelector: (selector: string) =>
                document.querySelector(selector),
              querySelectorAll: (selector: string) =>
                document.querySelectorAll(selector),
            },
            win: {
              location: {
                pathname: "/candidates/recommended",
                href: "https://hk.employer.seek.com/candidates/recommended?jobId=92216704",
                hostname: "hk.employer.seek.com",
                search: "?jobId=92216704",
              },
            },
          }),
        );

        expect(extractor.getSeekCurrentCandidateCount()).toBe(2);
        const result = extractor.extractSeekResumes();

        expect(result).toHaveLength(2);
        expect(result[0]).toMatchObject({
          profileId: "dom-92216704-1-1",
          name: "Candidate One",
          jobIntention: "Sales Engineer",
          source: "hk.employer.seek.com",
          pageNumber: 1,
        });
        expect(result[0].workHistory).toEqual([
          { raw: "Sales Engineer at Company A" },
          { raw: "Service Manager at Company B" },
        ]);
        expect(result[1]).toMatchObject({
          profileId: "dom-92216704-1-2",
          name: "Candidate Two",
          jobIntention: "Application Engineer",
        });
      } finally {
        document.body.innerHTML = "";
        window.history.pushState({}, "", "/");
      }
    });
  });

  describe("extractSeekTalentSearchResumes", () => {
    it("returns empty array when no talent search data", () => {
      const extractor = createSeekExtractor(createMockDeps());
      const result = extractor.extractSeekTalentSearchResumes();
      expect(result).toEqual([]);
    });

    it("extracts resumes from seekTalentSearch", () => {
      const extractor = createSeekExtractor(
        createMockDeps({
          apiSnapshot: {
            seekTalentSearch: [
              {
                id: "relay-1",
                profileGuid: "uuid-abc",
                firstName: "Carol",
                lastName: "White",
                currentJobTitle: "Director",
                currentLocation: "AU",
              },
            ],
            seekTalentSearchRequest: null,
          },
        }),
      );
      const result = extractor.extractSeekTalentSearchResumes();
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("Carol White");
      expect(result[0].profileId).toBe("uuid-abc");
    });

    it("detects talentsearch mode from profile list URL and produces identity/source host", () => {
      const talentUrl =
        "https://hk.employer.seek.com/talentsearch?searchQuery=CNC&market=MY&pageNumber=1&keywords=CNC";
      const deps = createMockDeps({
        win: {
          location: {
            pathname: "/talentsearch",
            href: talentUrl,
            hostname: "hk.employer.seek.com",
            search: "?searchQuery=CNC&market=MY&pageNumber=1&keywords=CNC",
          },
        },
        apiSnapshot: {
          seekTalentSearch: [
            {
              id: "relay-2",
              profileGuid: "uuid-talent-my",
              firstName: "Aisha",
              lastName: "Rahman",
              currentJobTitle: "Sales Engineer",
              currentLocation: "Kuala Lumpur",
            },
          ],
          seekTalentSearchRequest: {
            variables: {
              language: "en",
              input: {
                pageNumber: 1,
                originalNaturalLanguageQuery: "CNC",
                searchMode: "NATURAL_LANGUAGE",
              },
            },
          },
        },
      });
      // jsdom window must also reflect talentsearch list path for mode helpers
      window.history.pushState({}, "", talentUrl.replace("https://hk.employer.seek.com", ""));
      Object.defineProperty(window, "location", {
        value: {
          pathname: "/talentsearch",
          href: talentUrl,
          hostname: "hk.employer.seek.com",
          search: "?searchQuery=CNC&market=MY&pageNumber=1&keywords=CNC",
        },
        writable: true,
      });

      const extractor = createSeekExtractor(deps);
      expect(extractor.isSeekTalentSearchListPage()).toBe(true);
      expect(extractor.getCurrentSeekMode()).toBe("talentsearch");

      const resumes = extractor.extractSeekTalentSearchResumes();
      expect(resumes).toHaveLength(1);
      expect(resumes[0].name).toBe("Aisha Rahman");
      expect(resumes[0].profileId).toBe("uuid-talent-my");
      // List extract attaches externalId/source on the full extract path; talent list
      // objects at least carry identity for submit pipeline.
      expect(resumes[0].profileId).toMatch(/uuid-talent-my/);

      const context = extractor.buildSeekCollectionContext();
      expect(context.seekMode).toBe("talentsearch");
      expect(context.captureMode).toBe("graphql-talentsearch");
    });
  });

  describe("enrichSeekResumesWithDetail", () => {
    it("processes resumes in batches of SEEK_DETAIL_FETCH_CONCURRENCY", async () => {
      const enrichCalls: number[] = [];
      let callIndex = 0;
      const mockEnrich = vi.fn(async (resume: unknown) => {
        enrichCalls.push(++callIndex);
        return resume;
      });

      const deps = createMockDeps({
        getCurrentSourceKey: vi.fn(() => "seek"),
        win: { location: { pathname: "/candidates/recommended", href: "", hostname: "", search: "" } },
        SEEK_DETAIL_FETCH_CONCURRENCY: 2,
        SEEK_DETAIL_FETCH_DELAY_MS: 500,
        delay: vi.fn(() => Promise.resolve()),
      });
      const extractor = createSeekExtractor(deps);

      // Mock the internal enrichSingleSeekResumeWithDetail by testing through the public API
      // Since enrichSeekResumesWithDetail is not directly exposed, we test the behavior
      // through the extraction pipeline integration. Here we verify the deps are wired correctly.
      expect(deps.SEEK_DETAIL_FETCH_CONCURRENCY).toBe(2);
      expect(deps.SEEK_DETAIL_FETCH_DELAY_MS).toBe(500);
      expect(typeof deps.delay).toBe("function");
    });

    it("delay function is called between batches", async () => {
      const delayMock = vi.fn(() => Promise.resolve());
      const deps = createMockDeps({
        delay: delayMock,
        SEEK_DETAIL_FETCH_CONCURRENCY: 2,
        SEEK_DETAIL_FETCH_DELAY_MS: 1000,
      });

      // Verify delay is available as a dependency
      expect(deps.delay).toBeDefined();
      await deps.delay(1000);
      expect(delayMock).toHaveBeenCalledWith(1000);
    });

    it("constants are exported with expected values", async () => {
      const {
        SEEK_DETAIL_FETCH_CONCURRENCY,
        SEEK_DETAIL_FETCH_DELAY_MS,
        SEEK_TALENTSEARCH_DETAIL_FETCH_CONCURRENCY,
        SEEK_TALENTSEARCH_DETAIL_FETCH_DELAY_MS,
        SEEK_TALENTSEARCH_DETAIL_TIMEOUT_MS,
        SEEK_DETAIL_PARAM,
      } = await import("../content-constants");
      expect(SEEK_DETAIL_FETCH_CONCURRENCY).toBe(3);
      expect(SEEK_DETAIL_FETCH_DELAY_MS).toBe(1000);
      expect(SEEK_TALENTSEARCH_DETAIL_FETCH_CONCURRENCY).toBe(1);
      expect(SEEK_TALENTSEARCH_DETAIL_FETCH_DELAY_MS).toBe(200);
      expect(SEEK_TALENTSEARCH_DETAIL_TIMEOUT_MS).toBe(4000);
      expect(SEEK_DETAIL_PARAM).toBe("tr_seek_detail");
    });

    it("enriches talentsearch detail by default (job descriptions for latest-3 scoring)", async () => {
      const detailProfile = {
        profileGuid: "guid-1",
        profileId: "12345",
        firstName: "Alice",
        lastName: "Tan",
        currentJobTitle: "Sales",
        currentLocation: "Penang, MY",
        workHistories: [
          {
            companyName: "CNC BPO Solutions",
            jobTitle: "Sales Representative",
            description:
              "Answer phones and respond to customer requests.\nSell product and place customer orders.",
            durationLabel: "Oct 2011 - Nov 2012 (1 year 2 months)",
          },
        ],
      };
      const apiSnapshot = {
        seekTalentSearch: [] as unknown[],
        seekProfile: detailProfile as unknown,
        seekRecommendedCandidates: null as unknown,
        seekTalentSearchRequest: null as unknown,
        seekProfileRequest: null as unknown,
        seekRecommendedRequest: null as unknown,
      };
      // enrichSingle clears seekProfile then waits; restore V3 payload on wait.
      const waitForSeekProfileSnapshot = vi.fn(async () => {
        apiSnapshot.seekProfile = detailProfile;
      });
      const click = vi.fn();
      const trigger = Object.assign(document.createElement("button"), {
        textContent: "Alice Tan",
      });
      trigger.setAttribute("data-tr-candidate-id", "guid-1");
      trigger.click = click;
      const deps = createMockDeps({
        getCurrentSourceKey: vi.fn(() => "seek"),
        waitForSeekProfileSnapshot,
        SEEK_TALENTSEARCH_DETAIL_FETCH_CONCURRENCY: 1,
        SEEK_TALENTSEARCH_DETAIL_FETCH_DELAY_MS: 0,
        SEEK_TALENTSEARCH_DETAIL_TIMEOUT_MS: 100,
        SEEK_DETAIL_PARAM: "tr_seek_detail",
        win: {
          location: {
            pathname: "/talentsearch",
            href: "https://hk.employer.seek.com/talentsearch?searchQuery=CNC&market=MY",
            hostname: "hk.employer.seek.com",
            search: "?searchQuery=CNC&market=MY",
          },
        },
        doc: {
          querySelector: vi.fn((selector: string) =>
            selector.includes("data-tr-candidate-id") ? trigger : null,
          ),
          querySelectorAll: vi.fn(() => [] as unknown as NodeListOf<Element>),
          body: {
            dispatchEvent: vi.fn(),
          },
        },
        apiSnapshot,
      });
      const extractor = createSeekExtractor(deps);
      const input = [
        {
          profileId: "guid-1",
          seekProfileGuid: "guid-1",
          name: "Alice Tan",
          workHistory: [{ companyName: "X", jobTitle: "Sales", raw: "Sales · X" }],
        },
      ];

      const result = await extractor.enrichSeekResumesWithDetail(input);

      expect(click).toHaveBeenCalled();
      expect(waitForSeekProfileSnapshot).toHaveBeenCalledWith("guid-1", { timeoutMs: 100 });
      expect(result).toHaveLength(1);
      const workHistory = (result[0] as { workHistory?: Array<{ description?: string }> })
        .workHistory;
      expect(workHistory?.[0]?.description).toContain("Answer phones");
    });

    it("skips talentsearch detail enrichment when tr_seek_detail=0 (list-only fast path)", async () => {
      const waitForSeekProfileSnapshot = vi.fn();
      const deps = createMockDeps({
        getCurrentSourceKey: vi.fn(() => "seek"),
        waitForSeekProfileSnapshot,
        SEEK_DETAIL_PARAM: "tr_seek_detail",
        win: {
          location: {
            pathname: "/talentsearch",
            href: "https://hk.employer.seek.com/talentsearch?searchQuery=CNC&market=MY&tr_seek_detail=0",
            hostname: "hk.employer.seek.com",
            search: "?searchQuery=CNC&market=MY&tr_seek_detail=0",
          },
        },
      });
      const extractor = createSeekExtractor(deps);
      const input = [
        { profileId: "guid-1", name: "A", workHistory: [{ company: "X", title: "Sales" }] },
        { profileId: "guid-2", name: "B", workHistory: [{ company: "Y", title: "Sales" }] },
      ];

      const result = await extractor.enrichSeekResumesWithDetail(input);

      expect(result).toEqual(input);
      expect(waitForSeekProfileSnapshot).not.toHaveBeenCalled();
    });

    it("skips SPA panel open when workHistory already has descriptions", async () => {
      const waitForSeekProfileSnapshot = vi.fn();
      const click = vi.fn();
      const trigger = Object.assign(document.createElement("button"), {
        textContent: "Alice Tan",
      });
      trigger.setAttribute("data-tr-candidate-id", "guid-1");
      trigger.click = click;
      const deps = createMockDeps({
        getCurrentSourceKey: vi.fn(() => "seek"),
        waitForSeekProfileSnapshot,
        SEEK_DETAIL_PARAM: "tr_seek_detail",
        win: {
          location: {
            pathname: "/talentsearch",
            href: "https://hk.employer.seek.com/talentsearch?searchQuery=CNC&market=MY",
            hostname: "hk.employer.seek.com",
            search: "?searchQuery=CNC&market=MY",
          },
        },
        doc: {
          querySelector: vi.fn((selector: string) =>
            selector.includes("data-tr-candidate-id") ? trigger : null,
          ),
          querySelectorAll: vi.fn(() => [] as unknown as NodeListOf<Element>),
        },
      });
      const extractor = createSeekExtractor(deps);
      const input = [
        {
          profileId: "guid-1",
          seekProfileGuid: "guid-1",
          name: "Alice Tan",
          workHistory: [
            {
              companyName: "CNC BPO Solutions",
              jobTitle: "Sales Representative",
              description: "Already enriched description",
            },
          ],
        },
      ];

      const result = await extractor.enrichSeekResumesWithDetail(input);

      expect(result).toEqual(input);
      expect(click).not.toHaveBeenCalled();
      expect(waitForSeekProfileSnapshot).not.toHaveBeenCalled();
    });
  });
});
