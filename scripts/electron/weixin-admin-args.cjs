'use strict';

function resolveElectronUserArgs(argv, isPackaged) {
  return argv.slice(isPackaged ? 1 : 2);
}

module.exports = { resolveElectronUserArgs };
