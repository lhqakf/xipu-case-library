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
