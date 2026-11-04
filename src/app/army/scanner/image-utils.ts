export interface RgbaImage {
  data: Uint8ClampedArray<ArrayBuffer>;
  width: number;
  height: number;
}

function asImageDataBuffer(data: Uint8ClampedArray): Uint8ClampedArray<ArrayBuffer> {
  if (data.buffer instanceof ArrayBuffer) {
    return data as Uint8ClampedArray<ArrayBuffer>;
  }
  const copy = new Uint8ClampedArray(data.length);
  copy.set(data);
  return copy;
}

function toImageData(img: RgbaImage): ImageData {
  return new ImageData(asImageDataBuffer(img.data), img.width, img.height);
}

export function loadImageElement(src: string | Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Nie udało się wczytać obrazu.'));
    if (typeof src === 'string') {
      img.src = src;
    } else {
      img.src = URL.createObjectURL(src);
    }
  });
}

export function imageToRgba(
  img: CanvasImageSource,
  width?: number,
  height?: number,
): RgbaImage {
  const w =
    width ??
    ('naturalWidth' in img
      ? (img as HTMLImageElement).naturalWidth
      : (img as ImageBitmap).width);
  const h =
    height ??
    ('naturalHeight' in img
      ? (img as HTMLImageElement).naturalHeight
      : (img as ImageBitmap).height);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, w, h);
  const imageData = ctx.getImageData(0, 0, w, h);
  return {
    data: asImageDataBuffer(imageData.data),
    width: w,
    height: h,
  };
}

export function cropRgba(
  src: RgbaImage,
  x: number,
  y: number,
  w: number,
  h: number,
): RgbaImage {
  const out = new Uint8ClampedArray(w * h * 4) as Uint8ClampedArray<ArrayBuffer>;
  for (let row = 0; row < h; row++) {
    const sy = y + row;
    if (sy < 0 || sy >= src.height) continue;
    for (let col = 0; col < w; col++) {
      const sx = x + col;
      if (sx < 0 || sx >= src.width) continue;
      const si = (sy * src.width + sx) * 4;
      const di = (row * w + col) * 4;
      out[di] = src.data[si];
      out[di + 1] = src.data[si + 1];
      out[di + 2] = src.data[si + 2];
      out[di + 3] = src.data[si + 3];
    }
  }
  return { data: out, width: w, height: h };
}

export function resizeRgba(src: RgbaImage, tw: number, th: number): RgbaImage {
  const canvas = document.createElement('canvas');
  canvas.width = src.width;
  canvas.height = src.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.putImageData(toImageData(src), 0, 0);
  const out = document.createElement('canvas');
  out.width = tw;
  out.height = th;
  const octx = out.getContext('2d', { willReadFrequently: true })!;
  octx.imageSmoothingEnabled = true;
  octx.drawImage(canvas, 0, 0, tw, th);
  const imageData = octx.getImageData(0, 0, tw, th);
  return {
    data: asImageDataBuffer(imageData.data),
    width: tw,
    height: th,
  };
}

export function rgbaToDataUrl(img: RgbaImage): string {
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d')!;
  ctx.putImageData(toImageData(img), 0, 0);
  return canvas.toDataURL('image/png');
}

export function rgbaToPngBlob(img: RgbaImage): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d')!;
  ctx.putImageData(toImageData(img), 0, 0);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('toBlob failed'))),
      'image/png',
    );
  });
}
