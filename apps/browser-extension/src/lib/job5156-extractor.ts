/**
 * Job5156-specific resume extraction utilities — page detection, DOM parsing,
 * API payload processing, and enrichment. All dependencies injected from content.ts.
 */

export interface Job5156ExtractorDeps extends Record<string, unknown> {
  getCurrentSourceKey: () => string;
  SOURCE_KEYS: Record<string, string>;
  apiSnapshot: Record<string, unknown>;
  normalizeResumeText: (value: unknown) => string;
  normalizeResumeMultilineText: (value: unknown) => string;
  buildWorkHistoryRawParts: (parts: string[]) => string;
  normalizeOptionalPositiveInt: (value: unknown) => number | null;
  JOB5156_HOST: string;
  JOB5156_PROFILE_URL_PREFIX: string;
  JOB5156_DETAIL_FETCH_TIMEOUT_MS: number;
  JOB5156_DETAIL_FETCH_CONCURRENCY: number;
  isMeaningfulJob5156WorkHistoryEntry: (entry: unknown) => boolean;
  collectJob5156SectionItemsByHeading: (
    root: unknown,
    headingPattern: RegExp,
    primarySelectors: string[],
    fallbackSelectors?: string[],
  ) => Element[];
}

export function createJob5156Extractor(deps: Job5156ExtractorDeps) {
  const {
    getCurrentSourceKey,
    SOURCE_KEYS,
    apiSnapshot,
    normalizeResumeText,
    normalizeResumeMultilineText,
    buildWorkHistoryRawParts,
    normalizeOptionalPositiveInt,
    JOB5156_HOST,
    JOB5156_PROFILE_URL_PREFIX,
    JOB5156_DETAIL_FETCH_TIMEOUT_MS,
    JOB5156_DETAIL_FETCH_CONCURRENCY,
    isMeaningfulJob5156WorkHistoryEntry,
    collectJob5156SectionItemsByHeading,
  } = deps;

  function decodeURIComponentSafe(value) {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  function extractJob5156ResumeId(pathname) {
    if (!pathname || typeof pathname !== "string") return "";

    const oldRouteMatch = pathname.match(/^\/api\/com\/resume\/([^/?#]+)/i);
    if (oldRouteMatch && oldRouteMatch[1]) {
      return decodeURIComponentSafe(oldRouteMatch[1]);
    }

    const viewRouteMatch = pathname.match(/^\/resume\/view\/([^/?#]+)/i);
    if (viewRouteMatch && viewRouteMatch[1]) {
      return decodeURIComponentSafe(viewRouteMatch[1]);
    }

    return "";
  }

  function normalizeJob5156ProfileUrlForExport(value) {
    if (!value || typeof value !== "string") return "";
    const trimmed = value.trim();
    if (!trimmed) return "";

    const directResumeId = extractJob5156ResumeId(trimmed);
    if (directResumeId) {
      return `${JOB5156_PROFILE_URL_PREFIX}${encodeURIComponent(directResumeId)}`;
    }

    try {
      const parsed = new URL(trimmed, window.location.origin);
      if (parsed.hostname.toLowerCase() !== JOB5156_HOST) {
        return parsed.href;
      }

      const resumeId = extractJob5156ResumeId(parsed.pathname);
      if (!resumeId) {
        return parsed.href;
      }

      return `${JOB5156_PROFILE_URL_PREFIX}${encodeURIComponent(resumeId)}`;
    } catch {
      return trimmed;
    }
  }

  function isJob5156DetailPage() {
    return (
      getCurrentSourceKey() === SOURCE_KEYS.JOB5156 &&
      /^\/resume\/view\//i.test(window.location.pathname)
    );
  }

  function getJob5156DetailRoot() {
    const candidates = [
      ".resume-detail",
      ".resume-detail-content",
      ".resume-detail-main",
      ".resume-view-content",
      ".resume-content",
      ".detail-content",
      ".main-content",
      '[class*="resume-detail"]',
      '[class*="resumeDetail"]',
      '[class*="resume-view"]',
      '[class*="resumeView"]',
      "main",
    ];

    for (const selector of candidates) {
      const el = document.querySelector(selector);
      if (
        el instanceof Element &&
        normalizeResumeText(el.textContent || "").length > 40
      ) {
        return el;
      }
    }

    return document.body;
  }

  function getJob5156DetailHeaderText(root = getJob5156DetailRoot()) {
    if (!(root instanceof Element)) return "";
    const header = root.querySelector(
      'h1, .name, .resume-name, .basic-name, [class*="name"]',
    );
    return normalizeResumeText(
      header?.textContent ||
        root.querySelector(
          '.basic-line, .resume-basic-info, [class*="basic"], .resume-view-item__block.resume-basic',
        )?.textContent ||
        "",
    );
  }

  function isJob5156DetailReady() {
    if (!isJob5156DetailPage()) return false;
    const resumeId = extractJob5156ResumeId(window.location.pathname);
    if (!resumeId) return false;
    const root = getJob5156DetailRoot();
    const rootText = normalizeResumeText(root?.textContent || "");
    return (
      root instanceof Element &&
      rootText.length > 80 &&
      getJob5156DetailHeaderText(root).length > 0
    );
  }

  function isJob5156DetailRootReady(root, pathname) {
    if (!(root instanceof Element)) return false;
    const resumeId = extractJob5156ResumeId(pathname || "");
    if (!resumeId) return false;
    const rootText = normalizeResumeText(root.textContent || "");
    return rootText.length > 80 && getJob5156DetailHeaderText(root).length > 0;
  }

  function buildJob5156DetailWorkHistoryItem(item) {
    if (!(item instanceof Element)) return null;

    if (
      item.classList.contains("resume-work__info") ||
      item.closest(".resume-work")
    ) {
      const row1 = item.querySelector(".resume-work__row-1");
      const row2 = item.querySelector(".resume-work__row-2");
      const row3 = item.querySelector(".resume-work__row-3");
      const row4 = item.querySelector(".resume-work__row-4");
      const companyName = normalizeResumeText(
        row1?.querySelector(".flex.flex-1 > span.pointer")?.textContent,
      );
      const jobTitle = normalizeResumeText(
        row1?.querySelector(".flex.flex-1 > span:not(.pointer):not(.cut)")
          ?.textContent,
      );
      const periodText = normalizeResumeText(
        row1?.querySelector(".time-diff")?.textContent,
      );
      const periodMatch = periodText.match(/^(.+?)(?:（(.+)）)?$/u);
      const dateRange = normalizeResumeText(periodMatch?.[1] || periodText);
      const durationLabel = normalizeResumeText(periodMatch?.[2] || "");
      const startDate = dateRange.includes("~")
        ? normalizeResumeText(dateRange.split("~")[0])
        : dateRange;
      const endDate = dateRange.includes("~")
        ? normalizeResumeText(dateRange.split("~").slice(1).join("~"))
        : "";
      const companyMeta = normalizeResumeText(row2?.textContent);
      const description = normalizeResumeText(
        row3?.querySelector("pre")?.textContent || row3?.textContent,
      );
      const reasonText = normalizeResumeText(row4?.textContent).replace(
        /^离职原因[:：]?\s*/u,
        "",
      );
      const raw = buildWorkHistoryRawParts([
        dateRange,
        durationLabel ? `(${durationLabel})` : "",
        companyName,
        jobTitle,
        companyMeta ? `公司信息：${companyMeta}` : "",
        description,
        reasonText ? `离职原因：${reasonText}` : "",
      ]);

      if (!raw && !description && !companyName && !jobTitle) return null;

      return {
        raw:
          raw ||
          description ||
          buildWorkHistoryRawParts([companyName, jobTitle, dateRange]),
        companyName: companyName || undefined,
        jobTitle: jobTitle || undefined,
        description:
          [description, reasonText ? `离职原因：${reasonText}` : ""]
            .filter(Boolean)
            .join("\n") || undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
      };
    }

    const getText = (selectors) => {
      for (const selector of selectors) {
        const value = normalizeResumeText(
          item.querySelector(selector)?.textContent,
        );
        if (value) return value;
      }
      return "";
    };

    const getOwnText = (selectors) => {
      for (const selector of selectors) {
        const node = item.querySelector(selector);
        if (!(node instanceof Element)) continue;
        const text = normalizeResumeText(
          Array.from(node.childNodes)
            .filter((child) => child.nodeType === Node.TEXT_NODE)
            .map((child) => child.textContent || "")
            .join(" "),
        );
        if (text) return text;
      }
      return "";
    };

    const getLines = (selectors) => {
      for (const selector of selectors) {
        const nodes = item.querySelectorAll(selector);
        const values = Array.from(nodes)
          .map((node) => normalizeResumeText(node.textContent))
          .filter(Boolean);
        if (values.length > 0) return values;
      }
      return [];
    };

    const periodText = getText([
      ".work-time",
      ".time",
      ".date",
      ".work-date",
      ".job-time",
      '[class*="work-time"]',
      '[class*="job-time"]',
    ]);
    const startDate = periodText.includes("~")
      ? normalizeResumeText(periodText.split("~")[0])
      : periodText;
    const endDate = periodText.includes("~")
      ? normalizeResumeText(periodText.split("~").slice(1).join("~"))
      : "";
    const durationLabel = getText([
      ".work-time-other",
      ".time-other",
      ".duration",
      '[class*="duration"]',
    ]);
    const companyName = getText([
      ".work-company",
      ".company-name",
      ".company",
      '[class*="company"]',
    ]);
    const jobTitle = getText([
      ".work-position",
      ".job-title",
      ".position-name",
      ".position",
      '[class*="position"]',
      '[class*="job-title"]',
    ]);
    const department = getText([
      ".work-department",
      ".department",
      '[class*="department"]',
    ]);
    const companyMeta = getText([
      ".company-other",
      ".company-info",
      ".company-meta",
      '[class*="company-other"]',
      '[class*="company-info"]',
    ]);
    const reasonText = getText([
      ".work-reason",
      ".leave-reason",
      '[class*="leave-reason"]',
      '[class*="reason"]',
    ]).replace(/^离职原因[:：]?\s*/u, "");
    const ownDescription = getOwnText([
      ".work-desc",
      ".work-detail",
      ".work-content",
      ".work-responsibility",
      ".work-duty",
      '[class*="work-desc"]',
      '[class*="responsibility"]',
      '[class*="duty"]',
    ]);
    const descriptionLines = getLines([
      ".work-desc p, .work-detail p, .work-content p, .work-responsibility p, .work-duty p",
      ".work-desc li, .work-detail li, .work-content li, .work-responsibility li, .work-duty li",
      '[class*="work-desc"] p, [class*="responsibility"] p, [class*="duty"] p',
      '[class*="work-desc"] li, [class*="responsibility"] li, [class*="duty"] li',
    ]);
    const description = [
      ownDescription,
      descriptionLines.length > 0 ? descriptionLines.join("\n") : "",
      department ? `部门：${department}` : "",
      companyMeta ? `公司信息：${companyMeta}` : "",
      reasonText ? `离职原因：${reasonText}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    const raw = buildWorkHistoryRawParts([
      periodText,
      durationLabel,
      companyName,
      jobTitle,
      department ? `部门：${department}` : "",
      companyMeta ? `公司信息：${companyMeta}` : "",
      ownDescription,
      descriptionLines.join("；"),
      reasonText ? `离职原因：${reasonText}` : "",
    ]);

    if (!raw && !description) return null;

    return {
      raw: raw || description,
      companyName: companyName || undefined,
      jobTitle: jobTitle || undefined,
      description: description || undefined,
      department: department || undefined,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
    };
  }

  function collectSectionItemsByHeading(
    root,
    headingPattern,
    primarySelectors = [],
    fallbackSelectors = [],
  ) {
    const { collectJob5156SectionItemsByHeading } = deps;
    return collectJob5156SectionItemsByHeading(
      root,
      headingPattern,
      primarySelectors,
      fallbackSelectors,
    );
  }

  function buildJob5156DetailResumeFromRoot(root, options: Record<string, unknown> = {}) {
    if (!(root instanceof Element)) return [];

    const {
      pathname,
      profileUrl: profileUrlInput,
      extractedAt,
    } = normalizeJob5156ExtractOptions(options);
    if (!isJob5156DetailRootReady(root, pathname)) return [];

    const readText = (selectors, scopedRoot = root) => {
      for (const selector of selectors) {
        const value = normalizeResumeText(
          scopedRoot.querySelector(selector)?.textContent,
        );
        if (value) return value;
      }
      return "";
    };
    const resumeId = extractJob5156ResumeId(pathname);
    const profileUrl = normalizeJob5156ProfileUrlForExport(profileUrlInput);
    const basicTextNodes = Array.from(
      root.querySelectorAll(
        '.basic-line__text, .basic-line span, .resume-basic-info span, [class*="basic"] span, .info-item, .label-value, .tag',
      ),
    ).map((node) => node.textContent || "");
    const filteredBasicTextNodes = basicTextNodes.filter(
      (item) => !/求职状态|沟通中|更新时间/.test(item),
    );
    const { age, experience, education, location } = parseJob5156BasicInfoItems(
      filteredBasicTextNodes,
    );

    const workItems = collectSectionItemsByHeading(
      root,
      /工作经历|工作经验|工作履历/u,
      [
        ".resume-work__info",
        ".work-item",
        ".work-block",
        '[class*="work-item"]',
        '[class*="work-block"]',
      ],
      [
        ":scope > li",
        ":scope > .item",
        ':scope > [class*="item"]',
      ],
    );
    const educationItems = collectSectionItemsByHeading(
      root,
      /教育经历|教育背景|学习经历/u,
      [
        ".resume-education__info",
        ".school-item",
        '[class*="education"]',
        '[class*="school"]',
      ],
      [
        ":scope > li",
        ":scope > .item",
        ':scope > [class*="item"]',
      ],
    );
    const seenWorkHistory = new Set();
    const workHistory = workItems
      .map((item) => buildJob5156DetailWorkHistoryItem(item))
      .filter((item) => item && isMeaningfulJob5156WorkHistoryEntry(item))
      .filter((item) => {
        const signature = [
          item.companyName || "",
          item.jobTitle || "",
          item.startDate || "",
          item.endDate || "",
          item.raw || "",
        ].join("|");
        if (seenWorkHistory.has(signature)) return false;
        seenWorkHistory.add(signature);
        return true;
      });

    const seenEducation = new Set();
    const profileEducation = educationItems
      .map((item) => buildJob5156EducationItem(item))
      .filter(
        (item) =>
          item &&
          [item.institution, item.qualification, item.endDate].some(Boolean),
      )
      .filter((item) => {
        const signature = [
          item.institution || "",
          item.qualification || "",
          item.endDate || "",
        ].join("|");
        if (seenEducation.has(signature)) return false;
        seenEducation.add(signature);
        return true;
      });

    const activityStatus = readText([
      ".date-type-diff-text-block",
      ".resume-status",
      ".active-status",
      '[class*="status"]',
    ]);
    const intentionSection = root.querySelector(
      ".resume-view-layout.resume-interview",
    );
    const intentionItems = Array.from(
      intentionSection?.querySelectorAll(".resume-interview-info") || [],
    );
    const jobIntention = intentionItems
      .map((item) =>
        normalizeResumeText(item.querySelector(".pos-name")?.textContent),
      )
      .filter(Boolean)
      .join(" / ");
    const expectedSalary = normalizeResumeText(
      intentionItems[0]?.textContent,
    ).replace(/^.+?\s(\d[^\s]*元\/[月天年]).*$/u, "$1");
    const selfIntro = normalizeResumeText(
      root.querySelector(
        ".resume-view-layout.resume-advantages .resume-advantages_skill pre",
      )?.textContent ||
        root.querySelector(
          ".resume-view-layout.resume-advantages .resume-advantages_skill",
        )?.textContent ||
        "",
    );
    const name = readText([
      ".resume-name",
      ".basic-name",
      ".name",
      ".resume-view-item__block.resume-basic",
      "h1",
    ]);

    return [
      {
        resumeId,
        name,
        profileUrl,
        activityStatus,
        age,
        experience,
        education,
        location,
        jobIntention,
        expectedSalary,
        selfIntro,
        workHistory,
        profileEducation:
          profileEducation.length > 0 ? profileEducation : undefined,
        extractedAt,
        source: JOB5156_HOST,
      },
    ];
  }

  function extractJob5156DetailResume() {
    if (!isJob5156DetailPage() || !isJob5156DetailReady()) return [];
    return buildJob5156DetailResumeFromRoot(getJob5156DetailRoot(), {
      pathname: window.location.pathname,
      profileUrl: window.location.href,
    });
  }

  function buildJob5156DetailWorkHistoryItemFromApi(item) {
    if (!item || typeof item !== "object") return null;

    const begin = normalizeResumeText(item.begin);
    const end = normalizeResumeText(item.end);
    const dateRange = [begin, end].filter(Boolean).join("~");
    const durationLabel = normalizeResumeText(item.timeDiff || item.timeDiff2);
    const companyName = normalizeResumeText(item.comName || item.comNameStr);
    const jobTitle = normalizeResumeText(item.jobNameStr || item.jobName);
    const department = normalizeResumeText(item.section);
    const companyMeta = buildWorkHistoryRawParts([
      normalizeResumeText(item.comCallingStr),
      normalizeResumeText(item.comScaleStr),
      normalizeResumeText(item.comTypeStr),
    ]);
    const description = normalizeResumeMultilineText(item.description);
    const reasonText = normalizeResumeText(item.leftreason);
    const startDate = begin || undefined;
    const endDate = end || undefined;
    const descriptionLines = [
      companyMeta ? `公司信息：${companyMeta}` : "",
      department ? `部门：${department}` : "",
      description,
      reasonText ? `离职原因：${reasonText}` : "",
    ].filter(Boolean);
    const raw = buildWorkHistoryRawParts([
      dateRange,
      durationLabel ? `(${durationLabel})` : "",
      companyName,
      jobTitle,
      ...descriptionLines,
    ]);

    if (!raw && !description && !companyName && !jobTitle) return null;

    return {
      raw: raw || description || buildWorkHistoryRawParts([companyName, jobTitle, dateRange]),
      companyName: companyName || undefined,
      jobTitle: jobTitle || undefined,
      description: descriptionLines.join("\n") || undefined,
      startDate,
      endDate,
    };
  }

  function buildJob5156EducationItemFromApi(item) {
    if (!item || typeof item !== "object") return null;

    const institution = normalizeResumeText(item.schoolName);
    const degree = normalizeResumeText(item.degreeStr);
    const speciality = normalizeResumeText(item.speciality);
    const qualification = buildWorkHistoryRawParts([degree, speciality]);
    const endDate = normalizeResumeText(
      [item.begin, item.end].filter(Boolean).join("~") || item.end,
    );
    const description = buildWorkHistoryRawParts([
      degree,
      speciality,
      endDate,
      institution,
    ]);

    if (!institution && !qualification && !endDate) return null;

    return {
      institution: institution || undefined,
      qualification: qualification || undefined,
      endDate: endDate || undefined,
      description: description || undefined,
    };
  }

  function normalizeJob5156ExtractOptions(options: Record<string, unknown> = {}) {
    return {
      pathname:
        typeof options.pathname === "string"
          ? options.pathname
          : window.location.pathname,
      profileUrl:
        typeof options.profileUrl === "string"
          ? options.profileUrl
          : window.location.href,
      extractedAt:
        typeof options.extractedAt === "string"
          ? options.extractedAt
          : new Date().toISOString(),
    };
  }

  function buildJob5156DetailResumeFromApiPayload(payload, options: Record<string, unknown> = {}) {
    if (!payload || typeof payload !== "object") return [];

    const { pathname, profileUrl, extractedAt } =
      normalizeJob5156ExtractOptions(options);
    const resumeId =
      extractJob5156ResumeId(pathname) || normalizeResumeText(payload.resumeId);
    const normalizedProfileUrl = normalizeJob5156ProfileUrlForExport(profileUrl);
    const resumeView =
      payload.resumeViewVo && typeof payload.resumeViewVo === "object"
        ? payload.resumeViewVo
        : null;
    const cnVo =
      resumeView?.cnVo && typeof resumeView.cnVo === "object"
        ? resumeView.cnVo
        : null;
    const basicInfo =
      cnVo?.basicInfoVo && typeof cnVo.basicInfoVo === "object"
        ? cnVo.basicInfoVo
        : null;
    const intentInfo =
      cnVo?.intentInfoVo && typeof cnVo.intentInfoVo === "object"
        ? cnVo.intentInfoVo
        : null;

    if (!resumeId || !cnVo || !basicInfo) return [];

    const workHistory = Array.isArray(cnVo.workInfoVoList)
      ? cnVo.workInfoVoList
          .map((item) => buildJob5156DetailWorkHistoryItemFromApi(item))
          .filter(Boolean)
      : [];
    const profileEducation = Array.isArray(cnVo.educationInfoVoList)
      ? cnVo.educationInfoVoList
          .map((item) => buildJob5156EducationItemFromApi(item))
          .filter(Boolean)
      : [];
    const locationParts = [
      normalizeResumeText(cnVo.liveProvince),
      normalizeResumeText(cnVo.liveCity),
      normalizeResumeText(cnVo.liveTown),
    ].filter(Boolean);
    const intentionParts = Array.isArray(payload.intentInfoVo2List)
      ? payload.intentInfoVo2List
          .map((item) => normalizeResumeText(item.jobNameStr || item.jobCodeStr))
          .filter(Boolean)
      : [];

    return [
      {
        resumeId,
        perUserId: normalizeResumeText(payload.perUserId || basicInfo.id),
        name: normalizeResumeText(payload.userName || basicInfo.userName),
        profileUrl: normalizedProfileUrl,
        activityStatus: normalizeResumeText(basicInfo.jobStateStr),
        age: normalizeResumeText(basicInfo.age ? `${basicInfo.age}岁` : ""),
        experience: normalizeResumeText(
          basicInfo.firstWorkingTimeStr || basicInfo.jobyearTypeStr,
        ),
        education: normalizeResumeText(
          basicInfo.degreeStr || cnVo.maxDegree?.degreeStr,
        ),
        location: normalizeResumeText(
          locationParts.join("") || basicInfo.locationStr,
        ),
        jobIntention: normalizeResumeText(
          intentionParts.join(",") ||
            (intentInfo?.jobLocationStr &&
              `${intentInfo.jobLocationStr}${intentInfo.jobCodeStr ? `${intentInfo.jobCodeStr}` : ""}`) ||
            intentInfo?.jobCodeStr,
        ),
        expectedSalary: normalizeResumeText(
          payload.salaryStr || intentInfo?.salaryStr,
        ),
        selfIntro: normalizeResumeText(intentInfo?.professionSkill),
        workHistory,
        profileEducation:
          profileEducation.length > 0 ? profileEducation : undefined,
        extractedAt,
        source: JOB5156_HOST,
      },
    ];
  }

  async function fetchJob5156ResumeDetail(profileUrl, pathname) {
    const resumePathname =
      typeof pathname === "string" && pathname
        ? pathname
        : new URL(profileUrl).pathname;
    const resumeId = extractJob5156ResumeId(resumePathname);
    if (!resumeId) return null;

    const url = new URL(
      `/api/com/resume/${encodeURIComponent(resumeId)}`,
      window.location.origin,
    );
    url.searchParams.set("t", String(Date.now()));
    url.searchParams.set("version", "1");
    url.searchParams.set("dataVersions", "");
    url.searchParams.set("modType", "search");
    url.searchParams.set("keyWord", "");
    url.searchParams.set("searchNo", "0");
    url.searchParams.set("searchNumber", "0");
    url.searchParams.set("searchPageNumber", "0");
    url.searchParams.set("index_number", "0");
    url.searchParams.set("isTopResume", "false");
    url.searchParams.set("isWindow", "true");
    url.searchParams.set("resumeId", resumeId);
    url.searchParams.set("indexNumber", "0");

    const controller = new AbortController();
    const timeoutId = window.setTimeout(
      () => controller.abort(),
      JOB5156_DETAIL_FETCH_TIMEOUT_MS,
    );

    try {
      const response = await fetch(url.toString(), {
        credentials: "include",
        headers: {
          Accept: "application/json",
          appType: "pc",
          pcVersion: "1.0.1",
          posTypeNewFlag: "true",
          version: "2.0",
        },
        signal: controller.signal,
      });

      if (!response.ok) return null;
      const payload = await response.json();
      if (
        !payload ||
        typeof payload !== "object" ||
        payload.code !== 200 ||
        !payload.data
      )
        return null;
      return payload.data;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError")
        return null;
      throw error;
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  async function enrichSingleJob5156SearchResumeWithDetail(resume, extractedAt) {
    if (!resume || typeof resume !== "object") return null;

    const profileUrl = normalizeJob5156ProfileUrlForExport(
      resume.profileUrl || "",
    );
    const fallbackResume = {
      ...resume,
      profileUrl,
      extractedAt: resume.extractedAt || extractedAt,
    };

    if (!profileUrl) return fallbackResume;

    try {
      let detailResume = null;
      const pathname = new URL(profileUrl).pathname;
      const detailPayload = await fetchJob5156ResumeDetail(profileUrl, pathname);
      if (detailPayload) {
        detailResume =
          buildJob5156DetailResumeFromApiPayload(detailPayload, {
            pathname,
            profileUrl,
            extractedAt: fallbackResume.extractedAt,
          })[0] || null;
      }

      if (!detailResume) {
        const response = await fetch(profileUrl, {
          credentials: "include",
          headers: { Accept: "text/html,application/xhtml+xml" },
        });
        if (response.ok) {
          const html = await response.text();
          const parser = new DOMParser();
          const doc = parser.parseFromString(html, "text/html");
          detailResume =
            buildJob5156DetailResumeFromRoot(doc.body, {
              pathname,
              profileUrl,
              extractedAt: fallbackResume.extractedAt,
            })[0] || null;
        }
      }

      if (!detailResume) return fallbackResume;

      return {
        ...fallbackResume,
        ...detailResume,
        workHistory: detailResume.workHistory || fallbackResume.workHistory || [],
        resumeId: detailResume.resumeId || fallbackResume.resumeId,
        perUserId: detailResume.perUserId || fallbackResume.perUserId,
        extractedAt: fallbackResume.extractedAt,
      };
    } catch (error) {
      console.warn(
        "🎯 [Auto Sync] Failed to enrich Job5156 detail resume:",
        profileUrl,
        error,
      );
      return fallbackResume;
    }
  }

  async function enrichJob5156SearchResumesWithDetail(resumes) {
    if (!Array.isArray(resumes) || resumes.length === 0) return [];

    const extractedAt = new Date().toISOString();
    const enriched = [];

    for (
      let start = 0;
      start < resumes.length;
      start += JOB5156_DETAIL_FETCH_CONCURRENCY
    ) {
      const batch = resumes.slice(
        start,
        start + JOB5156_DETAIL_FETCH_CONCURRENCY,
      );
      const batchResults = await Promise.all(
        batch.map((resume) =>
          enrichSingleJob5156SearchResumeWithDetail(resume, extractedAt),
        ),
      );

      enriched.push(
        ...batchResults.filter(Boolean),
      );
    }

    return enriched;
  }

  function parseJob5156BasicInfoItems(items, locationOverride = "") {
    const basicInfo = Array.isArray(items)
      ? items.map((item) => normalizeResumeText(item)).filter(Boolean)
      : [];

    let age = "";
    let experience = "";
    let education = "";
    let location = "";

    // Always use heuristic matching — positional indexing is fragile for
    // CN resumes that include gender / political / marital fields
    basicInfo.forEach((item) => {
      if (!age && item.includes("岁")) age = item;
      else if (!experience && item.includes("年") && !item.includes("元"))
        experience = item;
      else if (
        !education &&
        /(中专|高中|大专|本科|硕|博|研究生|MBA|EMBA)/.test(item)
      )
        education = item;
      // Exclude known non-location biographical fields (gender, political, marital)
      else if (
        !location &&
        !item.includes("元") &&
        !/^(男|女|已婚|未婚|群众|党员|团员|中共党员)$/.test(item)
      )
        location = item;
    });

    if (locationOverride) {
      location = normalizeResumeText(locationOverride);
    }

    return { age, experience, education, location };
  }

  function buildJob5156WorkHistoryItem(item) {
    if (!(item instanceof Element)) return null;

    const startDate = normalizeResumeText(
      item.querySelector(".work-time > span:first-child")?.textContent,
    );
    const durationLabel = normalizeResumeText(
      item.querySelector(".work-time-other")?.textContent,
    );
    const companyName = normalizeResumeText(
      item.querySelector(".work-company")?.textContent,
    );
    const jobTitle = normalizeResumeText(
      item.querySelector(".work-position")?.textContent,
    );
    const description = normalizeResumeText(
      item.querySelector(
        ".work-desc, .work-detail, .work-content, .work-responsibility, .work-duty",
      )?.textContent,
    );
    const endDate = startDate.includes("~")
      ? normalizeResumeText(startDate.split("~").slice(1).join("~"))
      : "";
    const raw = buildWorkHistoryRawParts([
      startDate,
      durationLabel,
      companyName,
      jobTitle,
      description,
    ]);

    if (!raw) return null;

    return {
      raw,
      companyName: companyName || undefined,
      jobTitle: jobTitle || undefined,
      description: description || undefined,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
    };
  }

  function buildJob5156EducationItem(item) {
    if (!(item instanceof Element)) return null;

    const liveEducationText = normalizeResumeText(item.textContent);
    if (
      item.classList.contains("resume-education__info") ||
      item.closest(".resume-education")
    ) {
      const institution = normalizeResumeText(
        item.querySelector(".flex.w-full > div:last-child")?.textContent,
      );
      const rowText = Array.from(item.querySelectorAll(".flex.w-full > div"))
        .map((node) => normalizeResumeText(node.textContent))
        .filter(Boolean);
      const endDate = rowText.find((value) => /^\d{4}(~|-)/.test(value)) || "";
      const qualification = rowText
        .filter((value) => value !== institution && value !== endDate)
        .join(" · ");

      if (!institution && !qualification && !endDate && !liveEducationText)
        return null;

      return {
        institution: institution || undefined,
        qualification: qualification || undefined,
        endDate: endDate || undefined,
        description: liveEducationText || undefined,
      };
    }

    const institution = normalizeResumeText(
      item.querySelector(".school-name")?.textContent,
    );
    const qualification = normalizeResumeText(
      item.querySelector(".school-major")?.textContent,
    );
    const degree = normalizeResumeText(
      item.querySelector(".school-degree")?.textContent,
    );
    const endDate = normalizeResumeText(
      item.querySelector(".school-time")?.textContent,
    );

    if (!institution && !qualification && !degree && !endDate) return null;

    return {
      institution: institution || undefined,
      qualification:
        [qualification, degree].filter(Boolean).join(" · ") || undefined,
      endDate: endDate || undefined,
    };
  }

  return {
    isJob5156DetailPage,
    getJob5156DetailRoot,
    getJob5156DetailHeaderText,
    isJob5156DetailReady,
    isJob5156DetailRootReady,
    parseJob5156BasicInfoItems,
    buildJob5156WorkHistoryItem,
    buildJob5156EducationItem,
    buildJob5156DetailWorkHistoryItem,
    buildJob5156DetailResumeFromRoot,
    extractJob5156DetailResume,
    buildJob5156DetailWorkHistoryItemFromApi,
    buildJob5156EducationItemFromApi,
    normalizeJob5156ExtractOptions,
    buildJob5156DetailResumeFromApiPayload,
    fetchJob5156ResumeDetail,
    enrichSingleJob5156SearchResumeWithDetail,
    enrichJob5156SearchResumesWithDetail,
    extractJob5156ResumeId,
    normalizeJob5156ProfileUrlForExport,
  };
}
