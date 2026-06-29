const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..', '..');
const outputDir = path.join(rootDir, 'build', 'runtime', 'node');
const outputNode = path.join(outputDir, 'node.exe');

async function main() {
  if (process.platform !== 'win32') {
    console.log('Windows runtime preparation skipped on non-Windows host.');
    return;
  }
  const sourceNode = process.execPath;
  if (!fs.existsSync(sourceNode)) {
    throw new Error(`Current node.exe was not found: ${sourceNode}`);
  }
  await fsp.mkdir(outputDir, { recursive: true });
  await fsp.copyFile(sourceNode, outputNode);
  await fsp.writeFile(
    path.join(outputDir, 'README.txt'),
    [
      'Bundled Node.js runtime for CodexBridge Weixin Admin.',
      `Source: ${sourceNode}`,
      `Prepared: ${new Date().toISOString()}`,
      '',
    ].join('\r\n'),
    'utf8',
  );
  console.log(`Prepared runtime: ${outputNode}`);
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
