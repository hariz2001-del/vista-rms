import { Image as ImageIcon, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { Expense } from '../domain/types.ts'
import { apiRequest } from '../lib/http.ts'

type ReceiptImage = { imageBase64: string; mimeType: string; driveUrl: string | null; hasScan: boolean }

export function ExpenseReceipt({ expense }: { expense: Expense }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const requestId = useRef(0)
  const blobUrl = useRef<string | null>(null)
  const [opened, setOpened] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [image, setImage] = useState<{ url: string; mimeType: string; driveUrl: string | null; hasScan: boolean } | null>(null)
  const [original, setOriginal] = useState(false)

  useEffect(() => {
    if (opened) dialog.current?.showModal()
    else dialog.current?.close()
  }, [opened])
  useEffect(() => () => { requestId.current += 1; if (blobUrl.current) URL.revokeObjectURL(blobUrl.current) }, [])

  function close() {
    requestId.current += 1
    setOpened(false)
    setImage(null)
    if (blobUrl.current) { URL.revokeObjectURL(blobUrl.current); blobUrl.current = null }
  }
  async function load(showOriginal = false) {
    setOpened(true)
    setLoading(true)
    setOriginal(showOriginal)
    setError('')
    const current = ++requestId.current
    try {
      const result = await apiRequest<ReceiptImage>('GET', `/rms/expenses/${expense.id}/receipt${showOriginal ? '?original=true' : ''}`)
      if (requestId.current !== current) return
      const bytes = Uint8Array.from(atob(result.imageBase64), (char) => char.charCodeAt(0))
      if (blobUrl.current) URL.revokeObjectURL(blobUrl.current)
      blobUrl.current = URL.createObjectURL(new Blob([bytes], { type: result.mimeType }))
      setImage({ ...result, url: blobUrl.current })
    } catch (reason) {
      if (requestId.current === current) setError(reason instanceof Error ? reason.message : 'Could not load the receipt.')
    } finally { if (requestId.current === current) setLoading(false) }
  }

  if (!expense.receiptDocumentId) return expense.receiptUrl ? <a href={expense.receiptUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-9 items-center gap-1 text-xs font-bold text-ink underline"><ImageIcon aria-hidden="true" className="size-4" />View receipt</a> : null
  return (
    <>
      <button type="button" onClick={() => { void load() }} className="inline-flex min-h-9 items-center gap-1 text-xs font-bold text-ink hover:underline" aria-label={`View receipt for ${expense.description}`}><ImageIcon aria-hidden="true" className="size-4" />View receipt</button>
      <dialog ref={dialog} onCancel={close} onClose={() => { if (opened) close() }} className="m-auto w-[min(95vw,52rem)] max-h-[92vh] overflow-y-auto border border-line bg-canvas p-4 text-ink shadow-xl backdrop:bg-black/50">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div><h2 className="text-lg font-bold">{expense.vendor ?? 'Receipt'}</h2><p className="text-sm text-muted">{expense.description} · {expense.businessDate}</p></div>
          <button type="button" onClick={close} aria-label="Close receipt" className="grid size-10 shrink-0 place-items-center"><X aria-hidden="true" className="size-5" /></button>
        </div>
        <div aria-live="polite">{loading ? <p className="py-6 text-sm text-muted">Loading receipt…</p> : null}{error ? <p role="alert" className="py-4 text-sm text-serious">{error}</p> : null}</div>
        {!loading && !error && image ? <>
          <div className="mb-3 flex flex-wrap gap-3 text-xs font-bold">
            {image.hasScan ? <button type="button" onClick={() => { void load(!original) }} className="min-h-9 underline">{original ? 'Show scan' : 'Show original photo'}</button> : null}
            <a href={image.url} download={`receipt-${expense.id}${original ? '-original' : ''}.${image.mimeType === 'application/pdf' ? 'pdf' : 'jpg'}`} className="inline-flex min-h-9 items-center underline">Download</a>
            {image.driveUrl ? <a href={image.driveUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-9 items-center underline">Open in Drive</a> : null}
          </div>
          {image.mimeType === 'application/pdf' ? <iframe src={image.url} title={`Receipt for ${expense.description}`} className="h-[65vh] w-full" /> : <img src={image.url} alt={`${original ? 'Original photo' : 'Receipt'} from ${expense.vendor ?? expense.description}`} className="mx-auto max-h-[70vh] max-w-full object-contain" />}
        </> : null}
      </dialog>
    </>
  )
}
