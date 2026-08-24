const TARGET_GROUPS = [
  { label: "数据相关", triggers: ["数据", "大数据", "分析", "统计", "data", "analytics"], keywords: ["data", "analytics", "statistic", "business intelligence", "数据", "统计", "分析"] },
  { label: "计算机", triggers: ["计算机", "软件", "人工智能", "ai", "machine learning"], keywords: ["computer", "computing", "software", "artificial intelligence", "machine learning", "计算机", "软件", "人工智能"] },
  { label: "金融", triggers: ["金融", "fintech", "finance"], keywords: ["finance", "financial", "fintech", "risk management", "金融"] },
  { label: "商科管理", triggers: ["商科", "管理", "市场", "business", "management"], keywords: ["management", "marketing", "business", "commerce", "管理", "市场"] },
  { label: "传媒", triggers: ["传媒", "传播", "媒体", "media"], keywords: ["media", "communication", "journalism", "传媒", "传播"] },
  { label: "工程", triggers: ["工程", "电子", "电气", "engineering"], keywords: ["engineering", "electronic", "electrical", "工程", "电子", "电气"] },
];

const MAJOR_ROOTS = ["数学", "计算机", "数据", "电子", "电气", "金融", "经济", "会计", "传媒", "传播", "管理", "建筑", "生物", "化学", "英语"];

export function numeric(value, fallback = null) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function resolveKnownValue(value, values) {
  const candidate = text(value);
  if (!candidate) return "";
  const normalized = candidate.toLocaleLowerCase("zh-CN");
  return values
    .filter(Boolean)
    .sort((a, b) => String(b).length - String(a).length)
    .find((item) => normalized.includes(String(item).toLocaleLowerCase("zh-CN"))) || candidate;
}

function tokenize(value) {
  return text(value)
    .split(/[\s,，、;；|/]+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2)
    .filter((part) => !["专业", "方向", "相关", "希望", "想要", "课程", "偏好"].includes(part))
    .slice(0, 12);
}

const MAJOR_ALIASES = {
  "应数": "应用数学",
  "应统": "应用统计学",
  "数媒": "数字媒体技术",
  "数媒艺": "数字媒体艺术",
  "计算机类": "计算机科学与技术",
};

function findMajorMention(value, majors) {
  const source = text(value).toLocaleLowerCase("zh-CN");
  const alias = Object.entries(MAJOR_ALIASES).find(([shortName]) => source.includes(shortName));
  if (alias) return alias[1];
  return majors
    .filter(Boolean)
    .sort((a, b) => String(b).length - String(a).length)
    .find((major) => source.includes(String(major).toLocaleLowerCase("zh-CN"))) || "";
}

function inferMajorTransition(rawText, extractedMajor, extractedTargetProgram, majors) {
  const source = text(rawText);
  const marker = /转专业|转到|转向|跨专业(?:到|申请)?|转(?:入|学|读)?[^，。；\n]{0,12}(?:专业|方向)/.exec(source);
  if (!marker) return { major: text(extractedMajor), targetProgram: text(extractedTargetProgram), isMajorTransition: false };
  const before = source.slice(0, marker.index);
  const after = source.slice(marker.index + marker[0].length);
  const prefixMajor = findMajorMention(before, majors);
  const targetMajor = findMajorMention(after, majors);
  return {
    major: prefixMajor || text(extractedMajor),
    targetProgram: targetMajor || text(extractedTargetProgram),
    isMajorTransition: true,
  };
}

function majorRoot(major) {
  return MAJOR_ROOTS.find((root) => text(major).includes(root)) || text(major);
}

export function normalizeProfile(extracted, rawText, data) {
  const filters = data.filters || {};
  const average = numeric(extracted && extracted.average, null);
  const qsRanking = numeric(extracted && extracted.qsRanking, null);
  const intake = text(extracted && extracted.intake);
  const transition = inferMajorTransition(rawText, extracted && extracted.major, extracted && extracted.targetProgram, filters.majors || []);
  const targetProgram = transition.targetProgram;
  const careerGoal = text(extracted && extracted.careerGoal);
  const coursePreferences = Array.isArray(extracted && extracted.coursePreferences)
    ? extracted.coursePreferences.map(text).filter(Boolean).slice(0, 8)
    : [];
  const softPreferences = Array.isArray(extracted && extracted.softPreferences)
    ? extracted.softPreferences.filter((item) => item && typeof item === "object").map((item) => ({
        name: text(item.name),
        value: text(item.value),
        evidence: text(item.evidence),
        confidence: Math.max(0, Math.min(1, numeric(item.confidence, 0))),
      })).filter((item) => item.name && item.value).slice(0, 12)
    : [];
  const avoidTopics = Array.isArray(extracted && extracted.avoidTopics)
    ? extracted.avoidTopics.map(text).filter(Boolean).slice(0, 8)
    : [];
  const missingInformation = Array.isArray(extracted && extracted.missingInformation)
    ? extracted.missingInformation.map(text).filter(Boolean).slice(0, 8)
    : [];
  const clarificationQuestions = Array.isArray(extracted && extracted.clarificationQuestions)
    ? extracted.clarificationQuestions.map(text).filter(Boolean).slice(0, 3)
    : [];
  const targetText = [targetProgram, careerGoal, coursePreferences.join(" ")].filter(Boolean).join(" ");
  const lowerTargetText = targetText.toLocaleLowerCase("zh-CN");
  const freeKeywords = tokenize(targetProgram).concat(tokenize(coursePreferences.join(" "))).concat(tokenize(careerGoal));
  const targetGroup = TARGET_GROUPS.find((group) => group.triggers.some((word) => lowerTargetText.includes(word.toLocaleLowerCase("zh-CN"))));
  const targetKeywords = [...new Set(freeKeywords.concat(targetGroup ? targetGroup.keywords : []).map((word) => word.toLocaleLowerCase("zh-CN")))].slice(0, 24);
  const major = resolveKnownValue(transition.major, filters.majors || []);
  const country = resolveKnownValue(extracted && extracted.country, filters.countries || []);
  return {
    rawText: text(rawText),
    intent: text(extracted && extracted.intent) || "recommend_schools",
    isMajorTransition: transition.isMajorTransition,
    major,
    average: average !== null && average >= 0 && average <= 100 ? average : null,
    country,
    qsRanking: qsRanking !== null && qsRanking > 0 ? qsRanking : null,
    intake,
    targetProgram,
    careerGoal,
    coursePreferences,
    softPreferences,
    avoidTopics,
    missingInformation,
    clarificationQuestions,
    needsClarification: Boolean(extracted && extracted.needsClarification) && clarificationQuestions.length > 0,
    targetLabel: targetGroup ? targetGroup.label : "",
    targetKeywords,
  };
}

export function getAiCandidates(data, profile) {
  let cases = (data.cases || []).filter((item) => {
    const app = item.application || {};
    if (!app.university || !app.program || app.degree === "博士") return false;
    if (!String(app.result || "").includes("Offer") && app.result !== "有条件录取") return false;
    if (profile.country && app.country !== profile.country) return false;
    const rank = numeric(app.rank, null);
    if (profile.qsRanking && (rank === null || rank > profile.qsRanking)) return false;
    return numeric(item.scores && item.scores.average, null) !== null;
  });

  if (profile.major) {
    const root = majorRoot(profile.major);
    const similarMajorCases = cases.filter((item) => item.major === profile.major || (root.length >= 2 && String(item.major || "").includes(root)));
    if (similarMajorCases.length >= 9) cases = similarMajorCases;
  }

  const grouped = new Map();
  cases.forEach((item) => {
    const app = item.application;
    const key = String(app.university) + "|" + String(app.program);
    const current = grouped.get(key) || { item, scores: [], caseIds: [], samples: [], count: 0 };
    current.scores.push(numeric(item.scores.average, 0));
    current.caseIds.push(String(item.id));
    if (current.samples.length < 3) {
      current.samples.push({
        id: String(item.id),
        major: String(item.major || ""),
        average: numeric(item.scores.average, null),
        year: String(item.year || ""),
        result: String(app.result || ""),
        ielts: String(item.scores.ielts || ""),
        toefl: String(item.scores.toefl || ""),
        gre: String(item.scores.gre || ""),
      });
    }
    current.count += 1;
    grouped.set(key, current);
  });

  const candidates = [...grouped.values()].map((entry) => {
    const app = entry.item.application;
    const historicalAverage = entry.scores.reduce((sum, value) => sum + value, 0) / entry.scores.length;
    const rank = numeric(app.rank, null);
    const rankBonus = rank !== null && rank <= 10 ? 4 : rank !== null && rank <= 25 ? 2.5 : rank !== null && rank <= 50 ? 1.5 : rank !== null && rank <= 100 ? .5 : 0;
    const applicantAverage = profile.average === null ? 70 : profile.average;
    const searchable = `${app.program} ${entry.item.major || ""}`.toLocaleLowerCase("zh-CN");
    const keywordHits = profile.targetKeywords.filter((word) => searchable.includes(word.toLocaleLowerCase("zh-CN"))).length;
    return {
      item: entry.item,
      historicalAverage,
      rank,
      delta: historicalAverage + rankBonus - applicantAverage,
      count: entry.count,
      caseIds: entry.caseIds,
      samples: entry.samples,
      softRelevance: keywordHits,
    };
  });

  // Keep a broad, evidence-backed pool. Target keywords influence ordering only;
  // they must not discard a valid project just because its name uses different wording.
  return candidates
    .sort((a, b) => b.softRelevance - a.softRelevance || Math.abs(a.delta) - Math.abs(b.delta) || (a.rank === null ? 9999 : a.rank) - (b.rank === null ? 9999 : b.rank))
    .slice(0, 48);
}

export function chooseAiTiers(candidates, fitScores = new Map()) {
  const used = new Set();
  const pick = (predicate, anchor) => {
    const preferred = candidates.filter((candidate) => !used.has(candidate.item.id) && predicate(candidate));
    const chosen = preferred
      .sort((a, b) => (fitScores.get(b.candidateKey) ?? -1) - (fitScores.get(a.candidateKey) ?? -1) || b.softRelevance - a.softRelevance || Math.abs(a.delta - anchor) - Math.abs(b.delta - anchor) || (a.rank === null ? 9999 : a.rank) - (b.rank === null ? 9999 : b.rank))
      .slice(0, 6);
    chosen.forEach((candidate) => used.add(candidate.item.id));
    return chosen;
  };
  return {
    challenge: pick((candidate) => candidate.delta > 1.5, 3.5),
    match: pick((candidate) => candidate.delta >= -2 && candidate.delta <= 2, 0),
    safe: pick((candidate) => candidate.delta < -1.5, -4),
  };
}

export function serializeCandidate(candidate, candidateKey, tier) {
  const app = candidate.item.application;
  const site = String(app.site || "").trim();
  const requirement = String(app.requirement || "").trim();
  return {
    candidateKey,
    tier,
    university: String(app.university),
    program: String(app.program),
    country: String(app.country || ""),
    rank: candidate.rank,
    historicalAverage: Number(candidate.historicalAverage.toFixed(2)),
    count: candidate.count,
    caseIds: candidate.caseIds,
    sampleCases: candidate.samples,
    softRelevance: candidate.softRelevance || 0,
    officialUrl: /^https?:\/\//i.test(site) ? site : (/^https?:\/\//i.test(requirement) ? requirement : ""),
    officialCourse: candidate.officialCourse || { status: "pending", message: "课程背景待核实" },
  };
}
