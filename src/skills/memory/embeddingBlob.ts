/**
 * BLOB format: Float32Array little-endian.
 * Guardrail: store embedding_dim; on deserialize assert length === dim.
 */

export function float32ToBuffer(arr: number[]): Buffer {
  const buf = Buffer.allocUnsafe(arr.length * 4);
  for (let i = 0; i < arr.length; i++) {
    buf.writeFloatLE(arr[i]!, i * 4);
  }
  return buf;
}

export function bufferToFloat32(buf: Buffer, expectedDim: number): number[] {
  if (buf.length !== expectedDim * 4) {
    throw new Error(`Embedding length mismatch: buffer ${buf.length / 4}, expected dim ${expectedDim}`);
  }
  const out: number[] = [];
  for (let i = 0; i < expectedDim; i++) {
    out.push(buf.readFloatLE(i * 4));
  }
  return out;
}
