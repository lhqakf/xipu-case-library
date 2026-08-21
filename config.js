// Public frontend configuration only. Never put OPENAI_API_KEY here.
const isLocalAiTest = ["localhost", "127.0.0.1"].includes(window.location.hostname);
window.XIPU_AI_API_URL = isLocalAiTest ? `${window.location.origin}/api/ai-recommend` : "";
window.XIPU_AI_MODE = isLocalAiTest ? "llm" : "local";
