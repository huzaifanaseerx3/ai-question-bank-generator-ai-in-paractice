import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import { createApp } from '../src/app.js';
import {
  createQuestionGenerator,
  QuestionEvaluationError
} from '../src/questions.js';

const lecture = Array.from({ length: 80 }, (_, index) => (
  `The mitochondrion uses process marker ${index + 1} to produce energy marker ${index + 1} during cellular respiration.`
)).join('\n\n');

function sdkResponse(payload) {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return { candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] };
}

function generatedQuestionResponse(request, passageUse) {
  const counts = request.contents.match(/exactly (\d+) multiple_choice questions and exactly (\d+) short_answer questions/);
  assert.ok(counts, 'question generation requests must include per-batch counts');
  const passages = [...request.contents.matchAll(
    /^\d+\. ([^ ]+) \[assigned slots (\d+); characters \d+-\d+\]: (".*")$/gm
  )].map((match) => ({
    id: match[1],
    slots: Number(match[2]),
    text: JSON.parse(match[3])
  }));
  const slotsRemaining = new Map(passages.map((passage) => [passage.id, passage.slots]));
  const multipleChoiceCount = Number(counts[1]);
  const questionCount = multipleChoiceCount + Number(counts[2]);
  const questions = [];

  for (let index = 0; index < questionCount; index += 1) {
    const passage = passages.find((candidate) => (slotsRemaining.get(candidate.id) || 0) > 0);
    assert.ok(passage);
    slotsRemaining.set(passage.id, slotsRemaining.get(passage.id) - 1);
    const factNumbers = [...passage.text.matchAll(/energy marker (\d+)/g)].map((match) => match[1]);
    const used = passageUse.get(passage.id) || 0;
    passageUse.set(passage.id, used + 1);
    const factNumber = factNumbers[used % factNumbers.length];
    const answer = `energy marker ${factNumber}`;
    const kind = index < multipleChoiceCount ? 'multiple_choice' : 'short_answer';

    questions.push({
      kind,
      question: `Which energy marker is produced by process marker ${factNumber} in the mitochondrion?`,
      options: kind === 'multiple_choice'
        ? [answer, `alternative ${factNumber} A`, `alternative ${factNumber} B`, `alternative ${factNumber} C`]
        : [],
      answer,
      explanation: `The passage identifies ${answer} as the product.`,
      sourcePassageId: passage.id,
      supportingEvidence: passage.text
    });
  }

  return sdkResponse({ questions });
}

function evaluationCases(request) {
  const caseText = request.contents.split('Evaluation cases:\n')[1];
  assert.ok(caseText, 'evaluation requests must contain source-backed cases');
  return caseText.trim().split('\n').map((line) => JSON.parse(line));
}

function evaluationResponse(cases, scoreFor = () => 4) {
  const criteria = [
    'answerCorrectness',
    'questionClarity',
    'lectureGrounding',
    'explanationQuality'
  ];
  return sdkResponse({
    evaluations: cases.map(({ questionIndex }) => ({
      questionIndex,
      ...Object.fromEntries(criteria.map((criterion) => [criterion, {
        score: scoreFor(criterion, questionIndex),
        explanation: `${criterion} was checked against the supplied source.`
      }])),
      overallExplanation: 'The question is supported and understandable.'
    }))
  });
}

function createSystem(evaluationFactory = (_call, request) => (
  evaluationResponse(evaluationCases(request))
)) {
  const requests = [];
  const passageUse = new Map();
  let evaluationCall = 0;
  const clientFactory = (apiKey) => {
    assert.equal(apiKey, 'mock-api-key');
    return {
      models: {
        async generateContent(request) {
          requests.push(request);
          if (request.config.responseJsonSchema.properties.evaluations) {
            evaluationCall += 1;
            return evaluationFactory(evaluationCall, request);
          }
          return generatedQuestionResponse(request, passageUse);
        }
      }
    };
  };
  const generate = createQuestionGenerator({
    apiKey: 'mock-api-key',
    clientFactory,
    sleep: async () => {},
    random: () => 0
  });
  return { generate, requests, getEvaluationCallCount: () => evaluationCall };
}

async function createQuestionSet(system, generationId = 'evaluation-test-0001') {
  const questions = await system.generate(lecture, { generationId });
  return { generationId, questions };
}

test('evaluates source-grounded questions, applies the pass/fail rule, and leaves questions unchanged', async () => {
  const system = createSystem((_call, request) => evaluationResponse(
    evaluationCases(request),
    (criterion, questionIndex) => criterion === 'lectureGrounding' && questionIndex === 2 ? 2 : 3
  ));
  const { generationId, questions } = await createQuestionSet(system);
  const originalQuestions = structuredClone(questions);

  const result = await system.generate.evaluate(generationId);

  assert.equal(result.results.length, 40);
  assert.equal(result.summary.evaluatedCount, 40);
  assert.equal(result.summary.passedCount, 39);
  assert.equal(result.summary.failedCount, 1);
  assert.equal(result.summary.passRate, 97.5);
  assert.equal(result.results[0].decision, 'pass');
  assert.equal(result.results[1].decision, 'fail');
  assert.equal(result.results[1].lectureGrounding.score, 2);
  assert.match(result.passFailRule, /all four AI criterion scores are 3 or higher/i);
  assert.equal(result.model, 'gemini-3.5-flash-lite');
  assert.equal(system.getEvaluationCallCount(), 8);
  assert.deepEqual(questions, originalQuestions);

  const firstEvaluationRequest = system.requests.find((request) => (
    request.config.responseJsonSchema.properties.evaluations
  ));
  assert.equal(firstEvaluationRequest.model, 'gemini-3.5-flash-lite');
  assert.equal(firstEvaluationRequest.config.responseMimeType, 'application/json');
  const cases = evaluationCases(firstEvaluationRequest);
  assert.equal(cases.length, 5);
  for (const testCase of cases) {
    const question = questions[testCase.questionIndex - 1];
    assert.equal(testCase.question.text, question.question);
    assert.equal(testCase.question.markedAnswer, question.answer);
    assert.equal(testCase.originalSourcePassage.id, question.sourcePassageId);
    assert.equal(testCase.originalSourcePassage.text, question.sourceExcerpt);
  }
});

test('retries invalid scores and missing fields with bounded validation feedback', async () => {
  const system = createSystem((call, request) => {
    const response = evaluationResponse(evaluationCases(request));
    const parsed = JSON.parse(response.candidates[0].content.parts[0].text);
    if (call === 1) parsed.evaluations[0].answerCorrectness.score = 6;
    if (call === 2) delete parsed.evaluations[0].explanationQuality;
    return sdkResponse(parsed);
  });
  const { generationId } = await createQuestionSet(system, 'evaluation-validation-0001');

  const result = await system.generate.evaluate(generationId);

  assert.equal(result.results.length, 40);
  assert.equal(system.getEvaluationCallCount(), 10);
  const retryPrompts = system.requests
    .filter((request) => request.config.responseJsonSchema.properties.evaluations)
    .slice(0, 3)
    .map((request) => request.contents);
  assert.match(retryPrompts[1], /INVALID_EVALUATION_SCORE/);
  assert.match(retryPrompts[2], /INVALID_EVALUATION_FIELDS/);
});

test('rejects malformed JSON after bounded retries without losing the source question set', async () => {
  const system = createSystem(() => sdkResponse('{malformed'));
  const { generationId, questions } = await createQuestionSet(system, 'evaluation-malformed-0001');
  const originalQuestions = structuredClone(questions);

  await assert.rejects(system.generate.evaluate(generationId), (error) => {
    assert.ok(error instanceof QuestionEvaluationError);
    assert.equal(error.code, 'INVALID_EVALUATION_JSON');
    assert.equal(error.completedEvaluations, 0);
    assert.deepEqual(error.results, []);
    return true;
  });

  assert.equal(system.getEvaluationCallCount(), 3);
  assert.deepEqual(questions, originalQuestions);
  assert.equal(system.generate.getEvaluationStatus(generationId).status, 'paused');
});

test('retries transient rate-limit and service-unavailable responses', async () => {
  for (const [status, generationId] of [
    [429, 'evaluation-rate-retry-001'],
    [503, 'evaluation-service-retry-001']
  ]) {
    let failedOnce = false;
    const system = createSystem((call, request) => {
      if (!failedOnce) {
        failedOnce = true;
        throw Object.assign(new Error('Sensitive provider detail'), { status });
      }
      return evaluationResponse(evaluationCases(request));
    });
    const { generationId: savedGenerationId } = await createQuestionSet(system, generationId);

    const result = await system.generate.evaluate(savedGenerationId);

    assert.equal(result.results.length, 40);
    assert.equal(system.getEvaluationCallCount(), 9);
  }
});

test('splits an evaluation batch after a Gemini output-token limit', async () => {
  const system = createSystem((call, request) => {
    if (call === 1) return { candidates: [{ finishReason: 'MAX_TOKENS' }] };
    return evaluationResponse(evaluationCases(request));
  });
  const { generationId } = await createQuestionSet(system, 'evaluation-output-limit-001');
  const originalConsoleError = console.error;
  console.error = () => {};

  try {
    const result = await system.generate.evaluate(generationId);
    assert.equal(result.results.length, 40);
  } finally {
    console.error = originalConsoleError;
  }
  assert.equal(system.getEvaluationCallCount(), 10);
});

test('preserves completed evaluation batches after a provider failure and resumes the same job', async () => {
  let failLaterBatches = true;
  const system = createSystem((call, request) => {
    if (failLaterBatches && call >= 2 && call <= 5) {
      throw Object.assign(new Error('Sensitive provider details'), { status: 503 });
    }
    return evaluationResponse(evaluationCases(request));
  });
  const { generationId, questions } = await createQuestionSet(system, 'evaluation-resume-0001');
  const originalQuestions = structuredClone(questions);
  const originalConsoleError = console.error;
  const logs = [];
  console.error = (...values) => logs.push(values.join(' '));

  try {
    await assert.rejects(system.generate.evaluate(generationId), (error) => {
      assert.equal(error.code, 'GEMINI_UNAVAILABLE');
      assert.equal(error.completedEvaluations, 5);
      assert.equal(error.results.length, 5);
      return true;
    });
  } finally {
    console.error = originalConsoleError;
  }

  assert.ok(logs.every((line) => !line.includes('Sensitive provider details')));
  assert.ok(logs.every((line) => !line.includes('mock-api-key') && !line.includes(lecture)));
  assert.equal(system.generate.getEvaluationStatus(generationId).evaluatedCount, 5);
  failLaterBatches = false;
  const resumed = await system.generate.evaluate(generationId);

  assert.equal(resumed.results.length, 40);
  assert.equal(system.getEvaluationCallCount(), 12);
  assert.equal(system.generate.getEvaluationStatus(generationId).status, 'complete');
  const evaluationRequests = system.requests.filter((request) => request.config.responseJsonSchema.properties.evaluations);
  assert.equal(evaluationCases(evaluationRequests[5])[0].questionIndex, 6);
  assert.deepEqual(questions, originalQuestions);
});

test('evaluation API accepts only a generation ID and ignores client question or lecture fields', async () => {
  const calls = [];
  const statusCalls = [];
  const server = createApp({
    evaluationRunner: async (...args) => {
      calls.push(args);
      return { results: [], summary: { evaluatedCount: 0 } };
    },
    evaluationStatusReader: (...args) => {
      statusCalls.push(args);
      return { evaluatedCount: 3, totalEvaluations: 40, status: 'running' };
    }
  }).listen(0);
  await once(server, 'listening');

  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/evaluation/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        generationId: 'server-owned-job-0001',
        questions: [{ answer: 'client-submitted' }],
        lectureText: 'client-submitted'
      })
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      status: 'complete',
      heldForHumanReview: true,
      evaluatedCount: 0,
      totalEvaluations: 40
    });

    const statusResponse = await fetch(
      `http://127.0.0.1:${server.address().port}/api/evaluation/status?generationId=server-owned-job-0001`
    );
    assert.equal(statusResponse.status, 200);
    assert.equal((await statusResponse.json()).evaluatedCount, 3);
  } finally {
    server.close();
    await once(server, 'close');
  }

  assert.deepEqual(calls, [['server-owned-job-0001']]);
  assert.deepEqual(statusCalls, [['server-owned-job-0001'], ['server-owned-job-0001']]);
});
