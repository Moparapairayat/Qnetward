/**
 * Crops an image to a centred square and scales it to `size` pixels, so an
 * avatar upload is a few tens of kilobytes whatever the camera produced.
 * WebP where the browser can encode it, JPEG otherwise.
 */
export async function squareImage(file: File, size = 256): Promise<File> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser can't process images.");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
  bitmap.close();

  const encode = (type: string) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.86));
  let blob = await encode("image/webp");
  // Browsers that can't write WebP hand back a PNG instead.
  if (!blob || blob.type !== "image/webp") blob = await encode("image/jpeg");
  if (!blob) throw new Error("Couldn't process that image.");
  const ext = blob.type === "image/webp" ? "webp" : "jpg";
  return new File([blob], `avatar.${ext}`, { type: blob.type });
}
