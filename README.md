# AI Question Bank Generator

A full-stack application for creating and evaluating question banks with a React/Vite frontend and an Express backend. SQLite persistence is planned for a later stage.

## Requirements

- Node.js 20.16–20.x or 22.3 or newer
- npm 9 or newer

## Setup

From the project root, install all workspace dependencies:

```sh
npm install
```

The defaults work for local development. Copy the root `.env.example` to `.env` only if you need to change the frontend URL or ports. Copy `backend/.env.example` to `backend/.env` and set `GEMINI_API_KEY` to your Google AI Studio API key to enable question generation. Keep that key in the backend environment file; do not put it in a `VITE_` variable or commit it. The root `.env.example` also includes an empty `GEMINI_API_KEY` placeholder.

## Run in development

Start both applications from the project root:

```sh
npm run dev
```

- Frontend: <http://localhost:5173>
- Backend: <http://localhost:3001>
- Health check: <http://localhost:3001/api/health>

The frontend reads `VITE_API_URL` (defaults to `http://localhost:3001`). The backend reads `PORT` and `FRONTEND_URL`. Restart the relevant server after changing environment variables.

On the Upload materials page, choose or drop a PDF (up to 15 MB) and select **Extract text**. The extracted selectable text, filename, and page count will appear below the upload form. Select **Generate 40 questions** to create 30 multiple-choice and 10 short-answer questions. Each includes its answer, explanation, a deterministic verbatim citation from a numbered lecture passage, and a chunk/passage source reference. Gemini requests contain at most five questions; longer lectures are split into overlapping source chunks. Each batch is assigned passages distributed across its chunk, with per-passage question slots, to improve lecture coverage. Structured responses are read from the SDK candidate parts without using its concatenating `response.text` helper. Source passage IDs and answer/evidence checks reject unsupported claims; only invalid questions are retried, with safe validation categories logged without lecture text or API keys. If generation fails, a safe summary reports candidate, accepted, and rejected counts by validation category; the same summary is included in the API error response. Rate limits and upstream 503 errors receive bounded retries with jitter and `Retry-After` support; output-token-limited batches are split further. If a batch still fails, retrying from the Upload page resumes from the first unfinished batch and reuses completed results. The short-lived resume cache is in backend memory, so a backend restart clears it. The backend currently uses Gemini 3.5 Flash-Lite.

PDFs and generated questions are processed in memory and are not saved. Only selectable PDF text can be used; scanned-image OCR is not included. Backend Gemini diagnostics log the provider status and a safe error category/message, never the API key or lecture text.

## AI question quality evaluation

After generating 40 questions, open **Evaluation** and select **Run AI evaluation**. The backend uses the existing Gemini model to judge questions in sequential batches of five against each question's original server-held source passage. It evaluates answer correctness (including MCQ distractor ambiguity), question clarity, lecture grounding, and explanation quality. Each criterion receives an integer score from 1 to 5 with a short AI-generated explanation.

The application—not Gemini—sets the deterministic pass/fail result: **a question passes only if all four criterion scores are at least 3; otherwise it fails**. The Evaluation page labels the scores and explanations as AI judgments, shows evaluated/passed/failed counts, pass rate and criterion averages, and can export the result table as CSV. For blinded comparison, AI scores and decisions are withheld from the UI and results endpoint until the 20-question human review is finalized. CSV cells are escaped, including formula-like text.

The evaluation API accepts only the generated set's `generationId`; it does not accept client-supplied questions, answers, or lecture excerpts as authoritative:

- `POST /api/evaluation/run` with `{ "generationId": "..." }` starts or resumes evaluation. Before human-review finalization it returns only completion status, not scores, decisions, or score summaries.
- `GET /api/evaluation/status?generationId=...` returns safe progress counts while a run is in progress.

Successfully evaluated batches remain in the same short-lived in-memory generation job if a later batch fails. Retry from the Evaluation page to resume. A backend restart, job-cache expiry, or cache eviction removes the generated questions and evaluations; regenerate the question set if the server reports it is unavailable. No evaluation data is persisted to SQLite.

These model judgments are not ground truth and are not a substitute for checking the lecture or expert review. The judge may make mistakes, and scores can vary between runs or model versions.

## Human review and AI–human agreement

After all 40 AI evaluations are complete, open **Human review** from the Evaluation page. The backend deterministically selects 15 multiple-choice and 5 short-answer questions. A SHA-256 seed derived from the lecture content and the `human-review-v1` sampling version is stored with the job; within each question type, seeded question groups are selected round-robin across source passages. Selected IDs use stable question-order identifiers such as `Q-004`. The API returns the complete question, choices, answer, explanation, and original server-held source passage, but never returns an AI decision on the review screen.

Record a human Pass or Fail and an optional comment for each question. Reviews save individually, can be edited until finalization, and are never inferred for unanswered questions. Once all 20 have been saved, select **Finalize and view comparison**. Finalization locks those human judgments and reveals the AI–human comparison. Agreement percentage is matching paired binary decisions divided by 20. The confusion matrix uses human decisions as rows and AI decisions as columns. Cohen’s kappa is calculated from observed and expected agreement; it is returned as undefined when expected agreement is 100% (or when there are no paired decisions).

Human review and AI evaluation remain separate in the in-memory generation job. The CSV export includes the 20 question IDs, source passage IDs, AI and human decisions, reviewer comments, agreement, and comparison metrics. These results describe one reviewer and one reproducible sample; they do not establish question quality as ground truth or measure inter-reviewer reliability.

Human-review endpoints:

- `GET /api/human-review/sample?generationId=...` retrieves the server-selected sample and saved human judgments.
- `POST /api/human-review/review` saves or edits one judgment using `{ "generationId": "...", "questionId": "Q-004", "decision": "pass", "comment": "Optional note" }`.
- `POST /api/human-review/finalize` locks a complete set of 20 reviews and returns the paired comparison.
- `GET /api/human-review/comparison?generationId=...` retrieves the comparison only after finalization.
- `GET /api/human-review/export?generationId=...` downloads the finalized comparison CSV.
- `GET /api/evaluation/results?generationId=...` retrieves AI scores only after human-review finalization.

All question, AI evaluation, and human-review data are stored in memory, not SQLite. A backend restart, job-cache expiry, or eviction makes the session unavailable; regenerate the question set and AI evaluations to start over. Never treat missing human judgments as Pass.

To run either app separately:

```sh
npm run dev --workspace=frontend
npm run dev --workspace=backend
```

## Build

```sh
npm run build
```

This builds the frontend for production. Run the backend with `npm start` from the project root.

Run the backend API tests with:

```sh
npm test --workspace=backend
```

## Current scope

The dashboard, question bank, PDF text extraction, question generation, automatic AI quality evaluation, and human-review agreement workflow are implemented. Database persistence is intentionally not implemented yet.
