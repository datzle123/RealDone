# Database source-of-truth adapters

Database checks are explicit Level 6 contract assertions. Quick scan still has no database dependency. All adapters default to read-only verification, map contract aliases to allowlisted fields, hash row snapshots instead of storing values, and require a separate cleanup confirmation.

## SQLite: zero-config default

SQLite needs only the database file; no mapping JSON is required:

```bash
realdone verify .realdone/flows/create-customer.json \
  --sqlite ./data/application.sqlite
```

`realdone init` lists discovered `.db`, `.sqlite`, and `.sqlite3` paths in `databaseFiles`. SQLite opens read-only with `query_only`, discovers tables/columns/primary keys/soft-delete fields, parameterizes filter values, and supports bounded hash snapshots plus row diff. Cleanup opens a separate write connection only with both `cleanup --confirm --confirm-database --sqlite ...`; the contract must provide exactly every primary-key field.

## Remote/direct adapters

Pass one or more versioned mapping files:

```bash
realdone verify flow.json \
  --database-config .realdone/supabase.json \
  --database-config .realdone/firebase.json
```

| Adapter | Runtime | Safety contract |
| --- | --- | --- |
| PostgreSQL | optional `pg`, read-only transaction | live catalog discovery, PK-aware hash snapshots/diff, allowlisted identifiers, parameters, explicit TLS, guarded key cleanup |
| Supabase | PostgREST over `fetch` | mapped tables/fields, env key, HTTPS/remote opt-in, PK-only cleanup |
| Firebase | official Firestore REST shapes | mapped collection/fields, ID/OAuth token, HTTPS/remote opt-in, document-ID cleanup |
| MongoDB | optional official Node driver | mapped collection/fields, env URL, explicit TLS, bounded pool/timeouts, PK-only cleanup |

Examples: [`realdone.postgres.json`](../examples/realdone.postgres.json), [`realdone.supabase.json`](../examples/realdone.supabase.json), [`realdone.firebase.json`](../examples/realdone.firebase.json), and [`realdone.mongodb.json`](../examples/realdone.mongodb.json).

`allowProduction` is deliberately false by default for Supabase, Firebase, and MongoDB configurations. Set it only for an explicitly selected disposable sandbox/test project; the name is an acknowledgment, not an assertion by RealDone that the endpoint is safe. PostgreSQL verification remains read-only; any PostgreSQL cleanup still requires both CLI confirmation and an allowlisted cleanup key.

## Contract assertion

```json
{
  "type": "source",
  "adapter": "sqlite",
  "resource": "customers",
  "filters": [{ "field": "email", "env": "RD_CUSTOMER_EMAIL" }],
  "state": "present",
  "maxMatches": 1
}
```

Reports contain matched row counts, alias names, a query hash, duration, and pass/fail—never filter values, connection strings, rows, or database URLs.

## Prisma and custom databases

Prisma Client is generated for one project's schema and output path, so RealDone does not guess or import a global Prisma client. Use a reviewed source plugin that calls the project-owned generated client. Plugin SDK v1 supports count verification, schema/primary-key/soft-delete discovery, bounded row snapshots, and guarded cleanup. Snapshot rows cross the trusted worker boundary only long enough for immediate hashing; raw values are never written to reports or ledgers. The checked-in [`prisma-source`](../examples/plugins/prisma-source/realdone.plugin.json) bridge defines that boundary.

```json
{
  "type": "source",
  "adapter": "prisma",
  "connector": "project-prisma",
  "resource": "customer",
  "filters": [{ "field": "email", "env": "RD_CUSTOMER_EMAIL" }],
  "state": "present"
}
```

Run verification with `--plugin ./examples/plugins/prisma-source/realdone.plugin.json`. A `custom` source connector uses the same versioned worker protocol. Cleanup targets repeat the same `connector` and require:

```bash
realdone cleanup --report-dir .realdone/verifications/<id> \
  --confirm --confirm-database \
  --plugin ./examples/plugins/prisma-source/realdone.plugin.json
```

Core checks that cleanup filters equal the discovered primary key and rejects a plugin result that reports more than one deletion. Plugin code remains trusted; worker permissions, residual filesystem/network authority, and limits are described in the [Plugin SDK](PLUGIN_SDK.md).
