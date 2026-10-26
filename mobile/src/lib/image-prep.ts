/** Image preparation before OCR.
 * Phone photos of receipts are usually large, low-contrast and slightly warm.
 * Tesseract does much better on a grey, high-contrast, sensibly sized image, so
 * we redraw the photo on a canvas before handing it over.
 *
 * Everything is best-effort: if the browser has no canvas (or the file cannot be
 * decoded), the original file is returned untouched so scanning still works.
 */

/* eslint-disable */

const MAX_EDGE = 1800
const MIN_EDGE = 1000

function supportsCanvas(): boolean {
  return typeof document !== 'undefined' && typeof document.createElement === 'function'
}

async function decode(file: Blob): Promise<ImageBitmap | HTMLImageElement | null> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file)
    } catch {
      // fall through to the <img> path
    }
  }
  if (typeof Image === 'undefined' || typeof URL.createObjectURL !== 'function') return null
  return new Promise((resolve) => {
    const image = new Image()
    const url = URL.createObjectURL(file)
    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      resolve(null)
    }
    image.src = url
  })
}

/** Redraw an image at a workable size with a grey, contrast-stretched palette.
 * Returns a PNG blob, or the original file when preprocessing is not possible.
 */

export async function prepareImageForOcr(file: File | Blob): Promise<Blob> {
  if (!supportsCanvas()) return file

  const source = await decode(file)
  if (!source) return file

  const width = 'width' in source ? source.width : 0
  const height = 'height' in source ? source.height : 0
  if (!width || !height) return file

  const longest = Math.max(width, height)
  let scale = 1
  if (longest > MAX_EDGE) scale = MAX_EDGE / longest
  else if (longest < MIN_EDGE) scale = Math.min(2, MIN_EDGE / longest)

  const targetWidth = Math.max(1, Math.round(width * scale))
  const targetHeight = Math.max(1, Math.round(height * scale))

  try {
    const canvas = document.createElement('canvas')
    canvas.width = targetWidth
    canvas.height = targetHeight
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) return file

    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    context.drawImage(source as CanvasImageSource, 0, 0, targetWidth, targetHeight)

    const pixels = context.getImageData(0, 0, targetWidth, targetHeight)
    const data = pixels.data

    // Contrast pivot around the average luminance so grey paper goes white and
    // ink goes dark without clipping either end.
    let sum = 0
    for (let i = 0; i < data.length; i += 4) {
      sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
    }
    const mean = sum / (data.length / 4)
    const contrast = 1.35
    const pivot = mean

    for (let i = 0; i < data.length; i += 4) {
      const grey = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
      const stretched = Math.max(0, Math.min(255, (grey - pivot) * contrast + pivot))
      data[i] = stretched
      data[i + 1] = stretched
      data[i + 2] = stretched
    }

    context.putImageData(pixels, 0, 0)

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((result) => resolve(result), 'image/png')
    })

    if ('close' in source && typeof source.close === 'function') source.close()
    return blob ?? file
  } catch {
    return file
  }
}