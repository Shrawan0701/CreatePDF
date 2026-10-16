import { getPdfLib } from './pdfEngine';

export const MM_TO_PT = 72 / 25.4;
export const PAPER_MM = { A4: [210, 297], Letter: [215.9, 279.4] };

export function passportLayout({ width, height, paper = 'A4', margin = 10, spacing = 5 }, photos) {
  const dimensions = PAPER_MM[paper];
  if (!dimensions || ![width, height, margin, spacing].every(Number.isFinite) || width < 5 || height < 5 || width > 250 || height > 350 || margin < 0 || spacing < 0) throw new Error('Enter photo dimensions of at least 5 mm (up to 250 × 350 mm), with nonnegative margins and spacing.');
  const [pageWidth, pageHeight] = dimensions;
  const columns = Math.floor((pageWidth - 2 * margin + spacing + 1e-8) / (width + spacing));
  const rows = Math.floor((pageHeight - 2 * margin + spacing + 1e-8) / (height + spacing));
  if (columns < 1 || rows < 1) throw new Error('The photo does not fit on this paper. Reduce photo size or margins.');
  if (!photos.length || photos.some((photo) => !Number.isInteger(photo.copies) || photo.copies < 1 || photo.copies > 100)) throw new Error('Choose 1–100 copies per photo.');
  const total = photos.reduce((count, photo) => count + photo.copies, 0);
  if (total > 500) throw new Error('Generate up to 500 photos per sheet PDF.');
  const capacity = rows * columns;
  const placements = [];
  photos.forEach((photo, photoIndex) => {
    for (let copy = 0; copy < photo.copies; copy++) {
      const index = placements.length, cell = index % capacity;
      placements.push({ photoIndex, page: Math.floor(index / capacity), x: margin + (cell % columns) * (width + spacing), y: margin + Math.floor(cell / columns) * (height + spacing), width, height });
    }
  });
  return { pageWidth, pageHeight, pageCount: Math.ceil(total / capacity), columns, rows, placements };
}

export function photoCrop(imageWidth, imageHeight, ratio, zoom = 1, x = 50, y = 50) {
  const cropWidth = Math.min(imageWidth, imageHeight * ratio) / zoom;
  const cropHeight = cropWidth / ratio;
  return { x: (imageWidth - cropWidth) * x / 100, y: (imageHeight - cropHeight) * y / 100, width: cropWidth, height: cropHeight };
}

export function paintPhoto(canvas, photo, width, height, pixels = null) {
  const crop = photoCrop(photo.bitmap.width, photo.bitmap.height, width / height, photo.zoom, photo.x, photo.y);
  canvas.width = Math.max(1, pixels?.width || Math.round(width / 25.4 * 300));
  canvas.height = Math.max(1, pixels?.height || Math.round(height / 25.4 * 300));
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
  context.drawImage(photo.bitmap, crop.x, crop.y, crop.width, crop.height, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export async function buildPassportSheet(options, photos, onStatus = () => {}) {
  const layout = passportLayout(options, photos);
  const { PDFDocument, rgb } = await getPdfLib();
  const pdf = await PDFDocument.create();
  pdf.setTitle('Passport photo sheet — print at actual size');
  const images = [];
  for (let i = 0; i < photos.length; i++) {
    onStatus(`Preparing photograph ${i + 1} of ${photos.length}…`);
    const canvas = paintPhoto(document.createElement('canvas'), photos[i], options.width, options.height);
    const blob = await new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Unable to prepare photograph.')), 'image/jpeg', .98));
    images.push(await pdf.embedJpg(await blob.arrayBuffer()));
    canvas.width = canvas.height = 0;
  }
  const pages = Array.from({ length: layout.pageCount }, () => pdf.addPage([layout.pageWidth * MM_TO_PT, layout.pageHeight * MM_TO_PT]));
  for (const placement of layout.placements) {
    const page = pages[placement.page];
    const x = placement.x * MM_TO_PT, y = (layout.pageHeight - placement.y - placement.height) * MM_TO_PT;
    const width = placement.width * MM_TO_PT, height = placement.height * MM_TO_PT;
    page.drawImage(images[placement.photoIndex], { x, y, width, height });
    if (options.guides) {
      const tick = Math.min(2, options.spacing > 0 ? options.spacing / 2 : .5) * MM_TO_PT;
      const draw = (x1, y1, x2, y2) => page.drawLine({ start: { x: Math.max(0, x1), y: Math.max(0, y1) }, end: { x: Math.min(page.getWidth(), x2), y: Math.min(page.getHeight(), y2) }, thickness: .3, color: rgb(.35, .35, .35) });
      for (const cornerX of [x, x + width]) for (const cornerY of [y, y + height]) {
        draw(cornerX === x ? x - tick : x + width, cornerY, cornerX === x ? x : x + width + tick, cornerY);
        draw(cornerX, cornerY === y ? y - tick : y + height, cornerX, cornerY === y ? y : y + height + tick);
      }
    }
  }
  return { blob: new Blob([await pdf.save()], { type: 'application/pdf' }), layout };
}
