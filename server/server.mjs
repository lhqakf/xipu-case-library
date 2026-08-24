import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadCaseData } from "./data-loader.mjs";
import { chooseAiTiers, getAiCandidates, normalizeProfile, numeric, serializeCandidate } from "./matcher.mjs";
import { runAgent } from "./agent.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envFile = path.join(projectRoot, ".env");
try {
  const envText = await fs.readFile(envFile, "utf8");
  for (const line of envText.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^(["\'])(.*)\1$/, "$2");
    if (!process.env[key]) process.env[key] = value;
  }
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

const port = Number(process.env.PORT || 4173);
const model = process.env.OPENAI_MODEL || "gpt-5.6-luna";
const oneApiBaseURL = process.env.OPENAI_BASE_URL || "";
const apiAuthHeader = String(process.env.OPENAI_AUTH_HEADER || "x-api-key").trim().toLowerCase();
const apiKeyConfigured = Boolean(process.env.OPENAI_API_KEY);
const webSearchEnabled = !["0", "false", "off", "no"].includes(String(process.env.OPENAI_WEB_SEARCH || "true").trim().toLowerCase());
const webSearchContextSize = ["low", "medium", "high"].includes(String(process.env.OPENAI_WEB_SEARCH_CONTEXT || "medium").trim().toLowerCase())
  ? String(process.env.OPENAI_WEB_SEARCH_CONTEXT || "medium").trim().toLowerCase()
  : "medium";
const agentMaxTurns = Math.max(1, Math.min(8, Number(process.env.OPENAI_AGENT_MAX_TURNS || 6)));
const agentMaxToolCalls = Math.max(1, Math.min(12, Number(process.env.OPENAI_AGENT_MAX_TOOL_CALLS || 8)));
const maxBodyBytes = 16 * 1024;
const allowedOrigins = (process.env.FRONTEND_ORIGIN || "http://localhost:4173,http://localhost:5500,http://localhost:8787")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const apiKey = process.env.OPENAI_API_KEY || "";
const caseData = await loadCaseData();
let lastOneApiSuccessAt = null;
let lastOneApiResponseId = null;

async function createModelResponse(request) {
  if (!apiKey) throw new Error("OPENAI_API_KEY 未配置");
  if (!oneApiBaseURL) throw new Error("OPENAI_BASE_URL 未配置，无法确认正在调用公司 One API");
  if (!model) throw new Error("OPENAI_MODEL 未配置");
  const endpoint = oneApiBaseURL.replace(/\/+$/, "") + "/responses";
  const authValue = apiAuthHeader === "authorization" ? `Bearer ${apiKey}` : apiKey;
  const result = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", [apiAuthHeader]: authValue },
    body: JSON.stringify(request),
  });
  const body = await result.text();
  let response;
  try { response = body ? JSON.parse(body) : {}; } catch { response = {}; }
  if (!result.ok) {
    const detail = response.error?.message || body.slice(0, 500) || `HTTP ${result.status}`;
    throw new Error(`One API HTTP ${result.status}: ${detail}`);
  }
  lastOneApiSuccessAt = new Date().toISOString();
  lastOneApiResponseId = response.id || null;
  return response;
}

const extractionSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    intent: { type: "string", enum: ["recommend_schools", "compare_programs", "explain_program", "other"] },
    isMajorTransition: { type: "boolean" },
    major: { type: ["string", "null"] },
    average: { type: ["number", "null"] },
    country: { type: ["string", "null"] },
    qsRanking: { type: ["number", "null"] },
    intake: { type: ["string", "null"] },
    applicationTarget: { type: ["string", "null"] },
    targetProgram: { type: ["string", "null"] },
    learningInterest: { type: "array", items: { type: "string" } },
    studyIntent: { type: "string", enum: ["applying", "exploring", "future_interest", "career_only", "unclear"] },
    careerGoal: { type: ["string", "null"] },
    coursePreferences: { type: "array", items: { type: "string" } },
    softPreferences: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          value: { type: "string" },
          evidence: { type: "string" },
          confidence: { type: "number" },
        },
        required: ["name", "value", "evidence", "confidence"],
      },
    },
    avoidTopics: { type: "array", items: { type: "string" } },
    missingInformation: { type: "array", items: { type: "string" } },
    clarificationQuestions: { type: "array", items: { type: "string" } },
    uncertainties: { type: "array", items: { type: "string" } },
    needsClarification: { type: "boolean" },
  },
  required: ["intent", "isMajorTransition", "major", "average", "country", "qsRanking", "intake", "applicationTarget", "targetProgram", "learningInterest", "studyIntent", "careerGoal", "coursePreferences", "softPreferences", "avoidTopics", "missingInformation", "clarificationQuestions", "uncertainties", "needsClarification"],
};

const adviceSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    recommendations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
          properties: {
          candidateKey: { type: "string" },
          fitScore: { type: "number" },
          programFocus: { type: "string" },
          fitSummary: { type: "string" },
          tradeoffs: { type: "array", items: { type: "string" } },
          evidenceCaseIds: { type: "array", items: { type: "string" } },
        },
        required: ["candidateKey", "fitScore", "programFocus", "fitSummary", "tradeoffs", "evidenceCaseIds"],
      },
    },
  },
  required: ["summary", "recommendations"],
};

function jsonResponse(response, status, payload, origin) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "vary": "Origin",
  });
  response.end(body);
}

function requestOrigin(request) {
  const origin = request.headers.origin || "";
  if (allowedOrigins.includes("*")) return origin || "*";
  return allowedOrigins.includes(origin) ? origin : (allowedOrigins[0] || origin || "*");
}

async function readJson(request) {
  let total = 0;
  const chunks = [];
  for await (const chunk of request) {
    total += chunk.length;
    if (total > maxBodyBytes) throw new Error("Request is too large");
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function outputText(response) {
  if (typeof response.output_text === "string" && response.output_text.trim()) return response.output_text;
  const chunks = [];
  for (const item of Array.isArray(response.output) ? response.output : []) {
    for (const content of Array.isArray(item.content) ? item.content : []) {
      if (typeof content.text === "string" && content.text.trim()) chunks.push(content.text);
    }
  }
  const text = chunks.join("\n").trim();
  if (text) return text;
  if (response.error?.message) throw new Error(`One API response error: ${response.error.message}`);
  throw new Error("OpenAI returned no structured output (checked output_text and output[].content[].text)");
}

function parseJsonText(value) {
  const cleaned = String(value || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try { return JSON.parse(cleaned); }
  catch (error) {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
    throw new Error(`One API returned invalid JSON: ${cleaned.slice(0, 300)}`);
  }
}

const officialEvidenceCache = new Map();

function extractOfficialPageEvidence(html, url) {
  const source = String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ");
  const title = (source.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "")
    .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const description = source.match(/<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([^"']*)["']/i)?.[1] || "";
  const excerpt = source.replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim().slice(0, 1400);
  if (!title && !description && !excerpt) return { status: "unavailable", url, message: "课程背景待核实" };
  return { status: "ok", url, title: title.slice(0, 240), description: description.slice(0, 600), excerpt };
}

async function fetchOfficialPageEvidence(url) {
  if (!url || !/^https?:\/\//i.test(url)) return { status: "unavailable", message: "课程背景待核实" };
  if (officialEvidenceCache.has(url)) return officialEvidenceCache.get(url);
  const task = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const result = await fetch(url, { signal: controller.signal, headers: { accept: "text/html,application/xhtml+xml" } });
      if (!result.ok) return { status: "unavailable", url, message: "课程背景待核实" };
      return extractOfficialPageEvidence((await result.text()).slice(0, 180000), url);
    } catch {
      return { status: "unavailable", url, message: "课程背景待核实" };
    } finally {
      clearTimeout(timer);
    }
  })();
  officialEvidenceCache.set(url, task);
  return task;
}

async function attachOfficialEvidence(candidates) {
  return Promise.all(candidates.map(async (candidate) => {
    const app = candidate.item?.application || {};
    const site = String(app.site || "").trim();
    const requirement = String(app.requirement || "").trim();
    candidate.officialUrl = /^https?:\/\//i.test(site) ? site : (/^https?:\/\//i.test(requirement) ? requirement : "");
    candidate.officialCourse = await fetchOfficialPageEvidence(candidate.officialUrl);
    return candidate;
  }));
}

const extractionSemanticsPrompt = "你是自然语言留学需求理解器，不是关键词分类器。先完整理解用户原话，再输出结构化画像。current major 是用户现在的本科专业；applicationTarget 只有在用户明确表达申请、读研、硕士、转专业、目标项目或准备入读时才填写。targetProgram 是 applicationTarget 的兼容别名，若没有明确申请意图必须为 null。learningInterest 专门记录‘以后想学、想了解、感兴趣、可能学习’的方向，它不等于申请目标。studyIntent 用 applying 表示明确申请，exploring 表示了解/探索，future_interest 表示未来想学但尚未决定申请，career_only 表示只谈职业，unclear 表示无法判断。‘以后想做数据分析师’是 careerGoal，不是 learningInterest；‘以后想学数据科学’是 learningInterest，不是 applicationTarget。只有出现申请/读研/硕士/转入等语境，才把方向写入 applicationTarget。softPreferences 记录偏实践、少编程、喜欢案例、在意就业等开放式偏好。保留用户原话中的不确定性到 uncertainties，不要擅自补全事实。信息不完整时仍然继续生成分析，不要阻塞用户，不要要求用户先补充字段；可以把不确定性写入 uncertainties 和 clarificationQuestions，供最终 GPT 在回答中自然说明。";

async function extractProfile(message) {
  const response = await createModelResponse({
    model,
    text: { format: { type: "json_schema", name: "xipu_user_intent", strict: true, schema: extractionSchema } },
    input: [
      {
        role: "system",
        content: [{ type: "input_text", text: extractionSemanticsPrompt }],
      },
      { role: "user", content: [{ type: "input_text", text: message }] },
    ],
    max_output_tokens: 500,
  });
  return parseJsonText(outputText(response));
}

const adviceSystemPrompt = "你是留学选校顾问，负责像普通 ChatGPT 一样先理解用户完整原话，再结合西浦案例库回答。区分明确申请目标 applicationTarget、学习兴趣 learningInterest、职业目标 careerGoal 和软性偏好；learningInterest 不等于申请目标。即使用户只是想了解或以后想学某方向，也可以给出探索性通用建议，并明确说明尚未确认申请目标。候选项目、历史成绩、排名和案例证据只能使用输入候选池中的事实。每个候选项目返回 fitScore（0-100 软性匹配分）、programFocus、fitSummary、tradeoffs 和 evidenceCaseIds。只有 officialCourse.status=ok 时才能引用官方课程摘要，否则 programFocus 必须写‘课程背景待核实’。evidenceCaseIds 只能来自该候选 caseIds，candidateKey 只能来自候选池。不得编造课程、排名、录取概率、就业结果、学校或案例。不得把历史案例均分接近当作唯一理由。最多返回 18 个候选，最终只输出合法 JSON。";

async function generateAdvice(originalMessage, profile, candidates) {
  const response = await createModelResponse({
    model,
    text: { format: { type: "json_schema", name: "xipu_recommendation_advice", strict: true, schema: adviceSchema } },
    input: [
      {
        role: "system",
        content: [{ type: "input_text", text: adviceSystemPrompt }],
      },
      {
        role: "user",
        content: [{
          type: "input_text",
          text: JSON.stringify({ instructions: adviceSystemPrompt, originalMessage, profile, candidates }),
        }],
      },
    ],
    max_output_tokens: 2200,
  });
  return parseJsonText(outputText(response));
}

async function recommend(message) {
  const extracted = await extractProfile(message);
  const profile = normalizeProfile(extracted, message, caseData);
  const candidates = await attachOfficialEvidence(getAiCandidates(caseData, profile).map((candidate, index) => {
    candidate.candidateKey = "c" + index;
    return candidate;
  }));
  const candidateMap = new Map(candidates.map((candidate) => [candidate.candidateKey, serializeCandidate(candidate, candidate.candidateKey, "pool")]));

  const advice = candidateMap.size
    ? await generateAdvice(message, {
        major: profile.major || null,
        average: profile.average,
        country: profile.country || null,
        qsRanking: profile.qsRanking,
        intake: profile.intake || null,
        applicationTarget: profile.applicationTarget || null,
        targetProgram: profile.targetProgram || null,
        learningInterest: profile.learningInterest,
        studyIntent: profile.studyIntent,
        careerGoal: profile.careerGoal || null,
        coursePreferences: profile.coursePreferences,
        softPreferences: profile.softPreferences,
        avoidTopics: profile.avoidTopics,
        missingInformation: profile.missingInformation,
        uncertainties: profile.uncertainties,
      }, [...candidateMap.values()])
    : { summary: "暂未找到同时满足当前条件的历史案例，请放宽地区、排名或目标专业条件后重试。", recommendations: [] };

  const adviceMap = new Map();
  for (const item of Array.isArray(advice.recommendations) ? advice.recommendations : []) {
    const candidate = candidateMap.get(item?.candidateKey);
    if (!candidate) continue;
    const validEvidence = Array.isArray(item.evidenceCaseIds) ? item.evidenceCaseIds.filter((id) => candidate.caseIds.includes(String(id))).slice(0, 8) : [];
    const fitScore = Math.max(0, Math.min(100, numeric(item.fitScore, 0)));
    adviceMap.set(item.candidateKey, {
      fitScore,
      programFocus: candidate.officialCourse?.status === "ok" ? String(item.programFocus || "课程背景待核实").slice(0, 500) : "课程背景待核实",
      fitSummary: String(item.fitSummary || "暂未生成个性化匹配说明。").slice(0, 700),
      tradeoffs: Array.isArray(item.tradeoffs) ? item.tradeoffs.map((value) => String(value).trim()).filter(Boolean).slice(0, 5) : [],
      evidenceCaseIds: validEvidence,
    });
  }

  const fitScores = new Map([...adviceMap.entries()].map(([key, value]) => [key, value.fitScore]));
  const rawTiers = chooseAiTiers(candidates, fitScores);
  const tiers = { challenge: [], match: [], safe: [] };
  for (const tier of Object.keys(tiers)) {
    tiers[tier] = rawTiers[tier].map((candidate) => {
      const serialized = candidateMap.get(candidate.candidateKey);
      const adviceItem = adviceMap.get(candidate.candidateKey) || {};
      return {
        ...serialized,
        tier,
        fitScore: adviceItem.fitScore ?? null,
        programFocus: adviceItem.programFocus || "课程背景待核实",
        fitSummary: adviceItem.fitSummary || "暂未生成个性化匹配说明。",
        tradeoffs: adviceItem.tradeoffs || [],
        evidenceCaseIds: adviceItem.evidenceCaseIds || [],
      };
    });
  }

  return {
    profile: {
      rawText: profile.rawText,
      major: profile.major || null,
      isMajorTransition: profile.isMajorTransition,
      average: profile.average,
      country: profile.country || null,
      qsRanking: profile.qsRanking,
      intake: profile.intake || null,
      applicationTarget: profile.applicationTarget || null,
      targetProgram: profile.targetProgram || null,
      learningInterest: profile.learningInterest,
      studyIntent: profile.studyIntent,
      careerGoal: profile.careerGoal || null,
      coursePreferences: profile.coursePreferences,
      softPreferences: profile.softPreferences,
      avoidTopics: profile.avoidTopics,
      missingInformation: profile.missingInformation,
      uncertainties: profile.uncertainties,
      targetLabel: profile.targetLabel || null,
    },
    candidatesCount: candidates.length,
    summary: advice.summary || "已根据历史案例生成建议。",
    needsClarification: false,
    clarificationQuestions: profile.clarificationQuestions,
    tiers,
    mode: "llm",
    model,
    providerBaseURL: oneApiBaseURL || "https://api.openai.com/v1",
  };
}

async function agentRecommend(message) {
  return runAgent({
    message,
    caseData,
    model,
    webSearchEnabled,
    webSearchContextSize,
    maxTurns: agentMaxTurns,
    maxToolCalls: agentMaxToolCalls,
    requestModelResponse: createModelResponse,
  });
}

const staticMimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

async function serveStatic(request, response) {
  const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const filePath = path.resolve(projectRoot, relativePath);
  const allowedRoot = projectRoot + path.sep;
  if (filePath !== projectRoot && !filePath.startsWith(allowedRoot)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }
  try {
    const body = await fs.readFile(filePath);
    response.writeHead(200, {
      "content-type": staticMimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream",
      "cache-control": "no-store",
    });
    response.end(request.method === "HEAD" ? undefined : body);
  } catch (error) {
    response.writeHead(error.code === "ENOENT" ? 404 : 500, { "content-type": "text/plain; charset=utf-8" });
    response.end(error.code === "ENOENT" ? "Not found" : "Unable to read file");
  }
}

const server = http.createServer(async (request, response) => {
  const origin = requestOrigin(request);
  if (request.method === "OPTIONS") {
    response.writeHead(204, {
      "access-control-allow-origin": origin,
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type",
      "access-control-max-age": "86400",
      vary: "Origin",
    });
    response.end();
    return;
  }
  if (request.method === "GET" && request.url === "/health") {
    jsonResponse(response, 200, {
      ok: true,
      service: "xipu-ai-backend",
      model,
      openaiKeyConfigured: apiKeyConfigured,
      oneApiConfigured: Boolean(oneApiBaseURL),
      oneApiCallVerified: Boolean(lastOneApiSuccessAt),
      lastOneApiSuccessAt,
      lastOneApiResponseId,
      providerBaseURL: oneApiBaseURL || null,
      webSearchEnabled,
      webSearchContextSize,
      agentEndpoint: "/api/ai-agent",
      agentMaxTurns,
      agentMaxToolCalls,
      note: lastOneApiSuccessAt ? "公司 One API 已返回成功的 Responses API 响应" : "尚未验证成功调用公司 One API",
    }, origin);
    return;
  }
  if (request.method === "GET" || request.method === "HEAD") {
    await serveStatic(request, response);
    return;
  }
  const isRecommendationRoute = request.method === "POST" && request.url === "/api/ai-recommend";
  const isAgentRoute = request.method === "POST" && request.url === "/api/ai-agent";
  if (!isRecommendationRoute && !isAgentRoute) {
    jsonResponse(response, 404, { error: "Not found" }, origin);
    return;
  }
  try {
    const payload = await readJson(request);
    const message = typeof payload.message === "string" ? payload.message.trim() : "";
    if (!message) {
      jsonResponse(response, 400, { error: "message is required" }, origin);
      return;
    }
    if (message.length > 2000) {
      jsonResponse(response, 400, { error: "message is too long" }, origin);
      return;
    }
    const result = isAgentRoute ? await agentRecommend(message) : await recommend(message);
    jsonResponse(response, 200, result, origin);
  } catch (error) {
    console.error(isAgentRoute ? "AI agent failed:" : "AI recommendation failed:", error instanceof Error ? error.message : error);
    const status = error && /Request is too large|JSON/.test(String(error.message || error)) ? 400 : 502;
    const detail = error instanceof Error ? error.message : String(error);
    jsonResponse(response, status, { error: "OpenAI 请求失败", detail, model, providerBaseURL: oneApiBaseURL || "https://api.openai.com/v1" }, origin);
  }
});

server.listen(port, () => {
  console.log("XIPU local AI site listening on http://localhost:" + port);
});
