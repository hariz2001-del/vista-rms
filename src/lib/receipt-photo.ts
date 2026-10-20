/**
 * A receipt photo made ready to send to Chopper: phone photos are often 4–8 MB,
 * so it is redrawn at most 2000 px on its long side as a JPEG — plenty for
 * reading, a fraction of the upload. PDFs go as they are (up to 3 MB).
 */
export type ReadyPhoto = { name: string; mime: string; base64: string; previewUrl: string }

const LONG_SIDE = 2000
const MAX_BYTES = 3 * 1024 * 1024

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',', 2)[1] ?? '')
    reader.onerror = () => reject(new Error('The photo could not be read.'))
    reader.readAsDataURL(blob)
  })
}

export async function prepareReceiptPhoto(file: File): Promise<ReadyPhoto> {
  if (file.type === 'application/pdf') {
    if (file.size > MAX_BYTES) throw new Error(`${file.name} is over 3 MB.`)
    return { name: file.name, mime: file.type, base64: await toBase64(file), previewUrl: '' }
  }
  const bitmap = await createImageBitmap(file).catch(() => null)
  if (!bitmap) {
    if (file.size > MAX_BYTES) throw new Error(`${file.name} could not be opened here; send it on Telegram instead.`)
    return { name: file.name, mime: file.type || 'image/jpeg', base64: await toBase64(file), previewUrl: URL.createObjectURL(file) }
  }
  const scale = Math.min(1, LONG_SIDE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  let quality = 0.88
  let blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
  while (blob && blob.size > MAX_BYTES && quality > 0.5) {
    quality -= 0.12
    blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
  }
  if (!blob) throw new Error(`${file.name} could not be prepared.`)
  const name = file.name.replace(/\.[^.]+$/, '') + '.jpg'
  return { name, mime: 'image/jpeg', base64: await toBase64(blob), previewUrl: URL.createObjectURL(blob) }
}
