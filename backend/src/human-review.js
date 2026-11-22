import { createHash } from 'node:crypto';

const REVIEW_SAMPLE_COUNTS = {
  multiple_choice: 15,
  short_answer: 5
};
const HUMAN_REVIEW_SAMPLE_SIZE = 20;

export class HumanReviewError extends Error {
  constructor(message, status = 400, code = 'HUMAN_REVIEW_FAILED', details = {}) {
    super(message);
    this.name = 'HumanReviewError';
    this.status = status;
    this.code = code;
    Object.assign(this, details);
  }
}

function createSeededRandom(seed) {
  let state = createHash('sha256').update(seed).digest().readUInt32LE(0);
  return () => {
    state = (state + 0x6D2B79F5) | 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function seededShuffle(items, seed) {
  const shuffled = [...items];
  const random = createSeededRandom(seed);
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

export function createStratifiedReviewSample(questions, seed) {
  const sample = [];
  for (const [kind, targetCount] of Object.entries(REVIEW_SAMPLE_COUNTS)) {
    const groups = new Map();
    questions.forEach((question, offset) => {
      if (question.kind !== kind) return;
      const questionIndex = offset + 1;
      const questionId = `Q-${String(questionIndex).padStart(3, '0')}`;
      const sourcePassageId = question.sourcePassageId || 'unassigned';
      if (!groups.has(sourcePassageId)) groups.set(sourcePassageId, []);
      groups.get(sourcePassageId).push({ questionIndex, questionId, sourcePassageId });
    });

    const passageIds = seededShuffle([...groups.keys()], `${seed}:${kind}:passages`);
    const passageQueues = passageIds.map((passageId) => seededShuffle(
      groups.get(passageId),
      `${seed}:${kind}:${passageId}`
    ));
    let selectedCount = 0;
    while (selectedCount < targetCount) {
      let selectedThisRound = false;
      for (const queue of passageQueues) {
        const candidate = queue.shift();
        if (!candidate) continue;
        sample.push(candidate);
        selectedCount += 1;
        selectedThisRound = true;
        if (selectedCount === targetCount) break;
      }
      if (!selectedThisRound) {
        throw new HumanReviewError(
          `The generated set does not contain ${targetCount} ${kind === 'multiple_choice' ? 'multiple-choice' : 'short-answer'} questions.`,
          409,
          'INVALID_QUESTION_SET'
        );
      }
    }
  }

  return sample.sort((left, right) => left.questionIndex - right.questionIndex);
}

export function calculateAgreementMetrics(comparisons) {
  const pairs = comparisons.filter((comparison) => (
    ['pass', 'fail'].includes(comparison.aiDecision) &&
    ['pass', 'fail'].includes(comparison.humanDecision)
  ));
  const reviewedCount = pairs.length;
  const confusionMatrix = {
    humanPass: {
      aiPass: pairs.filter((pair) => pair.humanDecision === 'pass' && pair.aiDecision === 'pass').length,
      aiFail: pairs.filter((pair) => pair.humanDecision === 'pass' && pair.aiDecision === 'fail').length
    },
    humanFail: {
      aiPass: pairs.filter((pair) => pair.humanDecision === 'fail' && pair.aiDecision === 'pass').length,
      aiFail: pairs.filter((pair) => pair.humanDecision === 'fail' && pair.aiDecision === 'fail').length
    }
  };
  const agreements = confusionMatrix.humanPass.aiPass + confusionMatrix.humanFail.aiFail;
  const aiPassCount = confusionMatrix.humanPass.aiPass + confusionMatrix.humanFail.aiPass;
  const aiFailCount = confusionMatrix.humanPass.aiFail + confusionMatrix.humanFail.aiFail;
  const humanPassCount = confusionMatrix.humanPass.aiPass + confusionMatrix.humanPass.aiFail;
  const humanFailCount = confusionMatrix.humanFail.aiPass + confusionMatrix.humanFail.aiFail;
  const observedAgreement = reviewedCount ? agreements / reviewedCount : null;
  const expectedAgreement = reviewedCount
    ? ((humanPassCount / reviewedCount) * (aiPassCount / reviewedCount)) +
      ((humanFailCount / reviewedCount) * (aiFailCount / reviewedCount))
    : null;
  const kappaDenominator = expectedAgreement === null ? 0 : 1 - expectedAgreement;
  const cohensKappa = !reviewedCount || Math.abs(kappaDenominator) < Number.EPSILON
    ? null
    : Number(((observedAgreement - expectedAgreement) / kappaDenominator).toFixed(4));

  return {
    reviewedCount,
    agreementPercentage: reviewedCount
      ? Number(((agreements / reviewedCount) * 100).toFixed(1))
      : null,
    confusionMatrix,
    cohensKappa,
    kappaDefined: cohensKappa !== null,
    kappaNote: cohensKappa === null
      ? 'Cohen’s kappa is undefined when expected agreement is 100% or no paired reviews are available.'
      : null
  };
}

function csvCell(value) {
  const text = String(value ?? '');
  const safeText = /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safeText.replace(/"/g, '""')}"`;
}

export function createHumanReviewCsv(comparison) {
  const { metrics } = comparison;
  const headers = [
    'Question ID',
    'Question number',
    'Question type',
    'Question',
    'Source passage ID',
    'AI decision',
    'Human decision',
    'Reviewer comment',
    'Agreement',
    'Agreement percentage',
    'Cohen kappa',
    'Kappa defined',
    'Human Pass / AI Pass',
    'Human Pass / AI Fail',
    'Human Fail / AI Pass',
    'Human Fail / AI Fail'
  ];
  const rows = comparison.comparisons.map((item) => [
    item.questionId,
    item.questionIndex,
    item.kind,
    item.question,
    item.sourcePassageId,
    item.aiDecision,
    item.humanDecision,
    item.comment,
    item.agreement ? 'yes' : 'no',
    metrics.agreementPercentage,
    metrics.cohensKappa,
    metrics.kappaDefined ? 'yes' : 'no',
    metrics.confusionMatrix.humanPass.aiPass,
    metrics.confusionMatrix.humanPass.aiFail,
    metrics.confusionMatrix.humanFail.aiPass,
    metrics.confusionMatrix.humanFail.aiFail
  ]);
  return `\uFEFF${[headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')}`;
}

function cloneReview(review) {
  return review ? { decision: review.decision, comment: review.comment, reviewedAt: review.reviewedAt } : null;
}

export function createHumanReviewManager({ getJob, getSourcePassages, pruneJobs, now = () => Date.now() }) {
  function getReadyJob(generationId) {
    if (typeof generationId !== 'string' || !/^[A-Za-z0-9-]{16,64}$/.test(generationId)) {
      throw new HumanReviewError('A valid generation ID is required for human review.', 400, 'INVALID_GENERATION_ID');
    }
    pruneJobs();
    const job = getJob(generationId);
    if (!job) {
      throw new HumanReviewError(
        'This in-memory question session is unavailable. Generate the question set and AI evaluation again.',
        404,
        'SESSION_UNAVAILABLE'
      );
    }
    if (!job.completed || job.questions.length !== 40 ||
      !job.evaluation?.completed || job.evaluation.results.length !== 40) {
      throw new HumanReviewError(
        'Complete AI evaluation for all 40 questions before starting human review.',
        409,
        'AI_EVALUATION_NOT_READY'
      );
    }
    return job;
  }

  function getOrCreateReviewState(job) {
    if (job.humanReview) return job.humanReview;

    const seed = createHash('sha256')
      .update(`human-review-v1:${job.inputHash}`)
      .digest('hex');
    const selectedQuestions = createStratifiedReviewSample(job.questions, seed);
    const passagesById = new Map(getSourcePassages(job).map((passage) => [passage.id, passage]));
    const items = selectedQuestions.map(({ questionIndex, questionId, sourcePassageId }) => {
      const question = job.questions[questionIndex - 1];
      const passage = passagesById.get(sourcePassageId);
      if (!passage) {
        throw new HumanReviewError(
          'A selected question references an unavailable source passage. Regenerate the question set.',
          409,
          'SOURCE_PASSAGE_MISSING'
        );
      }
      return {
        questionId,
        questionIndex,
        kind: question.kind,
        question: question.question,
        options: [...question.options],
        correctAnswer: question.answer,
        explanation: question.explanation,
        sourcePassageId: passage.id,
        sourceReference: question.sourceReference,
        sourceExcerpt: passage.text
      };
    });

    job.humanReview = {
      seed,
      selectedQuestionIds: items.map((item) => item.questionId),
      items,
      reviews: new Map(),
      finalizedAt: null
    };
    job.updatedAt = now();
    return job.humanReview;
  }

  function getSample(generationId) {
    const job = getReadyJob(generationId);
    const review = getOrCreateReviewState(job);
    return {
      seed: review.seed,
      selectedQuestionIds: [...review.selectedQuestionIds],
      reviewedCount: review.reviews.size,
      totalQuestions: HUMAN_REVIEW_SAMPLE_SIZE,
      finalized: Boolean(review.finalizedAt),
      questions: review.items.map((item) => ({
        ...item,
        options: [...item.options],
        review: cloneReview(review.reviews.get(item.questionId))
      }))
    };
  }

  function saveReview(generationId, { questionId, decision, comment = '' }) {
    const job = getReadyJob(generationId);
    const review = getOrCreateReviewState(job);
    if (review.finalizedAt) {
      throw new HumanReviewError('Human reviews are locked after finalization.', 409, 'REVIEW_FINALIZED');
    }
    const sampleItem = review.items.find((item) => item.questionId === questionId);
    if (!sampleItem) {
      throw new HumanReviewError('That question is not part of this review sample.', 404, 'QUESTION_NOT_IN_SAMPLE');
    }
    if (!['pass', 'fail'].includes(decision)) {
      throw new HumanReviewError('Choose Pass or Fail before saving this review.', 400, 'INVALID_DECISION');
    }
    if (typeof comment !== 'string' || comment.length > 2000) {
      throw new HumanReviewError('Reviewer comments must be 2,000 characters or fewer.', 400, 'INVALID_COMMENT');
    }

    review.reviews.set(questionId, {
      decision,
      comment: comment.trim(),
      reviewedAt: now()
    });
    job.updatedAt = now();
    return {
      questionId,
      decision,
      comment: comment.trim(),
      reviewedCount: review.reviews.size,
      totalQuestions: HUMAN_REVIEW_SAMPLE_SIZE
    };
  }

  function getComparison(generationId) {
    const job = getReadyJob(generationId);
    const review = getOrCreateReviewState(job);
    if (!review.finalizedAt) {
      throw new HumanReviewError(
        'Submit all 20 human reviews and finalize them before viewing AI–human comparisons.',
        409,
        'REVIEW_NOT_FINALIZED',
        { reviewedCount: review.reviews.size, totalQuestions: HUMAN_REVIEW_SAMPLE_SIZE }
      );
    }
    if (review.reviews.size !== HUMAN_REVIEW_SAMPLE_SIZE) {
      throw new HumanReviewError(
        'All 20 questions must have a saved Pass or Fail judgment before comparison.',
        409,
        'REVIEW_INCOMPLETE',
        { reviewedCount: review.reviews.size, totalQuestions: HUMAN_REVIEW_SAMPLE_SIZE }
      );
    }

    const aiByQuestionIndex = new Map(
      job.evaluation.results.map((result) => [result.questionIndex, result])
    );
    const comparisons = review.items.map((item) => {
      const humanReview = review.reviews.get(item.questionId);
      const aiResult = aiByQuestionIndex.get(item.questionIndex);
      if (!aiResult || !humanReview) {
        throw new HumanReviewError('A paired judgment is missing. Re-run the evaluations before comparing.', 409, 'PAIRED_RESULT_MISSING');
      }
      return {
        questionId: item.questionId,
        questionIndex: item.questionIndex,
        kind: item.kind,
        question: item.question,
        sourcePassageId: item.sourcePassageId,
        humanDecision: humanReview.decision,
        aiDecision: aiResult.decision,
        comment: humanReview.comment,
        agreement: humanReview.decision === aiResult.decision
      };
    });
    const metrics = calculateAgreementMetrics(comparisons);
    return {
      seed: review.seed,
      selectedQuestionIds: [...review.selectedQuestionIds],
      finalizedAt: review.finalizedAt,
      metrics,
      comparisons
    };
  }

  function finalize(generationId) {
    const job = getReadyJob(generationId);
    const review = getOrCreateReviewState(job);
    if (review.reviews.size !== HUMAN_REVIEW_SAMPLE_SIZE) {
      throw new HumanReviewError(
        'Save a Pass or Fail judgment for each of the 20 sampled questions before finalizing.',
        409,
        'REVIEW_INCOMPLETE',
        { reviewedCount: review.reviews.size, totalQuestions: HUMAN_REVIEW_SAMPLE_SIZE }
      );
    }
    if (!review.finalizedAt) {
      review.finalizedAt = now();
      job.updatedAt = now();
    }
    return getComparison(generationId);
  }

  return { getSample, saveReview, getComparison, finalize };
}
