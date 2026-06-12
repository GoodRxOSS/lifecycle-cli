import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { SitesCliConfig } from '../src/lib/types.js';
import { prepareSiteUpload } from '../src/lib/zip.js';

const config: SitesCliConfig = {
  enabled: true,
  upload: {
    maxFiles: 5,
    maxUploadBytes: 1_000_000,
    maxExtractedBytes: 1_000_000,
    allowedExtensions: ['html', 'css', 'js', 'zip'],
  },
};

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lfc-zip-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('prepareSiteUpload', () => {
  it('zips directories to a temporary file and ignores default ignored paths', async () => {
    fs.mkdirSync(path.join(dir, 'node_modules'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), '<h1>hello</h1>');
    fs.writeFileSync(path.join(dir, 'node_modules', 'bad.exe'), 'ignored');

    const upload = await prepareSiteUpload(dir, config);
    try {
      expect(upload.fileName).toBe(`${path.basename(dir)}.zip`);
      expect(upload.contentType).toBe('application/zip');
      expect(fs.statSync(upload.filePath).size).toBeGreaterThan(0);
    } finally {
      await upload.cleanup();
    }
    expect(fs.existsSync(upload.filePath)).toBe(false);
  });

  it('honors .lfcsiteignore patterns', async () => {
    fs.mkdirSync(path.join(dir, 'tmp'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.lfcsiteignore'), 'tmp\n');
    fs.writeFileSync(path.join(dir, 'index.html'), '<h1>hello</h1>');
    fs.writeFileSync(path.join(dir, 'tmp', 'bad.exe'), 'ignored');

    const upload = await prepareSiteUpload(dir, config);
    await upload.cleanup();
  });

  it('rejects too many uploadable files', async () => {
    for (let i = 0; i < 6; i += 1) {
      fs.writeFileSync(path.join(dir, `${i}.html`), String(i));
    }

    await expect(prepareSiteUpload(dir, config)).rejects.toThrow('exceeds the configured limit of 5');
  });

  it('rejects unsupported file extensions', async () => {
    fs.writeFileSync(path.join(dir, 'index.exe'), 'nope');

    await expect(prepareSiteUpload(dir, config)).rejects.toThrow('Unsupported file type ".exe"');
  });

  it('rejects content over the extracted byte limit', async () => {
    fs.writeFileSync(path.join(dir, 'index.html'), 'too large');

    await expect(
      prepareSiteUpload(dir, {
        ...config,
        upload: { ...config.upload, maxExtractedBytes: 2 },
      })
    ).rejects.toThrow('Directory contents');
  });
});
