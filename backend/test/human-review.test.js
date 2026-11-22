import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import { createApp } from '../src/app.js';
import {
  calculateAgreementMetrics,
  createHumanReviewCsv,
  createHumanReviewManager,
  createStratifiedReviewSample,
  HumanReviewError
} from '../src/human-review.js';
import { QuestionEvaluationError } from '../src/questions.js';

function createReadyJob() {
  const questions = Array.from({ length: 40 }, (_value, offset) => {
    const questionIndex = offset + 1;
    const kind = questionIndex <= 30 ? 'multiple_choice' : 'short_answer';
    const groupIndex = kind === 'multiple_choice'
      ? Math.floor((questionIndex - 1) / 2) + 1
      : Math.floor((questionIndex - 31) / 2) + 1;
    return {
      kind,
      question: `Question text ${questionIndex}?`,
      options: kind === 'multiple_choice'
        ? [`Answer ${questionIndex}`, 'Option B', 'Option C', 'Option D']
        : [],
      answer: `Answer ${questionIndex}`,
      explanation: `Explanation ${questionIndex}.`,
      sourcePassageId: `${kind === 'multiple_choice' ? 'mcq' : 'short'}-passage-${groupIndex}`,
      sourceReference: `Source reference ${questionIndex}`
    };
  });
  const sourcePassages = [...new Set(questions.map((question) => question.sourcePassageId))]
    .map((id) => ({ id, text: `Original lecture source passage ${id}.` }));
  const job = {
    inputHash: 'stable-input-hash-for-human-review-tests',
    text: 'Original lecture text retained by the server.',
    completed: true,
    questions,
    evaluation: {
      completed: true,
      results: questions.map((_question, offset) => ({
        questionIndex: offset + 1,
        decision: offset % 2 === 0 ? 'pass' : 'fail'
      }))
    }
  };
  return { job, sourcePassages };
}

function createManager(job, sourcePassages, now = () => 1_700_000_000_000) {
  return createHumanReviewManager({
    getJob: (generationId) => generationId === 'human-review-test-0001' ? job : undefined,
    getSourcePassages: () => sourcePassages,
    pruneJobs: () => {},
    now
  });
}

test('selects a reproducible 15-MCQ and 5-short-answer sample spread across passages', () => {
  const questions = createReadyJob().job.questions;
  const first = createStratifiedReviewSample(questions, 'stable-seed-01');
  const second = createStratifiedReviewSample(questions, 'stable-seed-01');
  const differentSeed = createStratifiedReviewSample(questions, 'stable-seed-02');

  assert.deepEqual(first, second);
  assert.notDeepEqual(first, differentSeed);
  assert.equal(first.length, 20);
  assert.equal(first.filter((item) => questions[item.questionIndex - 1].kind === 'multiple_choice').length, 15);
  assert.equal(first.filter((item) => questions[item.questionIndex - 1].kind === 'short_answer').length, 5);
  assert.equal(new Set(first.map((item) => item.questionId)).size, 20);
  assert.equal(new Set(first.filter((item) => questions[item.questionIndex - 1].kind === 'multiple_choice')
    .map((item) => item.sourcePassageId)).size, 15);
  assert.equal(new Set(first.filter((item) => questions[item.questionIndex - 1].kind === 'short_answer')
    .map((item) => item.sourcePassageId)).size, 5);
});

test('saves and edits human judgments, keeps them blind until finalization, and preserves AI data', () => {
  const { job, sourcePassages } = createReadyJob();
  const originalQuestions = structuredClone(job.questions);
  const originalAiEvaluations = structuredClone(job.evaluation.results);
  const manager = createManager(job, sourcePassages);
  const generationId = 'human-review-test-0001';
  const firstSample = manager.getSample(generationId);

  assert.equal(firstSample.questions.length, 20);
  assert.equal(firstSample.reviewedCount, 0);
  assert.equal(firstSample.finalized, false);
  assert.equal(firstSample.selectedQuestionIds.length, 20);
  assert.ok(firstSample.questions.every((item) => !Object.hasOwn(item, 'aiDecision')));
  assert.equal(firstSample.questions[0].sourceExcerpt,
    sourcePassages.find((passage) => passage.id === firstSample.questions[0].sourcePassageId).text);

  const firstQuestion = firstSample.questions[0];
  assert.equal(firstQuestion.question, job.questions[firstQuestion.questionIndex - 1].question);
  assert.deepEqual(firstQuestion.options, job.questions[firstQuestion.questionIndex - 1].options);
  assert.equal(firstQuestion.correctAnswer, job.questions[firstQuestion.questionIndex - 1].answer);
  assert.equal(firstQuestion.explanation, job.questions[firstQuestion.questionIndex - 1].explanation);

  manager.saveReview(generationId, {
    questionId: firstQuestion.questionId,
    decision: 'pass',
    comment: 'First decision'
  });
  manager.saveReview(generationId, {
    questionId: firstQuestion.questionId,
    decision: 'fail',
    comment: 'Edited before finalization'
  });
  assert.equal(manager.getSample(generationId).reviewedCount, 1);
  assert.deepEqual(manager.getSample(generationId).questions[0].review, {
    decision: 'fail',
    comment: 'Edited before finalization',
    reviewedAt: 1_700_000_000_000
  });
  assert.throws(() => manager.getComparison(generationId), (error) => (
    error instanceof HumanReviewError && error.code === 'REVIEW_NOT_FINALIZED'
  ));
  assert.throws(() => manager.finalize(generationId), (error) => (
    error instanceof HumanReviewError && error.code === 'REVIEW_INCOMPLETE' && error.reviewedCount === 1
  ));

  for (const item of firstSample.questions.slice(1)) {
    manager.saveReview(generationId, {
      questionId: item.questionId,
      decision: item.questionIndex % 2 === 0 ? 'pass' : 'fail',
      comment: ''
    });
  }
  assert.equal(manager.getSample(generationId).reviewedCount, 20);
  assert.throws(() => manager.getComparison(generationId), (error) => (
    error instanceof HumanReviewError && error.code === 'REVIEW_NOT_FINALIZED'
  ));

  const comparison = manager.finalize(generationId);
  assert.equal(comparison.comparisons.length, 20);
  assert.equal(comparison.metrics.reviewedCount, 20);
  assert.equal(manager.getSample(generationId).finalized, true);
  assert.throws(() => manager.saveReview(generationId, {
    questionId: firstQuestion.questionId,
    decision: 'pass',
    comment: ''
  }), (error) => error.code === 'REVIEW_FINALIZED');
  assert.deepEqual(job.questions, originalQuestions);
  assert.deepEqual(job.evaluation.results, originalAiEvaluations);
});

test('agreement metrics use only completed paired decisions and calculate the confusion matrix and kappa', () => {
  const metrics = calculateAgreementMetrics([
    { aiDecision: 'pass', humanDecision: 'pass' },
    { aiDecision: 'fail', humanDecision: 'pass' },
    { aiDecision: 'pass', humanDecision: 'fail' },
    { aiDecision: 'fail', humanDecision: 'fail' },
    { aiDecision: 'pass', humanDecision: null },
    { aiDecision: null, humanDecision: 'pass' }
  ]);

  assert.equal(metrics.reviewedCount, 4);
  assert.equal(metrics.agreementPercentage, 50);
  assert.deepEqual(metrics.confusionMatrix, {
    humanPass: { aiPass: 1, aiFail: 1 },
    humanFail: { aiPass: 1, aiFail: 1 }
  });
  assert.equal(metrics.cohensKappa, 0);
  assert.equal(metrics.kappaDefined, true);
});

test('returns undefined Cohen kappa when expected agreement is 100 percent', () => {
  const metrics = calculateAgreementMetrics([
    { aiDecision: 'pass', humanDecision: 'pass' },
    { aiDecision: 'pass', humanDecision: 'pass' }
  ]);

  assert.equal(metrics.agreementPercentage, 100);
  assert.equal(metrics.cohensKappa, null);
  assert.equal(metrics.kappaDefined, false);
  assert.match(metrics.kappaNote, /undefined/i);

  const noPairs = calculateAgreementMetrics([{ aiDecision: 'pass', humanDecision: null }]);
  assert.equal(noPairs.reviewedCount, 0);
  assert.equal(noPairs.agreementPercentage, null);
  assert.equal(noPairs.cohensKappa, null);
});

test('exports paired judgments, comments, source IDs, and metrics as CSV', () => {
  const comparison = {
    metrics: {
      reviewedCount: 20,
      agreementPercentage: 85,
      cohensKappa: 0.7,
      kappaDefined: true,
      confusionMatrix: {
        humanPass: { aiPass: 10, aiFail: 1 },
        humanFail: { aiPass: 2, aiFail: 7 }
      }
    },
    comparisons: [{
      questionId: 'Q-001',
      questionIndex: 1,
      kind: 'multiple_choice',
      question: '=SUM(1,1)',
      sourcePassageId: 'passage-01',
      aiDecision: 'pass',
      humanDecision: 'fail',
      comment: 'Needs review, "again"',
      agreement: false
    }]
  };
  const csv = createHumanReviewCsv(comparison);

  assert.match(csv, /"Question ID","Question number"/);
  assert.match(csv, /Q-001/);
  assert.match(csv, /passage-01/);
  assert.match(csv, /"'=SUM\(1,1\)"/);
  assert.match(csv, /Needs review, ""again""/);
  assert.match(csv, /85/);
  assert.match(csv, /0\.7/);
});

test('reports an unavailable in-memory generation session clearly', () => {
  const manager = createHumanReviewManager({
    getJob: () => undefined,
    getSourcePassages: () => [],
    pruneJobs: () => {}
  });

  assert.throws(() => manager.getSample('expired-human-review-001'), (error) => (
    error instanceof HumanReviewError &&
    error.code === 'SESSION_UNAVAILABLE' &&
    /in-memory question session is unavailable/i.test(error.message)
  ));
});

test('human-review endpoints expose only server-selected judgments and paired comparisons', async (t) => {
  const calls = [];
  const server = createApp({
    humanReviewSampleReader: (generationId) => {
      calls.push(['sample', generationId]);
      return { reviewedCount: 0, questions: [{ questionId: 'Q-001' }] };
    },
    humanReviewSaver: (generationId, review) => {
      calls.push(['save', generationId, review]);
      return { reviewedCount: 1 };
    },
    humanReviewFinalizer: (generationId) => {
      calls.push(['finalize', generationId]);
      return { metrics: { reviewedCount: 20 } };
    },
    humanReviewComparisonReader: (generationId) => {
      calls.push(['comparison', generationId]);
      return {
        metrics: {
          reviewedCount: 20,
          agreementPercentage: 80,
          cohensKappa: 0.6,
          kappaDefined: true,
          confusionMatrix: {
            humanPass: { aiPass: 10, aiFail: 2 },
            humanFail: { aiPass: 2, aiFail: 6 }
          }
        },
        comparisons: [{
          questionId: 'Q-001',
          questionIndex: 1,
          kind: 'multiple_choice',
          question: 'Sample question?',
          sourcePassageId: 'passage-01',
          aiDecision: 'pass',
          humanDecision: 'pass',
          comment: '',
          agreement: true
        }]
      };
    }
  }).listen(0);
  await once(server, 'listening');
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/human-review`;

  try {
    const sampleResponse = await fetch(`${baseUrl}/sample?generationId=human-review-test-0001`);
    assert.equal(sampleResponse.status, 200);
    assert.deepEqual(await sampleResponse.json(), { reviewedCount: 0, questions: [{ questionId: 'Q-001' }] });

    const saveResponse = await fetch(`${baseUrl}/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        generationId: 'human-review-test-0001',
        questionId: 'Q-001',
        decision: 'fail',
        comment: 'Reviewer comment',
        aiDecision: 'pass',
        sourceExcerpt: 'Untrusted client excerpt'
      })
    });

    await t.test('withholds AI judgments from evaluation APIs until human review is finalized', async () => {
      const server = createApp({
        evaluationRunner: async () => ({
          results: [{ questionIndex: 1, decision: 'pass' }],
          summary: { evaluatedCount: 40, passedCount: 32 }
        }),
        evaluationStatusReader: () => ({
          humanReviewFinalized: false,
          evaluatedCount: 40,
          totalEvaluations: 40,
          summary: null
        }),
        evaluationResultsReader: () => {
          throw new QuestionEvaluationError('AI results are still blinded.', 409, 'HUMAN_REVIEW_REQUIRED');
        }
      }).listen(0);
      await once(server, 'listening');
      const baseUrl = `http://127.0.0.1:${server.address().port}/api`;

      try {
        const runResponse = await fetch(`${baseUrl}/evaluation/run`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ generationId: 'blinded-evaluation-0001' })
        });
        const runData = await runResponse.json();
        assert.equal(runData.heldForHumanReview, true);
        assert.equal(runData.evaluatedCount, 40);
        assert.equal(Object.hasOwn(runData, 'results'), false);
        assert.equal(Object.hasOwn(runData, 'summary'), false);

        const resultsResponse = await fetch(
          `${baseUrl}/evaluation/results?generationId=blinded-evaluation-0001`
        );
        assert.equal(resultsResponse.status, 409);
        assert.equal((await resultsResponse.json()).error, 'AI results are still blinded.');
      } finally {
        server.close();
        await once(server, 'close');
      }
    });
    assert.equal(saveResponse.status, 200);

    const finalizeResponse = await fetch(`${baseUrl}/finalize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ generationId: 'human-review-test-0001' })
    });
    assert.equal(finalizeResponse.status, 200);

    const comparisonResponse = await fetch(`${baseUrl}/comparison?generationId=human-review-test-0001`);
    assert.equal(comparisonResponse.status, 200);

    const exportResponse = await fetch(`${baseUrl}/export?generationId=human-review-test-0001`);
    assert.equal(exportResponse.status, 200);
    assert.match(exportResponse.headers.get('content-type'), /text\/csv/);
    assert.match(await exportResponse.text(), /Source passage ID/);
  } finally {
    server.close();
    await once(server, 'close');
  }

  assert.deepEqual(calls, [
    ['sample', 'human-review-test-0001'],
    ['save', 'human-review-test-0001', {
      questionId: 'Q-001',
      decision: 'fail',
      comment: 'Reviewer comment'
    }],
    ['finalize', 'human-review-test-0001'],
    ['comparison', 'human-review-test-0001'],
    ['comparison', 'human-review-test-0001']
  ]);
});
