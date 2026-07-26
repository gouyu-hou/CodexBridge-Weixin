'use strict';

const path = require('node:path');

function collectProductionPackagePaths(packageLock) {
  return Object.entries(packageLock?.packages ?? {})
    .filter(([relative, metadata]) => (
      relative.startsWith('node_modules/')
      && metadata?.dev !== true
    ))
    .map(([relative]) => relative.split('/').join(path.sep))
    .sort((left, right) => left.localeCompare(right, 'en'));
}

function shouldCopyRuntimePath(relativePath) {
  const normalized = String(relativePath || '').replace(/\\/gu, '/');
  if (/^node_modules\/@openai\/codex-(?!win32-x64(?:\/|$))[^/]+(?:\/|$)/u.test(normalized)) {
    return false;
  }
  if (/^node_modules\/@esbuild\/(?!win32-x64(?:\/|$))[^/]+(?:\/|$)/u.test(normalized)) {
    return false;
  }
  if (/^node_modules\/fsevents(?:\/|$)/u.test(normalized)) {
    return false;
  }
  if (/^node_modules\/ffprobe-static\/bin\/(?:darwin|linux)(?:\/|$)/u.test(normalized)) {
    return false;
  }
  if (/^node_modules\/ffprobe-static\/bin\/win32\/ia32(?:\/|$)/u.test(normalized)) {
    return false;
  }
  return true;
}

module.exports = {
  collectProductionPackagePaths,
  shouldCopyRuntimePath,
};
