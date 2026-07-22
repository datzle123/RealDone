# PostgreSQL source verification

The PostgreSQL adapter confirms that an observed browser action reached the configured source of truth. It is optional, local-first, and only runs for explicit `source` expectations.

## Configure an allowlist

Copy `examples/realdone.postgres.json` under `.realdone/` and map stable contract aliases to real identifiers:

```json
{
  "schemaVersion": "1.0",
  "adapter": "postgresql",
  "connectionEnv": "REALDONE_DATABASE_URL",
  "tls": { "mode": "verify-full", "caEnv": "REALDONE_DATABASE_CA" },
  "connectionTimeoutMs": 5000,
  "statementTimeoutMs": 5000,
  "allowCleanup": false,
  "resources": {
    "customers": {
      "schema": "public",
      "table": "customers",
      "columns": { "id": "id", "email": "email", "name": "display_name" },
      "cleanupKey": ["id"],
      "cleanupMaxRows": 1
    }
  }
}
```

Contracts use `customers`, `email`, and `name`; they cannot choose an arbitrary schema, table, or column. Identifiers must match a conservative PostgreSQL identifier grammar. Filter values are always sent separately as `$1`, `$2`, and so on.

## Verify Level 6 evidence

Add a source assertion to the step that should create or change the row:

```json
{
  "type": "source",
  "adapter": "postgresql",
  "resource": "customers",
  "filters": [
    { "field": "email", "value": "rd-test@example.test" }
  ],
  "state": "present",
  "maxMatches": 1
}
```

Then supply credentials only to the process:

```bash
export REALDONE_DATABASE_URL='postgres://...'
export REALDONE_DATABASE_CA="$(cat root.crt)"
realdone verify .realdone/flows/create-customer.json \
  --postgres-config .realdone/postgres.json
```

The adapter executes `SELECT COUNT(*)` in a read-only transaction with a bounded statement timeout. Reports contain the resource alias, matched row count, mapped field names, timing, and query hash. They do not contain the database URL or filter values.

The public adapter API also discovers mapped column types/nullability and real primary keys from PostgreSQL catalogs. Bounded snapshots select only mapped columns, hash primary-key and row values in memory, detect mapped soft-delete aliases, and expose value-free input to `diffSourceSnapshots`; raw rows are never written to verification evidence.

## TLS modes

- `verify-full` is the default and validates the server certificate. `caEnv` is optional when the platform trust store already contains the CA.
- `require` encrypts the connection but disables certificate verification; use it only for an explicitly trusted test environment.
- `disable` is intended for an isolated local Docker fixture.

Do not put `sslmode`, `sslcert`, `sslkey`, or `sslrootcert` in the connection URL. RealDone rejects that mix so the checked-in TLS policy cannot be silently replaced by URL options.

## Transaction-aware cleanup

A contract can add a database target to its `cleanup` array:

```json
{
  "adapter": "postgresql",
  "resource": "customers",
  "filters": [{ "field": "id", "env": "RD_CUSTOMER_ID" }]
}
```

Verification writes this target to `cleanup-ledger.json`. Inspection remains a dry run:

```bash
realdone cleanup --report-dir .realdone/verifications/<verification-id>
```

Execution requires all three gates:

1. set `allowCleanup` to `true` in the adapter config;
2. pass both `--confirm` and `--confirm-database`;
3. filter by exactly the resource's configured `cleanupKey` fields; the transaction rolls back if it exceeds `cleanupMaxRows` (default `1`).

```bash
realdone cleanup \
  --report-dir .realdone/verifications/<verification-id> \
  --postgres-config .realdone/postgres.json \
  --confirm --confirm-database
```

Cleanup runs in a dedicated read-write transaction. Deleting zero rows is treated as success, making repeated cleanup idempotent.

## Local integration fixture

```bash
pnpm postgres:up
REALDONE_POSTGRES_TEST_URL=postgres://realdone:realdone@127.0.0.1:55432/realdone pnpm test:postgres
```

GitHub Actions runs the same integration test against an isolated PostgreSQL 17 service.
