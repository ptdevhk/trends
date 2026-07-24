(() => {
  var __defProp = Object.defineProperty;
  var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

  // src/lib/job51-age-filter.ts
  function normalizeOptionalPositiveInt(value) {
    const parsed = Number.parseInt(String(value ?? "").trim(), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return parsed;
  }
  __name(normalizeOptionalPositiveInt, "normalizeOptionalPositiveInt");
  function parseAgeNumber(value) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      return Math.trunc(value);
    }
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    const withSuffix = trimmed.match(/^(\d+)\s*岁$/u);
    if (withSuffix && withSuffix[1]) {
      const parsed = Number.parseInt(withSuffix[1], 10);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    }
    const plainNumber = trimmed.match(/^(\d{1,3})$/u);
    if (plainNumber && plainNumber[1]) {
      const parsed = Number.parseInt(plainNumber[1], 10);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    }
    return null;
  }
  __name(parseAgeNumber, "parseAgeNumber");
  function getAgeRangeFromUrl(search = "", minAgeParam = "tr_min_age", maxAgeParam = "tr_max_age") {
    const params = new URLSearchParams(search || "");
    const minAge = normalizeOptionalPositiveInt(params.get(minAgeParam));
    const maxAge = normalizeOptionalPositiveInt(params.get(maxAgeParam));
    const enabled = minAge !== null || maxAge !== null;
    return {
      enabled,
      minAge: minAge !== null ? minAge : void 0,
      maxAge: maxAge !== null ? maxAge : void 0
    };
  }
  __name(getAgeRangeFromUrl, "getAgeRangeFromUrl");
  function filterResumesByAgeRange(resumes, search = "", minAgeParam = "tr_min_age", maxAgeParam = "tr_max_age") {
    if (!Array.isArray(resumes)) return [];
    const range = getAgeRangeFromUrl(search, minAgeParam, maxAgeParam);
    if (!range.enabled) return resumes;
    const minAge = range.minAge;
    const maxAge = range.maxAge;
    return resumes.filter((resume) => {
      const age = parseAgeNumber(resume?.age);
      if (age === null) return false;
      if (typeof minAge === "number" && age < minAge) return false;
      if (typeof maxAge === "number" && age > maxAge) return false;
      return true;
    });
  }
  __name(filterResumesByAgeRange, "filterResumesByAgeRange");

  // src/lib/resume-text-utils.ts
  function normalizeResumeText(value) {
    return typeof value === "string" ? value.replace(/[\u3000\s]+/g, " ").trim() : "";
  }
  __name(normalizeResumeText, "normalizeResumeText");
  function stripHtmlTags(value) {
    return typeof value === "string" ? value.replace(/<[^>]*>/g, " ") : "";
  }
  __name(stripHtmlTags, "stripHtmlTags");
  function normalizeResumeMultilineText(value) {
    if (typeof value !== "string") return "";
    return value.replace(/\r\n?/g, "\n").split("\n").map((line) => line.replace(/[\u3000\t ]+/g, " ").trim()).filter(Boolean).join("\n");
  }
  __name(normalizeResumeMultilineText, "normalizeResumeMultilineText");
  function buildWorkHistoryRawParts(parts) {
    return parts.filter(Boolean).join(" \xB7 ");
  }
  __name(buildWorkHistoryRawParts, "buildWorkHistoryRawParts");

  // src/lib/job51-detail-parser.ts
  var EHIRE_51JOB_HOST = "ehire.51job.com";
  var EHIRE_51JOB_PROFILE_URL_PREFIX = "https://ehire.51job.com/Revision/talent/resume/detail?contentType=&resumeId=";
  var JOB51_DETAIL_ROOT_CANDIDATE_KEYS = [
    "data",
    "result",
    "resume",
    "detail",
    "resumeInfo",
    "resumeDetail",
    "resumeViewVo",
    "resume_view_vo",
    "resumeVo",
    "cnVo",
    "content"
  ];
  var PROVINCE_TOKENS = /* @__PURE__ */ new Set([
    "\u5317\u4EAC",
    "\u5929\u6D25",
    "\u4E0A\u6D77",
    "\u91CD\u5E86",
    "\u6CB3\u5317",
    "\u5C71\u897F",
    "\u8FBD\u5B81",
    "\u5409\u6797",
    "\u9ED1\u9F99\u6C5F",
    "\u6C5F\u82CF",
    "\u6D59\u6C5F",
    "\u5B89\u5FBD",
    "\u798F\u5EFA",
    "\u6C5F\u897F",
    "\u5C71\u4E1C",
    "\u6CB3\u5357",
    "\u6E56\u5317",
    "\u6E56\u5357",
    "\u5E7F\u4E1C",
    "\u6D77\u5357",
    "\u56DB\u5DDD",
    "\u8D35\u5DDE",
    "\u4E91\u5357",
    "\u9655\u897F",
    "\u7518\u8083",
    "\u9752\u6D77",
    "\u53F0\u6E7E",
    "\u5185\u8499\u53E4",
    "\u5E7F\u897F",
    "\u897F\u85CF",
    "\u5B81\u590F",
    "\u65B0\u7586",
    "\u9999\u6E2F",
    "\u6FB3\u95E8"
  ]);
  function normalizeProvinceToken(value) {
    if (!value) return "";
    return normalizeJob51Text(value).replace(/特别行政区$/g, "").replace(/壮族自治区$/g, "").replace(/回族自治区$/g, "").replace(/维吾尔自治区$/g, "").replace(/自治区$/g, "").replace(/省$/g, "").replace(/市$/g, "");
  }
  __name(normalizeProvinceToken, "normalizeProvinceToken");
  function normalizeJob51Text(value) {
    return normalizeResumeText(stripHtmlTags(value));
  }
  __name(normalizeJob51Text, "normalizeJob51Text");
  function normalizeJob51MultilineText(value) {
    return normalizeResumeMultilineText(stripHtmlTags(value));
  }
  __name(normalizeJob51MultilineText, "normalizeJob51MultilineText");
  function isLikelyJob51LocationPlaceholderCompanyName(value) {
    const text = normalizeJob51Text(value);
    if (!text) return false;
    if (/(公司|集团|科技|机械|工业|实业|设备|自动化|贸易|精密|制造|电子|机电|工具|刀具|技术|股份|责任|有限|厂|大学|学院|学校|中心|医院|门诊|商贸|材料|模具|液压|传感)/u.test(text)) {
      return false;
    }
    const provinceToken = normalizeProvinceToken(text);
    if (provinceToken && PROVINCE_TOKENS.has(provinceToken)) return true;
    const compactLocation = text.replace(/[省市区县镇乡]$/u, "");
    return /^[\u4e00-\u9fa5]{2,4}$/u.test(compactLocation);
  }
  __name(isLikelyJob51LocationPlaceholderCompanyName, "isLikelyJob51LocationPlaceholderCompanyName");
  function getJob51DetailRoot(payload) {
    if (!payload) return null;
    if (Array.isArray(payload)) {
      for (const entry of payload) {
        const root = getJob51DetailRoot(entry);
        if (root) return root;
      }
      return null;
    }
    if (typeof payload !== "object") return null;
    const record = payload;
    const candidates = JOB51_DETAIL_ROOT_CANDIDATE_KEYS.map((key) => record[key]);
    for (const candidate of candidates) {
      const root = getJob51DetailRoot(candidate);
      if (root) return root;
    }
    if (JOB51_DETAIL_ROOT_CANDIDATE_KEYS.some(
      (key) => Object.prototype.hasOwnProperty.call(record, key)
    )) {
      return null;
    }
    return record;
  }
  __name(getJob51DetailRoot, "getJob51DetailRoot");
  function readJob51Text(...values) {
    for (const value of values) {
      if (typeof value === "string") {
        const text = normalizeJob51Text(value);
        if (text) return text;
      } else if (typeof value === "number" && Number.isFinite(value)) {
        return String(value);
      }
    }
    return "";
  }
  __name(readJob51Text, "readJob51Text");
  function readJob51MultilineText(...values) {
    for (const value of values) {
      if (typeof value === "string") {
        const text = normalizeJob51MultilineText(value);
        if (text) return text;
        continue;
      }
      if (Array.isArray(value)) {
        const text = value.map(
          (entry) => typeof entry === "string" ? normalizeJob51MultilineText(entry) : entry && typeof entry === "object" ? readJob51MultilineText(
            entry.text,
            entry.value,
            entry.content,
            entry.description,
            entry.desc,
            entry.detail,
            entry.duty,
            entry.responsibility
          ) : ""
        ).filter(Boolean).join("\n");
        if (text) return text;
      }
    }
    return "";
  }
  __name(readJob51MultilineText, "readJob51MultilineText");
  function normalizeJob51DateLike(value) {
    const text = readJob51Text(value);
    if (!text) return "";
    if (["\u81F3\u4ECA", "\u76EE\u524D", "\u4ECA"].includes(text)) return "\u81F3\u4ECA";
    return text.replace(/[./年]/g, "-").replace(/月/g, "").replace(/-{2,}/g, "-").replace(/^-|-$/g, "");
  }
  __name(normalizeJob51DateLike, "normalizeJob51DateLike");
  function readJob51Array(record, keys) {
    if (!record || typeof record !== "object") return [];
    for (const key of keys) {
      const value = record[key];
      if (Array.isArray(value)) return value;
    }
    return [];
  }
  __name(readJob51Array, "readJob51Array");
  function buildJob51ExperienceEntry(item, kind = "work") {
    if (!item || typeof item !== "object") return null;
    const isProject = kind === "project";
    const rawCompanyName = readJob51Text(
      item.company_name,
      item.companyName,
      item.compname,
      item.comp_name,
      item.com_name,
      item.comName,
      item.company,
      isProject ? item.project_name : void 0,
      isProject ? item.projectName : void 0,
      isProject ? item.project : void 0
    );
    const companyName = isLikelyJob51LocationPlaceholderCompanyName(rawCompanyName) ? "" : rawCompanyName;
    const jobTitle = readJob51Text(
      item.work_func_value,
      item.workfunc,
      item.workfunc_str,
      item.work_func_str,
      item.job_name,
      item.jobName,
      item.position,
      item.jobTitle,
      isProject ? item.project_role : void 0,
      isProject ? item.role : void 0,
      isProject ? item.responsibility : void 0
    );
    const startDate = normalizeJob51DateLike(
      item.start_time ?? item.startDate ?? item.begin ?? item.start_date ?? item.fromDate ?? item.time_begin ?? item.timefrom
    );
    const endDate = normalizeJob51DateLike(
      item.end_time ?? item.endDate ?? item.end ?? item.end_date ?? item.toDate ?? item.time_end ?? item.timeto
    );
    const durationLabel = readJob51Text(
      item.working_years,
      item.worktime,
      item.duration,
      item.timeDiff,
      item.time_diff,
      item.period,
      item.durationLabel
    );
    const description = Array.from(
      new Set(
        [
          item.workdescribe,
          item.work_describe,
          item.workDescription,
          item.work_content,
          item.workContent,
          item.work_detail,
          item.workDetail,
          item.workDuty,
          item.work_duty,
          item.duty,
          item.duties,
          item.responsibility,
          item.responsibilities,
          item.responsibility_text,
          item.responsibilityText,
          item.responsibility_list,
          item.responsibilityList,
          item.duty_list,
          item.dutyList,
          item.description,
          item.desc,
          item.detail,
          item.content,
          item.achievement,
          item.achievements,
          isProject ? item.project_desc : void 0,
          isProject ? item.projectDescribe : void 0
        ].map((value) => readJob51MultilineText(value)).flatMap((value) => value.split("\n")).map((value) => value.trim()).filter(Boolean)
      )
    ).join("\n");
    const metaParts = [
      item.industry_tag,
      item.workindustry,
      item.company_size_value,
      item.companysize,
      item.work_type_value,
      item.companytype,
      item.section,
      item.department,
      item.project_name
    ].map((value) => readJob51Text(value)).filter(Boolean);
    const raw = buildWorkHistoryRawParts([
      [startDate, endDate].filter(Boolean).join("~"),
      durationLabel ? `(${durationLabel})` : "",
      companyName,
      jobTitle,
      ...metaParts,
      description
    ]);
    if (!raw && !description && !companyName && !jobTitle) return null;
    return {
      raw: raw || description || buildWorkHistoryRawParts([companyName, jobTitle, startDate, endDate]),
      companyName: companyName || void 0,
      jobTitle: jobTitle || void 0,
      description: description || void 0,
      startDate: startDate || void 0,
      endDate: endDate || void 0
    };
  }
  __name(buildJob51ExperienceEntry, "buildJob51ExperienceEntry");
  function buildJob51EducationEntry(item) {
    if (!item || typeof item !== "object") return null;
    const institution = readJob51Text(
      item.school_name,
      item.schoolName,
      item.schoolname,
      item.school,
      item.institution,
      item.university,
      item.college
    );
    const qualification = readJob51Text(
      item.degree_value,
      item.degreename,
      item.degree,
      item.degreeStr,
      item.qualification,
      item.education
    );
    const fieldOfStudy = readJob51Text(
      item.major,
      item.degreemajor,
      item.major_name,
      item.speciality,
      item.field_of_study,
      item.subject
    );
    const description = readJob51MultilineText(
      item.describe,
      item.description,
      item.detail,
      item.content
    );
    const startDate = normalizeJob51DateLike(
      item.start_date ?? item.begin ?? item.startTime ?? item.enrollYear ?? item.timefrom
    );
    const endDate = normalizeJob51DateLike(
      item.end_date ?? item.end ?? item.endTime ?? item.graduationYear ?? item.timeto
    );
    if (!institution && !qualification && !fieldOfStudy && !description) {
      return null;
    }
    return {
      institution: institution || void 0,
      qualification: qualification || void 0,
      fieldOfStudy: fieldOfStudy || void 0,
      description: description || void 0,
      startDate: startDate || void 0,
      endDate: endDate || void 0
    };
  }
  __name(buildJob51EducationEntry, "buildJob51EducationEntry");
  function buildJob51SkillEntry(item) {
    if (typeof item === "string") {
      const text = normalizeJob51Text(item);
      return text || null;
    }
    if (!item || typeof item !== "object") return null;
    const name = readJob51Text(
      item.skill_name,
      item.name,
      item.label,
      item.skill,
      item.tag
    );
    if (!name) return null;
    const level = readJob51Text(item.level, item.skill_level, item.proficiency);
    const yearsOfExperience = typeof item.yearsOfExperience === "number" && Number.isFinite(item.yearsOfExperience) ? item.yearsOfExperience : typeof item.years === "number" && Number.isFinite(item.years) ? item.years : typeof item.years === "string" && item.years.trim() ? item.years.trim() : void 0;
    if (!level && yearsOfExperience === void 0) {
      return name;
    }
    return {
      name,
      ...level ? { level } : {},
      ...yearsOfExperience === void 0 ? {} : { yearsOfExperience }
    };
  }
  __name(buildJob51SkillEntry, "buildJob51SkillEntry");
  function buildJob51LicenceEntry(item) {
    if (typeof item === "string") {
      const text = normalizeJob51Text(item);
      return text ? { name: text } : null;
    }
    if (!item || typeof item !== "object") return null;
    const name = readJob51Text(
      item.name,
      item.cert_name,
      item.certificate_name,
      item.training_name,
      item.course_name,
      item.title
    );
    if (!name) return null;
    const authority = readJob51Text(
      item.authority,
      item.organization,
      item.issuing_org,
      item.issuingOrganisationName,
      item.school,
      item.company
    );
    const issuedAt = normalizeJob51DateLike(
      item.issuedAt ?? item.issue_date ?? item.issued_date ?? item.start_date ?? item.startTime
    );
    const expiresAt = normalizeJob51DateLike(
      item.expiresAt ?? item.expire_date ?? item.expired_date ?? item.end_date ?? item.endTime
    );
    return {
      name,
      ...authority ? { authority } : {},
      ...issuedAt ? { issuedAt } : {},
      ...expiresAt ? { expiresAt } : {}
    };
  }
  __name(buildJob51LicenceEntry, "buildJob51LicenceEntry");
  function buildJob51DetailResumeFromPayload(payload, options = {}) {
    const root = getJob51DetailRoot(payload);
    if (!root) return [];
    const normalizedOptions = options && typeof options === "object" ? options : {};
    const optionResumeId = Reflect.get(normalizedOptions, "resumeId");
    const optionProfileUrl = Reflect.get(normalizedOptions, "profileUrl");
    const resumeId = readJob51Text(
      optionResumeId,
      root.resumeid,
      root.resumeId,
      root.resume_id,
      root.userid,
      root.userId,
      root.user_id,
      root.id,
      root.base_info?.resumeid,
      root.base_info?.userid,
      root.base_info?.resumeId
    );
    const perUserId = readJob51Text(
      root.accountid,
      root.accountId,
      root.account_id,
      root.base_info?.accountid,
      root.base_info?.accountId,
      root.base_info?.account_id,
      root.userid,
      root.userId,
      root.user_id
    );
    const profileUrl = normalizeJob51Text(
      optionProfileUrl || (resumeId ? `${EHIRE_51JOB_PROFILE_URL_PREFIX}${encodeURIComponent(resumeId)}` : "")
    );
    const baseInfo = root.base_info && typeof root.base_info === "object" ? root.base_info : {};
    const liveJobIntention = Array.isArray(root.jobintention) && root.jobintention[0] && typeof root.jobintention[0] === "object" ? root.jobintention[0] : {};
    const liveHighestDegree = root.highestdegree && typeof root.highestdegree === "object" ? root.highestdegree : {};
    const jobIntentionInfo = root.job_intention && typeof root.job_intention === "object" ? root.job_intention : {};
    const recentWorkInfo = root.recent_work_info && typeof root.recent_work_info === "object" ? root.recent_work_info : {};
    const workHistory = readJob51Array(root, [
      "work",
      "work_list",
      "workInfoVoList",
      "workInfoList",
      "work_info",
      "work_info_list",
      "workHistory",
      "work_history",
      "work_experience",
      "workExperience",
      "workExperienceList",
      "work_exp_list"
    ]).map((item) => buildJob51ExperienceEntry(item, "work")).filter(Boolean);
    const projectExperience = readJob51Array(root, [
      "project",
      "project_list",
      "projectInfoVoList",
      "projectInfoList",
      "projectExperience",
      "project_experience",
      "projectExperienceList"
    ]).map((item) => buildJob51ExperienceEntry(item, "project")).filter(Boolean);
    const profileEducation = readJob51Array(root, [
      "education",
      "education_list",
      "educationInfoVoList",
      "profileEducation",
      "educationHistory"
    ]).map((item) => buildJob51EducationEntry(item)).filter(Boolean);
    const skills = readJob51Array(root, [
      "itskill",
      "skill",
      "skills",
      "skill_list",
      "label_sorted_skill_tag_list",
      "label_list"
    ]).map((item) => buildJob51SkillEntry(item)).filter(Boolean);
    const licences = [
      ...readJob51Array(root, [
        "certification",
        "certifications",
        "certificate",
        "certificates"
      ]),
      ...readJob51Array(root, ["train", "training", "train_list", "trainings"])
    ].map((item) => buildJob51LicenceEntry(item)).filter(Boolean);
    const name = readJob51Text(
      root.name,
      root.userName,
      root.user_name,
      root.username,
      root.resume_name,
      root.realName,
      root.candidateName,
      root.fullName,
      baseInfo.resume_name,
      baseInfo.name,
      baseInfo.userName
    );
    const age = readJob51Text(root.age, root.realAge, root.displayage, baseInfo.age);
    const experience = readJob51Text(
      baseInfo.work_year_value,
      baseInfo.workYear,
      baseInfo.workYears,
      root.work_year_value,
      root.workyear,
      root.workYear,
      root.workYears,
      root.experienceYears,
      root.experience,
      recentWorkInfo?.working_years
    );
    const education = readJob51Text(
      baseInfo.top_degree_value,
      root.top_degree_value,
      liveHighestDegree.degree,
      root.education,
      root.degree,
      root.degreeValue
    );
    const location = readJob51Text(
      jobIntentionInfo.expect_job_area_value,
      Array.isArray(liveJobIntention.expectarea) ? liveJobIntention.expectarea.map(
        (item) => item && typeof item === "object" ? readJob51Text(item.provincecity, item.county) : ""
      ).filter(Boolean).join(",") : void 0,
      root.jobIntention?.expect_job_area_value,
      baseInfo.area_value,
      root.area,
      root.areaprovincecity,
      root.location,
      root.workCity,
      root.city,
      root.workLocation
    );
    const jobIntention = readJob51Text(
      jobIntentionInfo.expect_work_function_value,
      jobIntentionInfo.expected_work_function_value,
      liveJobIntention.expectfuncname,
      liveJobIntention.expectposition,
      root.jobIntention?.expect_work_function_value,
      root.jobIntention?.expected_work_function_value,
      recentWorkInfo.recent_position,
      root.recentwork?.workname,
      root.jobIntention,
      root.job_name,
      root.jobname,
      root.desiredJob,
      root.expectedPosition,
      root.targetJob,
      root.searchJob
    );
    const expectedSalary = readJob51Text(
      jobIntentionInfo.new_expect_salary,
      jobIntentionInfo.expect_salary,
      liveJobIntention.newdisplayexpectsalary,
      liveJobIntention.displayexpectsalary,
      root.expectedSalary,
      root.desiredSalary,
      root.expectSalary,
      root.salaryStr,
      root.salary
    );
    const activityStatus = readJob51Text(
      root.active_type,
      root.activityStatus,
      root.activetimelabel,
      root.activetime,
      root.lastLoginTime,
      root.last_login_time,
      baseInfo.active_type,
      baseInfo.jobStateStr
    );
    const selfIntro = readJob51MultilineText(
      root.selfintro,
      root.selfIntro,
      root.resume_slicing,
      root.advantage,
      root.profile,
      root.summary,
      root.resumeSummary,
      root.highlight,
      root.professionSkill,
      jobIntentionInfo.professionSkill
    );
    const normalizedAge = age ? age.includes("\u5C81") ? age : `${age}\u5C81` : "";
    const externalId = resumeId || perUserId;
    const pageIndex = 1;
    const source = EHIRE_51JOB_HOST;
    if (!resumeId && !name && !jobIntention && !selfIntro && workHistory.length === 0) {
      return [];
    }
    return [
      {
        name,
        age: normalizedAge,
        experience,
        education,
        location,
        jobIntention,
        expectedSalary,
        activityStatus,
        selfIntro,
        resumeId: resumeId || void 0,
        perUserId: perUserId || void 0,
        externalId: externalId || void 0,
        profileUrl: profileUrl || void 0,
        source,
        workHistory,
        projectExperience: projectExperience.length > 0 ? projectExperience : void 0,
        profileEducation: profileEducation.length > 0 ? profileEducation : void 0,
        skills: skills.length > 0 ? skills : void 0,
        licences: licences.length > 0 ? licences : void 0,
        pageIndex,
        rawData: root,
        extractedAt: (/* @__PURE__ */ new Date()).toISOString()
      }
    ];
  }
  __name(buildJob51DetailResumeFromPayload, "buildJob51DetailResumeFromPayload");

  // src/lib/job51-collection-config.ts
  var JOB51_SAFE_LIMIT = 50;
  var JOB51_SAFE_MAX_PAGES = 1;
  var JOB51_DETAIL_FETCH_DELAY_MS = 5e3;
  var JOB51_DETAIL_FETCH_UNSAFE_DELAY_MS = 1e3;
  function hasJob51UnsafeLimitsOverride(search = "") {
    const params = new URLSearchParams(search || "");
    return params.get("tr_unsafe_limits") === "1";
  }
  __name(hasJob51UnsafeLimitsOverride, "hasJob51UnsafeLimitsOverride");
  function resolveJob51CollectionLimits(limit, maxPages, search = "") {
    if (hasJob51UnsafeLimitsOverride(search)) {
      return {
        limit: limit > 0 ? limit : JOB51_SAFE_LIMIT,
        maxPages: maxPages > 0 ? maxPages : JOB51_SAFE_MAX_PAGES
      };
    }
    return {
      limit: limit > 0 ? Math.min(limit, JOB51_SAFE_LIMIT) : JOB51_SAFE_LIMIT,
      maxPages: maxPages > 0 ? Math.min(maxPages, JOB51_SAFE_MAX_PAGES) : JOB51_SAFE_MAX_PAGES
    };
  }
  __name(resolveJob51CollectionLimits, "resolveJob51CollectionLimits");
  function resolveJob51DetailFetchDelayMs(search = "") {
    return hasJob51UnsafeLimitsOverride(search) ? JOB51_DETAIL_FETCH_UNSAFE_DELAY_MS : JOB51_DETAIL_FETCH_DELAY_MS;
  }
  __name(resolveJob51DetailFetchDelayMs, "resolveJob51DetailFetchDelayMs");
  function resolveJob51AutoSyncDetailWaitMode(search = "") {
    const params = new URLSearchParams(search || "");
    const mode = normalizeResumeText(params.get("tr_job51_detail_wait") || "").toLowerCase();
    if (mode === "page1" || mode === "all") {
      return mode;
    }
    return "background";
  }
  __name(resolveJob51AutoSyncDetailWaitMode, "resolveJob51AutoSyncDetailWaitMode");

  // src/lib/job5156-detail-utils.ts
  var SECTION_SELECTORS = [
    "section",
    ".section",
    ".resume-section",
    ".module",
    ".card",
    ".block",
    ".resume-view-layout",
    '[class*="section"]',
    '[class*="module"]',
    '[class*="block"]'
  ];
  var HEADING_SELECTOR = [
    "h1",
    "h2",
    "h3",
    "h4",
    ".title",
    ".section-title",
    ".module-title",
    ".resume-view-layout__title",
    '[class*="title"]'
  ].join(", ");
  var WORK_HISTORY_PLACEHOLDER_PATTERN = /^[（(]?\d+(?:年(?:\d+个?月?)?|个月?|月)?[）)]?$/u;
  var EDUCATION_LIKE_PATTERN = /(本科|大专|中专|硕士|博士|研究生|MBA|EMBA|学校|学院|大学|学历)/u;
  var WORK_LIKE_PATTERN = /(公司|经理|工程师|销售|主管|总监|主任|技术|客户|负责|部门|离职原因|CNC|数控|机械|设备|项目)/iu;
  var DATE_LIKE_PATTERN = /(?:19|20)\d{2}(?:[-./年]\d{1,2})?|至今|目前|present|current/iu;
  function isElement(value) {
    return Boolean(
      value && typeof value === "object" && "nodeType" in value && value.nodeType === 1 && "querySelectorAll" in value
    );
  }
  __name(isElement, "isElement");
  function queryAllSafe(root, selector) {
    try {
      return Array.from(root.querySelectorAll(selector)).filter(isElement);
    } catch {
      return [];
    }
  }
  __name(queryAllSafe, "queryAllSafe");
  function collectJob5156SectionItemsByHeading(root, headingPattern, primarySelectors, fallbackSelectors = []) {
    if (!isElement(root)) {
      return [];
    }
    const sections = queryAllSafe(root, SECTION_SELECTORS.join(", "));
    for (const section of sections) {
      const currentSection = section;
      const heading = normalizeResumeText(currentSection.querySelector(HEADING_SELECTOR)?.textContent || "");
      if (!heading || !headingPattern.test(heading)) {
        continue;
      }
      for (const selector of primarySelectors) {
        const matches = queryAllSafe(currentSection, selector);
        if (matches.length > 0) {
          return matches;
        }
      }
      for (const selector of fallbackSelectors) {
        const matches = queryAllSafe(currentSection, selector);
        if (matches.length > 0) {
          return matches;
        }
      }
      break;
    }
    return [];
  }
  __name(collectJob5156SectionItemsByHeading, "collectJob5156SectionItemsByHeading");
  function isPlaceholderDurationText(value) {
    const normalized = value.replace(/[\s·]+/g, "");
    return WORK_HISTORY_PLACEHOLDER_PATTERN.test(normalized);
  }
  __name(isPlaceholderDurationText, "isPlaceholderDurationText");
  function isMeaningfulJob5156WorkHistoryEntry(entry) {
    if (!entry) {
      return false;
    }
    const companyName = normalizeResumeText(entry.companyName || "");
    const jobTitle = normalizeResumeText(entry.jobTitle || "");
    const description = normalizeResumeText(entry.description || "");
    const startDate = normalizeResumeText(entry.startDate || "");
    const endDate = normalizeResumeText(entry.endDate || "");
    const raw = normalizeResumeText(entry.raw || "");
    const text = [raw, description].filter(Boolean).join(" ");
    const hasIdentity = Boolean(companyName || jobTitle || description);
    const hasDate = DATE_LIKE_PATTERN.test(`${startDate} ${endDate}`.trim());
    if (hasIdentity) {
      return true;
    }
    if (!text) {
      return false;
    }
    if (isPlaceholderDurationText(text)) {
      return false;
    }
    if (EDUCATION_LIKE_PATTERN.test(text) && !WORK_LIKE_PATTERN.test(text) && !companyName && !jobTitle) {
      return false;
    }
    if (hasDate && text.length > 0) {
      return true;
    }
    return true;
  }
  __name(isMeaningfulJob5156WorkHistoryEntry, "isMeaningfulJob5156WorkHistoryEntry");

  // src/lib/seek-extractor.ts
  function unwrapSeekProfileSnapshot(raw) {
    if (!raw || typeof raw !== "object") return null;
    let current = raw;
    for (const key of [
      "talentSearchProfileV3",
      "talentSearchProfileV2",
      "talentSearchProfileCompleteV2",
      "getTalentSearchProfileCompleteV2"
    ]) {
      const nested = current[key];
      if (nested && typeof nested === "object" && !Array.isArray(nested)) {
        current = nested;
        break;
      }
    }
    const result = current.result;
    if (result && typeof result === "object" && !Array.isArray(result)) {
      const inner = result;
      if (typeof inner.profileGuid === "string" || inner.profileId != null || Array.isArray(inner.workHistories) || typeof inner.firstName === "string") {
        return inner;
      }
    }
    return current;
  }
  __name(unwrapSeekProfileSnapshot, "unwrapSeekProfileSnapshot");
  function createSeekExtractor(deps) {
    const {
      getCurrentSourceKey: getCurrentSourceKey2,
      SOURCE_KEYS: SOURCE_KEYS2,
      apiSnapshot: apiSnapshot2,
      normalizeOptionalPositiveInt: normalizeOptionalPositiveInt2,
      DEFAULT_SEEK_PAGE_SIZE: DEFAULT_SEEK_PAGE_SIZE2,
      SEEK_PROFILE_TYPE: SEEK_PROFILE_TYPE2,
      persistLatestAutoSyncSummary: persistLatestAutoSyncSummary2,
      // Extraction function deps
      win,
      doc,
      // Pagination + extraction deps
      asHTMLElement: asHTMLElement2,
      isDisabledPaginationControl: isDisabledPaginationControl2,
      // Detail enrichment deps
      waitForSeekProfileSnapshot: waitForSeekProfileSnapshot2,
      SEEK_DETAIL_FETCH_CONCURRENCY: SEEK_DETAIL_FETCH_CONCURRENCY2,
      SEEK_DETAIL_FETCH_DELAY_MS: SEEK_DETAIL_FETCH_DELAY_MS2,
      SEEK_TALENTSEARCH_DETAIL_FETCH_CONCURRENCY: SEEK_TALENTSEARCH_DETAIL_FETCH_CONCURRENCY2,
      SEEK_TALENTSEARCH_DETAIL_FETCH_DELAY_MS: SEEK_TALENTSEARCH_DETAIL_FETCH_DELAY_MS2,
      SEEK_TALENTSEARCH_DETAIL_TIMEOUT_MS: SEEK_TALENTSEARCH_DETAIL_TIMEOUT_MS2,
      SEEK_DETAIL_PARAM: SEEK_DETAIL_PARAM2,
      delay: delay2,
      // Pagination selectors
      SELECTORS: SELECTORS2
    } = deps;
    function isSeekProfilePage2() {
      return win.location.pathname.includes("/talentsearch/profile/");
    }
    __name(isSeekProfilePage2, "isSeekProfilePage");
    function isSeekTalentSearchListPage2() {
      if (getCurrentSourceKey2() !== SOURCE_KEYS2.SEEK) return false;
      const { pathname, search } = win.location;
      if (pathname.includes("/talentsearch/profile/")) return false;
      return pathname === "/talentsearch" && search.length > 0;
    }
    __name(isSeekTalentSearchListPage2, "isSeekTalentSearchListPage");
    function getCurrentSeekMode2() {
      if (getCurrentSourceKey2() !== SOURCE_KEYS2.SEEK) return null;
      if (isSeekProfilePage2()) return "profile";
      if (isSeekTalentSearchListPage2()) return "talentsearch";
      if (win.location.pathname.includes("/candidates/recommended")) return "recommended";
      return null;
    }
    __name(getCurrentSeekMode2, "getCurrentSeekMode");
    function isSeekInlineProfileMode2() {
      if (getCurrentSourceKey2() !== SOURCE_KEYS2.SEEK) return false;
      if (!win.location.pathname.includes("/candidates/recommended")) return false;
      const openProfileId = normalizeOptionalPositiveInt2(
        new URL(win.location.href).searchParams.get("openProfileId")
      );
      return openProfileId !== null && hasSeekProfileSnapshot2();
    }
    __name(isSeekInlineProfileMode2, "isSeekInlineProfileMode");
    function isSeekProfileMode2() {
      return isSeekProfilePage2() || isSeekInlineProfileMode2();
    }
    __name(isSeekProfileMode2, "isSeekProfileMode");
    function hasSeekProfileSnapshot2() {
      return !!(apiSnapshot2.seekProfile && typeof apiSnapshot2.seekProfile === "object");
    }
    __name(hasSeekProfileSnapshot2, "hasSeekProfileSnapshot");
    function hasSeekListSnapshot2() {
      return Array.isArray(apiSnapshot2.seekRecommendedCandidates);
    }
    __name(hasSeekListSnapshot2, "hasSeekListSnapshot");
    function hasSeekTalentSearchSnapshot2() {
      return Array.isArray(apiSnapshot2.seekTalentSearch);
    }
    __name(hasSeekTalentSearchSnapshot2, "hasSeekTalentSearchSnapshot");
    function getSeekSnapshotCount2() {
      if (isSeekProfileMode2()) {
        return hasSeekProfileSnapshot2() ? 1 : 0;
      }
      if (hasSeekTalentSearchSnapshot2()) {
        return apiSnapshot2.seekTalentSearch.length;
      }
      return hasSeekListSnapshot2() ? apiSnapshot2.seekRecommendedCandidates.length : 0;
    }
    __name(getSeekSnapshotCount2, "getSeekSnapshotCount");
    function isSeekSnapshotReady2() {
      return getSeekSnapshotCount2() > 0;
    }
    __name(isSeekSnapshotReady2, "isSeekSnapshotReady");
    function getSeekCandidateIdentity2(candidate) {
      const rec = candidate;
      const profileId = rec?.profileId != null ? String(rec.profileId) : "";
      return {
        profileId,
        profileType: typeof rec?.profileType === "string" ? rec.profileType : SEEK_PROFILE_TYPE2
      };
    }
    __name(getSeekCandidateIdentity2, "getSeekCandidateIdentity");
    function buildSeekProfileUrl2(profileId, jobId) {
      if (!profileId) return "";
      const hostname = window.location.hostname.toLowerCase();
      if (jobId) {
        return `https://${hostname}/candidates/recommended?jobId=${encodeURIComponent(jobId)}&openProfileId=${encodeURIComponent(profileId)}`;
      }
      return `https://${hostname}/candidates/${encodeURIComponent(profileId)}`;
    }
    __name(buildSeekProfileUrl2, "buildSeekProfileUrl");
    function buildSeekNameSearchUrl2(name, market, roleTitles) {
      const trimmed = typeof name === "string" ? name.trim() : "";
      if (!trimmed) return "";
      const trimmedRoleTitles = typeof roleTitles === "string" ? roleTitles.trim() : "";
      const roleTitlesParam = trimmedRoleTitles ? `&roleTitles=${encodeURIComponent(trimmedRoleTitles)}` : "";
      return `https://${window.location.hostname.toLowerCase()}/talentsearch/profiles/search?searchQuery=${encodeURIComponent(trimmed)}&market=${encodeURIComponent(market || "MY")}&pageNumber=1${roleTitlesParam}`;
    }
    __name(buildSeekNameSearchUrl2, "buildSeekNameSearchUrl");
    function normalizeSeekLocationLabel2(value) {
      return String(value || "").toLowerCase().replace(/\bmalaysia\b/g, "").replace(/\bmy\b/g, "").replace(/[，,、]/g, " ").replace(/\s+/g, " ").trim();
    }
    __name(normalizeSeekLocationLabel2, "normalizeSeekLocationLabel");
    function restoreSeekSearchParams2() {
      try {
        const initialUrlStr = sessionStorage.getItem("tr_auto_sync_initial_url");
        if (!initialUrlStr) return;
        const currentUrl = new URL(window.location.href);
        const initialUrl = new URL(initialUrlStr);
        const seekParams = ["keywords", "roleTitles", "matchAll", "tr_max_age"];
        let changed = false;
        for (const p of seekParams) {
          const initialVal = initialUrl.searchParams.get(p);
          if (initialVal !== null && !currentUrl.searchParams.has(p)) {
            currentUrl.searchParams.set(p, initialVal);
            changed = true;
          }
        }
        if (changed) {
          history.replaceState(null, "", currentUrl.toString());
        }
      } catch {
      }
    }
    __name(restoreSeekSearchParams2, "restoreSeekSearchParams");
    function getSeekRecommendedRequest2() {
      return apiSnapshot2.seekRecommendedRequest;
    }
    __name(getSeekRecommendedRequest2, "getSeekRecommendedRequest");
    function getSeekTalentSearchRequest2() {
      return apiSnapshot2.seekTalentSearchRequest;
    }
    __name(getSeekTalentSearchRequest2, "getSeekTalentSearchRequest");
    function getSeekProfileRequest2() {
      return apiSnapshot2.seekProfileRequest || apiSnapshot2.seekRecommendedRequest;
    }
    __name(getSeekProfileRequest2, "getSeekProfileRequest");
    function getSeekAutoSyncHelpers2() {
      const helpers = globalThis.__TR_SEEK_AUTO_SYNC__;
      return helpers && typeof helpers === "object" ? helpers : null;
    }
    __name(getSeekAutoSyncHelpers2, "getSeekAutoSyncHelpers");
    function resolveSeekAutoSyncPageSize2(options = {}) {
      const { requestedPageSize, currentPageCandidateCount, fallbackPageSize = DEFAULT_SEEK_PAGE_SIZE2 } = options;
      const helpers = getSeekAutoSyncHelpers2();
      if (typeof helpers?.resolveSeekAutoSyncPageSize === "function") {
        return helpers.resolveSeekAutoSyncPageSize({ requestedPageSize, currentPageCandidateCount, fallbackPageSize });
      }
      return normalizeOptionalPositiveInt2(requestedPageSize) || normalizeOptionalPositiveInt2(currentPageCandidateCount) || normalizeOptionalPositiveInt2(fallbackPageSize) || DEFAULT_SEEK_PAGE_SIZE2;
    }
    __name(resolveSeekAutoSyncPageSize2, "resolveSeekAutoSyncPageSize");
    function resolveSeekAutoSyncPageWindow2(options = {}) {
      const { startPage, limit, maxPages, requestedPageSize, currentPageCandidateCount } = options;
      const helpers = getSeekAutoSyncHelpers2();
      if (typeof helpers?.resolveSeekAutoSyncPageWindow === "function") {
        return helpers.resolveSeekAutoSyncPageWindow({ startPage, limit, maxPages, requestedPageSize, currentPageCandidateCount, fallbackPageSize: DEFAULT_SEEK_PAGE_SIZE2 });
      }
      const normalizedStartPage = normalizeOptionalPositiveInt2(startPage) || 1;
      const normalizedLimit = normalizeOptionalPositiveInt2(limit);
      const normalizedMaxPages = normalizeOptionalPositiveInt2(maxPages);
      const effectivePageSize = resolveSeekAutoSyncPageSize2({ requestedPageSize, currentPageCandidateCount, fallbackPageSize: DEFAULT_SEEK_PAGE_SIZE2 });
      const limitPageCount = normalizedLimit ? Math.max(1, Math.ceil(normalizedLimit / effectivePageSize)) : null;
      let allowedPageCount = null;
      if (limitPageCount && normalizedMaxPages) {
        allowedPageCount = Math.min(limitPageCount, normalizedMaxPages);
      } else if (limitPageCount) {
        allowedPageCount = limitPageCount;
      } else if (normalizedMaxPages) {
        allowedPageCount = normalizedMaxPages;
      }
      return { startPage: normalizedStartPage, targetPageEnd: allowedPageCount ? normalizedStartPage + allowedPageCount - 1 : null, effectivePageSize, limitPageCount, maxPages: normalizedMaxPages, allowedPageCount };
    }
    __name(resolveSeekAutoSyncPageWindow2, "resolveSeekAutoSyncPageWindow");
    function isSeekAutoSyncPageWindowReached2(pageWindow, currentPage) {
      const helpers = getSeekAutoSyncHelpers2();
      if (typeof helpers?.isSeekAutoSyncPageWindowReached === "function") {
        return helpers.isSeekAutoSyncPageWindowReached({ currentPage, targetPageEnd: pageWindow?.targetPageEnd });
      }
      const normalizedCurrentPage = normalizeOptionalPositiveInt2(currentPage);
      const targetPageEnd = normalizeOptionalPositiveInt2(pageWindow?.targetPageEnd);
      return !!(normalizedCurrentPage && targetPageEnd && normalizedCurrentPage >= targetPageEnd);
    }
    __name(isSeekAutoSyncPageWindowReached2, "isSeekAutoSyncPageWindowReached");
    function shouldStopSeekAutoSyncForPageWindow2(options) {
      if (!options.pageWindowReached) {
        return false;
      }
      const normalizedLimit = normalizeOptionalPositiveInt2(options.limit);
      if (!normalizedLimit) {
        return true;
      }
      const submitted = normalizeOptionalPositiveInt2(options.totalSubmitted) || 0;
      return submitted >= normalizedLimit;
    }
    __name(shouldStopSeekAutoSyncForPageWindow2, "shouldStopSeekAutoSyncForPageWindow");
    function resolveSeekAutoSyncCurrentPageSelection2(options = {}) {
      const helpers = getSeekAutoSyncHelpers2();
      if (typeof helpers?.resolveSeekAutoSyncCurrentPageSelection === "function") {
        return helpers.resolveSeekAutoSyncCurrentPageSelection(options);
      }
      const normalizedLimit = normalizeOptionalPositiveInt2(options.limit);
      const normalizedTotalSubmitted = normalizeOptionalPositiveInt2(options.totalSubmitted) || 0;
      const normalizedCurrentPageResumeCount = normalizeOptionalPositiveInt2(options.currentPageResumeCount) || 0;
      const remainingCapacity = normalizedLimit ? Math.max(normalizedLimit - normalizedTotalSubmitted, 0) : null;
      const selectedCount = remainingCapacity === null ? normalizedCurrentPageResumeCount : Math.min(normalizedCurrentPageResumeCount, remainingCapacity);
      return { remainingCapacity, selectedCount, hitLimitWithinPage: remainingCapacity !== null && normalizedCurrentPageResumeCount > remainingCapacity, limitAlreadyReached: remainingCapacity !== null && remainingCapacity <= 0 };
    }
    __name(resolveSeekAutoSyncCurrentPageSelection2, "resolveSeekAutoSyncCurrentPageSelection");
    function getSeekRequestedPageSize2() {
      const variables = getSeekRecommendedRequest2()?.variables;
      const requestInput = variables?.input;
      return normalizeOptionalPositiveInt2(requestInput?.size);
    }
    __name(getSeekRequestedPageSize2, "getSeekRequestedPageSize");
    function getSeekCurrentCandidateCount2() {
      if (getCurrentSeekMode2() === "talentsearch") {
        return Array.isArray(apiSnapshot2.seekTalentSearch) ? apiSnapshot2.seekTalentSearch.length : 0;
      }
      const recommendedCount = Array.isArray(apiSnapshot2.seekRecommendedCandidates) ? apiSnapshot2.seekRecommendedCandidates.length : 0;
      return recommendedCount || getSeekRecommendedDomCardCount();
    }
    __name(getSeekCurrentCandidateCount2, "getSeekCurrentCandidateCount");
    function setSeekAutoSyncWindowAttributes2(pageWindow) {
      const attrs = [
        ["data-tr-auto-sync-target-start", pageWindow?.startPage],
        ["data-tr-auto-sync-target-end", pageWindow?.targetPageEnd],
        ["data-tr-auto-sync-effective-page-size", pageWindow?.effectivePageSize]
      ];
      try {
        for (const [name, value] of attrs) {
          if (typeof value === "number" && Number.isFinite(value)) {
            document.documentElement.setAttribute(name, String(value));
          } else {
            document.documentElement.removeAttribute(name);
          }
        }
      } catch {
      }
      persistLatestAutoSyncSummary2();
    }
    __name(setSeekAutoSyncWindowAttributes2, "setSeekAutoSyncWindowAttributes");
    function setSeekAutoSyncSelectionAttributes2(selection) {
      const attrs = [
        ["data-tr-auto-sync-selected-count", selection?.selectedCount],
        ["data-tr-auto-sync-remaining-capacity", selection?.remainingCapacity]
      ];
      try {
        for (const [name, value] of attrs) {
          if (typeof value === "number" && Number.isFinite(value)) {
            document.documentElement.setAttribute(name, String(value));
          } else {
            document.documentElement.removeAttribute(name);
          }
        }
      } catch {
      }
      persistLatestAutoSyncSummary2();
    }
    __name(setSeekAutoSyncSelectionAttributes2, "setSeekAutoSyncSelectionAttributes");
    function findSeekProfileTrigger2(profileId) {
      if (!profileId) return null;
      const candidateLinks = Array.from(document.querySelectorAll("a[href]"));
      return candidateLinks.find((link) => {
        const href = link.getAttribute("href") || "";
        return href.includes(`/talentsearch/profile/${encodeURIComponent(profileId)}`) || href.includes(`openProfileId=${encodeURIComponent(profileId)}`);
      }) || null;
    }
    __name(findSeekProfileTrigger2, "findSeekProfileTrigger");
    function extractSeekProfileResume2() {
      const profile = unwrapSeekProfileSnapshot(apiSnapshot2.seekProfile);
      if (!profile) return [];
      const request = getSeekProfileRequest2();
      const variables = request?.variables;
      const requestInput = variables?.input;
      const language = variables?.language;
      const profileUrl = new URL(win.location.href);
      const jobIdFromUrl = normalizeOptionalPositiveInt2(
        profileUrl.searchParams.get("jobId")
      );
      const jobId = requestInput?.jobId != null ? String(requestInput.jobId) : jobIdFromUrl != null ? String(jobIdFromUrl) : void 0;
      const { profileId, profileType } = getSeekCandidateIdentity2(profile);
      const seekProfileGuid = typeof profile.profileGuid === "string" && profile.profileGuid ? profile.profileGuid : void 0;
      const externalProfileKey = seekProfileGuid || profileId;
      const firstName = typeof profile.firstName === "string" ? profile.firstName.trim() : "";
      const lastName = typeof profile.lastName === "string" ? profile.lastName.trim() : "";
      const currentJobTitle = typeof profile.currentJobTitle === "string" ? profile.currentJobTitle.trim() : "";
      const currentLocation = typeof profile.currentLocation === "string" ? profile.currentLocation.trim() : "";
      const resolvedLocation = currentLocation || [
        typeof profile.suburb === "string" ? profile.suburb.trim() : "",
        typeof profile.state === "string" ? profile.state.trim() : "",
        typeof profile.country === "string" ? profile.country.trim() : ""
      ].filter(Boolean).join(", ") || "";
      const lastModifiedDate = typeof profile.lastModifiedDate === "string" ? profile.lastModifiedDate : typeof profile.lastModifiedDurationLabel === "string" ? profile.lastModifiedDurationLabel : "";
      const workHistory = Array.isArray(profile.workHistories) ? profile.workHistories.map((item) => buildSeekWorkHistoryItem(item)).filter(Boolean) : [];
      const profileEducation = Array.isArray(profile.profileEducation) ? profile.profileEducation.map((item) => buildSeekProfileEducationItem(item)).filter(Boolean) : [];
      const licences = Array.isArray(profile.licences) ? profile.licences.map((item) => {
        if (!item || typeof item !== "object") return null;
        const name = typeof item.name === "string" ? item.name.trim() : "";
        const authority = typeof item.issuingOrganisationName === "string" ? item.issuingOrganisationName.trim() : "";
        if (!name && !authority) return null;
        return { name, authority: authority || void 0 };
      }).filter(Boolean) : [];
      const skills = Array.isArray(profile.skills) ? profile.skills.filter((item) => typeof item === "string" && item.trim()) : [];
      const languages = Array.isArray(profile.languages) ? profile.languages.filter(
        (item) => typeof item === "string" && item.trim()
      ) : [];
      const resumeSnippet = typeof profile.resumeSnippet === "string" && profile.resumeSnippet.trim() ? profile.resumeSnippet.trim() : typeof profile.personalSummary === "string" ? profile.personalSummary.trim() : "";
      const currentIndustry = typeof profile.currentIndustry === "string" ? profile.currentIndustry.trim() : "";
      const currentSubindustry = typeof profile.currentSubindustry === "string" ? profile.currentSubindustry.trim() : "";
      const rightToWork = typeof profile.rightToWork?.label === "string" ? profile.rightToWork.label.trim() : "";
      const education = profileEducation[0]?.qualification || "";
      const pageNumber = normalizeOptionalPositiveInt2(profileUrl.searchParams.get("pageNumber")) || 1;
      return [
        {
          profileId,
          profileType,
          seekProfileGuid,
          externalId: externalProfileKey ? `${win.location.hostname.toLowerCase()}:profile:${externalProfileKey}` : "",
          name: [firstName, lastName].filter(Boolean).join(" ").trim(),
          // Talentsearch: name-search URL is the only operator-visitable link.
          // /candidates/<numericId> is invalid outside the recommended lane.
          profileUrl: getCurrentSeekMode2() === "talentsearch" ? buildSeekNameSearchUrl2(
            [firstName, lastName].filter(Boolean).join(" "),
            profileUrl.searchParams.get("market") || void 0,
            currentJobTitle
          ) || buildSeekProfileUrl2(profileId, jobId) : buildSeekProfileUrl2(profileId, jobId),
          activityStatus: lastModifiedDate,
          age: "",
          experience: "",
          education,
          location: resolvedLocation,
          jobIntention: currentJobTitle,
          expectedSalary: formatSeekExpectedSalary(profile.salary?.expected),
          selfIntro: resumeSnippet,
          workHistory,
          profileEducation: profileEducation.length > 0 ? profileEducation : void 0,
          skills: skills.length > 0 ? skills : void 0,
          languages: languages.length > 0 ? languages : void 0,
          licences: licences.length > 0 ? licences : void 0,
          resumeSnippet: resumeSnippet || void 0,
          currentIndustry: currentIndustry || void 0,
          currentSubindustry: currentSubindustry || void 0,
          rightToWork: rightToWork || void 0,
          noticePeriodDays: Number.isFinite(profile.noticePeriodDays) ? profile.noticePeriodDays : void 0,
          extractedAt: (/* @__PURE__ */ new Date()).toISOString(),
          pageIndex: 1,
          source: win.location.hostname.toLowerCase(),
          searchProfileId: typeof requestInput?.searchId === "string" ? requestInput.searchId : "",
          language: typeof language === "string" ? language : "",
          pageNumber
        }
      ];
    }
    __name(extractSeekProfileResume2, "extractSeekProfileResume");
    function buildSeekCollectionContext2(options = {}) {
      const normalizedOptions = typeof options === "object" && options ? options : {};
      const captureModeOverride = normalizedOptions.captureModeOverride;
      const seekMode = getCurrentSeekMode2();
      const isTalentSearchList = seekMode === "talentsearch";
      const useProfileMode = captureModeOverride ? captureModeOverride === "graphql-profile" : isSeekProfileMode2();
      const talentSearchRequest = isTalentSearchList ? apiSnapshot2.seekTalentSearchRequest : null;
      const request = talentSearchRequest ?? (useProfileMode ? getSeekProfileRequest2() : getSeekRecommendedRequest2());
      const variables = request?.variables;
      const requestInput = variables?.input;
      const language = variables?.language;
      const url = new URL(win.location.href);
      const pageNumberFromUrl = normalizeOptionalPositiveInt2(
        url.searchParams.get("pageNumber")
      );
      const jobIdFromUrl = normalizeOptionalPositiveInt2(
        url.searchParams.get("jobId")
      );
      const captureMode = captureModeOverride || (isTalentSearchList ? "graphql-talentsearch" : useProfileMode && apiSnapshot2.seekProfile ? "graphql-profile" : "graphql-list");
      const defaultOperation = captureMode === "graphql-profile" ? "GetTalentSearchProfileCompleteV2" : captureMode === "graphql-talentsearch" ? "SearchProfilesByNaturalLanguage" : "GetTalentSearchRecommendedCandidates";
      const context = {
        captureMode,
        operation: apiSnapshot2.lastOperationName || defaultOperation,
        profileType: SEEK_PROFILE_TYPE2
      };
      if (seekMode) context.seekMode = seekMode;
      if (typeof language === "string") context.language = language;
      if (isTalentSearchList) {
        if (typeof requestInput?.pageNumber === "number") {
          context.pageNumber = requestInput.pageNumber;
        } else if (pageNumberFromUrl != null) {
          context.pageNumber = pageNumberFromUrl;
        }
        if (typeof requestInput?.originalNaturalLanguageQuery === "string") {
          context.searchQuery = requestInput.originalNaturalLanguageQuery;
        }
        if (typeof requestInput?.searchMode === "string") {
          context.searchMode = requestInput.searchMode;
        }
      } else if (requestInput?.page != null) {
        context.pageNumber = requestInput.page;
      } else if (pageNumberFromUrl != null) {
        context.pageNumber = pageNumberFromUrl;
      }
      if (jobIdFromUrl != null) context.jobId = jobIdFromUrl;
      if (apiSnapshot2.lastOperationName) {
        context.lastOperationName = apiSnapshot2.lastOperationName;
      }
      return context;
    }
    __name(buildSeekCollectionContext2, "buildSeekCollectionContext");
    function getSeekPayloadData2(payload, kind) {
      if (!payload) return null;
      if (Array.isArray(payload)) {
        const entry = payload.find((item) => {
          const data = item?.data;
          if (!data || typeof data !== "object") return false;
          if (kind === "seekRecommendedCandidates") {
            return !!(data.talentSearchRecommendedCandidatesV2 || data.getTalentSearchRecommendedCandidates);
          }
          if (kind === "seekTalentSearch") {
            return !!data.talentSearchProfilesNaturalLanguageSearch;
          }
          if (kind === "seekProfile") {
            return !!(data.talentSearchProfileV2 || data.talentSearchProfileCompleteV2 || data.getTalentSearchProfileCompleteV2 || data.talentSearchProfileV3);
          }
          return false;
        });
        return entry?.data || null;
      }
      if (payload && typeof payload === "object") {
        const obj = payload;
        return obj.data && typeof obj.data === "object" ? obj.data : payload;
      }
      return null;
    }
    __name(getSeekPayloadData2, "getSeekPayloadData");
    function extractSeekResumes2() {
      const candidates = Array.isArray(apiSnapshot2.seekRecommendedCandidates) ? apiSnapshot2.seekRecommendedCandidates : [];
      if (candidates.length === 0 && getCurrentSeekMode2() === "recommended") {
        return extractSeekRecommendedDomResumes();
      }
      const request = getSeekRecommendedRequest2();
      const variables = request?.variables;
      const requestInput = variables?.input;
      const language = variables?.language;
      const url = new URL(win.location.href);
      const jobIdFromUrl = normalizeOptionalPositiveInt2(
        url.searchParams.get("jobId")
      );
      const jobId = requestInput?.jobId != null ? String(requestInput.jobId) : jobIdFromUrl != null ? String(jobIdFromUrl) : void 0;
      const currentPage = typeof requestInput?.page === "number" ? requestInput.page : normalizeOptionalPositiveInt2(url.searchParams.get("pageNumber")) || 1;
      return candidates.map((candidate, index) => {
        const { profileId, profileType } = getSeekCandidateIdentity2(candidate);
        const firstName = typeof candidate?.firstName === "string" ? candidate.firstName.trim() : "";
        const lastName = typeof candidate?.lastName === "string" ? candidate.lastName.trim() : "";
        const currentJobTitle = typeof candidate?.currentJobTitle === "string" ? candidate.currentJobTitle.trim() : "";
        const currentLocation = typeof candidate?.currentLocation === "string" ? candidate.currentLocation.trim() : "";
        const resolvedLocation = currentLocation || [
          typeof candidate?.suburb === "string" ? candidate.suburb.trim() : "",
          typeof candidate?.state === "string" ? candidate.state.trim() : "",
          typeof candidate?.country === "string" ? candidate.country.trim() : ""
        ].filter(Boolean).join(", ") || "";
        const lastModifiedDate = typeof candidate?.lastModifiedDate === "string" ? candidate.lastModifiedDate : "";
        const salary = candidate?.salary;
        const salaryParts = [salary?.minLabel, salary?.maxLabel].filter(
          (value) => typeof value === "string" && value.trim()
        );
        const workHistory = Array.isArray(candidate?.workHistories) ? candidate.workHistories.map((item) => buildSeekWorkHistoryItem(item)).filter(Boolean) : [];
        return {
          profileId,
          profileType,
          externalId: profileId ? `${win.location.hostname.toLowerCase()}:profile:${profileId}` : "",
          name: [firstName, lastName].filter(Boolean).join(" ").trim(),
          profileUrl: buildSeekProfileUrl2(profileId, jobId),
          activityStatus: lastModifiedDate,
          age: "",
          experience: "",
          education: "",
          location: resolvedLocation,
          jobIntention: currentJobTitle,
          expectedSalary: salaryParts.join(" - "),
          selfIntro: "",
          workHistory,
          extractedAt: (/* @__PURE__ */ new Date()).toISOString(),
          pageIndex: index + 1,
          source: win.location.hostname.toLowerCase(),
          searchProfileId: typeof requestInput?.searchId === "string" ? requestInput.searchId : "",
          language: typeof language === "string" ? language : "",
          pageNumber: currentPage
        };
      });
    }
    __name(extractSeekResumes2, "extractSeekResumes");
    function extractSeekTalentSearchResumes2() {
      const candidates = Array.isArray(apiSnapshot2.seekTalentSearch) ? apiSnapshot2.seekTalentSearch : [];
      const request = getSeekTalentSearchRequest2();
      const variables = request?.variables;
      const requestInput = variables?.input;
      const language = variables?.language;
      const url = new URL(win.location.href);
      const currentPage = typeof requestInput?.pageNumber === "number" ? requestInput.pageNumber : normalizeOptionalPositiveInt2(url.searchParams.get("pageNumber")) || 1;
      return candidates.map((node, index) => {
        const profileGuid = typeof node?.profileGuid === "string" && node.profileGuid ? node.profileGuid : "";
        const relayId = typeof node?.id === "string" && node.id ? node.id : "";
        const profileId = profileGuid || relayId;
        if (!profileId) return null;
        const firstName = typeof node?.firstName === "string" ? node.firstName.trim() : "";
        const lastName = typeof node?.lastName === "string" ? node.lastName.trim() : "";
        const currentJobTitle = typeof node?.currentJobTitle === "string" ? node.currentJobTitle.trim() : "";
        const currentLocation = typeof node?.currentLocation === "string" ? node.currentLocation.trim() : "";
        const resolvedLocation = currentLocation || [
          typeof node?.suburb === "string" ? node.suburb.trim() : "",
          typeof node?.state === "string" ? node.state.trim() : "",
          typeof node?.country === "string" ? node.country.trim() : ""
        ].filter(Boolean).join(", ") || "";
        const lastModifiedDurationLabel = typeof node?.lastModifiedDurationLabel === "string" ? node.lastModifiedDurationLabel : "";
        const workHistory = Array.isArray(node?.workHistories) ? node.workHistories.map((item) => buildSeekWorkHistoryItem(item)).filter(Boolean) : [];
        return {
          profileId,
          profileType: "seek",
          seekProfileGuid: profileGuid || void 0,
          externalId: profileId ? `${win.location.hostname.toLowerCase()}:profile:${profileId}` : "",
          name: [firstName, lastName].filter(Boolean).join(" ").trim(),
          profileUrl: buildSeekNameSearchUrl2(
            [firstName, lastName].filter(Boolean).join(" "),
            url.searchParams.get("market") || void 0,
            currentJobTitle
          ),
          activityStatus: lastModifiedDurationLabel,
          age: "",
          experience: "",
          education: "",
          location: resolvedLocation,
          jobIntention: currentJobTitle,
          expectedSalary: "",
          selfIntro: "",
          workHistory,
          extractedAt: (/* @__PURE__ */ new Date()).toISOString(),
          pageIndex: index + 1,
          source: win.location.hostname.toLowerCase(),
          searchProfileId: "",
          language: typeof language === "string" ? language : "",
          pageNumber: currentPage
        };
      }).filter(Boolean);
    }
    __name(extractSeekTalentSearchResumes2, "extractSeekTalentSearchResumes");
    function getSeekCardCount2() {
      if (getCurrentSeekMode2() === "recommended") {
        return getSeekRecommendedDomCardCount();
      }
      return doc.querySelectorAll(
        'a[href*="/talentsearch/profile/"][href*="profilePosition="]'
      ).length;
    }
    __name(getSeekCardCount2, "getSeekCardCount");
    function findSeekRecommendedDomCard(heading) {
      let current = heading.parentElement;
      while (current) {
        if (current.querySelector('[data-testid="work-history"]')) {
          return current;
        }
        current = current.parentElement;
      }
      return null;
    }
    __name(findSeekRecommendedDomCard, "findSeekRecommendedDomCard");
    function getSeekRecommendedDomCardCount() {
      if (getCurrentSeekMode2() !== "recommended") return 0;
      const seenCards = /* @__PURE__ */ new Set();
      for (const heading of doc.querySelectorAll('[data-role="heading"]')) {
        const name = (heading.textContent || "").trim();
        const card = name ? findSeekRecommendedDomCard(heading) : null;
        if (card && !seenCards.has(card)) {
          seenCards.add(card);
        }
      }
      return seenCards.size;
    }
    __name(getSeekRecommendedDomCardCount, "getSeekRecommendedDomCardCount");
    function getSeekRecommendedDomCards() {
      if (getCurrentSeekMode2() !== "recommended") return [];
      const seenCards = /* @__PURE__ */ new Set();
      return Array.from(doc.querySelectorAll('[data-role="heading"]')).map((heading) => {
        const name = (heading.textContent || "").trim();
        const card = name ? findSeekRecommendedDomCard(heading) : null;
        if (!card || seenCards.has(card)) return null;
        const workHistory = Array.from(
          card.querySelectorAll('[data-testid="work-history"]')
        ).map((item) => (item.textContent || "").trim()).filter(Boolean);
        if (workHistory.length === 0) return null;
        seenCards.add(card);
        return { name, workHistory };
      }).filter(
        (card) => Boolean(card)
      );
    }
    __name(getSeekRecommendedDomCards, "getSeekRecommendedDomCards");
    function getJobTitleFromWorkHistory(raw) {
      return raw.split(/\s+at\s+/iu)[0]?.trim() || "";
    }
    __name(getJobTitleFromWorkHistory, "getJobTitleFromWorkHistory");
    function extractSeekRecommendedDomResumes() {
      const url = new URL(win.location.href);
      const jobId = normalizeOptionalPositiveInt2(url.searchParams.get("jobId")) || "recommended";
      const currentPage = normalizeOptionalPositiveInt2(url.searchParams.get("pageNumber")) || 1;
      const sourceHost = win.location.hostname.toLowerCase();
      const resumes = [];
      let pageIndex = 0;
      const seenCards = /* @__PURE__ */ new Set();
      for (const heading of doc.querySelectorAll('[data-role="heading"]')) {
        const name = (heading.textContent || "").trim();
        const card = name ? findSeekRecommendedDomCard(heading) : null;
        if (!card || seenCards.has(card)) continue;
        const workHistory = [];
        for (const item of card.querySelectorAll('[data-testid="work-history"]')) {
          const text = (item.textContent || "").trim();
          if (text) workHistory.push(text);
        }
        if (workHistory.length === 0) continue;
        seenCards.add(card);
        pageIndex++;
        const profileId = `dom-${jobId}-${currentPage}-${pageIndex}`;
        resumes.push({
          profileId,
          profileType: SEEK_PROFILE_TYPE2,
          externalId: `${sourceHost}:recommended:${profileId}`,
          name,
          profileUrl: win.location.href,
          activityStatus: "",
          age: "",
          experience: "",
          education: "",
          location: "",
          jobIntention: getJobTitleFromWorkHistory(workHistory[0] || ""),
          expectedSalary: "",
          selfIntro: "",
          workHistory: workHistory.map((raw) => ({ raw })),
          extractedAt: (/* @__PURE__ */ new Date()).toISOString(),
          pageIndex,
          source: sourceHost,
          searchProfileId: "",
          language: "",
          pageNumber: currentPage
        });
      }
      return resumes;
    }
    __name(extractSeekRecommendedDomResumes, "extractSeekRecommendedDomResumes");
    function getSeekPaginationInfo2() {
      const isTalentSearch = getCurrentSeekMode2() === "talentsearch";
      const currentPage = normalizeOptionalPositiveInt2(
        new URL(win.location.href).searchParams.get("pageNumber")
      ) || 1;
      const pagination = doc.querySelector(
        isTalentSearch ? SELECTORS2.seekTalentSearchPagination : SELECTORS2.seekPagination
      );
      if (!pagination) {
        return {
          currentPage,
          totalPages: currentPage,
          totalItems: 0,
          hasNextPage: false
        };
      }
      const links = Array.from(pagination.querySelectorAll("a"));
      const pageNumbers = links.map((item) => {
        const label = item.getAttribute("aria-label") || "";
        const text = item.textContent || "";
        const match = label.match(/page\s+(\d+)/i) || text.trim().match(/^(\d+)$/);
        return match ? Number.parseInt(match[1], 10) : 0;
      }).filter((value) => Number.isFinite(value) && value > 0);
      const totalPages = Math.max(
        pageNumbers.length > 0 ? Math.max(...pageNumbers) : 0,
        currentPage
      );
      const nextLink = getSeekNextPageLinkForMode2();
      const hasNextPage = totalPages > currentPage && !isDisabledPaginationControl2(nextLink);
      return { currentPage, totalPages, totalItems: 0, hasNextPage };
    }
    __name(getSeekPaginationInfo2, "getSeekPaginationInfo");
    function getSeekNextPageLink2() {
      const pagination = doc.querySelector(SELECTORS2.seekPagination);
      if (!pagination) return null;
      const links = Array.from(pagination.querySelectorAll("a"));
      const nextLink = links.find(
        (node) => /next/i.test((node.textContent || "").trim())
      );
      return asHTMLElement2(nextLink || null);
    }
    __name(getSeekNextPageLink2, "getSeekNextPageLink");
    function getSeekTalentSearchNextPageLink2() {
      const pagination = doc.querySelector(SELECTORS2.seekTalentSearchPagination);
      if (!pagination) return null;
      const explicit = pagination.querySelector('a[rel="next"]');
      if (explicit) return asHTMLElement2(explicit);
      const links = Array.from(pagination.querySelectorAll("a"));
      const labeled = links.find(
        (node) => /next/i.test(
          (node.getAttribute("aria-label") || node.textContent || "").trim()
        )
      );
      return asHTMLElement2(labeled || null);
    }
    __name(getSeekTalentSearchNextPageLink2, "getSeekTalentSearchNextPageLink");
    function getSeekNextPageLinkForMode2() {
      if (getCurrentSeekMode2() === "talentsearch") {
        return getSeekTalentSearchNextPageLink2();
      }
      return getSeekNextPageLink2();
    }
    __name(getSeekNextPageLinkForMode2, "getSeekNextPageLinkForMode");
    function readSeekDetailParamValue() {
      try {
        const params = new URLSearchParams(win.location.search || "");
        const fromUrl = params.get(SEEK_DETAIL_PARAM2);
        if (fromUrl != null && fromUrl !== "") {
          return fromUrl.trim().toLowerCase();
        }
      } catch {
      }
      try {
        if (typeof sessionStorage !== "undefined") {
          const stored = sessionStorage.getItem(`tr_seek_param_${SEEK_DETAIL_PARAM2}`);
          if (stored != null && stored !== "") {
            return stored.trim().toLowerCase();
          }
        }
      } catch {
      }
      return null;
    }
    __name(readSeekDetailParamValue, "readSeekDetailParamValue");
    function isSeekDetailOptOutValue(value) {
      return value === "0" || value === "false" || value === "off" || value === "no";
    }
    __name(isSeekDetailOptOutValue, "isSeekDetailOptOutValue");
    function shouldEnrichSeekListWithDetail() {
      if (getCurrentSeekMode2() !== "talentsearch") {
        return true;
      }
      return !isSeekDetailOptOutValue(readSeekDetailParamValue());
    }
    __name(shouldEnrichSeekListWithDetail, "shouldEnrichSeekListWithDetail");
    function resumeHasWorkHistoryDescriptions(resume, minDescribed = 1) {
      const rec = resume;
      const workHistory = Array.isArray(rec?.workHistory) ? rec.workHistory : [];
      let described = 0;
      for (const entry of workHistory) {
        if (!entry || typeof entry !== "object") continue;
        const description = typeof entry.description === "string" ? entry.description.trim() : "";
        if (description) {
          described += 1;
          if (described >= minDescribed) return true;
        }
      }
      return false;
    }
    __name(resumeHasWorkHistoryDescriptions, "resumeHasWorkHistoryDescriptions");
    function dismissSeekProfilePanel() {
      try {
        const active = doc.querySelector?.("[data-role='heading']");
        const target = doc.body || active;
        if (target && typeof target.dispatchEvent === "function") {
          target.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "Escape",
              code: "Escape",
              keyCode: 27,
              which: 27,
              bubbles: true,
              cancelable: true
            })
          );
        }
      } catch {
      }
    }
    __name(dismissSeekProfilePanel, "dismissSeekProfilePanel");
    async function enrichSingleSeekResumeWithDetail2(resume, cachedHeadings) {
      const rec = resume;
      const profileId = typeof rec?.profileId === "string" ? rec.profileId.trim() : "";
      if (!profileId) {
        return resume;
      }
      if (resumeHasWorkHistoryDescriptions(resume, 1)) {
        return resume;
      }
      const isTalentSearch = getCurrentSeekMode2() === "talentsearch";
      const trigger = isTalentSearch ? findSeekTalentSearchCardTrigger(profileId, resume, cachedHeadings) : findSeekProfileTrigger2(profileId);
      if (!(trigger instanceof HTMLElement)) {
        return resume;
      }
      try {
        apiSnapshot2.seekProfile = null;
        trigger.click();
        const matchId = isTalentSearch ? rec?.seekProfileGuid || profileId : profileId;
        const timeoutMs = isTalentSearch ? SEEK_TALENTSEARCH_DETAIL_TIMEOUT_MS2 : 12e3;
        await waitForSeekProfileSnapshot2(matchId, { timeoutMs });
        const [detailResume] = extractSeekProfileResume2();
        if (!detailResume) {
          dismissSeekProfilePanel();
          return resume;
        }
        if (isTalentSearch) {
          const detailGuid = detailResume.seekProfileGuid || "";
          const detailProfileId = detailResume.profileId || "";
          if (detailGuid !== profileId && detailProfileId !== profileId) {
            dismissSeekProfilePanel();
            return resume;
          }
          const merged = mergeSeekListResumeWithDetail(resume, detailResume, isTalentSearch);
          dismissSeekProfilePanel();
          return merged;
        }
        if (detailResume.profileId !== profileId) {
          return resume;
        }
        return mergeSeekListResumeWithDetail(resume, detailResume, isTalentSearch);
      } catch (error) {
        console.warn(
          "\u{1F3AF} [Auto Sync] Failed to enrich Seek detail resume:",
          profileId,
          error
        );
        dismissSeekProfilePanel();
        return resume;
      }
    }
    __name(enrichSingleSeekResumeWithDetail2, "enrichSingleSeekResumeWithDetail");
    async function enrichSeekResumesWithDetail2(resumes) {
      if (!Array.isArray(resumes) || resumes.length === 0) return [];
      if (getCurrentSourceKey2() !== SOURCE_KEYS2.SEEK) return resumes;
      if (isSeekProfileMode2()) return resumes;
      if (!shouldEnrichSeekListWithDetail()) {
        return resumes;
      }
      const isTalentSearch = getCurrentSeekMode2() === "talentsearch";
      const cachedHeadings = isTalentSearch ? Array.from(doc.querySelectorAll('[data-role="heading"]')) : null;
      const concurrency = isTalentSearch ? SEEK_TALENTSEARCH_DETAIL_FETCH_CONCURRENCY2 : SEEK_DETAIL_FETCH_CONCURRENCY2;
      const interBatchDelayMs = isTalentSearch ? SEEK_TALENTSEARCH_DETAIL_FETCH_DELAY_MS2 : SEEK_DETAIL_FETCH_DELAY_MS2;
      const enriched = [];
      for (let start = 0; start < resumes.length; start += concurrency) {
        const batch = resumes.slice(start, start + concurrency);
        const batchResults = await Promise.all(
          batch.map((resume) => enrichSingleSeekResumeWithDetail2(resume, cachedHeadings))
        );
        enriched.push(...batchResults);
        if (start + concurrency < resumes.length) {
          await delay2(interBatchDelayMs);
        }
      }
      return enriched;
    }
    __name(enrichSeekResumesWithDetail2, "enrichSeekResumesWithDetail");
    function escapeCssAttrValue(value) {
      if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
        return CSS.escape(value);
      }
      return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    }
    __name(escapeCssAttrValue, "escapeCssAttrValue");
    function findSeekTalentSearchCardTrigger(profileId, resume, cachedHeadings) {
      if (!profileId) return null;
      const byAttr = doc.querySelector(
        `[data-tr-candidate-id="${escapeCssAttrValue(profileId)}"]`
      );
      if (byAttr instanceof HTMLElement) return byAttr;
      const candidateName = typeof resume?.name === "string" ? resume.name.trim() : "";
      if (candidateName) {
        const headings = cachedHeadings || Array.from(doc.querySelectorAll('[data-role="heading"]'));
        const match = headings.find((h) => {
          const text = (h.textContent || "").trim();
          return text === candidateName;
        });
        if (match instanceof HTMLElement) return match;
      }
      return null;
    }
    __name(findSeekTalentSearchCardTrigger, "findSeekTalentSearchCardTrigger");
    function mergeSeekListResumeWithDetail(baseResume, detailResume, isTalentSearch = false) {
      const base = baseResume;
      const detail = detailResume;
      if (!detailResume || typeof detailResume !== "object") {
        return baseResume;
      }
      const seekProfileGuid = base.seekProfileGuid || detail.seekProfileGuid || void 0;
      const numericProfileId = isTalentSearch && detail.profileId && /^\d+$/.test(String(detail.profileId)) ? String(detail.profileId) : void 0;
      const baseProfileUrl = typeof base.profileUrl === "string" ? base.profileUrl : "";
      const detailProfileUrl = typeof detail.profileUrl === "string" ? detail.profileUrl : "";
      const isCandidatesOnlyUrl = /* @__PURE__ */ __name((url) => /\/candidates\/\d+(?:\?|$)/.test(url) && !/talentsearch/i.test(url), "isCandidatesOnlyUrl");
      let profileUrl = isTalentSearch ? (
        // Prefer list name-search URL; rebuild if base empty or detail forced candidates URL.
        !isCandidatesOnlyUrl(baseProfileUrl) && baseProfileUrl ? baseProfileUrl : !isCandidatesOnlyUrl(detailProfileUrl) && detailProfileUrl ? detailProfileUrl : ""
      ) : detailProfileUrl || baseProfileUrl;
      if (isTalentSearch && (!profileUrl || isCandidatesOnlyUrl(profileUrl))) {
        const name = typeof base.name === "string" && base.name.trim() || typeof detail.name === "string" && detail.name.trim() || "";
        const market = new URL(win.location.href).searchParams.get("market") || void 0;
        const roleTitle = typeof base.jobIntention === "string" && base.jobIntention.trim() || typeof detail.jobIntention === "string" && detail.jobIntention.trim() || void 0;
        profileUrl = buildSeekNameSearchUrl2(name, market, roleTitle) || baseProfileUrl || detailProfileUrl;
      }
      const baseWorkHistory = Array.isArray(base.workHistory) ? base.workHistory : [];
      const detailWorkHistory = Array.isArray(detail.workHistory) ? detail.workHistory : [];
      const countDescribed = /* @__PURE__ */ __name((entries) => entries.filter((entry) => {
        if (!entry || typeof entry !== "object") return false;
        const description = entry.description;
        return typeof description === "string" && description.trim().length > 0;
      }).length, "countDescribed");
      const workHistory = countDescribed(detailWorkHistory) > 0 ? detailWorkHistory : detailWorkHistory.length > 0 ? detailWorkHistory : baseWorkHistory;
      return {
        ...base,
        ...detail,
        workHistory,
        // Keep list UUID externalId for talentsearch identity stability.
        externalId: isTalentSearch ? base.externalId || detail.externalId : detail.externalId || base.externalId,
        ...seekProfileGuid ? { seekProfileGuid } : {},
        ...numericProfileId ? { profileId: numericProfileId } : {},
        ...profileUrl ? { profileUrl } : {},
        pageIndex: base.pageIndex,
        pageNumber: base.pageNumber,
        extractedAt: base.extractedAt,
        source: base.source,
        searchProfileId: detail.searchProfileId || base.searchProfileId
      };
    }
    __name(mergeSeekListResumeWithDetail, "mergeSeekListResumeWithDetail");
    function formatSeekExpectedSalary(expectedSalary) {
      if (!expectedSalary || typeof expectedSalary !== "object") return "";
      const salary = expectedSalary;
      const amounts = Array.isArray(salary.amount) ? salary.amount : [];
      const preferredFrequencies = ["MONTHLY", "ANNUAL", "HOURLY"];
      const amount = preferredFrequencies.map(
        (frequency) => amounts.find((entry) => entry?.frequency === frequency)
      ).find(Boolean) || amounts[0];
      if (!amount || typeof amount !== "object") return "";
      const value = typeof amount.value === "number" ? amount.value : Number(amount.value);
      const formattedValue = Number.isFinite(value) ? new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value) : "";
      const currency = typeof salary.currency === "string" ? salary.currency.trim() : "";
      const period = amount.frequency === "ANNUAL" ? "/year" : amount.frequency === "HOURLY" ? "/hour" : amount.frequency === "DAILY" ? "/day" : "/month";
      const prefix = [currency, formattedValue].filter(Boolean).join(" ");
      return prefix ? `${prefix}${period}` : "";
    }
    __name(formatSeekExpectedSalary, "formatSeekExpectedSalary");
    function buildSeekWorkHistoryItem(item) {
      if (!item || typeof item !== "object") return null;
      const rec = item;
      const companyName = typeof rec.companyName === "string" ? rec.companyName.trim() : "";
      const jobTitle = typeof rec.jobTitle === "string" ? rec.jobTitle.trim() : "";
      const descriptionCandidates = [
        rec.description,
        rec.jobDescription,
        rec.responsibilities,
        rec.highlights
      ];
      let description = "";
      for (const candidate of descriptionCandidates) {
        if (typeof candidate === "string" && candidate.trim()) {
          description = candidate.trim();
          break;
        }
        if (Array.isArray(candidate)) {
          const joined = candidate.map((line) => typeof line === "string" ? line.trim() : "").filter(Boolean).join("\n");
          if (joined) {
            description = joined;
            break;
          }
        }
      }
      const startDate = typeof rec.startDate === "string" ? rec.startDate.trim() : "";
      const endDate = typeof rec.endDate === "string" ? rec.endDate.trim() : "";
      const durationLabel = typeof rec.durationLabel === "string" ? rec.durationLabel.trim() : "";
      const raw = [jobTitle, companyName, durationLabel].filter(Boolean).join(" \xB7 ");
      if (!raw && !description) return null;
      return {
        raw: raw || description,
        companyName: companyName || void 0,
        jobTitle: jobTitle || void 0,
        description: description || void 0,
        startDate: startDate || void 0,
        endDate: endDate || void 0
      };
    }
    __name(buildSeekWorkHistoryItem, "buildSeekWorkHistoryItem");
    function buildSeekProfileEducationItem(item) {
      if (!item || typeof item !== "object") return null;
      const rec = item;
      const institution = typeof rec.institutionName === "string" ? rec.institutionName.trim() : "";
      const qualification = typeof rec.qualificationName === "string" ? rec.qualificationName.trim() : "";
      const completionYear = Number.isFinite(rec.completionYear) ? String(rec.completionYear) : "";
      const completionMonth = Number.isFinite(rec.completionMonth) && rec.completionMonth > 0 ? String(rec.completionMonth).padStart(2, "0") : "";
      const endDate = completionYear ? completionMonth ? `${completionYear}-${completionMonth}` : completionYear : "";
      if (!institution && !qualification && !endDate) return null;
      return {
        institution: institution || void 0,
        qualification: qualification || void 0,
        endDate: endDate || void 0
      };
    }
    __name(buildSeekProfileEducationItem, "buildSeekProfileEducationItem");
    return {
      isSeekProfilePage: isSeekProfilePage2,
      isSeekTalentSearchListPage: isSeekTalentSearchListPage2,
      getCurrentSeekMode: getCurrentSeekMode2,
      isSeekInlineProfileMode: isSeekInlineProfileMode2,
      isSeekProfileMode: isSeekProfileMode2,
      hasSeekProfileSnapshot: hasSeekProfileSnapshot2,
      hasSeekListSnapshot: hasSeekListSnapshot2,
      hasSeekTalentSearchSnapshot: hasSeekTalentSearchSnapshot2,
      getSeekSnapshotCount: getSeekSnapshotCount2,
      isSeekSnapshotReady: isSeekSnapshotReady2,
      getSeekCandidateIdentity: getSeekCandidateIdentity2,
      buildSeekProfileUrl: buildSeekProfileUrl2,
      buildSeekNameSearchUrl: buildSeekNameSearchUrl2,
      normalizeSeekLocationLabel: normalizeSeekLocationLabel2,
      restoreSeekSearchParams: restoreSeekSearchParams2,
      getSeekRecommendedRequest: getSeekRecommendedRequest2,
      getSeekTalentSearchRequest: getSeekTalentSearchRequest2,
      getSeekProfileRequest: getSeekProfileRequest2,
      getSeekAutoSyncHelpers: getSeekAutoSyncHelpers2,
      resolveSeekAutoSyncPageSize: resolveSeekAutoSyncPageSize2,
      resolveSeekAutoSyncPageWindow: resolveSeekAutoSyncPageWindow2,
      isSeekAutoSyncPageWindowReached: isSeekAutoSyncPageWindowReached2,
      shouldStopSeekAutoSyncForPageWindow: shouldStopSeekAutoSyncForPageWindow2,
      resolveSeekAutoSyncCurrentPageSelection: resolveSeekAutoSyncCurrentPageSelection2,
      getSeekRequestedPageSize: getSeekRequestedPageSize2,
      getSeekCurrentCandidateCount: getSeekCurrentCandidateCount2,
      setSeekAutoSyncWindowAttributes: setSeekAutoSyncWindowAttributes2,
      setSeekAutoSyncSelectionAttributes: setSeekAutoSyncSelectionAttributes2,
      findSeekProfileTrigger: findSeekProfileTrigger2,
      // Extraction functions
      extractSeekProfileResume: extractSeekProfileResume2,
      buildSeekCollectionContext: buildSeekCollectionContext2,
      getSeekPayloadData: getSeekPayloadData2,
      // Resumes extraction
      extractSeekResumes: extractSeekResumes2,
      extractSeekTalentSearchResumes: extractSeekTalentSearchResumes2,
      // Pagination helpers
      getSeekCardCount: getSeekCardCount2,
      getSeekPaginationInfo: getSeekPaginationInfo2,
      getSeekNextPageLink: getSeekNextPageLink2,
      getSeekTalentSearchNextPageLink: getSeekTalentSearchNextPageLink2,
      getSeekNextPageLinkForMode: getSeekNextPageLinkForMode2,
      // Detail enrichment
      enrichSingleSeekResumeWithDetail: enrichSingleSeekResumeWithDetail2,
      enrichSeekResumesWithDetail: enrichSeekResumesWithDetail2
    };
  }
  __name(createSeekExtractor, "createSeekExtractor");

  // src/lib/job5156-extractor.ts
  function createJob5156Extractor(deps) {
    const {
      getCurrentSourceKey: getCurrentSourceKey2,
      SOURCE_KEYS: SOURCE_KEYS2,
      apiSnapshot: apiSnapshot2,
      normalizeResumeText: normalizeResumeText2,
      normalizeResumeMultilineText: normalizeResumeMultilineText2,
      buildWorkHistoryRawParts: buildWorkHistoryRawParts2,
      normalizeOptionalPositiveInt: normalizeOptionalPositiveInt2,
      JOB5156_HOST: JOB5156_HOST2,
      JOB5156_PROFILE_URL_PREFIX: JOB5156_PROFILE_URL_PREFIX2,
      JOB5156_DETAIL_FETCH_TIMEOUT_MS: JOB5156_DETAIL_FETCH_TIMEOUT_MS2,
      JOB5156_DETAIL_FETCH_CONCURRENCY: JOB5156_DETAIL_FETCH_CONCURRENCY2,
      isMeaningfulJob5156WorkHistoryEntry: isMeaningfulJob5156WorkHistoryEntry2,
      collectJob5156SectionItemsByHeading: collectJob5156SectionItemsByHeading2
    } = deps;
    function decodeURIComponentSafe(value) {
      try {
        return decodeURIComponent(value);
      } catch {
        return value;
      }
    }
    __name(decodeURIComponentSafe, "decodeURIComponentSafe");
    function extractJob5156ResumeId2(pathname) {
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
    __name(extractJob5156ResumeId2, "extractJob5156ResumeId");
    function normalizeJob5156ProfileUrlForExport2(value) {
      if (!value || typeof value !== "string") return "";
      const trimmed = value.trim();
      if (!trimmed) return "";
      const directResumeId = extractJob5156ResumeId2(trimmed);
      if (directResumeId) {
        return `${JOB5156_PROFILE_URL_PREFIX2}${encodeURIComponent(directResumeId)}`;
      }
      try {
        const parsed = new URL(trimmed, window.location.origin);
        if (parsed.hostname.toLowerCase() !== JOB5156_HOST2) {
          return parsed.href;
        }
        const resumeId = extractJob5156ResumeId2(parsed.pathname);
        if (!resumeId) {
          return parsed.href;
        }
        return `${JOB5156_PROFILE_URL_PREFIX2}${encodeURIComponent(resumeId)}`;
      } catch {
        return trimmed;
      }
    }
    __name(normalizeJob5156ProfileUrlForExport2, "normalizeJob5156ProfileUrlForExport");
    function isJob5156DetailPage2() {
      return getCurrentSourceKey2() === SOURCE_KEYS2.JOB5156 && /^\/resume\/view\//i.test(window.location.pathname);
    }
    __name(isJob5156DetailPage2, "isJob5156DetailPage");
    function getJob5156DetailRoot2() {
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
        "main"
      ];
      for (const selector of candidates) {
        const el = document.querySelector(selector);
        if (el instanceof Element && normalizeResumeText2(el.textContent || "").length > 40) {
          return el;
        }
      }
      return document.body;
    }
    __name(getJob5156DetailRoot2, "getJob5156DetailRoot");
    function getJob5156DetailHeaderText2(root = getJob5156DetailRoot2()) {
      if (!(root instanceof Element)) return "";
      const header = root.querySelector(
        'h1, .name, .resume-name, .basic-name, [class*="name"]'
      );
      return normalizeResumeText2(
        header?.textContent || root.querySelector(
          '.basic-line, .resume-basic-info, [class*="basic"], .resume-view-item__block.resume-basic'
        )?.textContent || ""
      );
    }
    __name(getJob5156DetailHeaderText2, "getJob5156DetailHeaderText");
    function isJob5156DetailReady2() {
      if (!isJob5156DetailPage2()) return false;
      const resumeId = extractJob5156ResumeId2(window.location.pathname);
      if (!resumeId) return false;
      const root = getJob5156DetailRoot2();
      const rootText = normalizeResumeText2(root?.textContent || "");
      return root instanceof Element && rootText.length > 80 && getJob5156DetailHeaderText2(root).length > 0;
    }
    __name(isJob5156DetailReady2, "isJob5156DetailReady");
    function isJob5156DetailRootReady2(root, pathname) {
      if (!(root instanceof Element)) return false;
      const resumeId = extractJob5156ResumeId2(pathname || "");
      if (!resumeId) return false;
      const rootText = normalizeResumeText2(root.textContent || "");
      return rootText.length > 80 && getJob5156DetailHeaderText2(root).length > 0;
    }
    __name(isJob5156DetailRootReady2, "isJob5156DetailRootReady");
    function buildJob5156DetailWorkHistoryItem2(item) {
      if (!(item instanceof Element)) return null;
      if (item.classList.contains("resume-work__info") || item.closest(".resume-work")) {
        const row1 = item.querySelector(".resume-work__row-1");
        const row2 = item.querySelector(".resume-work__row-2");
        const row3 = item.querySelector(".resume-work__row-3");
        const row4 = item.querySelector(".resume-work__row-4");
        const companyName2 = normalizeResumeText2(
          row1?.querySelector(".flex.flex-1 > span.pointer")?.textContent
        );
        const jobTitle2 = normalizeResumeText2(
          row1?.querySelector(".flex.flex-1 > span:not(.pointer):not(.cut)")?.textContent
        );
        const periodText2 = normalizeResumeText2(
          row1?.querySelector(".time-diff")?.textContent
        );
        const periodMatch = periodText2.match(/^(.+?)(?:（(.+)）)?$/u);
        const dateRange = normalizeResumeText2(periodMatch?.[1] || periodText2);
        const durationLabel2 = normalizeResumeText2(periodMatch?.[2] || "");
        const startDate2 = dateRange.includes("~") ? normalizeResumeText2(dateRange.split("~")[0]) : dateRange;
        const endDate2 = dateRange.includes("~") ? normalizeResumeText2(dateRange.split("~").slice(1).join("~")) : "";
        const companyMeta2 = normalizeResumeText2(row2?.textContent);
        const description2 = normalizeResumeText2(
          row3?.querySelector("pre")?.textContent || row3?.textContent
        );
        const reasonText2 = normalizeResumeText2(row4?.textContent).replace(
          /^离职原因[:：]?\s*/u,
          ""
        );
        const raw2 = buildWorkHistoryRawParts2([
          dateRange,
          durationLabel2 ? `(${durationLabel2})` : "",
          companyName2,
          jobTitle2,
          companyMeta2 ? `\u516C\u53F8\u4FE1\u606F\uFF1A${companyMeta2}` : "",
          description2,
          reasonText2 ? `\u79BB\u804C\u539F\u56E0\uFF1A${reasonText2}` : ""
        ]);
        if (!raw2 && !description2 && !companyName2 && !jobTitle2) return null;
        return {
          raw: raw2 || description2 || buildWorkHistoryRawParts2([companyName2, jobTitle2, dateRange]),
          companyName: companyName2 || void 0,
          jobTitle: jobTitle2 || void 0,
          description: [description2, reasonText2 ? `\u79BB\u804C\u539F\u56E0\uFF1A${reasonText2}` : ""].filter(Boolean).join("\n") || void 0,
          startDate: startDate2 || void 0,
          endDate: endDate2 || void 0
        };
      }
      const getText = /* @__PURE__ */ __name((selectors) => {
        for (const selector of selectors) {
          const value = normalizeResumeText2(
            item.querySelector(selector)?.textContent
          );
          if (value) return value;
        }
        return "";
      }, "getText");
      const getOwnText = /* @__PURE__ */ __name((selectors) => {
        for (const selector of selectors) {
          const node = item.querySelector(selector);
          if (!(node instanceof Element)) continue;
          const text = normalizeResumeText2(
            Array.from(node.childNodes).filter((child) => child.nodeType === Node.TEXT_NODE).map((child) => child.textContent || "").join(" ")
          );
          if (text) return text;
        }
        return "";
      }, "getOwnText");
      const getLines = /* @__PURE__ */ __name((selectors) => {
        for (const selector of selectors) {
          const nodes = item.querySelectorAll(selector);
          const values = Array.from(nodes).map((node) => normalizeResumeText2(node.textContent)).filter(Boolean);
          if (values.length > 0) return values;
        }
        return [];
      }, "getLines");
      const periodText = getText([
        ".work-time",
        ".time",
        ".date",
        ".work-date",
        ".job-time",
        '[class*="work-time"]',
        '[class*="job-time"]'
      ]);
      const startDate = periodText.includes("~") ? normalizeResumeText2(periodText.split("~")[0]) : periodText;
      const endDate = periodText.includes("~") ? normalizeResumeText2(periodText.split("~").slice(1).join("~")) : "";
      const durationLabel = getText([
        ".work-time-other",
        ".time-other",
        ".duration",
        '[class*="duration"]'
      ]);
      const companyName = getText([
        ".work-company",
        ".company-name",
        ".company",
        '[class*="company"]'
      ]);
      const jobTitle = getText([
        ".work-position",
        ".job-title",
        ".position-name",
        ".position",
        '[class*="position"]',
        '[class*="job-title"]'
      ]);
      const department = getText([
        ".work-department",
        ".department",
        '[class*="department"]'
      ]);
      const companyMeta = getText([
        ".company-other",
        ".company-info",
        ".company-meta",
        '[class*="company-other"]',
        '[class*="company-info"]'
      ]);
      const reasonText = getText([
        ".work-reason",
        ".leave-reason",
        '[class*="leave-reason"]',
        '[class*="reason"]'
      ]).replace(/^离职原因[:：]?\s*/u, "");
      const ownDescription = getOwnText([
        ".work-desc",
        ".work-detail",
        ".work-content",
        ".work-responsibility",
        ".work-duty",
        '[class*="work-desc"]',
        '[class*="responsibility"]',
        '[class*="duty"]'
      ]);
      const descriptionLines = getLines([
        ".work-desc p, .work-detail p, .work-content p, .work-responsibility p, .work-duty p",
        ".work-desc li, .work-detail li, .work-content li, .work-responsibility li, .work-duty li",
        '[class*="work-desc"] p, [class*="responsibility"] p, [class*="duty"] p',
        '[class*="work-desc"] li, [class*="responsibility"] li, [class*="duty"] li'
      ]);
      const description = [
        ownDescription,
        descriptionLines.length > 0 ? descriptionLines.join("\n") : "",
        department ? `\u90E8\u95E8\uFF1A${department}` : "",
        companyMeta ? `\u516C\u53F8\u4FE1\u606F\uFF1A${companyMeta}` : "",
        reasonText ? `\u79BB\u804C\u539F\u56E0\uFF1A${reasonText}` : ""
      ].filter(Boolean).join("\n");
      const raw = buildWorkHistoryRawParts2([
        periodText,
        durationLabel,
        companyName,
        jobTitle,
        department ? `\u90E8\u95E8\uFF1A${department}` : "",
        companyMeta ? `\u516C\u53F8\u4FE1\u606F\uFF1A${companyMeta}` : "",
        ownDescription,
        descriptionLines.join("\uFF1B"),
        reasonText ? `\u79BB\u804C\u539F\u56E0\uFF1A${reasonText}` : ""
      ]);
      if (!raw && !description) return null;
      return {
        raw: raw || description,
        companyName: companyName || void 0,
        jobTitle: jobTitle || void 0,
        description: description || void 0,
        department: department || void 0,
        startDate: startDate || void 0,
        endDate: endDate || void 0
      };
    }
    __name(buildJob5156DetailWorkHistoryItem2, "buildJob5156DetailWorkHistoryItem");
    function collectSectionItemsByHeading(root, headingPattern, primarySelectors = [], fallbackSelectors = []) {
      const { collectJob5156SectionItemsByHeading: collectJob5156SectionItemsByHeading3 } = deps;
      return collectJob5156SectionItemsByHeading3(
        root,
        headingPattern,
        primarySelectors,
        fallbackSelectors
      );
    }
    __name(collectSectionItemsByHeading, "collectSectionItemsByHeading");
    function buildJob5156DetailResumeFromRoot2(root, options = {}) {
      if (!(root instanceof Element)) return [];
      const {
        pathname,
        profileUrl: profileUrlInput,
        extractedAt
      } = normalizeJob5156ExtractOptions2(options);
      if (!isJob5156DetailRootReady2(root, pathname)) return [];
      const readText = /* @__PURE__ */ __name((selectors, scopedRoot = root) => {
        for (const selector of selectors) {
          const value = normalizeResumeText2(
            scopedRoot.querySelector(selector)?.textContent
          );
          if (value) return value;
        }
        return "";
      }, "readText");
      const resumeId = extractJob5156ResumeId2(pathname);
      const profileUrl = normalizeJob5156ProfileUrlForExport2(profileUrlInput);
      const basicTextNodes = Array.from(
        root.querySelectorAll(
          '.basic-line__text, .basic-line span, .resume-basic-info span, [class*="basic"] span, .info-item, .label-value, .tag'
        )
      ).map((node) => node.textContent || "");
      const filteredBasicTextNodes = basicTextNodes.filter(
        (item) => !/求职状态|沟通中|更新时间/.test(item)
      );
      const { age, experience, education, location } = parseJob5156BasicInfoItems2(
        filteredBasicTextNodes
      );
      const workItems = collectSectionItemsByHeading(
        root,
        /工作经历|工作经验|工作履历/u,
        [
          ".resume-work__info",
          ".work-item",
          ".work-block",
          '[class*="work-item"]',
          '[class*="work-block"]'
        ],
        [
          ":scope > li",
          ":scope > .item",
          ':scope > [class*="item"]'
        ]
      );
      const educationItems = collectSectionItemsByHeading(
        root,
        /教育经历|教育背景|学习经历/u,
        [
          ".resume-education__info",
          ".school-item",
          '[class*="education"]',
          '[class*="school"]'
        ],
        [
          ":scope > li",
          ":scope > .item",
          ':scope > [class*="item"]'
        ]
      );
      const seenWorkHistory = /* @__PURE__ */ new Set();
      const workHistory = workItems.map((item) => buildJob5156DetailWorkHistoryItem2(item)).filter((item) => item && isMeaningfulJob5156WorkHistoryEntry2(item)).filter((item) => {
        const signature = [
          item.companyName || "",
          item.jobTitle || "",
          item.startDate || "",
          item.endDate || "",
          item.raw || ""
        ].join("|");
        if (seenWorkHistory.has(signature)) return false;
        seenWorkHistory.add(signature);
        return true;
      });
      const seenEducation = /* @__PURE__ */ new Set();
      const profileEducation = educationItems.map((item) => buildJob5156EducationItem2(item)).filter(
        (item) => item && [item.institution, item.qualification, item.endDate].some(Boolean)
      ).filter((item) => {
        const signature = [
          item.institution || "",
          item.qualification || "",
          item.endDate || ""
        ].join("|");
        if (seenEducation.has(signature)) return false;
        seenEducation.add(signature);
        return true;
      });
      const activityStatus = readText([
        ".date-type-diff-text-block",
        ".resume-status",
        ".active-status",
        '[class*="status"]'
      ]);
      const intentionSection = root.querySelector(
        ".resume-view-layout.resume-interview"
      );
      const intentionItems = Array.from(
        intentionSection?.querySelectorAll(".resume-interview-info") || []
      );
      const jobIntention = intentionItems.map(
        (item) => normalizeResumeText2(item.querySelector(".pos-name")?.textContent)
      ).filter(Boolean).join(" / ");
      const expectedSalary = normalizeResumeText2(
        intentionItems[0]?.textContent
      ).replace(/^.+?\s(\d[^\s]*元\/[月天年]).*$/u, "$1");
      const selfIntro = normalizeResumeText2(
        root.querySelector(
          ".resume-view-layout.resume-advantages .resume-advantages_skill pre"
        )?.textContent || root.querySelector(
          ".resume-view-layout.resume-advantages .resume-advantages_skill"
        )?.textContent || ""
      );
      const name = readText([
        ".resume-name",
        ".basic-name",
        ".name",
        ".resume-view-item__block.resume-basic",
        "h1"
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
          profileEducation: profileEducation.length > 0 ? profileEducation : void 0,
          extractedAt,
          source: JOB5156_HOST2
        }
      ];
    }
    __name(buildJob5156DetailResumeFromRoot2, "buildJob5156DetailResumeFromRoot");
    function extractJob5156DetailResume2() {
      if (!isJob5156DetailPage2() || !isJob5156DetailReady2()) return [];
      return buildJob5156DetailResumeFromRoot2(getJob5156DetailRoot2(), {
        pathname: window.location.pathname,
        profileUrl: window.location.href
      });
    }
    __name(extractJob5156DetailResume2, "extractJob5156DetailResume");
    function buildJob5156DetailWorkHistoryItemFromApi2(item) {
      if (!item || typeof item !== "object") return null;
      const begin = normalizeResumeText2(item.begin);
      const end = normalizeResumeText2(item.end);
      const dateRange = [begin, end].filter(Boolean).join("~");
      const durationLabel = normalizeResumeText2(item.timeDiff || item.timeDiff2);
      const companyName = normalizeResumeText2(item.comName || item.comNameStr);
      const jobTitle = normalizeResumeText2(item.jobNameStr || item.jobName);
      const department = normalizeResumeText2(item.section);
      const companyMeta = buildWorkHistoryRawParts2([
        normalizeResumeText2(item.comCallingStr),
        normalizeResumeText2(item.comScaleStr),
        normalizeResumeText2(item.comTypeStr)
      ]);
      const description = normalizeResumeMultilineText2(item.description);
      const reasonText = normalizeResumeText2(item.leftreason);
      const startDate = begin || void 0;
      const endDate = end || void 0;
      const descriptionLines = [
        companyMeta ? `\u516C\u53F8\u4FE1\u606F\uFF1A${companyMeta}` : "",
        department ? `\u90E8\u95E8\uFF1A${department}` : "",
        description,
        reasonText ? `\u79BB\u804C\u539F\u56E0\uFF1A${reasonText}` : ""
      ].filter(Boolean);
      const raw = buildWorkHistoryRawParts2([
        dateRange,
        durationLabel ? `(${durationLabel})` : "",
        companyName,
        jobTitle,
        ...descriptionLines
      ]);
      if (!raw && !description && !companyName && !jobTitle) return null;
      return {
        raw: raw || description || buildWorkHistoryRawParts2([companyName, jobTitle, dateRange]),
        companyName: companyName || void 0,
        jobTitle: jobTitle || void 0,
        description: descriptionLines.join("\n") || void 0,
        startDate,
        endDate
      };
    }
    __name(buildJob5156DetailWorkHistoryItemFromApi2, "buildJob5156DetailWorkHistoryItemFromApi");
    function buildJob5156EducationItemFromApi2(item) {
      if (!item || typeof item !== "object") return null;
      const institution = normalizeResumeText2(item.schoolName);
      const degree = normalizeResumeText2(item.degreeStr);
      const speciality = normalizeResumeText2(item.speciality);
      const qualification = buildWorkHistoryRawParts2([degree, speciality]);
      const endDate = normalizeResumeText2(
        [item.begin, item.end].filter(Boolean).join("~") || item.end
      );
      const description = buildWorkHistoryRawParts2([
        degree,
        speciality,
        endDate,
        institution
      ]);
      if (!institution && !qualification && !endDate) return null;
      return {
        institution: institution || void 0,
        qualification: qualification || void 0,
        endDate: endDate || void 0,
        description: description || void 0
      };
    }
    __name(buildJob5156EducationItemFromApi2, "buildJob5156EducationItemFromApi");
    function normalizeJob5156ExtractOptions2(options = {}) {
      return {
        pathname: typeof options.pathname === "string" ? options.pathname : window.location.pathname,
        profileUrl: typeof options.profileUrl === "string" ? options.profileUrl : window.location.href,
        extractedAt: typeof options.extractedAt === "string" ? options.extractedAt : (/* @__PURE__ */ new Date()).toISOString()
      };
    }
    __name(normalizeJob5156ExtractOptions2, "normalizeJob5156ExtractOptions");
    function buildJob5156DetailResumeFromApiPayload2(payload, options = {}) {
      if (!payload || typeof payload !== "object") return [];
      const { pathname, profileUrl, extractedAt } = normalizeJob5156ExtractOptions2(options);
      const resumeId = extractJob5156ResumeId2(pathname) || normalizeResumeText2(payload.resumeId);
      const normalizedProfileUrl = normalizeJob5156ProfileUrlForExport2(profileUrl);
      const resumeView = payload.resumeViewVo && typeof payload.resumeViewVo === "object" ? payload.resumeViewVo : null;
      const cnVo = resumeView?.cnVo && typeof resumeView.cnVo === "object" ? resumeView.cnVo : null;
      const basicInfo = cnVo?.basicInfoVo && typeof cnVo.basicInfoVo === "object" ? cnVo.basicInfoVo : null;
      const intentInfo = cnVo?.intentInfoVo && typeof cnVo.intentInfoVo === "object" ? cnVo.intentInfoVo : null;
      if (!resumeId || !cnVo || !basicInfo) return [];
      const workHistory = Array.isArray(cnVo.workInfoVoList) ? cnVo.workInfoVoList.map((item) => buildJob5156DetailWorkHistoryItemFromApi2(item)).filter(Boolean) : [];
      const profileEducation = Array.isArray(cnVo.educationInfoVoList) ? cnVo.educationInfoVoList.map((item) => buildJob5156EducationItemFromApi2(item)).filter(Boolean) : [];
      const locationParts = [
        normalizeResumeText2(cnVo.liveProvince),
        normalizeResumeText2(cnVo.liveCity),
        normalizeResumeText2(cnVo.liveTown)
      ].filter(Boolean);
      const intentionParts = Array.isArray(payload.intentInfoVo2List) ? payload.intentInfoVo2List.map((item) => normalizeResumeText2(item.jobNameStr || item.jobCodeStr)).filter(Boolean) : [];
      return [
        {
          resumeId,
          perUserId: normalizeResumeText2(payload.perUserId || basicInfo.id),
          name: normalizeResumeText2(payload.userName || basicInfo.userName),
          profileUrl: normalizedProfileUrl,
          activityStatus: normalizeResumeText2(basicInfo.jobStateStr),
          age: normalizeResumeText2(basicInfo.age ? `${basicInfo.age}\u5C81` : ""),
          experience: normalizeResumeText2(
            basicInfo.firstWorkingTimeStr || basicInfo.jobyearTypeStr
          ),
          education: normalizeResumeText2(
            basicInfo.degreeStr || cnVo.maxDegree?.degreeStr
          ),
          location: normalizeResumeText2(
            locationParts.join("") || basicInfo.locationStr
          ),
          jobIntention: normalizeResumeText2(
            intentionParts.join(",") || intentInfo?.jobLocationStr && `${intentInfo.jobLocationStr}${intentInfo.jobCodeStr ? `${intentInfo.jobCodeStr}` : ""}` || intentInfo?.jobCodeStr
          ),
          expectedSalary: normalizeResumeText2(
            payload.salaryStr || intentInfo?.salaryStr
          ),
          selfIntro: normalizeResumeText2(intentInfo?.professionSkill),
          workHistory,
          profileEducation: profileEducation.length > 0 ? profileEducation : void 0,
          extractedAt,
          source: JOB5156_HOST2
        }
      ];
    }
    __name(buildJob5156DetailResumeFromApiPayload2, "buildJob5156DetailResumeFromApiPayload");
    async function fetchJob5156ResumeDetail2(profileUrl, pathname) {
      const resumePathname = typeof pathname === "string" && pathname ? pathname : new URL(profileUrl).pathname;
      const resumeId = extractJob5156ResumeId2(resumePathname);
      if (!resumeId) return null;
      const url = new URL(
        `/api/com/resume/${encodeURIComponent(resumeId)}`,
        window.location.origin
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
        JOB5156_DETAIL_FETCH_TIMEOUT_MS2
      );
      try {
        const response = await fetch(url.toString(), {
          credentials: "include",
          headers: {
            Accept: "application/json",
            appType: "pc",
            pcVersion: "1.0.1",
            posTypeNewFlag: "true",
            version: "2.0"
          },
          signal: controller.signal
        });
        if (!response.ok) return null;
        const payload = await response.json();
        if (!payload || typeof payload !== "object" || payload.code !== 200 || !payload.data)
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
    __name(fetchJob5156ResumeDetail2, "fetchJob5156ResumeDetail");
    async function enrichSingleJob5156SearchResumeWithDetail2(resume, extractedAt) {
      if (!resume || typeof resume !== "object") return null;
      const profileUrl = normalizeJob5156ProfileUrlForExport2(
        resume.profileUrl || ""
      );
      const fallbackResume = {
        ...resume,
        profileUrl,
        extractedAt: resume.extractedAt || extractedAt
      };
      if (!profileUrl) return fallbackResume;
      try {
        let detailResume = null;
        const pathname = new URL(profileUrl).pathname;
        const detailPayload = await fetchJob5156ResumeDetail2(profileUrl, pathname);
        if (detailPayload) {
          detailResume = buildJob5156DetailResumeFromApiPayload2(detailPayload, {
            pathname,
            profileUrl,
            extractedAt: fallbackResume.extractedAt
          })[0] || null;
        }
        if (!detailResume) {
          const response = await fetch(profileUrl, {
            credentials: "include",
            headers: { Accept: "text/html,application/xhtml+xml" }
          });
          if (response.ok) {
            const html = await response.text();
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, "text/html");
            detailResume = buildJob5156DetailResumeFromRoot2(doc.body, {
              pathname,
              profileUrl,
              extractedAt: fallbackResume.extractedAt
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
          extractedAt: fallbackResume.extractedAt
        };
      } catch (error) {
        console.warn(
          "\u{1F3AF} [Auto Sync] Failed to enrich Job5156 detail resume:",
          profileUrl,
          error
        );
        return fallbackResume;
      }
    }
    __name(enrichSingleJob5156SearchResumeWithDetail2, "enrichSingleJob5156SearchResumeWithDetail");
    async function enrichJob5156SearchResumesWithDetail2(resumes) {
      if (!Array.isArray(resumes) || resumes.length === 0) return [];
      const extractedAt = (/* @__PURE__ */ new Date()).toISOString();
      const enriched = [];
      for (let start = 0; start < resumes.length; start += JOB5156_DETAIL_FETCH_CONCURRENCY2) {
        const batch = resumes.slice(
          start,
          start + JOB5156_DETAIL_FETCH_CONCURRENCY2
        );
        const batchResults = await Promise.all(
          batch.map(
            (resume) => enrichSingleJob5156SearchResumeWithDetail2(resume, extractedAt)
          )
        );
        enriched.push(
          ...batchResults.filter(Boolean)
        );
      }
      return enriched;
    }
    __name(enrichJob5156SearchResumesWithDetail2, "enrichJob5156SearchResumesWithDetail");
    function parseJob5156BasicInfoItems2(items, locationOverride = "") {
      const basicInfo = Array.isArray(items) ? items.map((item) => normalizeResumeText2(item)).filter(Boolean) : [];
      let age = "";
      let experience = "";
      let education = "";
      let location = "";
      basicInfo.forEach((item) => {
        if (!age && item.includes("\u5C81")) age = item;
        else if (!experience && item.includes("\u5E74") && !item.includes("\u5143"))
          experience = item;
        else if (!education && /(中专|高中|大专|本科|硕|博|研究生|MBA|EMBA)/.test(item))
          education = item;
        else if (!location && !item.includes("\u5143") && !/^(男|女|已婚|未婚|群众|党员|团员|中共党员)$/.test(item))
          location = item;
      });
      if (locationOverride) {
        location = normalizeResumeText2(locationOverride);
      }
      return { age, experience, education, location };
    }
    __name(parseJob5156BasicInfoItems2, "parseJob5156BasicInfoItems");
    function buildJob5156WorkHistoryItem2(item) {
      if (!(item instanceof Element)) return null;
      const startDate = normalizeResumeText2(
        item.querySelector(".work-time > span:first-child")?.textContent
      );
      const durationLabel = normalizeResumeText2(
        item.querySelector(".work-time-other")?.textContent
      );
      const companyName = normalizeResumeText2(
        item.querySelector(".work-company")?.textContent
      );
      const jobTitle = normalizeResumeText2(
        item.querySelector(".work-position")?.textContent
      );
      const description = normalizeResumeText2(
        item.querySelector(
          ".work-desc, .work-detail, .work-content, .work-responsibility, .work-duty"
        )?.textContent
      );
      const endDate = startDate.includes("~") ? normalizeResumeText2(startDate.split("~").slice(1).join("~")) : "";
      const raw = buildWorkHistoryRawParts2([
        startDate,
        durationLabel,
        companyName,
        jobTitle,
        description
      ]);
      if (!raw) return null;
      return {
        raw,
        companyName: companyName || void 0,
        jobTitle: jobTitle || void 0,
        description: description || void 0,
        startDate: startDate || void 0,
        endDate: endDate || void 0
      };
    }
    __name(buildJob5156WorkHistoryItem2, "buildJob5156WorkHistoryItem");
    function buildJob5156EducationItem2(item) {
      if (!(item instanceof Element)) return null;
      const liveEducationText = normalizeResumeText2(item.textContent);
      if (item.classList.contains("resume-education__info") || item.closest(".resume-education")) {
        const institution2 = normalizeResumeText2(
          item.querySelector(".flex.w-full > div:last-child")?.textContent
        );
        const rowText = Array.from(item.querySelectorAll(".flex.w-full > div")).map((node) => normalizeResumeText2(node.textContent)).filter(Boolean);
        const endDate2 = rowText.find((value) => /^\d{4}(~|-)/.test(value)) || "";
        const qualification2 = rowText.filter((value) => value !== institution2 && value !== endDate2).join(" \xB7 ");
        if (!institution2 && !qualification2 && !endDate2 && !liveEducationText)
          return null;
        return {
          institution: institution2 || void 0,
          qualification: qualification2 || void 0,
          endDate: endDate2 || void 0,
          description: liveEducationText || void 0
        };
      }
      const institution = normalizeResumeText2(
        item.querySelector(".school-name")?.textContent
      );
      const qualification = normalizeResumeText2(
        item.querySelector(".school-major")?.textContent
      );
      const degree = normalizeResumeText2(
        item.querySelector(".school-degree")?.textContent
      );
      const endDate = normalizeResumeText2(
        item.querySelector(".school-time")?.textContent
      );
      if (!institution && !qualification && !degree && !endDate) return null;
      return {
        institution: institution || void 0,
        qualification: [qualification, degree].filter(Boolean).join(" \xB7 ") || void 0,
        endDate: endDate || void 0
      };
    }
    __name(buildJob5156EducationItem2, "buildJob5156EducationItem");
    return {
      isJob5156DetailPage: isJob5156DetailPage2,
      getJob5156DetailRoot: getJob5156DetailRoot2,
      getJob5156DetailHeaderText: getJob5156DetailHeaderText2,
      isJob5156DetailReady: isJob5156DetailReady2,
      isJob5156DetailRootReady: isJob5156DetailRootReady2,
      parseJob5156BasicInfoItems: parseJob5156BasicInfoItems2,
      buildJob5156WorkHistoryItem: buildJob5156WorkHistoryItem2,
      buildJob5156EducationItem: buildJob5156EducationItem2,
      buildJob5156DetailWorkHistoryItem: buildJob5156DetailWorkHistoryItem2,
      buildJob5156DetailResumeFromRoot: buildJob5156DetailResumeFromRoot2,
      extractJob5156DetailResume: extractJob5156DetailResume2,
      buildJob5156DetailWorkHistoryItemFromApi: buildJob5156DetailWorkHistoryItemFromApi2,
      buildJob5156EducationItemFromApi: buildJob5156EducationItemFromApi2,
      normalizeJob5156ExtractOptions: normalizeJob5156ExtractOptions2,
      buildJob5156DetailResumeFromApiPayload: buildJob5156DetailResumeFromApiPayload2,
      fetchJob5156ResumeDetail: fetchJob5156ResumeDetail2,
      enrichSingleJob5156SearchResumeWithDetail: enrichSingleJob5156SearchResumeWithDetail2,
      enrichJob5156SearchResumesWithDetail: enrichJob5156SearchResumesWithDetail2,
      extractJob5156ResumeId: extractJob5156ResumeId2,
      normalizeJob5156ProfileUrlForExport: normalizeJob5156ProfileUrlForExport2
    };
  }
  __name(createJob5156Extractor, "createJob5156Extractor");

  // src/lib/job51-search-extractor.ts
  function createJob51SearchExtractor(deps) {
    const {
      getCurrentSourceKey: getCurrentSourceKey2,
      SOURCE_KEYS: SOURCE_KEYS2,
      apiSnapshot: apiSnapshot2,
      normalizeJob51Text: normalizeJob51Text2,
      normalizeJob51MultilineText: normalizeJob51MultilineText2,
      normalizeResumeText: normalizeResumeText2,
      buildWorkHistoryRawParts: buildWorkHistoryRawParts2,
      EHIRE_51JOB_PROFILE_URL_PREFIX: EHIRE_51JOB_PROFILE_URL_PREFIX2,
      EHIRE_51JOB_HOST: EHIRE_51JOB_HOST2,
      JOB51_PAGE_COOLDOWN_MS: JOB51_PAGE_COOLDOWN_MS2,
      JOB51_DETAIL_FETCH_TIMEOUT_MS: JOB51_DETAIL_FETCH_TIMEOUT_MS2,
      JOB51_RATE_LIMIT_ERROR_MESSAGE: JOB51_RATE_LIMIT_ERROR_MESSAGE2,
      buildJob51DetailResumeFromPayload: buildJob51DetailResumeFromPayload2,
      filterCurrentResumesByAgeRange: filterCurrentResumesByAgeRange2,
      chrome: chrome2,
      window: win,
      fetch: globalFetch,
      delay: delay2,
      isElementVisible: isElementVisible2,
      activateElement: activateElement2,
      findVueParentByName: findVueParentByName2
    } = deps;
    function isJob51DetailPage2() {
      return getCurrentSourceKey2() === SOURCE_KEYS2.JOB51 && /\/Revision\/talent\/resume\/detail/i.test(win.location.pathname);
    }
    __name(isJob51DetailPage2, "isJob51DetailPage");
    function isJob51DetailReady2() {
      return isJob51DetailPage2() && !!apiSnapshot2.job51DetailPayload;
    }
    __name(isJob51DetailReady2, "isJob51DetailReady");
    function normalizeJob51AuthContext2(requestHeaders, request) {
      const headers = requestHeaders && typeof requestHeaders === "object" ? requestHeaders : {};
      const requestBody = request && typeof request === "object" ? request : {};
      const pick = /* @__PURE__ */ __name((...keys) => {
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
      }, "pick");
      const accesstoken = pick("accesstoken", "access-token", "accessToken");
      const guid = pick("guid");
      const property = pick("property");
      const sign = pick("sign");
      if (!accesstoken && !guid && !property && !sign) {
        return null;
      }
      return {
        ...accesstoken ? { accesstoken } : {},
        ...guid ? { guid } : {},
        ...property ? { property } : {},
        ...sign ? { sign } : {}
      };
    }
    __name(normalizeJob51AuthContext2, "normalizeJob51AuthContext");
    function getJob51RawRows2(payload) {
      const rows = payload?.data?.list || payload?.data?.items || payload?.data?.rows || payload?.list || payload?.items || payload?.rows || (Array.isArray(payload?.data) ? payload.data : null) || (Array.isArray(payload) ? payload : null);
      return Array.isArray(rows) ? rows : null;
    }
    __name(getJob51RawRows2, "getJob51RawRows");
    function getJob51TotalFromPayload2(payload) {
      const total = payload?.data?.total ?? payload?.total;
      return typeof total === "number" && total >= 0 ? total : null;
    }
    __name(getJob51TotalFromPayload2, "getJob51TotalFromPayload");
    function isLikelyJob51ResumeRow2(row) {
      if (!row || typeof row !== "object") return false;
      const rec = row;
      const baseInfo = rec.base_info && typeof rec.base_info === "object" ? rec.base_info : null;
      const jobIntention = rec.job_intention && typeof rec.job_intention === "object" ? rec.job_intention : null;
      const recentWorkInfo = rec.recent_work_info && typeof rec.recent_work_info === "object" ? rec.recent_work_info : null;
      const identityCandidates = [
        rec.resumeId,
        rec.resumeNo,
        rec.resumekey,
        rec.perUserId,
        rec.userId,
        rec.candidateId,
        rec.memberId,
        rec.userid,
        rec.real_userid,
        baseInfo?.accountid
      ];
      const hasIdentity = identityCandidates.some((value) => {
        if (value == null) return false;
        return String(value).trim().length > 0;
      });
      const nameCandidates = [
        rec.name,
        rec.userName,
        rec.candidateName,
        rec.fullName,
        baseInfo?.resume_name
      ];
      const hasName = nameCandidates.some((value) => {
        if (value == null) return false;
        return normalizeJob51Text2(String(value)).length > 0;
      });
      const detailCandidates = [
        rec.workYear,
        rec.workYears,
        rec.experienceYears,
        rec.experience,
        rec.education,
        rec.educationLevel,
        rec.degree,
        rec.eduLevel,
        rec.location,
        rec.workCity,
        rec.city,
        rec.workLocation,
        rec.jobIntention,
        rec.desiredJob,
        rec.expectedPosition,
        rec.targetJob,
        rec.searchJob,
        baseInfo?.work_year_value,
        baseInfo?.top_degree_value,
        baseInfo?.area_value,
        jobIntention?.expect_work_function_value,
        jobIntention?.expect_job_area_value,
        recentWorkInfo?.recent_position
      ];
      const hasDetail = detailCandidates.some((value) => {
        if (value == null) return false;
        return normalizeJob51Text2(String(value)).length > 0;
      });
      return hasIdentity && hasName || hasName && hasDetail;
    }
    __name(isLikelyJob51ResumeRow2, "isLikelyJob51ResumeRow");
    function getJob51ResumeRows2(payload) {
      const rows = getJob51RawRows2(payload);
      return Array.isArray(rows) ? rows.filter(isLikelyJob51ResumeRow2) : null;
    }
    __name(getJob51ResumeRows2, "getJob51ResumeRows");
    function hasJob51SearchSnapshot2() {
      if (!Array.isArray(apiSnapshot2.job51SearchRows)) return false;
      return apiSnapshot2.job51SearchRows.length > 0 || typeof apiSnapshot2.job51Total === "number";
    }
    __name(hasJob51SearchSnapshot2, "hasJob51SearchSnapshot");
    function isJob51EmptySearchPromptVisible2() {
      if (getCurrentSourceKey2() !== SOURCE_KEYS2.JOB51) return false;
      const pageText = normalizeResumeText2(document.body?.textContent || "");
      return pageText.includes("\u8F93\u5165\u5173\u952E\u8BCD\u641C\u7D22\u5BFB\u627E\u5339\u914D\u4EBA\u624D");
    }
    __name(isJob51EmptySearchPromptVisible2, "isJob51EmptySearchPromptVisible");
    function isJob51RateLimitedPage2() {
      if (getCurrentSourceKey2() !== SOURCE_KEYS2.JOB51) return false;
      const pageText = normalizeResumeText2(document.body?.textContent || "");
      return pageText.includes("\u641C\u7D22\u8BBF\u95EE\u592A\u5FEB") && pageText.includes("\u8BF760\u5206\u949F\u540E\u518D\u8BD5");
    }
    __name(isJob51RateLimitedPage2, "isJob51RateLimitedPage");
    function ensureJob51PageAllowed2() {
      if (isJob51RateLimitedPage2()) {
        throw new Error(JOB51_RATE_LIMIT_ERROR_MESSAGE2);
      }
    }
    __name(ensureJob51PageAllowed2, "ensureJob51PageAllowed");
    async function waitForJob51Cooldown2() {
      if (getCurrentSourceKey2() !== SOURCE_KEYS2.JOB51) return;
      await delay2(JOB51_PAGE_COOLDOWN_MS2);
    }
    __name(waitForJob51Cooldown2, "waitForJob51Cooldown");
    function isJob51RateLimitedErrorMessage2(message) {
      const normalized = normalizeResumeText2(String(message || ""));
      return normalized.includes("\u641C\u7D22\u8BBF\u95EE\u592A\u5FEB") || normalized.includes("\u8BF760\u5206\u949F\u540E\u518D\u8BD5") || normalized.includes("\u8BBF\u95EE\u9891\u7387\u9650\u5236") || normalized.includes("\u9891\u7387\u9650\u5236") || normalized.toLowerCase().includes("rate limit");
    }
    __name(isJob51RateLimitedErrorMessage2, "isJob51RateLimitedErrorMessage");
    function isJob51RateLimitedPayload2(payload) {
      if (!payload) return false;
      const rec = payload;
      const data = rec.data;
      const candidates = [
        rec.error,
        rec.message,
        rec.msg,
        rec.detail,
        data?.error,
        data?.message,
        data?.msg,
        data?.detail
      ];
      return candidates.some((value) => isJob51RateLimitedErrorMessage2(value));
    }
    __name(isJob51RateLimitedPayload2, "isJob51RateLimitedPayload");
    function isJob51DetailApiErrorPayload2(payload) {
      if (!payload || typeof payload !== "object") return false;
      if (payload.result === "0" || payload.result === 0) return true;
      return typeof payload.code === "string" && payload.code.length > 0 && payload.code !== "200" && payload.code !== "0" && typeof payload.msg === "string" && payload.msg.length > 0;
    }
    __name(isJob51DetailApiErrorPayload2, "isJob51DetailApiErrorPayload");
    async function collectJob51DetailFromBackground2(resumeId) {
      try {
        const response = await chrome2.runtime.sendMessage({
          action: "collectJob51ResumeDetail",
          resumeId
        });
        if (response?.success) {
          return {
            payload: response.data ?? response.payload ?? response.resume ?? null,
            rateLimited: false
          };
        }
        const errorMessage = response?.error ? String(response.error) : "";
        return {
          payload: null,
          rateLimited: isJob51RateLimitedErrorMessage2(errorMessage)
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error || "");
        return {
          payload: null,
          rateLimited: isJob51RateLimitedErrorMessage2(message)
        };
      }
    }
    __name(collectJob51DetailFromBackground2, "collectJob51DetailFromBackground");
    async function fetch51JobResumeDetail2(resumeId) {
      const normalizedResumeId = normalizeJob51Text2(resumeId);
      if (!normalizedResumeId) {
        return { payload: null, rateLimited: false };
      }
      const authContext = apiSnapshot2.job51AuthContext;
      const requestBody = {
        resume_id: normalizedResumeId,
        resumeId: normalizedResumeId,
        userid: normalizedResumeId,
        lan: "c",
        timestamp: Math.floor(Date.now() / 1e3),
        ...authContext?.property ? { property: authContext.property } : {}
      };
      if (authContext?.accesstoken || authContext?.guid || authContext?.property) {
        const headers = {
          Accept: "application/json, text/plain, */*",
          "Content-Type": "application/json",
          ...authContext.accesstoken ? { accesstoken: authContext.accesstoken } : {},
          ...authContext.guid ? { guid: authContext.guid } : {},
          ...authContext.property ? { property: authContext.property } : {}
        };
        const controller = new AbortController();
        const timeoutId = win.setTimeout(
          () => controller.abort(),
          JOB51_DETAIL_FETCH_TIMEOUT_MS2
        );
        try {
          const response = await globalFetch(
            "https://ehirej.51job.com/resumedtl/getresume",
            {
              method: "POST",
              credentials: "include",
              headers,
              body: JSON.stringify(requestBody),
              signal: controller.signal
            }
          );
          if (response.status === 403) {
            return { payload: null, rateLimited: true };
          }
          if (response.ok) {
            const payload = await response.json().catch(() => null);
            if (isJob51RateLimitedPayload2(payload)) {
              return { payload: null, rateLimited: true };
            }
            if (isJob51DetailApiErrorPayload2(payload)) {
              console.warn(
                "\u{1F3AF} [Auto Sync] Job51 detail API error, falling back to background:",
                normalizedResumeId,
                payload?.code,
                payload?.msg
              );
            } else if (payload) {
              return { payload, rateLimited: false };
            }
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error || "");
          if (isJob51RateLimitedErrorMessage2(message)) {
            return { payload: null, rateLimited: true };
          }
          if (error instanceof DOMException && error.name === "AbortError") {
            console.warn(
              "\u{1F3AF} [Auto Sync] Direct Job51 detail fetch timed out:",
              normalizedResumeId
            );
          } else {
            console.warn(
              "\u{1F3AF} [Auto Sync] Direct Job51 detail fetch failed:",
              normalizedResumeId,
              error
            );
          }
        } finally {
          win.clearTimeout(timeoutId);
        }
      }
      return collectJob51DetailFromBackground2(normalizedResumeId);
    }
    __name(fetch51JobResumeDetail2, "fetch51JobResumeDetail");
    async function enrich51JobSearchResumeWithDetail2(resume, extractedAt) {
      if (!resume || typeof resume !== "object") {
        return {
          resume: null,
          enriched: false,
          rateLimited: false
        };
      }
      const rec = resume;
      const fallbackResume = {
        ...rec,
        extractedAt: rec.extractedAt || extractedAt
      };
      const resumeId = normalizeJob51Text2(rec.resumeId) || normalizeJob51Text2(rec.perUserId) || "";
      if (!resumeId) {
        return {
          resume: fallbackResume,
          enriched: false,
          rateLimited: false
        };
      }
      try {
        const detailResult = await fetch51JobResumeDetail2(resumeId);
        if (!detailResult?.payload) {
          return {
            resume: fallbackResume,
            enriched: false,
            rateLimited: !!detailResult?.rateLimited
          };
        }
        const detailResume = buildJob51DetailResumeFromPayload2(detailResult.payload, {
          resumeId,
          profileUrl: fallbackResume.profileUrl || ""
        })[0] || null;
        if (!detailResume) {
          return {
            resume: fallbackResume,
            enriched: false,
            rateLimited: !!detailResult.rateLimited
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
            jobIntention: detailResume.jobIntention || fallbackResume.jobIntention || "",
            expectedSalary: detailResume.expectedSalary || fallbackResume.expectedSalary || "",
            activityStatus: detailResume.activityStatus || fallbackResume.activityStatus || "",
            selfIntro: detailResume.selfIntro || fallbackResume.selfIntro || "",
            resumeId: detailResume.resumeId || fallbackResume.resumeId,
            perUserId: detailResume.perUserId || fallbackResume.perUserId,
            externalId: detailResume.externalId || fallbackResume.externalId,
            profileUrl: detailResume.profileUrl || fallbackResume.profileUrl,
            extractedAt: fallbackResume.extractedAt,
            pageIndex: fallbackResume.pageIndex,
            pageNumber: fallbackResume.pageNumber,
            workHistory: Array.isArray(detailResume.workHistory) && detailResume.workHistory.length > 0 ? detailResume.workHistory : Array.isArray(fallbackResume.workHistory) ? fallbackResume.workHistory : [],
            projectExperience: Array.isArray(detailResume.projectExperience) && detailResume.projectExperience.length > 0 ? detailResume.projectExperience : Array.isArray(fallbackResume.projectExperience) ? fallbackResume.projectExperience : [],
            profileEducation: Array.isArray(detailResume.profileEducation) && detailResume.profileEducation.length > 0 ? detailResume.profileEducation : Array.isArray(fallbackResume.profileEducation) ? fallbackResume.profileEducation : [],
            skills: Array.isArray(detailResume.skills) && detailResume.skills.length > 0 ? detailResume.skills : Array.isArray(fallbackResume.skills) ? fallbackResume.skills : [],
            licences: Array.isArray(detailResume.licences) && detailResume.licences.length > 0 ? detailResume.licences : Array.isArray(fallbackResume.licences) ? fallbackResume.licences : []
          },
          enriched: true,
          rateLimited: !!detailResult.rateLimited
        };
      } catch (error) {
        console.warn(
          "\u{1F3AF} [Auto Sync] Failed to enrich Job51 detail resume:",
          resumeId,
          error
        );
        return {
          resume: fallbackResume,
          enriched: false,
          rateLimited: false
        };
      }
    }
    __name(enrich51JobSearchResumeWithDetail2, "enrich51JobSearchResumeWithDetail");
    function extract51JobResumes2() {
      if (!Array.isArray(apiSnapshot2.job51SearchRows)) return [];
      return apiSnapshot2.job51SearchRows.map((row, index) => {
        const str = /* @__PURE__ */ __name((v) => v != null ? String(v) : "", "str");
        const baseInfo = row?.base_info && typeof row.base_info === "object" ? row.base_info : {};
        const jobIntentionInfo = row?.job_intention && typeof row.job_intention === "object" ? row.job_intention : {};
        const recentWorkInfo = row?.recent_work_info && typeof row.recent_work_info === "object" ? row.recent_work_info : {};
        const workList = Array.isArray(row?.work_list) ? row.work_list : [];
        const educationList = Array.isArray(row?.education_list) ? row.education_list : [];
        const latestWork = workList.find(
          (item) => item && typeof item === "object" && item.is_show
        ) || workList[0] || {};
        const latestEducation = educationList.find(
          (item) => item && typeof item === "object" && item.degree_value
        ) || educationList[0] || {};
        const uniqueSkillTags = Array.from(
          new Set(
            [
              ...Array.isArray(row?.label_sorted_skill_tag_list) ? row.label_sorted_skill_tag_list : [],
              ...Array.isArray(row?.label_list) ? row.label_list : []
            ].map((value) => normalizeJob51Text2(value)).filter(Boolean)
          )
        );
        const workHistory = workList.map((item) => {
          if (!item || typeof item !== "object") return null;
          const startDate = normalizeJob51Text2(item.start_time);
          const endDate = normalizeJob51Text2(item.end_time);
          const durationLabel = normalizeJob51Text2(item.working_years);
          const companyName = normalizeJob51Text2(item.company_name);
          const jobTitle = normalizeJob51Text2(
            item.work_func_value || item.job_name
          );
          const metaParts = [
            ...Array.isArray(item.industry_tag) ? item.industry_tag : [],
            item.company_size_value,
            item.work_type_value
          ].map((value) => normalizeJob51Text2(value)).filter(Boolean);
          if (!startDate && !endDate && !companyName && !jobTitle && metaParts.length === 0) {
            return null;
          }
          return {
            startDate: startDate || void 0,
            endDate: endDate || void 0,
            durationLabel: durationLabel || void 0,
            companyName: companyName || void 0,
            jobTitle: jobTitle || void 0,
            description: metaParts.length > 0 ? buildWorkHistoryRawParts2(metaParts) : void 0
          };
        }).filter(Boolean);
        const name = normalizeJob51Text2(
          baseInfo.resume_name || row?.name || row?.userName || row?.candidateName || row?.fullName
        );
        const ageValue = normalizeJob51Text2(
          baseInfo.age || baseInfo.displayage || baseInfo.age_value || row?.age || row?.realAge || row?.displayage || row?.age_value
        );
        const age = ageValue ? ageValue.includes("\u5C81") ? ageValue : `${ageValue}\u5C81` : "";
        const experience = normalizeJob51Text2(
          baseInfo.work_year_value || latestWork.working_years || row?.workYear || row?.workYears || row?.experienceYears || row?.experience
        );
        const education = normalizeJob51Text2(
          baseInfo.top_degree_value || latestEducation.degree_value || row?.education || row?.educationLevel || row?.degree || row?.eduLevel
        );
        const location = normalizeJob51Text2(
          jobIntentionInfo.expect_job_area_value || baseInfo.area_value || row?.location || row?.workCity || row?.city || row?.workLocation
        );
        const jobIntention = normalizeJob51Text2(
          jobIntentionInfo.expect_work_function_value || latestWork.work_func_value || latestWork.job_name || recentWorkInfo.recent_position || row?.jobIntention || row?.desiredJob || row?.expectedPosition || row?.targetJob || row?.searchJob
        );
        const expectedSalary = normalizeJob51Text2(
          jobIntentionInfo.new_expect_salary || jobIntentionInfo.expect_salary || row?.expectedSalary || row?.desiredSalary || row?.expectSalary || row?.salaryExpect
        );
        const activityStatus = normalizeJob51Text2(
          row?.active_type || row?.activityStatus || row?.lastLoginTime || row?.activeTime || row?.refreshTime
        );
        const selfIntro = normalizeJob51MultilineText2(
          row?.resume_slicing || row?.selfIntro || row?.advantage || row?.profile || row?.highlight || uniqueSkillTags.join("\u3001")
        );
        const resumeId = str(
          row?.userid || row?.resumeId || row?.resumeNo || row?.resumekey || row?.id
        );
        const perUserId = str(
          baseInfo.accountid || row?.real_userid || row?.perUserId || row?.userId || row?.candidateId || row?.memberId
        );
        const externalId = resumeId || perUserId;
        const profileUrl = resumeId ? EHIRE_51JOB_PROFILE_URL_PREFIX2 + encodeURIComponent(resumeId) : normalizeJob51Text2(row?.profileUrl || row?.resumeUrl);
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
          resumeId: resumeId || void 0,
          perUserId: perUserId || void 0,
          externalId: externalId || void 0,
          profileUrl: profileUrl || void 0,
          source: EHIRE_51JOB_HOST2,
          workHistory,
          pageIndex: index + 1,
          rawData: row,
          extractedAt: (/* @__PURE__ */ new Date()).toISOString()
        };
      });
    }
    __name(extract51JobResumes2, "extract51JobResumes");
    function extractJob51DetailResume2() {
      if (!isJob51DetailPage2() || !isJob51DetailReady2()) return [];
      return filterCurrentResumesByAgeRange2(
        buildJob51DetailResumeFromPayload2(apiSnapshot2.job51DetailPayload, {
          resumeId: new URL(win.location.href).searchParams.get("resumeId") || void 0,
          profileUrl: win.location.href
        })
      );
    }
    __name(extractJob51DetailResume2, "extractJob51DetailResume");
    function resolveJob51AgeFilterDropdown2(ageBlock) {
      const el = ageBlock;
      const describedNode = (el?.getAttribute?.("aria-describedby") ? el : null) || el?.querySelector("[aria-describedby]");
      const popoverId = describedNode?.getAttribute("aria-describedby")?.trim();
      if (popoverId) {
        const popover = win.document.getElementById(popoverId);
        if (popover) {
          return popover;
        }
      }
      const poppers = Array.from(win.document.querySelectorAll(".base-select-popper"));
      return poppers.find((node) => {
        const text = (node.textContent || "").replace(/\s+/g, "").trim();
        return isElementVisible2(node) && (text.includes("22\u5C81\u53CA\u4EE5\u4E0B") || text.includes("45\u5C81\u53CA\u4EE5\u4E0A") || Boolean(
          node.querySelector(
            'input[placeholder="\u6700\u4F4E"], input[placeholder="\u6700\u9AD8"]'
          )
        ));
      }) || null;
    }
    __name(resolveJob51AgeFilterDropdown2, "resolveJob51AgeFilterDropdown");
    async function ensureJob51AgeCustomRangeInputs2(selectBox, { timeoutMs = 2e3 } = {}) {
      const el = selectBox;
      if (getCurrentSourceKey2() !== SOURCE_KEYS2.JOB51) {
        return el;
      }
      if (el?.querySelector('input[placeholder="\u6700\u4F4E"]') && el?.querySelector('input[placeholder="\u6700\u9AD8"]')) {
        return el;
      }
      const customButton = Array.from(el?.querySelectorAll("button") || []).find(
        (button) => (button.textContent || "").replace(/\s+/g, "").trim() === "\u81EA\u5B9A\u4E49"
      );
      if (!customButton) {
        return el;
      }
      activateElement2(customButton);
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (el?.querySelector('input[placeholder="\u6700\u4F4E"]') && el?.querySelector('input[placeholder="\u6700\u9AD8"]')) {
          return el;
        }
        await new Promise((resolve) => setTimeout(resolve, 120));
      }
      return el;
    }
    __name(ensureJob51AgeCustomRangeInputs2, "ensureJob51AgeCustomRangeInputs");
    async function applyJob51AgeCustomRangeViaVue2(confirmButton, { minAge, maxAge } = {}) {
      if (getCurrentSourceKey2() !== SOURCE_KEYS2.JOB51 || !confirmButton) {
        return false;
      }
      const customRangeVm = findVueParentByName2(
        confirmButton,
        "BaseSelectCustomRange"
      );
      if (!customRangeVm || typeof customRangeVm.onClickOk !== "function") {
        return false;
      }
      try {
        if (!customRangeVm.form || typeof customRangeVm.form !== "object") {
          customRangeVm.form = {};
        }
        customRangeVm.form.leftValue = typeof minAge === "number" ? minAge : null;
        customRangeVm.form.rightValue = typeof maxAge === "number" ? maxAge : null;
        await Promise.resolve(customRangeVm.onClickOk());
        return true;
      } catch (error) {
        console.warn(
          "\u{1F3AF} [Auto Age] Failed to apply 51job age filter via Vue custom-range handler:",
          error
        );
        return false;
      }
    }
    __name(applyJob51AgeCustomRangeViaVue2, "applyJob51AgeCustomRangeViaVue");
    function normalizeAgeRequestValue2(value) {
      if (typeof value === "number" && Number.isFinite(value)) {
        return value;
      }
      if (typeof value === "string") {
        const trimmed = value.trim();
        if (!trimmed) {
          return null;
        }
        const parsed = Number.parseInt(trimmed, 10);
        return Number.isFinite(parsed) ? parsed : null;
      }
      return null;
    }
    __name(normalizeAgeRequestValue2, "normalizeAgeRequestValue");
    function hasMatchingJob51AgeSearchRequest2(minAge, maxAge) {
      const request = apiSnapshot2.job51LastSearchRequest;
      if (!request || typeof request !== "object") {
        return false;
      }
      return normalizeAgeRequestValue2(request.age_from) === normalizeAgeRequestValue2(minAge) && normalizeAgeRequestValue2(request.age_to) === normalizeAgeRequestValue2(maxAge);
    }
    __name(hasMatchingJob51AgeSearchRequest2, "hasMatchingJob51AgeSearchRequest");
    async function waitForJob51AgeFilterRefresh2(previousLastSearchAt, { minAge, maxAge, timeoutMs = 5e3 } = {}) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const hasFreshSearch = typeof apiSnapshot2.lastSearchAt === "string" && apiSnapshot2.lastSearchAt.length > 0 && apiSnapshot2.lastSearchAt !== previousLastSearchAt;
        if (hasFreshSearch && hasMatchingJob51AgeSearchRequest2(minAge, maxAge)) {
          return true;
        }
        await new Promise((resolve) => setTimeout(resolve, 120));
      }
      return false;
    }
    __name(waitForJob51AgeFilterRefresh2, "waitForJob51AgeFilterRefresh");
    return {
      isJob51DetailPage: isJob51DetailPage2,
      isJob51DetailReady: isJob51DetailReady2,
      normalizeJob51AuthContext: normalizeJob51AuthContext2,
      getJob51RawRows: getJob51RawRows2,
      getJob51TotalFromPayload: getJob51TotalFromPayload2,
      isLikelyJob51ResumeRow: isLikelyJob51ResumeRow2,
      getJob51ResumeRows: getJob51ResumeRows2,
      hasJob51SearchSnapshot: hasJob51SearchSnapshot2,
      isJob51EmptySearchPromptVisible: isJob51EmptySearchPromptVisible2,
      isJob51RateLimitedPage: isJob51RateLimitedPage2,
      ensureJob51PageAllowed: ensureJob51PageAllowed2,
      waitForJob51Cooldown: waitForJob51Cooldown2,
      isJob51RateLimitedErrorMessage: isJob51RateLimitedErrorMessage2,
      isJob51RateLimitedPayload: isJob51RateLimitedPayload2,
      isJob51DetailApiErrorPayload: isJob51DetailApiErrorPayload2,
      collectJob51DetailFromBackground: collectJob51DetailFromBackground2,
      fetch51JobResumeDetail: fetch51JobResumeDetail2,
      enrich51JobSearchResumeWithDetail: enrich51JobSearchResumeWithDetail2,
      extract51JobResumes: extract51JobResumes2,
      extractJob51DetailResume: extractJob51DetailResume2,
      resolveJob51AgeFilterDropdown: resolveJob51AgeFilterDropdown2,
      ensureJob51AgeCustomRangeInputs: ensureJob51AgeCustomRangeInputs2,
      applyJob51AgeCustomRangeViaVue: applyJob51AgeCustomRangeViaVue2,
      normalizeAgeRequestValue: normalizeAgeRequestValue2,
      hasMatchingJob51AgeSearchRequest: hasMatchingJob51AgeSearchRequest2,
      waitForJob51AgeFilterRefresh: waitForJob51AgeFilterRefresh2
    };
  }
  __name(createJob51SearchExtractor, "createJob51SearchExtractor");

  // src/lib/extraction-pipeline.ts
  function createExtractionPipeline(deps) {
    const {
      getCurrentSourceKey: getCurrentSourceKey2,
      SOURCE_KEYS: SOURCE_KEYS2,
      apiSnapshot: apiSnapshot2,
      SELECTORS: SELECTORS2,
      getApiSnapshotCount: getApiSnapshotCount2,
      getSeekCurrentCandidateCount: getSeekCurrentCandidateCount2,
      isExtractionReady: isExtractionReady2,
      isJob51RateLimitedPage: isJob51RateLimitedPage2,
      JOB51_RATE_LIMIT_ERROR_MESSAGE: JOB51_RATE_LIMIT_ERROR_MESSAGE2,
      getSeekCandidateIdentity: getSeekCandidateIdentity2,
      chrome: chrome2,
      DEFAULT_COLLECTION_GUARDS: DEFAULT_COLLECTION_GUARDS2,
      CONTENT_SCRIPT_SOURCE: CONTENT_SCRIPT_SOURCE2,
      JOB51_NEXT_PAGE_EVENT: JOB51_NEXT_PAGE_EVENT2,
      document: doc,
      window: win,
      resolveCurrentJob51DetailFetchDelayMs: resolveCurrentJob51DetailFetchDelayMs2,
      JOB51_DETAIL_FETCH_CONCURRENCY: JOB51_DETAIL_FETCH_CONCURRENCY2,
      enrich51JobSearchResumeWithDetail: enrich51JobSearchResumeWithDetail2,
      syncCurrentPageToServer: syncCurrentPageToServer2,
      delay: delay2,
      pipelineState: pipelineState2,
      isJob51DetailPage: isJob51DetailPage2,
      filterCurrentResumesByAgeRange: filterCurrentResumesByAgeRange2,
      extractJob51DetailResume: extractJob51DetailResume2,
      extract51JobResumes: extract51JobResumes2,
      isSeekProfileMode: isSeekProfileMode2,
      hasSeekProfileSnapshot: hasSeekProfileSnapshot2,
      extractSeekProfileResume: extractSeekProfileResume2,
      hasSeekTalentSearchSnapshot: hasSeekTalentSearchSnapshot2,
      extractSeekTalentSearchResumes: extractSeekTalentSearchResumes2,
      hasSeekListSnapshot: hasSeekListSnapshot2,
      extractSeekResumes: extractSeekResumes2,
      isJob5156DetailPage: isJob5156DetailPage2,
      extractJob5156DetailResume: extractJob5156DetailResume2,
      getApiRowForIndex: getApiRowForIndex2,
      extractSingleResume: extractSingleResume2,
      isJob51DetailReady: isJob51DetailReady2,
      getSeekProfileRequest: getSeekProfileRequest2,
      getSeekTalentSearchRequest: getSeekTalentSearchRequest2,
      getSeekRecommendedRequest: getSeekRecommendedRequest2,
      SEEK_PROFILE_TYPE: SEEK_PROFILE_TYPE2,
      getJob5156DetailRoot: getJob5156DetailRoot2,
      getSeekNextPageLinkForMode: getSeekNextPageLinkForMode2,
      getPaginationInfo: getPaginationInfo2,
      asHTMLElement: asHTMLElement2
    } = deps;
    const GUARD_FIELD_NAMES2 = /* @__PURE__ */ new Set([
      "experience",
      "jobIntention",
      "selfIntro",
      "expectedSalary",
      "workHistory",
      "profileEducation",
      "projectExperience",
      "skills",
      "licences"
    ]);
    const GUARD_ARRAY_FIELD_NAMES3 = /* @__PURE__ */ new Set([
      "workHistory",
      "profileEducation",
      "projectExperience",
      "skills",
      "licences"
    ]);
    function getDefaultGuardFields(sourceKey) {
      const guards = DEFAULT_COLLECTION_GUARDS2?.[sourceKey];
      return parseGuardFieldNames2(
        typeof guards === "string" ? guards : ""
      );
    }
    __name(getDefaultGuardFields, "getDefaultGuardFields");
    function applyDefaultGuards(resumes, sourceKey) {
      if (sourceKey !== SOURCE_KEYS2.JOB51 && sourceKey !== SOURCE_KEYS2.JOB5156 && sourceKey !== SOURCE_KEYS2.SEEK) {
        return resumes;
      }
      const guardFields = getDefaultGuardFields(sourceKey);
      if (guardFields.length === 0) return resumes;
      return resumes.map((r) => applyCollectionGuards2(r, guardFields));
    }
    __name(applyDefaultGuards, "applyDefaultGuards");
    async function loadCollectionGuards2() {
      return new Promise((resolve) => {
        chrome2.storage.local.get(
          { collectionGuards: DEFAULT_COLLECTION_GUARDS2 },
          (items) => resolve(items.collectionGuards || {})
        );
      });
    }
    __name(loadCollectionGuards2, "loadCollectionGuards");
    function parseGuardFieldNames2(csv) {
      if (!csv || typeof csv !== "string") return [];
      return Array.from(
        new Set(
          csv.split(",").map((field) => field.trim()).filter((field) => GUARD_FIELD_NAMES2.has(field))
        )
      );
    }
    __name(parseGuardFieldNames2, "parseGuardFieldNames");
    function applyCollectionGuards2(resume, guardFieldNames) {
      if (!resume || typeof resume !== "object" || !Array.isArray(guardFieldNames) || guardFieldNames.length === 0) {
        return resume;
      }
      const guarded = { ...resume };
      for (const field of guardFieldNames) {
        guarded[field] = GUARD_ARRAY_FIELD_NAMES3.has(field) ? [] : "";
      }
      return guarded;
    }
    __name(applyCollectionGuards2, "applyCollectionGuards");
    function isDisabledPaginationControl2(control) {
      if (!control) return true;
      return control.hasAttribute("disabled") || control.classList.contains("disabled") || control.classList.contains("is-disabled") || control.getAttribute("aria-disabled") === "true" || control.getAttribute("aria-hidden") === "true" || control.getAttribute("tabindex") === "-1";
    }
    __name(isDisabledPaginationControl2, "isDisabledPaginationControl");
    function waitForResumeCards2({ timeoutMs = 3e4, minCount = 1 } = {}) {
      return new Promise((resolve, reject) => {
        let done = false;
        const deadline = Date.now() + timeoutMs;
        const check = /* @__PURE__ */ __name(() => {
          if (done) return;
          const count = doc.querySelectorAll(SELECTORS2.resumeCard).length;
          if (count >= minCount) {
            done = true;
            cleanup();
            resolve(count);
          } else if (Date.now() > deadline) {
            done = true;
            cleanup();
            reject(new Error("Timed out waiting for resume cards"));
          }
        }, "check");
        const cleanup = /* @__PURE__ */ __name(() => {
          clearInterval(intervalId);
          observer.disconnect();
        }, "cleanup");
        const intervalId = setInterval(check, 500);
        const observer = new MutationObserver(check);
        observer.observe(doc.body || doc.documentElement, {
          childList: true,
          subtree: true
        });
        check();
      });
    }
    __name(waitForResumeCards2, "waitForResumeCards");
    function waitForApiRows2({ timeoutMs = 15e3, minCount = 1 } = {}) {
      return new Promise((resolve, reject) => {
        let done = false;
        const deadline = Date.now() + timeoutMs;
        const check = /* @__PURE__ */ __name(() => {
          if (done) return;
          if (getCurrentSourceKey2() === SOURCE_KEYS2.JOB51 && isJob51RateLimitedPage2()) {
            done = true;
            cleanup();
            reject(new Error(JOB51_RATE_LIMIT_ERROR_MESSAGE2));
            return;
          }
          const count = getApiSnapshotCount2();
          const seekCandidateCount = getCurrentSourceKey2() === SOURCE_KEYS2.SEEK ? getSeekCurrentCandidateCount2() : 0;
          if (count >= minCount || seekCandidateCount >= minCount || getCurrentSourceKey2() === SOURCE_KEYS2.JOB51 && isExtractionReady2()) {
            done = true;
            cleanup();
            resolve(Math.max(count, seekCandidateCount));
          } else if (Date.now() > deadline) {
            done = true;
            cleanup();
            reject(new Error("Timed out waiting for API rows"));
          }
        }, "check");
        const cleanup = /* @__PURE__ */ __name(() => {
          clearInterval(intervalId);
          observer.disconnect();
        }, "cleanup");
        const intervalId = setInterval(check, 300);
        const observer = new MutationObserver(check);
        observer.observe(doc.body || doc.documentElement, {
          childList: true,
          subtree: true
        });
        check();
      });
    }
    __name(waitForApiRows2, "waitForApiRows");
    async function waitForExtractionData2({ timeoutMs = 3e4, minCount = 1 } = {}) {
      if (getCurrentSourceKey2() === SOURCE_KEYS2.SEEK || getCurrentSourceKey2() === SOURCE_KEYS2.JOB51) {
        return waitForApiRows2({ timeoutMs, minCount });
      }
      const count = await waitForResumeCards2({ timeoutMs, minCount });
      try {
        await waitForApiRows2({ timeoutMs, minCount });
      } catch {
      }
      return count;
    }
    __name(waitForExtractionData2, "waitForExtractionData");
    function clearCapturedResultsForNextPage2() {
      apiSnapshot2.searchRows = null;
      apiSnapshot2.job51SearchRows = null;
      apiSnapshot2.job51DetailPayload = null;
      if (getCurrentSourceKey2() === SOURCE_KEYS2.SEEK) {
        apiSnapshot2.seekRecommendedCandidates = null;
        apiSnapshot2.seekRecommendedRequest = null;
        apiSnapshot2.seekProfile = null;
        apiSnapshot2.seekProfileRequest = null;
        apiSnapshot2.seekTalentSearch = null;
        apiSnapshot2.seekTalentSearchRequest = null;
      }
    }
    __name(clearCapturedResultsForNextPage2, "clearCapturedResultsForNextPage");
    function waitForSeekProfileSnapshot2(profileId, { timeoutMs = 12e3 } = {}) {
      return new Promise((resolve, reject) => {
        let done = false;
        const deadline = Date.now() + timeoutMs;
        const check = /* @__PURE__ */ __name(() => {
          if (done) return;
          const snapshot = unwrapSeekProfileSnapshot(apiSnapshot2.seekProfile);
          if (snapshot && apiSnapshot2.seekProfile !== snapshot) {
            apiSnapshot2.seekProfile = snapshot;
          }
          const identity = snapshot ? getSeekCandidateIdentity2(snapshot) : null;
          const snapshotGuid = typeof snapshot?.profileGuid === "string" ? snapshot.profileGuid : "";
          if (identity?.profileId === String(profileId) || snapshotGuid === String(profileId)) {
            done = true;
            cleanup();
            resolve(snapshot);
            return;
          }
          if (Date.now() > deadline) {
            done = true;
            cleanup();
            reject(new Error(`Timed out waiting for Seek profile ${profileId}`));
          }
        }, "check");
        const cleanup = /* @__PURE__ */ __name(() => {
          clearInterval(intervalId);
          observer.disconnect();
        }, "cleanup");
        const intervalId = setInterval(check, 200);
        const observer = new MutationObserver(check);
        observer.observe(doc.body || doc.documentElement, {
          childList: true,
          subtree: true
        });
        check();
      });
    }
    __name(waitForSeekProfileSnapshot2, "waitForSeekProfileSnapshot");
    function isElementVisible2(element) {
      if (!element) return false;
      const style = win.getComputedStyle(element);
      return style.display !== "none" && style.visibility !== "hidden";
    }
    __name(isElementVisible2, "isElementVisible");
    function extractResumes2() {
      const sourceKey = getCurrentSourceKey2();
      let resumes = [];
      if (isJob51DetailPage2()) {
        resumes = filterCurrentResumesByAgeRange2(extractJob51DetailResume2());
      } else if (sourceKey === SOURCE_KEYS2.JOB51) {
        resumes = filterCurrentResumesByAgeRange2(extract51JobResumes2());
      } else if (sourceKey === SOURCE_KEYS2.SEEK) {
        if (isSeekProfileMode2()) {
          if (hasSeekProfileSnapshot2()) {
            resumes = extractSeekProfileResume2();
          }
        } else if (hasSeekTalentSearchSnapshot2()) {
          resumes = extractSeekTalentSearchResumes2();
        } else {
          resumes = extractSeekResumes2();
        }
      } else if (isJob5156DetailPage2()) {
        resumes = filterCurrentResumesByAgeRange2(extractJob5156DetailResume2());
      } else {
        const cards = doc.querySelectorAll(SELECTORS2.resumeCard);
        cards.forEach((card, index) => {
          try {
            const apiRow = getApiRowForIndex2(index);
            const resume = extractSingleResume2(card, apiRow);
            resume.pageIndex = index + 1;
            if (apiRow) {
              resume.resumeId = apiRow.resumeId ?? "";
              resume.perUserId = apiRow.perUserId ?? "";
            }
            resumes.push(resume);
          } catch (error) {
            console.error(`Error extracting resume ${index}:`, error);
          }
        });
        resumes = filterCurrentResumesByAgeRange2(resumes);
      }
      return applyDefaultGuards(resumes, sourceKey);
    }
    __name(extractResumes2, "extractResumes");
    function extractResumesRaw2(options = {}) {
      const includePage = !!(options && typeof options === "object" && options.includePage);
      if (getCurrentSourceKey2() === SOURCE_KEYS2.SEEK) {
        const seekProfile = isSeekProfileMode2() && hasSeekProfileSnapshot2() ? apiSnapshot2.seekProfile : null;
        const seekProfileIdentity = seekProfile ? getSeekCandidateIdentity2(seekProfile) : null;
        const seekTalentSearchCandidates = !seekProfile && hasSeekTalentSearchSnapshot2() ? apiSnapshot2.seekTalentSearch : null;
        const candidates = seekTalentSearchCandidates || (!seekProfile && hasSeekListSnapshot2() ? apiSnapshot2.seekRecommendedCandidates : []);
        const seekRequest = seekProfile ? getSeekProfileRequest2() : seekTalentSearchCandidates ? getSeekTalentSearchRequest2() : getSeekRecommendedRequest2();
        const cards = seekProfile ? [
          {
            index: 1,
            profileId: seekProfileIdentity?.profileId || "",
            profileType: seekProfileIdentity?.profileType || SEEK_PROFILE_TYPE2,
            text: JSON.stringify(seekProfile, null, 2)
          }
        ] : candidates.map((candidate, index) => {
          const cand = candidate;
          const profileId = seekTalentSearchCandidates ? typeof cand?.profileGuid === "string" && cand.profileGuid ? cand.profileGuid : "" : getSeekCandidateIdentity2(candidate).profileId;
          const profileType = SEEK_PROFILE_TYPE2;
          return {
            index: index + 1,
            profileId,
            profileType,
            text: JSON.stringify(candidate, null, 2)
          };
        });
        if (seekProfile || candidates.length > 0) {
          const payload2 = {
            url: win.location.href,
            extractedAt: (/* @__PURE__ */ new Date()).toISOString(),
            count: cards.length,
            cards,
            api: {
              lastSearchAt: apiSnapshot2.lastSearchAt,
              lastUpdatedAt: apiSnapshot2.lastUpdatedAt,
              searchRowCount: cards.length,
              sourceKey: SOURCE_KEYS2.SEEK,
              operationName: apiSnapshot2.lastOperationName,
              request: seekProfile ? getSeekProfileRequest2() : seekRequest
            }
          };
          if (includePage) {
            payload2.pageHtml = doc.documentElement.outerHTML;
          }
          return payload2;
        }
      }
      if (isJob51DetailPage2() && isJob51DetailReady2()) {
        const detailResumes2 = extractJob51DetailResume2();
        const detailResume = detailResumes2[0];
        const payload2 = {
          url: win.location.href,
          extractedAt: (/* @__PURE__ */ new Date()).toISOString(),
          count: detailResumes2.length,
          cards: [
            {
              index: 1,
              resumeId: detailResume?.resumeId || "",
              perUserId: detailResume?.perUserId || "",
              text: JSON.stringify(
                detailResume?.rawData || apiSnapshot2.job51DetailPayload,
                null,
                2
              )
            }
          ],
          api: {
            lastSearchAt: apiSnapshot2.lastSearchAt,
            lastUpdatedAt: apiSnapshot2.lastUpdatedAt,
            searchRowCount: detailResumes2.length,
            sourceKey: SOURCE_KEYS2.JOB51,
            operationName: apiSnapshot2.lastOperationName,
            request: apiSnapshot2.job51AuthContext,
            payload: apiSnapshot2.job51DetailPayload
          }
        };
        if (includePage) {
          payload2.pageHtml = doc.documentElement.outerHTML;
        }
        return payload2;
      }
      const detailResumes = isJob5156DetailPage2() ? extractJob5156DetailResume2() : [];
      const detailRoot = getJob5156DetailRoot2();
      const detailRootElement = detailRoot instanceof HTMLElement ? detailRoot : null;
      const items = detailResumes.length > 0 ? [
        {
          index: 1,
          resumeId: detailResumes[0]?.resumeId || "",
          perUserId: "",
          html: detailRoot?.outerHTML || "",
          text: detailRootElement?.innerText || detailRoot?.textContent || ""
        }
      ] : Array.from(doc.querySelectorAll(SELECTORS2.resumeCard)).map(
        (card, index) => {
          const el = card;
          const apiRow = getApiRowForIndex2(index);
          return {
            index: index + 1,
            resumeId: apiRow?.resumeId ?? "",
            perUserId: apiRow?.perUserId ?? "",
            html: el.outerHTML,
            text: el.innerText
          };
        }
      );
      const payload = {
        url: win.location.href,
        extractedAt: (/* @__PURE__ */ new Date()).toISOString(),
        count: items.length,
        cards: items,
        api: {
          lastSearchAt: apiSnapshot2.lastSearchAt,
          lastUpdatedAt: apiSnapshot2.lastUpdatedAt,
          searchRowCount: Array.isArray(apiSnapshot2.searchRows) ? apiSnapshot2.searchRows.length : 0
        }
      };
      if (includePage) {
        payload.pageHtml = doc.documentElement.outerHTML;
      }
      return payload;
    }
    __name(extractResumesRaw2, "extractResumesRaw");
    function goToNextPageInternal2() {
      const sourceKey = getCurrentSourceKey2();
      if (sourceKey === SOURCE_KEYS2.SEEK) {
        const nextBtn2 = getSeekNextPageLinkForMode2();
        if (!nextBtn2 || isDisabledPaginationControl2(nextBtn2)) return false;
        nextBtn2.click();
        return true;
      }
      if (sourceKey === SOURCE_KEYS2.JOB51) {
        const pagination = getPaginationInfo2();
        if (!pagination.hasNextPage) return false;
        win.postMessage(
          { source: CONTENT_SCRIPT_SOURCE2, action: JOB51_NEXT_PAGE_EVENT2 },
          "*"
        );
        return true;
      }
      const nextBtn = asHTMLElement2(doc.querySelector(SELECTORS2.nextPageBtn));
      if (!nextBtn || isDisabledPaginationControl2(nextBtn)) return false;
      nextBtn.click();
      return true;
    }
    __name(goToNextPageInternal2, "goToNextPageInternal");
    async function enrich51JobSearchResumesWithDetail2(resumes, options = {}) {
      if (!Array.isArray(resumes) || resumes.length === 0) return [];
      const extractedAt = (/* @__PURE__ */ new Date()).toISOString();
      const interBatchDelayMs = typeof options.interBatchDelayMs === "number" && Number.isFinite(options.interBatchDelayMs) ? options.interBatchDelayMs : resolveCurrentJob51DetailFetchDelayMs2();
      const shouldContinue = typeof options.shouldContinue === "function" ? options.shouldContinue : () => true;
      const enriched = [];
      let enrichedCount = 0;
      let rateLimited = false;
      for (let start = 0; start < resumes.length; start += JOB51_DETAIL_FETCH_CONCURRENCY2) {
        if (!shouldContinue() || rateLimited) {
          break;
        }
        const batch = resumes.slice(
          start,
          start + JOB51_DETAIL_FETCH_CONCURRENCY2
        );
        const batchResults = await Promise.all(
          batch.map(
            (resume) => enrich51JobSearchResumeWithDetail2(resume, extractedAt)
          )
        );
        for (const result of batchResults) {
          if (result?.resume) {
            enriched.push(result.resume);
          }
          if (result?.enriched) {
            enrichedCount += 1;
          }
          if (result?.rateLimited) {
            rateLimited = true;
          }
        }
        console.log(
          `51job detail enrichment: ${Math.min(start + batch.length, resumes.length)}/${resumes.length} (${enrichedCount} enriched)`
        );
        if (rateLimited || !shouldContinue()) {
          break;
        }
        if (start + JOB51_DETAIL_FETCH_CONCURRENCY2 < resumes.length) {
          await delay2(interBatchDelayMs);
        }
      }
      return enriched;
    }
    __name(enrich51JobSearchResumesWithDetail2, "enrich51JobSearchResumesWithDetail");
    function queueJob51DetailBackfill2(resumes, context = {}) {
      if (!Array.isArray(resumes) || resumes.length === 0) {
        return Promise.resolve(null);
      }
      const runId = typeof context.runId === "number" && Number.isFinite(context.runId) ? context.runId : null;
      const isCancelled = /* @__PURE__ */ __name(() => runId !== null && runId !== pipelineState2.runId, "isCancelled");
      const task = /* @__PURE__ */ __name(async () => {
        const detailFetchDelayMs = resolveCurrentJob51DetailFetchDelayMs2();
        if (isCancelled()) {
          console.log("51job detail backfill skipped", {
            count: resumes.length,
            currentPage: context.currentPage,
            totalPages: context.totalPages
          });
          return null;
        }
        console.log("51job detail backfill queued", {
          count: resumes.length,
          currentPage: context.currentPage,
          totalPages: context.totalPages,
          delayMs: detailFetchDelayMs,
          concurrency: JOB51_DETAIL_FETCH_CONCURRENCY2
        });
        const enrichedResumes = await enrich51JobSearchResumesWithDetail2(resumes, {
          interBatchDelayMs: detailFetchDelayMs,
          shouldContinue: /* @__PURE__ */ __name(() => !isCancelled(), "shouldContinue")
        });
        if (!Array.isArray(enrichedResumes) || enrichedResumes.length === 0) {
          return null;
        }
        if (isCancelled()) {
          console.log("51job detail backfill cancelled", {
            count: resumes.length,
            currentPage: context.currentPage,
            totalPages: context.totalPages
          });
          return null;
        }
        const response = await syncCurrentPageToServer2(enrichedResumes);
        if (!response?.success) {
          throw response?.error || response || "51job detail backfill failed";
        }
        console.log("51job detail backfill synced", {
          submitted: typeof response.submitted === "number" ? response.submitted : enrichedResumes.length,
          inserted: typeof response.inserted === "number" ? response.inserted : 0,
          updated: typeof response.updated === "number" ? response.updated : 0,
          currentPage: context.currentPage,
          totalPages: context.totalPages
        });
        return response;
      }, "task");
      const scheduled = pipelineState2.chain.catch(() => null).then(task);
      pipelineState2.chain = scheduled.catch((error) => {
        console.warn("51job detail backfill failed:", error);
        return null;
      });
      return scheduled;
    }
    __name(queueJob51DetailBackfill2, "queueJob51DetailBackfill");
    return {
      loadCollectionGuards: loadCollectionGuards2,
      parseGuardFieldNames: parseGuardFieldNames2,
      applyCollectionGuards: applyCollectionGuards2,
      isDisabledPaginationControl: isDisabledPaginationControl2,
      waitForResumeCards: waitForResumeCards2,
      waitForApiRows: waitForApiRows2,
      waitForExtractionData: waitForExtractionData2,
      clearCapturedResultsForNextPage: clearCapturedResultsForNextPage2,
      waitForSeekProfileSnapshot: waitForSeekProfileSnapshot2,
      isElementVisible: isElementVisible2,
      extractResumes: extractResumes2,
      extractResumesRaw: extractResumesRaw2,
      goToNextPageInternal: goToNextPageInternal2,
      enrich51JobSearchResumesWithDetail: enrich51JobSearchResumesWithDetail2,
      queueJob51DetailBackfill: queueJob51DetailBackfill2
    };
  }
  __name(createExtractionPipeline, "createExtractionPipeline");

  // src/lib/snapshot-collector.ts
  function createSnapshotCollector(deps) {
    const {
      apiSnapshot: apiSnapshot2,
      getCurrentSourceKey: getCurrentSourceKey2,
      SOURCE_KEYS: SOURCE_KEYS2,
      isJob51DetailPage: isJob51DetailPage2,
      isJob51DetailReady: isJob51DetailReady2,
      getSeekSnapshotCount: getSeekSnapshotCount2,
      normalizeJob51AuthContext: normalizeJob51AuthContext2,
      getJob51TotalFromPayload: getJob51TotalFromPayload2,
      getJob51ResumeRows: getJob51ResumeRows2,
      getSeekPayloadData: getSeekPayloadData2,
      chrome: chrome2,
      normalizeCollectionLimit: normalizeCollectionLimit2,
      pipelineState: pipelineState2,
      waitForExtractionData: waitForExtractionData2,
      isSeekProfileMode: isSeekProfileMode2,
      resolveSeekAutoSyncPageWindow: resolveSeekAutoSyncPageWindow2,
      getSeekRequestedPageSize: getSeekRequestedPageSize2,
      getSeekCurrentCandidateCount: getSeekCurrentCandidateCount2,
      resolveSeekAutoSyncCurrentPageSelection: resolveSeekAutoSyncCurrentPageSelection2,
      extractResumes: extractResumes2,
      enrich51JobSearchResumesWithDetail: enrich51JobSearchResumesWithDetail2,
      enrichJob5156SearchResumesWithDetail: enrichJob5156SearchResumesWithDetail2,
      isJob5156DetailPage: isJob5156DetailPage2,
      enrichSeekResumesWithDetail: enrichSeekResumesWithDetail2,
      getPaginationInfo: getPaginationInfo2,
      isSeekAutoSyncPageWindowReached: isSeekAutoSyncPageWindowReached2,
      shouldStopSeekAutoSyncForPageWindow: shouldStopSeekAutoSyncForPageWindow2,
      waitForPagination: waitForPagination2,
      clearCapturedResultsForNextPage: clearCapturedResultsForNextPage2,
      goToNextPageInternal: goToNextPageInternal2,
      waitForPageTransition: waitForPageTransition2,
      buildSubmitMetadata: buildSubmitMetadata2,
      delay: delay2,
      document: doc,
      loadCollectionGuards: loadCollectionGuards2,
      parseGuardFieldNames: parseGuardFieldNames2,
      applyCollectionGuards: applyCollectionGuards2
    } = deps;
    function getApiSnapshotCount2() {
      if (Array.isArray(apiSnapshot2.searchRows)) {
        return apiSnapshot2.searchRows.length;
      }
      if (getCurrentSourceKey2() === SOURCE_KEYS2.JOB51) {
        if (isJob51DetailPage2()) {
          return isJob51DetailReady2() ? 1 : 0;
        }
        return Array.isArray(apiSnapshot2.job51SearchRows) ? apiSnapshot2.job51SearchRows.length : 0;
      }
      if (getCurrentSourceKey2() === SOURCE_KEYS2.SEEK) {
        return getSeekSnapshotCount2();
      }
      return 0;
    }
    __name(getApiSnapshotCount2, "getApiSnapshotCount");
    function normalizeSnapshotCollectOptions2(options = {}) {
      const normalizedOptions = typeof options === "object" && options ? options : {};
      return {
        limit: normalizeCollectionLimit2(normalizedOptions.limit),
        maxPages: normalizeCollectionLimit2(normalizedOptions.maxPages),
        allowEmpty: !!normalizedOptions.allowEmpty
      };
    }
    __name(normalizeSnapshotCollectOptions2, "normalizeSnapshotCollectOptions");
    function installApiHook2() {
      try {
        if (doc.documentElement.hasAttribute("data-tr-page-hook")) {
          doc.documentElement.setAttribute("data-tr-resume-hook", "true");
          return;
        }
        if (doc.documentElement.hasAttribute("data-tr-resume-hook")) return;
        const script = doc.createElement("script");
        script.src = chrome2.runtime.getURL("page-hook.js");
        script.async = false;
        script.setAttribute("data-tr-resume-hook", "true");
        script.onload = () => script.remove();
        const mountTarget = doc.head || doc.documentElement;
        mountTarget.prepend(script);
        doc.documentElement.setAttribute("data-tr-resume-hook", "true");
      } catch (error) {
        console.warn("Failed to install API hook:", error);
      }
    }
    __name(installApiHook2, "installApiHook");
    function setApiRowsAttribute() {
      try {
        doc.documentElement.setAttribute(
          "data-tr-api-rows",
          String(getApiSnapshotCount2())
        );
      } catch {
      }
    }
    __name(setApiRowsAttribute, "setApiRowsAttribute");
    function mergeJob51AuthContext(requestHeaders, request) {
      const authContext = normalizeJob51AuthContext2(requestHeaders, request);
      if (authContext) {
        apiSnapshot2.job51AuthContext = {
          ...apiSnapshot2.job51AuthContext || {},
          ...authContext
        };
      }
    }
    __name(mergeJob51AuthContext, "mergeJob51AuthContext");
    function updateApiSnapshot2(message) {
      const {
        kind,
        payload,
        url,
        sourceKey,
        operationName,
        request,
        requestHeaders
      } = message;
      const p = payload ?? {};
      const pd = p.data ?? {};
      apiSnapshot2.lastUpdatedAt = (/* @__PURE__ */ new Date()).toISOString();
      if (url) apiSnapshot2.lastUrl = url;
      apiSnapshot2.lastSourceKey = sourceKey || null;
      apiSnapshot2.lastOperationName = operationName || null;
      try {
        doc.documentElement.setAttribute("data-tr-api-last", kind);
        doc.documentElement.setAttribute(
          "data-tr-api-updated",
          apiSnapshot2.lastUpdatedAt
        );
        if (sourceKey) {
          doc.documentElement.setAttribute("data-tr-source-key", sourceKey);
        }
      } catch {
      }
      if (kind === "search") {
        const rows = (pd.resumePage ?? {})?.rows;
        if (Array.isArray(rows)) {
          apiSnapshot2.searchRows = rows;
          apiSnapshot2.lastSearchAt = apiSnapshot2.lastUpdatedAt;
          setApiRowsAttribute();
        }
        return;
      }
      if (kind === "job51search") {
        apiSnapshot2.job51LastSearchRequest = request && typeof request === "object" ? request : null;
        mergeJob51AuthContext(requestHeaders, request);
        const total = getJob51TotalFromPayload2(payload);
        if (typeof total === "number") {
          apiSnapshot2.job51Total = total;
        }
        const rows = getJob51ResumeRows2(payload);
        const hasResultPayload = Array.isArray(rows) || typeof total === "number";
        if (hasResultPayload) {
          apiSnapshot2.job51SearchRows = Array.isArray(rows) ? rows : [];
          apiSnapshot2.lastSearchAt = apiSnapshot2.lastUpdatedAt;
          setApiRowsAttribute();
        }
        return;
      }
      if (kind === "job51detail") {
        mergeJob51AuthContext(requestHeaders, request);
        apiSnapshot2.job51DetailPayload = payload || null;
        setApiRowsAttribute();
        return;
      }
      if (kind === "attach") {
        apiSnapshot2.attachInfo = pd.attachResumeInfo || null;
        return;
      }
      if (kind === "chat") {
        apiSnapshot2.chatInfo = pd.chatInfo || null;
        return;
      }
      if (kind === "insight") {
        apiSnapshot2.insightInfo = pd.talentInsightInfo || p.data || null;
        return;
      }
      if (kind === "seekTalentSearch") {
        const data = getSeekPayloadData2(payload, kind);
        const tsResult = data?.talentSearchProfilesNaturalLanguageSearch;
        const result = tsResult?.result;
        const edges = Array.isArray(result?.edges) ? result.edges : null;
        if (edges) {
          const nodes = edges.map((edge) => edge?.node).filter((node) => node && typeof node === "object");
          apiSnapshot2.seekTalentSearch = nodes;
          apiSnapshot2.seekTalentSearchRequest = request || null;
          apiSnapshot2.lastSearchAt = apiSnapshot2.lastUpdatedAt;
          setApiRowsAttribute();
        }
        return;
      }
      if (kind === "seekRecommendedCandidates") {
        const data = getSeekPayloadData2(payload, kind);
        const v2 = data?.talentSearchRecommendedCandidatesV2;
        const legacy = data?.getTalentSearchRecommendedCandidates;
        const candidates = v2?.items || legacy?.candidates;
        if (Array.isArray(candidates)) {
          apiSnapshot2.seekRecommendedCandidates = candidates;
          apiSnapshot2.seekRecommendedRequest = request || null;
          apiSnapshot2.lastSearchAt = apiSnapshot2.lastUpdatedAt;
          setApiRowsAttribute();
        }
        return;
      }
      if (kind === "seekProfile") {
        const data = getSeekPayloadData2(payload, kind);
        const rawProfile = data?.talentSearchProfileV2 || data?.talentSearchProfileCompleteV2 || data?.getTalentSearchProfileCompleteV2 || data?.talentSearchProfileV3 || data || null;
        apiSnapshot2.seekProfile = unwrapSeekProfileSnapshot(rawProfile);
        apiSnapshot2.seekProfileRequest = request || apiSnapshot2.seekProfileRequest || apiSnapshot2.seekRecommendedRequest || null;
        setApiRowsAttribute();
        return;
      }
    }
    __name(updateApiSnapshot2, "updateApiSnapshot");
    async function applySourceCollectionGuards(resumes, sourceKey) {
      if (!Array.isArray(resumes) || resumes.length === 0) return resumes;
      if (sourceKey !== SOURCE_KEYS2.JOB51 && sourceKey !== SOURCE_KEYS2.JOB5156 && sourceKey !== SOURCE_KEYS2.SEEK) {
        return resumes;
      }
      const collectionGuards = await loadCollectionGuards2();
      const guards = collectionGuards && typeof collectionGuards === "object" ? collectionGuards[sourceKey] : void 0;
      const guardFields = parseGuardFieldNames2(typeof guards === "string" ? guards : "");
      if (guardFields.length === 0) return resumes;
      return resumes.map((resume) => applyCollectionGuards2(resume, guardFields));
    }
    __name(applySourceCollectionGuards, "applySourceCollectionGuards");
    async function collectSnapshotPayload2(options = {}) {
      const { limit, maxPages, allowEmpty } = normalizeSnapshotCollectOptions2(options);
      const sourceKey = getCurrentSourceKey2();
      const job51BackfillRunId = sourceKey === SOURCE_KEYS2.JOB51 ? pipelineState2.runId + 1 : null;
      if (sourceKey === SOURCE_KEYS2.JOB51) {
        pipelineState2.runId = job51BackfillRunId;
        pipelineState2.chain = Promise.resolve();
      }
      if (sourceKey !== SOURCE_KEYS2.JOB5156 && sourceKey !== SOURCE_KEYS2.JOB51 && sourceKey !== SOURCE_KEYS2.SEEK) {
        throw new Error(`Unsupported source for snapshot collection: ${sourceKey}`);
      }
      let collectedResumes = [];
      let pagesVisited = 0;
      let stopReason = "completed";
      let seekStartPage = null;
      let lastPageResumeCount = 0;
      let finalPagination;
      while (true) {
        finalPagination = getPaginationInfo2();
        const currentPage = finalPagination.currentPage;
        const isSeekListPage = sourceKey === SOURCE_KEYS2.SEEK && !isSeekProfileMode2();
        if (isSeekListPage && seekStartPage === null) {
          seekStartPage = currentPage;
        }
        await waitForExtractionData2({});
        pagesVisited += 1;
        const seekPageWindow = isSeekListPage ? resolveSeekAutoSyncPageWindow2({
          startPage: seekStartPage || currentPage,
          limit,
          maxPages,
          requestedPageSize: getSeekRequestedPageSize2(),
          currentPageCandidateCount: getSeekCurrentCandidateCount2()
        }) : null;
        const pageSelection = isSeekListPage ? resolveSeekAutoSyncCurrentPageSelection2({
          limit,
          totalSubmitted: collectedResumes.length,
          currentPageResumeCount: getSeekCurrentCandidateCount2()
        }) : {
          remainingCapacity: limit > 0 ? Math.max(limit - collectedResumes.length, 0) : null,
          selectedCount: null,
          hitLimitWithinPage: false,
          limitAlreadyReached: limit > 0 ? Math.max(limit - collectedResumes.length, 0) <= 0 : false
        };
        if (pageSelection.limitAlreadyReached) {
          stopReason = "limit-reached";
          break;
        }
        let pageResumes = extractResumes2();
        const hitLimitWithinPage = isSeekListPage ? pageSelection.hitLimitWithinPage : limit > 0 && typeof pageSelection.remainingCapacity === "number" && pageResumes.length > pageSelection.remainingCapacity;
        if (isSeekListPage && typeof pageSelection.selectedCount === "number") {
          pageResumes = pageResumes.slice(0, pageSelection.selectedCount);
        } else if (limit > 0 && typeof pageSelection.remainingCapacity === "number" && pageResumes.length > pageSelection.remainingCapacity) {
          pageResumes = pageResumes.slice(0, pageSelection.remainingCapacity);
        }
        if (sourceKey === SOURCE_KEYS2.JOB51 && !isJob51DetailPage2() && pageResumes.length > 0) {
          pageResumes = await enrich51JobSearchResumesWithDetail2(pageResumes);
        }
        if (sourceKey === SOURCE_KEYS2.JOB5156 && !isJob5156DetailPage2() && pageResumes.length > 0) {
          pageResumes = await enrichJob5156SearchResumesWithDetail2(pageResumes);
        }
        if (sourceKey === SOURCE_KEYS2.SEEK && !isSeekProfileMode2() && pageResumes.length > 0) {
          pageResumes = await enrichSeekResumesWithDetail2(pageResumes);
        }
        pageResumes = await applySourceCollectionGuards(pageResumes, sourceKey);
        lastPageResumeCount = pageResumes.length;
        if (pageResumes.length > 0) {
          collectedResumes.push(...pageResumes);
        }
        finalPagination = getPaginationInfo2();
        if (isSeekListPage && hitLimitWithinPage) {
          stopReason = "limit-reached";
          break;
        }
        if (limit > 0 && collectedResumes.length >= limit) {
          stopReason = "limit-reached";
          break;
        }
        if (isSeekListPage && shouldStopSeekAutoSyncForPageWindow2({
          pageWindowReached: isSeekAutoSyncPageWindowReached2(seekPageWindow, currentPage),
          limit,
          totalSubmitted: collectedResumes.length
        })) {
          stopReason = "page-window-reached";
          break;
        }
        if (maxPages > 0 && pagesVisited >= maxPages) {
          stopReason = "max-pages-reached";
          break;
        }
        if (!finalPagination.hasNextPage || finalPagination.currentPage >= finalPagination.totalPages) {
          stopReason = "no-next-page";
          break;
        }
        try {
          await waitForPagination2({ timeoutMs: 8e3 });
        } catch {
        }
        const nextPage = finalPagination.currentPage + 1;
        clearCapturedResultsForNextPage2();
        const moved = goToNextPageInternal2();
        if (!moved) {
          stopReason = "no-next-page";
          break;
        }
        await waitForPageTransition2({ expectedPage: nextPage, timeoutMs: 15e3 });
        await delay2(500);
      }
      if (collectedResumes.length <= 0 && !allowEmpty) {
        throw new Error(
          "No resumes extracted. Ensure you are logged in and results are loaded."
        );
      }
      const metadata = buildSubmitMetadata2();
      metadata.generatedAt = (/* @__PURE__ */ new Date()).toISOString();
      metadata.totalPages = pagesVisited;
      metadata.totalResumes = collectedResumes.length;
      return {
        metadata,
        resumes: collectedResumes,
        summary: {
          sourceKey,
          sourceHost: metadata.sourceHost,
          count: collectedResumes.length,
          pagesVisited,
          stopReason,
          lastPageResumeCount,
          limit: limit > 0 ? limit : null,
          maxPages: maxPages > 0 ? maxPages : null,
          pagination: finalPagination
        }
      };
    }
    __name(collectSnapshotPayload2, "collectSnapshotPayload");
    return {
      getApiSnapshotCount: getApiSnapshotCount2,
      updateApiSnapshot: updateApiSnapshot2,
      installApiHook: installApiHook2,
      normalizeSnapshotCollectOptions: normalizeSnapshotCollectOptions2,
      collectSnapshotPayload: collectSnapshotPayload2
    };
  }
  __name(createSnapshotCollector, "createSnapshotCollector");

  // src/lib/auto-actions.ts
  function createAutoActions(deps) {
    const {
      activateElement: activateElement2,
      fireMouseEvent: fireMouseEvent2,
      setInputValue: setInputValue2,
      apiSnapshot: apiSnapshot2,
      getCurrentSourceKey: getCurrentSourceKey2,
      getCurrentAgeRange: getCurrentAgeRange2,
      SOURCE_KEYS: SOURCE_KEYS2,
      isElementVisible: isElementVisible2,
      resolveJob51AgeFilterDropdown: resolveJob51AgeFilterDropdown2,
      ensureJob51AgeCustomRangeInputs: ensureJob51AgeCustomRangeInputs2,
      applyJob51AgeCustomRangeViaVue: applyJob51AgeCustomRangeViaVue2,
      waitForJob51AgeFilterRefresh: waitForJob51AgeFilterRefresh2,
      waitForExtractionData: waitForExtractionData2,
      asHTMLElement: asHTMLElement2,
      SELECTORS: SELECTORS2,
      AUTO_LOCATION_PARAM: AUTO_LOCATION_PARAM2,
      AUTO_SEARCH_PARAM: AUTO_SEARCH_PARAM2,
      AUTO_KEYWORD_MODE_PARAM: AUTO_KEYWORD_MODE_PARAM2,
      KEYWORD_MODE_SPACED: KEYWORD_MODE_SPACED2,
      normalizeKeyword: normalizeKeyword2,
      normalizeKeywordMode: normalizeKeywordMode2,
      getKeywordMode: getKeywordMode2,
      normalizeSeekLocationLabel: normalizeSeekLocationLabel2,
      hasJob51SearchSnapshot: hasJob51SearchSnapshot2,
      isJob51EmptySearchPromptVisible: isJob51EmptySearchPromptVisible2,
      parseAutoLocationValues: parseAutoLocationValues2,
      extractResumes: extractResumes2,
      extractResumesRaw: extractResumesRaw2,
      isJob51DetailPage: isJob51DetailPage2,
      isJob5156DetailPage: isJob5156DetailPage2,
      isSeekProfileMode: isSeekProfileMode2,
      enrich51JobSearchResumesWithDetail: enrich51JobSearchResumesWithDetail2,
      enrichJob5156SearchResumesWithDetail: enrichJob5156SearchResumesWithDetail2,
      enrichSeekResumesWithDetail: enrichSeekResumesWithDetail2,
      buildSubmitMetadata: buildSubmitMetadata2,
      AUTO_EXPORT_PARAM: AUTO_EXPORT_PARAM2,
      AUTO_SYNC_PARAM: AUTO_SYNC_PARAM2,
      buildExportMetadata: buildExportMetadata2,
      buildExportFilename: buildExportFilename2,
      document: doc,
      window: win,
      loadCollectionGuards: loadCollectionGuards2,
      parseGuardFieldNames: parseGuardFieldNames2,
      applyCollectionGuards: applyCollectionGuards2
    } = deps;
    function setAutoAgeAttributes2(status, minAge, maxAge) {
      try {
        doc.documentElement.setAttribute("data-tr-auto-age", status);
        const normalizedMin = typeof minAge === "number" && Number.isFinite(minAge) ? Math.trunc(minAge) : null;
        const normalizedMax = typeof maxAge === "number" && Number.isFinite(maxAge) ? Math.trunc(maxAge) : null;
        if (normalizedMin !== null || normalizedMax !== null) {
          doc.documentElement.setAttribute(
            "data-tr-age-range",
            `${normalizedMin !== null ? normalizedMin : ""}-${normalizedMax !== null ? normalizedMax : ""}`
          );
        } else {
          doc.documentElement.removeAttribute("data-tr-age-range");
        }
      } catch (e) {
        console.warn("[tr-auto-actions]", "setAutoAgeAttributes: DOM attribute set failed", e?.message || e);
      }
    }
    __name(setAutoAgeAttributes2, "setAutoAgeAttributes");
    function findAgeFilterBlock2() {
      if (getCurrentSourceKey2() === SOURCE_KEYS2.JOB51) {
        const labels = doc.querySelectorAll(".base-select-label");
        const label2 = Array.from(labels).find(
          (node) => (node.textContent || "").replace(/\s+/g, "").trim() === "\u5E74\u9F84"
        );
        if (label2) {
          return label2.closest(".el-popover__reference") || label2.closest(".base-select-button") || label2.closest(".el-popover__reference-wrapper");
        }
      }
      const titles = doc.querySelectorAll(".base-input-block__title__text");
      const label = Array.from(titles).find(
        (node) => (node.textContent || "").replace(/\s+/g, "").trim() === "\u5E74\u9F84"
      );
      return label ? label.closest(".base-input-block") : null;
    }
    __name(findAgeFilterBlock2, "findAgeFilterBlock");
    function openAgeFilterDropdown2(ageBlock) {
      if (getCurrentSourceKey2() === SOURCE_KEYS2.JOB51) {
        const trigger = ageBlock.querySelector(".base-select-button") || (ageBlock.matches?.(".base-select-button") ? ageBlock : null) || ageBlock;
        activateElement2(trigger);
        return;
      }
      const title = ageBlock.querySelector(".base-input-block__title") || ageBlock;
      ["mouseenter", "mouseover", "mousedown", "mouseup", "click"].forEach(
        (type) => fireMouseEvent2(title, type)
      );
    }
    __name(openAgeFilterDropdown2, "openAgeFilterDropdown");
    function resolveAgeSelectBox2(ageBlock) {
      return getCurrentSourceKey2() === SOURCE_KEYS2.JOB51 ? resolveJob51AgeFilterDropdown2(ageBlock) : ageBlock.querySelector(".base-input-block__select_box");
    }
    __name(resolveAgeSelectBox2, "resolveAgeSelectBox");
    async function waitForAgeFilterDropdown2(ageBlock, { timeoutMs = 4e3 } = {}) {
      const timeout = typeof timeoutMs === "number" ? timeoutMs : 4e3;
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        const selectBox = resolveAgeSelectBox2(ageBlock);
        if (selectBox && isElementVisible2(selectBox)) {
          return selectBox;
        }
        openAgeFilterDropdown2(ageBlock);
        await new Promise((resolve) => setTimeout(resolve, 120));
      }
      const finalSelectBox = resolveAgeSelectBox2(ageBlock);
      return finalSelectBox && isElementVisible2(finalSelectBox) ? finalSelectBox : null;
    }
    __name(waitForAgeFilterDropdown2, "waitForAgeFilterDropdown");
    function resolveAgeFilterActions2(selectBox) {
      const minInput = selectBox.querySelector('input[placeholder="\u6700\u4F4E"]');
      const maxInput = selectBox.querySelector('input[placeholder="\u6700\u9AD8"]');
      const buttons = Array.from(selectBox.querySelectorAll("button"));
      const confirmButton = buttons.find((button) => {
        const text = button.textContent || "";
        return text.replace(/\s+/g, "").trim() === "\u786E\u5B9A" || text.replace(/\s+/g, "").trim() === "\u78BA\u5B9A";
      });
      const cancelButton = buttons.find((button) => {
        const text = (button.textContent || "").replace(/\s+/g, "").trim();
        return text === "\u53D6\u6D88";
      });
      return { minInput, maxInput, confirmButton, cancelButton };
    }
    __name(resolveAgeFilterActions2, "resolveAgeFilterActions");
    async function autoApplyAgeFilterFromUrl2() {
      const sourceKey = getCurrentSourceKey2();
      const range = getCurrentAgeRange2();
      if (!range.enabled) {
        setAutoAgeAttributes2("skipped");
        return;
      }
      const minAge = range.minAge;
      const maxAge = range.maxAge;
      if (typeof minAge === "number" && typeof maxAge === "number" && minAge > maxAge) {
        setAutoAgeAttributes2("failed", minAge, maxAge);
        console.warn("\u{1F3AF} [Auto Age] Invalid age range (minAge > maxAge):", {
          minAge,
          maxAge
        });
        return;
      }
      if (sourceKey === SOURCE_KEYS2.JOB51 && (typeof minAge !== "number" || typeof maxAge !== "number")) {
        setAutoAgeAttributes2("failed", minAge, maxAge);
        console.warn(
          "\u{1F3AF} [Auto Age] 51job native age filter requires both min and max ages.",
          { minAge, maxAge }
        );
        return;
      }
      const ageBlock = findAgeFilterBlock2();
      if (!ageBlock) {
        if (sourceKey === SOURCE_KEYS2.JOB51) {
          setAutoAgeAttributes2("failed", minAge, maxAge);
          console.warn(
            "\u{1F3AF} [Auto Age] 51job age filter control not found."
          );
          return;
        }
        setAutoAgeAttributes2("failed", minAge, maxAge);
        console.warn(
          "\u{1F3AF} [Auto Age] Age filter control not found; skipping native age filter apply."
        );
        return;
      }
      const selectBox = await waitForAgeFilterDropdown2(ageBlock, {
        timeoutMs: 5e3
      });
      if (!selectBox) {
        if (sourceKey === SOURCE_KEYS2.JOB51) {
          setAutoAgeAttributes2("failed", minAge, maxAge);
          console.warn(
            "\u{1F3AF} [Auto Age] 51job age filter dropdown did not open."
          );
          return;
        }
        setAutoAgeAttributes2("failed", minAge, maxAge);
        console.warn("\u{1F3AF} [Auto Age] Failed to open age filter dropdown.");
        return;
      }
      if (sourceKey === SOURCE_KEYS2.JOB51) {
        await ensureJob51AgeCustomRangeInputs2(selectBox, {
          timeoutMs: 2500
        });
      }
      const { minInput, maxInput, confirmButton, cancelButton } = resolveAgeFilterActions2(selectBox);
      if (!minInput || !maxInput || !confirmButton) {
        if (sourceKey === SOURCE_KEYS2.JOB51) {
          setAutoAgeAttributes2("failed", minAge, maxAge);
          if (cancelButton) {
            activateElement2(cancelButton);
          }
          console.warn(
            "\u{1F3AF} [Auto Age] 51job age filter inputs/buttons not found."
          );
          return;
        }
        setAutoAgeAttributes2("failed", minAge, maxAge);
        if (cancelButton) {
          activateElement2(cancelButton);
        }
        console.warn(
          "\u{1F3AF} [Auto Age] Age filter inputs/buttons not found; skipping native age filter apply."
        );
        return;
      }
      setInputValue2(minInput, typeof minAge === "number" ? String(minAge) : "");
      setInputValue2(maxInput, typeof maxAge === "number" ? String(maxAge) : "");
      const previousLastSearchAt = apiSnapshot2.lastSearchAt;
      const appliedViaVue = sourceKey === SOURCE_KEYS2.JOB51 ? await applyJob51AgeCustomRangeViaVue2(confirmButton, {
        minAge,
        maxAge
      }) : false;
      if (!appliedViaVue) {
        activateElement2(confirmButton);
      }
      try {
        if (sourceKey === SOURCE_KEYS2.JOB51) {
          const refreshed = await waitForJob51AgeFilterRefresh2(previousLastSearchAt, {
            minAge,
            maxAge,
            timeoutMs: 5e3
          });
          if (!refreshed) {
            setAutoAgeAttributes2("failed", minAge, maxAge);
            console.warn(
              "\u{1F3AF} [Auto Age] Applied 51job age filter, but no filtered search refresh was observed.",
              { minAge, maxAge }
            );
            return;
          }
        } else {
          await waitForExtractionData2({ timeoutMs: 15e3 });
        }
      } catch (error) {
        console.warn(
          "\u{1F3AF} [Auto Age] Applied age filter, but waiting for results timed out:",
          error
        );
      }
      setAutoAgeAttributes2("done", minAge, maxAge);
    }
    __name(autoApplyAgeFilterFromUrl2, "autoApplyAgeFilterFromUrl");
    const PROVINCE_TOKENS2 = /* @__PURE__ */ new Set([
      "\u5317\u4EAC",
      "\u5929\u6D25",
      "\u4E0A\u6D77",
      "\u91CD\u5E86",
      "\u6CB3\u5317",
      "\u5C71\u897F",
      "\u8FBD\u5B81",
      "\u5409\u6797",
      "\u9ED1\u9F99\u6C5F",
      "\u6C5F\u82CF",
      "\u6D59\u6C5F",
      "\u5B89\u5FBD",
      "\u798F\u5EFA",
      "\u6C5F\u897F",
      "\u5C71\u4E1C",
      "\u6CB3\u5357",
      "\u6E56\u5317",
      "\u6E56\u5357",
      "\u5E7F\u4E1C",
      "\u6D77\u5357",
      "\u56DB\u5DDD",
      "\u8D35\u5DDE",
      "\u4E91\u5357",
      "\u9655\u897F",
      "\u7518\u8083",
      "\u9752\u6D77",
      "\u53F0\u6E7E",
      "\u5185\u8499\u53E4",
      "\u5E7F\u897F",
      "\u897F\u85CF",
      "\u5B81\u590F",
      "\u65B0\u7586",
      "\u9999\u6E2F",
      "\u6FB3\u95E8"
    ]);
    function normalizeProvinceToken2(value) {
      if (!value) return "";
      return value.trim().replace(/特别行政区$/g, "").replace(/壮族自治区$/g, "").replace(/回族自治区$/g, "").replace(/维吾尔自治区$/g, "").replace(/自治区$/g, "").replace(/省$/g, "").replace(/市$/g, "");
    }
    __name(normalizeProvinceToken2, "normalizeProvinceToken");
    function isProvinceToken(value) {
      const normalized = normalizeProvinceToken2(value);
      return normalized ? PROVINCE_TOKENS2.has(normalized) : false;
    }
    __name(isProvinceToken, "isProvinceToken");
    function waitForSearchElements({ timeoutMs = 8e3 } = {}) {
      const timeout = typeof timeoutMs === "number" ? timeoutMs : 8e3;
      return new Promise((resolve, reject) => {
        let done = false;
        const deadline = Date.now() + timeout;
        const check = /* @__PURE__ */ __name(() => {
          if (done) return;
          const sourceKey = getCurrentSourceKey2();
          const inputSel = sourceKey === SOURCE_KEYS2.JOB51 ? SELECTORS2.job51SearchInput : SELECTORS2.searchInput;
          const buttonSel = sourceKey === SOURCE_KEYS2.JOB51 ? SELECTORS2.job51SearchButton : SELECTORS2.searchButton;
          const input = doc.querySelector(inputSel);
          const button = doc.querySelector(buttonSel);
          if (input && button) {
            done = true;
            cleanup();
            resolve({ input, button });
          } else if (Date.now() > deadline) {
            done = true;
            cleanup();
            reject(new Error("Timed out waiting for search controls"));
          }
        }, "check");
        const cleanup = /* @__PURE__ */ __name(() => {
          clearInterval(intervalId);
          observer.disconnect();
        }, "cleanup");
        const intervalId = setInterval(check, 300);
        const observer = new MutationObserver(check);
        observer.observe(doc.body || doc.documentElement, {
          childList: true,
          subtree: true
        });
        check();
      });
    }
    __name(waitForSearchElements, "waitForSearchElements");
    function waitForAreaModal({ timeoutMs = 8e3 } = {}) {
      const timeout = typeof timeoutMs === "number" ? timeoutMs : 8e3;
      return new Promise((resolve, reject) => {
        let done = false;
        const deadline = Date.now() + timeout;
        const check = /* @__PURE__ */ __name(() => {
          if (done) return;
          const modal = doc.querySelector(SELECTORS2.areaModal);
          if (modal && isElementVisible2(modal)) {
            done = true;
            cleanup();
            resolve(modal);
          } else if (Date.now() > deadline) {
            done = true;
            cleanup();
            reject(new Error("Timed out waiting for area selector modal"));
          }
        }, "check");
        const cleanup = /* @__PURE__ */ __name(() => {
          clearInterval(intervalId);
          observer.disconnect();
        }, "cleanup");
        const intervalId = setInterval(check, 300);
        const observer = new MutationObserver(check);
        observer.observe(doc.body || doc.documentElement, {
          childList: true,
          subtree: true,
          attributes: true
        });
        check();
      });
    }
    __name(waitForAreaModal, "waitForAreaModal");
    function getAreaItemText(item) {
      if (!item) return "";
      const source = item.querySelector("span") || item;
      const clone = source.cloneNode(true);
      clone.querySelectorAll(".select-num").forEach((node) => node.remove());
      return (clone.textContent || "").replace(/[\uE000-\uF8FF]/g, "").replace(/\s+/g, " ").trim();
    }
    __name(getAreaItemText, "getAreaItemText");
    function findAreaItemByText(container, text) {
      if (!container || !text) return null;
      const target = text.replace(/\s+/g, " ").trim();
      const normalizedTarget = normalizeSeekLocationLabel2(target);
      const itemSelector = `${SELECTORS2.areaItem}, ${SELECTORS2.areaDistrictItem}`;
      const items = container.querySelectorAll(itemSelector);
      let normalizedMatch = null;
      for (const item of items) {
        const itemText = getAreaItemText(item);
        if (itemText === target) return asHTMLElement2(item);
        if (!normalizedMatch) {
          const normalizedItemText = normalizeSeekLocationLabel2(itemText);
          if (normalizedTarget && normalizedItemText && (normalizedItemText === normalizedTarget || normalizedItemText.includes(normalizedTarget) || normalizedTarget.includes(normalizedItemText))) {
            normalizedMatch = asHTMLElement2(item);
          }
        }
      }
      return normalizedMatch;
    }
    __name(findAreaItemByText, "findAreaItemByText");
    function waitForAreaItems(blockSelector, { timeoutMs = 5e3, itemSelector } = {}) {
      const timeout = typeof timeoutMs === "number" ? timeoutMs : 5e3;
      return new Promise((resolve, reject) => {
        let done = false;
        const deadline = Date.now() + timeout;
        const targetSelector = typeof itemSelector === "string" && itemSelector || `${SELECTORS2.areaItem}, ${SELECTORS2.areaDistrictItem}`;
        const check = /* @__PURE__ */ __name(() => {
          if (done) return;
          const block = doc.querySelector(blockSelector);
          const items = block ? block.querySelectorAll(targetSelector) : [];
          if (block && items.length > 0) {
            done = true;
            cleanup();
            resolve({ block, items: Array.from(items) });
          } else if (Date.now() > deadline) {
            done = true;
            cleanup();
            reject(
              new Error(`Timed out waiting for area items in ${blockSelector}`)
            );
          }
        }, "check");
        const cleanup = /* @__PURE__ */ __name(() => {
          clearInterval(intervalId);
          observer.disconnect();
        }, "cleanup");
        const intervalId = setInterval(check, 300);
        const observer = new MutationObserver(check);
        observer.observe(doc.body || doc.documentElement, {
          childList: true,
          subtree: true
        });
        check();
      });
    }
    __name(waitForAreaItems, "waitForAreaItems");
    function waitForAreaTrigger({ timeoutMs = 8e3 } = {}) {
      const timeout = typeof timeoutMs === "number" ? timeoutMs : 8e3;
      return new Promise((resolve, reject) => {
        let done = false;
        const deadline = Date.now() + timeout;
        const check = /* @__PURE__ */ __name(() => {
          if (done) return;
          const trigger = asHTMLElement2(
            doc.querySelector(SELECTORS2.areaTrigger)
          );
          if (trigger && isElementVisible2(trigger)) {
            done = true;
            cleanup();
            resolve(trigger);
          } else if (Date.now() > deadline) {
            done = true;
            cleanup();
            reject(new Error("Timed out waiting for area trigger"));
          }
        }, "check");
        const cleanup = /* @__PURE__ */ __name(() => {
          clearInterval(intervalId);
          observer.disconnect();
        }, "cleanup");
        const intervalId = setInterval(check, 300);
        const observer = new MutationObserver(check);
        observer.observe(doc.body || doc.documentElement, {
          childList: true,
          subtree: true,
          attributes: true
        });
        check();
      });
    }
    __name(waitForAreaTrigger, "waitForAreaTrigger");
    function setAutoSearchAttributes(status, keyword) {
      try {
        doc.documentElement.setAttribute("data-tr-auto-search", status);
        if (keyword) {
          doc.documentElement.setAttribute("data-tr-search-keyword", keyword);
        } else {
          doc.documentElement.removeAttribute("data-tr-search-keyword");
        }
      } catch (e) {
        console.warn("[tr-auto-actions]", "setAutoSearchAttributes: DOM attribute set failed", e?.message || e);
      }
    }
    __name(setAutoSearchAttributes, "setAutoSearchAttributes");
    function setAutoLocationAttributes(status, location) {
      try {
        doc.documentElement.setAttribute("data-tr-auto-location", status);
        if (location) {
          doc.documentElement.setAttribute("data-tr-location-value", location);
        } else {
          doc.documentElement.removeAttribute("data-tr-location-value");
        }
      } catch (e) {
        console.warn("[tr-auto-actions]", "setAutoLocationAttributes: DOM attribute set failed", e?.message || e);
      }
    }
    __name(setAutoLocationAttributes, "setAutoLocationAttributes");
    function canSkipAutoLocationForSeekPage() {
      if (getCurrentSourceKey2() !== SOURCE_KEYS2.SEEK) return false;
      return win.location.pathname.includes("/candidates/recommended");
    }
    __name(canSkipAutoLocationForSeekPage, "canSkipAutoLocationForSeekPage");
    async function autoSelectLocation2() {
      const params = new URLSearchParams(win.location.search || "");
      const locationRaw = (params.get(AUTO_LOCATION_PARAM2) || "").trim();
      const parsedLocations = parseAutoLocationValues2(locationRaw);
      if (parsedLocations.length === 0) {
        setAutoLocationAttributes("skipped", "");
        return;
      }
      console.log("\u{1F3AF} [Auto Location] Selecting locations:", parsedLocations);
      let modal = doc.querySelector(SELECTORS2.areaModal);
      if (!isElementVisible2(modal)) {
        let trigger;
        try {
          trigger = await waitForAreaTrigger({});
        } catch {
          if (canSkipAutoLocationForSeekPage()) {
            setAutoLocationAttributes("skipped", locationRaw);
            console.warn(
              "\u{1F3AF} [Auto Location] Trigger not found; skipping on SEEK recommended page"
            );
          } else {
            setAutoLocationAttributes("failed", locationRaw);
            console.warn("\u{1F3AF} [Auto Location] Trigger not found");
          }
          return;
        }
        trigger.click();
        try {
          modal = await waitForAreaModal({});
        } catch (error) {
          if (canSkipAutoLocationForSeekPage()) {
            setAutoLocationAttributes("skipped", locationRaw);
            console.warn(
              "\u{1F3AF} [Auto Location] Area selector not ready; skipping on SEEK recommended page:",
              error
            );
          } else {
            setAutoLocationAttributes("failed", locationRaw);
            console.warn("\u{1F3AF} [Auto Location] Area selector not ready:", error);
          }
          return;
        }
      }
      const provinceBlock = modal.querySelector(SELECTORS2.areaProvinceBlock);
      const confirmBtn = asHTMLElement2(
        modal.querySelector(SELECTORS2.areaConfirmBtn)
      );
      const cancelBtn = asHTMLElement2(modal.querySelector(SELECTORS2.areaCancelBtn));
      if (!provinceBlock || !confirmBtn || !cancelBtn) {
        if (canSkipAutoLocationForSeekPage()) {
          setAutoLocationAttributes("skipped", locationRaw);
          console.warn(
            "\u{1F3AF} [Auto Location] Missing modal controls; skipping on SEEK recommended page"
          );
        } else {
          setAutoLocationAttributes("failed", locationRaw);
          console.warn("\u{1F3AF} [Auto Location] Missing modal controls");
        }
        return;
      }
      const locationsToSelect = parsedLocations.filter((location, index) => {
        const next = parsedLocations[index + 1];
        return !(next && isProvinceToken(location) && !isProvinceToken(next));
      });
      const selectAllDistrictAndConfirm = /* @__PURE__ */ __name(async (loc) => {
        await new Promise((resolve) => setTimeout(resolve, 300));
        const { block: districtBlock } = await waitForAreaItems(
          SELECTORS2.areaDistrictBlock,
          {
            itemSelector: SELECTORS2.areaDistrictItem,
            timeoutMs: 5e3
          }
        );
        const districtItems = Array.from(
          districtBlock.querySelectorAll(SELECTORS2.areaDistrictItem)
        );
        const selectAllDistrict = findAreaItemByText(districtBlock, `\u5168${loc}`) || asHTMLElement2(
          districtItems.find((item) => getAreaItemText(item).startsWith("\u5168")) || null
        );
        if (!selectAllDistrict) return false;
        selectAllDistrict.click();
        return true;
      }, "selectAllDistrictAndConfirm");
      const tryCityFlow = /* @__PURE__ */ __name(async (loc) => {
        await new Promise((resolve) => setTimeout(resolve, 300));
        const { block: cityBlock } = await waitForAreaItems(
          SELECTORS2.areaCityBlock,
          {
            itemSelector: SELECTORS2.areaItem,
            timeoutMs: 5e3
          }
        );
        const cityMatch = findAreaItemByText(cityBlock, loc);
        if (!cityMatch) return false;
        cityMatch.click();
        if (cityMatch.textContent.trim().startsWith("\u5168")) {
          return true;
        }
        return await selectAllDistrictAndConfirm(loc);
      }, "tryCityFlow");
      const successLocations = [];
      const failedLocations = [];
      for (const location of locationsToSelect) {
        let found = false;
        const provinceMatch = findAreaItemByText(provinceBlock, location);
        if (provinceMatch) {
          provinceMatch.click();
          await new Promise((resolve) => setTimeout(resolve, 300));
          try {
            const { block: cityBlock } = await waitForAreaItems(
              SELECTORS2.areaCityBlock,
              {
                itemSelector: SELECTORS2.areaItem,
                timeoutMs: 5e3
              }
            );
            const cityItems = Array.from(
              cityBlock.querySelectorAll(SELECTORS2.areaItem)
            );
            const selectAllCity = findAreaItemByText(cityBlock, `\u5168${location}`) || findAreaItemByText(cityBlock, location) || asHTMLElement2(
              cityItems.find((item) => getAreaItemText(item).startsWith("\u5168")) || null
            );
            if (selectAllCity) {
              selectAllCity.click();
              if (selectAllCity.textContent.trim().startsWith("\u5168")) {
                found = true;
              } else if (await selectAllDistrictAndConfirm(location)) {
                found = true;
              }
            }
          } catch {
          }
        }
        if (!found) {
          const hotCities = findAreaItemByText(provinceBlock, "\u70ED\u95E8\u57CE\u5E02");
          if (hotCities) {
            hotCities.click();
            try {
              if (await tryCityFlow(location)) {
                found = true;
              }
            } catch {
            }
          }
        }
        if (!found) {
          const provinceItems = Array.from(
            provinceBlock.querySelectorAll(SELECTORS2.areaItem)
          );
          for (const province of provinceItems) {
            const hotCities = findAreaItemByText(provinceBlock, "\u70ED\u95E8\u57CE\u5E02");
            if (hotCities && province === hotCities) continue;
            const provinceEl = asHTMLElement2(province);
            if (!provinceEl) continue;
            provinceEl.click();
            try {
              if (await tryCityFlow(location)) {
                found = true;
                break;
              }
            } catch {
            }
          }
        }
        if (found) {
          successLocations.push(location);
        } else {
          failedLocations.push(location);
          console.warn("\u{1F3AF} [Auto Location] Location not found:", location);
        }
      }
      if (successLocations.length > 0) {
        confirmBtn.click();
        setAutoLocationAttributes("done", successLocations.join(","));
      } else {
        cancelBtn.click();
        if (canSkipAutoLocationForSeekPage()) {
          setAutoLocationAttributes("skipped", locationRaw);
        } else {
          setAutoLocationAttributes("failed", locationRaw);
        }
      }
    }
    __name(autoSelectLocation2, "autoSelectLocation");
    async function autoSearchFromUrl2() {
      const params = new URLSearchParams(win.location.search || "");
      const urlKeywordMode = params.get(AUTO_KEYWORD_MODE_PARAM2);
      const keywordMode = normalizeKeywordMode2(
        urlKeywordMode || await getKeywordMode2()
      );
      let keyword = normalizeKeyword2(params.get(AUTO_SEARCH_PARAM2) || "");
      if (keyword && keywordMode !== KEYWORD_MODE_SPACED2) {
        keyword = keyword.replace(/\s+/g, "");
      }
      if (!keyword) {
        setAutoSearchAttributes("skipped", "");
        return;
      }
      let input;
      let button;
      try {
        ({ input, button } = await waitForSearchElements());
      } catch (error) {
        console.warn("\u{1F3AF} [Auto Search] Search controls not ready:", error);
        setAutoSearchAttributes("skipped", keyword);
        return;
      }
      let currentValue = normalizeKeyword2(input.value || "");
      if (keywordMode !== KEYWORD_MODE_SPACED2) {
        currentValue = currentValue.replace(/\s+/g, "");
      }
      const shouldForceJob51Search = getCurrentSourceKey2() === SOURCE_KEYS2.JOB51 && currentValue === keyword && !hasJob51SearchSnapshot2() && isJob51EmptySearchPromptVisible2();
      if (currentValue === keyword && !shouldForceJob51Search) {
        setAutoSearchAttributes("skipped", keyword);
        return;
      }
      console.log(
        "\u{1F3AF} [Auto Search] Searching for:",
        keyword,
        `(mode=${keywordMode})`
      );
      setInputValue2(input, keyword);
      button.click();
      setAutoSearchAttributes("done", keyword);
      try {
        const count = await waitForExtractionData2({});
        console.log("\u{1F3AF} [Auto Search] Done, found", count, "results");
      } catch (error) {
        console.warn(
          "\u{1F3AF} [Auto Search] Search triggered, waiting for results timed out:",
          error
        );
      }
    }
    __name(autoSearchFromUrl2, "autoSearchFromUrl");
    let autoExportTriggered = false;
    function normalizeCardText2(text) {
      if (!text) return "";
      return text.split("\n").map((line) => line.trim()).filter(Boolean).join("\n");
    }
    __name(normalizeCardText2, "normalizeCardText");
    function rawToMarkdown2(rawPayload) {
      const lines = [];
      lines.push("# Resume Dump (Raw)");
      lines.push("");
      lines.push(`- URL: ${rawPayload.url}`);
      lines.push(`- Extracted: ${rawPayload.extractedAt}`);
      lines.push(`- Count: ${rawPayload.count}`);
      lines.push("");
      rawPayload.cards.forEach((card, idx) => {
        const indexLabel = String(idx + 1).padStart(2, "0");
        lines.push(`## Card ${indexLabel}`);
        if (card.resumeId || card.perUserId) {
          lines.push(`- resumeId: ${card.resumeId || ""}`);
          lines.push(`- perUserId: ${card.perUserId || ""}`);
          lines.push("");
        }
        lines.push("```text");
        const normalized = normalizeCardText2(card.text);
        lines.push(normalized || "(empty)");
        lines.push("```");
        lines.push("");
      });
      return lines.join("\n");
    }
    __name(rawToMarkdown2, "rawToMarkdown");
    function resumesToCSV2(resumes) {
      if (resumes.length === 0) return "";
      const headers = [
        "\u5E8F\u53F7",
        "resumeId",
        "perUserId",
        "\u59D3\u540D",
        "\u5E74\u9F84",
        "\u5DE5\u4F5C\u7ECF\u9A8C",
        "\u5B66\u5386",
        "\u6240\u5728\u5730",
        "\u81EA\u6211\u8BC4\u4EF7",
        "\u671F\u671B\u85AA\u8D44",
        "\u6D3B\u8DC3\u72B6\u6001",
        "\u6C42\u804C\u610F\u5411",
        "\u7B80\u5386\u94FE\u63A5",
        "\u63D0\u53D6\u65F6\u95F4"
      ];
      const rows = resumes.map(
        (r, i) => [
          i + 1,
          r.resumeId || "",
          r.perUserId || "",
          r.name,
          r.age,
          r.experience,
          r.education,
          r.location,
          r.selfIntro,
          r.expectedSalary,
          r.activityStatus,
          r.jobIntention?.replace(/,/g, ";").substring(0, 100),
          r.profileUrl,
          r.extractedAt
        ].map((cell) => `"${String(cell || "").replace(/"/g, '""')}"`).join(",")
      );
      return [headers.join(","), ...rows].join("\n");
    }
    __name(resumesToCSV2, "resumesToCSV");
    function makeRandomId2() {
      try {
        if (globalThis.crypto?.randomUUID)
          return globalThis.crypto.randomUUID().split("-")[0];
      } catch {
      }
      return Math.random().toString(16).slice(2, 10);
    }
    __name(makeRandomId2, "makeRandomId");
    async function downloadFile2(content, filename, mimeType, saveAs = false) {
      const response = await chrome.runtime.sendMessage({
        action: "downloadFile",
        content,
        filename,
        mimeType,
        saveAs: !!saveAs
      });
      if (response?.success) return response;
      throw new Error(response?.error || "Download failed");
    }
    __name(downloadFile2, "downloadFile");
    function getExtensionVersion2() {
      try {
        return chrome?.runtime?.getManifest?.().version || SOURCE_KEYS2.UNKNOWN;
      } catch (e) {
        console.warn("[tr-auto-actions]", "getExtensionVersion: chrome.runtime.getManifest failed", e?.message || e);
        return SOURCE_KEYS2.UNKNOWN;
      }
    }
    __name(getExtensionVersion2, "getExtensionVersion");
    function parseAutoExportMode2(value) {
      if (!value) return { enabled: false };
      const mode = String(value).trim().toLowerCase();
      if (!mode) return { enabled: false };
      const config = {
        enabled: true,
        logStructured: false,
        logRaw: false,
        downloadCsv: false,
        downloadJson: false,
        downloadRawJson: false,
        downloadMarkdown: false,
        saveAs: false,
        rawIncludePage: false
      };
      if (mode === "1" || mode === "true") {
        config.downloadMarkdown = true;
        return config;
      }
      if (mode === "console" || mode === "log") {
        config.logStructured = true;
        return config;
      }
      if (mode === "csv") {
        config.downloadCsv = true;
        return config;
      }
      if (mode === "json") {
        config.downloadJson = true;
        return config;
      }
      if (mode === "both" || mode === "all") {
        config.downloadCsv = true;
        config.downloadJson = mode === "all";
        config.logStructured = true;
        return config;
      }
      if (mode === "raw") {
        config.logRaw = true;
        return config;
      }
      if (mode === "raw_json" || mode === "rawjson") {
        config.downloadRawJson = true;
        return config;
      }
      if (mode === "md" || mode === "markdown") {
        config.downloadMarkdown = true;
        return config;
      }
      const tokens = mode.split(/[,+|]/).map((token) => token.trim()).filter(Boolean);
      for (const token of tokens) {
        if (token === "console" || token === "log") config.logStructured = true;
        if (token === "csv") config.downloadCsv = true;
        if (token === "json") config.downloadJson = true;
        if (token === "raw") config.logRaw = true;
        if (token === "rawjson" || token === "raw_json")
          config.downloadRawJson = true;
        if (token === "md" || token === "markdown") config.downloadMarkdown = true;
        if (token === "page" || token === "rawpage") config.rawIncludePage = true;
        if (token === "saveas") config.saveAs = true;
      }
      if (!config.logStructured && !config.logRaw && !config.downloadCsv && !config.downloadJson && !config.downloadRawJson && !config.downloadMarkdown) {
        config.downloadMarkdown = true;
      }
      return config;
    }
    __name(parseAutoExportMode2, "parseAutoExportMode");
    function getAutoExportConfig2() {
      const params = new URLSearchParams(win.location.search || "");
      const paramValue = params.get(AUTO_EXPORT_PARAM2);
      if (paramValue) return parseAutoExportMode2(paramValue);
      try {
        const localValue = win.localStorage?.getItem(AUTO_EXPORT_PARAM2);
        return parseAutoExportMode2(localValue);
      } catch (e) {
        console.warn("[tr-auto-actions]", "getAutoExportConfig: localStorage access failed", e?.message || e);
        return { enabled: false };
      }
    }
    __name(getAutoExportConfig2, "getAutoExportConfig");
    function parseAutoSyncFlag2(value) {
      if (!value) return false;
      const normalized = String(value).trim().toLowerCase();
      return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
    }
    __name(parseAutoSyncFlag2, "parseAutoSyncFlag");
    function getAutoSyncEnabled2() {
      const params = new URLSearchParams(win.location.search || "");
      if (params.has(AUTO_SYNC_PARAM2)) {
        return parseAutoSyncFlag2(params.get(AUTO_SYNC_PARAM2));
      }
      try {
        const captured = sessionStorage.getItem("tr_auto_sync_captured");
        if (captured !== null) {
          return parseAutoSyncFlag2(captured);
        }
      } catch {
      }
      try {
        const localValue = win.localStorage?.getItem(AUTO_SYNC_PARAM2);
        return parseAutoSyncFlag2(localValue);
      } catch (e) {
        console.warn("[tr-auto-actions]", "getAutoSyncEnabled: localStorage access failed", e?.message || e);
        return false;
      }
    }
    __name(getAutoSyncEnabled2, "getAutoSyncEnabled");
    async function runAutoExportIfEnabled2() {
      if (autoExportTriggered) return;
      const config = getAutoExportConfig2();
      if (!config.enabled) return;
      autoExportTriggered = true;
      try {
        await waitForExtractionData2({});
        const resumes = extractResumes2();
        if (config.logStructured) {
          console.log("\u{1F3AF} [Auto Export] Extracted resumes", {
            count: resumes.length,
            resumes
          });
        }
        try {
          doc.documentElement.setAttribute("data-tr-auto-export", "done");
          doc.documentElement.setAttribute(
            "data-tr-auto-export-count",
            String(resumes.length)
          );
        } catch (e) {
          console.warn("[tr-auto-actions]", "runAutoExportIfEnabled: DOM attribute set failed", e?.message || e);
        }
        let rawPayload = null;
        if (config.logRaw || config.downloadRawJson || config.downloadMarkdown || config.rawIncludePage) {
          rawPayload = extractResumesRaw2({ includePage: config.rawIncludePage });
          if (config.logRaw) {
            console.log("\u{1F3AF} [Auto Export] Raw resumes", rawPayload);
          }
          if (config.downloadRawJson) {
            const timestamp = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
            const filename = `resumes_raw_${timestamp}_${makeRandomId2()}.json`;
            await downloadFile2(
              JSON.stringify(rawPayload, null, 2),
              filename,
              "application/json",
              config.saveAs
            );
            console.log("\u{1F3AF} [Auto Export] Raw JSON download triggered:", filename);
          }
          if (config.downloadMarkdown) {
            const markdown = rawToMarkdown2(rawPayload);
            const timestamp = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
            const filename = `resumes_md_${timestamp}_${makeRandomId2()}.md`;
            await downloadFile2(markdown, filename, "text/markdown", config.saveAs);
            console.log("\u{1F3AF} [Auto Export] Markdown download triggered:", filename);
          }
        }
        if (config.downloadCsv) {
          const csv = resumesToCSV2(resumes);
          const timestamp = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
          const filename = `resumes_${timestamp}_${makeRandomId2()}.csv`;
          await downloadFile2(csv, filename, "text/csv", config.saveAs);
          console.log("\u{1F3AF} [Auto Export] CSV download triggered:", filename);
        }
        if (config.downloadJson) {
          const metadata = buildExportMetadata2(resumes);
          const payload = { metadata, data: resumes };
          const json = JSON.stringify(payload, null, 2);
          const filename = buildExportFilename2();
          await downloadFile2(json, filename, "application/json", config.saveAs);
          console.log("\u{1F3AF} [Auto Export] JSON download triggered:", filename);
        }
      } catch (error) {
        console.warn("\u{1F3AF} [Auto Export] Failed:", error);
        try {
          doc.documentElement.setAttribute("data-tr-auto-export", "failed");
        } catch (e) {
          console.warn("[tr-auto-actions]", "runAutoExportIfEnabled: fallback attribute set failed", e?.message || e);
        }
      }
    }
    __name(runAutoExportIfEnabled2, "runAutoExportIfEnabled");
    async function applyCurrentSourceCollectionGuards(resumes) {
      if (!Array.isArray(resumes) || resumes.length === 0) return resumes;
      const sourceKey = getCurrentSourceKey2();
      if (sourceKey !== SOURCE_KEYS2.JOB51 && sourceKey !== SOURCE_KEYS2.JOB5156 && sourceKey !== SOURCE_KEYS2.SEEK) {
        return resumes;
      }
      const collectionGuards = await loadCollectionGuards2();
      const guards = collectionGuards && typeof collectionGuards === "object" ? collectionGuards[sourceKey] : void 0;
      const guardFields = parseGuardFieldNames2(typeof guards === "string" ? guards : "");
      if (guardFields.length === 0) return resumes;
      return resumes.map((resume) => applyCollectionGuards2(resume, guardFields));
    }
    __name(applyCurrentSourceCollectionGuards, "applyCurrentSourceCollectionGuards");
    async function syncCurrentPageToServer2(resumesOverride) {
      let resumes = Array.isArray(resumesOverride) ? resumesOverride : extractResumes2();
      const shouldEnrichFromCurrentPage = !Array.isArray(resumesOverride);
      if (shouldEnrichFromCurrentPage && getCurrentSourceKey2() === SOURCE_KEYS2.JOB51 && !isJob51DetailPage2() && resumes.length > 0) {
        resumes = await enrich51JobSearchResumesWithDetail2(resumes);
      }
      if (shouldEnrichFromCurrentPage && getCurrentSourceKey2() === SOURCE_KEYS2.JOB5156 && !isJob5156DetailPage2() && resumes.length > 0) {
        resumes = await enrichJob5156SearchResumesWithDetail2(resumes);
      }
      if (shouldEnrichFromCurrentPage && getCurrentSourceKey2() === SOURCE_KEYS2.SEEK && !isSeekProfileMode2() && resumes.length > 0) {
        resumes = await enrichSeekResumesWithDetail2(resumes);
      }
      resumes = await applyCurrentSourceCollectionGuards(resumes);
      const metadata = buildSubmitMetadata2({
        seekCaptureMode: Array.isArray(resumesOverride) && win.location.pathname.includes("/candidates/recommended") ? "graphql-list" : void 0
      });
      return chrome.runtime.sendMessage({
        action: "syncToServer",
        metadata,
        resumes
      });
    }
    __name(syncCurrentPageToServer2, "syncCurrentPageToServer");
    function resolveAutoSyncErrorStatus2(errorLike) {
      const rawError = typeof errorLike === "string" ? errorLike : errorLike?.error || errorLike?.message || String(errorLike || "");
      const message = String(rawError).trim() || "Unknown error";
      const lowerMessage = message.toLowerCase();
      if (message.includes("\u641C\u7D22\u8BBF\u95EE\u592A\u5FEB") || message.includes("60\u5206\u949F\u540E\u518D\u8BD5")) {
        return {
          message: "51job \u5DF2\u89E6\u53D1\u8BBF\u95EE\u9650\u5236",
          hint: "\u6269\u5C55\u5DF2\u505C\u6B62\u81EA\u52A8\u7FFB\u9875\u3002\u81F3\u5C11\u7B49\u5F8560\u5206\u949F\u540E\u91CD\u8BD5\uFF0C\u5E76\u4FDD\u6301\u5C0F\u9875\u6570\u3001\u5C0F\u6279\u91CF\u3002"
        };
      }
      if (message === "Server token not configured") {
        return {
          message: "Token \u672A\u914D\u7F6E",
          hint: "\u70B9\u51FB\u6B64\u63D0\u793A\u6253\u5F00\u6269\u5C55\u8BBE\u7F6E\u5E76\u586B\u5199 Token"
        };
      }
      if (message === "Server host permission not granted" || lowerMessage.includes("permission not granted") || lowerMessage.includes("\u672A\u6388\u4E88")) {
        return {
          message: "\u670D\u52A1\u5668\u6743\u9650\u672A\u6388\u6743",
          hint: "\u70B9\u51FB\u6B64\u63D0\u793A\u6253\u5F00\u6269\u5C55\u8BBE\u7F6E\uFF0C\u5E76\u6388\u6743\u5F53\u524D Server URL"
        };
      }
      if (message.includes("401") || lowerMessage.includes("unauthorized")) {
        return {
          message: "\u8BA4\u8BC1\u5931\u8D25 - Token \u65E0\u6548\u6216\u5DF2\u8FC7\u671F",
          hint: "\u70B9\u51FB\u6B64\u63D0\u793A\u6253\u5F00\u6269\u5C55\u8BBE\u7F6E\u5E76\u66F4\u65B0 Token"
        };
      }
      if (message === "Server URL not configured") {
        return {
          message: "\u670D\u52A1\u5668\u5730\u5740\u672A\u914D\u7F6E",
          hint: "\u70B9\u51FB\u6B64\u63D0\u793A\u6253\u5F00\u6269\u5C55\u8BBE\u7F6E\u5E76\u586B\u5199\u670D\u52A1\u5668\u5730\u5740"
        };
      }
      if (lowerMessage.includes("failed to fetch") || lowerMessage.includes("networkerror") || lowerMessage.includes("network error") || lowerMessage.includes("err_network") || lowerMessage.includes("load failed") || lowerMessage.includes("connection")) {
        return {
          message: "\u65E0\u6CD5\u8FDE\u63A5\u670D\u52A1\u5668",
          hint: "\u8BF7\u68C0\u67E5\u7F51\u7EDC\u8FDE\u63A5\u548C\u670D\u52A1\u5668\u72B6\u6001\u540E\u91CD\u8BD5"
        };
      }
      return {
        message: `\u540C\u6B65\u5931\u8D25: ${message}`,
        hint: "\u70B9\u51FB\u6B64\u63D0\u793A\u6253\u5F00\u6269\u5C55\u8BBE\u7F6E\u6392\u67E5\u95EE\u9898"
      };
    }
    __name(resolveAutoSyncErrorStatus2, "resolveAutoSyncErrorStatus");
    function resolveAutoSyncStopReason2(errorLike) {
      const rawError = typeof errorLike === "string" ? errorLike : errorLike?.error || errorLike?.message || String(errorLike || "");
      const message = String(rawError).trim();
      if (message.includes("\u641C\u7D22\u8BBF\u95EE\u592A\u5FEB") || message.includes("60\u5206\u949F\u540E\u518D\u8BD5")) {
        return "job51-rate-limited";
      }
      return "failed";
    }
    __name(resolveAutoSyncStopReason2, "resolveAutoSyncStopReason");
    return {
      findAgeFilterBlock: findAgeFilterBlock2,
      openAgeFilterDropdown: openAgeFilterDropdown2,
      resolveAgeSelectBox: resolveAgeSelectBox2,
      waitForAgeFilterDropdown: waitForAgeFilterDropdown2,
      resolveAgeFilterActions: resolveAgeFilterActions2,
      autoApplyAgeFilterFromUrl: autoApplyAgeFilterFromUrl2,
      setAutoAgeAttributes: setAutoAgeAttributes2,
      autoSelectLocation: autoSelectLocation2,
      autoSearchFromUrl: autoSearchFromUrl2,
      normalizeCardText: normalizeCardText2,
      rawToMarkdown: rawToMarkdown2,
      resumesToCSV: resumesToCSV2,
      makeRandomId: makeRandomId2,
      downloadFile: downloadFile2,
      getExtensionVersion: getExtensionVersion2,
      parseAutoExportMode: parseAutoExportMode2,
      getAutoExportConfig: getAutoExportConfig2,
      parseAutoSyncFlag: parseAutoSyncFlag2,
      getAutoSyncEnabled: getAutoSyncEnabled2,
      runAutoExportIfEnabled: runAutoExportIfEnabled2,
      syncCurrentPageToServer: syncCurrentPageToServer2,
      resolveAutoSyncErrorStatus: resolveAutoSyncErrorStatus2,
      resolveAutoSyncStopReason: resolveAutoSyncStopReason2
    };
  }
  __name(createAutoActions, "createAutoActions");

  // src/lib/ui-utils.ts
  function createUiUtils(deps) {
    const {
      // Window/Document
      win,
      doc,
      // Constants
      SOURCE_KEYS: SOURCE_KEYS2,
      AUTO_EXPORT_PARAM: AUTO_EXPORT_PARAM2,
      AUTO_SYNC_PARAM: AUTO_SYNC_PARAM2,
      AUTO_LIMIT_PARAM: AUTO_LIMIT_PARAM2,
      AUTO_MAX_PAGES_PARAM: AUTO_MAX_PAGES_PARAM2,
      AUTO_MIN_AGE_PARAM: AUTO_MIN_AGE_PARAM2,
      AUTO_MAX_AGE_PARAM: AUTO_MAX_AGE_PARAM2,
      AUTO_SEARCH_PARAM: AUTO_SEARCH_PARAM2,
      AUTO_LOCATION_PARAM: AUTO_LOCATION_PARAM2,
      SAMPLE_NAME_PARAM: SAMPLE_NAME_PARAM2,
      KEYWORD_MODE_CONCAT: KEYWORD_MODE_CONCAT2,
      KEYWORD_MODE_SPACED: KEYWORD_MODE_SPACED2,
      LATEST_AUTO_SYNC_SUMMARIES_STORAGE_KEY: LATEST_AUTO_SYNC_SUMMARIES_STORAGE_KEY2,
      JOB5156_HOST: JOB5156_HOST2,
      EHIRE_51JOB_HOST: EHIRE_51JOB_HOST2,
      SEEK_HOST_SUFFIX: SEEK_HOST_SUFFIX2,
      // Functions from other factories
      getPaginationInfo: getPaginationInfo2,
      makeRandomId: makeRandomId2,
      getExternalAccessorStatus: getExternalAccessorStatus3,
      getAgeRangeFromUrl: getAgeRangeFromUrl2,
      filterResumesByAgeRange: filterResumesByAgeRange2,
      resolveJob51CollectionLimits: resolveJob51CollectionLimits2,
      resolveJob51DetailFetchDelayMs: resolveJob51DetailFetchDelayMs2,
      resolveJob51AutoSyncDetailWaitMode: resolveJob51AutoSyncDetailWaitMode2,
      isJob51DetailPage: isJob51DetailPage2,
      // External globals
      chrome: chrome2
    } = deps;
    const lastPersistedAutoSyncSummaryFingerprintBySource = {};
    function sanitizeSampleName2(value) {
      if (!value) return "";
      return value.trim().replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^\.+/, "").slice(0, 80);
    }
    __name(sanitizeSampleName2, "sanitizeSampleName");
    function normalizeKeyword2(keyword) {
      if (!keyword) return "";
      return keyword.replace(/[\u3000]/g, " ").replace(/\s+/g, " ").trim();
    }
    __name(normalizeKeyword2, "normalizeKeyword");
    function normalizeKeywordMode2(mode) {
      return mode === KEYWORD_MODE_SPACED2 ? KEYWORD_MODE_SPACED2 : KEYWORD_MODE_CONCAT2;
    }
    __name(normalizeKeywordMode2, "normalizeKeywordMode");
    function normalizeCollectionLimit2(value) {
      const parsed = Number.parseInt(String(value ?? ""), 10);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
    }
    __name(normalizeCollectionLimit2, "normalizeCollectionLimit");
    function buildExportFilename2() {
      const params = new URLSearchParams(win.location.search || "");
      const rawSampleName = params.get(SAMPLE_NAME_PARAM2) || "";
      const sampleName = sanitizeSampleName2(rawSampleName).replace(/\.json$/i, "");
      const timestamp = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
      if (sampleName) return `${sampleName}.json`;
      const rawKeyword = params.get(AUTO_SEARCH_PARAM2) || "";
      const keyword = sanitizeSampleName2(normalizeKeyword2(rawKeyword));
      if (keyword) return `sample-${keyword}-${timestamp}.json`;
      return `resumes_${timestamp}_${makeRandomId2()}.json`;
    }
    __name(buildExportFilename2, "buildExportFilename");
    function parseAutoLocationValues2(locationRaw) {
      if (!locationRaw) return [];
      return Array.from(
        new Set(
          String(locationRaw).split(/[，,、]+/).map((location) => location.trim()).filter(Boolean)
        )
      ).slice(0, 10);
    }
    __name(parseAutoLocationValues2, "parseAutoLocationValues");
    function getAutoLocationValues2(url) {
      return parseAutoLocationValues2(
        url.searchParams.get(AUTO_LOCATION_PARAM2) || ""
      );
    }
    __name(getAutoLocationValues2, "getAutoLocationValues");
    function getExtensionGeneratedBy2() {
      let generatedBy = "browser-extension";
      try {
        const version = chrome2?.runtime?.getManifest?.().version;
        if (version) generatedBy = `browser-extension@${version}`;
      } catch {
      }
      return generatedBy;
    }
    __name(getExtensionGeneratedBy2, "getExtensionGeneratedBy");
    function buildExportMetadata2(resumes) {
      const url = new URL(win.location.href);
      const keyword = normalizeKeyword2(
        url.searchParams.get(AUTO_SEARCH_PARAM2) || ""
      );
      const locationArray = getAutoLocationValues2(url);
      const rawSampleName = url.searchParams.get(SAMPLE_NAME_PARAM2) || "";
      const sampleName = sanitizeSampleName2(rawSampleName).replace(/\.json$/i, "");
      url.searchParams.delete(AUTO_EXPORT_PARAM2);
      url.searchParams.delete(AUTO_SYNC_PARAM2);
      url.searchParams.delete(AUTO_LIMIT_PARAM2);
      url.searchParams.delete(AUTO_MAX_PAGES_PARAM2);
      url.searchParams.delete(SAMPLE_NAME_PARAM2);
      const filters = {};
      for (const [key, value] of url.searchParams.entries()) {
        if (key === AUTO_SEARCH_PARAM2 || key === AUTO_LOCATION_PARAM2) continue;
        if (!value) continue;
        filters[key] = value;
      }
      const pagination = getPaginationInfo2();
      const reproductionParams = new URLSearchParams();
      reproductionParams.set(AUTO_EXPORT_PARAM2, "json");
      if (sampleName) reproductionParams.set(SAMPLE_NAME_PARAM2, sampleName);
      return {
        sourceUrl: url.toString(),
        searchCriteria: {
          keyword,
          location: locationArray.length > 0 ? locationArray : "",
          filters: Object.keys(filters).length ? filters : {}
        },
        generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
        generatedBy: getExtensionGeneratedBy2(),
        totalPages: pagination.totalPages,
        totalResumes: resumes.length,
        reproduction: `Navigate to sourceUrl, then add ?${reproductionParams.toString()}`
      };
    }
    __name(buildExportMetadata2, "buildExportMetadata");
    function getCurrentSourceKey2() {
      const hostname = win.location.hostname.toLowerCase();
      if (hostname === JOB5156_HOST2) return SOURCE_KEYS2.JOB5156;
      if (hostname === EHIRE_51JOB_HOST2) return SOURCE_KEYS2.JOB51;
      if (hostname.endsWith(SEEK_HOST_SUFFIX2)) return SOURCE_KEYS2.SEEK;
      return SOURCE_KEYS2.UNKNOWN;
    }
    __name(getCurrentSourceKey2, "getCurrentSourceKey");
    function getCurrentLocationSearch2() {
      return win.location.search || "";
    }
    __name(getCurrentLocationSearch2, "getCurrentLocationSearch");
    function getCurrentAgeRange2() {
      return getAgeRangeFromUrl2(
        getCurrentLocationSearch2(),
        AUTO_MIN_AGE_PARAM2,
        AUTO_MAX_AGE_PARAM2
      );
    }
    __name(getCurrentAgeRange2, "getCurrentAgeRange");
    function filterCurrentResumesByAgeRange2(resumes) {
      if (getCurrentSourceKey2() === SOURCE_KEYS2.JOB51 && !isJob51DetailPage2() && doc.documentElement.getAttribute("data-tr-auto-age") !== "done") {
        return Array.isArray(resumes) ? resumes : [];
      }
      return filterResumesByAgeRange2(
        resumes,
        getCurrentLocationSearch2(),
        AUTO_MIN_AGE_PARAM2,
        AUTO_MAX_AGE_PARAM2
      );
    }
    __name(filterCurrentResumesByAgeRange2, "filterCurrentResumesByAgeRange");
    function resolveCurrentJob51CollectionLimits2(limit, maxPages) {
      return resolveJob51CollectionLimits2(
        limit,
        maxPages,
        getCurrentLocationSearch2()
      );
    }
    __name(resolveCurrentJob51CollectionLimits2, "resolveCurrentJob51CollectionLimits");
    function resolveCurrentJob51DetailFetchDelayMs2() {
      return resolveJob51DetailFetchDelayMs2(getCurrentLocationSearch2());
    }
    __name(resolveCurrentJob51DetailFetchDelayMs2, "resolveCurrentJob51DetailFetchDelayMs");
    function resolveCurrentJob51AutoSyncDetailWaitMode2() {
      return resolveJob51AutoSyncDetailWaitMode2(getCurrentLocationSearch2());
    }
    __name(resolveCurrentJob51AutoSyncDetailWaitMode2, "resolveCurrentJob51AutoSyncDetailWaitMode");
    function setAutoSyncAttributes2(status, count, pagesProcessed) {
      try {
        doc.documentElement.setAttribute("data-tr-auto-sync", status);
        if (typeof count === "number" && Number.isFinite(count)) {
          doc.documentElement.setAttribute(
            "data-tr-auto-sync-count",
            String(count)
          );
        } else {
          doc.documentElement.removeAttribute("data-tr-auto-sync-count");
        }
        if (typeof pagesProcessed === "number" && Number.isFinite(pagesProcessed)) {
          doc.documentElement.setAttribute(
            "data-tr-auto-sync-pages",
            String(pagesProcessed)
          );
        } else {
          doc.documentElement.removeAttribute("data-tr-auto-sync-pages");
        }
      } catch {
      }
      if (status && status !== "skipped") {
        persistLatestAutoSyncSummary2();
      }
    }
    __name(setAutoSyncAttributes2, "setAutoSyncAttributes");
    function buildAutoSyncProgressHint2({
      limit = 0,
      totalSubmitted = 0,
      selectedCount = null,
      ageHint = ""
    } = {}) {
      const progressHint = limit > 0 ? `\u5DF2\u91C7\u96C6 ${Math.min(totalSubmitted, limit)}/${limit}` : `\u5DF2\u91C7\u96C6 ${totalSubmitted}`;
      const selectedHint = buildAutoSyncSelectedCountHint2({ selectedCount });
      return `${progressHint}${selectedHint}${ageHint}`;
    }
    __name(buildAutoSyncProgressHint2, "buildAutoSyncProgressHint");
    function buildAutoSyncSelectedCountHint2({
      selectedCount = null,
      prefix = " \xB7 "
    } = {}) {
      return typeof selectedCount === "number" && Number.isFinite(selectedCount) ? `${prefix}\u672C\u9875\u9009\u4E2D ${selectedCount} \u4EFD` : "";
    }
    __name(buildAutoSyncSelectedCountHint2, "buildAutoSyncSelectedCountHint");
    function buildAutoSyncCompletionHint2({
      totalInserted = 0,
      totalUpdated = 0,
      pagesVisited = 0,
      selectedCount = null
    } = {}) {
      return `${totalInserted} \u65B0\u589E, ${totalUpdated} \u66F4\u65B0, \u5171 ${pagesVisited} \u9875${buildAutoSyncSelectedCountHint2(
        {
          selectedCount
        }
      )}`;
    }
    __name(buildAutoSyncCompletionHint2, "buildAutoSyncCompletionHint");
    function buildPersistedAutoSyncSummary2(status = getExternalAccessorStatus3()) {
      const autoSync = typeof status?.autoSync === "string" ? status.autoSync : "";
      if (!autoSync || autoSync === "skipped") {
        return null;
      }
      return {
        autoSync,
        autoSyncCount: typeof status?.autoSyncCount === "number" ? status.autoSyncCount : 0,
        autoSyncPages: typeof status?.autoSyncPages === "number" ? status.autoSyncPages : 0,
        autoSyncTargetPageStart: status?.autoSyncTargetPageStart ?? null,
        autoSyncTargetPageEnd: status?.autoSyncTargetPageEnd ?? null,
        autoSyncEffectivePageSize: status?.autoSyncEffectivePageSize ?? null,
        autoSyncSelectedCount: status?.autoSyncSelectedCount ?? null,
        autoSyncRemainingCapacity: status?.autoSyncRemainingCapacity ?? null,
        autoSyncStopReason: status?.autoSyncStopReason ?? null,
        sourceKey: typeof status?.sourceKey === "string" ? status.sourceKey : getCurrentSourceKey2(),
        sourceUrl: win.location.href,
        summarySource: "stored",
        persistedAt: (/* @__PURE__ */ new Date()).toISOString()
      };
    }
    __name(buildPersistedAutoSyncSummary2, "buildPersistedAutoSyncSummary");
    function persistLatestAutoSyncSummary2() {
      try {
        if (!chrome2?.storage?.local?.get || !chrome2?.storage?.local?.set) return;
        const summary = buildPersistedAutoSyncSummary2();
        if (!summary) return;
        const sourceKey = typeof summary.sourceKey === "string" && summary.sourceKey ? summary.sourceKey : SOURCE_KEYS2.UNKNOWN;
        const fingerprint = JSON.stringify({
          autoSync: summary.autoSync,
          autoSyncCount: summary.autoSyncCount,
          autoSyncPages: summary.autoSyncPages,
          autoSyncTargetPageStart: summary.autoSyncTargetPageStart,
          autoSyncTargetPageEnd: summary.autoSyncTargetPageEnd,
          autoSyncEffectivePageSize: summary.autoSyncEffectivePageSize,
          autoSyncSelectedCount: summary.autoSyncSelectedCount,
          autoSyncRemainingCapacity: summary.autoSyncRemainingCapacity,
          autoSyncStopReason: summary.autoSyncStopReason,
          sourceKey: summary.sourceKey,
          sourceUrl: summary.sourceUrl,
          summarySource: summary.summarySource
        });
        if (summary.autoSync === "running" && lastPersistedAutoSyncSummaryFingerprintBySource[sourceKey] === fingerprint) {
          return;
        }
        lastPersistedAutoSyncSummaryFingerprintBySource[sourceKey] = fingerprint;
        chrome2.storage.local.get(
          { [LATEST_AUTO_SYNC_SUMMARIES_STORAGE_KEY2]: {} },
          (items) => {
            const existingSummaries = items?.[LATEST_AUTO_SYNC_SUMMARIES_STORAGE_KEY2];
            const nextSummaries = existingSummaries && typeof existingSummaries === "object" && !Array.isArray(existingSummaries) ? { ...existingSummaries } : {};
            nextSummaries[sourceKey] = summary;
            chrome2.storage.local.set({
              [LATEST_AUTO_SYNC_SUMMARIES_STORAGE_KEY2]: nextSummaries
            });
          }
        );
      } catch (error) {
        console.warn(
          "\u{1F389} [Auto Sync] Failed to persist latest auto sync summary:",
          error
        );
      }
    }
    __name(persistLatestAutoSyncSummary2, "persistLatestAutoSyncSummary");
    function installReloadHelper2() {
      try {
        if (globalThis.trReloadExtension) return;
        globalThis.trReloadExtension = async () => {
          try {
            const response = await chrome2.runtime.sendMessage({
              action: "reloadExtension"
            });
            console.log("\u{1F3AF} [DEV] Reload requested", response);
          } catch (error) {
            console.warn("\u{1F3AF} [DEV] Reload failed:", error);
          }
        };
        console.log(
          '\u{1F3AF} [DEV] Use trReloadExtension() in the DevTools "Content scripts" context to reload the extension'
        );
      } catch (error) {
        console.warn("\u{1F3AF} [DEV] Failed to install reload helper:", error);
      }
    }
    __name(installReloadHelper2, "installReloadHelper");
    function isLoggedIn2() {
      return doc.querySelector('.login-btn, [href*="login"]') === null;
    }
    __name(isLoggedIn2, "isLoggedIn");
    return {
      // Export & Metadata
      sanitizeSampleName: sanitizeSampleName2,
      normalizeKeyword: normalizeKeyword2,
      normalizeKeywordMode: normalizeKeywordMode2,
      normalizeCollectionLimit: normalizeCollectionLimit2,
      buildExportFilename: buildExportFilename2,
      buildExportMetadata: buildExportMetadata2,
      getCurrentSourceKey: getCurrentSourceKey2,
      getExtensionGeneratedBy: getExtensionGeneratedBy2,
      parseAutoLocationValues: parseAutoLocationValues2,
      getAutoLocationValues: getAutoLocationValues2,
      // Collection Helpers
      getCurrentLocationSearch: getCurrentLocationSearch2,
      getCurrentAgeRange: getCurrentAgeRange2,
      filterCurrentResumesByAgeRange: filterCurrentResumesByAgeRange2,
      resolveCurrentJob51CollectionLimits: resolveCurrentJob51CollectionLimits2,
      resolveCurrentJob51DetailFetchDelayMs: resolveCurrentJob51DetailFetchDelayMs2,
      resolveCurrentJob51AutoSyncDetailWaitMode: resolveCurrentJob51AutoSyncDetailWaitMode2,
      // Auto-Sync UI
      setAutoSyncAttributes: setAutoSyncAttributes2,
      buildAutoSyncProgressHint: buildAutoSyncProgressHint2,
      buildAutoSyncSelectedCountHint: buildAutoSyncSelectedCountHint2,
      buildAutoSyncCompletionHint: buildAutoSyncCompletionHint2,
      buildPersistedAutoSyncSummary: buildPersistedAutoSyncSummary2,
      persistLatestAutoSyncSummary: persistLatestAutoSyncSummary2,
      // Additional Utilities
      installReloadHelper: installReloadHelper2,
      isLoggedIn: isLoggedIn2
    };
  }
  __name(createUiUtils, "createUiUtils");

  // src/lib/pagination-utils.ts
  function createPaginationUtils(deps) {
    const {
      getCurrentSourceKey: getCurrentSourceKey2,
      SOURCE_KEYS: SOURCE_KEYS2,
      isJob51DetailPage: isJob51DetailPage2,
      isJob5156DetailPage: isJob5156DetailPage2,
      isJob51DetailReady: isJob51DetailReady2,
      isJob5156DetailReady: isJob5156DetailReady2,
      getSeekPaginationInfo: getSeekPaginationInfo2,
      getSeekNextPageLinkForMode: getSeekNextPageLinkForMode2,
      getCurrentSeekMode: getCurrentSeekMode2,
      apiSnapshot: apiSnapshot2,
      normalizeOptionalPositiveInt: normalizeOptionalPositiveInt2,
      doc,
      win,
      SELECTORS: SELECTORS2
    } = deps;
    function getPaginationInfo2() {
      const sourceKey = getCurrentSourceKey2();
      if (sourceKey === SOURCE_KEYS2.SEEK) {
        return getSeekPaginationInfo2();
      }
      if (isJob51DetailPage2()) {
        return {
          currentPage: 1,
          totalPages: 1,
          totalItems: isJob51DetailReady2() ? 1 : 0,
          hasNextPage: false
        };
      }
      if (sourceKey === SOURCE_KEYS2.JOB51) {
        const req = apiSnapshot2.job51LastSearchRequest;
        const currentPage2 = normalizeOptionalPositiveInt2(
          req?.page_index ?? req?.pageIndex ?? req?.pageno
        ) || 1;
        const pageSize = normalizeOptionalPositiveInt2(
          req?.page_size ?? req?.pageSize ?? req?.pagesize
        ) || 50;
        const total = typeof apiSnapshot2.job51Total === "number" && apiSnapshot2.job51Total > 0 ? apiSnapshot2.job51Total : 0;
        const hasData = Array.isArray(apiSnapshot2.job51SearchRows) && apiSnapshot2.job51SearchRows.length > 0;
        let totalPages2 = currentPage2;
        if (total > 0) {
          totalPages2 = Math.ceil(total / pageSize);
        } else if (hasData) {
          totalPages2 = currentPage2 + 1;
        }
        return {
          currentPage: currentPage2,
          totalPages: totalPages2,
          totalItems: total,
          hasNextPage: total > 0 ? currentPage2 < totalPages2 : hasData && currentPage2 < totalPages2
        };
      }
      if (isJob5156DetailPage2()) {
        return {
          currentPage: 1,
          totalPages: 1,
          totalItems: isJob5156DetailReady2() ? 1 : 0,
          hasNextPage: false
        };
      }
      const pagination = doc.querySelector(SELECTORS2.pagination);
      if (!pagination)
        return { currentPage: 1, totalPages: 1, totalItems: 0, hasNextPage: false };
      const totalText = pagination.textContent || "";
      const totalMatch = totalText.match(/\u5171\s*([\d,\uff0c]+)\s*\u6761/);
      const totalItems = totalMatch ? Number.parseInt(String(totalMatch[1]).replace(/[\uff0c,]/g, ""), 10) || 0 : 0;
      const activePage = pagination.querySelector(
        ".is-active, .active, .el-pager li.active"
      );
      const currentPage = activePage ? Number.parseInt(activePage.textContent || "", 10) || 1 : 1;
      const pagerItems = Array.from(pagination.querySelectorAll(".el-pager li"));
      const pageNumbers = pagerItems.map((item) => Number.parseInt(item.textContent || "", 10)).filter((value) => Number.isFinite(value) && value > 0);
      const totalPagesFromPager = pageNumbers.length > 0 ? Math.max(...pageNumbers) : 0;
      const totalPagesFromTotal = totalItems > 0 ? Math.ceil(totalItems / 20) : 0;
      const totalPages = Math.max(
        totalPagesFromTotal,
        totalPagesFromPager,
        currentPage
      );
      return {
        currentPage,
        totalPages,
        totalItems,
        hasNextPage: totalPages > currentPage
      };
    }
    __name(getPaginationInfo2, "getPaginationInfo");
    function getNextPageButtonState2() {
      const sourceKey = getCurrentSourceKey2();
      if (sourceKey === SOURCE_KEYS2.SEEK) {
        const nextBtn2 = getSeekNextPageLinkForMode2();
        if (!nextBtn2) {
          return {
            exists: false
          };
        }
        return {
          exists: true,
          text: nextBtn2.textContent || "",
          href: nextBtn2.getAttribute("href") || "",
          className: nextBtn2.className || "",
          disabledAttr: nextBtn2.getAttribute("disabled") || "",
          ariaDisabled: nextBtn2.getAttribute("aria-disabled") || "",
          isDisabledClass: nextBtn2.classList.contains("disabled"),
          isIsDisabledClass: nextBtn2.classList.contains("is-disabled")
        };
      }
      if (sourceKey === SOURCE_KEYS2.JOB51) {
        const pagination = getPaginationInfo2();
        return {
          exists: pagination.hasNextPage,
          source: "51job-api",
          currentPage: pagination.currentPage,
          totalPages: pagination.totalPages,
          hasNextPage: pagination.hasNextPage
        };
      }
      const nextBtn = doc.querySelector(SELECTORS2.nextPageBtn);
      if (!nextBtn) {
        return {
          exists: false
        };
      }
      return {
        exists: true,
        text: nextBtn.textContent || "",
        href: nextBtn.getAttribute("href") || "",
        className: nextBtn.className || "",
        disabledAttr: nextBtn.getAttribute("disabled") || "",
        ariaDisabled: nextBtn.getAttribute("aria-disabled") || "",
        isDisabledClass: nextBtn.classList.contains("disabled"),
        isIsDisabledClass: nextBtn.classList.contains("is-disabled")
      };
    }
    __name(getNextPageButtonState2, "getNextPageButtonState");
    function waitForPagination2({ timeoutMs = 8e3 } = {}) {
      if (getCurrentSourceKey2() === SOURCE_KEYS2.JOB51) {
        return Promise.resolve(true);
      }
      return new Promise((resolve, reject) => {
        let done = false;
        const deadline = Date.now() + timeoutMs;
        const check = /* @__PURE__ */ __name(() => {
          if (done) return;
          const isSeek = getCurrentSourceKey2() === SOURCE_KEYS2.SEEK;
          const seekTalentSearch = isSeek && getCurrentSeekMode2() === "talentsearch";
          const pagination = doc.querySelector(
            isSeek ? seekTalentSearch ? SELECTORS2.seekTalentSearchPagination : SELECTORS2.seekPagination : SELECTORS2.pagination
          );
          const nextBtn = isSeek ? getSeekNextPageLinkForMode2() : doc.querySelector(SELECTORS2.nextPageBtn);
          if (pagination && nextBtn) {
            done = true;
            cleanup();
            resolve(true);
          } else if (Date.now() > deadline) {
            done = true;
            cleanup();
            reject(new Error("Timed out waiting for pagination controls"));
          }
        }, "check");
        const cleanup = /* @__PURE__ */ __name(() => {
          clearInterval(intervalId);
          observer.disconnect();
        }, "cleanup");
        const intervalId = setInterval(check, 300);
        const observer = new MutationObserver(check);
        observer.observe(doc.body || doc.documentElement, {
          childList: true,
          subtree: true
        });
        check();
      });
    }
    __name(waitForPagination2, "waitForPagination");
    return {
      getPaginationInfo: getPaginationInfo2,
      getNextPageButtonState: getNextPageButtonState2,
      waitForPagination: waitForPagination2
    };
  }
  __name(createPaginationUtils, "createPaginationUtils");

  // src/lib/dom-utils.ts
  function createDomUtils(deps) {
    const { win, doc, getPaginationInfo: getPaginationInfo2 } = deps;
    function waitForPageTransition2(options = {}) {
      const { expectedPage, timeoutMs = 15e3 } = options;
      return new Promise((resolve, reject) => {
        if (!Number.isFinite(expectedPage) || expectedPage < 1) {
          reject(new Error("Invalid expected page"));
          return;
        }
        let done = false;
        const deadline = Date.now() + timeoutMs;
        const check = /* @__PURE__ */ __name(() => {
          if (done) return;
          const pagination = getPaginationInfo2();
          if (pagination.currentPage === expectedPage) {
            done = true;
            cleanup();
            resolve(pagination.currentPage);
          } else if (Date.now() > deadline) {
            done = true;
            cleanup();
            reject(new Error(`Timed out waiting for page ${expectedPage}`));
          }
        }, "check");
        const cleanup = /* @__PURE__ */ __name(() => {
          clearInterval(intervalId);
          observer.disconnect();
        }, "cleanup");
        const intervalId = setInterval(check, 300);
        const observer = new MutationObserver(check);
        observer.observe(doc.body || doc.documentElement, {
          childList: true,
          subtree: true,
          attributes: true
        });
        check();
      });
    }
    __name(waitForPageTransition2, "waitForPageTransition");
    function isElementVisible2(element) {
      if (!element) return false;
      const style = win.getComputedStyle(element);
      return style.display !== "none" && style.visibility !== "hidden";
    }
    __name(isElementVisible2, "isElementVisible");
    function asHTMLElement2(element) {
      return element instanceof HTMLElement ? element : null;
    }
    __name(asHTMLElement2, "asHTMLElement");
    function setInputValue2(input, value) {
      const inputWindow = input?.ownerDocument?.defaultView || win;
      const inputCtor = inputWindow.HTMLInputElement || globalThis.HTMLInputElement;
      const descriptor = inputCtor ? Object.getOwnPropertyDescriptor(inputCtor.prototype, "value") : null;
      if (descriptor?.set) {
        descriptor.set.call(input, value);
      } else {
        input.value = value;
      }
      input.dispatchEvent(new inputWindow.Event("input", { bubbles: true }));
      input.dispatchEvent(new inputWindow.Event("change", { bubbles: true }));
    }
    __name(setInputValue2, "setInputValue");
    function fireMouseEvent2(target, type) {
      try {
        const targetWindow = target?.ownerDocument?.defaultView || win;
        target.dispatchEvent(
          new targetWindow.MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            view: targetWindow
          })
        );
      } catch {
      }
    }
    __name(fireMouseEvent2, "fireMouseEvent");
    function activateElement2(target) {
      if (!target) {
        return;
      }
      ["mouseenter", "mouseover", "mousedown", "mouseup"].forEach(
        (type) => fireMouseEvent2(target, type)
      );
      target.click?.();
    }
    __name(activateElement2, "activateElement");
    function findVueParentByName2(node, componentName, { maxDepth = 8 } = {}) {
      let vm = node?.__vue__ || null;
      for (let depth = 0; vm && depth < maxDepth; depth += 1) {
        if (vm?.$options?.name === componentName) {
          return vm;
        }
        vm = vm?.$parent || null;
      }
      return null;
    }
    __name(findVueParentByName2, "findVueParentByName");
    return {
      waitForPageTransition: waitForPageTransition2,
      isElementVisible: isElementVisible2,
      asHTMLElement: asHTMLElement2,
      setInputValue: setInputValue2,
      fireMouseEvent: fireMouseEvent2,
      activateElement: activateElement2,
      findVueParentByName: findVueParentByName2
    };
  }
  __name(createDomUtils, "createDomUtils");
  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  __name(delay, "delay");

  // src/lib/resume-extractor.ts
  var AUTO_SEARCH_PROFILE_ID_PARAM = "tr_search_profile_id";
  function createResumeExtractor(deps) {
    const {
      SELECTORS: SELECTORS2,
      JOB5156_HOST: JOB5156_HOST2,
      doc,
      getCurrentSourceKey: getCurrentSourceKey2,
      SOURCE_KEYS: SOURCE_KEYS2,
      parseJob5156BasicInfoItems: parseJob5156BasicInfoItems2,
      buildJob5156WorkHistoryItem: buildJob5156WorkHistoryItem2,
      buildJob5156EducationItem: buildJob5156EducationItem2,
      isJob51DetailPage: isJob51DetailPage2,
      isJob5156DetailPage: isJob5156DetailPage2,
      isJob51DetailReady: isJob51DetailReady2,
      isJob5156DetailReady: isJob5156DetailReady2,
      getJob51DetailRoot: getJob51DetailRoot2,
      getJob5156DetailRoot: getJob5156DetailRoot2,
      getJob51ResumePayload,
      getJob5156ResumePayload,
      normalizeResumeText: normalizeResumeText2,
      normalizeResumeMultilineText: normalizeResumeMultilineText2,
      applyCollectionGuards: applyCollectionGuards2,
      parseGuardFieldNames: parseGuardFieldNames2,
      GUARD_FIELD_NAMES: GUARD_FIELD_NAMES2,
      DEFAULT_COLLECTION_GUARDS: DEFAULT_COLLECTION_GUARDS2,
      apiSnapshot: apiSnapshot2,
      JOB5156_PROFILE_URL_PREFIX: JOB5156_PROFILE_URL_PREFIX2,
      normalizeJob5156ProfileUrlForExport: normalizeJob5156ProfileUrlForExport2,
      win,
      normalizeKeyword: normalizeKeyword2,
      AUTO_SEARCH_PARAM: AUTO_SEARCH_PARAM2,
      getAutoLocationValues: getAutoLocationValues2,
      AUTO_EXPORT_PARAM: AUTO_EXPORT_PARAM2,
      AUTO_SYNC_PARAM: AUTO_SYNC_PARAM2,
      AUTO_LIMIT_PARAM: AUTO_LIMIT_PARAM2,
      AUTO_MAX_PAGES_PARAM: AUTO_MAX_PAGES_PARAM2,
      SAMPLE_NAME_PARAM: SAMPLE_NAME_PARAM2,
      getExtensionGeneratedBy: getExtensionGeneratedBy2,
      buildSeekCollectionContext: buildSeekCollectionContext2
    } = deps;
    function getApiRowForIndex2(index) {
      if (!Array.isArray(apiSnapshot2.searchRows)) return null;
      return apiSnapshot2.searchRows[index] || null;
    }
    __name(getApiRowForIndex2, "getApiRowForIndex");
    function isPlaceholderProfileUrl(value) {
      if (!value) return true;
      const normalized = String(value).trim().toLowerCase();
      return normalized === "" || normalized === "#" || normalized.startsWith("javascript:") || normalized === "about:blank";
    }
    __name(isPlaceholderProfileUrl, "isPlaceholderProfileUrl");
    function toAbsoluteHttpUrl(value) {
      if (!value || typeof value !== "string") return "";
      try {
        const url = new URL(value, win.location.origin);
        if (url.protocol !== "http:" && url.protocol !== "https:") return "";
        if (isPlaceholderProfileUrl(url.href)) return "";
        return url.href;
      } catch {
        return "";
      }
    }
    __name(toAbsoluteHttpUrl, "toAbsoluteHttpUrl");
    function buildProfileUrlFromApiRow(apiRow) {
      if (!apiRow || typeof apiRow !== "object") return "";
      const resumeId = apiRow.resumeId;
      if (resumeId === null || resumeId === void 0 || resumeId === "") return "";
      const encodedId = encodeURIComponent(String(resumeId));
      return `${JOB5156_PROFILE_URL_PREFIX2}${encodedId}`;
    }
    __name(buildProfileUrlFromApiRow, "buildProfileUrlFromApiRow");
    function extractProfileUrl2(card, apiRow) {
      const nameLink = card.querySelector(SELECTORS2.name);
      if (!nameLink) return buildProfileUrlFromApiRow(apiRow);
      const candidates = [
        nameLink.getAttribute("href"),
        nameLink.getAttribute("data-href"),
        nameLink.getAttribute("data-url"),
        nameLink.getAttribute("data-link"),
        nameLink.href
      ];
      for (const candidate of candidates) {
        const normalized = toAbsoluteHttpUrl(candidate);
        if (normalized) return normalizeJob5156ProfileUrlForExport2(normalized);
      }
      return buildProfileUrlFromApiRow(apiRow);
    }
    __name(extractProfileUrl2, "extractProfileUrl");
    function buildSubmitMetadata2(options = {}) {
      const url = new URL(win.location.href);
      const sourceKey = getCurrentSourceKey2();
      const searchProfileId = url.searchParams.get(AUTO_SEARCH_PROFILE_ID_PARAM)?.trim() || "";
      const keyword = normalizeKeyword2(
        url.searchParams.get(AUTO_SEARCH_PARAM2) || ""
      );
      const location = getAutoLocationValues2(url).join(",");
      url.searchParams.delete(AUTO_EXPORT_PARAM2);
      url.searchParams.delete(AUTO_SYNC_PARAM2);
      url.searchParams.delete(AUTO_LIMIT_PARAM2);
      url.searchParams.delete(AUTO_MAX_PAGES_PARAM2);
      url.searchParams.delete(AUTO_SEARCH_PROFILE_ID_PARAM);
      url.searchParams.delete(SAMPLE_NAME_PARAM2);
      const metadata = {
        sourceKey,
        sourceHost: url.hostname.toLowerCase(),
        sourceUrl: url.toString(),
        generatedBy: getExtensionGeneratedBy2()
      };
      if (keyword) metadata.keyword = keyword;
      if (location) metadata.location = location;
      if (searchProfileId) metadata.searchProfileId = searchProfileId;
      if (sourceKey === SOURCE_KEYS2.SEEK) {
        metadata.collectionContext = buildSeekCollectionContext2({
          captureModeOverride: options.seekCaptureMode
        });
      }
      return metadata;
    }
    __name(buildSubmitMetadata2, "buildSubmitMetadata");
    function extractSingleResume2(card, apiRow = null) {
      const getText = /* @__PURE__ */ __name((selector, root = card) => {
        const el = root.querySelector(selector);
        return el ? el.textContent?.trim() || "" : "";
      }, "getText");
      const pickText = /* @__PURE__ */ __name((selectors) => {
        for (const selector of selectors) {
          const text = getText(selector);
          if (text) return text;
        }
        return "";
      }, "pickText");
      const basicInfoContainer = card.querySelector(SELECTORS2.basicInfoRow) || card.querySelector(".list-content__li__down-left-center");
      const locationFromCard = getText(SELECTORS2.locationItem, basicInfoContainer || card) || getText(SELECTORS2.locationFallbackItem, basicInfoContainer || card);
      const basicInfoSpans = basicInfoContainer ? basicInfoContainer.querySelectorAll(
        `${SELECTORS2.basicInfoItem}, div:nth-child(2) span, .basic-line span`
      ) : [];
      const basicInfo = Array.from(basicInfoSpans).map(
        (span) => span.textContent || ""
      );
      const { age, experience, education, location } = parseJob5156BasicInfoItems2(
        basicInfo,
        locationFromCard
      );
      const topRow = card.querySelector(SELECTORS2.topRowText) || card.querySelector(SELECTORS2.topRow);
      const topRowText = topRow ? topRow.textContent?.trim().replace(/\s+/g, " ") || "" : "";
      const topRowClean = topRowText.split("\u4EBA\u624D\u6D1E\u5BDF")[0].replace(/\u00b7\s*$/, "").trim();
      let expectedSalary = "";
      const salaryMatch = topRowClean.match(
        /(\d[\d-]*\s*\u5143\/\u6708|\d[\d-]*\s*\u5143|\u9762\u8bae)/
      );
      if (salaryMatch) expectedSalary = salaryMatch[0].replace(/\s+/g, "");
      let jobIntention = topRowClean.replace(/^\u6c42\u804c\u610f\u5411[:\uff1a]?\s*/, "");
      jobIntention = jobIntention.replace(/\uff08\u901a\u52e4\u8ddd\u79bb[^\uff09]*\uff09/g, "").trim();
      if (expectedSalary) {
        jobIntention = jobIntention.replace(expectedSalary, "").replace(/[\u00b7\s]+$/g, "").trim();
      }
      const selfIntro = pickText([
        SELECTORS2.selfIntro,
        ".basic-keywords",
        ".basic-keywords span"
      ]);
      const workHistoryContainer = card.querySelector(SELECTORS2.workHistory) || card.querySelector(".list-content__li__down-right-center");
      let workItems = [];
      let educationItems = [];
      if (workHistoryContainer) {
        const primary = workHistoryContainer.querySelectorAll(SELECTORS2.workItem);
        if (primary.length > 0) {
          workItems = Array.from(primary);
          educationItems = Array.from(
            workHistoryContainer.querySelectorAll(".school-item")
          );
        } else {
          workItems = Array.from(
            workHistoryContainer.querySelectorAll('div[class*="history"]')
          );
        }
      }
      const seenWorkHistory = /* @__PURE__ */ new Set();
      const workHistory = workItems.map((item) => buildJob5156WorkHistoryItem2(item)).filter((item) => item && item.raw.length > 5).filter((item) => {
        if (!item || seenWorkHistory.has(item.raw)) return false;
        seenWorkHistory.add(item.raw);
        return true;
      });
      const seenEducation = /* @__PURE__ */ new Set();
      const profileEducation = educationItems.map((item) => buildJob5156EducationItem2(item)).filter(
        (item) => item && [item.institution, item.qualification, item.endDate].some(Boolean)
      ).filter((item) => {
        const signature = [
          item.institution || "",
          item.qualification || "",
          item.endDate || ""
        ].join("|");
        if (seenEducation.has(signature)) return false;
        seenEducation.add(signature);
        return true;
      });
      return {
        name: getText(SELECTORS2.name),
        profileUrl: extractProfileUrl2(card, apiRow),
        activityStatus: getText(SELECTORS2.activityStatus),
        age,
        experience,
        education,
        location,
        jobIntention,
        expectedSalary,
        selfIntro,
        workHistory,
        profileEducation: profileEducation.length > 0 ? profileEducation : void 0,
        extractedAt: (/* @__PURE__ */ new Date()).toISOString(),
        source: JOB5156_HOST2
      };
    }
    __name(extractSingleResume2, "extractSingleResume");
    return {
      extractSingleResume: extractSingleResume2,
      getApiRowForIndex: getApiRowForIndex2,
      isPlaceholderProfileUrl,
      extractProfileUrl: extractProfileUrl2,
      buildSubmitMetadata: buildSubmitMetadata2
    };
  }
  __name(createResumeExtractor, "createResumeExtractor");

  // src/lib/content-constants.ts
  var SELECTORS = {
    listContainer: ".el-checkbox-group.resume-search-item-list-content-block",
    resumeCard: ".list-content__li_part",
    name: ".item-title-part1 a.name, a.name",
    activityStatus: ".date-type-diff-text-block",
    basicInfoRow: ".basic-line",
    basicInfoItem: ".basic-line__text",
    locationItem: ".resume-search-item-search-addre__span",
    locationFallbackItem: ".text-truncate.text-center",
    selfIntro: ".basic-keywords",
    topRow: ".list-content__li__up-block",
    topRowText: ".up-block__look-text",
    workHistory: ".work-block",
    workItem: ".work-item",
    pagination: ".el-pagination",
    nextPageBtn: ".el-pagination .btn-next",
    seekPagination: 'nav[aria-label="Pagination of results"]',
    seekTalentSearchPagination: 'nav[aria-label="PAGINATION_OF_RESULTS"]',
    searchInput: ".el-autocomplete input.el-input__inner",
    searchButton: ".resume-search-item-search-input-block__input-button",
    // 51job eHire selectors
    job51SearchInput: ".talent_search_keywords_input input.el-input__inner",
    job51SearchButton: "button.search_button",
    // Area selector (location filter modal)
    areaTrigger: ".resume-search-item-search-addre",
    areaModal: ".area-selector-item-block",
    areaProvinceBlock: ".area-selector-item-block__content__down__blcok:first-child",
    areaCityBlock: ".area-selector-item-block__content__down__blcok:nth-child(2)",
    areaDistrictBlock: ".area-selector-item-block__content__down__blcok:nth-child(3)",
    areaItem: ".down__blcok__select",
    areaDistrictItem: ".down__block__big-select__block",
    areaConfirmBtn: ".area-selector-item-block__footer .button-block.blue",
    areaCancelBtn: ".area-selector-item-block__footer .button-block:not(.blue)",
    areaSelectedCount: ".content__up__number__select"
  };
  var AUTO_EXPORT_PARAM = "tr_auto_export";
  var AUTO_SYNC_PARAM = "tr_auto_sync";
  var AUTO_LIMIT_PARAM = "tr_limit";
  var AUTO_MAX_PAGES_PARAM = "tr_max_pages";
  var AUTO_MIN_AGE_PARAM = "tr_min_age";
  var AUTO_MAX_AGE_PARAM = "tr_max_age";
  var AUTO_SEARCH_PARAM = "keyword";
  var AUTO_LOCATION_PARAM = "location";
  var AUTO_KEYWORD_MODE_PARAM = "tr_kw_mode";
  var SAMPLE_NAME_PARAM = "tr_sample_name";
  var JOB5156_HOST = "hr.job5156.com";
  var SEEK_HOST_SUFFIX = ".employer.seek.com";
  var JOB5156_PROFILE_URL_PREFIX = `https://${JOB5156_HOST}/resume/view/`;
  var SOURCE_KEYS = {
    JOB5156: "job5156",
    JOB51: "51job",
    SEEK: "seek",
    UNKNOWN: "unknown"
  };
  var SEEK_PROFILE_TYPE = "seek";
  var KEYWORD_MODE_CONCAT = "concat";
  var KEYWORD_MODE_SPACED = "spaced";
  var JOB51_PAGE_COOLDOWN_MS = 8e3;
  var JOB51_RATE_LIMIT_ERROR_MESSAGE = "51job \u5DF2\u89E6\u53D1\u8BBF\u95EE\u9891\u7387\u9650\u5236\uFF0C\u8BF760\u5206\u949F\u540E\u518D\u8BD5";
  var API_CAPTURE_SOURCE = "tr-resume-api";
  var EXTERNAL_ACCESS_KEY = "__TR_RESUME_DATA__";
  var PAGE_BRIDGE_REQUEST_EVENT = "trResumeBridgeRequest";
  var PAGE_BRIDGE_RESPONSE_EVENT = "trResumeBridgeResponse";
  var PAGE_BRIDGE_REQUEST_ATTR = "data-tr-resume-bridge-request";
  var PAGE_BRIDGE_RESPONSE_ATTR = "data-tr-resume-bridge-response";
  var JOB51_NEXT_PAGE_EVENT = "trJob51NextPageRequest";
  var CONTENT_SCRIPT_SOURCE = "tr-resume-content-script";
  var JOB5156_DETAIL_FETCH_TIMEOUT_MS = 5e3;
  var JOB5156_DETAIL_FETCH_CONCURRENCY = 5;
  var JOB51_DETAIL_FETCH_TIMEOUT_MS = 8e3;
  var JOB51_DETAIL_FETCH_CONCURRENCY = 2;
  var SEEK_DETAIL_FETCH_CONCURRENCY = 3;
  var SEEK_DETAIL_FETCH_DELAY_MS = 1e3;
  var SEEK_TALENTSEARCH_DETAIL_FETCH_CONCURRENCY = 1;
  var SEEK_TALENTSEARCH_DETAIL_FETCH_DELAY_MS = 200;
  var SEEK_TALENTSEARCH_DETAIL_TIMEOUT_MS = 4e3;
  var SEEK_DETAIL_PARAM = "tr_seek_detail";
  var DEFAULT_SEEK_PAGE_SIZE = 20;
  var LATEST_AUTO_SYNC_SUMMARIES_STORAGE_KEY = "latestAutoSyncSummaries";

  // src/lib/page-bridge.ts
  function createPageBridge(deps) {
    const {
      doc,
      win,
      extractResumes: extractResumes2,
      extractResumesRaw: extractResumesRaw2,
      collectSnapshotPayload: collectSnapshotPayload2,
      getApiSnapshot,
      getPaginationInfo: getPaginationInfo2,
      isExtractionReady: isExtractionReady2,
      isLoggedIn: isLoggedIn2,
      syncCurrentPageToServer: syncCurrentPageToServer2,
      goToNextPageInternal: goToNextPageInternal2
    } = deps;
    function installPageBridgeListener() {
      win.addEventListener(PAGE_BRIDGE_REQUEST_EVENT, async () => {
        const requestPayload = doc.documentElement.getAttribute(
          PAGE_BRIDGE_REQUEST_ATTR
        );
        if (!requestPayload) return;
        let response = {
          id: null,
          ok: false,
          error: "Invalid bridge request",
          value: void 0
        };
        try {
          const request = JSON.parse(requestPayload);
          const requestId = request?.id ?? null;
          const method = typeof request?.method === "string" ? request.method : "";
          const args = Array.isArray(request?.args) ? request.args : [];
          response.id = requestId;
          switch (method) {
            case "extract":
              response = {
                id: requestId,
                ok: true,
                error: "",
                value: extractResumes2()
              };
              break;
            case "extractRaw":
              response = {
                id: requestId,
                ok: true,
                error: "",
                value: extractResumesRaw2(args[0])
              };
              break;
            case "collect":
              response = {
                id: requestId,
                ok: true,
                error: "",
                value: await collectSnapshotPayload2(args[0])
              };
              break;
            case "getApiSnapshot":
              response = {
                id: requestId,
                ok: true,
                error: "",
                value: getApiSnapshot()
              };
              break;
            case "getPaginationInfo":
              response = {
                id: requestId,
                ok: true,
                error: "",
                value: getPaginationInfo2()
              };
              break;
            case "isReady":
              response = {
                id: requestId,
                ok: true,
                error: "",
                value: isExtractionReady2()
              };
              break;
            case "isLoggedIn":
              response = {
                id: requestId,
                ok: true,
                error: "",
                value: isLoggedIn2()
              };
              break;
            case "status":
              response = {
                id: requestId,
                ok: true,
                error: "",
                value: win[EXTERNAL_ACCESS_KEY]?.status?.()
              };
              break;
            case "syncToServer":
              response = {
                id: requestId,
                ok: true,
                error: "",
                value: await syncCurrentPageToServer2(args[0])
              };
              break;
            case "goToNextPage":
              response = {
                id: requestId,
                ok: true,
                error: "",
                value: goToNextPageInternal2()
              };
              break;
            default:
              response = {
                id: requestId,
                ok: false,
                error: method ? `Unsupported bridge method: ${method}` : "Missing bridge method",
                value: void 0
              };
              break;
          }
        } catch (error) {
          response = {
            ...response,
            ok: false,
            error: error instanceof Error ? error.message : String(error)
          };
        }
        doc.documentElement.setAttribute(
          PAGE_BRIDGE_RESPONSE_ATTR,
          JSON.stringify(response)
        );
        win.dispatchEvent(new CustomEvent(PAGE_BRIDGE_RESPONSE_EVENT));
      });
    }
    __name(installPageBridgeListener, "installPageBridgeListener");
    return { installPageBridgeListener };
  }
  __name(createPageBridge, "createPageBridge");

  // src/lib/chrome-message-handler.ts
  function createChromeMessageHandler(deps) {
    const {
      extractResumes: extractResumes2,
      getPaginationInfo: getPaginationInfo2,
      buildSubmitMetadata: buildSubmitMetadata2,
      resumesToCSV: resumesToCSV2,
      makeRandomId: makeRandomId2,
      downloadFile: downloadFile2,
      buildExportMetadata: buildExportMetadata2,
      buildExportFilename: buildExportFilename2,
      getExternalAccessorStatus: getExternalAccessorStatus3
    } = deps;
    function installChromeMessageListener() {
      chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
        if (request.action === "extractCurrentPage") {
          const resumes = extractResumes2();
          const pagination = getPaginationInfo2();
          const metadata = buildSubmitMetadata2();
          sendResponse({
            success: true,
            data: resumes,
            count: resumes.length,
            pagination,
            metadata
          });
        } else if (request.action === "downloadCSV") {
          const resumes = extractResumes2();
          const csv = resumesToCSV2(resumes);
          const timestamp = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
          const filename = `resumes_${timestamp}_${makeRandomId2()}.csv`;
          const saveAs = !!request.saveAs;
          downloadFile2(csv, filename, "text/csv", saveAs).then(
            () => sendResponse({ success: true, count: resumes.length, filename })
          ).catch((err) => sendResponse({ success: false, error: err.message }));
          return true;
        } else if (request.action === "downloadJSON") {
          const resumes = extractResumes2();
          const metadata = buildExportMetadata2(resumes);
          const payload = { metadata, data: resumes };
          const json = JSON.stringify(payload, null, 2);
          const filename = buildExportFilename2();
          const saveAs = !!request.saveAs;
          downloadFile2(json, filename, "application/json", saveAs).then(
            () => sendResponse({ success: true, count: resumes.length, filename })
          ).catch((err) => sendResponse({ success: false, error: err.message }));
          return true;
        } else if (request.action === "getPaginationInfo") {
          sendResponse(getPaginationInfo2());
        } else if (request.action === "getRuntimeStatus") {
          sendResponse({
            success: true,
            status: getExternalAccessorStatus3()
          });
        } else if (request.action === "ping") {
          sendResponse({ success: true, message: "Content script loaded" });
        }
        return true;
      });
    }
    __name(installChromeMessageListener, "installChromeMessageListener");
    return { installChromeMessageListener };
  }
  __name(createChromeMessageHandler, "createChromeMessageHandler");

  // src/lib/sync-status-widget.ts
  function createSyncStatusWidget(deps) {
    const {
      win,
      doc,
      chrome: chrome2,
      onCancel
    } = deps;
    const WIDGET_ID = "tr-sync-status-widget";
    const DEFAULT_AUTO_DISMISS_MS = 5e3;
    const HIDE_DELAY_MS = 220;
    let widgetEl = null;
    let dismissTimer = null;
    let hideTimer = null;
    function escapeHtml(value) {
      return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    }
    __name(escapeHtml, "escapeHtml");
    function clearTimers() {
      if (dismissTimer) {
        clearTimeout(dismissTimer);
        dismissTimer = null;
      }
      if (hideTimer) {
        clearTimeout(hideTimer);
        hideTimer = null;
      }
    }
    __name(clearTimers, "clearTimers");
    function ensureWidget() {
      if (widgetEl && widgetEl.isConnected) return widgetEl;
      widgetEl = doc.createElement("div");
      widgetEl.id = WIDGET_ID;
      widgetEl.className = "tr-sync-widget";
      widgetEl.setAttribute("role", "status");
      widgetEl.setAttribute("aria-live", "polite");
      widgetEl.setAttribute("aria-atomic", "true");
      const mountTarget = doc.body || doc.documentElement;
      mountTarget.appendChild(widgetEl);
      return widgetEl;
    }
    __name(ensureWidget, "ensureWidget");
    function renderIcon(state) {
      if (state === "progress") {
        return '<span class="tr-sync-widget__spinner" aria-hidden="true"></span>';
      }
      if (state === "success") {
        return '<span aria-hidden="true">\u2713</span>';
      }
      return '<span aria-hidden="true">!</span>';
    }
    __name(renderIcon, "renderIcon");
    function openOptionsPage() {
      try {
        void chrome2.runtime.sendMessage({ action: "openOptionsPage" }).catch((error) => {
          console.warn("\u{1F3AF} [Auto Sync] Failed to open options page:", error);
        });
      } catch (error) {
        console.warn("\u{1F3AF} [Auto Sync] Failed to request options page:", error);
      }
    }
    __name(openOptionsPage, "openOptionsPage");
    function show({
      state = "progress",
      message = "",
      hint = "",
      autoDismiss = false
    } = {}) {
      const normalizedState = state === "success" || state === "error" ? state : "progress";
      const safeMessage = escapeHtml(message);
      const safeHint = escapeHtml(hint);
      const widget = ensureWidget();
      clearTimers();
      widget.className = `tr-sync-widget tr-sync-widget--${normalizedState}`;
      widget.classList.remove("tr-sync-widget--hidden");
      widget.innerHTML = `
      <div class="tr-sync-widget__icon">${renderIcon(normalizedState)}</div>
      <div class="tr-sync-widget__content">
        <div class="tr-sync-widget__message">${safeMessage}</div>
        ${safeHint ? `<div class="tr-sync-widget__hint">${safeHint}</div>` : ""}
      </div>
      ${normalizedState === "progress" ? '<button type="button" class="tr-sync-widget__cancel" aria-label="\u53D6\u6D88\u540C\u6B65">\u53D6\u6D88</button>' : normalizedState === "error" ? '<button type="button" class="tr-sync-widget__close" aria-label="\u5173\u95ED\u63D0\u793A">\xD7</button>' : ""}
    `;
      widget.onclick = null;
      if (normalizedState === "progress") {
        const cancelBtn = widget.querySelector(".tr-sync-widget__cancel");
        cancelBtn?.addEventListener("click", (event) => {
          event.stopPropagation();
          onCancel();
          cancelBtn.setAttribute("disabled", "true");
          cancelBtn.textContent = "\u53D6\u6D88\u4E2D...";
        });
      }
      if (normalizedState === "error") {
        widget.onclick = (event) => {
          const target = event.target instanceof Element ? event.target : null;
          if (target?.closest(".tr-sync-widget__close")) return;
          openOptionsPage();
        };
        const closeBtn = widget.querySelector(".tr-sync-widget__close");
        closeBtn?.addEventListener("click", (event) => {
          event.stopPropagation();
          hide();
        });
      }
      const dismissMs = typeof autoDismiss === "number" ? autoDismiss : autoDismiss ? DEFAULT_AUTO_DISMISS_MS : 0;
      if (dismissMs > 0) {
        dismissTimer = setTimeout(() => {
          hide();
        }, dismissMs);
      }
    }
    __name(show, "show");
    function hide() {
      if (!widgetEl) return;
      clearTimers();
      widgetEl.classList.add("tr-sync-widget--hidden");
      hideTimer = setTimeout(() => {
        if (widgetEl) {
          widgetEl.remove();
          widgetEl = null;
        }
        hideTimer = null;
      }, HIDE_DELAY_MS);
    }
    __name(hide, "hide");
    return {
      show,
      hide
    };
  }
  __name(createSyncStatusWidget, "createSyncStatusWidget");

  // src/lib/auto-sync-runner.ts
  function createAutoSyncRunner(deps) {
    const {
      // Auto-actions helpers
      getAutoSyncEnabled: getAutoSyncEnabled2,
      setAutoSyncAttributes: setAutoSyncAttributes2,
      resolveAutoSyncErrorStatus: resolveAutoSyncErrorStatus2,
      resolveAutoSyncStopReason: resolveAutoSyncStopReason2,
      runAutoExportIfEnabled: runAutoExportIfEnabled2,
      syncCurrentPageToServer: syncCurrentPageToServer2,
      // Seek extractor
      setSeekAutoSyncWindowAttributes: setSeekAutoSyncWindowAttributes2,
      setSeekAutoSyncSelectionAttributes: setSeekAutoSyncSelectionAttributes2,
      isSeekProfileMode: isSeekProfileMode2,
      resolveSeekAutoSyncPageWindow: resolveSeekAutoSyncPageWindow2,
      isSeekAutoSyncPageWindowReached: isSeekAutoSyncPageWindowReached2,
      shouldStopSeekAutoSyncForPageWindow: shouldStopSeekAutoSyncForPageWindow2,
      resolveSeekAutoSyncCurrentPageSelection: resolveSeekAutoSyncCurrentPageSelection2,
      getSeekRequestedPageSize: getSeekRequestedPageSize2,
      getSeekCurrentCandidateCount: getSeekCurrentCandidateCount2,
      resolveSeekAutoSyncPageSize: resolveSeekAutoSyncPageSize2,
      enrichSeekResumesWithDetail: enrichSeekResumesWithDetail2,
      // Pagination utils
      getPaginationInfo: getPaginationInfo2,
      waitForPagination: waitForPagination2,
      getNextPageButtonState: getNextPageButtonState2,
      // Extraction pipeline
      waitForExtractionData: waitForExtractionData2,
      extractResumes: extractResumes2,
      goToNextPageInternal: goToNextPageInternal2,
      clearCapturedResultsForNextPage: clearCapturedResultsForNextPage2,
      enrich51JobSearchResumesWithDetail: enrich51JobSearchResumesWithDetail2,
      enrichJob5156SearchResumesWithDetail: enrichJob5156SearchResumesWithDetail2,
      queueJob51DetailBackfill: queueJob51DetailBackfill2,
      // Snapshot collector
      collectSnapshotPayload: collectSnapshotPayload2,
      getApiSnapshotCount: getApiSnapshotCount2,
      // Resume extractor
      buildSubmitMetadata: buildSubmitMetadata2,
      extractProfileUrl: extractProfileUrl2,
      // Collection guards
      loadCollectionGuards: loadCollectionGuards2,
      parseGuardFieldNames: parseGuardFieldNames2,
      applyCollectionGuards: applyCollectionGuards2,
      // Job51 search extractor
      ensureJob51PageAllowed: ensureJob51PageAllowed2,
      isJob51RateLimitedPage: isJob51RateLimitedPage2,
      waitForJob51Cooldown: waitForJob51Cooldown2,
      // Job51 age filter
      filterResumesByAgeRange: filterResumesByAgeRange2,
      getAgeRangeFromUrl: getAgeRangeFromUrl2,
      normalizeOptionalPositiveInt: normalizeOptionalPositiveInt2,
      // UI utils
      buildAutoSyncProgressHint: buildAutoSyncProgressHint2,
      buildAutoSyncSelectedCountHint: buildAutoSyncSelectedCountHint2,
      buildAutoSyncCompletionHint: buildAutoSyncCompletionHint2,
      persistLatestAutoSyncSummary: persistLatestAutoSyncSummary2,
      getCurrentAgeRange: getCurrentAgeRange2,
      resolveCurrentJob51AutoSyncDetailWaitMode: resolveCurrentJob51AutoSyncDetailWaitMode2,
      // Dom utils
      waitForPageTransition: waitForPageTransition2,
      delay: delay2,
      // Content.ts scope helpers
      getCurrentSourceKey: getCurrentSourceKey2,
      SOURCE_KEYS: SOURCE_KEYS2,
      getCollectionLimits: getCollectionLimits2,
      getKeywordMode: getKeywordMode2,
      // Job5156 extractor
      isJob5156DetailPage: isJob5156DetailPage2,
      // Job51 extractor
      isJob51DetailPage: isJob51DetailPage2,
      // SyncStatusWidget
      SyncStatusWidget: SyncStatusWidget2,
      // DOM globals
      document: document2,
      window: window2,
      // Browser API
      chrome: chrome2
    } = deps;
    async function runAutoSyncIfEnabled2() {
      if (deps.state._autoSyncTriggered) return;
      const enabled = getAutoSyncEnabled2();
      if (!enabled) {
        setAutoSyncAttributes2("skipped");
        setSeekAutoSyncWindowAttributes2(null);
        setSeekAutoSyncSelectionAttributes2(null);
        return;
      }
      const { limit, maxPages } = await getCollectionLimits2();
      const isJob51Source = getCurrentSourceKey2() === SOURCE_KEYS2.JOB51;
      deps.state._autoSyncTriggered = true;
      deps.state._autoSyncCancelled = false;
      setAutoSyncAttributes2("running", 0, 0);
      setSeekAutoSyncWindowAttributes2(null);
      setSeekAutoSyncSelectionAttributes2(null);
      try {
        document2.documentElement.setAttribute(
          "data-tr-auto-sync-limit",
          String(limit)
        );
        document2.documentElement.setAttribute(
          "data-tr-auto-sync-max-pages",
          String(maxPages)
        );
      } catch (e) {
        console.warn("[tr-auto-sync]", "runAutoSyncIfEnabled: DOM attribute set failed (limit/maxPages)", e?.message || e);
      }
      SyncStatusWidget2.show({
        state: "progress",
        message: "\u6B63\u5728\u540C\u6B65\u7B80\u5386\u5230\u670D\u52A1\u5668...",
        hint: `${isJob51Source ? "51job \u4FDD\u5B88\u6A21\u5F0F \xB7 " : ""}\u6570\u91CF\u4E0A\u9650: ${limit > 0 ? limit : "\u4E0D\u9650"} \xB7 \u9875\u6570\u4E0A\u9650: ${maxPages > 0 ? maxPages : "\u4E0D\u9650"}`
      });
      try {
        let totalSubmitted = 0;
        let totalInserted = 0;
        let totalUpdated = 0;
        let pagesVisited = 0;
        let lastSelectedCount = null;
        let stopReason = "completed";
        let seekStartPage = null;
        while (true) {
          if (deps.state._autoSyncCancelled) {
            stopReason = "cancelled";
            break;
          }
          ensureJob51PageAllowed2();
          const paginationBefore = getPaginationInfo2();
          const currentPage = paginationBefore.currentPage;
          const totalPages = paginationBefore.totalPages;
          const isSeekListPage = getCurrentSourceKey2() === SOURCE_KEYS2.SEEK && !isSeekProfileMode2();
          if (isSeekListPage && seekStartPage === null) {
            seekStartPage = currentPage;
          }
          try {
            await waitForExtractionData2({});
          } catch {
            console.warn(
              "\u{1F3AF} [Auto Sync] waitForExtractionData timed out \u2014 continuing"
            );
          }
          ensureJob51PageAllowed2();
          pagesVisited += 1;
          const seekPageWindow = isSeekListPage ? resolveSeekAutoSyncPageWindow2({
            startPage: seekStartPage || currentPage,
            limit,
            maxPages,
            requestedPageSize: getSeekRequestedPageSize2(),
            currentPageCandidateCount: getSeekCurrentCandidateCount2()
          }) : null;
          setSeekAutoSyncWindowAttributes2(seekPageWindow);
          const pageSelection = isSeekListPage ? resolveSeekAutoSyncCurrentPageSelection2({
            limit,
            totalSubmitted,
            currentPageResumeCount: getSeekCurrentCandidateCount2()
          }) : {
            remainingCapacity: limit > 0 ? Math.max(limit - totalSubmitted, 0) : null,
            selectedCount: null,
            hitLimitWithinPage: false,
            limitAlreadyReached: limit > 0 ? Math.max(limit - totalSubmitted, 0) <= 0 : false
          };
          setSeekAutoSyncSelectionAttributes2(isSeekListPage ? pageSelection : null);
          if (isSeekListPage && pageSelection.limitAlreadyReached || !isSeekListPage && limit > 0 && pageSelection.limitAlreadyReached) {
            stopReason = "limit-reached";
            break;
          }
          let resumes = extractResumes2();
          const hitLimitWithinPage = isSeekListPage ? pageSelection.hitLimitWithinPage : limit > 0 && typeof pageSelection.remainingCapacity === "number" && resumes.length > pageSelection.remainingCapacity;
          if (isSeekListPage && typeof pageSelection.selectedCount === "number") {
            resumes = resumes.slice(0, pageSelection.selectedCount);
          } else if (limit > 0 && typeof pageSelection.remainingCapacity === "number" && resumes.length > pageSelection.remainingCapacity) {
            resumes = resumes.slice(0, pageSelection.remainingCapacity);
          }
          lastSelectedCount = isSeekListPage ? resumes.length : null;
          if (getCurrentSourceKey2() === SOURCE_KEYS2.JOB5156 && !isJob5156DetailPage2() && resumes.length > 0) {
            resumes = await enrichJob5156SearchResumesWithDetail2(resumes);
          }
          if (getCurrentSourceKey2() === SOURCE_KEYS2.SEEK && !isSeekProfileMode2() && resumes.length > 0) {
            resumes = await enrichSeekResumesWithDetail2(resumes);
          }
          if (resumes.length <= 0) {
            const ageRange = getCurrentAgeRange2();
            const ageHint = ageRange.enabled ? ` \xB7 \u5E74\u9F84: ${typeof ageRange.minAge === "number" ? ageRange.minAge : "\u2014"}-${typeof ageRange.maxAge === "number" ? ageRange.maxAge : "\u2014"}` : "";
            const progressHint2 = buildAutoSyncProgressHint2({
              limit,
              totalSubmitted,
              selectedCount: isSeekListPage ? resumes.length : null,
              ageHint
            });
            SyncStatusWidget2.show({
              state: "progress",
              message: `\u7B2C ${currentPage}/${Math.max(totalPages, currentPage)} \u9875\u65E0\u7B26\u5408\u6761\u4EF6\u7684\u7B80\u5386\uFF0C\u7EE7\u7EED...`,
              hint: progressHint2
            });
            setAutoSyncAttributes2("running", totalSubmitted, pagesVisited);
            if (deps.state._autoSyncCancelled) {
              stopReason = "cancelled";
              break;
            }
            if (isSeekListPage && shouldStopSeekAutoSyncForPageWindow2({
              pageWindowReached: isSeekAutoSyncPageWindowReached2(seekPageWindow, currentPage),
              limit,
              totalSubmitted
            })) {
              stopReason = "page-window-reached";
              break;
            }
            if (maxPages > 0 && pagesVisited >= maxPages) {
              stopReason = "max-pages-reached";
              break;
            }
            const paginationAfter2 = getPaginationInfo2();
            if (!paginationAfter2.hasNextPage || paginationAfter2.currentPage >= paginationAfter2.totalPages) {
              stopReason = "no-next-page";
              break;
            }
            try {
              await waitForPagination2({ timeoutMs: 8e3 });
            } catch (e) {
              console.warn("[tr-auto-sync]", "waitForPagination timed out (empty-resumes branch)", e?.message || e);
            }
            const nextPage2 = paginationAfter2.currentPage + 1;
            try {
              document2.documentElement.setAttribute(
                "data-tr-auto-sync-next-state",
                JSON.stringify(getNextPageButtonState2())
              );
            } catch (e) {
              console.warn("[tr-auto-sync]", "DOM attribute set failed (next-state, empty-resumes)", e?.message || e);
            }
            await waitForJob51Cooldown2();
            clearCapturedResultsForNextPage2();
            const moved2 = goToNextPageInternal2();
            if (!moved2) {
              stopReason = "no-next-page";
              break;
            }
            await waitForPageTransition2({
              expectedPage: nextPage2,
              timeoutMs: 15e3
            });
            await new Promise((resolve) => setTimeout(resolve, 500));
            continue;
          }
          const progressHint = buildAutoSyncProgressHint2({
            limit,
            totalSubmitted,
            selectedCount: isSeekListPage ? resumes.length : null
          });
          SyncStatusWidget2.show({
            state: "progress",
            message: `\u6B63\u5728\u540C\u6B65\u7B2C ${currentPage}/${Math.max(totalPages, currentPage)} \u9875 (${resumes.length} \u4EFD)...`,
            hint: progressHint
          });
          const response = await syncCurrentPageToServer2(resumes);
          if (!response?.success) {
            throw response?.error || response || "Auto sync failed";
          }
          const submitted = typeof response.submitted === "number" ? response.submitted : resumes.length;
          const inserted = typeof response.inserted === "number" ? response.inserted : 0;
          const updated = typeof response.updated === "number" ? response.updated : 0;
          totalSubmitted += submitted;
          totalInserted += inserted;
          totalUpdated += updated;
          setAutoSyncAttributes2("running", totalSubmitted, pagesVisited);
          if (getCurrentSourceKey2() === SOURCE_KEYS2.JOB51 && !isJob51DetailPage2() && resumes.length > 0) {
            const detailBackfillPromise = queueJob51DetailBackfill2(resumes, {
              currentPage,
              totalPages: Math.max(totalPages, currentPage)
            });
            const waitMode = resolveCurrentJob51AutoSyncDetailWaitMode2();
            const shouldWaitForDetails = waitMode === "all" || waitMode === "page1" && currentPage === 1;
            if (shouldWaitForDetails) {
              SyncStatusWidget2.show({
                state: "progress",
                message: `\u6B63\u5728\u8865\u5145\u7B2C ${currentPage}/${Math.max(totalPages, currentPage)} \u9875\u8BE6\u60C5...`,
                hint: "\u7B49\u5F85 51job \u8BE6\u60C5\u8865\u5145\u540E\u518D\u5B8C\u6210\u672C\u9875\u540C\u6B65"
              });
              await detailBackfillPromise;
            }
          }
          if (deps.state._autoSyncCancelled) {
            stopReason = "cancelled";
            break;
          }
          if (isSeekListPage && hitLimitWithinPage) {
            stopReason = "limit-reached";
            break;
          }
          if (limit > 0 && totalSubmitted >= limit) {
            stopReason = "limit-reached";
            break;
          }
          if (isSeekListPage && shouldStopSeekAutoSyncForPageWindow2({
            pageWindowReached: isSeekAutoSyncPageWindowReached2(seekPageWindow, currentPage),
            limit,
            totalSubmitted
          })) {
            stopReason = "page-window-reached";
            break;
          }
          if (maxPages > 0 && pagesVisited >= maxPages) {
            stopReason = "max-pages-reached";
            break;
          }
          const paginationAfter = getPaginationInfo2();
          if (!paginationAfter.hasNextPage || paginationAfter.currentPage >= paginationAfter.totalPages) {
            stopReason = "no-next-page";
            break;
          }
          try {
            await waitForPagination2({ timeoutMs: 8e3 });
          } catch (e) {
            console.warn("[tr-auto-sync]", "waitForPagination timed out (sync-success branch)", e?.message || e);
          }
          const nextPage = paginationAfter.currentPage + 1;
          try {
            document2.documentElement.setAttribute(
              "data-tr-auto-sync-next-state",
              JSON.stringify(getNextPageButtonState2())
            );
          } catch (e) {
            console.warn("[tr-auto-sync]", "DOM attribute set failed (next-state, sync-success)", e?.message || e);
          }
          await waitForJob51Cooldown2();
          clearCapturedResultsForNextPage2();
          const moved = goToNextPageInternal2();
          if (!moved) {
            stopReason = "no-next-page";
            break;
          }
          await waitForPageTransition2({ expectedPage: nextPage, timeoutMs: 15e3 });
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
        try {
          document2.documentElement.setAttribute(
            "data-tr-auto-sync-stop-reason",
            stopReason
          );
        } catch (e) {
          console.warn("[tr-auto-sync]", "runAutoSyncIfEnabled: DOM attribute set failed (stop-reason)", e?.message || e);
        }
        persistLatestAutoSyncSummary2();
        if (deps.state._autoSyncCancelled) {
          SyncStatusWidget2.show({
            state: "success",
            message: `\u540C\u6B65\u5DF2\u53D6\u6D88\uFF0C\u5DF2\u540C\u6B65 ${totalSubmitted} \u4EFD\u7B80\u5386`,
            hint: buildAutoSyncCompletionHint2({
              totalInserted,
              totalUpdated,
              pagesVisited,
              selectedCount: lastSelectedCount
            }),
            autoDismiss: true
          });
          setAutoSyncAttributes2("cancelled", totalSubmitted, pagesVisited);
          return;
        }
        SyncStatusWidget2.show({
          state: "success",
          message: `\u5DF2\u540C\u6B65 ${totalSubmitted} \u4EFD\u7B80\u5386 (${totalInserted} \u65B0\u589E, ${totalUpdated} \u66F4\u65B0), \u5171 ${pagesVisited} \u9875`,
          hint: [
            buildAutoSyncSelectedCountHint2({
              selectedCount: lastSelectedCount,
              prefix: ""
            }),
            isJob51Source ? "51job \u8BE6\u60C5\u8865\u5145\u6B63\u5728\u540E\u53F0\u7EE7\u7EED" : ""
          ].filter(Boolean).join(" \xB7 "),
          autoDismiss: true
        });
        setAutoSyncAttributes2("done", totalSubmitted, pagesVisited);
      } catch (error) {
        console.warn("\u{1F3AF} [Auto Sync] Failed:", error);
        const status = resolveAutoSyncErrorStatus2(error);
        SyncStatusWidget2.show({
          state: "error",
          message: status.message,
          hint: status.hint
        });
        setAutoSyncAttributes2("failed");
        try {
          document2.documentElement.setAttribute(
            "data-tr-auto-sync-stop-reason",
            resolveAutoSyncStopReason2(error)
          );
        } catch (e) {
          console.warn("[tr-auto-sync]", "runAutoSyncIfEnabled: fallback attribute set failed (stop-reason)", e?.message || e);
        }
        persistLatestAutoSyncSummary2();
      }
    }
    __name(runAutoSyncIfEnabled2, "runAutoSyncIfEnabled");
    return { runAutoSyncIfEnabled: runAutoSyncIfEnabled2 };
  }
  __name(createAutoSyncRunner, "createAutoSyncRunner");

  // src/lib/external-accessor.ts
  function getExternalAccessorStatus(deps) {
    const {
      getExtensionVersion: getExtensionVersion2,
      getPaginationInfo: getPaginationInfo2,
      getCurrentAgeRange: getCurrentAgeRange2,
      getCurrentSourceKey: getCurrentSourceKey2,
      getApiSnapshotCount: getApiSnapshotCount2,
      getSeekCardCount: getSeekCardCount2,
      SOURCE_KEYS: SOURCE_KEYS2,
      isExtractionReady: isExtractionReady2,
      isLoggedIn: isLoggedIn2,
      apiSnapshot: apiSnapshot2,
      SELECTORS: SELECTORS2,
      isJob5156DetailPage: isJob5156DetailPage2,
      isJob5156DetailReady: isJob5156DetailReady2,
      document: doc
    } = deps;
    const version = getExtensionVersion2();
    const pagination = getPaginationInfo2();
    const ageRange = getCurrentAgeRange2();
    const sourceKey = getCurrentSourceKey2();
    const apiSnapshotCount = getApiSnapshotCount2();
    const cardCount = sourceKey === SOURCE_KEYS2.SEEK ? Math.max(apiSnapshotCount, getSeekCardCount2()) : sourceKey === SOURCE_KEYS2.JOB51 ? apiSnapshotCount : isJob5156DetailPage2() ? isJob5156DetailReady2() ? 1 : 0 : doc.querySelectorAll(SELECTORS2.resumeCard).length;
    const autoSearch = doc.documentElement.getAttribute("data-tr-auto-search") || "";
    const autoLocation = doc.documentElement.getAttribute("data-tr-auto-location") || "";
    const autoAge = doc.documentElement.getAttribute("data-tr-auto-age") || "";
    const autoExport = doc.documentElement.getAttribute("data-tr-auto-export") || "";
    const autoSync = doc.documentElement.getAttribute("data-tr-auto-sync") || "";
    const autoSyncCountRaw = doc.documentElement.getAttribute("data-tr-auto-sync-count") || "";
    const autoSyncPagesRaw = doc.documentElement.getAttribute("data-tr-auto-sync-pages") || "";
    const autoSyncTargetStartRaw = doc.documentElement.getAttribute("data-tr-auto-sync-target-start") || "";
    const autoSyncTargetEndRaw = doc.documentElement.getAttribute("data-tr-auto-sync-target-end") || "";
    const autoSyncEffectivePageSizeRaw = doc.documentElement.getAttribute(
      "data-tr-auto-sync-effective-page-size"
    ) || "";
    const autoSyncSelectedCountRaw = doc.documentElement.getAttribute("data-tr-auto-sync-selected-count") || "";
    const autoSyncRemainingCapacityRaw = doc.documentElement.getAttribute(
      "data-tr-auto-sync-remaining-capacity"
    ) || "";
    const autoSyncStopReason = doc.documentElement.getAttribute("data-tr-auto-sync-stop-reason") || "";
    const autoSyncCount = Number.parseInt(autoSyncCountRaw, 10);
    const autoSyncPages = Number.parseInt(autoSyncPagesRaw, 10);
    const autoSyncTargetStart = Number.parseInt(autoSyncTargetStartRaw, 10);
    const autoSyncTargetEnd = Number.parseInt(autoSyncTargetEndRaw, 10);
    const autoSyncEffectivePageSize = Number.parseInt(
      autoSyncEffectivePageSizeRaw,
      10
    );
    const autoSyncSelectedCount = Number.parseInt(autoSyncSelectedCountRaw, 10);
    const autoSyncRemainingCapacity = Number.parseInt(
      autoSyncRemainingCapacityRaw,
      10
    );
    return {
      extensionLoaded: true,
      extensionVersion: version,
      sourceKey,
      apiSnapshotCount,
      domReady: isExtractionReady2(),
      loggedIn: isLoggedIn2(),
      ageRange: ageRange.enabled ? {
        minAge: typeof ageRange.minAge === "number" ? ageRange.minAge : null,
        maxAge: typeof ageRange.maxAge === "number" ? ageRange.maxAge : null
      } : null,
      cardCount,
      autoSearch,
      autoLocation,
      autoAge,
      autoExport,
      autoSync,
      autoSyncCount: Number.isFinite(autoSyncCount) ? autoSyncCount : 0,
      autoSyncPages: Number.isFinite(autoSyncPages) ? autoSyncPages : 0,
      autoSyncTargetPageStart: Number.isFinite(autoSyncTargetStart) ? autoSyncTargetStart : null,
      autoSyncTargetPageEnd: Number.isFinite(autoSyncTargetEnd) ? autoSyncTargetEnd : null,
      autoSyncEffectivePageSize: Number.isFinite(autoSyncEffectivePageSize) ? autoSyncEffectivePageSize : null,
      autoSyncSelectedCount: Number.isFinite(autoSyncSelectedCount) ? autoSyncSelectedCount : null,
      autoSyncRemainingCapacity: Number.isFinite(autoSyncRemainingCapacity) ? autoSyncRemainingCapacity : null,
      autoSyncStopReason: autoSyncStopReason || null,
      pagination,
      lastOperationName: apiSnapshot2.lastOperationName,
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    };
  }
  __name(getExternalAccessorStatus, "getExternalAccessorStatus");
  function installExternalAccessor(key, deps) {
    try {
      const {
        extractResumes: extractResumes2,
        extractResumesRaw: extractResumesRaw2,
        collectSnapshotPayload: collectSnapshotPayload2,
        apiSnapshot: apiSnapshot2,
        getPaginationInfo: getPaginationInfo2,
        isExtractionReady: isExtractionReady2,
        isLoggedIn: isLoggedIn2,
        getExternalAccessorStatus: getExternalAccessorStatus3,
        syncToServer,
        goToNextPageInternal: goToNextPageInternal2,
        version
      } = deps;
      window[key] = {
        extract: /* @__PURE__ */ __name(() => extractResumes2(), "extract"),
        extractRaw: /* @__PURE__ */ __name((options) => extractResumesRaw2(options), "extractRaw"),
        collect: /* @__PURE__ */ __name((options) => collectSnapshotPayload2(options), "collect"),
        getApiSnapshot: /* @__PURE__ */ __name(() => apiSnapshot2, "getApiSnapshot"),
        getPaginationInfo: /* @__PURE__ */ __name(() => getPaginationInfo2(), "getPaginationInfo"),
        isReady: /* @__PURE__ */ __name(() => isExtractionReady2(), "isReady"),
        isLoggedIn: /* @__PURE__ */ __name(() => isLoggedIn2(), "isLoggedIn"),
        status: /* @__PURE__ */ __name(() => getExternalAccessorStatus3(deps), "status"),
        syncToServer: /* @__PURE__ */ __name(() => syncToServer(), "syncToServer"),
        version,
        goToNextPage: /* @__PURE__ */ __name(() => goToNextPageInternal2(), "goToNextPage")
      };
    } catch (error) {
      console.warn("\u{1F3AF} [External Access] Failed to install accessor:", error);
    }
  }
  __name(installExternalAccessor, "installExternalAccessor");

  // src/lib/collection-guards.ts
  var DEFAULT_COLLECTION_GUARDS = {
    job5156: "experience,jobIntention,selfIntro",
    "51job": "experience,jobIntention,selfIntro",
    seek: "experience,jobIntention,selfIntro"
  };
  var GUARD_FIELD_NAMES = /* @__PURE__ */ new Set([
    "experience",
    "jobIntention",
    "selfIntro",
    "expectedSalary",
    "workHistory",
    "profileEducation",
    "projectExperience",
    "skills",
    "licences"
  ]);
  var GUARD_ARRAY_FIELD_NAMES = /* @__PURE__ */ new Set([
    "workHistory",
    "profileEducation",
    "projectExperience",
    "skills",
    "licences"
  ]);
  async function loadCollectionGuards() {
    return new Promise((resolve) => {
      chrome.storage.local.get(
        { collectionGuards: DEFAULT_COLLECTION_GUARDS },
        (items) => resolve(items.collectionGuards || {})
      );
    });
  }
  __name(loadCollectionGuards, "loadCollectionGuards");
  function parseGuardFieldNames(csv) {
    if (!csv || typeof csv !== "string") return [];
    return Array.from(
      new Set(
        csv.split(",").map((field) => field.trim()).filter((field) => GUARD_FIELD_NAMES.has(field))
      )
    );
  }
  __name(parseGuardFieldNames, "parseGuardFieldNames");
  function applyCollectionGuards(resume, guardFieldNames) {
    if (!resume || typeof resume !== "object" || !Array.isArray(guardFieldNames) || guardFieldNames.length === 0) {
      return resume;
    }
    const guarded = { ...resume };
    for (const field of guardFieldNames) {
      guarded[field] = GUARD_ARRAY_FIELD_NAMES.has(field) ? [] : "";
    }
    return guarded;
  }
  __name(applyCollectionGuards, "applyCollectionGuards");

  // src/content.ts
  var INITIAL_URL_CAPTURED_PARAMS = (() => {
    try {
      const url = new URL(window.location.href);
      const val = url.searchParams.get(AUTO_SYNC_PARAM);
      const seekParams = ["keywords", "roleTitles", "matchAll", "tr_max_age", SEEK_DETAIL_PARAM];
      for (const p of seekParams) {
        const v = url.searchParams.get(p);
        if (v !== null) {
          sessionStorage.setItem(`tr_seek_param_${p}`, v);
        }
      }
      if (val) {
        sessionStorage.setItem("tr_auto_sync_captured", val);
        sessionStorage.setItem("tr_auto_sync_initial_url", window.location.href);
      }
      return { autoSync: val, initialUrl: window.location.href };
    } catch {
      return { autoSync: null, initialUrl: null };
    }
  })();
  var apiSnapshot = {
    searchRows: null,
    job51SearchRows: null,
    job51Total: null,
    job51LastSearchRequest: null,
    job51AuthContext: null,
    job51DetailPayload: null,
    attachInfo: null,
    chatInfo: null,
    insightInfo: null,
    seekRecommendedCandidates: null,
    seekRecommendedRequest: null,
    seekProfile: null,
    seekProfileRequest: null,
    seekTalentSearch: null,
    seekTalentSearchRequest: null,
    lastUpdatedAt: null,
    lastSearchAt: null,
    lastUrl: null,
    lastSourceKey: null,
    lastOperationName: null
  };
  var job51DetailBackfillChain = Promise.resolve();
  var job51DetailBackfillRunId = 0;
  var pipelineState = {
    get chain() {
      return job51DetailBackfillChain;
    },
    set chain(v) {
      job51DetailBackfillChain = v;
    },
    get runId() {
      return job51DetailBackfillRunId;
    },
    set runId(v) {
      job51DetailBackfillRunId = v;
    }
  };
  var getCurrentSourceKey;
  var isJob51DetailPage;
  var isJob5156DetailPage;
  var isJob51DetailReady;
  var isJob5156DetailReady;
  var getSeekPaginationInfo;
  var getSeekNextPageLinkForMode;
  var getCurrentSeekMode;
  var makeRandomId;
  var getSeekCardCount;
  var isDisabledPaginationControl;
  var waitForSeekProfileSnapshot;
  var getApiSnapshotCount;
  var syncCurrentPageToServer;
  var getExternalAccessorStatus2;
  var setAutoAgeAttributes;
  var _paginationUtils = createPaginationUtils({
    getCurrentSourceKey: /* @__PURE__ */ __name(() => getCurrentSourceKey(), "getCurrentSourceKey"),
    SOURCE_KEYS,
    isJob51DetailPage: /* @__PURE__ */ __name(() => isJob51DetailPage(), "isJob51DetailPage"),
    isJob5156DetailPage: /* @__PURE__ */ __name(() => isJob5156DetailPage(), "isJob5156DetailPage"),
    isJob51DetailReady: /* @__PURE__ */ __name(() => isJob51DetailReady(), "isJob51DetailReady"),
    isJob5156DetailReady: /* @__PURE__ */ __name(() => isJob5156DetailReady(), "isJob5156DetailReady"),
    getSeekPaginationInfo: /* @__PURE__ */ __name(() => getSeekPaginationInfo(), "getSeekPaginationInfo"),
    getSeekNextPageLinkForMode: /* @__PURE__ */ __name(() => getSeekNextPageLinkForMode(), "getSeekNextPageLinkForMode"),
    getCurrentSeekMode: /* @__PURE__ */ __name(() => getCurrentSeekMode(), "getCurrentSeekMode"),
    apiSnapshot,
    normalizeOptionalPositiveInt,
    doc: document,
    win: window,
    SELECTORS
  });
  var {
    getPaginationInfo,
    getNextPageButtonState,
    waitForPagination
  } = _paginationUtils;
  var _uiUtils = createUiUtils({
    win: window,
    doc: document,
    SOURCE_KEYS,
    AUTO_EXPORT_PARAM,
    AUTO_SYNC_PARAM,
    AUTO_LIMIT_PARAM,
    AUTO_MAX_PAGES_PARAM,
    AUTO_MIN_AGE_PARAM,
    AUTO_MAX_AGE_PARAM,
    AUTO_SEARCH_PARAM,
    AUTO_LOCATION_PARAM,
    SAMPLE_NAME_PARAM,
    KEYWORD_MODE_CONCAT,
    KEYWORD_MODE_SPACED,
    LATEST_AUTO_SYNC_SUMMARIES_STORAGE_KEY,
    JOB5156_HOST,
    EHIRE_51JOB_HOST,
    SEEK_HOST_SUFFIX,
    makeRandomId: /* @__PURE__ */ __name(() => makeRandomId(), "makeRandomId"),
    getPaginationInfo,
    getExternalAccessorStatus: /* @__PURE__ */ __name(() => getExternalAccessorStatus2(), "getExternalAccessorStatus"),
    getAgeRangeFromUrl,
    filterResumesByAgeRange,
    resolveJob51CollectionLimits,
    resolveJob51DetailFetchDelayMs,
    resolveJob51AutoSyncDetailWaitMode,
    isJob51DetailPage: /* @__PURE__ */ __name(() => isJob51DetailPage(), "isJob51DetailPage"),
    chrome
  });
  var {
    // Export & Metadata
    sanitizeSampleName,
    normalizeKeyword,
    normalizeKeywordMode,
    normalizeCollectionLimit,
    buildExportFilename,
    buildExportMetadata,
    getExtensionGeneratedBy,
    parseAutoLocationValues,
    getAutoLocationValues,
    // Collection Helpers
    getCurrentLocationSearch,
    getCurrentAgeRange,
    filterCurrentResumesByAgeRange,
    resolveCurrentJob51CollectionLimits,
    resolveCurrentJob51DetailFetchDelayMs,
    resolveCurrentJob51AutoSyncDetailWaitMode,
    // Auto-Sync UI
    setAutoSyncAttributes,
    buildAutoSyncProgressHint,
    buildAutoSyncSelectedCountHint,
    buildAutoSyncCompletionHint,
    buildPersistedAutoSyncSummary,
    persistLatestAutoSyncSummary,
    // Additional Utilities
    installReloadHelper,
    isLoggedIn
  } = _uiUtils;
  ({ getCurrentSourceKey } = _uiUtils);
  var _domUtils = createDomUtils({
    win: window,
    doc: document,
    getPaginationInfo
  });
  var {
    waitForPageTransition,
    isElementVisible,
    asHTMLElement,
    setInputValue,
    fireMouseEvent,
    activateElement,
    findVueParentByName
  } = _domUtils;
  var _seekExtractor = createSeekExtractor({
    getCurrentSourceKey,
    SOURCE_KEYS,
    apiSnapshot,
    normalizeOptionalPositiveInt,
    DEFAULT_SEEK_PAGE_SIZE,
    SEEK_PROFILE_TYPE,
    persistLatestAutoSyncSummary,
    // Extraction deps
    win: window,
    doc: document,
    // Pagination + extraction deps
    asHTMLElement,
    isDisabledPaginationControl: /* @__PURE__ */ __name(((el) => isDisabledPaginationControl(el)), "isDisabledPaginationControl"),
    // Detail enrichment deps
    waitForSeekProfileSnapshot: /* @__PURE__ */ __name(((matchId, options) => waitForSeekProfileSnapshot(matchId, options)), "waitForSeekProfileSnapshot"),
    SEEK_DETAIL_FETCH_CONCURRENCY,
    SEEK_DETAIL_FETCH_DELAY_MS,
    SEEK_TALENTSEARCH_DETAIL_FETCH_CONCURRENCY,
    SEEK_TALENTSEARCH_DETAIL_FETCH_DELAY_MS,
    SEEK_TALENTSEARCH_DETAIL_TIMEOUT_MS,
    SEEK_DETAIL_PARAM,
    delay: /* @__PURE__ */ __name(((ms) => delay(ms)), "delay"),
    SELECTORS
  });
  var {
    isSeekProfilePage,
    isSeekTalentSearchListPage,
    isSeekInlineProfileMode,
    isSeekProfileMode,
    hasSeekProfileSnapshot,
    hasSeekListSnapshot,
    hasSeekTalentSearchSnapshot,
    getSeekSnapshotCount,
    isSeekSnapshotReady,
    getSeekCandidateIdentity,
    buildSeekProfileUrl,
    buildSeekNameSearchUrl,
    normalizeSeekLocationLabel,
    restoreSeekSearchParams,
    getSeekRecommendedRequest,
    getSeekTalentSearchRequest,
    getSeekProfileRequest,
    getSeekAutoSyncHelpers,
    resolveSeekAutoSyncPageSize,
    resolveSeekAutoSyncPageWindow,
    isSeekAutoSyncPageWindowReached,
    shouldStopSeekAutoSyncForPageWindow,
    resolveSeekAutoSyncCurrentPageSelection,
    getSeekRequestedPageSize,
    getSeekCurrentCandidateCount,
    setSeekAutoSyncWindowAttributes,
    setSeekAutoSyncSelectionAttributes,
    findSeekProfileTrigger,
    // Extraction functions
    extractSeekProfileResume,
    buildSeekCollectionContext,
    getSeekPayloadData,
    // Resumes extraction
    extractSeekResumes,
    extractSeekTalentSearchResumes,
    // Pagination helpers
    getSeekNextPageLink,
    getSeekTalentSearchNextPageLink,
    // Detail enrichment
    enrichSingleSeekResumeWithDetail,
    enrichSeekResumesWithDetail
  } = _seekExtractor;
  ({ getCurrentSeekMode, getSeekCardCount, getSeekPaginationInfo, getSeekNextPageLinkForMode } = _seekExtractor);
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", restoreSeekSearchParams);
  } else {
    restoreSeekSearchParams();
  }
  async function getKeywordMode() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(
          { keywordMode: KEYWORD_MODE_CONCAT },
          (items) => {
            resolve(normalizeKeywordMode(items?.keywordMode));
          }
        );
      } catch (error) {
        console.warn(
          "\u{1F3AF} [Auto Search] Failed to read keyword mode from storage:",
          error
        );
        resolve(KEYWORD_MODE_CONCAT);
      }
    });
  }
  __name(getKeywordMode, "getKeywordMode");
  async function getCollectionLimits() {
    const params = new URLSearchParams(window.location.search || "");
    const hasLimitParam = params.has(AUTO_LIMIT_PARAM);
    const hasMaxPagesParam = params.has(AUTO_MAX_PAGES_PARAM);
    const paramLimit = normalizeCollectionLimit(params.get(AUTO_LIMIT_PARAM));
    const paramMaxPages = normalizeCollectionLimit(
      params.get(AUTO_MAX_PAGES_PARAM)
    );
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get({ collectLimit: 0, maxPages: 0 }, (items) => {
          const resolvedLimit = hasLimitParam ? paramLimit : normalizeCollectionLimit(items?.collectLimit);
          const resolvedMaxPages = hasMaxPagesParam ? paramMaxPages : normalizeCollectionLimit(items?.maxPages);
          if (getCurrentSourceKey() === SOURCE_KEYS.JOB51) {
            resolve(resolveCurrentJob51CollectionLimits(resolvedLimit, resolvedMaxPages));
            return;
          }
          resolve({
            limit: resolvedLimit,
            maxPages: resolvedMaxPages
          });
        });
      } catch (error) {
        console.warn(
          "\u{1F3AF} [Auto Sync] Failed to read collection limits from storage:",
          error
        );
        if (getCurrentSourceKey() === SOURCE_KEYS.JOB51) {
          resolve(
            resolveCurrentJob51CollectionLimits(
              hasLimitParam ? paramLimit : 0,
              hasMaxPagesParam ? paramMaxPages : 0
            )
          );
          return;
        }
        resolve({
          limit: hasLimitParam ? paramLimit : 0,
          maxPages: hasMaxPagesParam ? paramMaxPages : 0
        });
      }
    });
  }
  __name(getCollectionLimits, "getCollectionLimits");
  function isExtractionReady() {
    if (getCurrentSourceKey() === SOURCE_KEYS.JOB51) {
      return isJob51DetailPage() ? isJob51DetailReady() : hasJob51SearchSnapshot();
    }
    if (getCurrentSourceKey() === SOURCE_KEYS.SEEK) {
      return isSeekSnapshotReady();
    }
    if (isJob5156DetailPage()) {
      return isJob5156DetailReady();
    }
    return document.querySelector(SELECTORS.listContainer) !== null;
  }
  __name(isExtractionReady, "isExtractionReady");
  var _job5156Extractor = createJob5156Extractor({
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
    collectJob5156SectionItemsByHeading
  });
  var {
    getJob5156DetailRoot,
    getJob5156DetailHeaderText,
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
    normalizeJob5156ProfileUrlForExport
  } = _job5156Extractor;
  ({ isJob5156DetailPage, isJob5156DetailReady } = _job5156Extractor);
  var _job51SearchExtractor = createJob51SearchExtractor({
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
    window,
    fetch: globalThis.fetch.bind(globalThis),
    delay,
    isElementVisible,
    activateElement,
    findVueParentByName
  });
  var {
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
    resolveJob51AgeFilterDropdown,
    ensureJob51AgeCustomRangeInputs,
    applyJob51AgeCustomRangeViaVue,
    normalizeAgeRequestValue,
    hasMatchingJob51AgeSearchRequest,
    waitForJob51AgeFilterRefresh
  } = _job51SearchExtractor;
  ({ isJob51DetailPage, isJob51DetailReady } = _job51SearchExtractor);
  var _resumeExtractor = createResumeExtractor({
    SELECTORS,
    JOB5156_HOST,
    doc: document,
    getCurrentSourceKey,
    SOURCE_KEYS,
    parseJob5156BasicInfoItems,
    buildJob5156WorkHistoryItem,
    buildJob5156EducationItem,
    isJob51DetailPage,
    isJob5156DetailPage,
    isJob51DetailReady,
    isJob5156DetailReady,
    getJob51DetailRoot,
    getJob5156DetailRoot,
    getJob51ResumePayload: /* @__PURE__ */ __name(() => apiSnapshot.job51DetailPayload, "getJob51ResumePayload"),
    getJob5156ResumePayload: /* @__PURE__ */ __name(() => null, "getJob5156ResumePayload"),
    normalizeResumeText,
    normalizeResumeMultilineText,
    applyCollectionGuards,
    parseGuardFieldNames,
    GUARD_FIELD_NAMES,
    DEFAULT_COLLECTION_GUARDS,
    apiSnapshot,
    JOB5156_PROFILE_URL_PREFIX,
    normalizeJob5156ProfileUrlForExport,
    win: window,
    normalizeKeyword,
    AUTO_SEARCH_PARAM,
    getAutoLocationValues,
    AUTO_EXPORT_PARAM,
    AUTO_SYNC_PARAM,
    AUTO_LIMIT_PARAM,
    AUTO_MAX_PAGES_PARAM,
    SAMPLE_NAME_PARAM,
    getExtensionGeneratedBy,
    buildSeekCollectionContext
  });
  var {
    extractSingleResume,
    getApiRowForIndex,
    extractProfileUrl,
    buildSubmitMetadata
  } = _resumeExtractor;
  var _extractionPipeline = createExtractionPipeline({
    getCurrentSourceKey,
    SOURCE_KEYS,
    apiSnapshot,
    SELECTORS,
    getApiSnapshotCount: /* @__PURE__ */ __name(() => getApiSnapshotCount(), "getApiSnapshotCount"),
    getSeekCurrentCandidateCount,
    isExtractionReady,
    isJob51RateLimitedPage,
    JOB51_RATE_LIMIT_ERROR_MESSAGE,
    getSeekCandidateIdentity,
    chrome,
    DEFAULT_COLLECTION_GUARDS,
    CONTENT_SCRIPT_SOURCE,
    JOB51_NEXT_PAGE_EVENT,
    document,
    window,
    resolveCurrentJob51DetailFetchDelayMs,
    JOB51_DETAIL_FETCH_CONCURRENCY,
    enrich51JobSearchResumeWithDetail,
    syncCurrentPageToServer: /* @__PURE__ */ __name((resumes) => syncCurrentPageToServer(resumes), "syncCurrentPageToServer"),
    delay,
    pipelineState,
    isJob51DetailPage,
    filterCurrentResumesByAgeRange,
    extractJob51DetailResume,
    extract51JobResumes,
    isSeekProfileMode,
    hasSeekProfileSnapshot,
    extractSeekProfileResume,
    hasSeekTalentSearchSnapshot,
    extractSeekTalentSearchResumes,
    hasSeekListSnapshot,
    extractSeekResumes,
    isJob5156DetailPage,
    extractJob5156DetailResume,
    getApiRowForIndex,
    extractSingleResume,
    isJob51DetailReady,
    getSeekProfileRequest,
    getSeekTalentSearchRequest,
    getSeekRecommendedRequest,
    SEEK_PROFILE_TYPE,
    getJob5156DetailRoot,
    getSeekNextPageLinkForMode: /* @__PURE__ */ __name(() => getSeekNextPageLinkForMode(), "getSeekNextPageLinkForMode"),
    getPaginationInfo,
    asHTMLElement
  });
  var {
    waitForResumeCards,
    waitForApiRows,
    waitForExtractionData,
    clearCapturedResultsForNextPage,
    extractResumes,
    extractResumesRaw,
    goToNextPageInternal,
    enrich51JobSearchResumesWithDetail,
    queueJob51DetailBackfill
  } = _extractionPipeline;
  isDisabledPaginationControl = _extractionPipeline.isDisabledPaginationControl;
  waitForSeekProfileSnapshot = _extractionPipeline.waitForSeekProfileSnapshot;
  var _snapshotCollector = createSnapshotCollector({
    apiSnapshot,
    getCurrentSourceKey,
    SOURCE_KEYS,
    isJob51DetailPage,
    isJob51DetailReady,
    getSeekSnapshotCount,
    normalizeJob51AuthContext,
    getJob51TotalFromPayload,
    getJob51ResumeRows,
    getSeekPayloadData,
    chrome,
    normalizeCollectionLimit,
    pipelineState,
    waitForExtractionData,
    isSeekProfileMode,
    resolveSeekAutoSyncPageWindow,
    getSeekRequestedPageSize,
    getSeekCurrentCandidateCount,
    resolveSeekAutoSyncCurrentPageSelection,
    extractResumes,
    enrich51JobSearchResumesWithDetail,
    enrichJob5156SearchResumesWithDetail,
    isJob5156DetailPage,
    enrichSeekResumesWithDetail,
    getPaginationInfo,
    isSeekAutoSyncPageWindowReached,
    shouldStopSeekAutoSyncForPageWindow,
    waitForPagination,
    clearCapturedResultsForNextPage,
    goToNextPageInternal,
    waitForPageTransition,
    buildSubmitMetadata,
    delay,
    document,
    loadCollectionGuards,
    parseGuardFieldNames,
    applyCollectionGuards
  });
  var {
    updateApiSnapshot,
    installApiHook,
    normalizeSnapshotCollectOptions,
    collectSnapshotPayload
  } = _snapshotCollector;
  ({ getApiSnapshotCount } = _snapshotCollector);
  var _autoActions = createAutoActions({
    activateElement,
    fireMouseEvent,
    setInputValue,
    apiSnapshot,
    getCurrentSourceKey,
    getCurrentAgeRange,
    SOURCE_KEYS,
    isElementVisible,
    resolveJob51AgeFilterDropdown,
    ensureJob51AgeCustomRangeInputs,
    applyJob51AgeCustomRangeViaVue,
    waitForJob51AgeFilterRefresh,
    waitForExtractionData,
    asHTMLElement,
    SELECTORS,
    AUTO_LOCATION_PARAM,
    AUTO_SEARCH_PARAM,
    AUTO_KEYWORD_MODE_PARAM,
    KEYWORD_MODE_SPACED,
    normalizeKeyword,
    normalizeKeywordMode,
    getKeywordMode,
    normalizeSeekLocationLabel,
    hasJob51SearchSnapshot,
    isJob51EmptySearchPromptVisible,
    parseAutoLocationValues,
    extractResumes,
    extractResumesRaw,
    isJob51DetailPage,
    isJob5156DetailPage,
    isSeekProfileMode,
    enrich51JobSearchResumesWithDetail,
    enrichJob5156SearchResumesWithDetail,
    enrichSeekResumesWithDetail,
    buildSubmitMetadata,
    AUTO_EXPORT_PARAM,
    AUTO_SYNC_PARAM,
    buildExportMetadata,
    buildExportFilename,
    document,
    window,
    loadCollectionGuards,
    parseGuardFieldNames,
    applyCollectionGuards
  });
  var {
    findAgeFilterBlock,
    openAgeFilterDropdown,
    resolveAgeSelectBox,
    waitForAgeFilterDropdown,
    resolveAgeFilterActions,
    autoApplyAgeFilterFromUrl,
    autoSelectLocation,
    autoSearchFromUrl,
    normalizeCardText,
    rawToMarkdown,
    resumesToCSV,
    downloadFile,
    getExtensionVersion,
    parseAutoExportMode,
    getAutoExportConfig,
    parseAutoSyncFlag,
    getAutoSyncEnabled,
    runAutoExportIfEnabled,
    resolveAutoSyncErrorStatus,
    resolveAutoSyncStopReason
  } = _autoActions;
  ({ makeRandomId, syncCurrentPageToServer, setAutoAgeAttributes } = _autoActions);
  var _accessorDoc = document;
  getExternalAccessorStatus2 = /* @__PURE__ */ __name(() => getExternalAccessorStatus({
    getExtensionVersion,
    getPaginationInfo,
    getCurrentAgeRange,
    getCurrentSourceKey,
    getApiSnapshotCount,
    getSeekCardCount,
    SOURCE_KEYS,
    isExtractionReady,
    isLoggedIn,
    apiSnapshot,
    SELECTORS,
    isJob5156DetailPage,
    isJob5156DetailReady,
    extractResumes,
    extractResumesRaw,
    collectSnapshotPayload,
    syncToServer: syncCurrentPageToServer,
    goToNextPageInternal,
    getExternalAccessorStatus,
    version: getExtensionVersion(),
    document: _accessorDoc
  }), "getExternalAccessorStatus");
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || msg.source !== API_CAPTURE_SOURCE) return;
    updateApiSnapshot(msg);
  });
  var _pageBridge = createPageBridge({
    doc: document,
    win: window,
    extractResumes,
    extractResumesRaw,
    collectSnapshotPayload,
    getApiSnapshot: /* @__PURE__ */ __name(() => apiSnapshot, "getApiSnapshot"),
    getPaginationInfo,
    isExtractionReady,
    isLoggedIn,
    syncCurrentPageToServer,
    goToNextPageInternal
  });
  _pageBridge.installPageBridgeListener();
  var _autoSyncRunnerState = {
    _autoSyncTriggered: false,
    _autoSyncCancelled: false
  };
  var SyncStatusWidget = createSyncStatusWidget({
    win: window,
    doc: document,
    chrome,
    onCancel: /* @__PURE__ */ __name(() => {
      _autoSyncRunnerState._autoSyncCancelled = true;
    }, "onCancel")
  });
  var _autoSyncRunner = createAutoSyncRunner({
    state: _autoSyncRunnerState,
    // Auto-actions helpers
    getAutoSyncEnabled,
    setAutoSyncAttributes,
    resolveAutoSyncErrorStatus,
    resolveAutoSyncStopReason,
    runAutoExportIfEnabled,
    syncCurrentPageToServer,
    // Seek extractor
    setSeekAutoSyncWindowAttributes,
    setSeekAutoSyncSelectionAttributes,
    isSeekProfileMode,
    resolveSeekAutoSyncPageWindow,
    isSeekAutoSyncPageWindowReached,
    shouldStopSeekAutoSyncForPageWindow,
    resolveSeekAutoSyncCurrentPageSelection,
    getSeekRequestedPageSize,
    getSeekCurrentCandidateCount,
    resolveSeekAutoSyncPageSize,
    enrichSeekResumesWithDetail,
    // Pagination utils
    getPaginationInfo,
    waitForPagination,
    getNextPageButtonState,
    // Extraction pipeline
    waitForExtractionData,
    extractResumes,
    goToNextPageInternal,
    clearCapturedResultsForNextPage,
    enrich51JobSearchResumesWithDetail,
    enrichJob5156SearchResumesWithDetail,
    queueJob51DetailBackfill,
    // Snapshot collector
    collectSnapshotPayload,
    getApiSnapshotCount,
    // Resume extractor
    buildSubmitMetadata,
    extractProfileUrl: /* @__PURE__ */ __name(((resume) => extractProfileUrl(resume, void 0)), "extractProfileUrl"),
    // Collection guards
    loadCollectionGuards,
    parseGuardFieldNames,
    applyCollectionGuards,
    // Job51 search extractor
    ensureJob51PageAllowed,
    isJob51RateLimitedPage,
    waitForJob51Cooldown,
    // Job51 age filter
    filterResumesByAgeRange,
    getAgeRangeFromUrl,
    normalizeOptionalPositiveInt,
    // UI utils
    buildAutoSyncProgressHint,
    buildAutoSyncSelectedCountHint,
    buildAutoSyncCompletionHint,
    persistLatestAutoSyncSummary,
    getCurrentAgeRange,
    resolveCurrentJob51AutoSyncDetailWaitMode,
    // Dom utils
    waitForPageTransition,
    delay,
    // Content.ts scope helpers
    getCurrentSourceKey,
    SOURCE_KEYS,
    getCollectionLimits,
    getKeywordMode,
    // Job5156 extractor
    isJob5156DetailPage,
    // Job51 extractor
    isJob51DetailPage,
    // SyncStatusWidget
    SyncStatusWidget,
    // DOM globals
    document,
    window,
    // Browser API
    chrome
  });
  var { runAutoSyncIfEnabled } = _autoSyncRunner;
  var _chromeMessageHandler = createChromeMessageHandler({
    extractResumes,
    getPaginationInfo,
    buildSubmitMetadata,
    resumesToCSV,
    makeRandomId,
    downloadFile,
    buildExportMetadata,
    buildExportFilename,
    getExternalAccessorStatus: getExternalAccessorStatus2
  });
  _chromeMessageHandler.installChromeMessageListener();
  function installContentTestExports() {
    if (typeof globalThis.__TR_BROWSER_EXTENSION_TEST__ !== "object") {
      return null;
    }
    globalThis.__TR_BROWSER_EXTENSION_TEST__.content = {
      SOURCE_KEYS,
      autoApplyAgeFilterFromUrl,
      setAutoAgeAttributes,
      extractResumes,
      extractJob51DetailResume,
      extractJob5156DetailResume,
      filterCurrentResumesByAgeRange,
      getCurrentAgeRange,
      getExternalAccessorStatus: /* @__PURE__ */ __name(() => getExternalAccessorStatus({
        getExtensionVersion,
        getPaginationInfo,
        getCurrentAgeRange,
        getCurrentSourceKey,
        getApiSnapshotCount,
        getSeekCardCount,
        SOURCE_KEYS,
        isExtractionReady,
        isLoggedIn,
        apiSnapshot,
        SELECTORS,
        isJob5156DetailPage,
        isJob5156DetailReady,
        extractResumes,
        extractResumesRaw,
        collectSnapshotPayload,
        syncToServer: syncCurrentPageToServer,
        goToNextPageInternal,
        getExternalAccessorStatus,
        version: getExtensionVersion(),
        document: _accessorDoc
      }), "getExternalAccessorStatus")
    };
    return globalThis.__TR_BROWSER_EXTENSION_TEST__.content;
  }
  __name(installContentTestExports, "installContentTestExports");
  console.log("\u{1F3AF} \u667A\u901A\u76F4\u8058 Resume Collector loaded");
  installApiHook();
  installReloadHelper();
  installExternalAccessor(EXTERNAL_ACCESS_KEY, {
    getExtensionVersion,
    getPaginationInfo,
    getCurrentAgeRange,
    getCurrentSourceKey,
    getApiSnapshotCount,
    getSeekCardCount,
    SOURCE_KEYS,
    isExtractionReady,
    isLoggedIn,
    apiSnapshot,
    SELECTORS,
    isJob5156DetailPage,
    isJob5156DetailReady,
    extractResumes,
    extractResumesRaw,
    collectSnapshotPayload,
    syncToServer: syncCurrentPageToServer,
    goToNextPageInternal,
    getExternalAccessorStatus,
    version: getExtensionVersion(),
    document: _accessorDoc
  });
  installContentTestExports();
  autoSelectLocation().catch((error) => console.warn("\u{1F3AF} [Auto Location] Failed:", error)).then(() => autoSearchFromUrl()).catch((error) => console.warn("\u{1F3AF} [Auto Search] Failed:", error)).then(() => autoApplyAgeFilterFromUrl()).catch((error) => console.warn("\u{1F3AF} [Auto Age] Failed:", error)).finally(() => {
    void (async () => {
      await runAutoExportIfEnabled();
      await runAutoSyncIfEnabled();
    })();
  });
})();
