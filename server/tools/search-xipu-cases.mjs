import { getAiCandidates, normalizeProfile, serializeCandidate, numeric } from "../matcher.mjs";

const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 12;

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function boundedText(value, maxLength = 180) {
  return text(value).slice(0, maxLength);
}

function boundedList(value, limit = 8) {
  return Array.isArray(value)
    ? value.map((item) => boundedText(item)).filter(Boolean).slice(0, limit)
    : [];
}

function inferAverage(query) {
  const source = text(query);
  const match = source.match(/(?:均分|平均分|成绩|分数|绩点)[^0-9]{0,8}(\d{2,3}(?:\.\d+)?)/i)
    || source.match(/(?:^|[^\d.])(\d{2,3}(?:\.\d+)?)\s*(?:多|左右|上下)?\s*分(?!钟)/i);
  const value = numeric(match?.[1], null);
  return value !== null && value >= 0 && value <= 100 ? value : null;
}

function inferKnownValue(query, values) {
  const source = text(query).toLocaleLowerCase("zh-CN");
  return values
    .filter(Boolean)
    .sort((a, b) => String(b).length - String(a).length)
    .find((value) => source.includes(String(value).toLocaleLowerCase("zh-CN"))) || "";
}

function stableHash(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function candidateKey(candidate) {
  const app = candidate.item?.application || {};
  return `case_${stableHash(`${app.university || ""}|${app.program || ""}`)}`;
}

function recommendationTier(candidate, applicantAverage) {
  if (!Number.isFinite(applicantAverage)) return "match";
  if (candidate.delta > 1.5) return "challenge";
  if (candidate.delta < -1.5) return "safe";
  return "match";
}

function normalizeToolArguments(argumentsValue, caseData) {
  const args = argumentsValue && typeof argumentsValue === "object" ? argumentsValue : {};
  const query = boundedText(args.query, 1200);
  const filters = caseData.filters || {};
  const major = boundedText(args.major, 120);
  const country = boundedText(args.country, 80) || inferKnownValue(query, filters.countries || []);
  const average = numeric(args.average, null) ?? inferAverage(query);
  const targetDirection = boundedText(args.targetDirection, 180);
  const learningInterest = boundedList(args.learningInterest, 8);
  const preferences = boundedList(args.preferences, 8);
  const qsRanking = numeric(args.qsRanking, null);
  const city = boundedText(args.city, 80);
  const extracted = {
    intent: "recommend_schools",
    isMajorTransition: false,
    major: major || inferKnownValue(query, filters.majors || []),
    average,
    country: country || null,
    qsRanking: qsRanking !== null && qsRanking > 0 ? qsRanking : null,
    intake: null,
    applicationTarget: targetDirection || null,
    targetProgram: targetDirection || null,
    learningInterest,
    studyIntent: "exploring",
    careerGoal: null,
    coursePreferences: preferences,
    softPreferences: preferences.map((value) => ({ name: "用户偏好", value, evidence: query, confidence: 0.7 })),
    avoidTopics: [],
    missingInformation: [],
    clarificationQuestions: [],
    uncertainties: [],
    needsClarification: false,
  };
  return { args, query, city, targetDirection, profile: normalizeProfile(extracted, query, caseData) };
}

export const searchXipuCasesDefinition = {
  type: "function",
  name: "search_xipu_cases",
  description: "查询西浦真实历史录取案例。只能返回案例库中存在的真实记录，不得编造或推测不存在的案例。",
  strict: true,
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      query: { type: "string" },
      major: { type: ["string", "null"] },
      average: { type: ["number", "null"] },
      country: { type: ["string", "null"] },
      city: { type: ["string", "null"] },
      targetDirection: { type: ["string", "null"] },
      learningInterest: { type: "array", items: { type: "string" } },
      qsRanking: { type: ["number", "null"] },
      preferences: { type: "array", items: { type: "string" } },
      limit: { type: "integer", minimum: 1, maximum: MAX_LIMIT },
    },
    required: ["query", "major", "average", "country", "city", "targetDirection", "learningInterest", "qsRanking", "preferences", "limit"],
  },
};

export function searchXipuCases(argumentsValue, caseData) {
  const normalized = normalizeToolArguments(argumentsValue, caseData);
  const requestedLimit = numeric(normalized.args.limit, DEFAULT_LIMIT);
  const limit = Math.max(1, Math.min(MAX_LIMIT, Math.round(requestedLimit || DEFAULT_LIMIT)));
  const candidates = getAiCandidates(caseData, normalized.profile)
    .slice(0, limit)
    .map((candidate) => {
      const key = candidateKey(candidate);
      return {
        ...serializeCandidate(candidate, key, "agent"),
        tier: recommendationTier(candidate, normalized.profile.average),
      };
    });
  const limitations = [];
  if (normalized.city) limitations.push("案例库目前没有独立城市字段，城市条件未用于精确筛选。");
  if (normalized.profile.average === null) limitations.push("用户均分未明确，历史案例按默认锚点进行宽泛排序。");
  if (!candidates.length) limitations.push("当前条件下没有找到符合真实案例库筛选条件的项目。");
  return {
    type: "xipu_case_search_result",
    query: normalized.query,
    appliedFilters: {
      major: normalized.profile.major || null,
      average: normalized.profile.average,
      country: normalized.profile.country || null,
      city: normalized.city || null,
      targetDirection: normalized.targetDirection || null,
      learningInterest: normalized.profile.learningInterest,
      qsRanking: normalized.profile.qsRanking,
      preferences: normalized.profile.coursePreferences,
    },
    count: candidates.length,
    candidates,
    limitations,
  };
}

export function createSearchXipuCasesTool(caseData) {
  return {
    definition: searchXipuCasesDefinition,
    async execute(argumentsValue) {
      return searchXipuCases(argumentsValue, caseData);
    },
  };
}
