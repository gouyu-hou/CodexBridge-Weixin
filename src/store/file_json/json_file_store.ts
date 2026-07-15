import fs from 'node:fs';
import path from 'node:path';
import {
  readJsonFileSafely,
  recoverInterruptedFileReplacement,
  writeJsonFileAtomically,
} from './json_file_io.js';

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
    return readJsonFileSafely(this.filePath, {
      fallback: this.emptyValue,
      reinitializeOnCorrupt: true,
    });
  }

  write(value: T) {
    return writeJsonFileAtomically(this.filePath, value);
  }

  ensureInitialized() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    recoverInterruptedFileReplacement(this.filePath);
    if (!fs.existsSync(this.filePath)) {
      this.write(this.emptyValue);
    }
  }

}
