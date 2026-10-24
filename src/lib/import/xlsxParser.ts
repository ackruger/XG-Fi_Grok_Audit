import * as XLSX from 'xlsx'
import type { ParsedSheet, ParsedWorkbook, SheetType } from './types'

const SHEET_CLASSIFICATION: Record<string, SheetType> = {
  'terms': 'reference',
  'structure': 'reference',
  'abbreviations': 'reference',
  'legend': 'reference',
  'asset': 'asset',
  'assets': 'asset',
  'equipment': 'asset',
  'asset list': 'asset',
  'details': 'detail',
  'detail': 'detail',
  'asset details': 'detail',
  'engineering': 'document',
  'submittals': 'document',
  'drawings': 'document',
  'contractual': 'document',
  'documents': 'document',
  'records': 'document',
  'asset chat': 'activity',
  'post board': 'activity',
  'activity': 'activity',
  'posts': 'activity',
  'forms': 'form',
  'form templates': 'form',
}

export function classifySheet(sheetName: string): SheetType {
  const lower = sheetName.trim().toLowerCase()
  if (SHEET_CLASSIFICATION[lower]) return SHEET_CLASSIFICATION[lower]
  for (const [pattern, type] of Object.entries(SHEET_CLASSIFICATION)) {
    if (lower.includes(pattern)) return type
  }
  return 'unknown'
}

const SHEET_TO_DOC_CATEGORY: Record<string, string> = {
  'engineering': 'engineering',
  'submittals': 'submittal',
  'drawings': 'drawing',
  'contractual': 'contractual',
  'documents': 'other',
  'records': 'record',
}

export function getDocCategoryForSheet(sheetName: string): string {
  const lower = sheetName.trim().toLowerCase()
  return SHEET_TO_DOC_CATEGORY[lower] ?? 'other'
}

function parseSheetData(ws: XLSX.WorkSheet): { headers: string[]; rows: string[][] } {
  const raw: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
  if (raw.length === 0) return { headers: [], rows: [] }

  const maxCols = Math.min(
    raw.reduce((max, row) => Math.max(max, (row as unknown[]).length), 0),
    100
  )

  let headerIdx = -1
  for (let i = 0; i < Math.min(raw.length, 10); i++) {
    const row = raw[i] as unknown[]
    const nonEmpty = row.filter(c => String(c ?? '').trim() !== '')
    if (nonEmpty.length >= 2) {
      headerIdx = i
      break
    }
  }
  if (headerIdx < 0) return { headers: [], rows: [] }

  const headers = (raw[headerIdx] as unknown[])
    .slice(0, maxCols)
    .map(c => String(c ?? '').trim())

  const rows: string[][] = []
  for (let i = headerIdx + 1; i < raw.length; i++) {
    const rawRow = raw[i] as unknown[]
    const cells = rawRow.slice(0, maxCols).map(c => String(c ?? '').trim())
    if (cells.every(c => c === '')) continue
    rows.push(cells)
  }

  return { headers, rows }
}

export async function parseXLSXFile(file: File): Promise<ParsedWorkbook> {
  const buffer = await file.arrayBuffer()
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true, cellStyles: false })

  const sheets: ParsedSheet[] = []
  const referenceSheets: ParsedSheet[] = []
  const documentSheets: ParsedSheet[] = []
  const activitySheets: ParsedSheet[] = []
  const formSheets: ParsedSheet[] = []
  const unknownSheets: ParsedSheet[] = []
  let assetSheet: ParsedSheet | null = null
  let detailSheet: ParsedSheet | null = null

  for (let i = 0; i < wb.SheetNames.length; i++) {
    const name = wb.SheetNames[i]
    const ws = wb.Sheets[name]
    const sheetType = classifySheet(name)
    const { headers, rows } = parseSheetData(ws)

    if (headers.length === 0 && rows.length === 0) continue

    const parsed: ParsedSheet = { name, sheetType, headers, rows, sourceSheetIndex: i }
    sheets.push(parsed)

    switch (sheetType) {
      case 'reference': referenceSheets.push(parsed); break
      case 'asset': if (!assetSheet) assetSheet = parsed; break
      case 'detail': if (!detailSheet) detailSheet = parsed; break
      case 'document': documentSheets.push(parsed); break
      case 'activity': activitySheets.push(parsed); break
      case 'form': formSheets.push(parsed); break
      default: unknownSheets.push(parsed); break
    }
  }

  return {
    sheets,
    referenceSheets,
    assetSheet,
    detailSheet,
    documentSheets,
    activitySheets,
    formSheets,
    unknownSheets,
  }
}
