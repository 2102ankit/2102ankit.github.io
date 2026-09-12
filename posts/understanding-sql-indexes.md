---
title: Understanding SQL Indexes
description: How indexes work and when they actually help
date: 2026-09-12
show: true
---
An index is just a sorted lookup structure that sits alongside your table. Without one, the database has to scan every row to find what you're looking for — a full table scan. With one, it can jump straight to the matching rows, the same way a book's index saves you from reading every page to find a topic.

> **Rule of thumb:** measure first, index second. An index you never query against is pure overhead — it slows down every write and buys you nothing back.

## Why they matter

Say you have a `users` table with a million rows and you run:

```sql
SELECT * FROM users WHERE email = 'ankit@example.com';
```

Without an index on `email`, the database checks all one million rows, one by one. With an index, it does something closer to a binary search — a handful of comparisons instead of a million.

## How they actually work

Most relational databases implement indexes using a **B-tree** (balanced tree). Every node stores sorted keys, and each level of the tree narrows the search down further, so lookups, range queries, and sorted scans all stay fast — roughly O(log n) instead of O(n).

There's also the **hash index**, which is faster for exact-match lookups (`=`) but can't help with range queries (`>`, `<`, `BETWEEN`) or sorting, since hashing throws away order.

### B-tree vs. hash, side by side

| Capability            | B-tree index | Hash index |
|------------------------|:---:|:---:|
| Exact match (`=`)       | ✅ | ✅ |
| Range queries (`>`, `<`, `BETWEEN`) | ✅ | ❌ |
| `ORDER BY` support      | ✅ | ❌ |
| Lookup complexity       | O(log n) | O(1) avg |
| Typical use case        | Default for most columns | High-throughput exact lookups |

## The trade-off nobody skips

Indexes aren't free:

- **Writes get slower.** Every `INSERT`, `UPDATE`, or `DELETE` has to update every index on that table, not just the table itself.
- **They cost storage.** An index is a separate structure that lives on disk alongside your table.
- **Too many indexes hurt more than they help.** If a table is written to constantly but rarely queried on certain columns, indexing those columns is pure overhead.

## A few practical rules of thumb

1. Index columns you filter (`WHERE`), join (`JOIN ... ON`), or sort (`ORDER BY`) on frequently.
2. Composite indexes are order-sensitive:
   - An index on `(a, b)` helps queries filtering on `a`, or on `a` and `b` together
   - It does **not** help queries filtering on `b` alone
3. Don't index low-cardinality columns (like a boolean `is_active` flag) — the index won't narrow things down enough to be worth the write cost.
4. Use `EXPLAIN` (or `EXPLAIN ANALYZE`) before and after adding an index to confirm it's actually being used.

Here's what that verification looks like in practice:

```bash
EXPLAIN ANALYZE
SELECT * FROM users WHERE email = 'ankit@example.com';

# Before index: Seq Scan on users (cost=0.00..18334.00 rows=1)
# After index:  Index Scan using idx_users_email (cost=0.42..8.44 rows=1)
```

---

Indexing is one of the highest-leverage things you can do for query performance, but as the table above shows, it's a genuine trade-off, not a free win. The goal is to index what you *actually* query, and nothing more.

For further reading, the [Postgres documentation on indexes](https://www.postgresql.org/docs/current/indexes.html) is worth bookmarking — it's the source I keep coming back to whenever I forget the composite-index ordering rule above.