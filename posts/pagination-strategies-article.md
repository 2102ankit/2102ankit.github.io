---
title: "Pagination Strategies in Modern Applications"
description: "Every pagination strategy, with worked examples"
date: 2026-04-18
show: true
---

A listing page that loads in 50ms on day one can take 8 seconds a year later, with no code changes. The usual cause is a query like this:

```sql
SELECT * FROM products ORDER BY created_at OFFSET 950000 LIMIT 20
```

To return 20 rows, the database reads and discards nearly a million before handing you the page. That cost grows with every row you add.

This post walks through every pagination strategy worth knowing — no pagination, offset, keyset with single and composite sorts, opaque and signed cursors, hybrid checkpoints, snapshot-based pagination for random access over large data, and search-engine pagination — each with a worked example you can follow row by row.

It closes with the reliability details that decide whether any of these survive contact with production. Examples are in T-SQL, but the ideas apply to any relational database.

## Why pagination matters

Three concerns push in the same direction. Fetching thousands of rows to display 20 wastes CPU, memory, I/O, and network bandwidth, so a query that takes 50ms on 10,000 rows can take seconds on 10,000,000. Users feel that directly: a page that loads in under 200ms feels instant, while one that takes 3 seconds feels broken.

The goal of pagination is to make the cost of one page independent of total dataset size, so that page 5 and page 50,000 feel the same.

## Strategy 1: No pagination

The starting point for most applications is to return everything and let the client sort it out.

```sql
SELECT ProductId, Name, Price, CreatedAt
FROM Products
ORDER BY CreatedAt DESC;
```

This is perfectly reasonable for datasets that are small and bounded by definition. A dropdown of 50 states, a list of 30 internal expense categories, or a feature-flag list with a dozen entries will never grow enough to cause trouble, and adding pagination machinery would only add code with no benefit.

It breaks the moment the row count is unbounded or outside your control. Consider an orders table that grows by a few thousand rows a day. After a year, a single "list all orders" request transfers hundreds of thousands of rows, allocates memory for all of them on both server and client, and renders thousands of DOM nodes.

Mobile clients crash first, but even desktop browsers degrade badly past a few thousand rows. The failure mode is gradual and then sudden: every week gets slightly slower until one day the page stops loading at all.

The rule is simple. If the row count has a natural ceiling you can state with confidence, skipping pagination is fine. If the row count grows with usage — orders, posts, products, events, messages — paginate from the start, because retrofitting pagination under load is far more painful than adding it early.

## Strategy 2: Offset-based pagination

Offset is the most intuitive strategy. The client asks for a page number and a page size, and the database skips `(page - 1) * pageSize` rows before returning the next page.

```sql
-- Page 5, 20 items per page: skip 80, take 20
SELECT ProductId, Name, Price, CreatedAt
FROM Products
ORDER BY CreatedAt DESC
OFFSET 80 ROWS
FETCH NEXT 20 ROWS ONLY;
```

A typical REST API wraps this with page metadata:

```json
GET /api/products?page=5&limit=20

{
  "data": [...],
  "total": 142300,
  "page": 5,
  "pageSize": 20,
  "totalPages": 7115
}
```

The implementation is a few lines of code, and the user experience is familiar: numbered pages, a total count, and the ability to jump straight to any page. For that reason, offset is the default choice for admin dashboards, internal tools, and reporting screens, where datasets are modest and users genuinely navigate by page number.

### Worked example: how the pages advance

Suppose `Products` holds 103 rows sorted by `CreatedAt DESC`, and the page size is 20. Page 1 uses `OFFSET 0`, page 2 uses `OFFSET 20`, and so on through page 5 at `OFFSET 80`. Page 6 requests `OFFSET 100` and receives the final 3 rows.

Each request is self-contained: the server needs no memory of previous requests, because the page number fully determines the query. That statelessness is offset's main architectural virtue.

### Why deep pages get slow

The database cannot jump to an offset. To satisfy `OFFSET 950000`, it must walk through 950,000 rows in sort order, discard them, and then return the next 20. The work is proportional to the offset, not the page size, so page 50,000 costs roughly ten thousand times more than page 5.

An index on the sort column helps with ordering but does not remove the skipping: the engine still counts off and throws away nearly a million index entries before producing your page. This is why offset latency looks flat for the first few hundred pages and then climbs steeply.

<figure>
  <svg viewBox="0 0 640 190" role="img" aria-label="Offset pagination scans and discards 950,000 rows to return 20">
    <rect x="24" y="56" width="452" height="44" rx="8" style="fill:var(--card);stroke:var(--fainter);stroke-width:1.5;stroke-dasharray:6 4;"/>
    <text x="250" y="75" text-anchor="middle" font-size="13" style="fill:var(--muted);">950,000 rows scanned</text>
    <text x="250" y="92" text-anchor="middle" font-size="12" style="fill:var(--faint);">then discarded</text>
    <rect x="484" y="56" width="132" height="44" rx="8" style="fill:var(--accent);"/>
    <text x="550" y="82" text-anchor="middle" font-size="13" font-weight="600" style="fill:#fff;">20 returned</text>
    <line x1="24" y1="124" x2="616" y2="124" stroke-width="1.5" style="stroke:var(--faint);"/>
    <polygon points="616,124 606,119 606,129" style="fill:var(--faint);"/>
    <text x="24" y="144" font-size="12" style="fill:var(--faint);">read direction</text>
    <text x="616" y="144" text-anchor="end" font-size="12" style="fill:var(--faint);">OFFSET 950000 · LIMIT 20</text>
    <text x="24" y="30" font-size="12" style="fill:var(--faint);">SELECT … ORDER BY created_at</text>
  </svg>
  <figcaption>Offset pays for every row it skips.</figcaption>
</figure>

### Why results shift under writes

Offset addresses rows by position, and positions move whenever data changes. Walk through a concrete case. A user loads page 1 (rows 1–20). Before they request page 2, another user inserts a new product at the top of the sort order. Every existing row shifts down one position, so when page 2 is fetched with `OFFSET 20`, the row that was last on page 1 now appears first on page 2 — the user sees it twice.

Deletions cause the mirror problem: a row deleted from page 1 pulls every later row up one position, so the first row of page 2 was already shown as the last row of page 1, and the user never sees it. On a busy table, these glitches are not rare edge cases; they happen on nearly every multi-page session.

### Why the total count is expensive

The `total` field in the response above requires a separate `COUNT(*)` over the full filtered set. On a large table with filters and joins, that count can cost as much as the page query itself — sometimes more, since it cannot stop after 20 rows.

Many teams return totals unconditionally because the UI framework expects them, then discover the count query is the slowest statement in their workload. Unless the interface genuinely renders "Page X of Y," prefer a cheaper `hasMore` signal, discussed below.

Offset is the right tool for small datasets (roughly under 100,000 rows), internal dashboards, and anywhere users must jump to arbitrary pages while deep navigation stays rare. It is the wrong tool for public feeds, large tables, and anything that grows without bound.

## Strategy 3: Keyset pagination

Keyset pagination — also called cursor-based or seek pagination — replaces positions with places. Instead of saying "skip N rows," the client says "continue after this row," passing back a cursor that holds the sort values of the last row it received. The database then seeks directly to that point in the index.

### Example A: single-column sort

The simplest case is a table ordered by a unique, ever-increasing column such as an identity primary key. Consider a `Posts` table with `PostId` values 1 through 100, page size 10, newest last:

```sql
-- First page: no cursor yet, start from the beginning
SELECT TOP 10 PostId, Title, CreatedAt
FROM Posts
ORDER BY PostId ASC;

-- Returns PostId 1..10. The cursor for the next request is { lastPostId: 10 }.

-- Second page: continue after PostId 10
SELECT TOP 10 PostId, Title, CreatedAt
FROM Posts
WHERE PostId > 10
ORDER BY PostId ASC;

-- Returns PostId 11..20. Cursor becomes { lastPostId: 20 }.
```

Each page performs a single index seek to the cursor position and reads exactly 10 rows. Page 2 costs the same as page 10,000, because no rows are ever skipped and discarded. Now suppose a new post (PostId 101) is inserted while the user reads page 3. The existing rows keep their positions relative to the cursor, so page 4 still starts exactly where page 3 ended — no duplicates, no gaps.

Rows inserted ahead of the cursor appear on the next fetch only if they fall after it in sort order; rows behind it were already seen. That stability under concurrent writes is the reason feeds and timelines use this strategy.

<figure>
  <svg viewBox="0 0 640 215" role="img" aria-label="Keyset pagination seeks from the cursor and reads the next ten rows with nothing skipped">
    <g style="fill:var(--accent-soft);stroke:var(--accent);stroke-width:1;">
      <rect x="50" y="80" width="22" height="40" rx="5"/>
      <rect x="76" y="80" width="22" height="40" rx="5"/>
      <rect x="102" y="80" width="22" height="40" rx="5"/>
      <rect x="128" y="80" width="22" height="40" rx="5"/>
      <rect x="154" y="80" width="22" height="40" rx="5"/>
      <rect x="180" y="80" width="22" height="40" rx="5"/>
      <rect x="206" y="80" width="22" height="40" rx="5"/>
      <rect x="232" y="80" width="22" height="40" rx="5"/>
      <rect x="258" y="80" width="22" height="40" rx="5"/>
      <rect x="284" y="80" width="22" height="40" rx="5"/>
    </g>
    <g style="fill:var(--accent);">
      <rect x="310" y="80" width="22" height="40" rx="5"/>
      <rect x="336" y="80" width="22" height="40" rx="5"/>
      <rect x="362" y="80" width="22" height="40" rx="5"/>
      <rect x="388" y="80" width="22" height="40" rx="5"/>
      <rect x="414" y="80" width="22" height="40" rx="5"/>
      <rect x="440" y="80" width="22" height="40" rx="5"/>
      <rect x="466" y="80" width="22" height="40" rx="5"/>
      <rect x="492" y="80" width="22" height="40" rx="5"/>
      <rect x="518" y="80" width="22" height="40" rx="5"/>
      <rect x="544" y="80" width="22" height="40" rx="5"/>
    </g>
    <text x="584" y="105" font-size="12" style="fill:var(--faint);">…</text>
    <line x1="308" y1="66" x2="308" y2="134" stroke-width="2.5" style="stroke:#d97706;"/>
    <rect x="256" y="30" width="104" height="26" rx="6" style="fill:#d97706;"/>
    <text x="308" y="48" text-anchor="middle" font-size="12" font-weight="600" style="fill:#fff;">cursor: id 10</text>
    <line x1="308" y1="142" x2="436" y2="142" stroke-width="1.5" style="stroke:var(--accent);"/>
    <polygon points="436,142 426,137 426,147" style="fill:var(--accent);"/>
    <text x="178" y="164" text-anchor="middle" font-size="13" style="fill:var(--muted);">page 1: rows 1–10</text>
    <text x="178" y="182" text-anchor="middle" font-size="12" style="fill:var(--faint);">already read</text>
    <text x="440" y="164" text-anchor="middle" font-size="13" style="fill:var(--muted);">page 2: seek, read 10</text>
    <text x="440" y="182" text-anchor="middle" font-size="12" style="fill:var(--faint);">nothing skipped</text>
  </svg>
  <figcaption>Keyset seeks from the cursor — no rows are skipped.</figcaption>
</figure>

Going backward works symmetrically by flipping the comparison and the sort. To step back one page from a cursor of `{ lastPostId: 31 }`, you ask for the 10 rows before it:

```sql
-- Previous page: the 10 rows ending at PostId 30
SELECT TOP 10 PostId, Title, CreatedAt
FROM Posts
WHERE PostId < 21
ORDER BY PostId DESC;
```

The result comes back in reverse and is reordered client-side. Most infinite-scroll interfaces never need this, but "back" buttons and bidirectional lists do, so it is worth knowing the pattern exists.

### Example B: composite sort with a tiebreaker

Real listings are rarely sorted by a bare primary key. Products sort by price, posts by timestamp — columns where ties are common. A cursor on a non-unique column is ambiguous: if fifty products share `Price = 49.99`, then `WHERE Price > 49.99` skips all of them, and `WHERE Price >= 49.99` repeats them.

The fix is to append a unique tiebreaker — almost always the primary key — to both the sort and the filter. This composite form is sometimes presented as a separate "seek method," but it is simply keyset pagination done correctly for non-unique sorts.

```sql
-- Page size 20, sorted by Price ASC with ProductId as tiebreaker.
-- Last seen row on the previous page: Price = 49.99, ProductId = 8821.
SELECT TOP 20 ProductId, Name, Price
FROM Products
WHERE Price > 49.99
   OR (Price = 49.99 AND ProductId > 8821)
ORDER BY Price ASC, ProductId ASC;
```

Read the `WHERE` clause as two cases. The first branch takes every row priced above the last seen price. The second branch takes the remaining rows at exactly the last seen price — the tied group — continuing after the last seen product within that group. Together they define a precise resumption point even when hundreds of rows share the same price.

The same shape works for timestamps:

```sql
-- Last seen row: CreatedAt = '2025-03-15 14:22:00', PostId = 98432
SELECT TOP 20 PostId, Title, CreatedAt
FROM Posts
WHERE CreatedAt < @LastCreatedAt
   OR (CreatedAt = @LastCreatedAt AND PostId < @LastPostId)
ORDER BY CreatedAt DESC, PostId DESC;
```

Note that the comparison direction follows the sort direction: descending sorts use `<`, ascending sorts use `>`. Getting this backwards is the most common keyset bug, and it manifests as pages that run in the wrong direction or return nothing at all.

### Cursors on the wire

The cursor itself is just the last row's sort values, serialized for the client. A minimal envelope looks like this:

```json
GET /api/posts?limit=20

{
  "data": [...],
  "nextCursor": "eyJjcmVhdGVkQXQiOiIyMDI1LTAzLTE1VDE0OjIyOjAwWiIsInBvc3RJZCI6OTg0MzJ9",
  "hasMore": true
}

GET /api/posts?limit=20&cursor=eyJjcmVhdGVkQXQiOiIyMDI1LTAzLTE1VDE0OjIyOjAwWiIsInBvc3RJZCI6OTg0MzJ9
```

That `nextCursor` decodes to `{ createdAt: "2025-03-15T14:22:00Z", postId: 98432 }`. Base64 encoding keeps the cursor opaque so clients treat it as an opaque token rather than parsing it, but base64 is encoding, not security — anyone can decode it. For internal APIs that is fine.

For public APIs, encrypt or HMAC-sign the payload so clients cannot forge cursors to probe your data layout (for example, walking `postId` values up and down to enumerate records). The server must always validate a cursor before trusting it: reject malformed tokens with a 400, and treat a cursor that points at a deleted row as a normal boundary rather than an error.

Keyset pagination suits feeds, timelines, product listings, and any large or fast-growing dataset. Its price is the loss of random access — there is no "go to page 47," only forward and backward from a known position — plus the discipline of maintaining a stable sort, a matching index, and cursor handling on both client and server.

### Offset vs. keyset at a glance

| Aspect | Offset | Keyset |
|---|---|---|
| How it works | Skips N rows, reads the next page | Seeks from the last seen row |
| Cost of deep pages | Grows with depth (scan and discard) | Flat (index seek) |
| Jump to any page | Yes | No, sequential only |
| Stable under writes | No, rows shift | Yes, anchored to a cursor |
| Implementation | Simple | Needs a stable sort and cursor handling |
| Best for | Small datasets, admin UIs | Large datasets, feeds, public APIs |

## Strategy 4: Hybrid checkpoint pagination

Some products genuinely need both behaviors: page-number navigation for users and keyset performance for the database. Search results are the classic case — users expect to jump to page 8, but the underlying index holds millions of documents.

The hybrid answer is checkpoint cursors: precompute and cache the cursor for every Nth page, then serve a jump by seeking from the nearest checkpoint and scanning only the small remainder with offset.

```sql
-- Checkpoints cached every 50 pages (page size 20, so every 1,000 rows):
-- Page 51 starts at  { CreatedAt: '2025-01-15', PostId: 45231 }
-- Page 101 starts at { CreatedAt: '2024-11-02', PostId: 22108 }

-- User jumps to page 60: seek to the page-51 checkpoint, offset 180 within it
SELECT TOP 20 PostId, Title, CreatedAt
FROM Posts
WHERE CreatedAt < '2025-01-15'
   OR (CreatedAt = '2025-01-15' AND PostId < 45231)
ORDER BY CreatedAt DESC, PostId DESC
OFFSET 180 ROWS FETCH NEXT 20 ROWS ONLY;
```

The offset here is bounded — at most 49 pages past a checkpoint — so it never exhibits the deep-offset pathology. Checkpoints are refreshed periodically (or on write, for small tables) and stored in a fast cache keyed by filter-and-sort combination.

The trade-offs are real: cached checkpoints go stale under heavy writes, every distinct filter/sort combination needs its own checkpoint chain, and the machinery is meaningfully more complex than either pure strategy. Build this only when analytics show users actually navigating deep by page number; in most products they never leave the first few pages, and pure keyset is enough.

## Strategy 5: Search-engine pagination

Full-text search backends have their own pagination story, and it mirrors the relational one. Elasticsearch's `from`/`size` is offset by another name and degrades the same way past a few thousand results — each shard must materialize and sort its share before anything is discarded.

Its `search_after` parameter is keyset pagination adapted for distributed search: the client returns the sort values of the last hit, and every shard seeks from there.

```json
GET /products/_search
{
  "size": 20,
  "sort": [{ "price": "asc" }, { "_id": "asc" }],
  "search_after": [49.99, "product_8821"]
}
```

Notice the pair of sort keys: price plus a unique tiebreaker, exactly as in Example B above. If your product already serves listings from Elasticsearch or OpenSearch, paginate with `search_after` rather than reimplementing keyset logic against the primary database. The strategies compose: use the search engine for free-text and faceted queries, and relational keyset pagination for structured feeds and timelines.

## Strategy 6: Snapshot pagination for random access at scale

There is one combination none of the above handles well: a large dataset, user-chosen sort and filter columns, and jump-to-any-page navigation. Picture a financial ledger where an analyst sorts by counterparty, filters by amount range, and jumps straight to page 47 — over millions of rows with attribute columns and wide financial columns.

Keyset fails here for three compounding reasons. First, there is no cursor for page 47. The client has never visited it, so the server has nothing to seek from, and the only way to manufacture a cursor is to walk the data — which is the scan you were trying to avoid.

Second, the sort is chosen at request time from dozens of columns, and maintaining a composite index for every possible ordering is infeasible, since each index costs storage and slows every write. Third, ad-hoc filters change the result set on every request, which defeats precomputed checkpoint chains — a checkpoint is only valid for one exact filter-and-sort combination.

The way out is to stop paginating the live table and paginate a frozen copy of the result instead. On the first request, capture the matching IDs into a snapshot numbered in the requested order. Every page after that is a range seek over row numbers.

```sql
-- Request 1: capture and number the result set once
SELECT ProductId,
       ROW_NUMBER() OVER (ORDER BY CreatedAt DESC, ProductId DESC) AS RowNum
INTO #PageSnapshot
FROM Products
WHERE CategoryId = @cat AND Price BETWEEN @lo AND @hi;

CREATE CLUSTERED INDEX IX_Tmp ON #PageSnapshot (RowNum);

-- Page 47, 20 rows per page: a pure range seek
SELECT p.*
FROM #PageSnapshot s
JOIN Products p ON p.ProductId = s.ProductId
WHERE s.RowNum BETWEEN 921 AND 940
ORDER BY s.RowNum;
```

<figure>
  <svg viewBox="0 0 640 220" role="img" aria-label="Snapshot pagination: freeze the result into numbered rows once, then range-seek to any page">
    <rect x="20" y="70" width="170" height="96" rx="10" style="fill:none;stroke:var(--fainter);stroke-width:1.5;"/>
    <text x="105" y="104" text-anchor="middle" font-size="13" font-weight="600" style="fill:var(--fg);">Live table</text>
    <text x="105" y="124" text-anchor="middle" font-size="12" style="fill:var(--muted);">millions of rows</text>
    <text x="105" y="141" text-anchor="middle" font-size="12" style="fill:var(--muted);">keeps changing</text>
    <rect x="235" y="70" width="170" height="96" rx="10" style="fill:none;stroke:var(--fainter);stroke-width:1.5;"/>
    <text x="320" y="104" text-anchor="middle" font-size="13" font-weight="600" style="fill:var(--fg);">Snapshot</text>
    <text x="320" y="124" text-anchor="middle" font-size="12" style="fill:var(--muted);">ROW_NUMBER() 1…N</text>
    <text x="320" y="141" text-anchor="middle" font-size="12" style="fill:var(--muted);">frozen as-of 14:32</text>
    <rect x="450" y="70" width="170" height="96" rx="10" style="fill:none;stroke:var(--accent);stroke-width:2;"/>
    <text x="535" y="104" text-anchor="middle" font-size="13" font-weight="600" style="fill:var(--fg);">Page 47</text>
    <text x="535" y="124" text-anchor="middle" font-size="12" style="fill:var(--muted);">RowNum 921–940</text>
    <text x="535" y="141" text-anchor="middle" font-size="12" style="fill:var(--muted);">one range seek</text>
    <line x1="192" y1="118" x2="231" y2="118" stroke-width="1.5" style="stroke:var(--faint);"/>
    <polygon points="231,118 223,113 223,123" style="fill:var(--faint);"/>
    <line x1="407" y1="118" x2="446" y2="118" stroke-width="1.5" style="stroke:var(--faint);"/>
    <polygon points="446,118 438,113 438,123" style="fill:var(--faint);"/>
    <text x="211" y="56" text-anchor="middle" font-size="12" style="fill:var(--faint);">1 · capture once</text>
    <text x="426" y="56" text-anchor="middle" font-size="12" style="fill:var(--faint);">2 · seek to any page</text>
  </svg>
  <figcaption>Snapshot once, then seek to any page.</figcaption>
</figure>

This combines what the other strategies could not: random access to any page at flat cost, perfectly stable pages (the snapshot cannot shift under concurrent writes), and an exact total that is now a cheap count over a narrow temp table.

For financial reporting, that frozen stability is a feature rather than a limitation — a month-end statement should not change because someone posted a journal entry mid-read.

The costs are concrete and should be stated plainly. The first request still pays the full filtered scan and sort, so it needs the same indexing discipline as everything else.

Concurrent users each hold a snapshot, which pressures tempdb; at scale, prefer a persisted snapshot table keyed by search ID with an expiry job over per-session temp tables. And snapshots go stale by design, so show the as-of moment ("results as of 14:32") and refresh the snapshot when the user changes sort or filters — not on every page turn.

Two cheaper companions cover the cases around it. Where you keep offset for shallow jumps, use a deferred join: push only the indexed key column through the `OFFSET`, then join the wide financial columns back afterward, so large rows never pass through the sort-and-skip phase:

```sql
-- Keys pass through the offset; wide columns join back after
SELECT p.*
FROM (
    SELECT ProductId
    FROM Products
    WHERE CategoryId = @cat
    ORDER BY CreatedAt DESC
    OFFSET 800 ROWS FETCH NEXT 20 ROWS ONLY
) AS page
JOIN Products p ON p.ProductId = page.ProductId;
```

This lowers the constant factor but not the asymptotics — deep pages still scan and discard, just narrower rows.

And for interactive explorers rather than formal reports, constrain the interface the way search engines do: cap depth (GitHub stops at 1,000 results), allow page jumps only on the default sort, and require filters before deep navigation. Most "jump to any page over anything" requirements dissolve once users must narrow the result set first.

Use snapshot pagination for statements, ledgers, audit trails, and any report where page numbers are load-bearing. Use constrained navigation plus keyset for interactive browsing over the same data.

## Making it reliable in production

The strategy choice gets the attention, but these five details decide whether pagination survives production traffic.

**Index the sort, exactly.** Every pagination query needs a composite index whose columns match the `ORDER BY` in the same order and direction. For the running example:

```sql
CREATE INDEX IX_Posts_CreatedAt_Id
ON Posts (CreatedAt DESC, PostId DESC)
INCLUDE (Title, AuthorId);
```

The `INCLUDE` columns make this a covering index: the engine answers the whole page from the index without touching the table heap. Verify with the execution plan — you want an index seek, not a scan followed by a sort. Without this index, keyset pagination performs no better than offset, and offset performs worse than you fear.

**Join instead of looping.** A frequent mistake is to paginate a list and then issue one query per row for related data — the N+1 problem. With a page size of 20, that turns every page load into 21 round trips. Fetch the page and its related rows in a single statement:

```sql
-- One round trip: the page plus each product's category name
SELECT p.ProductId, p.Name, p.Price, c.CategoryName
FROM Products p
INNER JOIN Categories c ON p.CategoryId = c.CategoryId
WHERE p.Price > @LastPrice
   OR (p.Price = @LastPrice AND p.ProductId > @LastId)
ORDER BY p.Price ASC, p.ProductId ASC
OFFSET 0 ROWS FETCH NEXT 20 ROWS ONLY;
```

**Plan for concurrent writes.** Inserts at the head of a keyset feed are safe: new rows appear naturally on subsequent fetches. Hard deletes are the hazard. If a row that served as someone's cursor is deleted before they request the next page, the boundary it anchored moves, and rows near it can be skipped or repeated.

The standard mitigation is soft deletes — mark rows `IsDeleted = 1` and filter them in the query — so the anchor row physically remains even though it is never displayed:

```sql
UPDATE Posts SET IsDeleted = 1 WHERE PostId = @id;

SELECT TOP 20 PostId, Title, CreatedAt
FROM Posts
WHERE IsDeleted = 0
  AND (CreatedAt < @LastCreatedAt
    OR (CreatedAt = @LastCreatedAt AND PostId < @LastPostId))
ORDER BY CreatedAt DESC, PostId DESC;
```

**Cache the hot pages.** Traffic is overwhelmingly skewed toward the beginning: page one receives orders of magnitude more requests than page fifty. Cache early pages at the edge or in Redis under a key that captures the filter, sort, and cursor, with a short TTL, and invalidate on write:

```text
Key: pagination:products:sort=price_asc:cursor=NULL:limit=20
TTL: 60 seconds
```

Pages beyond the first few are requested so rarely that caching them adds complexity without measurable benefit.

**Cap the depth.** No legitimate user needs page 50,000, but nothing stops a client — or an attacker — from asking for it. A single deep-offset request can hold locks and consume I/O that starves normal queries. Enforce a maximum at the API layer and document it:

```sql
IF @Offset > 50000
    RAISERROR('Maximum pagination depth exceeded. Use cursor-based navigation.', 16, 1);
```

Clients that hit the cap receive a clear error pointing them at the cursor endpoint rather than a timeout.

## Matching the UI pattern

The frontend pattern and the backend strategy should be chosen together, because each UI implies a backend contract:

| UI pattern | Backend fit | Notes |
|---|---|---|
| Page numbers ("Page X of Y") | Offset | Needs a total count, which is expensive; always cap the depth |
| "Load more" button | Keyset | Simple, needs no count, stable under writes |
| Infinite scroll | Keyset | Fluid, but weakens back-button behavior, link sharing, and accessibility |
| Virtualized list | Keyset in chunks | Renders only the visible window; pages accumulate in a rolling buffer |

Infinite scroll and virtualization are rendering techniques, not pagination strategies. Both sit on top of keyset fetching: each scroll event or window fill fires a request carrying the last seen cursor.

## Choosing

The decision reduces to four questions, asked in order:

1. **Is the dataset bounded and small (under roughly 10K rows)?** Use offset — or skip pagination entirely for truly tiny lists like fixed vocabularies.
2. **Must users jump to arbitrary pages?** Use offset with a depth cap. Add checkpoint cursors only when deep jumps are both frequent and measurably slow.
3. **Is the data large, growing, or changing under readers?** Use keyset, with a unique tiebreaker and a matching composite index.
4. **Is sorting fully free-form across many columns?** Use keyset for the hot sorts, a capped offset fallback for the rare ones, and `search_after` in your search engine where sorting is genuinely ad hoc.
5. **Large data with exact page jumps (statements, ledgers, reports)?** Snapshot the result set once with row numbers (Strategy 6) instead of paginating the live table.

Two API habits pay off regardless of strategy. Keep the response envelope consistent across endpoints — `data`, a cursor or page indicator, `hasMore`, and `pageSize` — so clients implement pagination once.

And avoid returning total counts unless the interface genuinely renders them; `hasMore` answers the only question most UIs ask ("is there another page?") at a fraction of the cost.

## Closing

Start with offset where the data is small and the readers are internal. Move to keyset the moment the dataset grows, changes under readers, or faces the public — and bring a unique tiebreaker, a matching composite index, and a depth cap with you. Reserving hybrid checkpoints and search-engine pagination for the cases that truly need them keeps the system as simple as it can be while staying fast at any scale.
