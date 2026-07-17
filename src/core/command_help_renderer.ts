import type { Translator } from '../i18n/index.js';

export type CommandHelpSpec = {
  name: string;
  aliases: readonly string[];
  summary: string;
  usage: readonly string[];
  examples: readonly string[];
  notes: readonly string[];
};

export function renderCommandCatalog(
  i18n: Translator,
  commandOrder: readonly string[],
  specs: Record<string, CommandHelpSpec>,
  {
    showGoal = true,
  }: {
    showGoal?: boolean;
  } = {},
) {
  const lines = [
    i18n.t('coordinator.help.catalogTitle'),
    '',
  ];
  for (const commandName of commandOrder) {
    if (!showGoal && commandName === 'goal') {
      continue;
    }
    const spec = specs[commandName];
    const aliasLabel = spec.aliases.length > 0 ? ` (${spec.aliases.map((alias) => `/${alias}`).join(', ')})` : '';
    lines.push(`/${spec.name}${aliasLabel} ${spec.summary}`);
  }
  lines.push(i18n.t('coordinator.help.localPulseLine'));
  lines.push('');
  lines.push(i18n.t('coordinator.help.helpLabel'));
  lines.push(i18n.t('coordinator.help.exampleLabel'));
  lines.push(i18n.t('coordinator.help.noteLabel'));
  return lines.join('\n');
}

export function renderCommandHelp(spec: CommandHelpSpec, i18n: Translator) {
  const lines = [
    i18n.t('coordinator.help.commandLabel', { name: spec.name }),
    i18n.t('coordinator.help.summaryLabel', { summary: spec.summary }),
  ];
  if (spec.aliases.length > 0) {
    lines.push(i18n.t('coordinator.help.aliasesLabel', { aliases: spec.aliases.map((alias) => `/${alias}`).join(' ') }));
  }
  lines.push('');
  lines.push(i18n.t('coordinator.help.usageLabel'));
  for (const usage of spec.usage) {
    lines.push(usage);
  }
  lines.push('');
  lines.push(i18n.t('coordinator.help.examplesLabel'));
  for (const example of spec.examples) {
    lines.push(example);
  }
  if (spec.notes.length > 0) {
    lines.push('');
    lines.push(i18n.t('coordinator.help.notesLabel'));
    for (const note of spec.notes) {
      lines.push(note);
    }
  }
  return lines.join('\n');
}

export function freezeCommandHelp(spec: CommandHelpSpec): CommandHelpSpec {
  return Object.freeze({
    ...spec,
    aliases: Object.freeze([...(spec.aliases ?? [])]),
    usage: Object.freeze([...(spec.usage ?? [])]),
    examples: Object.freeze([...(spec.examples ?? [])]),
    notes: Object.freeze([...(spec.notes ?? [])]),
  });
}
