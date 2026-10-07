import { type ImageLayer } from './model';

export function download(name: string, contents: string | Blob, mime = 'text/plain') {
  const blob = contents instanceof Blob ? contents : new Blob([contents], { type: mime });
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function loadImage(file: File): Promise<ImageLayer> {
  if (file.size > 40 * 1024 * 1024) throw new Error('Choose an image smaller than 40 MB.');
  const url = URL.createObjectURL(file);
  try {
    const image = await decodedImage(url);
    if (image.width * image.height > 50000000) throw new Error('Choose an image under 50 megapixels.');
    if (image.width / image.height < .1 || image.width / image.height > 10) throw new Error('Crop the image to a graph before opening it.');
    // Normalize through the browser decoder: no file is sent anywhere.
    const canvas = document.createElement('canvas');
    canvas.width = image.width; canvas.height = image.height;
    canvas.getContext('2d')!.drawImage(image, 0, 0);
    return { data: canvas.toDataURL('image/png'), name: file.name, width: image.width, height: image.height, x: 0, y: 0, scale: 1, rotation: 0 };
  } finally { URL.revokeObjectURL(url); }
}

export async function decodedImage(src: string): Promise<HTMLImageElement> {
  const image = new Image(); image.src = src; await image.decode(); return image;
}
