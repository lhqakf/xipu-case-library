# XIPU AI backend local test

GitHub Pages remains a static frontend. The OpenAI key is read only by the local Node backend. This setup does not deploy to Vercel or any public service.

## Local configuration

Create a project-root .env file with these variables. Keep the values local and never commit the file:

OPENAI_BASE_URL=
OPENAI_API_KEY=
OPENAI_AUTH_HEADER=authorization
OPENAI_MODEL=
OPENAI_WEB_SEARCH=true
OPENAI_WEB_SEARCH_CONTEXT=medium
OPENAI_AGENT_MAX_TURNS=6
OPENAI_AGENT_MAX_TOOL_CALLS=8

`.env` is ignored by `.gitignore`; `.env.example` contains names only and no real token.

## Run

Run `npm install`, then `npm start`. The backend listens on `http://localhost:8787`. The frontend preview listens on `http://localhost:4173` and calls `http://localhost:8787/api/ai-recommend`.

`GET /health` reports whether the key, custom base URL, and a successful One API response have been verified. `oneApiCallVerified` becomes true only after a real Responses API request returns successfully; starting Node alone does not set it.

The frontend does not fall back to local matching when the backend fails. Successful results show `🟢 大模型模式：<model>`. Failures show the concrete backend error in the result page.

## API flow

The V3 backend first calls the OpenAI Responses API with strict JSON Schema output to extract major, average, country, QS ranking, target program, career goal, and course preferences. It then filters and groups real cases from `data.js`, and makes a second Responses API call using only those selected cases to generate grounded recommendation reasons.

V4 adds `POST /api/ai-agent` without replacing V3. The Agent receives two tools: the custom `search_xipu_cases` function, which reuses the existing matcher and returns only real case records, and the Responses API hosted `web_search` tool for current university pages. The Agent may call either tool, both tools in multiple turns, or neither. It validates candidate keys, case IDs, and official source URLs before returning the result.

The current frontend continues to call `/api/ai-recommend`. Switch it to `/api/ai-agent` only after the provider has been verified to support Responses API function tools and the hosted `web_search` tool. A One API proxy may support function calling but reject hosted web search; the Agent automatically retries without web search when the provider reports that tool as unsupported.

## Security

Do not place a token in `app.js`, `config.js`, `index.html`, or any committed file. Before using a public deployment, add authentication, rate limiting, redacted logging, and abuse monitoring.
