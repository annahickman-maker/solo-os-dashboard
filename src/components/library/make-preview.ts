/**
 * Browser-side preview maker: shrinks a picked image to about 800px on its
 * long edge and encodes it as WebP (JPEG where WebP encoding is missing), so
 * only a small preview is ever uploaded. The original never leaves the device.
 */
import { MAX_PREVIEW_BYTES, PREVIEW_TARGET_EDGE } from '@/lib/library/contract';

export interface MadePreview {
  base64: string;
  bytes: number;
  /** Pixel size of the picked original. */
  width: number;
  height: number;
}

async function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

export async function makePreview(file: File): Promise<MadePreview> {
  if (!file.type.startsWith('image/')) throw new Error('Pick an image (a photo, screenshot or thumbnail) for the preview');
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, PREVIEW_TARGET_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const size = { width: bitmap.width, height: bitmap.height };
  bitmap.close();

  for (const quality of [0.82, 0.7, 0.55]) {
    let blob = await toBlob(canvas, 'image/webp', quality);
    if (!blob || blob.type !== 'image/webp') blob = await toBlob(canvas, 'image/jpeg', quality);
    if (blob && blob.size <= MAX_PREVIEW_BYTES) {
      const buf = new Uint8Array(await blob.arrayBuffer());
      let s = '';
      for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return { base64: btoa(s), bytes: buf.length, ...size };
    }
  }
  throw new Error('Could not make a small enough preview from that image');
}
