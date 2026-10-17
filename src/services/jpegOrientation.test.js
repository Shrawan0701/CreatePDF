import { describe, expect, it } from 'vitest';
import { readJpegOrientation } from './jpegOrientation';

function exifJpeg(orientation, littleEndian = true) {
  const bytes = new Uint8Array(40);
  bytes.set([0xff, 0xd8, 0xff, 0xe1, 0, 34, 69, 120, 105, 102, 0, 0]);
  const tiff = new DataView(bytes.buffer, 12, 26);
  tiff.setUint16(0, littleEndian ? 0x4949 : 0x4d4d);
  tiff.setUint16(2, 42, littleEndian);
  tiff.setUint32(4, 8, littleEndian);
  tiff.setUint16(8, 1, littleEndian);
  tiff.setUint16(10, 0x0112, littleEndian);
  tiff.setUint16(12, 3, littleEndian);
  tiff.setUint32(14, 1, littleEndian);
  tiff.setUint16(18, orientation, littleEndian);
  bytes.set([0xff, 0xd9], 38);
  return bytes;
}

describe('JPEG EXIF orientation', () => {
  it.each([true, false])('reads all eight orientations (little endian: %s)', (littleEndian) => {
    for (let orientation = 1; orientation <= 8; orientation++) {
      expect(readJpegOrientation(exifJpeg(orientation, littleEndian))).toBe(orientation);
    }
  });

  it('skips other JPEG metadata segments', () => {
    const source = exifJpeg(6);
    const bytes = new Uint8Array(source.length + 6);
    bytes.set([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0]);
    bytes.set(source.subarray(2), 8);
    expect(readJpegOrientation(bytes)).toBe(6);
  });

  it('honors byte offsets when reading a typed array', () => {
    const bytes = new Uint8Array(60);
    bytes.set(exifJpeg(8), 10);
    expect(readJpegOrientation(bytes.subarray(10, 50))).toBe(8);
  });

  it('defaults safely for missing, invalid, or truncated metadata', () => {
    expect(readJpegOrientation(new Uint8Array())).toBe(1);
    expect(readJpegOrientation(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))).toBe(1);
    expect(readJpegOrientation(exifJpeg(0))).toBe(1);
    expect(readJpegOrientation(exifJpeg(9))).toBe(1);
    const source = exifJpeg(6);
    for (let length = 0; length < 38; length++) {
      expect(readJpegOrientation(source.subarray(0, length))).toBe(1);
    }
    for (const [offset, value] of [[12, 0], [14, 0], [16, 255], [20, 255], [24, 0], [26, 0]]) {
      const invalid = source.slice();
      invalid[offset] = value;
      expect(readJpegOrientation(invalid)).toBe(1);
    }
  });
});
