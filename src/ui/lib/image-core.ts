/**
 * User-selected raster attachments shared by every conversation.
 * Ported verbatim from `src/compat/images.js` — no capture, no upload.
 */
export const MAX_FILES = 4;
export const MAX_BYTES = 20 * 1024 * 1024;
export const MAX_EDGE = 1536;

export interface RamoImage {
  type: 'image';
  data: string;
  mimeType: string;
  name: string;
}

const node = (tag: string, cls?: string) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  return n;
};

function raster(bytes: Uint8Array): boolean {
  return (bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71)
    || (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    || /^GIF8[79]a$/.test(String.fromCharCode(...bytes.slice(0, 6)))
    || (String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP')
    || (bytes[0] === 66 && bytes[1] === 77);
}

export async function prepare(file: File): Promise<RamoImage> {
  if (!file || file.size > MAX_BYTES) throw new Error((file?.name || 'Image') + ': choose an image under 20 MiB.');
  const header = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if (!raster(header)) throw new Error((file.name || 'File') + ': use a PNG, JPEG, WebP, GIF or BMP image. SVG and document files are not supported here.');
  const url = URL.createObjectURL(file);
  const image = new Image();
  let canvas: HTMLCanvasElement | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error((file.name || 'Image') + ': this image could not be decoded. Try exporting it as PNG or JPEG.'));
      image.src = url;
    });
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 50000000) {
      throw new Error('This image is too large to decode safely. Export a smaller PNG or JPEG.');
    }
    const scale = Math.min(1, MAX_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
    canvas = node('canvas') as HTMLCanvasElement;
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Image preparation is unavailable in this browser.');
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let transparent = false;
    for (let i = 3; i < pixels.length; i += 4) { if (pixels[i] < 255) { transparent = true; break; } }
    let dataURL = canvas.toDataURL(transparent ? 'image/png' : 'image/jpeg', 0.85);
    // Keep useful transparency; flatten very large alpha images to bound prompt memory.
    if (transparent && dataURL.length > 4 * 1024 * 1024 * 4 / 3) {
      ctx.globalCompositeOperation = 'destination-over';
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      dataURL = canvas.toDataURL('image/jpeg', 0.85);
    }
    const split = dataURL.indexOf(',');
    if ((dataURL.length - split - 1) * 3 / 4 > 4 * 1024 * 1024) {
      throw new Error('Prepared image is too large. Export a smaller JPEG or PNG and try again.');
    }
    return {
      type: 'image',
      data: dataURL.slice(split + 1),
      mimeType: dataURL.slice(5, dataURL.indexOf(';')),
      name: String(file.name || 'Pasted image').slice(0, 180),
    };
  } finally {
    image.src = '';
    URL.revokeObjectURL(url);
    if (canvas) { canvas.width = 1; canvas.height = 1; }
  }
}

export function source(image: RamoImage | undefined): string {
  return image && /^image\/(png|jpeg|webp|gif|bmp)$/.test(image.mimeType) && typeof image.data === 'string' && /^[A-Za-z0-9+/=]+$/.test(image.data)
    ? 'data:' + image.mimeType + ';base64,' + image.data
    : '';
}

