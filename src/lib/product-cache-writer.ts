import { mkdir, open, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';

const WRITE_BUFFER_BYTES = 512 * 1024;

/** A private generation: nothing becomes visible until products.json is replaced. */
export async function createProductCacheWriter(directory: string, cacheFile: string) {
  await mkdir(directory, { recursive: true });
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const detailsFile = `product-details-${stamp}.ndjson`;
  const detailsPath = join(directory, detailsFile);
  const detailsTmp = `${detailsPath}.tmp`;
  const cacheTmp = `${cacheFile}.${stamp}.tmp`;
  let detailHandle: Awaited<ReturnType<typeof open>> | undefined = await open(detailsTmp, 'w');
  let cacheHandle: Awaited<ReturnType<typeof open>> | undefined;
  let detailChunk = '';
  let detailChunkBytes = 0;
  let offset = 0;
  let published = false;

  async function flushDetails() {
    if (detailChunk && detailHandle) await detailHandle.writeFile(detailChunk, 'utf8');
    detailChunk = '';
    detailChunkBytes = 0;
  }

  return {
    detailsFile,
    async appendDetail(detail: unknown) {
      const line = `${JSON.stringify(detail)}\n`;
      const length = Buffer.byteLength(line);
      const location = { _detail_offset: offset, _detail_length: length };
      offset += length;
      detailChunk += line;
      detailChunkBytes += length;
      if (detailChunkBytes >= WRITE_BUFFER_BYTES) await flushDetails();
      return location;
    },
    async publish(metadata: Record<string, unknown>, products: Record<string, unknown>[]) {
      await flushDetails();
      await detailHandle!.sync();
      await detailHandle!.close();
      detailHandle = undefined;
      await rename(detailsTmp, detailsPath);
      cacheHandle = await open(cacheTmp, 'w');
      // Serialise each product once; never hold another full catalogue string.
      const header = JSON.stringify(metadata);
      let chunk = `${header.slice(0, -1)}${header === '{}' ? '' : ','}"products":[`;
      let chunkBytes = Buffer.byteLength(chunk);
      for (let index = 0; index < products.length; index++) {
        const part = `${index ? ',' : ''}${JSON.stringify(products[index])}`;
        chunk += part;
        chunkBytes += Buffer.byteLength(part);
        if (chunkBytes >= WRITE_BUFFER_BYTES) {
          await cacheHandle.writeFile(chunk, 'utf8');
          chunk = '';
          chunkBytes = 0;
        }
      }
      await cacheHandle.writeFile(`${chunk}]}`, 'utf8');
      await cacheHandle.sync();
      await cacheHandle.close();
      cacheHandle = undefined;
      await rename(cacheTmp, cacheFile);
      published = true;
    },
    async discard() {
      await detailHandle?.close().catch(() => undefined);
      await cacheHandle?.close().catch(() => undefined);
      detailHandle = undefined;
      cacheHandle = undefined;
      await rm(detailsTmp, { force: true }).catch(() => undefined);
      await rm(cacheTmp, { force: true }).catch(() => undefined);
      if (!published) await rm(detailsPath, { force: true }).catch(() => undefined);
      detailChunk = '';
    },
  };
}
