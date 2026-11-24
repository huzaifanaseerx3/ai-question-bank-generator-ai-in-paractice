import assert from 'node:assert/strict';
import { once } from 'node:events';
import { after, before, test } from 'node:test';
import { app, createApp } from '../src/app.js';

function createPdf(pageTexts) {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pageTexts.map((_, index) => `${3 + index * 2} 0 R`).join(' ')}] /Count ${pageTexts.length} >>`,
    ...pageTexts.flatMap((text, index) => [
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${pageTexts.length * 2 + 3} 0 R >> >> /Contents ${4 + index * 2} 0 R >>`,
      `<< /Length ${Buffer.byteLength(`BT /F1 18 Tf 50 750 Td (${text}) Tj ET`)} >>\nstream\nBT /F1 18 Tf 50 750 Td (${text}) Tj ET\nendstream`
    ]),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ];

  let document = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(document));
    document += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(document);
  document += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  document += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  document += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(document);
}

let server;
let baseUrl;

before(async () => {
  server = app.listen(0);
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.close();
  await once(server, 'close');
});

async function postUpload({ filename, contents, contentType = 'application/pdf' } = {}) {
  const form = new FormData();
  if (filename) {
    form.append('file', new Blob([contents], { type: contentType }), filename);
  }
  return fetch(`${baseUrl}/api/upload`, { method: 'POST', body: form });
}

test('health endpoint remains available', async () => {
  const response = await fetch(`${baseUrl}/api/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok' });
});

test('CORS allows the configured frontend origin and localhost development origins', async () => {
  const previousFrontendUrl = process.env.FRONTEND_URL;
  process.env.FRONTEND_URL = ' https://ai-question-bank-generator-ai-in-pa.vercel.app/ , https://second.example.vercel.app ';
  let corsServer;
  try {
    corsServer = createApp().listen(0);
  } finally {
    if (previousFrontendUrl === undefined) {
      delete process.env.FRONTEND_URL;
    } else {
      process.env.FRONTEND_URL = previousFrontendUrl;
    }
  }
  await once(corsServer, 'listening');
  const corsBaseUrl = `http://127.0.0.1:${corsServer.address().port}`;

  try {
    for (const origin of [
      'https://ai-question-bank-generator-ai-in-pa.vercel.app',
      'https://second.example.vercel.app',
      'http://localhost:5173',
      'http://127.0.0.1:5173'
    ]) {
      const response = await fetch(`${corsBaseUrl}/api/health`, { headers: { Origin: origin } });
      assert.equal(response.headers.get('access-control-allow-origin'), origin);
    }

    const uploadPreflight = await fetch(`${corsBaseUrl}/api/upload`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://ai-question-bank-generator-ai-in-pa.vercel.app',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type'
      }
    });
    assert.equal(uploadPreflight.status, 204);
    assert.equal(
      uploadPreflight.headers.get('access-control-allow-origin'),
      'https://ai-question-bank-generator-ai-in-pa.vercel.app'
    );
    assert.match(uploadPreflight.headers.get('access-control-allow-methods'), /POST/);
    assert.match(uploadPreflight.headers.get('access-control-allow-headers'), /content-type/i);

    const uploadResponse = await fetch(`${corsBaseUrl}/api/upload`, {
      method: 'POST',
      headers: { Origin: 'https://ai-question-bank-generator-ai-in-pa.vercel.app' }
    });
    assert.equal(uploadResponse.status, 400);
    assert.equal(
      uploadResponse.headers.get('access-control-allow-origin'),
      'https://ai-question-bank-generator-ai-in-pa.vercel.app'
    );

    const disallowedResponse = await fetch(`${corsBaseUrl}/api/health`, {
      headers: { Origin: 'https://unrelated.example' }
    });
    assert.equal(disallowedResponse.headers.has('access-control-allow-origin'), false);
  } finally {
    corsServer.close();
    await once(corsServer, 'close');
  }
});

test('extracts text, filename, and page count from a multi-page PDF', async () => {
  const response = await postUpload({
    filename: 'lecture.pdf',
    contents: createPdf(['First lecture page', 'Second lecture page'])
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    filename: 'lecture.pdf',
    pages: 2,
    text: 'First lecture page\n\nSecond lecture page'
  });
});

test('returns a helpful error when no file is selected', async () => {
  const response = await postUpload();

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'Choose a PDF file to upload.' });
});

test('rejects files that are not named as PDFs', async () => {
  const response = await postUpload({
    filename: 'lecture.txt',
    contents: createPdf(['Lecture'])
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'Only PDF files are supported.' });
});

test('rejects invalid PDF content', async () => {
  const response = await postUpload({
    filename: 'broken.pdf',
    contents: Buffer.from('not a PDF')
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'This file does not appear to be a valid PDF.' });
});

test('reports damaged PDFs that have a PDF header', async () => {
  const response = await postUpload({
    filename: 'damaged.pdf',
    contents: Buffer.from('%PDF-1.4\nthis is not a complete PDF')
  });

  assert.equal(response.status, 422);
  assert.deepEqual(await response.json(), {
    error: 'We could not read this PDF. It may be damaged or password-protected.'
  });
});

test('explains when a PDF contains no selectable text', async () => {
  const response = await postUpload({
    filename: 'scanned-lecture.pdf',
    contents: createPdf([''])
  });

  assert.equal(response.status, 422);
  assert.deepEqual(await response.json(), {
    error: 'No selectable text was found. This may be a scanned PDF.'
  });
});
