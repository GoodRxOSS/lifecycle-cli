import { createWriteStream } from 'node:fs';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import archiver from 'archiver';
import createIgnore from 'ignore';

import { formatBytes } from './output.js';
import type { SitesCliConfig } from './types.js';

const DEFAULT_SITE_IGNORE_PATTERNS = [
  '.git',
  'node_modules',
  '.DS_Store',
  '.next/cache',
  'dist/.cache',
  'coverage',
  '.lfcsiteignore',
];

interface SiteUploadFile {
  absolutePath: string;
  archivePath: string;
  size: number;
}

export interface PreparedSiteUpload {
  filePath: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  cleanup: () => Promise<void>;
}

function toArchivePath(filePath: string): string {
  return filePath.split(path.sep).join('/');
}

function extensionFor(filePath: string): string {
  return path.extname(filePath).toLowerCase().replace(/^\./, '');
}

function assertAllowedExtension(filePath: string, allowedExtensions: string[]): void {
  const ext = extensionFor(filePath);
  const allowed = new Set(allowedExtensions.map(item => item.toLowerCase().replace(/^\./, '')));
  if (!ext || !allowed.has(ext)) {
    throw new Error(
      `Unsupported file type "${ext ? `.${ext}` : '(none)'}" — allowed extensions: ${allowedExtensions.join(', ')}`,
    );
  }
}

function assertMaxBytes(actual: number, max: number, label: string): void {
  if (actual > max) {
    throw new Error(`${label} is ${formatBytes(actual)}, which exceeds the configured limit of ${formatBytes(max)}`);
  }
}

async function loadSiteIgnore(root: string): Promise<string[]> {
  try {
    const contents = await readFile(path.join(root, '.lfcsiteignore'), 'utf8');
    return contents.split(/\r?\n/);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

async function collectFiles(root: string, allowedExtensions: string[]): Promise<SiteUploadFile[]> {
  const ig = createIgnore()
    .add(DEFAULT_SITE_IGNORE_PATTERNS)
    .add(await loadSiteIgnore(root));
  const files: SiteUploadFile[] = [];

  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const absolutePath = path.join(dir, entry.name);
      const relativePath = path.relative(root, absolutePath);
      const archivePath = toArchivePath(relativePath);

      if (ig.ignores(archivePath)) continue;

      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }

      if (!entry.isFile()) continue;

      assertAllowedExtension(archivePath, allowedExtensions);
      const info = await stat(absolutePath);
      files.push({ absolutePath, archivePath, size: info.size });
    }
  }

  await walk(root);
  return files;
}

async function zipFilesToTemp(files: SiteUploadFile[], fileName: string): Promise<PreparedSiteUpload> {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'lfc-site-'));
  const filePath = path.join(tempDir, fileName);

  await new Promise<void>((resolve, reject) => {
    const output = createWriteStream(filePath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', resolve);
    output.on('error', reject);
    archive.on('error', reject);
    archive.pipe(output);

    for (const file of files) {
      archive.file(file.absolutePath, { name: file.archivePath });
    }

    void archive.finalize();
  });

  const info = await stat(filePath);
  return {
    filePath,
    fileName,
    contentType: 'application/zip',
    sizeBytes: info.size,
    cleanup: () => rm(tempDir, { recursive: true, force: true }),
  };
}

export async function prepareSiteUpload(target: string, config: SitesCliConfig): Promise<PreparedSiteUpload> {
  if (!config.enabled) throw new Error('Sites are not enabled for this Lifecycle deployment');

  const resolved = path.resolve(target);
  const info = await stat(resolved);
  const { allowedExtensions, maxExtractedBytes, maxFiles, maxUploadBytes } = config.upload;

  if (info.isDirectory()) {
    const files = await collectFiles(resolved, allowedExtensions);
    if (files.length === 0) throw new Error('No uploadable files found');
    if (files.length > maxFiles) {
      throw new Error(
        `Directory contains ${files.length} uploadable files, which exceeds the configured limit of ${maxFiles}`,
      );
    }

    const extractedBytes = files.reduce((total, file) => total + file.size, 0);
    assertMaxBytes(extractedBytes, maxExtractedBytes, 'Directory contents');

    const upload = await zipFilesToTemp(files, `${path.basename(resolved)}.zip`);
    assertMaxBytes(upload.sizeBytes, maxUploadBytes, 'Archive');
    return upload;
  }

  if (!info.isFile()) throw new Error('Upload path must be a file or directory');

  assertAllowedExtension(resolved, allowedExtensions);
  assertMaxBytes(info.size, maxUploadBytes, 'Upload');
  if (extensionFor(resolved) !== 'zip') assertMaxBytes(info.size, maxExtractedBytes, 'Upload contents');

  return {
    filePath: resolved,
    fileName: path.basename(resolved),
    contentType: extensionFor(resolved) === 'zip' ? 'application/zip' : 'text/html',
    sizeBytes: info.size,
    cleanup: async () => {},
  };
}
