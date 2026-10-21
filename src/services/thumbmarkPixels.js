const clamp = (value, low = 0, high = 255) => Math.max(low, Math.min(high, value))

function blurBackground(gray, width, height, radius) {
  const horizontal = new Uint8Array(gray.length), output = new Uint8Array(gray.length)
  for (let y = 0; y < height; y++) {
    const row = y * width; let sum = 0, left = 0, right = Math.min(width - 1, radius)
    for (let x = left; x <= right; x++) sum += gray[row + x]
    for (let x = 0; x < width; x++) {
      horizontal[row + x] = Math.round(sum / (right - left + 1))
      const nextLeft = Math.max(0, x + 1 - radius), nextRight = Math.min(width - 1, x + 1 + radius)
      while (left < nextLeft) sum -= gray[row + left++]
      while (right < nextRight) sum += gray[row + ++right]
    }
  }
  for (let x = 0; x < width; x++) {
    let sum = 0, top = 0, bottom = Math.min(height - 1, radius)
    for (let y = top; y <= bottom; y++) sum += horizontal[y * width + x]
    for (let y = 0; y < height; y++) {
      output[y * width + x] = Math.round(sum / (bottom - top + 1))
      const nextTop = Math.max(0, y + 1 - radius), nextBottom = Math.min(height - 1, y + 1 + radius)
      while (top < nextTop) sum -= horizontal[top++ * width + x]
      while (bottom < nextBottom) sum += horizontal[++bottom * width + x]
    }
  }
  return output
}

export function processThumbmarkPixels({ data, width, height, options }) {
  const gray = new Uint8Array(width * height), histogram = new Uint32Array(256)
  let samples = 0
  for (let index = 0, pixel = 0; index < data.length; index += 4, pixel++) {
    const opacity = data[index + 3] / 255
    const luminance = (.2126 * data[index] + .7152 * data[index + 1] + .0722 * data[index + 2]) * opacity + 255 * (1 - opacity)
    const value = Math.round(options.invert ? 255 - luminance : luminance)
    gray[pixel] = value
    if (data[index + 3] > 8) { histogram[value]++; samples++ }
  }
  let paper = 255, total = 0
  for (let value = 0; value < 256; value++) { total += histogram[value]; if (total >= samples * .92) { paper = value; break } }
  // Transparent source images already have a clean paper layer.
  if (paper < 100 || samples < gray.length * .98) paper = 255
  const threshold = clamp(paper - Number(options.cleanup) * .95, 40, 255)
  const span = 20 + Number(options.softness) * 1.65
  const background = options.evenLighting ? blurBackground(gray, width, height, Math.max(6, Math.min(90, Math.round(Math.min(width, height) * .035)))) : null
  const ink = [1, 3, 5].map(offset => parseInt(options.ink.slice(offset, offset + 2), 16))
  const strength = Number(options.strength) / 100
  let left = width, top = height, right = -1, bottom = -1, visible = 0
  for (let index = 0, pixel = 0; index < data.length; index += 4, pixel++) {
    let luminance = gray[pixel]
    if (background) luminance = clamp(luminance + (paper - background[pixel]) * .8)
    const coverage = clamp((threshold - luminance) / span, 0, 1)
    if (options.removeBackground) data[index + 3] = clamp(Math.round(data[index + 3] * coverage * strength))
    if (options.colorMode === 'ink') {
      const tint = options.removeBackground ? 1 : clamp(coverage * strength, 0, 1)
      for (let channel = 0; channel < 3; channel++) data[index + channel] = Math.round(data[index + channel] * (1 - tint) + ink[channel] * tint)
    }
    if (data[index + 3] > 12) {
      const x = pixel % width, y = Math.floor(pixel / width)
      left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y); visible++
    }
  }
  const bounds = visible ? { x: left, y: top, width: right - left + 1, height: bottom - top + 1 } : null
  return { data, width, height, bounds, visible }
}
