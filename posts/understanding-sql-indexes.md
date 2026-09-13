---
title: Understanding SQL Indexes
description: How indexes work inside, across engines, and when they actually help
date: 2026-09-12
show: true
---
An index is a sorted lookup structure that sits alongside your table. Without one, the database has to scan every row to find what you are looking for — a full table scan. With one, it can jump straight to the matching rows, the same way a book's index saves you from reading every page to find a topic.

> **Rule of thumb:** measure first, index second. An index you never query against is pure overhead — it slows down every write and buys you nothing back.

## Why they matter

Say you have a `users` table with a million rows and you run:

```sql
SELECT * FROM users WHERE email = 'ankit@example.com';
```

Without an index on `email`, the database checks all one million rows, one by one. With an index, it does something closer to a binary search — a handful of comparisons instead of a million.

The rest of this post explains what that "handful of comparisons" physically is, how the two engines you most likely use store it differently, and where the model surprises people: multi-column indexes, strings, dates, and finally document databases.

## Inside a B-tree

Nearly every default index you create — in Postgres, MySQL, SQL Server, SQLite — is a B-tree, and more precisely a **B+tree**: only the leaf pages hold row pointers, internal pages hold keys plus child pointers, and the leaves are chained together in key order. Picture a `users` table indexed on `id`, holding keys 1 through 12:

<figure>
  <svg viewBox="0 0 640 250" role="img" aria-label="B-plus-tree with a root, two internal nodes, and four chained leaf pages">
    <rect x="255" y="14" width="130" height="34" rx="8" style="fill:var(--card);stroke:var(--accent);stroke-width:2;"/>
    <text x="320" y="36" text-anchor="middle" font-size="12" font-weight="600" style="fill:var(--fg);">root · 5 | 9</text>
    <rect x="120" y="76" width="150" height="34" rx="8" style="fill:var(--card);stroke:var(--fainter);stroke-width:1.5;"/>
    <text x="195" y="98" text-anchor="middle" font-size="12" style="fill:var(--muted);">3 | 5</text>
    <rect x="370" y="76" width="150" height="34" rx="8" style="fill:var(--card);stroke:var(--fainter);stroke-width:1.5;"/>
    <text x="445" y="98" text-anchor="middle" font-size="12" style="fill:var(--muted);">9 | 11</text>
    <line x1="290" y1="48" x2="200" y2="74" stroke-width="1.5" style="stroke:var(--faint);"/>
    <line x1="350" y1="48" x2="440" y2="74" stroke-width="1.5" style="stroke:var(--faint);"/>
    <g font-size="12" style="fill:var(--muted);">
      <rect x="30" y="140" width="120" height="34" rx="8" style="fill:var(--accent-soft);stroke:var(--accent);stroke-width:1;"/>
      <text x="90" y="162" text-anchor="middle">1 · 2 · 3</text>
      <rect x="160" y="140" width="120" height="34" rx="8" style="fill:var(--accent-soft);stroke:var(--accent);stroke-width:1;"/>
      <text x="220" y="162" text-anchor="middle">4 · 5 · 6</text>
      <rect x="360" y="140" width="120" height="34" rx="8" style="fill:var(--accent-soft);stroke:var(--accent);stroke-width:1;"/>
      <text x="420" y="162" text-anchor="middle">7 · 8 · 9</text>
      <rect x="490" y="140" width="120" height="34" rx="8" style="fill:var(--accent-soft);stroke:var(--accent);stroke-width:1;"/>
      <text x="550" y="162" text-anchor="middle">10 · 11 · 12</text>
    </g>
    <line x1="150" y1="157" x2="158" y2="157" stroke-width="1.5" style="stroke:var(--faint);"/>
    <polygon points="158,157 152,154 152,160" style="fill:var(--faint);"/>
    <line x1="280" y1="157" x2="358" y2="157" stroke-width="1.5" stroke-dasharray="5 4" style="stroke:var(--faint);"/>
    <line x1="480" y1="157" x2="488" y2="157" stroke-width="1.5" style="stroke:var(--faint);"/>
    <polygon points="488,157 482,154 482,160" style="fill:var(--faint);"/>
    <text x="320" y="204" text-anchor="middle" font-size="12" style="fill:var(--faint);">leaf pages hold the row pointers and link to each other in key order</text>
    <text x="320" y="226" text-anchor="middle" font-size="12" style="fill:var(--faint);">internal pages hold keys + child pointers only</text>
  </svg>
  <figcaption>Every lookup walks root to leaf; every range scan walks the leaf chain.</figcaption>
</figure>

A lookup for `id = 8` starts at the root. Since 8 falls between 5 and 9, it follows the middle child; at the next level, 8 is below 9, so it follows the left child again and lands on the leaf holding 7, 8, 9. Three page reads, each narrowing the search — and critically, the tree stays shallow no matter how large the table gets. A page holds hundreds of keys (the *fanout*), so a million rows need only about three levels: hundreds at the root fan out to hundreds of thousands at the next level, covering the table.

Ten million rows still need only three or four hops, which is why indexed lookups feel instant at any scale your single server can hold.

Range queries reuse the same structure. For `WHERE id BETWEEN 4 AND 10`, the engine seeks to 4 exactly as above, then follows the leaf-to-leaf links rightward until it passes 10.

Sorting comes free for the same reason: `ORDER BY id` is just a walk along the leaf chain. This is the property that separates B-trees from hash indexes — order is preserved end to end.

Writes keep the tree balanced by splitting full pages. Inserting into a full leaf divides it into two half-full leaves, and the middle key is promoted to the parent; if the parent is full it splits too, occasionally all the way up to a new root.

Splits are local — most inserts touch three pages — but they leave pages half empty, which is why heavily written indexes slowly bloat and why both MySQL (`OPTIMIZE TABLE`) and Postgres (`VACUUM`, `REINDEX`) have maintenance operations that compact them.

One terminology note, because documentation will confuse you: Postgres calls its default index a "B-tree," but the implementation is a Lehman–Yao B-tree with linked leaves — behaviorally a B+tree, exactly as drawn above. MySQL's InnoDB uses textbook B+trees. The distinction that matters in practice is not the name but where the row data lives, which brings us to the engines.

### B-tree vs. hash, side by side

| Capability | B-tree index | Hash index |
|---|---|---|
| Exact match (`=`) | Yes | Yes |
| Range queries (`>`, `<`, `BETWEEN`) | Yes | No |
| `ORDER BY` support | Yes | No |
| Lookup complexity | O(log n) | O(1) average |
| Typical use case | Default for most columns | High-throughput exact lookups |

Hash indexes suit narrow workloads like in-memory key-value lookups. For everything else, the B-tree's ordered structure wins, which is why it is the default everywhere.

## How MySQL and Postgres store indexes differently

Both engines build B+trees, but they disagree on a fundamental question: where does the row itself live? That single decision ripples into primary-key design, write behavior, and which queries can avoid touching the table at all.

<figure>
  <svg viewBox="0 0 640 250" role="img" aria-label="InnoDB secondary index leaves point to primary keys while Postgres index leaves point to heap rows">
    <text x="160" y="24" text-anchor="middle" font-size="13" font-weight="600" style="fill:var(--fg);">MySQL InnoDB</text>
    <rect x="40" y="40" width="240" height="60" rx="10" style="fill:none;stroke:var(--fainter);stroke-width:1.5;"/>
    <text x="160" y="64" text-anchor="middle" font-size="12" style="fill:var(--muted);">secondary index on email</text>
    <text x="160" y="83" text-anchor="middle" font-size="12" style="fill:var(--faint);">leaf → id (primary key)</text>
    <rect x="40" y="128" width="240" height="60" rx="10" style="fill:none;stroke:var(--accent);stroke-width:2;"/>
    <text x="160" y="152" text-anchor="middle" font-size="12" style="fill:var(--muted);">clustered index (PK)</text>
    <text x="160" y="171" text-anchor="middle" font-size="12" style="fill:var(--faint);">leaf holds the full row</text>
    <line x1="160" y1="100" x2="160" y2="126" stroke-width="1.5" style="stroke:var(--faint);"/>
    <polygon points="160,126 155,118 165,118" style="fill:var(--faint);"/>
    <text x="480" y="24" text-anchor="middle" font-size="13" font-weight="600" style="fill:var(--fg);">Postgres</text>
    <rect x="360" y="40" width="240" height="60" rx="10" style="fill:none;stroke:var(--fainter);stroke-width:1.5;"/>
    <text x="480" y="64" text-anchor="middle" font-size="12" style="fill:var(--muted);">index on email</text>
    <text x="480" y="83" text-anchor="middle" font-size="12" style="fill:var(--faint);">leaf → heap TID</text>
    <rect x="360" y="128" width="240" height="60" rx="10" style="fill:none;stroke:var(--accent);stroke-width:2;"/>
    <text x="480" y="152" text-anchor="middle" font-size="12" style="fill:var(--muted);">heap (the table)</text>
    <text x="480" y="171" text-anchor="middle" font-size="12" style="fill:var(--faint);">rows live here, unsorted</text>
    <line x1="480" y1="100" x2="480" y2="126" stroke-width="1.5" style="stroke:var(--faint);"/>
    <polygon points="480,126 475,118 485,118" style="fill:var(--faint);"/>
    <text x="320" y="216" text-anchor="middle" font-size="12" style="fill:var(--faint);">InnoDB looks up twice (secondary → PK → row); Postgres looks up once (index → heap)</text>
  </svg>
  <figcaption>Same B+tree shape, different leaf contents — and different costs.</figcaption>
</figure>

**MySQL (InnoDB) clusters rows around the primary key.** The primary key's B+tree is special: its leaves hold the complete rows, and the table is physically ordered by it. Every secondary index is an ordinary B+tree whose leaves store the indexed columns *plus the primary key value*. A lookup on `email` therefore takes two trips: seek the secondary index for the email, recover the primary key, then seek the clustered index for the row.

This has two practical consequences. First, a short, ever-increasing primary key (an auto-increment integer) keeps both the table and every secondary index compact, because that key is copied into each one; a random UUID primary key bloats every secondary index and fragments the clustered table on insert, since each new row lands in the middle rather than at the end. Second, a secondary index that covers all selected columns answers the query without the second trip, which is why covering indexes matter disproportionately in MySQL.

**Postgres keeps rows in a heap and points at them.** The table is an unordered heap of rows; every index — including the primary key's — stores pointers (tuple IDs) to heap locations. A lookup seeks the index, then fetches each heap row by pointer. Because Postgres uses MVCC, an `UPDATE` writes a new row version elsewhere in the heap, and every index entry keeps pointing at the old location until cleanup: this is index bloat, and it is why `VACUUM` exists and why Postgres added heap-only-tuple (HOT) updates, which skip index maintenance when none of the indexed columns change.

The upside of the heap design is flexibility — Postgres supports B-tree, hash, GiST, SP-GiST, GIN, and BRIN indexes over the same heap, plus expression indexes (`CREATE INDEX ... ON users (lower(email))`) and partial indexes (`... WHERE active`) that MySQL cannot express as directly. Index-only scans (helped by the visibility map and `INCLUDE` columns) let Postgres skip the heap fetch the way covering indexes let MySQL skip the clustered lookup.

| Aspect | MySQL InnoDB | Postgres |
|---|---|---|
| Row storage | Clustered on PK; leaves hold rows | Heap; all indexes hold pointers |
| Secondary lookup cost | Two seeks (index, then PK) unless covering | Index seek plus heap fetch per row |
| Primary key choice | Load-bearing: short auto-increment wins | Less critical, still prefer compact keys |
| Update overhead | In-place-ish; page splits fragment | New row version; needs VACUUM; HOT helps |
| Specialty indexes | Full-text, spatial | GIN (JSONB, arrays, text), GiST (geo), BRIN (append-only), expression, partial |

If you remember one sentence per engine: in MySQL, design the primary key carefully because it is copied everywhere; in Postgres, maintain aggressively (autovacuum) and reach for the specialty index types instead of forcing everything through B-trees.

## Composite indexes, explained with an example

A composite index sorts by several columns at once, like a phone book sorted by last name, then first name. Consider an `orders` table queried two ways — by status, and by status within a date range:

```sql
CREATE INDEX IX_orders_status_created
ON orders (status, created_at);

-- Uses the index fully: seeks to ('shipped', >= Jan 1)
SELECT * FROM orders
WHERE status = 'shipped' AND created_at >= '2025-01-01';

-- Uses only the first column: seeks to 'shipped', then scans within it
SELECT * FROM orders
WHERE status = 'shipped';

-- Cannot use the index efficiently: no condition on the leading column
SELECT * FROM orders
WHERE created_at >= '2025-01-01';
```

<figure>
  <svg viewBox="0 0 640 235" role="img" aria-label="Composite index on status then created_at sorts dates within each status group">
    <rect x="40" y="30" width="170" height="130" rx="10" style="fill:none;stroke:var(--fainter);stroke-width:1.5;"/>
    <text x="125" y="54" text-anchor="middle" font-size="12" font-weight="600" style="fill:var(--fg);">status = new</text>
    <text x="125" y="78" text-anchor="middle" font-size="12" style="fill:var(--muted);">Jan 3</text>
    <text x="125" y="98" text-anchor="middle" font-size="12" style="fill:var(--muted);">Jan 9</text>
    <text x="125" y="118" text-anchor="middle" font-size="12" style="fill:var(--muted);">Feb 1</text>
    <text x="125" y="140" text-anchor="middle" font-size="12" style="fill:var(--faint);">…sorted…</text>
    <rect x="235" y="30" width="170" height="130" rx="10" style="fill:none;stroke:var(--accent);stroke-width:2;"/>
    <text x="320" y="54" text-anchor="middle" font-size="12" font-weight="600" style="fill:var(--fg);">status = shipped</text>
    <text x="320" y="78" text-anchor="middle" font-size="12" style="fill:var(--muted);">Jan 2</text>
    <text x="320" y="98" text-anchor="middle" font-size="12" style="fill:var(--muted);">Jan 15</text>
    <text x="320" y="118" text-anchor="middle" font-size="12" style="fill:var(--muted);">Feb 4</text>
    <text x="320" y="140" text-anchor="middle" font-size="12" style="fill:var(--faint);">…sorted…</text>
    <rect x="430" y="30" width="170" height="130" rx="10" style="fill:none;stroke:var(--fainter);stroke-width:1.5;"/>
    <text x="515" y="54" text-anchor="middle" font-size="12" font-weight="600" style="fill:var(--fg);">status = refunded</text>
    <text x="515" y="78" text-anchor="middle" font-size="12" style="fill:var(--muted);">Jan 7</text>
    <text x="515" y="98" text-anchor="middle" font-size="12" style="fill:var(--muted);">Jan 21</text>
    <text x="515" y="118" text-anchor="middle" font-size="12" style="fill:var(--muted);">Feb 2</text>
    <text x="515" y="140" text-anchor="middle" font-size="12" style="fill:var(--faint);">…sorted…</text>
    <text x="320" y="192" text-anchor="middle" font-size="12" style="fill:var(--faint);">dates are ordered inside each status — not across the table</text>
    <text x="320" y="212" text-anchor="middle" font-size="12" style="fill:var(--faint);">so a date-only filter cannot seek; it scans</text>
  </svg>
  <figcaption>Composite order nests: the second column is sorted within each value of the first.</figcaption>
</figure>

Dates are globally ordered only if `created_at` leads the index. With `(status, created_at)`, each status group has its own sorted run, so the engine can seek straight to `shipped` and then range-scan dates — but a date-only filter has no entry point and scans. This is the leftmost-prefix rule: an index on `(a, b, c)` serves filters on `a`, on `(a, b)`, and on `(a, b, c)` — never on `b` alone or `(b, c)`.

Column order should follow selectivity and query shape. Put the most frequently filtered column first; among equals, the more selective one (fewer rows per value) usually first. Equality columns come before range columns: `(status, created_at)` supports both equality-plus-range and equality-only queries, while `(created_at, status)` would serve the range poorly, since everything after a range predicate stops seeking and starts filtering.

And remember that sort direction matters for `ORDER BY`: an index on `(status ASC, created_at DESC)` serves `ORDER BY status ASC, created_at DESC` directly but not the mixed-direction reverse — Postgres and recent MySQL support mixed-direction indexes, so match the index to the query's actual ordering.

## Indexes on strings and dates

Strings and dates both index naturally, but each has a trap that the integer examples never show.

**Strings sort by collation, and collation decides what the index can do.** A B-tree on `email` compares values in the column's collation order, so `WHERE email = 'x'` and prefix searches like `WHERE email LIKE 'ankit@%'` both seek — the prefix defines a contiguous range in sort order. A leading wildcard (`LIKE '%@gmail.com'`) cannot seek, because matching rows scatter across the whole tree; that needs a trigram index (Postgres `pg_trgm`) or full-text search instead.

Case follows the same logic: under a case-sensitive collation, `WHERE email = 'Ankit@...'` and `WHERE lower(email) = 'ankit@...'` are different lookups, and only the first uses a plain index — for the second, index the expression itself (`ON users (lower(email))` in Postgres).

Two MySQL specifics: long `VARCHAR`/`TEXT` columns accept prefix indexes (`INDEX (email(20))`) that keep only the first N characters, trading precision for size — fine when prefixes discriminate, useless when they do not (URLs sharing a domain prefix, for instance). And string indexes are simply larger than integer ones, so prefer compact types and avoid indexing long free-text columns you never filter on.

**Dates are the ideal B-tree input — until functions get involved.** Timestamps are dense, ordered, and almost always queried as ranges, so an index on `created_at` serves `BETWEEN`, `>=`, and per-day reporting directly. The classic mistake is wrapping the column in a function:

```sql
-- Cannot seek: the function must run on every row first
SELECT * FROM orders WHERE YEAR(created_at) = 2025;

-- Seeks: the range is computed once, then the index does its job
SELECT * FROM orders
WHERE created_at >= '2025-01-01' AND created_at < '2026-01-01';
```

Any expression on the indexed column — date parts, casts, timezone conversions — blinds the optimizer the same way. If the expression is unavoidable, index the expression (Postgres) or a generated column (MySQL).

For append-only time series (events, metrics, logs), Postgres offers BRIN indexes: instead of one entry per row, BRIN stores the min and max per page block, making the index tiny at the cost of precision. And when old data is only ever read by month, range partitioning on the date column beats any index by skipping whole partitions before indexing even enters the picture.

## The trade-off nobody skips

Indexes are not free, and the price is paid on every write:

- **Writes get slower.** Every `INSERT`, `UPDATE`, or `DELETE` must maintain every index on the table, not just the table itself. Five indexes mean roughly five times the index-maintenance work per write.
- **They cost storage.** An index is a separate structure on disk. Wide composite and string indexes can rival the table in size.
- **They decay.** Page splits (MySQL) and dead row versions (Postgres) fragment indexes over time, so heavily written tables need periodic maintenance — `OPTIMIZE TABLE` on one side, autovacuum plus occasional `REINDEX` on the other.
- **Too many indexes hurt more than they help.** A table written constantly but queried rarely on some column should not carry an index for that column. Audit unused indexes (`pg_stat_user_indexes` in Postgres, the performance schema in MySQL) and drop them.

## A note on NoSQL: indexes in MongoDB

Everything above transfers to MongoDB almost unchanged, because WiredTiger — MongoDB's storage engine — stores indexes as B-trees with prefix compression. The concepts differ in vocabulary, not in mechanics.

```js
// Single-field index, just like the SQL version
db.users.createIndex({ email: 1 });

// Compound index: order matters exactly as in SQL (leftmost prefix applies)
db.orders.createIndex({ status: 1, createdAt: -1 });

// Multikey index: indexing an array field creates one entry per element
db.posts.createIndex({ tags: 1 });
```

The default `_id` index exists on every collection and behaves like a clustered primary key. Compound indexes follow the same leftmost-prefix rule as their SQL cousins, and MongoDB's own guidance sharpens it into the **ESR rule**: order compound keys as Equality first, then Sort, then Range — equality predicates seek precisely, the sort column avoids an in-memory sort, and the range comes last because nothing after a range can seek.

Multikey indexes have no SQL equivalent worth naming: indexing an array field like `tags` creates a separate entry per element, so `find({ tags: 'mongodb' })` seeks directly — at the cost that one document fans out into many index entries. Specialty types mirror Postgres: text indexes for search, `2dsphere` for geo, wildcard indexes for schemaless fields, and TTL indexes that auto-expire documents.

The operational story rhymes too. Unused indexes tax every write, so `db.collection.aggregate([{ $indexStats: {} }])` plays the role of `pg_stat_user_indexes`. Compound-index order is the most common design mistake, just as in SQL.

And `explain('executionStats')` is the direct analogue of `EXPLAIN ANALYZE` — check `totalDocsExamined` versus `nReturned`: when the two numbers are close, the index is doing its job; when examined dwarfs returned, the query is scanning and the index is decoration.

## A few practical rules of thumb

1. Index columns you filter (`WHERE`), join (`JOIN ... ON`), or sort (`ORDER BY`) on frequently.
2. Composite indexes are order-sensitive: `(a, b)` helps queries on `a` or `(a, b)` together, never on `b` alone. Equality columns before range columns.
3. Never wrap an indexed column in a function in the `WHERE` clause — rewrite as a range or index the expression.
4. Do not index low-cardinality columns (like a boolean `is_active` flag) — the index cannot narrow things down enough to repay its write cost. (Partial indexes on the rare value are the exception.)
5. Use `EXPLAIN` (or `EXPLAIN ANALYZE`) before and after adding an index to confirm it is actually used.

Here is what that verification looks like in practice:

```bash
EXPLAIN ANALYZE
SELECT * FROM users WHERE email = 'ankit@example.com';

# Postgres before: Seq Scan on users (cost=0.00..18334.00 rows=1)
# Postgres after:  Index Scan using idx_users_email (cost=0.42..8.44 rows=1)
```

```sql
-- MySQL equivalent
EXPLAIN SELECT * FROM users WHERE email = 'ankit@example.com';
-- type: ALL (full scan)  →  type: ref, key: idx_users_email
```

---

Indexing is one of the highest-leverage things you can do for query performance, but as this post has shown, it is a genuine trade-off, not a free win. The goal is to index what you *actually* query, and nothing more.

For further reading, the [Postgres documentation on indexes](https://www.postgresql.org/docs/current/indexes.html) is worth bookmarking — it covers every index type mentioned above in full detail.
