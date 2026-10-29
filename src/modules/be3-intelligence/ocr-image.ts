import { z } from 'zod';
import sharp from 'sharp';

export class OcrError extends Error {
  constructor(public code: string, public status = 400) { super(code); }
}
// Local fixture limits only; production policy requires review.
export const localLimits = { maxBytes: 5 * 1024 * 1024, maxPixels: 16_000_000 };
export const ImageInput = z.object({
  filename: z.string().min(1).max(120).refine(v => !/[\\/\x00:]/.test(v) && v !== '..'),
  mimeType: z.enum(['image/jpeg', 'image/png']),
  bytes: z.instanceof(Uint8Array),
}).strict();

export async function validateImage(input: unknown, limits = localLimits) {
  const parsed = ImageInput.safeParse(input);
  if (!parsed.success) throw new OcrError('INVALID_IMAGE');
  const { filename, mimeType, bytes } = parsed.data;
  if (!bytes.length) throw new OcrError('EMPTY_IMAGE');
  if (bytes.length > limits.maxBytes) throw new OcrError('IMAGE_TOO_LARGE', 413);
  // Copy before awaiting so callers cannot mutate validated input.
  const buffer = Buffer.from(bytes);
  const png = buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  const jpeg = buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255;
  const format = png ? 'png' : jpeg ? 'jpeg' : null;
  if (!format) throw new OcrError('INVALID_SIGNATURE');
  if (mimeType !== `image/${format}`) throw new OcrError('MIME_MISMATCH');
  if (!(format === 'png' ? /\.png$/i : /\.jpe?g$/i).test(filename)) throw new OcrError('EXTENSION_MISMATCH');
  try {
    // Decode completely, bound decompressed size, strip EXIF by re-encoding.
    const decoder = sharp(buffer, { limitInputPixels: limits.maxPixels, failOn: 'warning', animated: false });
    const metadata = await decoder.metadata();
    if (metadata.format !== format || (metadata.pages ?? 1) > 1) throw new Error('Unsupported image');
    const clean = await decoder.autoOrient().toFormat(format).toBuffer();
    return { bytes: clean, mimeType };
  } catch { throw new OcrError('CORRUPT_IMAGE'); }
}
