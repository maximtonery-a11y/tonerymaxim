import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import type { onnx } from '../../node_modules/onnxruntime-web/lib/onnxjs/ort-schema/protobuf/onnx';

// Use the schema bundled with the same pinned runtime that executes the model.
const { onnx: schema } = createRequire(import.meta.url)(
  resolve('node_modules/onnxruntime-web/lib/onnxjs/ort-schema/protobuf/onnx.js')
) as { onnx: typeof onnx };

/** Build-time weight compression. The browser receives a standard ONNX graph.
 * Use one scale per output channel. Leave biases, activations and ordinary
 * arithmetic in full precision, including every operation that reads the image.
 */
export function packLabelModel(source: Uint8Array) {
  const model = schema.ModelProto.decode(source);
  const graph = model.graph!;
  const filters = new Map<string, string>();
  for (const node of graph.node || []) {
    if (['Conv', 'ConvTranspose', 'MatMul'].includes(node.opType!) && node.input?.[1]) {
      filters.set(node.input[1], node.opType!);
    }
  }
  const nodes: onnx.INodeProto[] = [];
  for (const node of graph.node || []) {
    const name = node.output?.[0] || '';
    const kind = filters.get(name);
    const tensor = node.attribute?.[0]?.t;
    const raw = tensor?.rawData;
    if (node.opType !== 'Constant' || !kind || tensor?.dataType !== 1 || !raw || raw.length < 2048) {
      nodes.push(node);
      continue;
    }
    const shape = tensor.dims!.map(Number);
    const axis = kind === 'MatMul' ? shape.length - 1 : kind === 'ConvTranspose' ? 1 : 0;
    const channels = shape[axis];
    const stride = shape.slice(axis + 1).reduce((a, b) => a * b, 1);
    const weights = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    const values = new Int8Array(raw.byteLength / 4);
    const scales = new Float32Array(channels);
    for (let i = 0; i < values.length; i++) {
      const channel = Math.floor(i / stride) % channels;
      scales[channel] = Math.max(scales[channel], Math.abs(weights.getFloat32(i * 4, true)));
    }
    for (let i = 0; i < channels; i++) scales[i] = scales[i] / 127 || 1;
    for (let i = 0; i < values.length; i++) {
      const scale = scales[Math.floor(i / stride) % channels];
      values[i] = Math.max(-127, Math.min(127, Math.round(weights.getFloat32(i * 4, true) / scale)));
    }
    const scaleName = name + '/tm_scale', packedName = name + '/tm_i8', castName = name + '/tm_float';
    graph.initializer!.push({ name: packedName, dataType: 3, dims: shape, rawData: new Uint8Array(values.buffer) },
      { name: scaleName, dataType: 1, dims: shape.map((n, i) => i === axis ? n : 1), floatData: Array.from(scales) });
    nodes.push({ opType: 'Cast', input: [packedName], output: [castName], attribute: [{ name: 'to', type: 2, i: 1 }] },
      { opType: 'Mul', input: [castName, scaleName], output: [name] });
  }
  graph.node = nodes;
  return schema.ModelProto.encode(model).finish();
}
