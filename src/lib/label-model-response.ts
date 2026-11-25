/** Some WebKit downloads retain the HTTP gzip layer around the gzip file. */
export async function unpackLabelModel(response: Response): Promise<ArrayBuffer> {
  if (!response.ok || !response.body) throw new Error('model download');

  function gunzip(stream: ReadableStream<Uint8Array<ArrayBuffer>>) {
    return new Response(stream.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  }

  const model = await gunzip(response.body);
  const signature = new Uint8Array(model, 0, Math.min(2, model.byteLength));
  if (signature[0] === 0x1f && signature[1] === 0x8b) {
    return gunzip(new Blob([model]).stream());
  }
  return model;
}
