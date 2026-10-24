import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fetchAllInChunks, fetchAllPages, type PageResult } from '../src/lib/fetchAllPages.ts'

function source(total: number, opts: { failOnPage?: number } = {}) {
  const rows = Array.from({ length: total }, (_, i) => ({ id: i }))
  const calls: [number, number][] = []
  const build = async (from: number, to: number): Promise<PageResult<{ id: number }>> => {
    calls.push([from, to])
    if (opts.failOnPage !== undefined && calls.length - 1 === opts.failOnPage) {
      return { data: null, error: { message: 'boom' } }
    }
    return { data: rows.slice(from, to + 1), error: null }
  }
  return { build, calls }
}

test('loads more than 1000 rows across pages in order', async () => {
  const { build, calls } = source(3184)
  const result = await fetchAllPages(build)
  assert.equal(result.length, 3184)
  assert.deepEqual(result.map(r => r.id), Array.from({ length: 3184 }, (_, i) => i))
  assert.deepEqual(calls, [[0, 999], [1000, 1999], [2000, 2999], [3000, 3999]])
})

test('returns an empty list for an empty source in one request', async () => {
  const { build, calls } = source(0)
  assert.deepEqual(await fetchAllPages(build), [])
  assert.equal(calls.length, 1)
})

test('handles a partial last page and an exact multiple', async () => {
  assert.equal((await fetchAllPages(source(1500).build)).length, 1500)
  const exact = source(2000)
  assert.equal((await fetchAllPages(exact.build)).length, 2000)
  assert.equal(exact.calls.length, 3)
})

test('throws instead of returning a partial set when a later page fails', async () => {
  const { build } = source(2500, { failOnPage: 2 })
  await assert.rejects(fetchAllPages(build), /page 3: boom/)
})

test('throws on a malformed page', async () => {
  await assert.rejects(fetchAllPages(async () => ({ data: null, error: null })), /unexpected response/)
})

test('refuses to silently truncate past the page cap', async () => {
  await assert.rejects(fetchAllPages(source(50).build, { pageSize: 10, maxPages: 3 }), /refusing to return a partial list/)
})

test('fetchAllInChunks covers every value and propagates failures', async () => {
  const values = Array.from({ length: 450 }, (_, i) => i)
  const seen: number[][] = []
  const rows = await fetchAllInChunks(values, async chunk => { seen.push(chunk); return chunk }, 200)
  assert.equal(rows.length, 450)
  assert.deepEqual(seen.map(c => c.length), [200, 200, 50])
  assert.deepEqual(await fetchAllInChunks([], async () => [1]), [])
  await assert.rejects(
    fetchAllInChunks(values, async chunk => { if (chunk[0] === 200) throw new Error('chunk failed'); return chunk }, 200),
    /chunk failed/,
  )
})
