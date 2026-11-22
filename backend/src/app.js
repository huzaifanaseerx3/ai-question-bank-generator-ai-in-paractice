import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFParse } from 'pdf-parse';
import { createHumanReviewCsv, HumanReviewError } from './human-review.js';
import {
  generateQuestions,
  QuestionEvaluationError,
  QuestionGenerationError
} from './questions.js';

dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });
dotenv.config({ path: fileURLToPath(new URL('../../.env', import.meta.url)) });

const MAX_FILE_SIZE = 15 * 1024 * 1024;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE, files: 1 }
});

export async function extractPdf(buffer) {
  const parser = new PDFParse({ data: buffer });

  try {
    const result = await parser.getText({ pageJoiner: '\n\n' });
    const text = result.text.trim().replace(/\n{3,}/g, '\n\n');

    if (!text) {
      const error = new Error('No selectable text was found. This may be a scanned PDF.');
      error.status = 422;
      throw error;
    }

    return { text, pages: result.total };
  } finally {
    await parser.destroy();
  }
}

export function createApp({
  questionGenerator = generateQuestions,
  evaluationRunner = generateQuestions.evaluate,
  evaluationStatusReader = generateQuestions.getEvaluationStatus,
  evaluationResultsReader = generateQuestions.getEvaluationResults,
  humanReviewSampleReader = generateQuestions.getHumanReviewSample,
  humanReviewSaver = generateQuestions.saveHumanReview,
  humanReviewFinalizer = generateQuestions.finalizeHumanReview,
  humanReviewComparisonReader = generateQuestions.getHumanReviewComparison
} = {}) {
  const app = express();
  const allowedOrigins = new Set([
    process.env.FRONTEND_URL?.trim(),
    'http://localhost:5173',
    'http://127.0.0.1:5173'
  ].filter(Boolean));

  app.use(cors({
    origin: (origin, callback) => callback(null, !origin || allowedOrigins.has(origin))
  }));
  app.use(express.json({ limit: '4mb' }));

  app.get('/api/health', (_request, response) => {
    response.json({ status: 'ok' });
  });

  app.post('/api/upload', (request, response) => {
    upload.single('file')(request, response, async (uploadError) => {
      if (uploadError) {
        const status = uploadError.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
        const message = status === 413
          ? 'The PDF is too large. Please upload a file that is 15 MB or smaller.'
          : 'Please upload one PDF file.';
        return response.status(status).json({ error: message });
      }

      const file = request.file;
      if (!file) {
        return response.status(400).json({ error: 'Choose a PDF file to upload.' });
      }

      if (path.extname(file.originalname).toLowerCase() !== '.pdf') {
        return response.status(400).json({ error: 'Only PDF files are supported.' });
      }

      if (!file.buffer.subarray(0, 1024).includes(Buffer.from('%PDF-'))) {
        return response.status(400).json({ error: 'This file does not appear to be a valid PDF.' });
      }

      try {
        const { text, pages } = await extractPdf(file.buffer);
        return response.json({ filename: file.originalname, pages, text });
      } catch (error) {
        if (error.status === 422) {
          return response.status(422).json({ error: error.message });
        }

        return response.status(422).json({
          error: 'We could not read this PDF. It may be damaged or password-protected.'
        });
      }
    });
  });

  app.post('/api/questions', async (request, response) => {
    const text = request.body?.text;
    if (typeof text !== 'string' || !text.trim()) {
      return response.status(400).json({ error: 'Extract lecture text before generating questions.' });
    }

    const { generationId } = request.body;
    if (typeof generationId !== 'string' || !/^[A-Za-z0-9-]{16,64}$/.test(generationId)) {
      return response.status(400).json({ error: 'A valid generation ID is required. Retry from the Upload page.' });
    }

    try {
      const questions = await questionGenerator(text, { generationId });
      return response.json({ questions });
    } catch (error) {
      const knownError = error instanceof QuestionGenerationError;
      const status = knownError ? error.status : 502;
      const message = knownError
        ? error.message
        : 'Question generation failed unexpectedly. Please try again.';
      const payload = { error: message };
      if (knownError && Number.isInteger(error.completedQuestions)) {
        payload.completedQuestions = error.completedQuestions;
        payload.totalQuestions = error.totalQuestions;
      }
      if (knownError && Number.isInteger(error.retryAfterSeconds)) {
        payload.retryAfterSeconds = error.retryAfterSeconds;
      }
      if (knownError && error.generationStats) {
        payload.generationStats = error.generationStats;
      }
      return response.status(status).json(payload);
    }
  });

  app.post('/api/evaluation/run', async (request, response) => {
    const { generationId } = request.body || {};
    if (typeof generationId !== 'string' || !/^[A-Za-z0-9-]{16,64}$/.test(generationId)) {
      return response.status(400).json({ error: 'A valid generation ID is required to evaluate a question set.' });
    }

    try {
      const evaluation = await evaluationRunner(generationId);
      const progress = evaluationStatusReader(generationId);
      if (!progress.humanReviewFinalized) {
        return response.json({
          status: 'complete',
          heldForHumanReview: true,
          evaluatedCount: evaluation.summary?.evaluatedCount || evaluation.results.length,
          totalEvaluations: 40
        });
      }
      return response.json(evaluation);
    } catch (error) {
      const knownError = error instanceof QuestionEvaluationError;
      const payload = {
        error: knownError
          ? error.message
          : 'AI question evaluation failed unexpectedly. Please retry.'
      };
      if (knownError && Number.isInteger(error.completedEvaluations)) {
        payload.completedEvaluations = error.completedEvaluations;
        payload.totalEvaluations = error.totalEvaluations;
      }
      if (knownError && Number.isInteger(error.retryAfterSeconds)) {
        payload.retryAfterSeconds = error.retryAfterSeconds;
      }
      return response.status(knownError ? error.status : 502).json(payload);
    }
  });

  app.get('/api/evaluation/status', (request, response) => {
    try {
      return response.json(evaluationStatusReader(request.query.generationId));
    } catch (error) {
      const knownError = error instanceof QuestionEvaluationError;
      return response.status(knownError ? error.status : 502).json({
        error: knownError ? error.message : 'Could not read AI evaluation progress.'
      });
    }
  });

  app.get('/api/evaluation/results', (request, response) => {
    try {
      return response.json(evaluationResultsReader(request.query.generationId));
    } catch (error) {
      const knownError = error instanceof QuestionEvaluationError;
      return response.status(knownError ? error.status : 502).json({
        error: knownError ? error.message : 'Could not load AI evaluation results.'
      });
    }
  });

  app.get('/api/human-review/sample', (request, response) => {
    try {
      return response.json(humanReviewSampleReader(request.query.generationId));
    } catch (error) {
      const knownError = error instanceof HumanReviewError;
      const payload = { error: knownError ? error.message : 'Could not load the human-review sample.' };
      if (knownError && Number.isInteger(error.reviewedCount)) {
        payload.reviewedCount = error.reviewedCount;
        payload.totalQuestions = error.totalQuestions;
      }
      return response.status(knownError ? error.status : 502).json(payload);
    }
  });

  app.post('/api/human-review/review', (request, response) => {
    const { generationId, questionId, decision, comment } = request.body || {};
    try {
      return response.json(humanReviewSaver(generationId, { questionId, decision, comment }));
    } catch (error) {
      const knownError = error instanceof HumanReviewError;
      const payload = { error: knownError ? error.message : 'Could not save the human review.' };
      if (knownError && Number.isInteger(error.reviewedCount)) {
        payload.reviewedCount = error.reviewedCount;
        payload.totalQuestions = error.totalQuestions;
      }
      return response.status(knownError ? error.status : 502).json(payload);
    }
  });

  app.post('/api/human-review/finalize', (request, response) => {
    const { generationId } = request.body || {};
    try {
      return response.json(humanReviewFinalizer(generationId));
    } catch (error) {
      const knownError = error instanceof HumanReviewError;
      const payload = { error: knownError ? error.message : 'Could not finalize the human review.' };
      if (knownError && Number.isInteger(error.reviewedCount)) {
        payload.reviewedCount = error.reviewedCount;
        payload.totalQuestions = error.totalQuestions;
      }
      return response.status(knownError ? error.status : 502).json(payload);
    }
  });

  app.get('/api/human-review/comparison', (request, response) => {
    try {
      return response.json(humanReviewComparisonReader(request.query.generationId));
    } catch (error) {
      const knownError = error instanceof HumanReviewError;
      const payload = { error: knownError ? error.message : 'Could not load the AI–human comparison.' };
      if (knownError && Number.isInteger(error.reviewedCount)) {
        payload.reviewedCount = error.reviewedCount;
        payload.totalQuestions = error.totalQuestions;
      }
      return response.status(knownError ? error.status : 502).json(payload);
    }
  });

  app.get('/api/human-review/export', (request, response) => {
    try {
      const comparison = humanReviewComparisonReader(request.query.generationId);
      response.type('text/csv; charset=utf-8');
      response.set('Content-Disposition', 'attachment; filename="human-review-comparison.csv"');
      return response.send(createHumanReviewCsv(comparison));
    } catch (error) {
      const knownError = error instanceof HumanReviewError;
      return response.status(knownError ? error.status : 502).json({
        error: knownError ? error.message : 'Could not export the AI–human comparison.'
      });
    }
  });

  app.use((error, _request, response, next) => {
    if (error?.type === 'entity.too.large') {
      return response.status(413).json({ error: 'The extracted lecture text is too large to generate questions.' });
    }
    return next(error);
  });

  return app;
}

export const app = createApp();
