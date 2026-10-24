export type PageResult<T> = { data: T[] | null; error: { message: string } | null }

export type PageBuilder<T> = (from: number, to: number) => PromiseLike<PageResult<T>>

export const DEFAULT_PAGE_SIZE = 1000

// The builder must apply a deterministic order ending in a unique column (e.g. id) so pages never overlap or skip rows.
export async function fetchAllPages<T>(
  buildPage: PageBuilder<T>,
  options: { pageSize?: number; maxPages?: number } = {},
): Promise<T[]> {
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE
  const maxPages = options.maxPages ?? 1000
  const rows: T[] = []

  for (let page = 0; page < maxPages; page++) {
    const from = page * pageSize
    const { data, error } = await buildPage(from, from + pageSize - 1)
    if (error) throw new Error(`Failed to load page ${page + 1}: ${error.message}`)
    if (!Array.isArray(data)) throw new Error(`Failed to load page ${page + 1}: unexpected response`)
    rows.push(...data)
    if (data.length < pageSize) return rows
  }

  throw new Error(`Result set exceeded ${maxPages * pageSize} rows; refusing to return a partial list`)
}

export async function fetchAllInChunks<V, T>(
  values: readonly V[],
  load: (chunk: V[]) => Promise<T[]>,
  chunkSize = 200,
): Promise<T[]> {
  const rows: T[] = []
  for (let i = 0; i < values.length; i += chunkSize) {
    rows.push(...(await load(values.slice(i, i + chunkSize))))
  }
  return rows
}
