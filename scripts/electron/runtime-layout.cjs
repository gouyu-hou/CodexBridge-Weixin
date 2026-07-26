'use strict';

const path = require('node:path');

function resolveElectronRuntimeLayout({ appRoot, isPackaged, resourcesPath }) {
  const resolvedAppRoot = path.resolve(appRoot);
  if (!isPackaged) {
    return {
      appRoot: resolvedAppRoot,
      builtInRuntimeRoot: resolvedAppRoot,
      dependencyRoot: resolvedAppRoot,
    };
  }

  const resolvedResourcesPath = path.resolve(resourcesPath);
  return {
    appRoot: resolvedAppRoot,
    builtInRuntimeRoot: path.join(resolvedResourcesPath, 'runtime-app'),
    dependencyRoot: path.join(resolvedResourcesPath, 'runtime-app'),
  };
}

module.exports = { resolveElectronRuntimeLayout };
