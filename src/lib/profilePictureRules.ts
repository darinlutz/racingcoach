// My Dashboard's profile picture: the limits, and the sums behind dragging and scaling it in a square frame
// (src/components/ProfilePictureCropper.tsx). No I/O or imports, so the browser and Node can both run it.

// The browser turns whatever was picked into a square JPEG of this many pixels, which is all that's uploaded
export const PROFILE_PICTURE_PIXELS = 512;
export const MAX_PROFILE_PICTURE_BYTES = 1024 * 1024;
// The file picked on the computer, before it's scaled
export const MAX_PICTURE_SOURCE_BYTES = 30 * 1024 * 1024;
export const MAX_PICTURE_ZOOM = 4;

export type PictureSize = { width: number; height: number };
// How far the picture's center is from the frame's center, in the frame's pixels
export type PicturePan = { x: number; y: number };

// Displayed pixels per picture pixel. At zoom 1 the picture's shorter side just fills the frame.
function pictureScale(size: PictureSize, zoom: number, frame: number): number {
  return (frame / Math.min(size.width, size.height)) * zoom;
}

// The nearest position that leaves no gap between the picture and the frame's edges
export function clampPan(pan: PicturePan, size: PictureSize, zoom: number, frame: number): PicturePan {
  const scale = pictureScale(size, zoom, frame);
  const maxX = Math.max(0, (size.width * scale - frame) / 2);
  const maxY = Math.max(0, (size.height * scale - frame) / 2);
  return { x: Math.min(maxX, Math.max(-maxX, pan.x)), y: Math.min(maxY, Math.max(-maxY, pan.y)) };
}

// The position after a new zoom, keeping the same part of the picture at the frame's center
export function panAfterZoom(pan: PicturePan, size: PictureSize, from: number, to: number, frame: number): PicturePan {
  return clampPan({ x: (pan.x * to) / from, y: (pan.y * to) / from }, size, to, frame);
}

// The size and position to draw the picture at inside the frame, as CSS pixels from the frame's top left
export function pictureBox(pan: PicturePan, size: PictureSize, zoom: number, frame: number) {
  const scale = pictureScale(size, zoom, frame);
  const width = size.width * scale;
  const height = size.height * scale;
  return { width, height, left: (frame - width) / 2 + pan.x, top: (frame - height) / 2 + pan.y };
}

// The square of the picture, in its own pixels, that's showing in the frame
export function cropSquare(pan: PicturePan, size: PictureSize, zoom: number, frame: number) {
  const scale = pictureScale(size, zoom, frame);
  const side = frame / scale;
  return { x: size.width / 2 - pan.x / scale - side / 2, y: size.height / 2 - pan.y / scale - side / 2, side };
}

// Whether an upload starts like a JPEG, the only thing the browser sends
export function looksLikeJpeg(bytes: Uint8Array): boolean {
  return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}
