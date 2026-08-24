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
