# SQLite → PostgreSQL Migration Guide

This document explains how to migrate an existing AetherProxy installation from
SQLite (the default) to PostgreSQL for better scalability and concurrent access.

---

## Prerequisites

- Docker + Docker Compose installed
- Existing AetherProxy running with SQLite data you want to preserve
- `sqlite3` CLI available on the host (`apt install sqlite3`)
- `psql` CLI available on the host (`apt install postgresql-client`)

---

## Step 1 – Start PostgreSQL alongside the existing SQLite instance

Add the `postgres` Docker Compose profile temporarily:

```bash
cd /opt/aetherproxy
# Edit deploy/.env and add the Postgres vars:
#   POSTGRES_DB=aether
#   POSTGRES_USER=aether
#   POSTGRES_PASSWORD=<strong-password>
#   AETHER_DB_DSN=postgres://aether:<password>@postgres:5432/aether?sslmode=disable

docker compose --profile postgres -f deploy/docker-compose.yml up -d postgres
```

Wait until Postgres is healthy:

```bash
docker compose -f deploy/docker-compose.yml ps postgres
# Status should be "healthy"
```

---

## Step 2 – Export data from SQLite

The default SQLite database lives at `/data/db/aetherproxy.db` inside the
`backend` container (volume `aether_data`). Copy it to the host:

```bash
docker compose -f deploy/docker-compose.yml cp backend:/data/db/aetherproxy.db ./aetherproxy.db
```

Dump the data to SQL (skip schema DDL – GORM will re-create it):

```bash
sqlite3 aetherproxy.db .dump > aetherproxy_dump.sql
```

The dump contains `CREATE TABLE` statements that are SQLite-specific.  
Filter them out and keep only `INSERT` statements:

```bash
grep -E '^INSERT' aetherproxy_dump.sql > aetherproxy_inserts.sql
```

> **Note:** For a large installation (many users / stats rows) consider using
> `sqlite3` `.mode csv` exports per table and `COPY` into Postgres for better
> performance.

---

## Step 3 – Apply schema to PostgreSQL via GORM AutoMigrate

Stop the backend, set `AETHER_DB_DSN`, then start it once to let GORM create
the Postgres schema:

```bash
# In deploy/.env:
AETHER_DB_DSN=postgres://aether:<password>@postgres:5432/aether?sslmode=disable

docker compose --profile postgres -f deploy/docker-compose.yml up -d backend
# The backend will call database.InitDB → database.Migrate() on startup
# Check logs to confirm AutoMigrate succeeded:
docker compose -f deploy/docker-compose.yml logs backend | grep -i migrat
```

---

## Step 4 – Import data into PostgreSQL

```bash
# Get the Postgres container name
PG=$(docker compose -f deploy/docker-compose.yml ps -q postgres)

# Copy the insert script into the container
docker cp aetherproxy_inserts.sql "$PG":/tmp/inserts.sql

# Run it (adjust credentials to match your .env)
docker exec -it "$PG" psql -U aether -d aether -f /tmp/inserts.sql
```

If you encounter constraint violations (e.g., duplicate primary keys from the
default `admin` user inserted by `initUser()`), truncate those tables first:

```bash
docker exec -it "$PG" psql -U aether -d aether -c "TRUNCATE users RESTART IDENTITY CASCADE;"
```

---

## Step 5 – Verify and clean up

```bash
# Tail backend logs to ensure it starts cleanly
docker compose --profile postgres -f deploy/docker-compose.yml logs -f backend

# Quick sanity check – list users via API
curl -s http://localhost:2095/api/users -H "Authorization: Bearer <your-token>" | jq .

# Remove the old SQLite backup once satisfied
rm aetherproxy.db aetherproxy_dump.sql aetherproxy_inserts.sql
```

---

## Reverting to SQLite

Remove `AETHER_DB_DSN` from `deploy/.env` and restart the backend:

```bash
# In deploy/.env – comment out or remove:
# AETHER_DB_DSN=...

docker compose -f deploy/docker-compose.yml restart backend
```

GORM will fall back to the SQLite file path derived from `AETHER_DB_FOLDER`.
