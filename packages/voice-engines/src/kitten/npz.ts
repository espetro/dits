/**
 * Minimal .npz loader: ZIP of .npy files → keyed float arrays.
 * Port of kitten-tts-js src/npz-loader.js (f4/f8/i4/i8/u1 dtypes,
 * fortran-order transpose for 2d arrays).
 */
import JSZip from "jszip";

export interface NpyArray {
  data: Float32Array;
  shape: number[];
}

const MAGIC = "\x93NUMPY";

function parseNpy(buf: ArrayBuffer): NpyArray {
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < 6; i++) {
    if (bytes[i] !== MAGIC.charCodeAt(i)) throw new Error("bad .npy magic");
  }
  const major = bytes[6] ?? 1;
  const headerLen =
    major >= 2
      ? new DataView(buf, 8, 4).getUint32(0, true)
      : new DataView(buf, 8, 2).getUint16(0, true);
  const headerOffset = major >= 2 ? 12 : 10;
  const header = new TextDecoder()
    .decode(bytes.slice(headerOffset, headerOffset + headerLen))
    .trim();

  const descr = header.match(/'descr'\s*:\s*'([^']+)'/)?.[1];
  const shapeStr = header.match(/'shape'\s*:\s*\(([^)]*)\)/)?.[1];
  const fortran = /'fortran_order'\s*:\s*True/.test(header);
  if (!descr || shapeStr === undefined) throw new Error(`bad .npy header: ${header}`);
  const shape = shapeStr
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number);
  const dataBuf = buf.slice(headerOffset + headerLen);

  let data: Float32Array | Int32Array | Uint8Array;
  switch (descr.replace(/[<>|=]/, "")) {
    case "f4":
      data = new Float32Array(dataBuf);
      break;
    case "f8": {
      const f64 = new Float64Array(dataBuf);
      const out = new Float32Array(f64.length);
      for (let i = 0; i < f64.length; i++) out[i] = f64[i] ?? 0;
      data = out;
      break;
    }
    case "i4":
      data = new Int32Array(dataBuf);
      break;
    case "i8": {
      const i64 = new BigInt64Array(dataBuf);
      const out = new Float32Array(i64.length);
      for (let i = 0; i < i64.length; i++) out[i] = Number(i64[i]);
      data = out;
      break;
    }
    case "u1":
      data = new Uint8Array(dataBuf);
      break;
    default:
      throw new Error(`unsupported .npy dtype: ${descr}`);
  }

  let flat = new Float32Array(data.buffer, data.byteOffset, data.length);
  if (fortran && shape.length === 2) {
    const rows = shape[0] ?? 0;
    const cols = shape[1] ?? 0;
    const out = new Float32Array(rows * cols);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) out[r * cols + c] = flat[c * rows + r] ?? 0;
    }
    flat = out;
  }
  return { data: flat, shape };
}

/** voices.npz → { voiceName: {data: flat [N,256] styles, shape} }. */
export async function loadNpz(npzBuffer: ArrayBuffer): Promise<Record<string, NpyArray>> {
  const zip = await JSZip.loadAsync(npzBuffer);
  const result: Record<string, NpyArray> = {};
  await Promise.all(
    Object.entries(zip.files)
      .filter(([name, f]) => name.endsWith(".npy") && !f.dir)
      .map(async ([name, file]) => {
        result[name.replace(/\.npy$/, "")] = parseNpy(await file.async("arraybuffer"));
      }),
  );
  return result;
}
