export const COMMAND_HELP_ORDER = Object.freeze([
  'helps',
  'status',
  'usage',
  'login',
  'stop',
  'review',
  'skills',
  'plugins',
  'apps',
  'mcp',
  'use',
  'automation',
  'weibo',
  'new',
  'project',
  'uploads',
  'assistant',
  'log',
  'todo',
  'remind',
  'note',
  'provider',
  'models',
  'model',
  'plan',
  'experimental',
  'compact',
  'goal',
  'personality',
  'instructions',
  'fast',
  'threads',
  'search',
  'next',
  'prev',
  'open',
  'peek',
  'rename',
  'permissions',
  'allow',
  'deny',
  'reconnect',
  'retry',
  'restart',
  'lang',
]);

export const HIDDEN_COMMAND_ALIASES = Object.freeze({
  interrupt: 'stop',
});

export const COMMAND_ALIAS_DEFINITIONS = Object.freeze({
  helps: ['help', 'h'],
  status: ['where', 'st'],
  usage: ['us'],
  login: ['lg'],
  stop: ['sp'],
  review: ['rv'],
  skills: ['sk'],
  plugins: ['pg'],
  apps: ['ap'],
  mcp: [],
  use: [],
  automation: ['auto'],
  weibo: ['wb'],
  new: ['n'],
  project: ['proj', 'workspace', 'workdir'],
  uploads: ['up', 'ul'],
  assistant: ['as'],
  log: [],
  todo: ['td'],
  remind: ['rmd'],
  note: ['nt'],
  provider: ['pd'],
  models: ['ms'],
  model: ['m'],
  plan: ['pl'],
  experimental: ['experiment', 'experiments', 'exp'],
  compact: [],
  goal: [],
  personality: ['psn'],
  instructions: ['ins'],
  fast: [],
  threads: ['th'],
  search: ['se'],
  next: ['nx'],
  prev: ['pv'],
  open: ['o'],
  peek: ['pk'],
  rename: ['rn'],
  permissions: ['perm'],
  allow: ['al'],
  deny: ['dn'],
  reconnect: ['rc'],
  retry: ['rt'],
  restart: ['rs'],
  lang: [],
});

function buildCommandCanonicalNameMap(
  aliases: Record<string, readonly string[]>,
  hiddenAliases: Record<string, string>,
): ReadonlyMap<string, string> {
  const map = new Map<string, string>();
  for (const [canonical, aliasList] of Object.entries(aliases)) {
    map.set(canonical, canonical);
    for (const alias of aliasList) {
      map.set(alias, canonical);
    }
  }
  for (const [alias, canonical] of Object.entries(hiddenAliases)) {
    map.set(alias, canonical);
  }
  return map;
}

export const COMMAND_CANONICAL_NAME_MAP = buildCommandCanonicalNameMap(
  COMMAND_ALIAS_DEFINITIONS,
  HIDDEN_COMMAND_ALIASES,
);
