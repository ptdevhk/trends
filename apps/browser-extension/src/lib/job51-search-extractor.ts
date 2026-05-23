// @ts-nocheck
/**
 * 51job eHire search-specific utility functions — payload parsing, page detection,
 * rate-limit detection, and auth context extraction. All dependencies injected
 * from content.ts via DI factory pattern.
 */

export function createJob51SearchExtractor(deps) {
  const {
    getCurrentSourceKey,
    SOURCE_KEYS,
    apiSnapshot,
    normalizeJob51Text,
    normalizeJob51MultilineText,
    normalizeResumeText,
    buildWorkHistoryRawParts,
    EHIRE_51JOB_PROFILE_URL_PREFIX,
    EHIRE_51JOB_HOST,
    JOB51_PAGE_COOLDOWN_MS,
    JOB51_DETAIL_FETCH_TIMEOUT_MS,
    JOB51_RATE_LIMIT_ERROR_MESSAGE,
    buildJob51DetailResumeFromPayload,
    filterCurrentResumesByAgeRange,
    chrome,
    window: win,
    fetch: globalFetch,
    delay,
  } = deps;

  /**
   * Checks if the current page is a 51job resume detail page.
   */
  function isJob51DetailPage() {
    return (
      getCurrentSourceKey() === SOURCE_KEYS.JOB51 &&
      /\/Revision\/talent\/resume\/detail/i.test(window.location.pathname)
    );
  }

  /**
   * Checks if the 51job detail page has loaded its API payload.
   */
  function isJob51DetailReady() {
    return isJob51DetailPage() && !!apiSnapshot.job51DetailPayload;
  }

  /**
   * Extracts authentication headers from a captured 51job API request.
   * Searches through both request headers and body for auth tokens.
   */
  function normalizeJob51AuthContext(requestHeaders, request) {
    const headers =
      requestHeaders && typeof requestHeaders === "object" ? requestHeaders : {};
    const requestBody = request && typeof request === "object" ? request : {};
    const pick = (...keys) => {
      for (const key of keys) {
        const headerValue = headers[key] ?? headers[key.toLowerCase()];
        if (typeof headerValue === "string" && headerValue.trim()) {
          return headerValue.trim();
        }
        const requestValue = requestBody[key];
        if (typeof requestValue === "string" && requestValue.trim()) {
          return requestValue.trim();
        }
      }
      return "";
    };

    const accesstoken = pick("accesstoken", "access-token", "accessToken");
    const guid = pick("guid");
    const property = pick("property");
    const sign = pick("sign");

    if (!accesstoken && !guid && !property && !sign) {
      return null;
    }

    return {
      ...(accesstoken ? { accesstoken } : {}),
      ...(guid ? { guid } : {}),
      ...(property ? { property } : {}),
      ...(sign ? { sign } : {}),
    };
  }

  /**
   * Extracts raw rows array from a 51job search API payload.
   * Checks multiple possible key paths for the data array.
   */
  function getJob51RawRows(payload) {
    const rows =
      payload?.data?.list ||
      payload?.data?.items ||
      payload?.data?.rows ||
      payload?.list ||
      payload?.items ||
      payload?.rows ||
      (Array.isArray(payload?.data) ? payload.data : null) ||
      (Array.isArray(payload) ? payload : null);
    return Array.isArray(rows) ? rows : null;
  }

  /**
   * Extracts the total count from a 51job search API payload.
   */
  function getJob51TotalFromPayload(payload) {
    const total = payload?.data?.total ?? payload?.total;
    return typeof total === "number" && total >= 0 ? total : null;
  }

  /**
   * Validates whether a row object looks like a valid 51job resume row.
   * Checks for identity fields (resumeId, perUserId, etc.), name fields,
   * and detail fields (experience, education, location, etc.).
   */
  function isLikelyJob51ResumeRow(row) {
    if (!row || typeof row !== "object") return false;
    const baseInfo =
      row.base_info && typeof row.base_info === "object" ? row.base_info : null;
    const jobIntention =
      row.job_intention && typeof row.job_intention === "object"
        ? row.job_intention
        : null;
    const recentWorkInfo =
      row.recent_work_info && typeof row.recent_work_info === "object"
        ? row.recent_work_info
        : null;
    const identityCandidates = [
      row.resumeId,
      row.resumeNo,
      row.resumekey,
      row.perUserId,
      row.userId,
      row.candidateId,
      row.memberId,
      row.userid,
      row.real_userid,
      baseInfo?.accountid,
    ];
    const hasIdentity = identityCandidates.some((value) => {
      if (value == null) return false;
      return String(value).trim().length > 0;
    });
    const nameCandidates = [
      row.name,
      row.userName,
      row.candidateName,
      row.fullName,
      baseInfo?.resume_name,
    ];
    const hasName = nameCandidates.some((value) => {
      if (value == null) return false;
      return normalizeJob51Text(String(value)).length > 0;
    });
    const detailCandidates = [
      row.workYear,
      row.workYears,
      row.experienceYears,
      row.experience,
      row.education,
      row.educationLevel,
      row.degree,
      row.eduLevel,
      row.location,
      row.workCity,
      row.city,
      row.workLocation,
      row.jobIntention,
      row.desiredJob,
      row.expectedPosition,
      row.targetJob,
      row.searchJob,
      baseInfo?.work_year_value,
      baseInfo?.top_degree_value,
      baseInfo?.area_value,
      jobIntention?.expect_work_function_value,
      jobIntention?.expect_job_area_value,
      recentWorkInfo?.recent_position,
    ];
    const hasDetail = detailCandidates.some((value) => {
      if (value == null) return false;
      return normalizeJob51Text(String(value)).length > 0;
    });

    return (hasIdentity && hasName) || (hasName && hasDetail);
  }

  /**
   * Filters raw payload rows to only include valid resume rows.
   */
  function getJob51ResumeRows(payload) {
    const rows = getJob51RawRows(payload);
    return Array.isArray(rows) ? rows.filter(isLikelyJob51ResumeRow) : null;
  }

  /**
   * Checks if the API snapshot contains 51job search data.
   */
  function hasJob51SearchSnapshot() {
    if (!Array.isArray(apiSnapshot.job51SearchRows)) return false;
    return (
      apiSnapshot.job51SearchRows.length > 0 ||
      typeof apiSnapshot.job51Total === "number"
    );
  }

  /**
   * Detects if the 51job page shows the empty search prompt.
   */
  function isJob51EmptySearchPromptVisible() {
    if (getCurrentSourceKey() !== SOURCE_KEYS.JOB51) return false;
    const pageText = normalizeResumeText(document.body?.textContent || "");
    return pageText.includes("输入关键词搜索寻找匹配人才");
  }

  /**
   * Detects if the 51job page has triggered rate limiting by checking DOM text.
   */
  function isJob51RateLimitedPage() {
    if (getCurrentSourceKey() !== SOURCE_KEYS.JOB51) return false;
    const pageText = normalizeResumeText(document.body?.textContent || "");
    return (
      pageText.includes("搜索访问太快") && pageText.includes("请60分钟后再试")
    );
  }

  /**
   * Throws if the 51job page is rate-limited. Called as a guard before operations.
   */
  function ensureJob51PageAllowed() {
    if (isJob51RateLimitedPage()) {
      throw new Error(JOB51_RATE_LIMIT_ERROR_MESSAGE);
    }
  }

  /**
   * Waits for the configured cooldown period between 51job page navigations.
   */
  async function waitForJob51Cooldown() {
    if (getCurrentSourceKey() !== SOURCE_KEYS.JOB51) return;
    await delay(JOB51_PAGE_COOLDOWN_MS);
  }

  /**
   * Checks if an error message string indicates 51job rate limiting.
   */
  function isJob51RateLimitedErrorMessage(message) {
    const normalized = normalizeResumeText(String(message || ""));
    return (
      normalized.includes("搜索访问太快") ||
      normalized.includes("请60分钟后再试") ||
      normalized.includes("访问频率限制") ||
      normalized.includes("频率限制") ||
      normalized.toLowerCase().includes("rate limit")
    );
  }

  /**
   * Checks if an API response payload indicates rate limiting.
   * Searches common error fields (error, message, msg, detail) for rate-limit text.
   */
  function isJob51RateLimitedPayload(payload) {
    if (!payload) return false;
    const candidates = [
      payload.error,
      payload.message,
      payload.msg,
      payload.detail,
      payload.data?.error,
      payload.data?.message,
      payload.data?.msg,
      payload.data?.detail,
    ];
    return candidates.some((value) => isJob51RateLimitedErrorMessage(value));
  }

  /**
   * Checks if a 51job detail API response payload indicates an error.
   * Returns true for result=0 responses or non-200 error codes with messages.
   */
  function isJob51DetailApiErrorPayload(payload) {
    if (!payload || typeof payload !== "object") return false;
    if (payload.result === "0" || payload.result === 0) return true;
    return (
      typeof payload.code === "string" &&
      payload.code.length > 0 &&
      payload.code !== "200" &&
      payload.code !== "0" &&
      typeof payload.msg === "string" &&
      payload.msg.length > 0
    );
  }

  /**
   * Attempts to fetch a 51job resume detail via chrome.runtime.sendMessage
   * to the background script (fallback path).
   */
  async function collectJob51DetailFromBackground(resumeId) {
    try {
      const response = await chrome.runtime.sendMessage({
        action: "collectJob51ResumeDetail",
        resumeId,
      });
      if (response?.success) {
        return {
          payload: response.data ?? response.payload ?? response.resume ?? null,
          rateLimited: false,
        };
      }
      const errorMessage = response?.error ? String(response.error) : "";
      return {
        payload: null,
        rateLimited: isJob51RateLimitedErrorMessage(errorMessage),
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error || "");
      return {
        payload: null,
        rateLimited: isJob51RateLimitedErrorMessage(message),
      };
    }
  }

  /**
   * Fetches resume detail directly from the 51job API endpoint.
   * Falls back to collectJob51DetailFromBackground on failure/rate-limit.
   */
  async function fetch51JobResumeDetail(resumeId) {
    const normalizedResumeId = normalizeJob51Text(resumeId);
    if (!normalizedResumeId) {
      return { payload: null, rateLimited: false };
    }

    const authContext = apiSnapshot.job51AuthContext;
    const requestBody = {
      resume_id: normalizedResumeId,
      resumeId: normalizedResumeId,
      userid: normalizedResumeId,
      lan: "c",
      timestamp: Math.floor(Date.now() / 1000),
      ...(authContext?.property ? { property: authContext.property } : {}),
    };

    if (authContext?.accesstoken || authContext?.guid || authContext?.property) {
      const headers = {
        Accept: "application/json, text/plain, */*",
        "Content-Type": "application/json",
        ...(authContext.accesstoken
          ? { accesstoken: authContext.accesstoken }
          : {}),
        ...(authContext.guid ? { guid: authContext.guid } : {}),
        ...(authContext.property ? { property: authContext.property } : {}),
      };
      const controller = new AbortController();
      const timeoutId = win.setTimeout(
        () => controller.abort(),
        JOB51_DETAIL_FETCH_TIMEOUT_MS,
      );

      try {
        const response = await globalFetch(
          "https://ehirej.51job.com/resumedtl/getresume",
          {
            method: "POST",
            credentials: "include",
            headers,
            body: JSON.stringify(requestBody),
            signal: controller.signal,
          },
        );

        if (response.status === 403) {
          return { payload: null, rateLimited: true };
        }

        if (response.ok) {
          const payload = await response.json().catch(() => null);
          if (isJob51RateLimitedPayload(payload)) {
            return { payload: null, rateLimited: true };
          }
          if (isJob51DetailApiErrorPayload(payload)) {
            console.warn(
              "🎯 [Auto Sync] Job51 detail API error, falling back to background:",
              normalizedResumeId,
              payload?.code,
              payload?.msg,
            );
          } else if (payload) {
            return { payload, rateLimited: false };
          }
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error || "");
        if (isJob51RateLimitedErrorMessage(message)) {
          return { payload: null, rateLimited: true };
        }
        if (error instanceof DOMException && error.name === "AbortError") {
          console.warn(
            "🎯 [Auto Sync] Direct Job51 detail fetch timed out:",
            normalizedResumeId,
          );
        } else {
          console.warn(
            "🎯 [Auto Sync] Direct Job51 detail fetch failed:",
            normalizedResumeId,
            error,
          );
        }
      } finally {
        win.clearTimeout(timeoutId);
      }
    }

    return collectJob51DetailFromBackground(normalizedResumeId);
  }

  /**
   * Enriches a single 51job search result resume with detail API data.
   * Fetches detail via fetch51JobResumeDetail and merges fields.
   */
  async function enrich51JobSearchResumeWithDetail(resume, extractedAt) {
    if (!resume || typeof resume !== "object") {
      return {
        resume: null,
        enriched: false,
        rateLimited: false,
      };
    }

    const fallbackResume = {
      ...resume,
      extractedAt: resume.extractedAt || extractedAt,
    };
    const resumeId =
      normalizeJob51Text(resume.resumeId) ||
      normalizeJob51Text(resume.perUserId) ||
      "";

    if (!resumeId) {
      return {
        resume: fallbackResume,
        enriched: false,
        rateLimited: false,
      };
    }

    try {
      const detailResult = await fetch51JobResumeDetail(resumeId);
      if (!detailResult?.payload) {
        return {
          resume: fallbackResume,
          enriched: false,
          rateLimited: !!detailResult?.rateLimited,
        };
      }

      const detailResume =
        buildJob51DetailResumeFromPayload(detailResult.payload, {
          resumeId,
          profileUrl: fallbackResume.profileUrl || "",
        })[0] || null;

      if (!detailResume) {
        return {
          resume: fallbackResume,
          enriched: false,
          rateLimited: !!detailResult.rateLimited,
        };
      }

      return {
        resume: {
          ...fallbackResume,
          ...detailResume,
          name: detailResume.name || fallbackResume.name || "",
          age: detailResume.age || fallbackResume.age || "",
          experience: detailResume.experience || fallbackResume.experience || "",
          education: detailResume.education || fallbackResume.education || "",
          location: detailResume.location || fallbackResume.location || "",
          jobIntention:
            detailResume.jobIntention || fallbackResume.jobIntention || "",
          expectedSalary:
            detailResume.expectedSalary || fallbackResume.expectedSalary || "",
          activityStatus:
            detailResume.activityStatus || fallbackResume.activityStatus || "",
          selfIntro: detailResume.selfIntro || fallbackResume.selfIntro || "",
          resumeId: detailResume.resumeId || fallbackResume.resumeId,
          perUserId: detailResume.perUserId || fallbackResume.perUserId,
          externalId: detailResume.externalId || fallbackResume.externalId,
          profileUrl: detailResume.profileUrl || fallbackResume.profileUrl,
          extractedAt: fallbackResume.extractedAt,
          pageIndex: fallbackResume.pageIndex,
          pageNumber: fallbackResume.pageNumber,
          workHistory:
            Array.isArray(detailResume.workHistory) &&
            detailResume.workHistory.length > 0
              ? detailResume.workHistory
              : Array.isArray(fallbackResume.workHistory)
                ? fallbackResume.workHistory
                : [],
          projectExperience:
            Array.isArray(detailResume.projectExperience) &&
            detailResume.projectExperience.length > 0
              ? detailResume.projectExperience
              : Array.isArray(fallbackResume.projectExperience)
                ? fallbackResume.projectExperience
                : [],
          profileEducation:
            Array.isArray(detailResume.profileEducation) &&
            detailResume.profileEducation.length > 0
              ? detailResume.profileEducation
              : Array.isArray(fallbackResume.profileEducation)
                ? fallbackResume.profileEducation
                : [],
          skills:
            Array.isArray(detailResume.skills) && detailResume.skills.length > 0
              ? detailResume.skills
              : Array.isArray(fallbackResume.skills)
                ? fallbackResume.skills
                : [],
          licences:
            Array.isArray(detailResume.licences) &&
            detailResume.licences.length > 0
              ? detailResume.licences
              : Array.isArray(fallbackResume.licences)
                ? fallbackResume.licences
                : [],
        },
        enriched: true,
        rateLimited: !!detailResult.rateLimited,
      };
    } catch (error) {
      console.warn(
        "🎯 [Auto Sync] Failed to enrich Job51 detail resume:",
        resumeId,
        error,
      );
      return {
        resume: fallbackResume,
        enriched: false,
        rateLimited: false,
      };
    }
  }

  /**
   * Maps 51job search result rows from the API snapshot into normalized resume objects.
   * Extracts identity, work history, education, skills, and profile metadata per row.
   */
  function extract51JobResumes() {
    if (!Array.isArray(apiSnapshot.job51SearchRows)) return [];
    return apiSnapshot.job51SearchRows.map((row, index) => {
      const str = (v) => (v != null ? String(v) : "");
      const baseInfo =
        row?.base_info && typeof row.base_info === "object" ? row.base_info : {};
      const jobIntentionInfo =
        row?.job_intention && typeof row.job_intention === "object"
          ? row.job_intention
          : {};
      const recentWorkInfo =
        row?.recent_work_info && typeof row.recent_work_info === "object"
          ? row.recent_work_info
          : {};
      const workList = Array.isArray(row?.work_list) ? row.work_list : [];
      const educationList = Array.isArray(row?.education_list)
        ? row.education_list
        : [];
      const latestWork =
        workList.find(
          (item) => item && typeof item === "object" && item.is_show,
        ) ||
        workList[0] ||
        {};
      const latestEducation =
        educationList.find(
          (item) => item && typeof item === "object" && item.degree_value,
        ) ||
        educationList[0] ||
        {};
      const uniqueSkillTags = Array.from(
        new Set(
          [
            ...(Array.isArray(row?.label_sorted_skill_tag_list)
              ? row.label_sorted_skill_tag_list
              : []),
            ...(Array.isArray(row?.label_list) ? row.label_list : []),
          ]
            .map((value) => normalizeJob51Text(value))
            .filter(Boolean),
        ),
      );
      const workHistory = workList
        .map((item) => {
          if (!item || typeof item !== "object") return null;
          const startDate = normalizeJob51Text(item.start_time);
          const endDate = normalizeJob51Text(item.end_time);
          const durationLabel = normalizeJob51Text(item.working_years);
          const companyName = normalizeJob51Text(item.company_name);
          const jobTitle = normalizeJob51Text(
            item.work_func_value || item.job_name,
          );
          const metaParts = [
            ...(Array.isArray(item.industry_tag) ? item.industry_tag : []),
            item.company_size_value,
            item.work_type_value,
          ]
            .map((value) => normalizeJob51Text(value))
            .filter(Boolean);
          if (
            !startDate &&
            !endDate &&
            !companyName &&
            !jobTitle &&
            metaParts.length === 0
          ) {
            return null;
          }
          return {
            startDate: startDate || undefined,
            endDate: endDate || undefined,
            durationLabel: durationLabel || undefined,
            companyName: companyName || undefined,
            jobTitle: jobTitle || undefined,
            description:
              metaParts.length > 0
                ? buildWorkHistoryRawParts(metaParts)
                : undefined,
          };
        })
        .filter(Boolean);
      const name = normalizeJob51Text(
        baseInfo.resume_name ||
          row?.name ||
          row?.userName ||
          row?.candidateName ||
          row?.fullName,
      );
      const ageValue = normalizeJob51Text(
        baseInfo.age ||
          baseInfo.displayage ||
          baseInfo.age_value ||
          row?.age ||
          row?.realAge ||
          row?.displayage ||
          row?.age_value,
      );
      const age = ageValue
        ? ageValue.includes("岁")
          ? ageValue
          : `${ageValue}岁`
        : "";
      const experience = normalizeJob51Text(
        baseInfo.work_year_value ||
          latestWork.working_years ||
          row?.workYear ||
          row?.workYears ||
          row?.experienceYears ||
          row?.experience,
      );
      const education = normalizeJob51Text(
        baseInfo.top_degree_value ||
          latestEducation.degree_value ||
          row?.education ||
          row?.educationLevel ||
          row?.degree ||
          row?.eduLevel,
      );
      const location = normalizeJob51Text(
        jobIntentionInfo.expect_job_area_value ||
          baseInfo.area_value ||
          row?.location ||
          row?.workCity ||
          row?.city ||
          row?.workLocation,
      );
      const jobIntention = normalizeJob51Text(
        jobIntentionInfo.expect_work_function_value ||
          latestWork.work_func_value ||
          latestWork.job_name ||
          recentWorkInfo.recent_position ||
          row?.jobIntention ||
          row?.desiredJob ||
          row?.expectedPosition ||
          row?.targetJob ||
          row?.searchJob,
      );
      const expectedSalary = normalizeJob51Text(
        jobIntentionInfo.new_expect_salary ||
          jobIntentionInfo.expect_salary ||
          row?.expectedSalary ||
          row?.desiredSalary ||
          row?.expectSalary ||
          row?.salaryExpect,
      );
      const activityStatus = normalizeJob51Text(
        row?.active_type ||
          row?.activityStatus ||
          row?.lastLoginTime ||
          row?.activeTime ||
          row?.refreshTime,
      );
      const selfIntro = normalizeJob51MultilineText(
        row?.resume_slicing ||
          row?.selfIntro ||
          row?.advantage ||
          row?.profile ||
          row?.highlight ||
          uniqueSkillTags.join("、"),
      );
      const resumeId = str(
        row?.userid ||
          row?.resumeId ||
          row?.resumeNo ||
          row?.resumekey ||
          row?.id,
      );
      const perUserId = str(
        baseInfo.accountid ||
          row?.real_userid ||
          row?.perUserId ||
          row?.userId ||
          row?.candidateId ||
          row?.memberId,
      );
      const externalId = resumeId || perUserId;
      const profileUrl = resumeId
        ? EHIRE_51JOB_PROFILE_URL_PREFIX + encodeURIComponent(resumeId)
        : normalizeJob51Text(row?.profileUrl || row?.resumeUrl);
      return {
        name,
        age,
        experience,
        education,
        location,
        jobIntention,
        expectedSalary,
        activityStatus,
        selfIntro,
        resumeId: resumeId || undefined,
        perUserId: perUserId || undefined,
        externalId: externalId || undefined,
        profileUrl: profileUrl || undefined,
        source: EHIRE_51JOB_HOST,
        workHistory,
        pageIndex: index + 1,
        rawData: row,
        extractedAt: new Date().toISOString(),
      };
    });
  }

  /**
   * Extracts a single 51job resume detail from the captured API payload.
   * Requires being on a 51job detail page with a loaded payload.
   */
  function extractJob51DetailResume() {
    if (!isJob51DetailPage() || !isJob51DetailReady()) return [];
    return filterCurrentResumesByAgeRange(
      buildJob51DetailResumeFromPayload(apiSnapshot.job51DetailPayload, {
        resumeId:
          new URL(win.location.href).searchParams.get("resumeId") || undefined,
        profileUrl: win.location.href,
      }),
    );
  }

  return {
    isJob51DetailPage,
    isJob51DetailReady,
    normalizeJob51AuthContext,
    getJob51RawRows,
    getJob51TotalFromPayload,
    isLikelyJob51ResumeRow,
    getJob51ResumeRows,
    hasJob51SearchSnapshot,
    isJob51EmptySearchPromptVisible,
    isJob51RateLimitedPage,
    ensureJob51PageAllowed,
    waitForJob51Cooldown,
    isJob51RateLimitedErrorMessage,
    isJob51RateLimitedPayload,
    isJob51DetailApiErrorPayload,
    collectJob51DetailFromBackground,
    fetch51JobResumeDetail,
    enrich51JobSearchResumeWithDetail,
    extract51JobResumes,
    extractJob51DetailResume,
  };
}
