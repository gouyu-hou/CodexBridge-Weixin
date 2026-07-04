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
    const raw = fs.readFileSync(this.filePath, 'utf8');
    try {
      return JSON.parse(raw.replace(/^\uFEFF/u, ''));
    } catch {
      this.quarantineCorruptFile(raw);
      return this.write(this.emptyValue);
    }
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

  private quarantineCorruptFile(raw: string) {
    const corruptPath = this.nextCorruptPath();
    try {
      fs.renameSync(this.filePath, corruptPath);
    } catch {
      try {
        fs.writeFileSync(corruptPath, raw, 'utf8');
        fs.rmSync(this.filePath, { force: true });
      } catch {
        // If quarantine fails, still reinitialize the main store below.
      }
    }
  }

  private nextCorruptPath() {
    const stamp = new Date().toISOString()
      .replace(/[-:TZ]/gu, '')
      .replace('.', '-');
    let candidate = `${this.filePath}.corrupt-${stamp}`;
    let suffix = 1;
    while (fs.existsSync(candidate)) {
      candidate = `${this.filePath}.corrupt-${stamp}-${suffix}`;
      suffix += 1;
    }
    return candidate;
  }
}
