import { BALANCES, formatCount, groupStock, type StockBalance } from '../domain/stock.ts'

/**
 * Closing stock as a printable A4 checklist, made in the browser. One layout,
 * two uses: the stock list as a blank sheet to fill in by hand, and a count
 * the counter sent, filled in.
 *
 * jsPDF is loaded only when a PDF is asked for, so the RMS does not carry it
 * on every page load. Its built-in font covers Latin-1, so text is kept to
 * that (no em dashes or ticks).
 */

export type ChecklistLine = {
  brand: string
  category: string
  subcategory: string | null
  name: string
  unitLabel: string | null
  trackUnopened: boolean
  trackOpened: boolean
  trackBalance: boolean
  /** Filled in only for a submitted count. */
  unopenedMilli?: number | null
  openedMilli?: number | null
  balance?: StockBalance | null
}

export type ChecklistHeader = {
  businessName: string
  /** Blank sheet: no date, counter or remarks yet. */
  filled: null | { date: string; countedBy: string; sentAt: string; remarks: string | null }
}

const INK: [number, number, number] = [24, 33, 29]
const MUTED: [number, number, number] = [102, 113, 105]
const LINE: [number, number, number] = [200, 196, 186]
const SHADE: [number, number, number] = [241, 238, 230]

type Cell = {
  content: string
  colSpan?: number
  styles?: Record<string, unknown>
  kind?: 'na' | 'blank' | 'balance'
  balance?: StockBalance | null
  /** Drawn small and grey under the item's name. */
  unit?: string | null
}

export async function downloadStockChecklist(lines: ChecklistLine[], header: ChecklistHeader, fileName: string): Promise<void> {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const margin = 14
  const filled = header.filled

  // Title block.
  doc.setTextColor(...MUTED)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.text(header.businessName.toUpperCase(), margin, 16)
  doc.setTextColor(...INK)
  doc.setFontSize(18)
  doc.text(filled ? 'Closing stock count' : 'Closing stock checklist', margin, 24)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  let y = 32
  if (filled) {
    doc.text(`Date: ${filled.date}`, margin, y)
    doc.text(`Counted by: ${filled.countedBy}`, margin + 70, y)
    doc.text(`Sent: ${filled.sentAt}`, margin + 140, y)
  } else {
    doc.text('Date: ______________________', margin, y)
    doc.text('Counted by: ______________________', margin + 80, y)
  }
  y += 5

  const rows: Cell[][] = []
  const groups = groupStock(lines.map((line) => ({ ...line, brandKey: line.brand })))
  const brandCount = groups.length
  for (const brand of groups) {
    if (brandCount > 1) {
      rows.push([{ content: brand.brandKey, colSpan: 4, styles: { fontStyle: 'bold', fontSize: 12, fillColor: [255, 255, 255], cellPadding: { top: 4, bottom: 1, left: 1 } } }])
    }
    for (const category of brand.categories) {
      rows.push([{ content: category.category.toUpperCase(), colSpan: 4, styles: { fontStyle: 'bold', fontSize: 8.5, fillColor: SHADE, textColor: INK } }])
      for (const group of category.subcategories) {
        if (group.subcategory) {
          rows.push([{ content: group.subcategory, colSpan: 4, styles: { fontStyle: 'bold', fontSize: 8, textColor: MUTED, cellPadding: { top: 2, bottom: 0.5, left: 3 } } }])
        }
        for (const line of group.items) {
          // The unit sits under the item's name, so a figure is just the number.
          const quantity = (tracked: boolean, milli: number | null | undefined): Cell => {
            if (!tracked) return { content: '', kind: 'na' }
            if (!filled) return { content: '', kind: 'blank' }
            return { content: milli === null || milli === undefined ? '-' : formatCount(milli), styles: { fontStyle: 'bold', fontSize: 12 } }
          }
          rows.push([
            { content: line.name, unit: line.unitLabel },
            quantity(line.trackUnopened, line.unopenedMilli),
            quantity(line.trackOpened, line.openedMilli),
            line.trackBalance ? { content: '', kind: 'balance', balance: line.balance ?? null } : { content: '', kind: 'na' },
          ])
        }
      }
    }
  }

  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin, bottom: 16 },
    head: [['Item', 'Unopened', 'Opened', 'Balance']],
    body: rows as never,
    theme: 'grid',
    styles: { font: 'helvetica', fontSize: 10, textColor: INK, lineColor: LINE, lineWidth: 0.2, cellPadding: 2.2, valign: 'middle', minCellHeight: 10 },
    headStyles: { fillColor: INK, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8.5 },
    columnStyles: {
      0: { cellWidth: 'auto', fontStyle: 'bold' },
      1: { cellWidth: 30, halign: 'center' },
      2: { cellWidth: 26, halign: 'center' },
      3: { cellWidth: 52, halign: 'center' },
    },
    didParseCell: (data) => {
      if (data.section !== 'body') return
      const raw = data.cell.raw as Cell
      if (raw?.kind === 'na') data.cell.styles.fillColor = [236, 233, 225]
      // Room under the name for its unit.
      if (raw?.unit) data.cell.styles.cellPadding = { top: 2.2, bottom: 6, left: 2.2, right: 2.2 }
    },
    didDrawCell: (data) => {
      if (data.section !== 'body') return
      const raw = data.cell.raw as Cell
      const { x, y: top, width, height } = data.cell
      if (raw?.unit) {
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(8)
        doc.setTextColor(...MUTED)
        doc.text(`in ${raw.unit}`, x + 2.2, top + height - 2.6)
        doc.setTextColor(...INK)
      }
      if (raw?.kind === 'na') {
        doc.setTextColor(...MUTED)
        doc.setFontSize(8)
        doc.text('n/a', x + width / 2, top + height / 2 + 1, { align: 'center' })
        doc.setTextColor(...INK)
      }
      if (raw?.kind === 'blank') {
        // A box to write the figure in.
        doc.setDrawColor(...MUTED)
        doc.setLineWidth(0.3)
        doc.rect(x + 4, top + 1.8, width - 8, height - 3.6)
      }
      if (raw?.kind === 'balance') {
        // Three boxes, > 1/2, 1/2, < 1/2; the counted one filled in.
        const box = 4.2
        const step = width / 3
        doc.setLineWidth(0.3)
        BALANCES.forEach((balance, index) => {
          const cx = x + step * index + 3
          const cy = top + height / 2 - box / 2
          const chosen = raw.balance === balance.value
          doc.setDrawColor(...INK)
          if (chosen) {
            doc.setFillColor(...INK)
            doc.rect(cx, cy, box, box, 'FD')
          } else {
            doc.rect(cx, cy, box, box)
          }
          doc.setFontSize(9)
          doc.setFont('helvetica', chosen ? 'bold' : 'normal')
          doc.setTextColor(...(filled && !chosen ? MUTED : INK))
          doc.text(balance.label, cx + box + 1.5, cy + box - 0.6)
        })
        doc.setFont('helvetica', 'normal')
        doc.setTextColor(...INK)
      }
    },
  })

  // Remarks: the counter's, or lines to write them on.
  const after = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8
  let ry = after
  const pageHeight = doc.internal.pageSize.getHeight()
  if (ry > pageHeight - 45) {
    doc.addPage()
    ry = 20
  }
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...MUTED)
  doc.text('REMINDER FOR TOMORROW / RESTOCK / REMARKS', margin, ry)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(...INK)
  doc.setFontSize(10)
  if (filled) {
    const text = filled.remarks?.trim() || 'None.'
    doc.text(doc.splitTextToSize(text, pageWidth - margin * 2), margin, ry + 6)
  } else {
    doc.setDrawColor(...LINE)
    for (let line = 1; line <= 4; line += 1) doc.line(margin, ry + line * 8, pageWidth - margin, ry + line * 8)
  }

  // Page numbers.
  const pages = doc.getNumberOfPages()
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page)
    doc.setFontSize(8)
    doc.setTextColor(...MUTED)
    doc.text(`Page ${page} of ${pages}`, pageWidth - margin, pageHeight - 8, { align: 'right' })
    doc.text(filled ? `Closing stock count, ${filled.date}` : 'Closing stock checklist', margin, pageHeight - 8)
  }

  doc.save(fileName)
}
