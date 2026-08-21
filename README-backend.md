# XIPU AI backend local test

GitHub Pages remains a static frontend. The OpenAI key is read only by the local Node backend. This setup does not deploy to Vercel or any public service.

## Local configuration

Create a project-root .env file with these three variables. Keep the values local and never commit the file:

OPENAI_BASE_URL=
OPENAI_API_KEY=
OPENAI_MODEL=

`.env` is ignored by `.gitignore`; `.env.example` contains names only and no real token.

## Run

Run `npm install`, then `npm start`. The backend listens on `http://localhost:8787`. The frontend preview listens on `http://localhost:4173` and calls `http://localhost:8787/api/ai-recommend`.

`GET /health` reports whether the key, custom base URL, and a successful One API response have been verified. `oneApiCallVerified` becomes true only after a real Responses API request returns successfully; starting Node alone does not set it.

The frontend does not fall back to local matching when the backend fails. Successful results show `🟢 大模型模式：<model>`. Failures show the concrete backend error in the result page.

## API flow

The backend first calls the OpenAI Responses API with strict JSON Schema output to extract major, average, country, QS ranking, target program, career goal, and course preferences. It then filters and groups real cases from `data.js`, and makes a second Responses API call using only those selected cases to generate grounded recommendation reasons.

## Security

Do not place a token in `app.js`, `config.js`, `index.html`, or any committed file. Before using a public deployment, add authentication, rate limiting, redacted logging, and abuse monitoring.
