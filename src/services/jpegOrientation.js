// Read the primary image's EXIF orientation, never the thumbnail's IFD.
export function readJpegOrientation(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.byteLength < 2 || view.getUint16(0) !== 0xffd8) return 1;

  let offset = 2;
  while (offset + 4 <= view.byteLength) {
    if (view.getUint8(offset++) !== 0xff) break;
    while (offset < view.byteLength && view.getUint8(offset) === 0xff) offset++;
    if (offset >= view.byteLength) break;
    const marker = view.getUint8(offset++);
    if (marker === 0xda || marker === 0xd9) break; // Scan data / end of image.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > view.byteLength) break;
    const length = view.getUint16(offset);
    const end = offset + length;
    if (length < 2 || end > view.byteLength) break;

    const start = offset + 2;
    if (marker === 0xe1 && start + 14 <= end
      && view.getUint32(start) === 0x45786966 && view.getUint16(start + 4) === 0) {
      const tiff = start + 6;
      const byteOrder = view.getUint16(tiff);
      if (byteOrder !== 0x4949 && byteOrder !== 0x4d4d) return 1;
      const littleEndian = byteOrder === 0x4949;
      if (view.getUint16(tiff + 2, littleEndian) !== 42) return 1;
      const ifdOffset = view.getUint32(tiff + 4, littleEndian);
      const ifd = tiff + ifdOffset;
      if (ifdOffset < 8 || ifd + 2 > end) return 1;
      const count = view.getUint16(ifd, littleEndian);
      if (ifd + 2 + count * 12 > end) return 1;
      for (let index = 0; index < count; index++) {
        const entry = ifd + 2 + index * 12;
        if (entry + 12 > end) return 1;
        if (view.getUint16(entry, littleEndian) !== 0x0112) continue;
        if (view.getUint16(entry + 2, littleEndian) !== 3
          || view.getUint32(entry + 4, littleEndian) !== 1) return 1;
        const orientation = view.getUint16(entry + 8, littleEndian);
        return orientation >= 1 && orientation <= 8 ? orientation : 1;
      }
    }
    offset = end;
  }
  return 1;
}
