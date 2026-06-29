import assert from 'node:assert/strict';
import test from 'node:test';
import { formatWeixinText, splitWeixinText } from '../../../src/platforms/weixin/formatting.js';

test('formatWeixinText applies official markdown filtering before local heading rewrite', () => {
  const formatted = formatWeixinText('# 标题\n\n![alt](https://example.com/a.png)\n\n中文*强调*和English *italic*');

  assert.equal(formatted, '【标题】\n\n中文强调和English *italic*');
});

test('formatWeixinText keeps fenced code blocks intact while rewriting headings outside fences', () => {
  const formatted = formatWeixinText('# 外部标题\n\n```md\n# 内部标题\n```\n\n## 次标题');

  assert.equal(formatted, '【外部标题】\n\n```md\n# 内部标题\n```\n\n**次标题**');
});

test('splitWeixinText preserves line breaks in common command lists for Weixin markdown rendering', () => {
  const [formatted] = splitWeixinText([
    '常用命令：',
    '/new        新会话',
    '/stop       停止当前回复',
    '/retry      重试上一条',
    '/compact    压缩上下文',
  ].join('\n'));

  assert.equal(
    formatted,
    '常用命令：  \n/new        新会话  \n/stop       停止当前回复  \n/retry      重试上一条  \n/compact    压缩上下文',
  );
});
