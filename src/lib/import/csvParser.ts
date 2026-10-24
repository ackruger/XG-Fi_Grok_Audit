import type { SourceSection, SourceRecord, DictionaryEntry, SectionIndex, DuplicateEntry } from './types'

export function parseCSVLine(line: string): string[] {
  const cells: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        current += ch
      }
    } else {
      if (ch === '"') {
        inQuotes = true
      } else if (ch === ',') {
        cells.push(current.trim())
        current = ''
      } else {
        current += ch
      }
    }
  }
  cells.push(current.trim())
  return cells
}

function isBlankRow(cells: string[]): boolean {
  return cells.every(c => c === '')
}

/* ── Sub-header / unit-row detection ── */

const UNIT_TOKENS = new Set([
  'cfm','l/s','l/min','°f','°c','in h2o','pa','fpm','m/s','ft h2o','kpa',
  'psig','us gpm','usg','gal','liter','lb','lbs','kg','mbh','kw','bhp',
  'btuh','w/m','mm','hp','fla','--',
])

const HEADER_STARTS = [
  'mca', 'mop', 'dry bulb', 'wet bulb', 'band', 'fluid', 'flow rate',
  'entering', 'leaving', 'press', 'height', 'diameter', 'no.2 oil',
  'no. 2 oil', 'nature gas', 'intake', 'discharge', 'starter type',
  'power type', 'n,e,l', 'n,c,d,v', 'fasd', 'fasu', 'vaf',
]

function looksLikeUnitOrHeader(cell: string): boolean {
  const lower = cell.toLowerCase().trim()
  if (!lower) return false
  if (UNIT_TOKENS.has(lower)) return true
  for (const h of HEADER_STARTS) {
    if (lower.startsWith(h)) return true
  }
  if (/^\d(st|nd|rd|th) band$/i.test(lower)) return true
  if (/^[A-Z\s/°.]{2,}$/.test(cell.trim()) && cell.trim().length <= 12) return true
  return false
}

function isSubHeaderRow(cells: string[]): boolean {
  if (cells[0] && cells[0].trim()) return false
  const nonEmpty = cells.filter(c => c.trim())
  if (nonEmpty.length === 0) return false
  if (nonEmpty.length === 1 && (nonEmpty[0] === '0' || nonEmpty[0] === '.')) return true
  const desc = (cells[1] || '').trim()
  if (desc && desc.length > 10 && !looksLikeUnitOrHeader(desc)) return false
  const headerLike = nonEmpty.filter(c => looksLikeUnitOrHeader(c))
  return headerLike.length >= nonEmpty.length * 0.5
}

/* ── Section header detection ── */

const COMMON_HEADER_KEYWORDS = [
  'function', 'description', 'level', 'area served', 'status',
  'power characteristics', 'remarks', 'starter type', 'voltage',
  'airflow', 'capacity', 'temperature', 'pressure',
]

const KNOWN_SECTION_NAMES = new Set([
  'AIR HANDLING UNITS',
  'CHANGEOVER COILS (COOLING PERFORMANCE) / COOLING COILS / HEAT RECOVERY COILS',
  'CHANGEOVER COILS (HEATING PERFORMANCE)',
  'RE-HEAT COILS',
  'HUMIDIFIERS',
  'FANS',
  'HEPA FILTERS',
  'POWERED HEPA AIR TERMINALS',
  'CHILLERS',
  'FLUID COOLERS',
  'BOILER PLANT',
  'PUMPS',
  'HEAT EXCHANGERS',
  'EXPANSION TANKS',
  'FAN COIL UNITS',
  'BARE FIN TUBE',
  'RADIANT GAS HEATERS',
  'FORCE FLOW HEATERS',
  'UNIT HEATERS',
  'AIR CURTAINS',
  'DOMESTIC HOT WATER TANKS',
  'VAV/CAV BOXES',
  'MEDICAL GAS EQUIPMENT',
  'FUEL OIL TANKS',
  'STORAGE TANKS',
  'RO EQUIPMENT',
  'PRECISION AIR VALVES',
  'PNEUMATIC TUBE SYSTEMS',
  'PLUMBING',
  'SILENCER',
  'DAMPERS',
  'COMPRESSORS',
  'ELECTRIC DUCT HEATERS',
  'INSTREAM UV DUCT TREATMENT SECTIONS',
])

function isSectionHeaderRow(cells: string[]): boolean {
  const firstCell = (cells[0] || '').trim()
  if (!firstCell) return false
  if (KNOWN_SECTION_NAMES.has(firstCell)) return true
  if (firstCell !== firstCell.toUpperCase()) return false
  if (/^\d/.test(firstCell)) return false
  if (firstCell.length < 3) return false
  // Asset tags contain digit-dash patterns like AHU-L04-3-A-01 — reject them
  if (/[A-Z]+-[A-Z0-9]+-\d/.test(firstCell)) return false
  if (/^[A-Z]+-\d/.test(firstCell)) return false
  // Section headers have "FUNCTION/ DESCRIPTION" or "LEVEL" or "STATUS" in cells 1-4
  const cell1 = (cells[1] || '').trim().toUpperCase()
  const hasDescHeader = cell1.includes('FUNCTION') || cell1.includes('DESCRIPTION')
  const cell2 = (cells[2] || '').trim().toUpperCase()
  const hasLevelHeader = cell2 === 'LEVEL' || cell2.includes('LEVEL')
  if (hasDescHeader && hasLevelHeader) return true
  const otherNonEmpty = cells.slice(1).filter(c => c.trim())
  if (otherNonEmpty.length < 3) return false
  const headerMatches = otherNonEmpty.filter(c => {
    const lower = c.toLowerCase()
    return COMMON_HEADER_KEYWORDS.some(kw => lower.includes(kw))
  })
  return headerMatches.length >= 2
}

function isInternalLabelRow(cells: string[]): boolean {
  const firstCell = (cells[0] || '').trim()
  if (!firstCell) return false
  // Continuation header: col A contains commas (CSV-wrapped multi-column header text)
  if (firstCell.includes(',') && firstCell.length > 30) return true
  // Frequency band header: starts with ( and contains hz)
  if (/^\(.*hz\)/i.test(firstCell)) return true
  // Sub-section label: ALL CAPS multi-word, no dash-number pattern, col B empty or "CONTROL PANEL"
  if (firstCell === firstCell.toUpperCase() && /\s/.test(firstCell) && !/[A-Z]+-\d/.test(firstCell)) {
    const desc = (cells[1] || '').trim()
    const level = (cells[2] || '').trim()
    if (!desc && !level) return true
    if (/^CONTROL PANEL/i.test(desc)) return true
  }
  return false
}

function isDataRow(cells: string[]): boolean {
  if (isBlankRow(cells)) return false
  if (isSubHeaderRow(cells)) return false
  if (isInternalLabelRow(cells)) return false
  const nonEmpty = cells.filter(c => c.trim())
  if (nonEmpty.length < 2) return false
  const firstCell = (cells[0] || '').trim()
  if (firstCell) {
    if (/^[A-Z0-9]+-/.test(firstCell) || /^[A-Z]{2,}/.test(firstCell)) return true
  }
  const desc = (cells[1] || '').trim()
  if (desc && desc.length > 3) return true
  return nonEmpty.length >= 3
}

function isLikelyEquipmentRecord(cells: string[]): boolean {
  const tag = (cells[0] || '').trim()
  const desc = (cells[1] || '').trim()
  const level = (cells[2] || '').trim()
  if (tag && /^[A-Z0-9]+-/.test(tag)) return true
  if (!tag && desc && desc.length > 5) {
    if (level && /level|l\d|varies|site/i.test(level)) return true
    const nonEmpty = cells.filter(c => c.trim())
    if (nonEmpty.length >= 3) return true
  }
  return false
}

/* ── Content-driven section detection ── */

interface DetectedSectionBoundary {
  name: string
  headerStartRow: number
  dataStartRow: number
  endRow: number
}

function detectSectionBoundaries(allRows: string[][]): DetectedSectionBoundary[] {
  const boundaries: DetectedSectionBoundary[] = []
  let i = 0

  while (i < allRows.length) {
    if (isSectionHeaderRow(allRows[i])) {
      const headerStart = i
      const sectionName = (allRows[i][0] || '').trim()
      let dataStart = i + 1
      while (dataStart < allRows.length) {
        const row = allRows[dataStart]
        if (isBlankRow(row)) { dataStart++; continue }
        if (isSubHeaderRow(row)) { dataStart++; continue }
        if (isSectionHeaderRow(row)) break
        if (isDataRow(row) || isLikelyEquipmentRecord(row)) break
        dataStart++
      }
      boundaries.push({ name: sectionName, headerStartRow: headerStart, dataStartRow: dataStart, endRow: allRows.length - 1 })
      i = dataStart
    } else {
      i++
    }
  }

  for (let b = 0; b < boundaries.length - 1; b++) {
    let end = boundaries[b + 1].headerStartRow - 1
    while (end > boundaries[b].dataStartRow && isBlankRow(allRows[end])) end--
    boundaries[b].endRow = end
  }

  return boundaries
}

/* ── Main content-driven parser ── */

export function parseMultiSectionCSV(
  text: string,
  dictionary: DictionaryEntry[]
): SourceSection[] {
  const allLines = text.split('\n')
  const allRows = allLines.map(l => parseCSVLine(l))
  const boundaries = detectSectionBoundaries(allRows)

  const dictBySection = new Map<string, DictionaryEntry[]>()
  for (const d of dictionary) {
    const arr = dictBySection.get(d.section) || []
    arr.push(d)
    dictBySection.set(d.section, arr)
  }

  const sections: SourceSection[] = []

  for (const boundary of boundaries) {
    const headerRows: string[][] = []
    for (let r = boundary.headerStartRow; r < boundary.dataStartRow && r < allRows.length; r++) {
      headerRows.push(allRows[r])
    }

    const dict = dictBySection.get(boundary.name) || []
    const columnHeaders = buildColumnHeaders(headerRows, dict)

    const records: SourceRecord[] = []
    for (let r = boundary.dataStartRow; r <= boundary.endRow && r < allRows.length; r++) {
      const cells = allRows[r]
      if (isBlankRow(cells)) continue

      const subHeader = isSubHeaderRow(cells)
      if (subHeader) continue

      if (!isDataRow(cells) && !isLikelyEquipmentRecord(cells)) continue

      const assetTag = cells[0] || ''
      const description = cells[1] || ''
      const level = cells[2] || ''
      const areaServed = findCommonField(cells, dict, 'area_served') || cells[3] || ''
      const sourceStatus = findCommonField(cells, dict, 'source_status') || cells[4] || ''

      records.push({
        sourceRow: r + 1,
        sourceSection: boundary.name,
        rawCells: cells,
        assetTag,
        description,
        level,
        areaServed,
        sourceStatus,
        isUntagged: assetTag === '',
        flaggedRows: [],
      })
    }

    sections.push({
      name: boundary.name,
      rowStart: boundary.headerStartRow + 1,
      rowEnd: boundary.endRow + 1,
      dataStart: boundary.dataStartRow + 1,
      headerRows,
      columnHeaders,
      records,
    })
  }

  return sections
}

/* ── Column header building ── */

function buildColumnHeaders(headerRows: string[][], dict: DictionaryEntry[]): string[] {
  const maxCols = Math.max(...headerRows.map(r => r.length), 0)
  const headers: string[] = Array.from({ length: maxCols }, () => '')

  for (const d of dict) {
    const idx = columnLetterToIndex(d.column)
    if (idx < maxCols) {
      headers[idx] = d.sourceHeader
    }
  }

  const hasAnyFromDict = headers.some(h => h !== '')
  if (!hasAnyFromDict && headerRows.length > 0) {
    for (let i = 0; i < headerRows[0].length; i++) {
      if (headerRows[0][i] && i < headers.length) headers[i] = headerRows[0][i]
    }
  }

  return headers
}

function findCommonField(cells: string[], dict: DictionaryEntry[], role: string): string | null {
  const entry = dict.find(d => d.sourceRole === role)
  if (!entry) return null
  const idx = columnLetterToIndex(entry.column)
  return idx < cells.length ? cells[idx] : null
}

/* ── Reference file parsers (for validation comparison only) ── */

export function parseSectionsCSV(text: string): SectionIndex[] {
  const lines = text.split('\n').filter(l => l.trim())
  const results: SectionIndex[] = []
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCSVLine(lines[i])
    if (cells.length < 7) continue
    results.push({
      section: cells[0],
      rowStart: parseInt(cells[1]),
      rowEnd: parseInt(cells[2]),
      dataStart: parseInt(cells[3]),
      recordCount: parseInt(cells[4]),
      firstRecord: cells[5],
      lastRecord: cells[6],
    })
  }
  return results
}

export function parseDictionaryCSV(text: string): DictionaryEntry[] {
  const lines = text.split('\n').filter(l => l.trim())
  const results: DictionaryEntry[] = []
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCSVLine(lines[i])
    if (cells.length < 9) continue
    results.push({
      section: cells[0],
      rowStart: parseInt(cells[1]),
      rowEnd: parseInt(cells[2]),
      dataStart: parseInt(cells[3]),
      recordCount: parseInt(cells[4]),
      column: cells[5],
      sourceHeader: cells[6],
      suggestedAppSection: cells[7],
      sourceRole: cells[8],
    })
  }
  return results
}

export function parseDuplicatesCSV(text: string): DuplicateEntry[] {
  const lines = text.split('\n').filter(l => l.trim())
  const results: DuplicateEntry[] = []
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCSVLine(lines[i])
    if (cells.length < 5) continue
    results.push({
      assetTag: cells[0],
      occurrenceCount: parseInt(cells[1]),
      row: parseInt(cells[2]),
      section: cells[3],
      likelyProfilePair: cells[4].toUpperCase() === 'TRUE',
    })
  }
  return results
}

export function columnLetterToIndex(col: string): number {
  let idx = 0
  for (let i = 0; i < col.length; i++) {
    idx = idx * 26 + (col.charCodeAt(i) - 64)
  }
  return idx - 1
}
