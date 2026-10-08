import type { VerificationRequest } from './types'

type IdType = VerificationRequest['id_type']

export type IdentityOcrRead = {
  text: string
  confidence: number
  pages: number
}

export type IdentityOcrCheck = { label: string; found: boolean }

export type IdentityOcrAssessment = {
  checks: IdentityOcrCheck[]
  warnings: string[]
  confidence: number
  pages: number
}

function words(value: string) {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ').trim()
}

function hasName(text: string, name: string) {
  const parts = words(name).split(' ').filter(part => part.length > 1)
  if (parts.length < 2) return false
  const padded = ` ${text} `
  return [parts[0], parts[parts.length - 1]].every(part => padded.includes(` ${part} `))
}

const documentCues: Partial<Record<IdType, RegExp>> = {
  national_id: /PHILIPPINE IDENTIFICATION|PAMBANSANG PAGKAKAKILANLAN|PHILSYS|NATIONAL ID/,
  drivers_license: /DRIVER S LICENSE|LAND TRANSPORTATION OFFICE|\bLTO\b/,
  passport: /PASSPORT|P PHL/
}

export function assessIdentityOcr(read: IdentityOcrRead, details: {
  name: string
  idType: IdType
  prcNumber?: string | null
}): IdentityOcrAssessment {
  const text = words(read.text)
  const checks: IdentityOcrCheck[] = []
  const warnings: string[] = []
  if (text.length < 25 || read.confidence < 40) {
    warnings.push('The text is hard to read. Try a sharper, well-lit image with every edge visible.')
  }

  const nameFound = hasName(text, details.name)
  checks.push({ label: 'First and last name appear on the ID', found: nameFound })
  if (!nameFound) warnings.push('The account name could not be matched to the ID text.')

  if (details.idType === 'prc_id') {
    const prcFound = /PROFESSIONAL REGULATION COMMISSION|PROFESSIONAL IDENTIFICATION CARD|\bPRC\b/.test(text)
    const vetFound = /VETERINARIAN|VETERINARY MEDICINE/.test(text)
    const number = (details.prcNumber || '').replace(/\D/g, '')
    const licenseFound = number.length >= 4 && read.text.replace(/\D/g, '').includes(number)
    checks.push({ label: 'PRC card wording appears', found: prcFound })
    checks.push({ label: 'Veterinarian profession appears', found: vetFound })
    checks.push({ label: 'Entered PRC number appears', found: licenseFound })
    if (!prcFound) warnings.push('PRC card wording was not detected.')
    if (!vetFound) warnings.push('The veterinarian profession was not detected.')
    if (!licenseFound) warnings.push('The entered PRC number could not be matched to the card text.')
  } else {
    const cue = documentCues[details.idType]
    if (cue) {
      const found = cue.test(text)
      checks.push({ label: 'Selected ID type appears', found })
      if (!found) warnings.push('The selected ID type could not be recognized from the document.')
    }
  }

  return { checks, warnings, confidence: read.confidence, pages: read.pages }
}

async function pdfPages(file: File): Promise<HTMLCanvasElement[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const workerUrl = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) })
  try {
    const pdf = await loadingTask.promise
    if (pdf.numPages < 1 || pdf.numPages > 2) throw new Error('Use a PDF with one or two ID pages.')
    const canvases: HTMLCanvasElement[] = []
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber)
      const base = page.getViewport({ scale: 1 })
      const scale = Math.min(2, Math.sqrt(4_000_000 / (base.width * base.height)))
      const viewport = page.getViewport({ scale })
      const canvas = document.createElement('canvas')
      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      const context = canvas.getContext('2d')
      if (!context) throw new Error('This browser could not read the PDF page.')
      await page.render({ canvas, canvasContext: context, viewport }).promise
      canvases.push(canvas)
      page.cleanup()
    }
    return canvases
  } finally {
    await loadingTask.destroy()
  }
}

export async function readIdentityDocument(file: File, onProgress?: (message: string) => void): Promise<IdentityOcrRead> {
  const images = file.type === 'application/pdf' ? await pdfPages(file) : [file]
  const { createWorker } = await import('tesseract.js')
  const worker = await createWorker('eng', 1, {
    logger: event => {
      if (event.status === 'recognizing text' && typeof event.progress === 'number') {
        onProgress?.(`Reading ID text… ${Math.round(event.progress * 100)}%`)
      }
    }
  })
  try {
    const results: { text: string; confidence: number }[] = []
    for (const image of images) {
      const { data } = await worker.recognize(image)
      results.push({ text: data.text, confidence: data.confidence })
      if (image instanceof HTMLCanvasElement) { image.width = 0; image.height = 0 }
    }
    return {
      text: results.map(result => result.text).join('\n'),
      confidence: results.reduce((sum, result) => sum + result.confidence, 0) / results.length,
      pages: results.length
    }
  } finally {
    await worker.terminate()
  }
}
