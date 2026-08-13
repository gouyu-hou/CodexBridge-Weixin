import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import {
  extractUniqueOutputArtifacts,
  inferArtifactKindFromPath,
  inferMimeTypeFromPath,
  isLocalFilePath,
  normalizeLegacyImageMedia,
} from '../src/codex_app_artifacts.js';

test('artifact path helpers classify media and common document types', () => {
  assert.equal(inferArtifactKindFromPath('result.PNG'), 'image');
  assert.equal(inferArtifactKindFromPath('clip.webm'), 'video');
  assert.equal(inferArtifactKindFromPath('voice.flac'), 'audio');
  assert.equal(inferArtifactKindFromPath('report.pdf'), 'file');

  assert.equal(inferMimeTypeFromPath('result.jpeg'), 'image/jpeg');
  assert.equal(inferMimeTypeFromPath('report.docx'),
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  assert.equal(inferMimeTypeFromPath('archive.tgz'), 'application/gzip');
  assert.equal(inferMimeTypeFromPath('unknown.bin'), null);
});

test('isLocalFilePath accepts absolute paths and rejects URLs and data payloads', () => {
  const absolutePath = path.resolve('output.png');
  assert.equal(isLocalFilePath(absolutePath), true);
  assert.equal(isLocalFilePath('https://example.com/output.png'), false);
  assert.equal(isLocalFilePath('//example.com/output.png'), false);
  assert.equal(isLocalFilePath('data:image/png;base64,AAAA'), false);
  assert.equal(isLocalFilePath('relative/output.png'), false);
  assert.equal(isLocalFilePath(''), false);
});

test('extractUniqueOutputArtifacts preserves order and removes kind-path duplicates', () => {
  const items = [
    { artifacts: [
      { kind: 'image' as const, path: 'same.png' },
      { kind: 'file' as const, path: 'same.png' },
    ] },
    { artifacts: [
      { kind: 'image' as const, path: 'same.png' },
      { kind: 'video' as const, path: 'clip.mp4' },
    ] },
  ];
  const artifacts = extractUniqueOutputArtifacts(items, (item) => item.artifacts);
  assert.deepEqual(artifacts, [
    { kind: 'image', path: 'same.png' },
    { kind: 'file', path: 'same.png' },
    { kind: 'video', path: 'clip.mp4' },
  ]);
  assert.deepEqual(normalizeLegacyImageMedia(artifacts), [
    { kind: 'image', path: 'same.png' },
  ]);
});
