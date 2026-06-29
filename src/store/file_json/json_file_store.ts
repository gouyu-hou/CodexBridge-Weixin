import fs from 'node:fs';
import path from 'node:path';

export class JsonFileStore<T> {
  constructor(filePath: string, emptyValue: T) {
    this.filePath = filePath;
    this.emptyValue = emptyValue;
    this.ensureInitialized();
  }

  filePath: string;
  emptyValue: T;

  read(): T {
    this.ensureInitialized();
    return JSON.parse(fs.readFileSync(this.filePath, 'utf8').replace(/^\uFEFF/u, ''));
  }

  write(value: T) {
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });
    const payload = `${JSON.stringify(value, null, 2)}\n`;
    // Atomic write: stage to a temp file then rename over the target so a crash
    // or concurrent reader never observes a truncated/half-written JSON file.
    const tmpPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    try {
      fs.writeFileSync(tmpPath, payload, 'utf8');
      fs.renameSync(tmpPath, this.filePath);
    } catch {
      try {
        fs.rmSync(tmpPath, { force: true });
      } catch {
        // best-effort cleanup of the staging file
      }
      fs.writeFileSync(this.filePath, payload, 'utf8');
    }
    return value;
  }

  ensureInitialized() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    if (!fs.existsSync(this.filePath)) {
      this.write(this.emptyValue);
    }
  }
}
