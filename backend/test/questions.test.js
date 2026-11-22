import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import { createApp } from '../src/app.js';
import {
  createQuestionGenerator,
  QuestionGenerationError,
  splitLectureText
} from '../src/questions.js';

const lecture = Array.from({ length: 80 }, (_, index) => (
  `The mitochondrion uses process marker ${index + 1} to produce energy marker ${index + 1} during cellular respiration.`
)).join('\n\n');

function responseForBatch(call, request) {
  const counts = request.contents.match(/exactly (\d+) multiple_choice questions and exactly (\d+) short_answer questions/);
  assert.ok(counts, 'request must specify per-batch question counts');
  const passages = [...request.contents.matchAll(
    /^\d+\. ([^ ]+) \[assigned slots (\d+); characters \d+-\d+\]: (".*")$/gm
  )].map((match) => ({ id: match[1], slots: Number(match[2]), text: JSON.parse(match[3]) }));
  assert.ok(passages.length, 'request must include numbered source passages');
  const multipleChoiceCount = Number(counts[1]);
  const shortAnswerCount = Number(counts[2]);
  const questions = [];
  const slotsRemaining = new Map(passages.map((passage) => [passage.id, passage.slots]));
  const passageUseCount = new Map();

  for (let index = 0; index < multipleChoiceCount + shortAnswerCount; index += 1) {
    const passage = passages.find((candidate) => (slotsRemaining.get(candidate.id) || 0) > 0);
    assert.ok(passage, 'the request must assign enough passage slots for its questions');
    slotsRemaining.set(passage.id, slotsRemaining.get(passage.id) - 1);
    const facts = [...passage.text.matchAll(/energy marker (\d+)/g)].map((match) => match[1]);
    const passageUse = passageUseCount.get(passage.id) || 0;
    passageUseCount.set(passage.id, passageUse + 1);
    const factNumber = facts[(call - 1 + passageUse) % facts.length];
    assert.ok(factNumber, 'source passage must contain the test fact');
    const answer = `energy marker ${factNumber}`;
    const kind = index < multipleChoiceCount ? 'multiple_choice' : 'short_answer';
    const options = kind === 'multiple_choice'
      ? [answer, `alternative ${factNumber} A`, `alternative ${factNumber} B`, `alternative ${factNumber} C`]
      : [];
    questions.push({
      kind,
      question: `Which energy marker is produced by process marker ${factNumber} in the mitochondrion?`,
      options,
      answer,
      explanation: `The passage identifies ${answer} as the product.`,
      sourcePassageId: passage.id,
      supportingEvidence: passage.text
    });
  }

  return sdkResponse(questions);
}

function sdkResponse(questions, { thoughtSignature = false } = {}) {
  const textPart = { text: JSON.stringify({ questions }) };
  const parts = thoughtSignature
    ? [textPart, { thoughtSignature: 'opaque-test-signature' }]
    : [textPart];
  const response = { candidates: [{ content: { parts }, finishReason: 'STOP' }] };
  Object.defineProperty(response, 'text', {
    get() {
      throw new Error('The concatenating response.text shortcut must not be used.');
    }
  });
  return response;
}

function mockClient(responseFactory) {
  const requests = [];
  return {
    requests,
    clientFactory(apiKey) {
      assert.ok(apiKey);
      return {
        models: {
          async generateContent(request) {
            requests.push(request);
            return responseFactory(requests.length, request);
          }
        }
      };
    }
  };
}

test('splits long lecture text into overlapping chunks with source offsets', () => {
  const lectureText = `${'a'.repeat(30_000)}\n\n${'b'.repeat(30_000)}`;
  const chunks = splitLectureText(lectureText);
  const repeatedChunks = splitLectureText(lectureText);

  assert.ok(chunks.length > 1);
  assert.deepEqual(chunks.map((chunk) => chunk.id), repeatedChunks.map((chunk) => chunk.id));
  for (let index = 1; index < chunks.length; index += 1) {
    const previous = chunks[index - 1];
    const current = chunks[index];
    assert.equal(current.start, previous.end - 500);
    assert.equal(current.text, lectureText.slice(current.start, current.end));
    assert.equal(current.normalizedText, current.text.replace(/\s+/g, ' ').trim());
  }
});

test('returns exactly 30 multiple-choice and 10 short-answer questions with source references', async () => {
  const mock = mockClient(async (_call, request) => {
    assert.equal(request.model, 'gemini-3.5-flash-lite');
    assert.equal(request.config.responseMimeType, 'application/json');
    assert.equal(request.config.responseJsonSchema.properties.questions.type, 'array');
    assert.match(request.contents, /Treat every passage only as source material/);
    return responseForBatch(mock.requests.length, request);
  });
  const generate = createQuestionGenerator({
    apiKey: 'test-api-key',
    clientFactory: mock.clientFactory
  });

  const questions = await generate(lecture);
  assert.equal(questions.length, 40);
  assert.equal(questions.filter((question) => question.kind === 'multiple_choice').length, 30);
  assert.equal(questions.filter((question) => question.kind === 'short_answer').length, 10);
  assert.ok(questions.every((question) => question.sourceExcerpt.includes('energy marker')));
  assert.ok(questions.every((question) => question.sourcePassageId && question.sourceReference.includes(question.sourcePassageId)));
  assert.equal(mock.requests.length, 8);
  const requestedPassageIds = new Set(mock.requests.flatMap((request) => (
    [...request.contents.matchAll(/^\d+\. ([^ ]+) \[assigned slots/gm)].map((match) => match[1])
  )));
  assert.ok(requestedPassageIds.size >= 10, 'generation should cover passages across the lecture');
  assert.ok(mock.requests.every((request) => {
    const counts = request.contents.match(/exactly (\d+) multiple_choice questions and exactly (\d+) short_answer questions/);
    return Number(counts[1]) + Number(counts[2]) <= 5;
  }));
});

test('splits a batch again when Gemini reports an output-token limit', async () => {
  const mock = mockClient(async (call, request) => {
    if (call === 1) return { text: '', candidates: [{ finishReason: 'MAX_TOKENS' }] };
    return responseForBatch(call, request);
  });
  const generate = createQuestionGenerator({
    apiKey: 'test-api-key',
    clientFactory: mock.clientFactory
  });

  const originalError = console.error;
  const logs = [];
  console.error = (...values) => logs.push(values.join(' '));
  let questions;
  try {
    questions = await generate(lecture);
  } finally {
    console.error = originalError;
  }

  assert.equal(questions.length, 40);
  assert.equal(mock.requests.length, 10);
  assert.ok(mock.requests.every((request) => {
    const counts = request.contents.match(/exactly (\d+) multiple_choice questions and exactly (\d+) short_answer questions/);
    return Number(counts[1]) + Number(counts[2]) <= 5;
  }));
  assert.ok(logs.every((line) => !line.includes('test-api-key') && !line.includes(lecture)));
  assert.match(logs[0], /"category":"output_limit"/);
});

test('reports insufficient source after bounded retries return incomplete batches', async () => {
  const mock = mockClient(async () => sdkResponse([]));
  const generate = createQuestionGenerator({
    apiKey: 'test-api-key',
    clientFactory: mock.clientFactory
  });
  const originalWarn = console.warn;
  const logs = [];
  console.warn = (...values) => logs.push(values.join(' '));

  try {
    await assert.rejects(generate(lecture), (error) => {
      assert.equal(error.code, 'INSUFFICIENT_SOURCE');
      assert.equal(error.status, 422);
      return true;
    });
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(mock.requests.length, 3);
  assert.ok(logs.filter((line) => line.startsWith('[Question validation]'))
    .every((line) => line.includes('"category":"incomplete_question_batch"')));
  const summaryLine = logs.find((line) => line.startsWith('[Question generation summary]'));
  assert.ok(summaryLine);
  const summary = JSON.parse(summaryLine.slice(summaryLine.indexOf('{')));
  assert.deepEqual({
    candidateCount: summary.candidateCount,
    acceptedCount: summary.acceptedCount,
    rejectedCount: summary.rejectedCount
  }, {
    candidateCount: 0,
    acceptedCount: 0,
    rejectedCount: 0
  });
  assert.equal(summary.batchFailuresByCategory.incomplete_question_batch, 3);
  assert.ok(logs.every((line) => !line.includes(lecture) && !line.includes('test-api-key')));
});

test('preserves nine accepted questions, reports safe rejection totals, and resumes the same job', async () => {
  let rejectRepeatedly = true;
  const mock = mockClient(async (call, request) => {
    if (rejectRepeatedly && call >= 2 && call <= 4) {
      const { candidates } = responseForBatch(call, request);
      const questions = JSON.parse(candidates[0].content.parts[0].text).questions;
      if (call === 2) {
        questions.pop();
        const replacement = JSON.parse(responseForBatch(call, request).candidates[0].content.parts[0].text).questions.at(-1);
        replacement.answer = 'invented unsupported answer';
        replacement.options[0] = replacement.answer;
        questions.push(replacement);
      } else {
        const replacement = JSON.parse(responseForBatch(call, request).candidates[0].content.parts[0].text).questions[0];
        replacement.answer = 'invented unsupported answer';
        replacement.options[0] = replacement.answer;
        return sdkResponse([replacement]);
      }
      return sdkResponse(questions);
    }
    return responseForBatch(call, request);
  });
  const generate = createQuestionGenerator({
    apiKey: 'test-api-key',
    clientFactory: mock.clientFactory
  });
  const generationId = 'nine-question-resume-001';
  const originalWarn = console.warn;
  const logs = [];
  console.warn = (...values) => logs.push(values.join(' '));

  try {
    await assert.rejects(generate(lecture, { generationId }), (error) => {
      assert.equal(error.code, 'INSUFFICIENT_SOURCE');
      assert.equal(error.completedQuestions, 9);
      assert.deepEqual({
        candidates: error.generationStats.candidateCount,
        accepted: error.generationStats.acceptedCount,
        rejected: error.generationStats.rejectedCount
      }, { candidates: 12, accepted: 9, rejected: 3 });
      assert.equal(error.generationStats.rejectedByCategory.unsupported_answer, 3);
      return true;
    });
  } finally {
    console.warn = originalWarn;
  }

  const summaryLine = logs.find((line) => line.startsWith('[Question generation summary]'));
  assert.ok(summaryLine);
  assert.ok(logs.every((line) => !line.includes(lecture) && !line.includes('test-api-key')));
  rejectRepeatedly = false;
  const questions = await generate(lecture, { generationId });

  assert.equal(questions.length, 40);
  assert.equal(mock.requests.length, 11);
});

test('retries only a question with fabricated supporting evidence', async () => {
  const mock = mockClient(async (call, request) => {
    const response = responseForBatch(call, request);
    const questions = JSON.parse(response.candidates[0].content.parts[0].text).questions;
    if (call === 1) questions[0].supportingEvidence = 'A fabricated claim unrelated to any source passage.';
    return sdkResponse(questions);
  });
  const generate = createQuestionGenerator({
    apiKey: 'test-api-key',
    clientFactory: mock.clientFactory
  });
  const originalWarn = console.warn;
  const logs = [];
  console.warn = (...values) => logs.push(values.join(' '));

  let questions;
  try {
    questions = await generate(lecture);
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(questions.length, 40);
  assert.equal(mock.requests.length, 9);
  assert.match(mock.requests[1].contents, /exactly 1 multiple_choice questions and exactly 0 short_answer questions/);
  assert.match(logs[0], /"category":"unsupported_evidence"/);
  assert.match(logs[0], /"sourceChunkId":"chunk-/);
  assert.match(logs[0], /"questionIndex":1/);
  assert.ok(logs.every((line) => !line.includes(lecture) && !line.includes('test-api-key')));
});

test('retries a question with an invalid source passage ID', async () => {
  const mock = mockClient(async (call, request) => {
    const response = responseForBatch(call, request);
    const questions = JSON.parse(response.candidates[0].content.parts[0].text).questions;
    if (call === 1) questions[0].sourcePassageId = 'unknown-source-passage';
    return sdkResponse(questions);
  });
  const generate = createQuestionGenerator({
    apiKey: 'test-api-key',
    clientFactory: mock.clientFactory
  });
  const originalWarn = console.warn;
  const logs = [];
  console.warn = (...values) => logs.push(values.join(' '));

  try {
    const questions = await generate(lecture);
    assert.equal(questions.length, 40);
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(mock.requests.length, 9);
  assert.match(mock.requests[1].contents, /invalid_source_passage_id/);
  assert.match(logs[0], /"category":"invalid_source_passage_id"/);
});

test('retries only a multiple-choice question with invalid options', async () => {
  const mock = mockClient(async (call, request) => {
    const response = responseForBatch(call, request);
    const questions = JSON.parse(response.candidates[0].content.parts[0].text).questions;
    if (call === 1) questions[0].options.pop();
    return sdkResponse(questions);
  });
  const generate = createQuestionGenerator({
    apiKey: 'test-api-key',
    clientFactory: mock.clientFactory
  });
  const originalWarn = console.warn;
  const logs = [];
  console.warn = (...values) => logs.push(values.join(' '));

  try {
    const questions = await generate(lecture);
    assert.equal(questions.length, 40);
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(mock.requests.length, 9);
  assert.match(mock.requests[1].contents, /exactly 1 multiple_choice questions and exactly 0 short_answer questions/);
  assert.match(logs[0], /"category":"invalid_options"/);
});

test('accepts whitespace differences while selecting the verbatim passage deterministically', async () => {
  const mock = mockClient(async (call, request) => {
    const response = responseForBatch(call, request);
    const questions = JSON.parse(response.candidates[0].content.parts[0].text).questions;
    for (const question of questions) {
      question.supportingEvidence = question.supportingEvidence.replace(/\s+/g, ' \n\t ');
    }
    return sdkResponse(questions);
  });
  const generate = createQuestionGenerator({
    apiKey: 'test-api-key',
    clientFactory: mock.clientFactory
  });

  const questions = await generate(lecture);
  const firstSourcePassage = [...mock.requests[0].contents.matchAll(
    /^\d+\. ([^ ]+) \[assigned slots \d+; characters \d+-\d+\]: (".*")$/gm
  )].map((match) => ({ id: match[1], text: JSON.parse(match[2]) }))
    .find((passage) => passage.id === questions[0].sourcePassageId);

  assert.equal(questions.length, 40);
  assert.equal(questions[0].sourceExcerpt, firstSourcePassage.text);
});

test('ignores thoughtSignature parts without reading or concatenating response.text', async () => {
  const mock = mockClient(async (call, request) => {
    const response = responseForBatch(call, request);
    const questions = JSON.parse(response.candidates[0].content.parts[0].text).questions;
    return sdkResponse(questions, { thoughtSignature: true });
  });
  const generate = createQuestionGenerator({
    apiKey: 'test-api-key',
    clientFactory: mock.clientFactory
  });
  const originalWarn = console.warn;
  const logs = [];
  console.warn = (...values) => logs.push(values.join(' '));

  try {
    const questions = await generate(lecture);
    assert.equal(questions.length, 40);
  } finally {
    console.warn = originalWarn;
  }

  assert.deepEqual(logs, []);
});

test('rejects an unsupported correct answer and reports validation retry exhaustion', async () => {
  const mock = mockClient(async (call, request) => {
    const response = responseForBatch(call, request);
    const questions = JSON.parse(response.candidates[0].content.parts[0].text).questions;
    questions[0].answer = 'fabricated molecule';
    questions[0].options[0] = 'fabricated molecule';
    return sdkResponse(questions);
  });
  const generate = createQuestionGenerator({
    apiKey: 'test-api-key',
    clientFactory: mock.clientFactory
  });
  const originalWarn = console.warn;
  const logs = [];
  console.warn = (...values) => logs.push(values.join(' '));

  try {
    await assert.rejects(generate(lecture), (error) => {
      assert.equal(error.code, 'INSUFFICIENT_SOURCE');
      assert.equal(error.completedQuestions, 4);
      assert.match(error.message, /could not support enough distinct, verifiable questions/i);
      return true;
    });
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(mock.requests.length, 3);
  assert.ok(logs.filter((line) => line.startsWith('[Question validation]'))
    .every((line) => line.includes('"category":"unsupported_answer"')));
});

test('retries transient Gemini rate limits and succeeds', async () => {
  const mock = mockClient(async (call) => {
    if (call === 1) throw Object.assign(new Error('Resource exhausted'), { status: 429 });
    return responseForBatch(call, mock.requests[mock.requests.length - 1]);
  });
  const delays = [];
  const generate = createQuestionGenerator({
    apiKey: 'test-api-key',
    clientFactory: mock.clientFactory,
    sleep: async (delay) => delays.push(delay),
    random: () => 0
  });

  const questions = await generate(lecture);
  assert.equal(questions.length, 40);
  assert.deepEqual(delays, [500]);
});

test('retries upstream 503 errors with bounded jittered backoff and Retry-After', async () => {
  const mock = mockClient(async (call, request) => {
    if (call === 1) {
      throw Object.assign(new Error('Sensitive provider details'), {
        status: 503,
        headers: { 'Retry-After': '2' }
      });
    }
    return responseForBatch(call, request);
  });
  const delays = [];
  const generate = createQuestionGenerator({
    apiKey: 'test-api-key',
    clientFactory: mock.clientFactory,
    sleep: async (delay) => delays.push(delay),
    random: () => 0
  });

  const questions = await generate(lecture, { generationId: 'retry-after-test-001' });

  assert.equal(questions.length, 40);
  assert.deepEqual(delays, [2000]);
  assert.equal(mock.requests.length, 9);
});

test('reads Retry-After from the official SDK response before it wraps the error', async () => {
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  const logs = [];
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return new Response(JSON.stringify({
      error: { code: 503, status: 'UNAVAILABLE', message: 'Sensitive provider details' }
    }), {
      status: 503,
      headers: { 'Content-Type': 'application/json', 'Retry-After': '61' }
    });
  };
  console.error = (...values) => logs.push(values.join(' '));

  try {
    const generate = createQuestionGenerator({ apiKey: 'test-api-key' });
    await assert.rejects(generate(lecture, { generationId: 'sdk-retry-after-test-001' }), (error) => {
      assert.equal(error.code, 'GEMINI_UNAVAILABLE');
      assert.equal(error.retryAfterSeconds, 61);
      return true;
    });
    await assert.rejects(generate(lecture, { generationId: 'sdk-retry-after-test-001' }), (error) => {
      assert.equal(error.code, 'GEMINI_UNAVAILABLE');
      assert.ok(error.retryAfterSeconds > 0);
      return true;
    });
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
  }

  assert.equal(fetchCalls, 1);
  assert.ok(logs.every((line) => !line.includes('Sensitive provider details')));
  assert.ok(logs.every((line) => !line.includes('test-api-key') && !line.includes(lecture)));
});

test('preserves successful batches when a later upstream 503 exhausts retries', async () => {
  let shouldFail = true;
  const mock = mockClient(async (call, request) => {
    if (shouldFail && call >= 2 && call <= 5) {
      throw Object.assign(new Error('Sensitive provider details'), { status: 503 });
    }
    return responseForBatch(call, request);
  });
  const delays = [];
  const generate = createQuestionGenerator({
    apiKey: 'test-api-key',
    clientFactory: mock.clientFactory,
    sleep: async (delay) => delays.push(delay),
    random: () => 0
  });
  const generationId = 'resume-generation-0001';
  const originalError = console.error;
  const logs = [];
  console.error = (...values) => logs.push(values.join(' '));

  try {
    await assert.rejects(generate(lecture, { generationId }), (error) => {
      assert.equal(error.code, 'GEMINI_UNAVAILABLE');
      assert.equal(error.status, 503);
      assert.equal(error.completedQuestions, 5);
      assert.equal(error.totalQuestions, 40);
      return true;
    });
  } finally {
    console.error = originalError;
  }

  assert.deepEqual(delays, [500, 1000, 2000]);
  assert.equal(mock.requests.length, 5);
  assert.match(logs[0], /"status":503,"category":"service"/);
  assert.ok(logs.every((line) => !line.includes('Sensitive provider details')));
  assert.ok(logs.every((line) => !line.includes('test-api-key') && !line.includes(lecture)));

  shouldFail = false;
  const questions = await generate(lecture, { generationId });

  assert.equal(questions.length, 40);
  assert.ok(questions.some((question) => (
    question.question === 'Which energy marker is produced by process marker 1 in the mitochondrion?'
  )));
  assert.equal(mock.requests.length, 12);
});

test('reports rate limits after bounded retries', async () => {
  const mock = mockClient(async () => {
    throw Object.assign(new Error('Too many requests'), { status: 429 });
  });
  const generate = createQuestionGenerator({
    apiKey: 'test-api-key',
    clientFactory: mock.clientFactory,
    sleep: async () => {}
  });

  const originalError = console.error;
  const logs = [];
  console.error = (...values) => logs.push(values.join(' '));
  try {
    await assert.rejects(generate(lecture), (error) => {
      assert.equal(error.code, 'RATE_LIMITED');
      assert.equal(error.status, 429);
      return true;
    });
  } finally {
    console.error = originalError;
  }
  assert.equal(mock.requests.length, 3);
  assert.match(logs[0], /"category":"rate_limit"/);
});

test('classifies provider errors safely for actionable UI messages and redacted logs', async () => {
  const errors = [
    {
      status: 401,
      message: 'invalid API key test-api-key',
      code: 'GEMINI_AUTH_FAILED',
      userMessage: 'Gemini rejected the backend API key'
    },
    {
      status: 400,
      message: 'Invalid responseJsonSchema near lecture source text',
      code: 'GEMINI_SCHEMA_REJECTED',
      userMessage: 'Gemini rejected the structured JSON request'
    },
    {
      status: 400,
      message: 'Input token limit exceeded for lecture source text',
      code: 'GEMINI_INPUT_TOO_LARGE',
      userMessage: 'Gemini rejected a lecture chunk as too large'
    },
    {
      status: 404,
      message: 'model gemini-3.5-flash-lite not found',
      code: 'GEMINI_MODEL_UNAVAILABLE',
      userMessage: 'configured Gemini model'
    },
    {
      status: 429,
      message: 'Daily project quota exceeded',
      code: 'QUOTA_EXCEEDED',
      userMessage: 'Gemini project quota is exhausted'
    }
  ];

  for (const expected of errors) {
    const mock = mockClient(async () => {
      throw Object.assign(new Error(expected.message), { status: expected.status });
    });
    const generate = createQuestionGenerator({
      apiKey: 'test-api-key',
      clientFactory: mock.clientFactory,
      sleep: async () => {}
    });
    const originalError = console.error;
    const logs = [];
    console.error = (...values) => logs.push(values.join(' '));

    try {
      await assert.rejects(generate(lecture), (error) => {
        assert.equal(error.code, expected.code);
        assert.match(error.message, new RegExp(expected.userMessage, 'i'));
        return true;
      });
    } finally {
      console.error = originalError;
    }

    assert.equal(logs.length, 1);
    assert.ok(logs[0].includes(String(expected.status)));
    assert.ok(!logs[0].includes('test-api-key'));
    assert.ok(!logs[0].includes(lecture));
  }
});

test('requires a backend API key', async () => {
  const generate = createQuestionGenerator({ apiKey: '' });

  await assert.rejects(generate(lecture), (error) => {
    assert.equal(error.code, 'MISSING_API_KEY');
    assert.equal(error.status, 503);
    return true;
  });
});

test('question API uses a mocked Gemini client and rejects empty lecture text', async () => {
  const mock = mockClient(async (call, request) => responseForBatch(call, request));
  const app = createApp({
    questionGenerator: createQuestionGenerator({
      apiKey: 'test-api-key',
      clientFactory: mock.clientFactory
    })
  });
  const server = app.listen(0);
  await once(server, 'listening');
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const emptyResponse = await fetch(`${baseUrl}/api/questions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: ' ' })
    });
    assert.equal(emptyResponse.status, 400);

    const response = await fetch(`${baseUrl}/api/questions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: lecture, generationId: 'api-generation-test-001' })
    });
    const data = await response.json();

    assert.equal(response.status, 200);
    assert.equal(data.questions.length, 40);
    assert.ok(data.questions[0].sourceReference.includes(data.questions[0].sourcePassageId));
  } finally {
    server.close();
    await once(server, 'close');
  }
});

test('question API explains when the backend Gemini key is missing', async () => {
  const app = createApp({
    questionGenerator: createQuestionGenerator({ apiKey: '' })
  });
  const server = app.listen(0);
  await once(server, 'listening');
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const response = await fetch(`${baseUrl}/api/questions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: lecture, generationId: 'missing-key-test-001' })
    });

    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      error: 'Question generation is not configured. Add GEMINI_API_KEY to the backend .env file.'
    });
  } finally {
    server.close();
    await once(server, 'close');
  }
});

test('exposes typed generation errors for invalid input', async () => {
  const generate = createQuestionGenerator({ apiKey: 'test-api-key' });
  await assert.rejects(generate(''), (error) => {
    assert.ok(error instanceof QuestionGenerationError);
    assert.equal(error.status, 400);
    return true;
  });
});
