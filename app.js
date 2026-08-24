(function () {
  "use strict";

  const data = window.XIPU_CASE_DATA;
  if (!data) {
    document.body.innerHTML = '<main class="empty-state"><h3>案例数据加载失败</h3></main>';
    return;
  }

  const $ = (selector) => document.querySelector(selector);
  const number = new Intl.NumberFormat("zh-CN");
  const pinyinCollator = new Intl.Collator("zh-CN-u-co-pinyin", { sensitivity: "base" });
  const saved = new Set(JSON.parse(localStorage.getItem("xipu-saved-cases") || "[]"));
  const state = {
    query: "",
    majors: [],
    countries: [...data.filters.countries],
    year: "",
    track: "",
    result: "",
    minScore: 50,
    completeScores: false,
    scoreMatch: false,
    matchScores: { y1: null, y2: null, y3: null },
    sort: "recent",
    savedOnly: false,
    aiReturnAvailable: false,
    aiCaseIds: [],
    visible: 24,
  };

  const elements = {
    search: $("#searchInput"),
    clearSearch: $("#clearSearch"),
    matchY1: $("#matchY1"),
    matchY2: $("#matchY2"),
    matchY3: $("#matchY3"),
    matchAverage: $("#matchAverage"),
    matchButton: $("#matchScores"),
    major: $("#majorFilter"),
    country: $("#countryFilter"),
    year: $("#yearFilter"),
    track: $("#trackFilter"),
    result: $("#resultFilter"),
    score: $("#scoreFilter"),
    scoreOutput: $("#scoreOutput"),
    completeScores: $("#hasScoreFilter"),
    sort: $("#sortFilter"),
    grid: $("#caseGrid"),
    count: $("#resultCount"),
    title: $("#resultTitle"),
    backFromSaved: $("#backFromSaved"),
    backToAiResults: $("#backToAiResults"),
    chips: $("#activeChips"),
    empty: $("#emptyState"),
    loadMore: $("#loadMore"),
    savedCount: $("#savedCount"),
    savedButton: $("#savedButton"),
    savedNav: $("#savedNav"),
    homeNav: $("#homeNav"),
    filters: $("#filtersPanel"),
    filterBackdrop: $("#filterBackdrop"),
    drawer: $("#detailDrawer"),
    drawerBackdrop: $("#drawerBackdrop"),
    drawerTitle: $("#drawerTitle"),
    drawerContent: $("#drawerContent"),
    caseModeButton: $("#caseModeButton"),
    aiModeButton: $("#aiModeButton"),
    caseOverview: $("#caseOverview"),
    caseWorkspace: $("#caseWorkspace"),
    aiSchoolView: $("#aiSchoolView"),
    aiProfileInput: $("#aiProfileInput"),
    aiAnalyzeButton: $("#aiAnalyzeButton"),
    aiAnalysis: $("#aiAnalysis"),
    aiModeStatus: $("#aiModeStatus"),
    aiProfileSummary: $("#aiProfileSummary"),
    aiSummaryText: $("#aiSummaryText"),
    aiTierGrid: $("#aiTierGrid"),
  };

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function optionMarkup(values) {
    return values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("");
  }

  const sortedMajors = [...data.filters.majors].sort(pinyinCollator.compare);

  function renderMajorOptions(search = $("#majorSearch").value) {
    const keyword = search.trim().toLocaleLowerCase("zh-CN");
    const searchInput = $("#majorSearch");
    const selectedLabel = state.majors.slice().sort(pinyinCollator.compare).join("、");
    searchInput.placeholder = state.majors.length ? (state.majors.length <= 4 ? selectedLabel : `已选 ${state.majors.length} 个专业`) : "全部专业";
    searchInput.title = state.majors.length ? selectedLabel : "全部专业";
    const visibleMajors = keyword ? sortedMajors.filter((major) => major.toLocaleLowerCase("zh-CN").includes(keyword)) : sortedMajors;
    const allVisibleSelected = keyword ? visibleMajors.length > 0 && visibleMajors.every((major) => state.majors.includes(major)) : state.majors.length === 0;
    elements.major.innerHTML = `
      <label class="country-option country-select-all">
        <input type="checkbox" value="__all__" ${allVisibleSelected ? "checked" : ""}>
        <span>全选</span>
      </label>
    ` + visibleMajors.map((major) => `
      <label class="country-option">
        <input type="checkbox" name="majorFilter" value="${escapeHtml(major)}" ${state.majors.includes(major) ? "checked" : ""}>
        <span>${escapeHtml(major)}</span>
      </label>
    `).join("");
  }

  function renderCountryOptions() {
    const summary = $("#countrySummary");
    const allSelected = state.countries.length === data.filters.countries.length;
    summary.textContent = allSelected ? "全部国家或地区" : state.countries.length ? state.countries.join("、") : "未选择国家或地区";
    summary.title = summary.textContent;
    elements.country.innerHTML = `
      <label class="country-option country-select-all">
        <input type="checkbox" value="__all__" ${allSelected ? "checked" : ""}>
        <span>全选</span>
      </label>
    ` + data.filters.countries.map((country) => `
      <label class="country-option">
        <input type="checkbox" name="countryFilter" value="${escapeHtml(country)}" ${state.countries.includes(country) ? "checked" : ""}>
        <span>${escapeHtml(country)}</span>
      </label>
    `).join("");
  }

  function setupData() {
    $("#updatedDate").textContent = data.meta.updated;
    $("#metricCases").textContent = number.format(data.stats.cases);
    $("#metricUniversities").textContent = number.format(data.stats.universities);
    $("#metricPrograms").textContent = number.format(data.stats.programs);
    $("#metricOffers").textContent = number.format(data.stats.offers);

    renderMajorOptions();
    renderCountryOptions();
    elements.year.insertAdjacentHTML("beforeend", optionMarkup(data.filters.years));
    elements.track.insertAdjacentHTML("beforeend", optionMarkup(data.filters.tracks));
    elements.result.insertAdjacentHTML("beforeend", optionMarkup(data.filters.results));

    const maxCountry = Math.max(...data.topCountries.map(([, count]) => count));
    $("#countryBars").innerHTML = data.topCountries.map(([country, count]) => `
      <div class="country-row">
        <span>${escapeHtml(country)}</span>
        <span class="country-track"><span class="country-fill" style="width:${Math.round(count / maxCountry * 100)}%"></span></span>
        <span class="country-count">${number.format(count)}</span>
      </div>
    `).join("");
  }

  function numeric(value, fallback) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function getFilteredCases() {
    const query = state.query.trim().toLocaleLowerCase("zh-CN");
    const aiCaseIds = new Set(state.aiCaseIds);
    const filtered = data.cases.filter((caseItem) => {
      if (aiCaseIds.size) return aiCaseIds.has(caseItem.id);
      const application = caseItem.application;
      if (state.savedOnly && !saved.has(caseItem.id)) return false;
      if (state.majors.length && !state.majors.includes(caseItem.major)) return false;
      if (state.countries.length !== data.filters.countries.length && !state.countries.includes(application.country)) return false;
      if (state.year && caseItem.year !== state.year) return false;
      if (state.track && caseItem.track !== state.track) return false;
      if (state.result && application.result !== state.result) return false;
      const average = numeric(caseItem.scores.average, null);
      if (state.minScore > 50 && (average === null || average < state.minScore)) return false;
      if (state.completeScores && !(caseItem.scores.y1 && caseItem.scores.y2 && caseItem.scores.y3)) return false;
      if (state.scoreMatch && [caseItem.scores.y1, caseItem.scores.y2, caseItem.scores.y3].some((value) => numeric(value, null) === null)) return false;
      if (query) {
        const haystack = [
          caseItem.id,
          caseItem.major,
          caseItem.undergraduate,
          application.country,
          application.university,
          application.program,
        ].join(" ").toLocaleLowerCase("zh-CN");
        if (!haystack.includes(query)) return false;
      }
      return true;
    });

    filtered.sort((a, b) => {
      if (state.scoreMatch) {
        const target = state.matchScores;
        const targetAverage = (target.y1 + target.y2 + target.y3) / 3;
        const differences = (item) => {
          const y1 = numeric(item.scores.y1, 0);
          const y2 = numeric(item.scores.y2, 0);
          const y3 = numeric(item.scores.y3, 0);
          const average = numeric(item.scores.average, (y1 + y2 + y3) / 3);
          return [Math.abs(average - targetAverage), Math.abs(y3 - target.y3), Math.abs(y2 - target.y2), Math.abs(y1 - target.y1)];
        };
        const aDiff = differences(a);
        const bDiff = differences(b);
        for (let index = 0; index < aDiff.length; index += 1) if (aDiff[index] !== bDiff[index]) return aDiff[index] - bDiff[index];
        return a.id.localeCompare(b.id);
      }
      if (state.sort === "score") return numeric(b.scores.average, -1) - numeric(a.scores.average, -1);
      if (state.sort === "rank") return numeric(a.application.rank, 99999) - numeric(b.application.rank, 99999);
      return numeric(b.year, -1) - numeric(a.year, -1) || a.id.localeCompare(b.id);
    });
    return filtered;
  }

  function scoreValue(value) {
    return value ? escapeHtml(value) : "--";
  }

  function resultClass(result) {
    if (result === "被拒") return "rejected";
    if (result === "WL" || result === "面邀") return "waitlist";
    return "";
  }

  const aiTargetGroups = [
    { label: "数据相关", triggers: ["数据", "大数据", "分析", "统计"], keywords: ["data", "analytics", "statistic", "business intelligence", "数据", "统计", "分析"] },
    { label: "计算机", triggers: ["计算机", "软件", "人工智能", "ai"], keywords: ["computer", "computing", "software", "artificial intelligence", "machine learning", "计算机", "软件", "人工智能"] },
    { label: "金融", triggers: ["金融", "fintech"], keywords: ["finance", "financial", "fintech", "risk management", "金融"] },
    { label: "商科管理", triggers: ["商科", "管理", "市场"], keywords: ["management", "marketing", "business", "commerce", "管理", "市场"] },
    { label: "传媒", triggers: ["传媒", "传播", "媒体"], keywords: ["media", "communication", "journalism", "传媒", "传播"] },
    { label: "工程", triggers: ["工程", "电子", "电气"], keywords: ["engineering", "electronic", "electrical", "工程", "电子", "电气"] },
  ];

  function parseAiProfile(text) {
    const normalized = text.trim();
    const averageMatch = normalized.match(/(?:均分|平均分|成绩)\s*(?:为|是|有|大约|约)?\s*(\d{2}(?:\.\d+)?)/i);
    const qsMatch = normalized.match(/QS\s*(?:排名)?\s*(?:前|Top)?\s*(\d{1,3})/i);
    const country = [...data.filters.countries].sort((a, b) => b.length - a.length).find((value) => normalized.includes(value)) || "";
    const major = [...data.filters.majors]
      .filter((value) => value && value.length >= 2 && !["未注明", "专业未注明"].includes(value))
      .sort((a, b) => b.length - a.length)
      .find((value) => normalized.toLocaleLowerCase("zh-CN").includes(value.toLocaleLowerCase("zh-CN"))) || "";
    const target = aiTargetGroups.find((group) => group.triggers.some((word) => normalized.toLocaleLowerCase("zh-CN").includes(word.toLocaleLowerCase("zh-CN"))));
    return {
      text: normalized,
      average: averageMatch ? Number(averageMatch[1]) : null,
      qs: qsMatch ? Number(qsMatch[1]) : null,
      country,
      major,
      targetLabel: target?.label || "",
      targetKeywords: target?.keywords || [],
    };
  }

  function aiMajorRoot(major) {
    return ["数学", "计算机", "数据", "电子", "电气", "金融", "经济", "会计", "传媒", "传播", "管理", "建筑", "生物", "化学", "英语"]
      .find((root) => major.includes(root)) || major;
  }

  function getAiCandidates(profile) {
    let cases = data.cases.filter((item) => {
      const app = item.application;
      if (!app?.university || !app?.program || app.degree === "博士") return false;
      if (!String(app.result).includes("Offer") && app.result !== "有条件录取") return false;
      if (profile.country && app.country !== profile.country) return false;
      const rank = numeric(app.rank, null);
      if (profile.qs && (rank === null || rank > profile.qs)) return false;
      if (profile.targetKeywords.length && !profile.targetKeywords.some((word) => `${app.program} ${item.major}`.toLocaleLowerCase("zh-CN").includes(word.toLocaleLowerCase("zh-CN")))) return false;
      return numeric(item.scores.average, null) !== null;
    });

    if (profile.major) {
      const root = aiMajorRoot(profile.major);
      const similarMajorCases = cases.filter((item) => item.major === profile.major || (root.length >= 2 && item.major.includes(root)));
      if (similarMajorCases.length >= 9) cases = similarMajorCases;
    }

    const grouped = new Map();
    cases.forEach((item) => {
      const key = `${item.application.university}|${item.application.program}`;
      const current = grouped.get(key) || { item, scores: [], caseIds: [], count: 0 };
      current.scores.push(numeric(item.scores.average, 0));
      current.caseIds.push(item.id);
      current.count += 1;
      grouped.set(key, current);
    });

    return [...grouped.values()].map((entry) => {
      const historicalAverage = entry.scores.reduce((sum, value) => sum + value, 0) / entry.scores.length;
      const rank = numeric(entry.item.application.rank, null);
      const rankBonus = rank !== null && rank <= 10 ? 4 : rank !== null && rank <= 25 ? 2.5 : rank !== null && rank <= 50 ? 1.5 : rank !== null && rank <= 100 ? .5 : 0;
      const applicantAverage = profile.average ?? 70;
      return { ...entry, historicalAverage, rank, delta: historicalAverage + rankBonus - applicantAverage };
    });
  }

  function chooseAiTiers(candidates) {
    const used = new Set();
    const pick = (predicate, anchor) => {
      const preferred = candidates.filter((candidate) => !used.has(candidate.item.id) && predicate(candidate));
      const pool = preferred;
      const chosen = pool.sort((a, b) => Math.abs(a.delta - anchor) - Math.abs(b.delta - anchor) || (a.rank ?? 9999) - (b.rank ?? 9999)).slice(0, 6);
      chosen.forEach((candidate) => used.add(candidate.item.id));
      return chosen;
    };
    return {
      challenge: pick((candidate) => candidate.delta > 1.5, 3.5),
      match: pick((candidate) => candidate.delta >= -2 && candidate.delta <= 2, 0),
      safe: pick((candidate) => candidate.delta < -1.5, -4),
    };
  }

  function aiRecommendationMarkup(candidate) {
    const app = candidate.item.application;
    return `<article class="ai-recommendation">
      <h4>${escapeHtml(app.university)}</h4>
      <p>${escapeHtml(app.program)}</p>
      <div class="ai-recommendation-meta">
        ${candidate.rank !== null ? `<span>QS ${escapeHtml(candidate.rank)}</span>` : ""}
        <span>相近案例均分 ${Math.round(candidate.historicalAverage)}</span>
        <span>${candidate.count} 条相似记录</span>
      </div>
      <button type="button" data-ai-ids="${escapeHtml(candidate.caseIds.join(","))}">查看 ${candidate.count} 条相似案例 →</button>
    </article>`;
  }

  function renderLocalAiAnalysis() {
    const profile = parseAiProfile(elements.aiProfileInput.value);
    if (!profile.text) { elements.aiProfileInput.focus(); return; }
    const candidates = getAiCandidates(profile);
    const tiers = chooseAiTiers(candidates);
    const tags = [
      profile.major ? `本科：${profile.major}` : "本科专业：未识别",
      profile.isMajorTransition ? "申请类型：转专业" : "",
      profile.average !== null ? `均分：${profile.average}` : "均分：未识别（暂按70匹配）",
      profile.country ? `地区：${profile.country}` : "地区：不限",
      profile.qs ? `目标：QS前${profile.qs}` : "QS：不限",
      profile.targetLabel ? `方向：${profile.targetLabel}` : "方向：不限",
    ];
    elements.aiProfileSummary.innerHTML = tags.map((tag) => `<span class="ai-profile-tag">${escapeHtml(tag)}</span>`).join("");
    elements.aiSummaryText.textContent = candidates.length
      ? `已从 ${number.format(data.stats.cases)} 条案例中筛出 ${number.format(candidates.length)} 个相关项目，并按照历史录取分数与院校排名生成三档建议。`
      : "暂未找到同时满足全部条件的案例，建议放宽QS范围或目标专业关键词后重新分析。";
    const tierConfig = [
      ["challenge", "冲刺", "历史案例要求相对更高"],
      ["match", "匹配", "与当前背景较为接近"],
      ["safe", "保底", "历史案例分数相对友好"],
    ];
    elements.aiTierGrid.innerHTML = tierConfig.map(([key, title, note]) => `<section class="ai-tier ${key}">
      <div class="ai-tier-head"><strong>${title}</strong><span>${note}</span></div>
      ${tiers[key].length ? tiers[key].map(aiRecommendationMarkup).join("") : '<div class="ai-tier-empty">暂无符合条件的项目</div>'}
    </section>`).join("");
    elements.aiAnalysis.hidden = false;
    elements.aiAnalysis.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const AI_API_URL = window.XIPU_AI_API_URL || "";
  const AI_MODE = window.XIPU_AI_MODE || (AI_API_URL ? "llm" : "local");

  function backendRecommendationMarkup(candidate) {
    const official = candidate.officialCourse && candidate.officialCourse.status === "ok" ? candidate.officialCourse : null;
    const officialMarkup = official
      ? `<p><strong>官方课程资料</strong><a href="${escapeHtml(official.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(official.title || "查看官方课程页面")}</a></p>`
      : `<p><strong>官方课程资料</strong>课程背景待核实</p>`;
    return `<article class="ai-recommendation">
      <h4>${escapeHtml(candidate.university)}</h4>
      <p>${escapeHtml(candidate.program)}</p>
      <div class="ai-recommendation-meta">
        ${candidate.rank !== null ? `<span>QS ${escapeHtml(candidate.rank)}</span>` : ""}
        <span>相近案例均分 ${Math.round(candidate.historicalAverage)}</span>
        <span>${candidate.count} 条相似记录</span>
        ${candidate.fitScore !== null && candidate.fitScore !== undefined ? `<span>AI软匹配 ${Math.round(candidate.fitScore)}</span>` : ""}
      </div>
      <div class="ai-recommendation-insight">
        <p><strong>项目方向</strong>${escapeHtml(candidate.programFocus || "课程背景待核实")}</p>
        <p><strong>与你的匹配</strong>${escapeHtml(candidate.fitSummary || "暂未生成个性化匹配说明。")}</p>
        ${Array.isArray(candidate.tradeoffs) && candidate.tradeoffs.length ? `<p><strong>需要注意</strong>${escapeHtml(candidate.tradeoffs.join("；"))}</p>` : ""}
        ${officialMarkup}
      </div>
      <button type="button" data-ai-ids="${escapeHtml(candidate.caseIds.join(","))}">查看 ${candidate.count} 条相似案例 →</button>
    </article>`;
  }

  function renderBackendAiAnalysis(result) {
    const profile = result.profile || {};
    if (elements.aiModeStatus) {
      elements.aiModeStatus.hidden = false;
      elements.aiModeStatus.textContent = result.needsClarification ? "🟡 需要补充信息" : `🟢 大模型模式：${result.model || "gpt-5.6-luna"}`;
      elements.aiModeStatus.className = result.needsClarification ? "ai-mode-status pending" : "ai-mode-status llm";
    }
    elements.aiSummaryText.classList.remove("ai-error-message");
    const tags = [
      profile.major ? `本科：${profile.major}` : "本科专业：未识别",
      profile.average !== null && profile.average !== undefined ? `均分：${profile.average}` : "均分：未识别",
      profile.country ? `地区：${profile.country}` : "地区：不限",
      profile.qsRanking ? `目标：QS前${profile.qsRanking}` : "QS：不限",
      profile.targetProgram ? `目标专业：${profile.targetProgram}` : "目标专业：未识别",
      profile.careerGoal ? `职业：${profile.careerGoal}` : "职业目标：未识别",
      ...(Array.isArray(profile.softPreferences) && profile.softPreferences.length ? [`偏好：${profile.softPreferences.map((item) => `${item.name}=${item.value}`).join("、")}`] : []),
      ...(Array.isArray(profile.avoidTopics) && profile.avoidTopics.length ? [`排除：${profile.avoidTopics.join("、")}`] : []),
    ].filter(Boolean);
    elements.aiProfileSummary.innerHTML = tags.map((tag) => `<span class="ai-profile-tag">${escapeHtml(tag)}</span>`).join("");
    elements.aiSummaryText.textContent = result.summary || `已从 ${number.format(data.stats.cases)} 条真实案例中生成选校建议。`;
    if (result.needsClarification) {
      const questions = Array.isArray(result.clarificationQuestions) ? result.clarificationQuestions : [];
      elements.aiTierGrid.innerHTML = `<section class="ai-tier match"><div class="ai-tier-head"><strong>请补充信息</strong><span>补充后重新分析</span></div><div class="ai-tier-empty">${escapeHtml(questions.join("\n"))}</div></section>`;
      elements.aiAnalysis.hidden = false;
      elements.aiAnalysis.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    const tierConfig = [["challenge", "冲刺", "历史案例要求相对更高"], ["match", "匹配", "与当前背景较为接近"], ["safe", "保底", "历史案例分数相对友好"]];
    const tiers = result.tiers || {};
    elements.aiTierGrid.innerHTML = tierConfig.map(([key, title, note]) => `<section class="ai-tier ${key}">
      <div class="ai-tier-head"><strong>${title}</strong><span>${note}</span></div>
      ${tiers[key] && tiers[key].length ? tiers[key].map(backendRecommendationMarkup).join("") : '<div class="ai-tier-empty">暂无符合条件的项目</div>'}
    </section>`).join("");
    elements.aiAnalysis.hidden = false;
    elements.aiAnalysis.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function renderAiAnalysis() {
    const message = elements.aiProfileInput.value.trim();
    if (!message) { elements.aiProfileInput.focus(); return; }
    elements.aiAnalyzeButton.disabled = true;
    const originalLabel = elements.aiAnalyzeButton.textContent;
    elements.aiAnalyzeButton.textContent = "分析中…";
    elements.aiSummaryText.classList.remove("ai-error-message");
    if (AI_MODE === "local" || !AI_API_URL) {
      if (elements.aiModeStatus) elements.aiModeStatus.hidden = true;
      renderLocalAiAnalysis();
      elements.aiAnalyzeButton.disabled = false;
      elements.aiAnalyzeButton.textContent = originalLabel;
      return;
    }
    if (elements.aiModeStatus) {
      elements.aiModeStatus.hidden = false;
      elements.aiModeStatus.textContent = "正在连接大模型…";
      elements.aiModeStatus.className = "ai-mode-status pending";
    }
    try {
      const response = await fetch(AI_API_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const errorMessage = [payload.error, payload.detail].filter(Boolean).join("：") || `HTTP ${response.status}`;
        throw new Error(errorMessage);
      }
      renderBackendAiAnalysis(payload);
    } catch (error) {
      console.error("AI backend unavailable", error);
      renderLocalAiAnalysis();
      if (elements.aiModeStatus) {
        elements.aiModeStatus.hidden = false;
        elements.aiModeStatus.textContent = "🟡 已切换到本地匹配模式";
        elements.aiModeStatus.className = "ai-mode-status local";
      }
      elements.aiSummaryText.textContent = `当前大模型暂不可用，已根据本地案例库生成匹配建议。${elements.aiSummaryText.textContent ? ` ${elements.aiSummaryText.textContent}` : ""}`;
    } finally {
      elements.aiAnalyzeButton.disabled = false;
      elements.aiAnalyzeButton.textContent = originalLabel;
    }
  }
  function setAppMode(mode) {
    const aiMode = mode === "ai";
    elements.caseOverview.hidden = aiMode;
    elements.caseWorkspace.hidden = aiMode;
    elements.aiSchoolView.hidden = !aiMode;
    elements.caseModeButton.classList.toggle("active", !aiMode);
    elements.aiModeButton.classList.toggle("active", aiMode);
    if (aiMode) {
      elements.homeNav.classList.remove("active");
      elements.savedNav.classList.remove("active");
    }
  }

  function cardMarkup(caseItem) {
    const app = caseItem.application;
    const isSaved = saved.has(caseItem.id);
    const primaryScoreLabel = caseItem.scores.average ? "三年均分" : (caseItem.scores.gpa ? "GPA" : "三年均分");
    const primaryScoreValue = caseItem.scores.average || caseItem.scores.gpa;
    return `
      <article class="case-card" data-id="${escapeHtml(caseItem.id)}">
        <button class="save-card ${isSaved ? "is-saved" : ""}" type="button" data-action="save" title="${isSaved ? "取消收藏" : "收藏案例"}" aria-label="${isSaved ? "取消收藏" : "收藏案例"}">${isSaved ? "♥" : "♡"}</button>
        <button class="case-main" type="button" data-action="open">
          <div class="case-topline"><span class="case-id">${escapeHtml(caseItem.id)}</span><span class="year-tag">${escapeHtml(caseItem.year)}</span></div>
          <h3>${escapeHtml(app.university)}</h3>
          <div class="profile-line">${escapeHtml(app.program)}</div>
          <div class="score-strip">
            <div class="score-item"><span>${primaryScoreLabel}</span><strong>${scoreValue(primaryScoreValue)}</strong></div>
            <div class="score-item"><span>大一</span><strong>${scoreValue(caseItem.scores.y1)}</strong></div>
            <div class="score-item"><span>大二</span><strong>${scoreValue(caseItem.scores.y2)}</strong></div>
            <div class="score-item"><span>大三</span><strong>${scoreValue(caseItem.scores.y3)}</strong></div>
          </div>
          <div class="offer-summary">
            <span class="offer-mark"></span>
            <span class="offer-text"><strong>${escapeHtml(caseItem.major)}</strong><span>${escapeHtml(caseItem.track)} · ${escapeHtml(app.country || "地区未注明")}</span></span>
          </div>
        </button>
        <div class="case-footer"><span>${app.rank ? `QS排名 ${escapeHtml(app.rank)}` : escapeHtml(app.degree || "硕士")}</span><span class="result-badge ${resultClass(app.result)}">${escapeHtml(app.result)}</span></div>
      </article>
    `;
  }

  function activeFilterEntries() {
    if (state.aiCaseIds.length) return [["aiCases", `AI相似案例：${state.aiCaseIds.length}条`]];
    const entries = [];
    if (state.query) entries.push(["query", `搜索：${state.query}`]);
    if (state.majors.length) state.majors.slice().sort(pinyinCollator.compare).forEach((major) => entries.push([`major:${major}`, major]));
    if (state.countries.length !== data.filters.countries.length) entries.push(["countries", `国家/地区：${state.countries.length ? state.countries.join("、") : "未选择"}`]);
    if (state.year) entries.push(["year", state.year]);
    if (state.track) entries.push(["track", state.track]);
    if (state.result) entries.push(["result", state.result]);
    if (state.minScore > 50) entries.push(["minScore", `均分 ≥ ${state.minScore}`]);
    if (state.completeScores) entries.push(["completeScores", "三年成绩完整"]);
    if (state.scoreMatch) entries.push(["scoreMatch", `成绩匹配：大一 ${state.matchScores.y1}、大二 ${state.matchScores.y2}、大三 ${state.matchScores.y3}`]);
    return entries;
  }

  function render() {
    const cases = getFilteredCases();
    const shown = cases.slice(0, state.visible);
    elements.count.textContent = number.format(cases.length);
    elements.title.textContent = state.savedOnly ? "我的收藏" : (state.aiCaseIds.length ? "AI相似案例" : "案例结果");
    elements.backFromSaved.hidden = !state.savedOnly;
    elements.backToAiResults.hidden = !state.aiReturnAvailable || state.savedOnly;
    elements.grid.innerHTML = shown.map(cardMarkup).join("");
    elements.empty.hidden = cases.length > 0;
    elements.loadMore.hidden = cases.length <= state.visible;
    elements.grid.hidden = cases.length === 0;
    elements.chips.innerHTML = activeFilterEntries().map(([key, label]) => `<button class="chip" type="button" data-key="${escapeHtml(key)}">${escapeHtml(label)} <b>×</b></button>`).join("");
    $("#activeFilterCount").textContent = activeFilterEntries().length;
    elements.savedCount.textContent = saved.size;
    elements.savedNav.classList.toggle("active", state.savedOnly);
    elements.homeNav.classList.toggle("active", !state.savedOnly);
  }

  function saveCases() {
    localStorage.setItem("xipu-saved-cases", JSON.stringify([...saved]));
    render();
  }

  function toggleSaved(id) {
    if (saved.has(id)) saved.delete(id); else saved.add(id);
    saveCases();
    if (elements.drawer.classList.contains("open")) openDrawer(id);
  }

  function detailScore(label, value) {
    return `<div class="detail-score"><span>${label}</span><strong>${scoreValue(value)}</strong></div>`;
  }

  function openDrawer(id) {
    const caseItem = data.cases.find((item) => item.id === id);
    if (!caseItem) return;
    const app = caseItem.application;
    const statusClass = resultClass(app.result);
    const links = [
      app.site ? `<a href="${escapeHtml(app.site)}" target="_blank" rel="noopener">项目官网 ↗</a>` : "",
      app.requirement ? `<a href="${escapeHtml(app.requirement)}" target="_blank" rel="noopener">录取要求 ↗</a>` : "",
    ].filter(Boolean).join("");
    elements.drawerTitle.textContent = caseItem.id;
    elements.drawerContent.innerHTML = `
      <section class="detail-identity">
        <h3>${escapeHtml(caseItem.major)}</h3>
        <p>${escapeHtml(caseItem.undergraduate)} · ${escapeHtml(caseItem.track)} · ${escapeHtml(caseItem.year)}</p>
        <div class="detail-actions"><button class="detail-save" type="button" data-action="detail-save" data-id="${escapeHtml(caseItem.id)}">${saved.has(caseItem.id) ? "♥ 已收藏" : "♡ 收藏案例"}</button></div>
      </section>
      <section class="detail-section">
        <h4>学术背景</h4>
        <div class="detail-score-grid">
          ${detailScore("大一成绩", caseItem.scores.y1)}
          ${detailScore("大二成绩", caseItem.scores.y2)}
          ${detailScore("大三成绩", caseItem.scores.y3)}
          ${detailScore("大四成绩", caseItem.scores.y4)}
          ${detailScore("三年均分", caseItem.scores.average)}
          ${detailScore("GPA", caseItem.scores.gpa)}
          ${detailScore("雅思", caseItem.scores.ielts)}
          ${detailScore("托福", caseItem.scores.toefl)}
          ${detailScore("GRE", caseItem.scores.gre)}
        </div>
      </section>
      <section class="detail-section">
        <h4>申请结果</h4>
        <div class="offer-list">
          <article class="offer-item ${statusClass}">
            <div class="offer-item-head"><h5>${escapeHtml(app.university)}</h5><span class="offer-status">${escapeHtml(app.result)}</span></div>
            <p class="offer-program">${escapeHtml(app.program)}</p>
            <div class="offer-meta">
              ${app.country ? `<span>${escapeHtml(app.country)}</span>` : ""}
              ${app.degree ? `<span>${escapeHtml(app.degree)}</span>` : ""}
              ${app.rank ? `<span>QS排名 ${escapeHtml(app.rank)}</span>` : ""}
              ${app.scholarship ? `<span>${escapeHtml(app.scholarship)}</span>` : ""}
            </div>
            ${links ? `<div class="offer-links">${links}</div>` : ""}
          </article>
        </div>
      </section>
      <p class="privacy-note">隐私说明：源数据中的姓名及经历字段已脱敏。</p>
    `;
    elements.drawer.classList.add("open");
    elements.drawerBackdrop.classList.add("open");
    elements.drawer.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
  }

  function closeDrawer() {
    elements.drawer.classList.remove("open");
    elements.drawerBackdrop.classList.remove("open");
    elements.drawer.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
  }

  function updateStateFromControls() {
    state.year = elements.year.value;
    state.track = elements.track.value;
    state.result = elements.result.value;
    state.minScore = Number(elements.score.value);
    state.completeScores = elements.completeScores.checked;
    state.sort = elements.sort.value;
    state.visible = 24;
    render();
  }

  function resetFilters() {
    Object.assign(state, { query: "", majors: [], countries: [...data.filters.countries], year: "", track: "", result: "", minScore: 50, completeScores: false, scoreMatch: false, matchScores: { y1: null, y2: null, y3: null }, savedOnly: false, aiCaseIds: [], visible: 24 });
    elements.search.value = "";
    $("#majorSearch").value = "";
    renderMajorOptions("");
    renderCountryOptions();
    elements.year.value = "";
    elements.track.value = "";
    elements.result.value = "";
    elements.score.value = "50";
    elements.scoreOutput.textContent = "不限";
    elements.completeScores.checked = false;
    [elements.matchY1, elements.matchY2, elements.matchY3].forEach((input) => { input.value = ""; input.classList.remove("invalid"); });
    updateMatchAverage();
    render();
  }

  function closeMobileFilters() {
    elements.filters.classList.remove("open");
    elements.filterBackdrop.classList.remove("open");
  }

  let searchTimer;
  elements.search.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { state.query = elements.search.value.trim(); state.visible = 24; render(); }, 100);
  });
  elements.clearSearch.addEventListener("click", () => { elements.search.value = ""; state.query = ""; render(); elements.search.focus(); });
  function updateMatchAverage() {
    const values = [elements.matchY1, elements.matchY2, elements.matchY3].map((input) => Number.parseFloat(input.value));
    const complete = values.every((value) => Number.isFinite(value) && value >= 0 && value <= 100);
    elements.matchAverage.textContent = complete ? `均分 ${Math.round((values[0] + values[1] + values[2]) / 3)}` : "均分 --";
    elements.matchAverage.classList.toggle("has-value", complete);
  }
  [elements.matchY1, elements.matchY2, elements.matchY3].forEach((input) => input.addEventListener("input", updateMatchAverage));
  elements.matchButton.addEventListener("click", () => {
    const inputs = [elements.matchY1, elements.matchY2, elements.matchY3];
    const values = inputs.map((input) => Number.parseFloat(input.value));
    const valid = values.every((value) => Number.isFinite(value) && value >= 0 && value <= 100);
    inputs.forEach((input, index) => input.classList.toggle("invalid", !Number.isFinite(values[index]) || values[index] < 0 || values[index] > 100));
    if (!valid) { inputs.find((input) => input.classList.contains("invalid"))?.focus(); return; }
    state.matchScores = { y1: values[0], y2: values[1], y3: values[2] };
    state.scoreMatch = true;
    state.visible = 24;
    render();
  });
  $("#majorSearch").addEventListener("input", () => {
    const search = $("#majorSearch").value.trim();
    if (search) setMajorDropdown(true);
    renderMajorOptions(search);
  });
  elements.major.addEventListener("change", (event) => {
    const input = event.target.closest("input");
    if (!input) return;
    if (input.value === "__all__") {
      const search = $("#majorSearch").value.trim();
      const keyword = search.toLocaleLowerCase("zh-CN");
      const visibleMajors = search ? sortedMajors.filter((major) => major.toLocaleLowerCase("zh-CN").includes(keyword)) : sortedMajors;
      if (input.checked) state.majors = search ? [...new Set([...state.majors, ...visibleMajors])] : [];
      else state.majors = search ? state.majors.filter((major) => !visibleMajors.includes(major)) : [];
      if (search) $("#majorSearch").value = "";
    }
    else if (input.checked) state.majors = [...new Set([...state.majors, input.value])];
    else state.majors = state.majors.filter((major) => major !== input.value);
    state.visible = 24;
    renderMajorOptions();
    render();
  });
  function setMajorDropdown(open) {
    $("#majorDropdownPanel").hidden = !open;
    $("#majorDropdownToggle").classList.toggle("open", open);
    $("#majorDropdownToggle").setAttribute("aria-expanded", String(open));
  }
  $("#majorDropdownToggle").addEventListener("click", () => setMajorDropdown($("#majorDropdownPanel").hidden));
  [elements.year, elements.track, elements.result, elements.completeScores, elements.sort].forEach((control) => control.addEventListener("change", updateStateFromControls));
  elements.country.addEventListener("change", (event) => {
    const input = event.target.closest("input");
    if (!input) return;
    if (input.value === "__all__") state.countries = input.checked ? [...data.filters.countries] : [];
    else state.countries = [...elements.country.querySelectorAll('input[name="countryFilter"]:checked')].map((item) => item.value);
    state.visible = 24;
    renderCountryOptions();
    render();
  });
  document.addEventListener("click", (event) => {
    const countryDropdown = $("#countryDropdown");
    if (countryDropdown.open && !countryDropdown.contains(event.target)) countryDropdown.open = false;
    if (!$("#majorDropdown").contains(event.target)) setMajorDropdown(false);
  });
  elements.score.addEventListener("input", () => { elements.scoreOutput.textContent = elements.score.value === "50" ? "不限" : elements.score.value; });
  elements.score.addEventListener("change", updateStateFromControls);
  $("#resetFilters").addEventListener("click", resetFilters);
  $("#emptyReset").addEventListener("click", resetFilters);
  elements.loadMore.addEventListener("click", () => { state.visible += 24; render(); });
  elements.grid.addEventListener("click", (event) => {
    const card = event.target.closest(".case-card");
    if (!card) return;
    if (event.target.closest('[data-action="save"]')) toggleSaved(card.dataset.id); else openDrawer(card.dataset.id);
  });
  elements.chips.addEventListener("click", (event) => {
    const chip = event.target.closest(".chip");
    if (!chip) return;
    const key = chip.dataset.key;
    if (key === "query") elements.search.value = "";
    if (key === "aiCases") { state.aiCaseIds = []; state.aiReturnAvailable = false; }
    if (key === "minScore") { elements.score.value = "50"; elements.scoreOutput.textContent = "不限"; state.minScore = 50; }
    else if (key === "completeScores") { elements.completeScores.checked = false; state.completeScores = false; }
    else if (key === "scoreMatch") { state.scoreMatch = false; state.matchScores = { y1: null, y2: null, y3: null }; [elements.matchY1, elements.matchY2, elements.matchY3].forEach((input) => { input.value = ""; input.classList.remove("invalid"); }); updateMatchAverage(); }
    else if (key === "countries") { state.countries = [...data.filters.countries]; renderCountryOptions(); }
    else if (key.startsWith("major:")) { state.majors = state.majors.filter((major) => major !== key.slice(6)); renderMajorOptions(); }
    else { state[key] = ""; if (elements[key]) elements[key].value = ""; }
    state.visible = 24;
    render();
  });
  elements.drawerContent.addEventListener("click", (event) => {
    const button = event.target.closest('[data-action="detail-save"]');
    if (button) toggleSaved(button.dataset.id);
  });
  $("#closeDrawer").addEventListener("click", closeDrawer);
  elements.drawerBackdrop.addEventListener("click", closeDrawer);
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") { closeDrawer(); closeMobileFilters(); $("#countryDropdown").open = false; setMajorDropdown(false); } });
  $("#mobileFilterButton").addEventListener("click", () => { elements.filters.classList.add("open"); elements.filterBackdrop.classList.add("open"); });
  elements.filterBackdrop.addEventListener("click", closeMobileFilters);
  $("#applyMobileFilters").addEventListener("click", closeMobileFilters);
  function showSaved() { setAppMode("cases"); state.aiCaseIds = []; state.savedOnly = true; state.visible = 24; render(); window.scrollTo({ top: 0, behavior: "smooth" }); }
  function showAllCases() { setAppMode("cases"); state.aiCaseIds = []; state.savedOnly = false; state.visible = 24; render(); window.scrollTo({ top: 0, behavior: "smooth" }); }
  elements.savedButton.addEventListener("click", showSaved);
  elements.savedNav.addEventListener("click", showSaved);
  elements.backFromSaved.addEventListener("click", showAllCases);
  elements.backToAiResults.addEventListener("click", () => {
    state.aiReturnAvailable = false;
    state.aiCaseIds = [];
    setAppMode("ai");
    elements.aiAnalysis.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  elements.homeNav.addEventListener("click", showAllCases);
  elements.caseModeButton.addEventListener("click", showAllCases);
  elements.aiModeButton.addEventListener("click", () => { setAppMode("ai"); window.scrollTo({ top: 0, behavior: "smooth" }); });
  elements.aiAnalyzeButton.addEventListener("click", renderAiAnalysis);
  $("#aiEditProfile").addEventListener("click", () => { elements.aiProfileInput.focus(); elements.aiProfileInput.scrollIntoView({ behavior: "smooth", block: "center" }); });
  elements.aiProfileInput.addEventListener("keydown", (event) => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter") renderAiAnalysis(); });
  elements.aiTierGrid.addEventListener("click", (event) => {
    const button = event.target.closest("[data-ai-ids]");
    if (!button) return;
    state.query = "";
    state.aiCaseIds = button.dataset.aiIds.split(",").filter(Boolean);
    state.savedOnly = false;
    state.aiReturnAvailable = true;
    state.visible = 24;
    elements.search.value = "";
    setAppMode("cases");
    render();
    elements.caseWorkspace.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  setupData();
  render();
})();
