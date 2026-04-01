import {
  buildWorkHistoryRawParts,
  normalizeResumeMultilineText,
  normalizeResumeText,
  stripHtmlTags,
} from "./resume-text-utils";

export const EHIRE_51JOB_HOST = "ehire.51job.com";

export const EHIRE_51JOB_PROFILE_URL_PREFIX =
  "https://ehire.51job.com/Revision/talent/resume/detail?contentType=&resumeId=";

const JOB51_DETAIL_ROOT_CANDIDATE_KEYS = [
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
  "content",
];

const PROVINCE_TOKENS = new Set([
  "北京",
  "天津",
  "上海",
  "重庆",
  "河北",
  "山西",
  "辽宁",
  "吉林",
  "黑龙江",
  "江苏",
  "浙江",
  "安徽",
  "福建",
  "江西",
  "山东",
  "河南",
  "湖北",
  "湖南",
  "广东",
  "海南",
  "四川",
  "贵州",
  "云南",
  "陕西",
  "甘肃",
  "青海",
  "台湾",
  "内蒙古",
  "广西",
  "西藏",
  "宁夏",
  "新疆",
  "香港",
  "澳门",
]);

function normalizeProvinceToken(value) {
  if (!value) return "";
  return normalizeJob51Text(value)
    .replace(/特别行政区$/g, "")
    .replace(/壮族自治区$/g, "")
    .replace(/回族自治区$/g, "")
    .replace(/维吾尔自治区$/g, "")
    .replace(/自治区$/g, "")
    .replace(/省$/g, "")
    .replace(/市$/g, "");
}

export function normalizeJob51Text(value) {
  return normalizeResumeText(stripHtmlTags(value));
}

export function normalizeJob51MultilineText(value) {
  return normalizeResumeMultilineText(stripHtmlTags(value));
}

export function isLikelyJob51LocationPlaceholderCompanyName(value) {
  const text = normalizeJob51Text(value);
  if (!text) return false;
  if (
    /(公司|集团|科技|机械|工业|实业|设备|自动化|贸易|精密|制造|电子|机电|工具|刀具|技术|股份|责任|有限|厂|大学|学院|学校|中心|医院|门诊|商贸|材料|模具|液压|传感)/u
      .test(text)
  ) {
    return false;
  }
  const provinceToken = normalizeProvinceToken(text);
  if (provinceToken && PROVINCE_TOKENS.has(provinceToken)) return true;

  const compactLocation = text.replace(/[省市区县镇乡]$/u, "");
  return /^[\u4e00-\u9fa5]{2,4}$/u.test(compactLocation);
}

export function getJob51DetailRoot(payload) {
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
  if (
    JOB51_DETAIL_ROOT_CANDIDATE_KEYS.some((key) =>
      Object.prototype.hasOwnProperty.call(record, key),
    )
  ) {
    return null;
  }
  return record;
}

export function readJob51Text(...values) {
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

export function readJob51MultilineText(...values) {
  for (const value of values) {
    if (typeof value === "string") {
      const text = normalizeJob51MultilineText(value);
      if (text) return text;
      continue;
    }
    if (Array.isArray(value)) {
      const text = value
        .map((entry) =>
          typeof entry === "string"
            ? normalizeJob51MultilineText(entry)
            : entry && typeof entry === "object"
              ? readJob51MultilineText(
                  entry.text,
                  entry.value,
                  entry.content,
                  entry.description,
                  entry.desc,
                  entry.detail,
                  entry.duty,
                  entry.responsibility,
                )
              : "",
        )
        .filter(Boolean)
        .join("\n");
      if (text) return text;
    }
  }
  return "";
}

export function normalizeJob51DateLike(value) {
  const text = readJob51Text(value);
  if (!text) return "";
  if (["至今", "目前", "今"].includes(text)) return "至今";
  return text
    .replace(/[./年]/g, "-")
    .replace(/月/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
}

export function readJob51Array(record, keys) {
  if (!record || typeof record !== "object") return [];
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}

export function buildJob51ExperienceEntry(item, kind = "work") {
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
    isProject ? item.project_name : undefined,
    isProject ? item.projectName : undefined,
    isProject ? item.project : undefined,
  );
  const companyName = isLikelyJob51LocationPlaceholderCompanyName(rawCompanyName)
    ? ""
    : rawCompanyName;
  const jobTitle = readJob51Text(
    item.work_func_value,
    item.workfunc,
    item.workfunc_str,
    item.work_func_str,
    item.job_name,
    item.jobName,
    item.position,
    item.jobTitle,
    isProject ? item.project_role : undefined,
    isProject ? item.role : undefined,
    isProject ? item.responsibility : undefined,
  );
  const startDate = normalizeJob51DateLike(
    item.start_time ??
      item.startDate ??
      item.begin ??
      item.start_date ??
      item.fromDate ??
      item.time_begin ??
      item.timefrom,
  );
  const endDate = normalizeJob51DateLike(
    item.end_time ??
      item.endDate ??
      item.end ??
      item.end_date ??
      item.toDate ??
      item.time_end ??
      item.timeto,
  );
  const durationLabel = readJob51Text(
    item.working_years,
    item.worktime,
    item.duration,
    item.timeDiff,
    item.time_diff,
    item.period,
    item.durationLabel,
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
        isProject ? item.project_desc : undefined,
        isProject ? item.projectDescribe : undefined,
      ]
        .map((value) => readJob51MultilineText(value))
        .flatMap((value) => value.split("\n"))
        .map((value) => value.trim())
        .filter(Boolean),
    ),
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
    item.project_name,
  ]
    .map((value) => readJob51Text(value))
    .filter(Boolean);
  const raw = buildWorkHistoryRawParts([
    [startDate, endDate].filter(Boolean).join("~"),
    durationLabel ? `(${durationLabel})` : "",
    companyName,
    jobTitle,
    ...metaParts,
    description,
  ]);

  if (!raw && !description && !companyName && !jobTitle) return null;

  return {
    raw:
      raw ||
      description ||
      buildWorkHistoryRawParts([companyName, jobTitle, startDate, endDate]),
    companyName: companyName || undefined,
    jobTitle: jobTitle || undefined,
    description: description || undefined,
    startDate: startDate || undefined,
    endDate: endDate || undefined,
  };
}

export function buildJob51EducationEntry(item) {
  if (!item || typeof item !== "object") return null;

  const institution = readJob51Text(
    item.school_name,
    item.schoolName,
    item.schoolname,
    item.school,
    item.institution,
    item.university,
    item.college,
  );
  const qualification = readJob51Text(
    item.degree_value,
    item.degreename,
    item.degree,
    item.degreeStr,
    item.qualification,
    item.education,
  );
  const fieldOfStudy = readJob51Text(
    item.major,
    item.degreemajor,
    item.major_name,
    item.speciality,
    item.field_of_study,
    item.subject,
  );
  const description = readJob51MultilineText(
    item.describe,
    item.description,
    item.detail,
    item.content,
  );
  const startDate = normalizeJob51DateLike(
    item.start_date ?? item.begin ?? item.startTime ?? item.enrollYear ?? item.timefrom,
  );
  const endDate = normalizeJob51DateLike(
    item.end_date ?? item.end ?? item.endTime ?? item.graduationYear ?? item.timeto,
  );

  if (!institution && !qualification && !fieldOfStudy && !description) {
    return null;
  }

  return {
    institution: institution || undefined,
    qualification: qualification || undefined,
    fieldOfStudy: fieldOfStudy || undefined,
    description: description || undefined,
    startDate: startDate || undefined,
    endDate: endDate || undefined,
  };
}

export function buildJob51SkillEntry(item) {
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
    item.tag,
  );
  if (!name) return null;

  const level = readJob51Text(item.level, item.skill_level, item.proficiency);
  const yearsOfExperience =
    typeof item.yearsOfExperience === "number" &&
    Number.isFinite(item.yearsOfExperience)
      ? item.yearsOfExperience
      : typeof item.years === "number" && Number.isFinite(item.years)
        ? item.years
        : typeof item.years === "string" && item.years.trim()
          ? item.years.trim()
          : undefined;

  if (!level && yearsOfExperience === undefined) {
    return name;
  }

  return {
    name,
    ...(level ? { level } : {}),
    ...(yearsOfExperience === undefined ? {} : { yearsOfExperience }),
  };
}

export function buildJob51LicenceEntry(item) {
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
    item.title,
  );
  if (!name) return null;

  const authority = readJob51Text(
    item.authority,
    item.organization,
    item.issuing_org,
    item.issuingOrganisationName,
    item.school,
    item.company,
  );
  const issuedAt = normalizeJob51DateLike(
    item.issuedAt ??
      item.issue_date ??
      item.issued_date ??
      item.start_date ??
      item.startTime,
  );
  const expiresAt = normalizeJob51DateLike(
    item.expiresAt ??
      item.expire_date ??
      item.expired_date ??
      item.end_date ??
      item.endTime,
  );

  return {
    name,
    ...(authority ? { authority } : {}),
    ...(issuedAt ? { issuedAt } : {}),
    ...(expiresAt ? { expiresAt } : {}),
  };
}

export function buildJob51DetailResumeFromPayload(payload, options = {}) {
  const root = getJob51DetailRoot(payload);
  if (!root) return [];
  const normalizedOptions =
    options && typeof options === "object" ? options : {};
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
    root.base_info?.resumeId,
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
    root.user_id,
  );
  const profileUrl = normalizeJob51Text(
    optionProfileUrl ||
      (resumeId
        ? `${EHIRE_51JOB_PROFILE_URL_PREFIX}${encodeURIComponent(resumeId)}`
        : ""),
  );
  const baseInfo =
    root.base_info && typeof root.base_info === "object" ? root.base_info : {};
  const liveJobIntention =
    Array.isArray(root.jobintention) && root.jobintention[0] &&
    typeof root.jobintention[0] === "object"
      ? root.jobintention[0]
      : {};
  const liveHighestDegree =
    root.highestdegree && typeof root.highestdegree === "object"
      ? root.highestdegree
      : {};
  const jobIntentionInfo =
    root.job_intention && typeof root.job_intention === "object"
      ? root.job_intention
      : {};
  const recentWorkInfo =
    root.recent_work_info && typeof root.recent_work_info === "object"
      ? root.recent_work_info
      : {};
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
    "work_exp_list",
  ])
    .map((item) => buildJob51ExperienceEntry(item, "work"))
    .filter(Boolean);
  const projectExperience = readJob51Array(root, [
    "project",
    "project_list",
    "projectInfoVoList",
    "projectInfoList",
    "projectExperience",
    "project_experience",
    "projectExperienceList",
  ])
    .map((item) => buildJob51ExperienceEntry(item, "project"))
    .filter(Boolean);
  const profileEducation = readJob51Array(root, [
    "education",
    "education_list",
    "educationInfoVoList",
    "profileEducation",
    "educationHistory",
  ])
    .map((item) => buildJob51EducationEntry(item))
    .filter(Boolean);
  const skills = readJob51Array(root, [
    "itskill",
    "skill",
    "skills",
    "skill_list",
    "label_sorted_skill_tag_list",
    "label_list",
  ])
    .map((item) => buildJob51SkillEntry(item))
    .filter(Boolean);
  const licences = [
    ...readJob51Array(root, [
      "certification",
      "certifications",
      "certificate",
      "certificates",
    ]),
    ...readJob51Array(root, ["train", "training", "train_list", "trainings"]),
  ]
    .map((item) => buildJob51LicenceEntry(item))
    .filter(Boolean);

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
    baseInfo.userName,
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
    recentWorkInfo?.working_years,
  );
  const education = readJob51Text(
    baseInfo.top_degree_value,
    root.top_degree_value,
    liveHighestDegree.degree,
    root.education,
    root.degree,
    root.degreeValue,
  );
  const location = readJob51Text(
    jobIntentionInfo.expect_job_area_value,
    Array.isArray(liveJobIntention.expectarea)
      ? liveJobIntention.expectarea
          .map((item) =>
            item && typeof item === "object"
              ? readJob51Text(item.provincecity, item.county)
              : "",
          )
          .filter(Boolean)
          .join(",")
      : undefined,
    root.jobIntention?.expect_job_area_value,
    baseInfo.area_value,
    root.area,
    root.areaprovincecity,
    root.location,
    root.workCity,
    root.city,
    root.workLocation,
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
    root.searchJob,
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
    root.salary,
  );
  const activityStatus = readJob51Text(
    root.active_type,
    root.activityStatus,
    root.activetimelabel,
    root.activetime,
    root.lastLoginTime,
    root.last_login_time,
    baseInfo.active_type,
    baseInfo.jobStateStr,
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
    jobIntentionInfo.professionSkill,
  );
  const normalizedAge = age ? (age.includes("岁") ? age : `${age}岁`) : "";
  const externalId = resumeId || perUserId;
  const pageIndex = 1;
  const source = EHIRE_51JOB_HOST;

  if (
    !resumeId &&
    !name &&
    !jobIntention &&
    !selfIntro &&
    workHistory.length === 0
  ) {
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
      resumeId: resumeId || undefined,
      perUserId: perUserId || undefined,
      externalId: externalId || undefined,
      profileUrl: profileUrl || undefined,
      source,
      workHistory,
      projectExperience:
        projectExperience.length > 0 ? projectExperience : undefined,
      profileEducation:
        profileEducation.length > 0 ? profileEducation : undefined,
      skills: skills.length > 0 ? skills : undefined,
      licences: licences.length > 0 ? licences : undefined,
      pageIndex,
      rawData: root,
      extractedAt: new Date().toISOString(),
    },
  ];
}
