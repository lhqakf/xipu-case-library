import { createSearchXipuCasesTool, searchXipuCasesDefinition } from "./tools/search-xipu-cases.mjs";

const MAX_TEXT_LENGTH = 2400;
const MAX_CLARIFICATION_QUESTIONS = 4;
const MAX_RECOMMENDATIONS = 18;

const agentResponseSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    answer: { type: "string" },
    needsClarification: { type: "boolean" },
    clarificationQuestions: { type: "array", items: { type: "string" } },
    recommendations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          candidateKey: { type: "string" },
          fitScore: { type: "number" },
          fitSummary: { type: "string" },
          tradeoffs: { type: "array", items: { type: "string" } },
          evidenceCaseIds: { type: "array", items: { type: "string" } },
          sourceUrls: { type: "array", items: { type: "string" } },
        },
        required: ["candidateKey", "fitScore", "fitSummary", "tradeoffs", "evidenceCaseIds", "sourceUrls"],
      },
    },
  },
  required: ["answer", "needsClarification", "clarificationQuestions", "recommendations"],
};

const agentSystemPrompt = `你是西浦案例库 V4 Agent。你可以像普通 ChatGPT 一样理解用户的自然语言，但只有在事实需要外部或本地证据时才使用工具。

工具选择规则：
1. 用户明确提供带数值的均分、平均分、成绩、分数、GPA 或绩点时，默认必须调用 search_xipu_cases。最终回答仍然要正常回答用户的问题，并把西浦真实历史案例作为单独证据补充；案例不能替代 AI 分析。用户询问西浦历史录取案例、相似背景、某校以前是否有人拿到 offer 时，也调用 search_xipu_cases。
2. 用户询问大学官网、项目课程、申请要求、数学基础、编程量、课程难度或最新项目信息时，调用 web_search。优先大学官方域名，不要把中介、博客或排名网站当作课程事实。
3. 一个问题同时涉及历史录取可能性和项目课程适配度时，可以连续调用两个工具。必须根据上一轮工具结果决定是否需要下一轮，不要假设固定调用顺序。
4. 常识解释、概念解释或不需要案例和最新官网事实的问题，可以不调用工具。
5. 信息不足时可以主动追问；不要为了凑工具调用而编造条件。

事实约束：
- search_xipu_cases 返回的案例才是可引用的西浦案例。不得编造案例、均分、录取结果、项目或排名。
- web_search 的课程和申请要求必须有官方页面支持。找不到官方证据时明确说明无法确认。
- 城市不是当前案例库的独立字段时，必须说明这一限制，不得假装完成城市精确筛选。
- 最终推荐中的 candidateKey、university、program 和 evidenceCaseIds 必须来自工具返回结果。
- 最终回答要区分历史案例证据、官方页面事实和一般性建议，不把历史案例当作录取概率。

最终输出必须是合法 JSON，字段为 answer、needsClarification、clarificationQuestions 和 recommendations。recommendations 最多 18 条；不需要推荐时返回空数组。`;

function boundedText(value, maxLength = MAX_TEXT_LENGTH) {
  return String(value || "").trim().slice(0, maxLength);
}

function boundedList(value, limit = 8, maxLength = 700) {
  return Array.isArray(value)
    ? value.map((item) => boundedText(item, maxLength)).filter(Boolean).slice(0, limit)
    : [];
}

function parseJsonText(value) {
  const cleaned = String(value || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try { return JSON.parse(cleaned); }
  catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
    throw new Error(`Agent returned invalid JSON: ${cleaned.slice(0, 300)}`);
  }
}

function outputText(response) {
  if (typeof response?.output_text === "string" && response.output_text.trim()) return response.output_text.trim();
  const chunks = [];
  for (const item of Array.isArray(response?.output) ? response.output : []) {
    for (const content of Array.isArray(item?.content) ? item.content : []) {
      if (typeof content?.text === "string" && content.text.trim()) chunks.push(content.text.trim());
    }
  }
  return chunks.join("\n").trim();
}

function hasScoreSignal(message) {
  const text = String(message || "");
  const scoreLabel = /(?:均分|平均分|成绩|分数|绩点)\s*(?:是|为|在|约|大约|:|：|=)?\s*\d{1,3}(?:\.\d+)?\s*(?:多|左右|上下)?\s*(?:分|\/\s*\d{1,3})?/i;
  const gpa = /\bGPA\s*(?:是|为|约|大约|:|：|=)?\s*\d(?:\.\d+)?(?:\s*\/\s*\d(?:\.\d+)?)?\b/i;
  const scoreWithUnit = /(?:^|[^\d.])(\d{2,3}(?:\.\d+)?)\s*(?:多|左右|上下)?\s*分(?!钟)/i;
  return scoreLabel.test(text) || gpa.test(text) || scoreWithUnit.test(text);
}

function normalizeParsedAgentPayload(parsed) {
  if (!parsed || typeof parsed !== "object") return {};
  let payload = parsed;
  if (typeof parsed.answer === "string" && /^\s*\{/.test(parsed.answer)) {
    try {
      const nested = parseJsonText(parsed.answer);
      if (nested && typeof nested === "object" && (nested.answer || nested.recommendations)) {
        payload = { ...parsed, ...nested, answer: nested.answer || parsed.answer };
        if (!Array.isArray(nested.recommendations) && Array.isArray(parsed.recommendations)) payload.recommendations = parsed.recommendations;
      }
    } catch {
      // Keep the original answer when a provider returns ordinary text beginning with a brace.
    }
  }
  return payload;
}

function functionCalls(response) {
  return (Array.isArray(response?.output) ? response.output : [])
    .filter((item) => item?.type === "function_call" && item.call_id && item.name);
}

function normalizedUrl(value) {
  const raw = String(value || "").trim();
  if (!/^https?:\/\//i.test(raw)) return "";
  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

function isOfficialEducationUrl(value) {
  const url = normalizedUrl(value);
  if (!url) return false;
  const hostname = new URL(url).hostname.toLowerCase();
  return hostname.endsWith(".ac.uk")
    || hostname.endsWith(".edu")
    || hostname.endsWith(".edu.cn")
    || hostname.endsWith(".ac.cn")
    || hostname.endsWith(".edu.au")
    || hostname.endsWith(".ac.nz")
    || hostname.endsWith(".edu.sg")
    || hostname.endsWith(".edu.hk");
}

function collectWebSources(value) {
  const sources = new Map();
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (node.type === "url_citation") {
      const url = normalizedUrl(node.url);
      if (url && isOfficialEducationUrl(url)) sources.set(url, { url, title: boundedText(node.title, 240) });
    }
    if (node.type === "web_search_call") {
      const candidates = node.action?.sources || node.sources;
      for (const source of Array.isArray(candidates) ? candidates : []) {
        const url = normalizedUrl(source?.url);
        if (url && isOfficialEducationUrl(url)) sources.set(url, { url, title: boundedText(source?.title, 240) });
      }
    }
    if (Array.isArray(node)) node.forEach(visit);
    else Object.values(node).forEach(visit);
  };
  visit(value);
  return [...sources.values()].slice(0, 20);
}

function isWebSearchUnsupported(error) {
  return /web[_ -]?search|hosted tool|tool(s)? unsupported|unknown parameter|not support|unsupported model/i.test(String(error?.message || error));
}

function toolDefinitions(webSearchEnabled, webSearchContextSize) {
  const definitions = [searchXipuCasesDefinition];
  if (webSearchEnabled) definitions.push({ type: "web_search", search_context_size: webSearchContextSize });
  return definitions;
}

function sanitizeRecommendation(item, caseRegistry, sourceRegistry) {
  const candidate = caseRegistry.get(String(item?.candidateKey || ""));
  if (!candidate) return null;
  const evidenceCaseIds = Array.isArray(item.evidenceCaseIds)
    ? item.evidenceCaseIds.map(String).filter((id) => candidate.caseIds.includes(id)).slice(0, 8)
    : [];
  const sourceUrls = Array.isArray(item.sourceUrls)
    ? item.sourceUrls.map(normalizedUrl).filter((url) => url && sourceRegistry.has(url)).slice(0, 5)
    : [];
  const fitScore = Number(item.fitScore);
  return {
    candidateKey: candidate.candidateKey,
    university: candidate.university,
    program: candidate.program,
    country: candidate.country,
    rank: candidate.rank,
    historicalAverage: candidate.historicalAverage,
    count: candidate.count,
    caseIds: candidate.caseIds,
    sampleCases: candidate.sampleCases,
    officialUrl: candidate.officialUrl,
    fitScore: Number.isFinite(fitScore) ? Math.max(0, Math.min(100, fitScore)) : null,
    fitSummary: boundedText(item.fitSummary, 800) || "暂未生成个性化匹配说明。",
    tradeoffs: boundedList(item.tradeoffs, 5, 240),
    evidenceCaseIds,
    sourceUrls,
  };
}

function fallbackAgentResult(answer, usedTools, webSources, turns, toolCallCount, webSearchAvailable) {
  return {
    agentVersion: "v4",
    answer: boundedText(answer) || "暂时无法生成回答。",
    needsClarification: false,
    clarificationQuestions: [],
    recommendations: [],
    usedTools: [...usedTools],
    sources: webSources,
    meta: { turns, toolCallCount, webSearchAvailable },
  };
}

export async function runAgent({
  message,
  caseData,
  requestModelResponse,
  model,
  webSearchEnabled = true,
  webSearchContextSize = "medium",
  maxTurns = 6,
  maxToolCalls = 8,
}) {
  const searchTool = createSearchXipuCasesTool(caseData);
  const caseRegistry = new Map();
  const usedTools = new Set();
  const sourceRegistry = new Map();
  const input = [
    { role: "system", content: [{ type: "input_text", text: agentSystemPrompt }] },
    { role: "user", content: [{ type: "input_text", text: boundedText(message, 2000) }] },
  ];
  let allowWebSearch = Boolean(webSearchEnabled);
  let response;
  let turn = 0;
  let toolCallCount = 0;
  let scoreSearchAttempted = false;

  while (turn < Math.max(1, Math.min(8, maxTurns))) {
    turn += 1;
    const request = {
      model,
      tools: toolDefinitions(allowWebSearch, webSearchContextSize),
      tool_choice: "auto",
      parallel_tool_calls: false,
      input,
      text: { format: { type: "json_schema", name: "xipu_v4_agent_response", strict: true, schema: agentResponseSchema } },
      max_output_tokens: 2400,
    };
    if (allowWebSearch) request.include = ["web_search_call.action.sources"];
    try {
      response = await requestModelResponse(request);
    } catch (error) {
      if (allowWebSearch && isWebSearchUnsupported(error)) {
        allowWebSearch = false;
        input.push({ role: "system", content: [{ type: "input_text", text: "当前模型或转发服务不支持 web_search。继续使用 search_xipu_cases；涉及最新官网信息时必须明确说明无法联网核实。" }] });
        continue;
      }
      throw error;
    }

    const sources = collectWebSources(response);
    for (const source of sources) sourceRegistry.set(source.url, source);
    if (sources.length || (Array.isArray(response?.output) && response.output.some((item) => item?.type === "web_search_call"))) usedTools.add("web_search");

    const calls = functionCalls(response);
    if (!calls.length) {
      if (hasScoreSignal(message) && !usedTools.has("search_xipu_cases") && !scoreSearchAttempted) {
        scoreSearchAttempted = true;
        if (toolCallCount >= maxToolCalls) {
          return fallbackAgentResult("工具调用次数达到上限，请缩小问题范围后重试。", usedTools, [...sourceRegistry.values()], turn, toolCallCount, allowWebSearch);
        }
        toolCallCount += 1;
        const forcedCallId = `score_search_${turn}`;
        const forcedArgs = {
          query: message,
          major: null,
          average: null,
          country: null,
          city: null,
          targetDirection: null,
          learningInterest: [],
          qsRanking: null,
          preferences: [],
          limit: 8,
        };
        let forcedResult;
        try {
          forcedResult = await searchTool.execute(forcedArgs);
          for (const candidate of forcedResult.candidates || []) caseRegistry.set(candidate.candidateKey, candidate);
          usedTools.add("search_xipu_cases");
        } catch (error) {
          forcedResult = { error: boundedText(error?.message || error, 500) };
        }
        input.push({ type: "function_call", call_id: forcedCallId, name: "search_xipu_cases", arguments: JSON.stringify(forcedArgs) });
        input.push({ type: "function_call_output", call_id: forcedCallId, output: JSON.stringify(forcedResult) });
        input.push({ role: "system", content: [{ type: "input_text", text: "用户明确提供了分数。请在正常回答用户问题的同时，结合刚才的西浦真实案例结果补充案例证据；不要只返回案例，也不要把案例当作录取保证。" }] });
        continue;
      }
      const rawAnswer = outputText(response);
      if (!rawAnswer) return fallbackAgentResult("模型没有返回可显示的回答。", usedTools, [...sourceRegistry.values()], turn, toolCallCount, allowWebSearch);
      let parsed;
      try { parsed = normalizeParsedAgentPayload(parseJsonText(rawAnswer)); }
      catch { return fallbackAgentResult(rawAnswer, usedTools, [...sourceRegistry.values()], turn, toolCallCount, allowWebSearch); }
      let recommendations = Array.isArray(parsed.recommendations)
        ? parsed.recommendations.map((item) => sanitizeRecommendation(item, caseRegistry, sourceRegistry)).filter(Boolean).slice(0, MAX_RECOMMENDATIONS)
        : [];
      if (!recommendations.length && hasScoreSignal(message) && caseRegistry.size) {
        recommendations = [...caseRegistry.values()].slice(0, MAX_RECOMMENDATIONS).map((candidate) => ({
          ...candidate,
          fitScore: null,
          fitSummary: "这是根据你的分数和问题从西浦真实历史案例中检索到的相关记录。它用于提供参考，不代表录取概率。",
          tradeoffs: [],
          evidenceCaseIds: candidate.caseIds.slice(0, 8),
          sourceUrls: [],
        }));
      }
      return {
        agentVersion: "v4",
        answer: boundedText(parsed.answer) || "已完成分析。",
        needsClarification: Boolean(parsed.needsClarification),
        clarificationQuestions: boundedList(parsed.clarificationQuestions, MAX_CLARIFICATION_QUESTIONS, 300),
        recommendations,
        usedTools: [...usedTools],
        sources: [...sourceRegistry.values()].slice(0, 20),
        model,
        meta: { turns: turn, toolCallCount, webSearchAvailable: allowWebSearch },
      };
    }

    if (toolCallCount + calls.length > maxToolCalls) {
      return fallbackAgentResult("工具调用次数达到上限，请缩小问题范围后重试。", usedTools, [...sourceRegistry.values()], turn, toolCallCount, allowWebSearch);
    }
    toolCallCount += calls.length;
    input.push(...(Array.isArray(response.output) ? response.output : []));
    for (const call of calls) {
      usedTools.add(call.name);
      let result;
      try {
        const args = call.arguments ? JSON.parse(call.arguments) : {};
        if (call.name === "search_xipu_cases") {
          result = await searchTool.execute(args);
          for (const candidate of result.candidates || []) caseRegistry.set(candidate.candidateKey, candidate);
        } else {
          result = { error: `未知工具：${call.name}` };
        }
      } catch (error) {
        result = { error: boundedText(error?.message || error, 500) };
      }
      input.push({ type: "function_call_output", call_id: call.call_id, output: JSON.stringify(result) });
    }
  }
  return fallbackAgentResult("Agent 未在限定轮次内完成分析，请重试。", usedTools, [...sourceRegistry.values()], turn, toolCallCount, allowWebSearch);
}

export { agentResponseSchema, agentSystemPrompt };
