# XIPU AI backend

This repository remains a static GitHub Pages frontend. The OpenAI key lives only in the Node backend.

## Local run

1. Install Node.js 20+.
2. Copy .env.example to .env and set OPENAI_API_KEY.
3. Run npm install, then npm start.
4. Copy config.example.js to config.js in the frontend and set window.XIPU_AI_API_URL to the backend URL.

The backend reads the root data.js file at startup and exposes GET /health and POST /api/ai-recommend with JSON body {"message":"..."}.

The POST endpoint first uses the OpenAI Responses API with strict JSON Schema output to extract the user profile. It then applies the existing case filters/grouping and three-tier selection against data.js. A second Responses API call receives only the selected real-case summaries and writes grounded recommendation reasons.

## Deployment

Deploy the server/, package.json, and data.js files to a Node-compatible service such as Render, Railway, Fly.io, or a serverless Node runtime. Set OPENAI_API_KEY, OPENAI_MODEL, PORT, and FRONTEND_ORIGIN in the service environment. Do not commit .env or copy the API key into frontend files.

Set the public backend URL in frontend config.js (for example, https://api.example.com/api/ai-recommend) and push the static files to GitHub Pages.

## Security notes

The endpoint limits input to 2,000 characters and request bodies to 16 KiB, sends no-store responses, validates structured model output, and restricts CORS to FRONTEND_ORIGIN. Add authentication, rate limiting, logging redaction, and abuse monitoring before opening it to the public internet.
