import archiver from 'archiver';

/** Zip a directory (contents at the archive root) into an in-memory buffer. */
export async function zipDirectory(dir: string): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: 9 } });
    const chunks: Buffer[] = [];
    archive.on('data', (chunk: Buffer) => chunks.push(chunk));
    archive.on('error', reject);
    archive.on('end', () => resolve(Buffer.concat(chunks)));
    archive.directory(dir, false);
    void archive.finalize();
  });
}
