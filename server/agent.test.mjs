import assert from "node:assert/strict";
import test from "node:test";
import { runAgent } from "./agent.mjs";
import { searchXipuCases } from "./tools/search-xipu-cases.mjs";

const fixture = {
  filters: { countries: ["英国"], majors: ["应用数学"] },
  cases: [
    {
      id: "XPU-TEST-1",
      major: "应用数学",
      scores: { average: "76", ielts: "7" },
      application: {
        country: "英国",
        university: "Test University",
        program: "Data Science MSc",
        result: "Offer",
        rank: "30",
        degree: "硕士",
        site: "https://www.test.ac.uk/data-science",
        requirement: "",
      },
    },
  ],
};

test("search_xipu_cases returns only real fixture records", () => {
  const result = searchXipuCases({
    query: "应用数学76分英国案例",
    major: "应用数学",
    average: 76,
    country: "英国",
    city: null,
    targetDirection: "数据科学",
    learningInterest: [],
    qsRanking: 50,
    preferences: [],
    limit: 3,
  }, fixture);
  assert.equal(result.count, 1);
  assert.equal(result.candidates[0].caseIds[0], "XPU-TEST-1");
  assert.match(result.candidates[0].candidateKey, /^case_/);
  assert.equal(result.candidates[0].tier, "match");
});

test("search_xipu_cases infers a bare percentage score from the query", () => {
  const result = searchXipuCases({
    query: "我是应用数学的，我76分，想申请英国的数据项目",
    major: "应用数学",
    average: null,
    country: "英国",
    city: null,
    targetDirection: "数据科学",
    learningInterest: [],
    qsRanking: null,
    preferences: [],
    limit: 3,
  }, fixture);
  assert.equal(result.appliedFilters.average, 76);
});

test("Agent executes a function tool and validates the final candidate", async () => {
  const toolResult = searchXipuCases({
    query: "应用数学76分英国案例",
    major: "应用数学",
    average: 76,
    country: "英国",
    city: null,
    targetDirection: null,
    learningInterest: [],
    qsRanking: null,
    preferences: [],
    limit: 3,
  }, fixture);
  const candidate = toolResult.candidates[0];
  let calls = 0;
  const fakeModel = async () => {
    calls += 1;
    if (calls === 1) {
      return {
        output: [{
          type: "function_call",
          call_id: "call_test_1",
          name: "search_xipu_cases",
          arguments: JSON.stringify({
            query: "应用数学76分英国案例",
            major: "应用数学",
            average: 76,
            country: "英国",
            city: null,
            targetDirection: null,
            learningInterest: [],
            qsRanking: null,
            preferences: [],
            limit: 3,
          }),
        }],
      };
    }
    return {
      output_text: JSON.stringify({
        answer: "找到一条真实历史案例。",
        needsClarification: false,
        clarificationQuestions: [],
        recommendations: [{
          candidateKey: candidate.candidateKey,
          fitScore: 84,
          fitSummary: "本科专业和均分与该案例接近。",
          tradeoffs: ["历史案例不等于录取保证。"],
          evidenceCaseIds: ["XPU-TEST-1", "not-a-real-case"],
          sourceUrls: ["https://www.test.ac.uk/data-science", "https://example.com/not-official"],
        }],
      }),
    };
  };
  const result = await runAgent({ message: "我有应用数学背景，均分76，英国有类似案例吗？", caseData: fixture, model: "test", requestModelResponse: fakeModel, webSearchEnabled: false });
  assert.equal(result.usedTools[0], "search_xipu_cases");
  assert.equal(result.recommendations.length, 1);
  assert.deepEqual(result.recommendations[0].evidenceCaseIds, ["XPU-TEST-1"]);
  assert.deepEqual(result.recommendations[0].sourceUrls, []);
  assert.equal(result.meta.toolCallCount, 1);
});

test("Agent requires official web verification after case recommendations", async () => {
  const candidate = searchXipuCases({
    query: "应用数学76分英国数据科学",
    major: "应用数学",
    average: 76,
    country: "英国",
    city: null,
    targetDirection: "数据科学",
    learningInterest: [],
    qsRanking: null,
    preferences: [],
    limit: 3,
  }, fixture).candidates[0];
  const officialUrl = "https://www.test.ac.uk/data-science";
  let calls = 0;
  const fakeModel = async () => {
    calls += 1;
    if (calls === 1) {
      return {
        output: [{
          type: "function_call",
          call_id: "call_case_search",
          name: "search_xipu_cases",
          arguments: JSON.stringify({
            query: "应用数学76分英国数据科学",
            major: "应用数学",
            average: 76,
            country: "英国",
            city: null,
            targetDirection: "数据科学",
            learningInterest: [],
            qsRanking: null,
            preferences: [],
            limit: 3,
          }),
        }],
      };
    }
    if (calls === 2) {
      return {
        output_text: JSON.stringify({
          answer: "根据案例推荐该项目。",
          needsClarification: false,
          clarificationQuestions: [],
          recommendations: [],
        }),
      };
    }
    const payload = JSON.stringify({
      answer: "已结合案例和官网完成核验。",
      needsClarification: false,
      clarificationQuestions: [],
      recommendations: [{
        candidateKey: candidate.candidateKey,
        fitScore: 86,
        courseOverview: "核心内容包括数据分析与机器学习。",
        admissionRequirements: "要求定量学科背景并满足英语要求。",
        officialProgramUrl: officialUrl,
        fitSummary: "数学背景与课程方向相关。",
        tradeoffs: [],
        evidenceCaseIds: ["XPU-TEST-1"],
        sourceUrls: [officialUrl],
      }],
    });
    return {
      output: [
        { type: "web_search_call", action: { sources: [{ url: officialUrl, title: "Data Science MSc" }] } },
        { type: "message", content: [{ type: "output_text", text: payload }] },
      ],
    };
  };

  const result = await runAgent({ message: "我应用数学76分，想申请英国数据科学", caseData: fixture, model: "test", requestModelResponse: fakeModel, webSearchEnabled: true });
  assert.equal(calls, 3);
  assert.deepEqual(result.usedTools, ["search_xipu_cases", "web_search"]);
  assert.equal(result.recommendations[0].officialProgramUrl, officialUrl);
  assert.match(result.recommendations[0].courseOverview, /机器学习/);
  assert.match(result.recommendations[0].admissionRequirements, /定量学科/);
});

test("Agent forces case evidence when a score is present even if the first model turn skips the tool", async () => {
  let calls = 0;
  const fakeModel = async () => {
    calls += 1;
    if (calls === 1) {
      return {
        output_text: JSON.stringify({
          answer: "可以从金融、风险管理和商业分析方向考虑。",
          needsClarification: false,
          clarificationQuestions: [],
          recommendations: [],
        }),
      };
    }
    return {
      output_text: JSON.stringify({
        answer: "可以从金融、风险管理和商业分析方向考虑。西浦案例库也检索到相关历史记录，供参考。",
        needsClarification: false,
        clarificationQuestions: [],
        recommendations: [],
      }),
    };
  };
  const result = await runAgent({ message: "我76分，哪些金融相关专业能申请？", caseData: fixture, model: "test", requestModelResponse: fakeModel, webSearchEnabled: false });
  assert.equal(calls, 2);
  assert.deepEqual(result.usedTools, ["search_xipu_cases"]);
  assert.equal(result.recommendations.length, 1);
  assert.equal(result.recommendations[0].caseIds[0], "XPU-TEST-1");
});

test("Agent does not force cases when a user only asks about score requirements", async () => {
  let calls = 0;
  const fakeModel = async () => {
    calls += 1;
    return {
      output_text: JSON.stringify({
        answer: "可以先查看项目官网的成绩要求。",
        needsClarification: false,
        clarificationQuestions: [],
        recommendations: [],
      }),
    };
  };
  const result = await runAgent({ message: "这个项目对成绩有什么要求？", caseData: fixture, model: "test", requestModelResponse: fakeModel, webSearchEnabled: false });
  assert.equal(calls, 1);
  assert.deepEqual(result.usedTools, []);
  assert.deepEqual(result.recommendations, []);
});

test("Agent treats an explicit GPA as a case-search signal", async () => {
  let calls = 0;
  const fakeModel = async () => {
    calls += 1;
    return {
      output_text: JSON.stringify({
        answer: "可以结合项目要求和历史案例一起评估。",
        needsClarification: false,
        clarificationQuestions: [],
        recommendations: [],
      }),
    };
  };
  const result = await runAgent({ message: "我的 GPA 3.5/4.0，哪些英国项目值得考虑？", caseData: fixture, model: "test", requestModelResponse: fakeModel, webSearchEnabled: false });
  assert.equal(calls, 2);
  assert.deepEqual(result.usedTools, ["search_xipu_cases"]);
});

test("Agent treats a third-year score without 分 as a case-search signal", async () => {
  let calls = 0;
  const fakeModel = async () => {
    calls += 1;
    return {
      output_text: JSON.stringify({
        answer: "已结合西浦历史案例进行分析。",
        needsClarification: false,
        clarificationQuestions: [],
        recommendations: [],
      }),
    };
  };
  const result = await runAgent({ message: "我是应用数学，大三85，想申请英国", caseData: fixture, model: "test", requestModelResponse: fakeModel, webSearchEnabled: false });
  assert.equal(calls, 2);
  assert.deepEqual(result.usedTools, ["search_xipu_cases"]);
  assert.equal(result.recommendations[0].caseIds[0], "XPU-TEST-1");
});

test("Agent repairs provider JSON with an unescaped newline and keeps recommendations", async () => {
  const candidate = searchXipuCases({
    query: "应用数学76分英国案例",
    major: "应用数学",
    average: 76,
    country: "英国",
    city: null,
    targetDirection: null,
    learningInterest: [],
    qsRanking: null,
    preferences: [],
    limit: 3,
  }, fixture).candidates[0];
  let calls = 0;
  const fakeModel = async () => {
    calls += 1;
    if (calls === 1) return { output_text: JSON.stringify({ answer: "先检索案例。", needsClarification: false, clarificationQuestions: [], recommendations: [] }) };
    const valid = JSON.stringify({
      answer: "第一行\n第二行",
      needsClarification: false,
      clarificationQuestions: [],
      recommendations: [{
        candidateKey: candidate.candidateKey,
        fitScore: 80,
        fitSummary: "案例背景接近。",
        tradeoffs: [],
        evidenceCaseIds: ["XPU-TEST-1"],
        sourceUrls: [],
      }],
    });
    return { output_text: valid.replace("\\n", "\n") };
  };
  const result = await runAgent({ message: "我76分，哪些英国项目值得考虑？", caseData: fixture, model: "test", requestModelResponse: fakeModel, webSearchEnabled: false });
  assert.equal(result.answer, "第一行\n第二行");
  assert.equal(result.recommendations.length, 1);
});

test("Agent unwraps provider JSON whose object quotes are escaped", async () => {
  const payload = JSON.stringify({
    answer: "已根据应用数学背景完成分析。",
    needsClarification: false,
    clarificationQuestions: [],
    recommendations: [],
  });
  const fakeModel = async () => ({ output_text: payload.replaceAll('"', '\\"') });
  const result = await runAgent({ message: "应用数学适合申请什么专业？", caseData: fixture, model: "test", requestModelResponse: fakeModel, webSearchEnabled: false });
  assert.equal(result.answer, "已根据应用数学背景完成分析。");
  assert.doesNotMatch(result.answer, /\\"answer\\"/);
});
