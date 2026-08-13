'use strict';

const path = require('node:path');

function resolveElectronRuntimeLayout({ appRoot, developmentRoot, isPackaged, resourcesPath }) {
  const resolvedAppRoot = path.resolve(appRoot);
  if (!isPackaged) {
    const resolvedDevelopmentRoot = path.resolve(developmentRoot || resolvedAppRoot);
    return {
      appRoot: resolvedDevelopmentRoot,
      builtInRuntimeRoot: resolvedDevelopmentRoot,
      dependencyRoot: resolvedDevelopmentRoot,
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
