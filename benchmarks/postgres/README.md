# PostgreSQL adapter fixture

Start the isolated PostgreSQL fixture:

```bash
docker compose -f benchmarks/postgres/docker-compose.yml up -d --wait
```

Run the adapter integration test:

```bash
REALDONE_POSTGRES_TEST_URL=postgres://realdone:realdone@127.0.0.1:55432/realdone pnpm test
```

The fixture uses port `55432`, disables TLS only for the local container, and contains no production data.
