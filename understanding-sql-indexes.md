An index is just a sorted lookup structure that sits alongside your table. Without one, the database has to scan every row to find what you're looking for — a full table scan. With one, it can jump straight to the matching rows, the same way a book's index saves you from reading every page to find a topic.

## Why they matter

Say you have a `users` table with a million rows and you run:

```sql
SELECT * FROM users WHERE email = 'ankit@example.com';
```

Without an index on `email`, the database checks all one million rows, one by one. With an index, it does something closer to a binary search — a handful of comparisons instead of a million.

## How they actually work

Most relational databases implement indexes using a **B-tree** (balanced tree). Every node stores sorted keys, and each level of the tree narrows the search down further, so lookups, range queries, and sorted scans all stay fast — roughly O(log n) instead of O(n).

There's also the **hash index**, which is faster for exact-match lookups (`=`) but can't help with range queries (`>`, `<`, `BETWEEN`) or sorting, since hashing throws away order.

## The trade-off nobody skips

Indexes aren't free:

- **Writes get slower.** Every `INSERT`, `UPDATE`, or `DELETE` has to update every index on that table, not just the table itself.
- **They cost storage.** An index is a separate structure that lives on disk alongside your table.
- **Too many indexes hurt more than they help.** If a table is written to constantly but rarely queried on certain columns, indexing those columns is pure overhead.

## A few practical rules of thumb

1. Index columns you filter (`WHERE`), join (`JOIN ... ON`), or sort (`ORDER BY`) on frequently.
2. Composite indexes are order-sensitive — an index on `(a, b)` helps queries filtering on `a`, or on `a` and `b` together, but not on `b` alone.
3. Don't index low-cardinality columns (like a boolean `is_active` flag) — the index won't narrow things down enough to be worth the write cost.
4. Use `EXPLAIN` (or `EXPLAIN ANALYZE`) before and after adding an index to confirm it's actually being used.

Indexing is one of the highest-leverage things you can do for query performance — but it's a trade-off, not a free win. The goal is to index what you actually query, and nothing more.
