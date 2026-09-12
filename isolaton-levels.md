---
title: "Isolation levels in Databases"
description: "How much transparency do you need?"
date: "2026-07-19"
---

You've built a killer app. Users love it. Orders are rolling in, posts are flying, products are stacking up — millions of records sitting in your database. Then a Slack message lands: *"Hey, the listing page takes 8 seconds to load... is everything okay?"*

You crack open the query logs:

`SELECT * FROM products ORDER BY created_at OFFSET 950000 LIMIT 20`

Eight seconds. For page 47,500.

This is the pagination problem — more common, and more consequential, than most developers realize. Pagination isn't just a UI nicety. It's the contract between your backend, your database, and your users. Get it right, and your app feels snappy at a million records. Get it wrong, and you're firefighting on a Friday wondering why "next page" is taking down your DB.

In this article, we'll cover every major pagination strategy — from naive offset to cursor-based, token-based, and hybrid methods — with T-SQL examples, honest trade-offs, and a decision framework to help you pick the right tool.

---

## Why Pagination Matters

### Performance

Every unpaginated query is a ticking time bomb. Fetching 500,000 rows to show 20 wastes CPU, memory, I/O, and network. A query that takes 50ms on 10,000 rows might take 12 seconds on 10,000,000.

### User Experience

Users care about speed and predictability. A page that loads in under 200ms feels instant. One that takes 3 seconds feels broken. Good pagination maintains that speed regardless of data volume.

### Scalability

The goal is to make query performance *independent* of dataset size. Whether you have 10,000 or 10,000,000 records, a page of 20 should feel the same.

### SEO (for Web Apps)

For content-heavy sites, paginated URLs (`/blog?page=3`) help search engines crawl your content — but only if implemented correctly. Deep offset URLs (`?offset=950000`) are rarely crawled meaningfully.

---

## Core Pagination Strategies

### 0 : No Pagination — All Data on UI

Many apps start here.

```sql
-- The "just send everything" approach
SELECT * FROM Products ORDER BY CreatedAt DESC;
```

**When it's fine:** Truly small, bounded datasets (e.g., a dropdown of 50 US states, a list of 30 internal categories).

**When it breaks:** The moment your dataset grows beyond a few hundred rows, this becomes a UX and performance liability. Client-side rendering of thousands of DOM nodes is slow, and mobile devices will crash.

---

### 1 : Offset-Based Pagination (Page + Limit)

The most intuitive approach. Users click "Page 3" and you skip to the right records.

```sql
-- Fetch page 5 with 20 items per page
SELECT
    ProductId,
    Name,
    Price,
    CreatedAt
FROM Products
ORDER BY CreatedAt DESC
OFFSET 80 ROWS          -- (page - 1) * pageSize = (5-1) * 20
FETCH NEXT 20 ROWS ONLY;
```

**REST API shape:**
```json
GET /api/products?page=5&limit=20

Response:
{
  "data": [...],
  "total": 142300,
  "page": 5,
  "pageSize": 20,
  "totalPages": 7115
}
```

**How it works:** The database physically scans through `OFFSET` rows and returns the next `LIMIT`. An offset of 950,000 means reading and discarding nearly a million rows before handing you 20.

#### ✅ Pros
- Simple to implement
- Users can jump to any page number
- Intuitive UI ("Page 1 of 7,115")

#### ❌ Cons
- **Performance degrades** with large offsets — `OFFSET 1000000` is genuinely slow
- **Inconsistent results**: Inserts/deletes between page requests cause duplicates or missing records
- `COUNT(*)` for total row metadata is expensive on large tables

#### 📌 When to Use
Small-to-medium datasets (&lt;100,000 rows), admin dashboards, internal tools, and reporting panels where deep pagination is rare.

---

### 2 : Cursor-Based / Keyset Pagination

Instead of telling the database *how many rows to skip*, you tell it *where you left off*. This is the strategy powering Twitter feeds, GitHub APIs, and most high-traffic applications.

```sql
-- Initial load: get the first page
SELECT TOP 20
    PostId,
    Title,
    CreatedAt
FROM Posts
ORDER BY CreatedAt DESC, PostId DESC;

-- Next page: use the last seen CreatedAt and PostId as your cursor
SELECT TOP 20
    PostId,
    Title,
    CreatedAt
FROM Posts
WHERE
    CreatedAt < '2025-03-15 14:22:00'  -- last seen CreatedAt
    OR (
        CreatedAt = '2025-03-15 14:22:00'
        AND PostId < 98432               -- tiebreaker
    )
ORDER BY CreatedAt DESC, PostId DESC;
```

The cursor encodes `{ createdAt: "2025-03-15T14:22:00Z", postId: 98432 }` — typically base64-encoded before being sent to the client so it's opaque.

**API shape:**
```json
GET /api/posts?limit=20

Response:
{
  "data": [...],
  "nextCursor": "eyJjcmVhdGVkQXQiOiIyMDI1LTAzLTE1VDE0OjIyOjAwWiIsInBvc3RJZCI6OTg0MzJ9",
  "hasMore": true
}

GET /api/posts?limit=20&cursor=eyJjcmVhdGVkQXQiOiIyMDI1LTAzLTE1VDE0OjIyOjAwWiIsInBvc3RJZCI6OTg0MzJ9
```

#### ✅ Pros
- **Excellent performance at any dataset size** — uses index seeks, not scans
- **Stable results** — inserts/deletes don't shift existing pages
- Naturally suits infinite scroll and feed-style UIs

#### ❌ Cons
- Cannot jump to an arbitrary page ("go to page 47")
- Requires a consistent, stable sort order with a unique tiebreaker
- Slightly more complex to implement and encode

#### 📌 When to Use
High-traffic feeds, social media timelines, e-commerce product listings, any API with large datasets.

**Index to create:**
```sql
-- Essential: composite index matching your ORDER BY
CREATE INDEX IX_Posts_CreatedAt_PostId
ON Posts (CreatedAt DESC, PostId DESC);
```

---

#### Offset vs. Cursor — Head to Head

| Aspect | OFFSET Pagination | CURSOR Pagination |
|---|---|---|
| **How it works** | Skips N rows, then reads the next page | Seeks directly using a pointer (e.g., last seen `id`) |
| **Page 1** | Reads 10 rows directly | `WHERE id > NULL` → reads 10 rows directly |
| **Page 2** | Skips 10 rows, then reads 10 | `WHERE id > {last_id}` → seeks directly |
| **Page 50** | Scans & discards 490 rows, then reads 10 | `WHERE id > {cursor}` → seeks directly, O(1) |
| **Performance** | Degrades with depth — O(n) scan | Consistent regardless of depth — O(1) seek |
| **Random access** | ✅ Can jump to any page number | ❌ Must traverse pages sequentially |
| **Stable results** | ❌ Rows can shift if data changes mid-pagination | ✅ Stable — anchored to a fixed cursor point |
| **Implementation** | Simple — `LIMIT 10 OFFSET 490` | Requires a sortable, unique cursor column (e.g., `id`) |
| **Best for** | Small datasets, admin UIs with page numbers | Large datasets, infinite scroll, feeds |

---

### 3 : Seek Method / Keyset Pagination with Composite Keys

When your sort has potential ties, a single-column cursor breaks down. The **seek method** uses composite keys to guarantee uniqueness and stability.

```sql
-- Multi-column keyset: sort by Price ASC, then ProductId ASC as tiebreaker
SELECT TOP 20
    ProductId,
    Name,
    Price
FROM Products
WHERE
    Price > 49.99                        -- last seen Price
    OR (Price = 49.99 AND ProductId > 8821)  -- tiebreaker for same price
ORDER BY Price ASC, ProductId ASC;
```

This is extremely index-friendly. SQL Server uses the composite index `(Price, ProductId)` for a pure index seek — no table scan, no offset skip. Performance stays constant regardless of how deep into the dataset you go.

---

### 4 : Token-Based Pagination

A variant of cursor-based pagination where the cursor is **signed or encrypted**, hiding internal database details from clients entirely.

```sql
-- Same keyset query under the hood
-- But the token sent to client is an HMAC-signed, encrypted payload:
Token = Base64(Encrypt({ postId: 98432, createdAt: "2025-03-15T14:22:00" }))
```

The server decrypts and validates the token before using its values in the query — preventing clients from crafting arbitrary cursors to probe your data structure.

**When to use:** Public-facing APIs where you want to prevent cursor manipulation, or when paginating over sensitive data.

---

### 5 : Page Token + Offset Hybrid

Some systems need the user-friendliness of page numbers *and* the performance of cursor-based pagination. The hybrid approach uses cursor-based pagination internally, mapping page numbers to checkpoint cursors.

```sql
-- Store checkpoints every N pages
-- Page 1 cursor: NULL (start from beginning)
-- Page 100 cursor: { createdAt: "2025-01-15", id: 45231 }
-- Page 200 cursor: { createdAt: "2024-11-02", id: 22108 }

-- User jumps to "page 100" → resolve cached cursor → keyset query from there
SELECT TOP 20
    PostId, Title, CreatedAt
FROM Posts
WHERE CreatedAt < '2025-01-15' AND PostId < 45231
ORDER BY CreatedAt DESC, PostId DESC;
```

Pre-compute and cache cursors at regular intervals (every 100 pages), then use offset only within a small window of those checkpoints.

---

## Advanced & Specialized Techniques

### Infinite Scroll vs. Classic Pagination

| Pattern | Best For | Trade-off |
|---|---|---|
| Classic "Page X of Y" | Search results, data tables | Requires total count (expensive) |
| "Load More" button | Feeds, social content | Simple, avoids total count |
| Infinite Scroll | Mobile feeds, media | Risky UX, bad for accessibility |

Infinite scroll uses cursor-based pagination under the hood — each scroll event fires a request with the last seen cursor. The UX is fluid, but it has pitfalls: no back-button support, poor accessibility, and difficult content sharing (no stable URL).

### Virtualized Lists (Client-Side)

When you must load large amounts of data into the browser, **windowed rendering** with libraries like React Window or TanStack Virtual only renders visible DOM nodes:

```sql
Total rows in memory: 10,000
Rows rendered in DOM at any moment: ~20 (the visible window)
```

This pairs well with cursor-based pagination: fetch data in chunks, keep a rolling window in memory.

---

| Strategy | Complexity | Performance | Page Jumping | Stable Results | Best For |
|---|---|---|---|---|---|
| No Pagination | None | ❌ Terrible at scale | ✅ N/A | ✅ Yes | &lt;500 rows |
| Offset / Page | Low | ⚠️ Degrades at depth | ✅ Yes | ❌ No | Admin panels, small sets |
| Cursor / Keyset | Medium | ✅ Constant at any depth | ❌ No | ✅ Yes | Feeds, APIs, large data |
| Seek Method | Medium-High | ✅ Best possible | ❌ No | ✅ Yes | E-commerce, complex sorts |
| Token-Based | Medium | ✅ Constant | ❌ No | ✅ Yes | Public APIs |
| Hybrid | High | ✅ Good | ✅ Approx | ✅ Yes | Needs both UX + perf |

---

## Performance & Reliability Considerations

### Indexing — The #1 Factor

No pagination strategy survives without proper indexing. For any column used in `ORDER BY` or `WHERE` inside a pagination query, create a composite index that matches the sort order exactly.

```sql
-- For cursor-based on CreatedAt DESC, PostId DESC:
CREATE INDEX IX_Posts_CreatedAt_Id
ON Posts (CreatedAt DESC, PostId DESC)
INCLUDE (Title, AuthorId);  -- cover frequently selected columns
```

The `INCLUDE` clause makes this a **covering index** — SQL Server satisfies the entire query from the index without touching the main table heap.

### Avoiding N+1 Queries

A classic mistake: paginate a list, then fetch details for each item in a loop.

```sql
-- ❌ N+1: one query per product to get category name
-- SELECT CategoryName FROM Categories WHERE CategoryId = @id  (×20 times)

-- ✅ Single join, one round-trip
SELECT p.ProductId, p.Name, p.Price, c.CategoryName
FROM Products p
INNER JOIN Categories c ON p.CategoryId = c.CategoryId
WHERE p.Price > @LastPrice OR (p.Price = @LastPrice AND p.ProductId > @LastId)
ORDER BY p.Price ASC, p.ProductId ASC
OFFSET 0 ROWS FETCH NEXT 20 ROWS ONLY;
```

### Handling Concurrent Modifications

**Insertions** at the head of a cursor-based feed are safe — new records get picked up naturally on the next request if they fall within the sort range.

**Deletions** are riskier. If a row used as a cursor is deleted before the next page is fetched, the WHERE clause may skip items. Mitigation: use **soft deletes** (`IsDeleted = 1`) rather than hard-deleting cursor-anchor rows.

```sql
-- Soft delete pattern — safe for cursor pagination
UPDATE Posts SET IsDeleted = 1 WHERE PostId = @id;

-- Query filters them out while keeping the row present for cursor stability
SELECT TOP 20 PostId, Title, CreatedAt
FROM Posts
WHERE IsDeleted = 0
  AND CreatedAt < @LastCreatedAt
ORDER BY CreatedAt DESC, PostId DESC;
```

### Caching Pagination Results

For frequently accessed pages (page 1 is almost always the most-requested), cache at the Redis layer:

```sql
Cache Key: pagination:products:sort=price_asc:cursor=NULL:limit=20
TTL: 60 seconds
```

Invalidate on write. Pages beyond page 5 rarely need caching.

### Deep Pagination Attacks

Malicious actors (or naive clients) can hammer `OFFSET 10000000` requests to slow your database. Enforce a cap at the API layer:

```sql
-- Enforce a maximum offset at the API layer
IF @Offset > 50000
    RAISERROR('Maximum pagination depth exceeded. Use cursor-based navigation.', 400, 1);
```

Document this limit in your API. Legitimate users almost never need page 2,500.

---

## Real-World Examples

**Twitter/X Feed** uses cursor-based pagination. Every API response includes a `next_cursor` token — there's no concept of "page 47."

**GitHub API** uses a `Link` header with cursor-encoded URLs for repository lists, commits, and issues, with a hard cap of 10,000 results on offset-based endpoints.

**Amazon Product Search** uses a hybrid approach. Category browsing uses keyset-style pagination; full-text search falls back to Elasticsearch's `search_after`.

**Notion/Linear** use infinite scroll with cursor-based loading. Their datasets are large and real-time, making keyset the natural fit.

---

## Best Practices & Decision Framework

### Which Strategy Should You Pick?

```sql
Is your dataset bounded and small (&lt;10K rows)?
  └─ YES → No pagination or simple OFFSET is fine.
  └─ NO ↓

Does the user need to jump to arbitrary pages (e.g., "go to page 47")?
  └─ YES → Offset with a depth cap, or Hybrid (checkpoint cursors).
  └─ NO ↓

Is the sort order stable and based on a unique key?
  └─ YES → Keyset / Cursor-based.
  └─ NO ↓

Multiple arbitrary sort columns needed?
  └─ YES → Tier approach: keyset for hot sorts, offset cap for rare sorts,
            Elasticsearch for full flexibility.
```

### API Design Tips

Keep your pagination response shape consistent:

```json
{
  "data": [],
  "pagination": {
    "nextCursor": "base64encodedcursor",
    "hasMore": true,
    "pageSize": 20
  }
}
```

Avoid leaking total counts unless necessary — `COUNT(*)` on large tables is expensive. Prefer `hasMore: true/false`.

---

## Common Pitfalls

**The "OFFSET 1,000,000" Problem** — Large offsets don't just slow things down; they can lock tables and starve other queries of resources. Always enforce a maximum offset.

**Unstable Sorting** — If your `ORDER BY` doesn't include a unique tiebreaker column (like `id`), rows with identical sort values appear in random order across pages. Users see duplicates or miss items. Always add a unique column as the final sort key.

**Mobile vs Desktop** — Mobile users scroll; desktop users click page numbers. Design your API to support both patterns. Make sure your frontend teams know which endpoints support cursor vs offset.

---

## Conclusion

Pagination seems trivial until it isn't. A naive `OFFSET 950000` query has ended more than a few on-call nights. The tools to fix it are well-understood, well-supported by SQL Server, and straightforward to implement.

Key takeaways:

- **Start with offset** for small, internal datasets. Keep it simple where simple works.
- **Move to keyset/cursor** the moment your dataset grows, your data is real-time, or your API is public-facing.
- **Use the seek method** when sort stability and composite keys matter.
- **Consider a hybrid** when users need page-jumping but your data is large.
- **Index aggressively** — your pagination strategy is only as fast as your worst index.
- **Cap your depth** — always. No legitimate use case needs page 50,000.
