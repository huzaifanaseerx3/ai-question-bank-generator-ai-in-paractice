import { useEffect, useState } from 'react';
import { NavLink, Route, Routes, useLocation } from 'react-router-dom';

const navigation = [
  { label: 'Dashboard', path: '/', icon: '⌂' },
  { label: 'Upload materials', path: '/upload', icon: '↑' },
  { label: 'Question bank', path: '/question-bank', icon: '▤' },
  { label: 'Evaluation', path: '/evaluation', icon: '✓' },
  { label: 'Human review', path: '/human-review', icon: '✎' }
];

const pageDetails = {
  '/': { title: 'Dashboard', eyebrow: 'OVERVIEW' },
  '/upload': { title: 'Upload materials', eyebrow: 'CONTENT LIBRARY' },
  '/question-bank': { title: 'Question bank', eyebrow: 'YOUR QUESTIONS' },
  '/evaluation': { title: 'Evaluation', eyebrow: 'PERFORMANCE' },
  '/human-review': { title: 'Human review', eyebrow: 'BLINDED REVIEW' }
};

function App() {
  const [connection, setConnection] = useState('checking');
  const [questionBank, setQuestionBank] = useState([]);
  const [questionSource, setQuestionSource] = useState('');
  const [generationId, setGenerationId] = useState(null);
  const [evaluation, setEvaluation] = useState(null);
  const [humanReviewFinalized, setHumanReviewFinalized] = useState(false);
  const location = useLocation();
  const currentPage = pageDetails[location.pathname] || pageDetails['/'];

  useEffect(() => {
    const controller = new AbortController();
    const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3001';

    fetch(`${apiUrl}/api/health`, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error('Health check failed');
        return response.json();
      })
      .then((data) => setConnection(data.status === 'ok' ? 'connected' : 'disconnected'))
      .catch((error) => {
        if (error.name !== 'AbortError') setConnection('disconnected');
      });

    return () => controller.abort();
  }, []);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <NavLink className="brand" to="/" aria-label="AI Question Bank Generator home">
          <span className="brand-mark">Q</span>
          <span className="brand-name">question<span>bank</span></span>
        </NavLink>

        <div className="workspace-label">WORKSPACE</div>
        <nav className="navigation" aria-label="Main navigation">
          {navigation.map((item) => (
            <NavLink
              className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
              end={item.path === '/'}
              key={item.path}
              to={item.path}
              title={item.label}
            >
              <span className="nav-icon" aria-hidden="true">{item.icon}</span>
              {item.label}
              {item.path === '/question-bank' && <span className="nav-count">{questionBank.length}</span>}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="help-card">
            <span className="help-icon">✦</span>
            <strong>Your learning space</strong>
            <p>A focused place to turn study materials into knowledge.</p>
          </div>
          <div className="profile">
            <div className="avatar">QB</div>
            <div><strong>My workspace</strong><span>Personal plan</span></div>
            <span className="profile-menu" aria-hidden="true">···</span>
          </div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumbs"><span>Workspace</span><span className="crumb-slash">/</span><strong>{currentPage.title}</strong></div>
          <div className="topbar-right">
            <div className={`connection-status ${connection}`} role="status">
              <span className="status-dot" />
              {connection === 'checking' ? 'Connecting…' : connection === 'connected' ? 'API connected' : 'API unavailable'}
            </div>
            <button className="icon-button notification-button" aria-label="Notifications">♧<span /></button>
            <div className="top-avatar">QB</div>
          </div>
        </header>

        <div className="page-content">
          <Routes>
            <Route path="/" element={<Dashboard questionCount={questionBank.length} />} />
            <Route path="/upload" element={<UploadPage onQuestionsGenerated={(questions, filename, id) => {
              setQuestionBank(questions);
              setQuestionSource(filename);
              setGenerationId(id);
              setEvaluation(null);
              setHumanReviewFinalized(false);
            }} />} />
            <Route path="/question-bank" element={<QuestionBankPage questions={questionBank} sourceFilename={questionSource} />} />
            <Route path="/evaluation" element={(
              <EvaluationPage
                evaluation={evaluation}
                generationId={generationId}
                humanReviewFinalized={humanReviewFinalized}
                onEvaluationUpdate={setEvaluation}
                questions={questionBank}
              />
            )} />
            <Route path="/human-review" element={(
              <HumanReviewPage
                generationId={generationId}
                onFinalized={setHumanReviewFinalized}
                questionCount={questionBank.length}
              />
            )} />
            <Route path="*" element={<Dashboard />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}

function PageHeading({ eyebrow, title, description, children }) {
  return (
    <div className="page-heading">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {children && <div className="heading-actions">{children}</div>}
    </div>
  );
}

function Dashboard({ questionCount }) {
  return (
    <>
      <PageHeading eyebrow="YOUR STUDY SPACE" title="Good morning, learner" description="Your study space is ready. Here's a snapshot of your progress." />
      <section className="welcome-banner">
        <div className="welcome-copy">
          <span className="banner-kicker">A LITTLE PROGRESS, EVERY DAY</span>
          <h2>Make your next study session count.</h2>
          <p>Start by adding your learning materials. Your question bank will grow from there.</p>
          <NavLink to="/upload" className="button button-light">Upload materials <span aria-hidden="true">→</span></NavLink>
        </div>
        <div className="banner-art" aria-hidden="true">
          <div className="orbit orbit-one" /><div className="orbit orbit-two" />
          <div className="book-illustration"><span /><span /><span /></div>
          <div className="sparkle sparkle-one">✦</div><div className="sparkle sparkle-two">✧</div>
        </div>
      </section>

      <div className="section-title-row"><div><h2>Your overview</h2><p>A quick look at your study workspace</p></div><button className="period-select">All time <span>⌄</span></button></div>
      <section className="stats-grid" aria-label="Workspace statistics">
        <StatCard label="Study materials" value="0" note="Ready when you are" icon="▧" tone="blue" />
        <StatCard label="Questions created" value={questionCount} note="Your bank starts here" icon="☷" tone="purple" />
        <StatCard label="Evaluations" value="0" note="Track your progress" icon="◉" tone="green" />
      </section>

      <section className="lower-grid">
        <div className="panel activity-panel">
          <div className="panel-heading"><div><h2>Recent activity</h2><p>Your latest workspace updates</p></div><button className="text-button">View all <span>→</span></button></div>
          <div className="empty-activity"><div className="empty-icon">◷</div><strong>No activity yet</strong><p>Once you add materials, your recent activity will show up here.</p><NavLink to="/upload">Add your first material <span>→</span></NavLink></div>
        </div>
        <div className="panel getting-started">
          <div className="panel-heading"><div><h2>Getting started</h2><p>Your first steps</p></div><span className="step-count">0 of 3</span></div>
          <div className="checklist">
            <ChecklistItem number="01" title="Add a study material" description="Upload a file to your workspace" to="/upload" />
            <ChecklistItem number="02" title="Build your question bank" description="Keep your questions organized" to="/question-bank" />
            <ChecklistItem number="03" title="Review your progress" description="See how your learning adds up" to="/evaluation" last />
          </div>
        </div>
      </section>
    </>
  );
}

function StatCard({ label, value, note, icon, tone }) {
  return <article className="stat-card"><div className={`stat-icon ${tone}`}>{icon}</div><span className="stat-label">{label}</span><strong className="stat-value">{value}</strong><span className="stat-note">{note}</span></article>;
}

function ChecklistItem({ number, title, description, to, last }) {
  return <NavLink className={`checklist-item${last ? ' last' : ''}`} to={to}><span className="check-number">{number}</span><span className="check-copy"><strong>{title}</strong><span>{description}</span></span><span className="check-arrow">→</span></NavLink>;
}

function UploadPage({ onQuestionsGenerated }) {
  const [file, setFile] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState('');
  const [generationError, setGenerationError] = useState('');
  const [generationComplete, setGenerationComplete] = useState(false);
  const [generationId, setGenerationId] = useState(null);
  const [result, setResult] = useState(null);
  const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3001';

  function selectFile(selectedFile) {
    if (!selectedFile) return;
    setResult(null);
    setError('');
    setGenerationError('');
    setGenerationComplete(false);
    setGenerationId(null);

    if (!selectedFile.name.toLowerCase().endsWith('.pdf')) {
      setFile(null);
      setError('Please choose a PDF file.');
      return;
    }

    if (selectedFile.size > 15 * 1024 * 1024) {
      setFile(null);
      setError('This file is too large. Choose a PDF that is 15 MB or smaller.');
      return;
    }

    setFile(selectedFile);
  }

  async function handleUpload(event) {
    event.preventDefault();
    if (!file || isUploading) return;

    setIsUploading(true);
    setError('');
    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await fetch(`${apiUrl}/api/upload`, { method: 'POST', body: formData });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'The PDF could not be processed.');
      setResult(data);
    } catch (uploadError) {
      setError(uploadError instanceof TypeError
        ? 'Could not connect to the server. Check that the backend is running and try again.'
        : uploadError.message);
    } finally {
      setIsUploading(false);
    }
  }

  async function handleGenerateQuestions() {
    if (!result?.text || isGenerating) return;

    const requestGenerationId = generationId || window.crypto.randomUUID();
    setGenerationId(requestGenerationId);
    setIsGenerating(true);
    setGenerationError('');
    setGenerationComplete(false);

    try {
      const response = await fetch(`${apiUrl}/api/questions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: result.text, generationId: requestGenerationId })
      });
      const data = await response.json();
      if (!response.ok) {
        const resumeMessage = Number.isInteger(data.completedQuestions) && data.completedQuestions > 0
          ? ` ${data.completedQuestions} completed questions are being kept; retry will resume from the failed batch.`
          : '';
        throw new Error(`${data.error || 'Question generation failed. Please try again.'}${resumeMessage}`);
      }
      if (!Array.isArray(data.questions) || data.questions.length !== 40) {
        throw new Error('The server returned an incomplete question set. Please retry generation.');
      }

      onQuestionsGenerated(data.questions, result.filename, requestGenerationId);
      setGenerationComplete(true);
      setGenerationId(null);
    } catch (requestError) {
      setGenerationError(requestError instanceof TypeError
        ? 'Could not connect to the server. Check that the backend is running and retry.'
        : requestError.message);
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <>
      <PageHeading eyebrow="CONTENT LIBRARY" title="Upload materials" description="Bring your study resources together in one place." />
      <form className="panel upload-panel" onSubmit={handleUpload}>
        <div className="upload-illustration"><div className="upload-cloud">↑</div><span className="upload-file file-one">PDF</span><span className="upload-file file-two">DOC</span></div>
        <h2>Upload a lecture PDF</h2>
        <p>We’ll extract the selectable text and tell you how many pages it contains.</p>
        <div
          className={`upload-dropzone${isDragging ? ' dragging' : ''}`}
          onDragEnter={(event) => { event.preventDefault(); setIsDragging(true); }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setIsDragging(false);
          }}
          onDrop={(event) => {
            event.preventDefault();
            setIsDragging(false);
            selectFile(event.dataTransfer.files[0]);
          }}
        >
          <div className="drop-icon">＋</div>
          <strong>{file ? file.name : 'Drag and drop your PDF here'}</strong>
          <span>{file ? `${(file.size / (1024 * 1024)).toFixed(2)} MB` : 'PDF files up to 15 MB'}</span>
          <label className="button button-primary choose-file">
            Choose PDF
            <input
              accept=".pdf,application/pdf"
              className="file-input"
              onChange={(event) => {
                selectFile(event.target.files[0]);
                event.target.value = '';
              }}
              type="file"
            />
          </label>
        </div>
        {error && <div className="upload-error" role="alert">{error}</div>}
        {file && <button className="button button-primary submit-upload" disabled={isUploading} type="submit">{isUploading ? 'Extracting text…' : 'Extract text'}</button>}
      </form>
      {result && (
        <section className="panel extraction-result" aria-live="polite">
          <div className="result-heading">
            <div><div className="eyebrow">EXTRACTION COMPLETE</div><h2>{result.filename}</h2></div>
            <span className="page-count">{result.pages} {result.pages === 1 ? 'page' : 'pages'}</span>
          </div>
          <pre className="extracted-text">{result.text}</pre>
          <div className="generation-actions">
            <button className="button button-primary generate-button" disabled={isGenerating} onClick={handleGenerateQuestions} type="button">
              {isGenerating && <span className="loading-spinner" aria-hidden="true" />}
              {isGenerating ? 'Generating questions…' : generationError ? 'Retry generation' : generationComplete ? 'Generate again' : 'Generate 40 questions'}
            </button>
            {isGenerating && <span className="generation-note" role="status">Creating 30 multiple-choice and 10 short-answer questions. This may take a little while.</span>}
            {generationError && <p className="upload-error generation-error" role="alert">{generationError}</p>}
            {generationComplete && (
              <p className="generation-success" role="status">
                Questions are ready. <NavLink to="/question-bank">View question bank →</NavLink>
              </p>
            )}
          </div>
        </section>
      )}
    </>
  );
}

function QuestionBankPage({ questions, sourceFilename }) {
  if (questions.length) {
    return (
      <>
        <PageHeading
          eyebrow="YOUR QUESTIONS"
          title="Question bank"
          description={`${sourceFilename} · ${questions.length} questions`}
        >
          <NavLink to="/upload" className="button button-primary">Generate another set</NavLink>
        </PageHeading>
        <section className="question-counts" aria-label="Question counts">
          <span><strong>30</strong> Multiple choice</span>
          <span><strong>10</strong> Short answer</span>
        </section>
        <section className="question-list" aria-label="Generated questions">
          {questions.map((question, index) => (
            <article className="panel question-card" key={`${question.kind}-${index}`}>
              <div className="question-card-heading">
                <span className="question-number">Question {String(index + 1).padStart(2, '0')}</span>
                <span className={`question-kind ${question.kind}`}>{question.kind === 'multiple_choice' ? 'Multiple choice' : 'Short answer'}</span>
              </div>
              <h2>{question.question}</h2>
              {question.kind === 'multiple_choice' && (
                <ol className="answer-options" type="A">
                  {question.options.map((option, optionIndex) => (
                    <li className={option === question.answer ? 'correct-option' : ''} key={`${optionIndex}-${option}`}>
                      <span>{option}</span>
                      {option === question.answer && <span className="correct-label">Correct answer</span>}
                    </li>
                  ))}
                </ol>
              )}
              {question.kind === 'short_answer' && (
                <div className="short-answer"><span>Answer</span><strong>{question.answer}</strong></div>
              )}
              <p className="question-explanation"><strong>Explanation</strong>{question.explanation}</p>
              <blockquote className="question-evidence">
                <span>From {question.sourceReference}</span>
                <p>“{question.sourceExcerpt}”</p>
              </blockquote>
            </article>
          ))}
        </section>
      </>
    );
  }

  return (
    <>
      <PageHeading eyebrow="YOUR QUESTIONS" title="Question bank" description="A home for the questions you’ll build from your study materials." />
      <section className="panel empty-page-panel">
        <div className="empty-page-icon purple-icon">☷</div>
        <h2>Your question bank is empty</h2>
        <p>Upload a lecture PDF and generate a grounded set of 40 questions to see them here.</p>
        <NavLink to="/upload" className="button button-primary">Go to materials <span>→</span></NavLink>
      </section>
    </>
  );
}

const evaluationCriteria = [
  ['answerCorrectness', 'Answer correctness'],
  ['questionClarity', 'Question clarity'],
  ['lectureGrounding', 'Lecture grounding'],
  ['explanationQuality', 'Explanation quality']
];

function summarizeEvaluationResults(results) {
  const evaluatedCount = results.length;
  const passedCount = results.filter((result) => result.decision === 'pass').length;
  const averageScores = Object.fromEntries(evaluationCriteria.map(([key]) => [
    key,
    evaluatedCount
      ? Number((results.reduce((sum, result) => sum + result[key].score, 0) / evaluatedCount).toFixed(2))
      : null
  ]));
  return {
    evaluatedCount,
    passedCount,
    failedCount: evaluatedCount - passedCount,
    passRate: evaluatedCount ? Number(((passedCount / evaluatedCount) * 100).toFixed(1)) : 0,
    averageScores
  };
}

function csvCell(value) {
  const text = String(value ?? '');
  const safeText = /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safeText.replace(/"/g, '""')}"`;
}

function downloadEvaluationCsv(questions, results) {
  const resultByIndex = new Map(results.map((result) => [result.questionIndex, result]));
  const headers = [
    'Question number',
    'Question',
    'Marked answer',
    ...evaluationCriteria.flatMap(([, label]) => [`${label} score`, `${label} explanation`]),
    'Application decision',
    'AI judge explanation'
  ];
  const rows = questions.map((question, index) => {
    const result = resultByIndex.get(index + 1);
    return [
      index + 1,
      question.question,
      question.answer,
      ...evaluationCriteria.flatMap(([key]) => [result?.[key]?.score ?? '', result?.[key]?.explanation ?? '']),
      result?.decision ?? '',
      result?.overallExplanation ?? ''
    ];
  });
  const csv = [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'ai-question-evaluation.csv';
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function EvaluationPage({
  evaluation,
  generationId,
  humanReviewFinalized,
  onEvaluationUpdate,
  questions
}) {
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [isLoadingResults, setIsLoadingResults] = useState(false);
  const [error, setError] = useState('');
  const [progressCount, setProgressCount] = useState(0);
  const [progressSummary, setProgressSummary] = useState(null);
  const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3001';
  const results = evaluation?.results || [];
  const summary = (isEvaluating && progressSummary) ||
    evaluation?.summary || progressSummary || summarizeEvaluationResults(results);
  const isComplete = Boolean(evaluation?.completed) || results.length === 40;
  const isAiResultsVisible = humanReviewFinalized && results.length === 40;
  const passFailRule = evaluation?.passFailRule ||
    'Application decision (not a Gemini decision): Pass only when all four AI criterion scores are 3 or higher; otherwise fail.';

  useEffect(() => {
    setProgressCount(results.length);
    if (results.length) setProgressSummary(summarizeEvaluationResults(results));
  }, [results.length]);

  useEffect(() => {
    if (!generationId || !humanReviewFinalized || !evaluation?.completed || results.length === 40) return undefined;
    const controller = new AbortController();
    let active = true;

    async function loadAiResults() {
      setIsLoadingResults(true);
      setError('');
      try {
        const response = await fetch(
          `${apiUrl}/api/evaluation/results?generationId=${encodeURIComponent(generationId)}`,
          { signal: controller.signal }
        );
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Could not load AI evaluation results.');
        if (active) {
          onEvaluationUpdate({ ...data, completed: true });
          setProgressSummary(data.summary);
        }
      } catch (loadError) {
        if (active && loadError.name !== 'AbortError') setError(loadError.message);
      } finally {
        if (active) setIsLoadingResults(false);
      }
    }

    loadAiResults();
    return () => {
      active = false;
      controller.abort();
    };
  }, [apiUrl, evaluation?.completed, generationId, humanReviewFinalized, onEvaluationUpdate, results.length]);

  useEffect(() => {
    if (!isEvaluating || !generationId) return undefined;
    const controller = new AbortController();
    let active = true;

    async function refreshProgress() {
      try {
        const response = await fetch(
          `${apiUrl}/api/evaluation/status?generationId=${encodeURIComponent(generationId)}`,
          { signal: controller.signal }
        );
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Could not refresh evaluation progress.');
        if (active && Number.isInteger(data.evaluatedCount)) {
          setProgressCount(data.evaluatedCount);
          if (data.summary) setProgressSummary(data.summary);
        }
      } catch (progressError) {
        if (active && progressError.name !== 'AbortError') {
          setError(progressError instanceof TypeError
            ? 'Could not refresh evaluation progress. Check that the backend is running.'
            : progressError.message);
        }
      }
    }

    refreshProgress();
    const intervalId = window.setInterval(refreshProgress, 1000);
    return () => {
      active = false;
      controller.abort();
      window.clearInterval(intervalId);
    };
  }, [apiUrl, generationId, isEvaluating]);

  async function runEvaluation() {
    if (!generationId || questions.length !== 40 || isEvaluating || isComplete) return;
    setIsEvaluating(true);
    setProgressCount(results.length);
    setError('');

    try {
      const response = await fetch(`${apiUrl}/api/evaluation/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ generationId })
      });
      const data = await response.json();
      if (!response.ok) {
        const retryNote = Number.isInteger(data.retryAfterSeconds)
          ? ` Retry after ${data.retryAfterSeconds} seconds.`
          : '';
        throw new Error(`${data.error || 'AI evaluation failed. Please retry.'}${retryNote}`);
      }
      if (data.heldForHumanReview) {
        onEvaluationUpdate({
          completed: true,
          heldForHumanReview: true,
          results: []
        });
        setProgressCount(data.evaluatedCount);
      } else {
        onEvaluationUpdate({ ...data, completed: true });
        setProgressCount(data.results.length);
        setProgressSummary(data.summary);
      }
      setError('');
    } catch (requestError) {
      setError(requestError instanceof TypeError
        ? 'Could not connect to the server. Check that the backend is running and retry.'
        : requestError.message);
    } finally {
      setIsEvaluating(false);
    }
  }

  return (
    <>
      <PageHeading
        eyebrow="AI QUALITY JUDGMENTS"
        title="Evaluation"
        description="Review AI judgments of your generated questions against the original lecture."
      >
        {isComplete && generationId && <NavLink className="button button-outline" to="/human-review">Start human review</NavLink>}
        {isAiResultsVisible && <button className="button button-outline" onClick={() => downloadEvaluationCsv(questions, results)} type="button">Export CSV</button>}
        {!isComplete && questions.length === 40 && generationId && (
          <button className="button button-primary evaluation-run-button" disabled={isEvaluating} onClick={runEvaluation} type="button">
            {isEvaluating && <span className="loading-spinner" aria-hidden="true" />}
            {isEvaluating ? `Evaluating ${progressCount} of 40…` : error ? 'Retry evaluation' : results.length ? 'Continue evaluation' : 'Run AI evaluation'}
          </button>
        )}
      </PageHeading>
      <div className="ai-judgment-notice" role="note">
        These are AI judgments, not ground truth or human review. Verify important results against the source lecture.
      </div>
      <section className="evaluation-rule">
        <strong>Application pass/fail rule</strong>
        <span>Pass only when all four AI criterion scores are 3 or higher; otherwise fail. Gemini provides the scores and explanations, not this decision.</span>
      </section>
      {questions.length !== 40 || !generationId ? (
        <section className="panel empty-evaluation">
          <div className="empty-page-icon green-icon">◉</div>
          <h2>{questions.length === 40 ? 'Question set unavailable for evaluation' : 'Nothing to evaluate just yet'}</h2>
          <p>{questions.length === 40
            ? 'The server session for this question set is no longer available. Generate the questions again before evaluating.'
            : 'Generate a complete set of 40 questions before running the AI quality evaluation.'}</p>
          <NavLink to="/upload" className="button button-primary">Go to materials <span>→</span></NavLink>
        </section>
      ) : (
        <>
          {error && <div className="upload-error evaluation-error" role="alert">{error}</div>}
          {isComplete && !humanReviewFinalized && (
            <section className="panel ai-results-blinded">
              <div className="empty-page-icon purple-icon">◉</div>
              <h2>AI judgments are blinded for human review</h2>
              <p>The AI evaluation is complete. Its scores and Pass/Fail decisions are withheld until all 20 human judgments are submitted and finalized.</p>
              <NavLink to="/human-review" className="button button-primary">Begin human review <span>→</span></NavLink>
            </section>
          )}
          {isLoadingResults && <div className="evaluation-progress" role="status"><span className="loading-spinner" aria-hidden="true" />Loading AI judgments now that human review is finalized…</div>}
          {isEvaluating && (
            <div className="evaluation-progress" role="status">
              <span className="loading-spinner" aria-hidden="true" />
              <span>AI judging {progressCount} of 40 questions. Completed batches are kept if a later batch fails.</span>
              <div className="evaluation-progress-track" role="progressbar" aria-label="Evaluation progress" aria-valuemin="0" aria-valuemax="40" aria-valuenow={progressCount}>
                <span style={{ width: `${(progressCount / 40) * 100}%` }} />
              </div>
            </div>
          )}
          {isAiResultsVisible && <section className="evaluation-summary" aria-label="AI evaluation summary">
            <article className="panel evaluation-stat"><span>Evaluated</span><strong>{summary.evaluatedCount} / 40</strong></article>
            <article className="panel evaluation-stat"><span>Passed</span><strong className="pass-text">{summary.passedCount}</strong></article>
            <article className="panel evaluation-stat"><span>Failed</span><strong className="fail-text">{summary.failedCount}</strong></article>
            <article className="panel evaluation-stat"><span>Pass rate</span><strong>{summary.evaluatedCount ? `${summary.passRate}%` : '—'}</strong></article>
            {evaluationCriteria.map(([key, label]) => (
              <article className="panel evaluation-stat" key={key}>
                <span>Average · {label}</span>
                <strong>{summary.averageScores[key] ?? '—'} <small>/ 5</small></strong>
              </article>
            ))}
          </section>}
          {isAiResultsVisible && <section className="evaluation-table-wrap panel" aria-label="Question evaluation results">
            <table className="evaluation-table">
              <thead>
                <tr>
                  <th scope="col">Question</th>
                  {evaluationCriteria.map(([, label]) => <th scope="col" key={label}>{label}<span>AI score / explanation</span></th>)}
                  <th scope="col">Application result</th>
                  <th scope="col">AI judge explanation</th>
                </tr>
              </thead>
              <tbody>
                {questions.map((question, index) => {
                  const result = results.find((item) => item.questionIndex === index + 1);
                  return (
                    <tr key={`${question.kind}-${index}`}>
                      <th scope="row">
                        <span className="evaluation-question-number">Question {String(index + 1).padStart(2, '0')}</span>
                        <span className="evaluation-question-text">{question.question}</span>
                      </th>
                      {evaluationCriteria.map(([key]) => (
                        <td key={key}>
                          {result ? (
                            <>
                              <strong className="evaluation-score">{result[key].score}/5</strong>
                              <span className="evaluation-criterion-explanation">{result[key].explanation}</span>
                            </>
                          ) : <span className="not-evaluated">Not evaluated</span>}
                        </td>
                      ))}
                      <td>
                        {result
                          ? <span className={`decision-pill ${result.decision}`}>{result.decision === 'pass' ? 'Pass' : 'Fail'}</span>
                          : <span className="not-evaluated">—</span>}
                      </td>
                      <td>{result?.overallExplanation || <span className="not-evaluated">—</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>}
        </>
      )}
    </>
  );
}

function HumanReviewPage({ generationId, onFinalized, questionCount }) {
  const [sample, setSample] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [comparison, setComparison] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState('');
  const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3001';

  useEffect(() => {
    if (!generationId || questionCount !== 40) return undefined;
    const controller = new AbortController();
    let active = true;

    async function loadReviewSample() {
      setIsLoading(true);
      setError('');
      try {
        const response = await fetch(
          `${apiUrl}/api/human-review/sample?generationId=${encodeURIComponent(generationId)}`,
          { signal: controller.signal }
        );
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Could not load the review sample.');
        if (!active) return;
        setSample(data);
        setDrafts(Object.fromEntries(data.questions.map((item) => [
          item.questionId,
          {
            decision: item.review?.decision || '',
            comment: item.review?.comment || ''
          }
        ])));
        const firstUnreviewed = data.questions.findIndex((item) => !item.review);
        setCurrentIndex(firstUnreviewed < 0 ? 0 : firstUnreviewed);

        if (data.finalized) {
          const comparisonResponse = await fetch(
            `${apiUrl}/api/human-review/comparison?generationId=${encodeURIComponent(generationId)}`,
            { signal: controller.signal }
          );
          const comparisonData = await comparisonResponse.json();
          if (!comparisonResponse.ok) throw new Error(comparisonData.error || 'Could not load the final comparison.');
          if (active) {
            setComparison(comparisonData);
            onFinalized(true);
          }
        }
      } catch (loadError) {
        if (active && loadError.name !== 'AbortError') setError(loadError.message);
      } finally {
        if (active) setIsLoading(false);
      }
    }

    loadReviewSample();
    return () => {
      active = false;
      controller.abort();
    };
  }, [apiUrl, generationId, onFinalized, questionCount]);

  const currentQuestion = sample?.questions[currentIndex];
  const currentDraft = currentQuestion
    ? drafts[currentQuestion.questionId] || { decision: '', comment: '' }
    : { decision: '', comment: '' };
  const isComplete = sample?.reviewedCount === 20;

  function updateDraft(patch) {
    if (!currentQuestion) return;
    setDrafts((existing) => ({
      ...existing,
      [currentQuestion.questionId]: { ...currentDraft, ...patch }
    }));
  }

  async function saveCurrentReview() {
    if (!currentQuestion || !currentDraft.decision || isSaving || sample.finalized) return;
    setIsSaving(true);
    setError('');
    try {
      const response = await fetch(`${apiUrl}/api/human-review/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          generationId,
          questionId: currentQuestion.questionId,
          decision: currentDraft.decision,
          comment: currentDraft.comment
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not save this human judgment.');
      setSample((existing) => ({
        ...existing,
        reviewedCount: data.reviewedCount,
        questions: existing.questions.map((item) => (
          item.questionId === currentQuestion.questionId
            ? {
              ...item,
              review: {
                decision: data.decision,
                comment: data.comment,
                reviewedAt: new Date().toISOString()
              }
            }
            : item
        ))
      }));
      if (currentIndex < sample.questions.length - 1) setCurrentIndex((index) => index + 1);
    } catch (saveError) {
      setError(saveError instanceof TypeError
        ? 'Could not connect to the server. Your unsaved judgment is still on this page.'
        : saveError.message);
    } finally {
      setIsSaving(false);
    }
  }

  async function finalizeReview() {
    if (!isComplete || !generationId || isFinalizing || sample.finalized) return;
    setIsFinalizing(true);
    setError('');
    try {
      const response = await fetch(`${apiUrl}/api/human-review/finalize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ generationId })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not finalize the human review.');
      setComparison(data);
      setSample((existing) => ({ ...existing, finalized: true }));
      onFinalized(true);
    } catch (finalizeError) {
      setError(finalizeError instanceof TypeError
        ? 'Could not connect to the server. Retry finalization.'
        : finalizeError.message);
    } finally {
      setIsFinalizing(false);
    }
  }

  async function reloadFinalComparison() {
    setIsLoading(true);
    setError('');
    try {
      const response = await fetch(
        `${apiUrl}/api/human-review/comparison?generationId=${encodeURIComponent(generationId)}`
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not load the final comparison.');
      setComparison(data);
      onFinalized(true);
    } catch (loadError) {
      setError(loadError instanceof TypeError
        ? 'Could not connect to the server. Retry loading the comparison.'
        : loadError.message);
    } finally {
      setIsLoading(false);
    }
  }

  async function exportComparison() {
    if (!comparison || !generationId || isExporting) return;
    setIsExporting(true);
    setError('');
    try {
      const response = await fetch(
        `${apiUrl}/api/human-review/export?generationId=${encodeURIComponent(generationId)}`
      );
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Could not export the comparison.');
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = 'human-review-comparison.csv';
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (exportError) {
      setError(exportError instanceof TypeError
        ? 'Could not connect to the server. Retry the CSV export.'
        : exportError.message);
    } finally {
      setIsExporting(false);
    }
  }

  if (!generationId || questionCount !== 40) {
    return (
      <>
        <PageHeading eyebrow="BLINDED REVIEW" title="Human review" description="Review a reproducible sample of the generated question set." />
        <section className="panel empty-evaluation">
          <div className="empty-page-icon green-icon">✎</div>
          <h2>Generate and AI-evaluate a question set first</h2>
          <p>Human review requires the server-held 40-question set and its completed AI evaluation.</p>
          <NavLink to="/upload" className="button button-primary">Go to materials <span>→</span></NavLink>
        </section>
      </>
    );
  }

  if (isLoading) {
    return (
      <>
        <PageHeading eyebrow="BLINDED REVIEW" title="Human review" description="Loading your server-held review sample." />
        <div className="evaluation-progress" role="status"><span className="loading-spinner" aria-hidden="true" />Loading the review sample…</div>
      </>
    );
  }

  if (error && !sample) {
    return (
      <>
        <PageHeading eyebrow="BLINDED REVIEW" title="Human review" description="Review a reproducible sample of the generated question set." />
        <div className="upload-error human-review-error" role="alert">{error}</div>
        <p className="human-review-session-note">Review sessions are held in memory. If the server restarted or expired this session, generate the questions and AI evaluation again.</p>
        <NavLink to="/evaluation" className="button button-outline">Back to AI evaluation</NavLink>
      </>
    );
  }

  if (comparison) {
    const { metrics } = comparison;
    const disagreements = comparison.comparisons.filter((item) => !item.agreement);
    return (
      <>
        <PageHeading eyebrow="FINALIZED COMPARISON" title="AI–human agreement" description="Human judgments are locked; paired results are now visible.">
          <button className="button button-outline" disabled={isExporting} onClick={exportComparison} type="button">
            {isExporting ? 'Preparing CSV…' : 'Export paired CSV'}
          </button>
        </PageHeading>
        {error && <div className="upload-error human-review-error" role="alert">{error}</div>}
        <div className="ai-judgment-notice" role="note">AI labels are model judgments; human labels are the submitted reviewer decisions. Neither should be assumed to be ground truth.</div>
        <section className="human-review-metrics" aria-label="AI and human agreement metrics">
          <article className="panel evaluation-stat"><span>Paired judgments</span><strong>{metrics.reviewedCount} / 20</strong></article>
          <article className="panel evaluation-stat"><span>Agreement</span><strong>{metrics.agreementPercentage}%</strong></article>
          <article className="panel evaluation-stat"><span>Cohen’s kappa</span><strong>{metrics.kappaDefined ? metrics.cohensKappa : 'Undefined'}</strong></article>
        </section>
        {!metrics.kappaDefined && <p className="kappa-note">{metrics.kappaNote}</p>}
        <section className="panel confusion-panel">
          <h2>Confusion matrix</h2>
          <p>Rows are human judgments; columns are AI judgments.</p>
          <div className="confusion-table-wrap">
            <table className="confusion-table">
              <thead><tr><th scope="col">Human \ AI</th><th scope="col">AI Pass</th><th scope="col">AI Fail</th></tr></thead>
              <tbody>
                <tr><th scope="row">Human Pass</th><td>{metrics.confusionMatrix.humanPass.aiPass}</td><td>{metrics.confusionMatrix.humanPass.aiFail}</td></tr>
                <tr><th scope="row">Human Fail</th><td>{metrics.confusionMatrix.humanFail.aiPass}</td><td>{metrics.confusionMatrix.humanFail.aiFail}</td></tr>
              </tbody>
            </table>
          </div>
        </section>
        <section className="panel methodology-panel">
          <h2>Methodology</h2>
          <p>A stable content-derived seed selects 15 multiple-choice and 5 short-answer questions. Within each question type, selection is round-robin across source-passage groups. Agreement is the share of the 20 paired Pass/Fail decisions that match; Cohen’s kappa adjusts for chance agreement.</p>
        </section>
        <section className="panel disagreement-panel">
          <h2>Disagreements <span>{disagreements.length}</span></h2>
          {disagreements.length ? disagreements.map((item) => (
            <article className="disagreement-item" key={item.questionId}>
              <div><strong>{item.questionId} · Question {item.questionIndex}</strong><span>Source: {item.sourcePassageId}</span></div>
              <p>{item.question}</p>
              <div className="paired-decisions"><span className={`decision-pill ${item.aiDecision}`}>AI: {item.aiDecision}</span><span className={`decision-pill ${item.humanDecision}`}>Human: {item.humanDecision}</span></div>
              {item.comment && <p className="review-comment"><strong>Reviewer comment</strong>{item.comment}</p>}
            </article>
          )) : <p className="no-disagreements">All 20 paired decisions agree.</p>}
        </section>
        <NavLink to="/evaluation" className="button button-outline">Back to AI evaluation</NavLink>
      </>
    );
  }

  if (!sample) return null;
  const item = sample.questions[currentIndex];
  if (!item) return null;

  return (
    <>
      <PageHeading eyebrow="BLINDED HUMAN REVIEW" title="Review questions" description="Record an independent Pass or Fail decision for each sampled question. AI decisions remain hidden until finalization." />
      {error && <div className="upload-error human-review-error" role="alert">{error}</div>}
      <section className="human-review-progress panel" aria-label="Human review progress">
        <div><strong>{sample.reviewedCount} / 20 reviewed</strong><span>Sample: 15 multiple-choice and 5 short-answer questions</span></div>
        <div className="evaluation-progress-track" role="progressbar" aria-label="Human reviews completed" aria-valuemin="0" aria-valuemax="20" aria-valuenow={sample.reviewedCount}>
          <span style={{ width: `${(sample.reviewedCount / 20) * 100}%` }} />
        </div>
      </section>
      <div className="review-question-position">Question {currentIndex + 1} of 20 <span>· {item.questionId} · {item.kind === 'multiple_choice' ? 'Multiple choice' : 'Short answer'}</span></div>
      <article className="panel human-review-question">
        <h2>{item.question}</h2>
        {item.kind === 'multiple_choice' && (
          <ol className="answer-options" type="A">
            {item.options.map((option, index) => <li key={`${index}-${option}`}>{option}</li>)}
          </ol>
        )}
        <div className="review-answer"><span>Correct answer</span><strong>{item.correctAnswer}</strong></div>
        <p className="question-explanation"><strong>Explanation</strong>{item.explanation}</p>
        <blockquote className="question-evidence">
          <span>Original lecture passage · {item.sourcePassageId}</span>
          <p>“{item.sourceExcerpt}”</p>
        </blockquote>
      </article>
      {!sample.finalized ? (
        <section className="panel human-review-form" aria-label="Your human judgment">
          <div className="human-decision-choices">
            <button className={`human-decision-button pass${currentDraft.decision === 'pass' ? ' selected' : ''}`} aria-pressed={currentDraft.decision === 'pass'} onClick={() => updateDraft({ decision: 'pass' })} type="button">Pass</button>
            <button className={`human-decision-button fail${currentDraft.decision === 'fail' ? ' selected' : ''}`} aria-pressed={currentDraft.decision === 'fail'} onClick={() => updateDraft({ decision: 'fail' })} type="button">Fail</button>
          </div>
          <label className="review-comment-field">
            Reviewer comment <span>Optional</span>
            <textarea maxLength={2000} onChange={(event) => updateDraft({ comment: event.target.value })} placeholder="Add a note about this judgment…" value={currentDraft.comment} />
          </label>
          <div className="human-review-controls">
            <button className="button button-outline" disabled={currentIndex === 0 || isSaving} onClick={() => setCurrentIndex((index) => index - 1)} type="button">Previous</button>
            <span>{item.review ? 'Saved · editable until finalization' : 'Choose Pass or Fail; unanswered questions are not counted.'}</span>
            <button className="button button-primary" disabled={!currentDraft.decision || isSaving} onClick={saveCurrentReview} type="button">
              {isSaving ? 'Saving…' : currentIndex < 19 ? 'Save and next' : 'Save review'}
            </button>
          </div>
          {isComplete && (
            <div className="finalize-review">
              <p>All 20 human judgments are saved. Finalizing locks your reviews and reveals the AI–human comparison.</p>
              <button className="button button-primary" disabled={isFinalizing} onClick={finalizeReview} type="button">
                {isFinalizing ? 'Finalizing…' : 'Finalize and view comparison'}
              </button>
            </div>
          )}
        </section>
      ) : (
        <div className="human-review-finalized-note">
          <p>All reviews are finalized, but the comparison dashboard could not be loaded.</p>
          <button className="button button-outline" disabled={isLoading} onClick={reloadFinalComparison} type="button">Retry comparison</button>
        </div>
      )}
      <p className="blinding-note">This review screen does not show AI scores or AI Pass/Fail decisions.</p>
    </>
  );
}

export default App;
