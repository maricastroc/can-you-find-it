export const UPLOAD_MAX_SIDE = 4096;

export function fitWithin(width: number, height: number, max = UPLOAD_MAX_SIDE) {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

async function decode(file: Blob): Promise<{ source: CanvasImageSource; width: number; height: number; close?: () => void }> {
  const bitmap =
    typeof createImageBitmap === "function" ? await createImageBitmap(file, { imageOrientation: "from-image" }).catch(() => undefined) : undefined;
  if (bitmap) return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function prepareForUpload(file: Blob): Promise<Blob> {
  const img = await decode(file);
  try {
    const { width, height } = fitWithin(img.width, img.height);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d")!.drawImage(img.source, 0, 0, width, height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode failed"))), "image/jpeg", 0.86),
    );
  } finally {
    img.close?.();
  }
}

export async function captureFrame(video: HTMLVideoElement): Promise<Blob> {
  const { width, height } = fitWithin(video.videoWidth, video.videoHeight);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")!.drawImage(video, 0, 0, width, height);
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode failed"))), "image/jpeg", 0.88),
  );
}
