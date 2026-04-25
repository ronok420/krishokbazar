# Neon PostgreSQL Connection Troubleshooting

This file summarizes the database connection issue from start to current status.

## Problem

The backend sometimes fails to connect to Neon PostgreSQL when using Link3 WiFi.

Backend command:

```bash
npm run dev
```

Main failing error:

```text
Database সংযোগ ব্যর্থ: ETIMEDOUT
```

The same Neon database connection worked from a mobile hotspot, so the first suspicion was ISP/network routing.

Important comparison:

- Mobile hotspot: backend database connection worked.
- Link3 WiFi / `Sparrow_5G`: backend database connection failed with timeout errors.

This comparison was one of the main reasons ISP/network routing was investigated first.

## Environment

- Project path: `/home/sparrow/Documents/krisok/backend`
- Backend command: `npm run dev`
- Node app entry: `src/server.js`
- DB config file: `src/config/db.js`
- PostgreSQL client library: `pg@8.11.5`
- WiFi connection name: `Sparrow_5G`
- WiFi device: `wlp3s0`
- Mobile hotspot test: worked
- Link3 WiFi test: failed from the Node backend
- Database provider: NeonDB PostgreSQL
- Neon host:

```text
ep-aged-poetry-ailnj519-pooler.c-4.us-east-1.aws.neon.tech
```

- Resolved IP seen during testing:

```text
98.91.36.187
```

Important: the database password was exposed during debugging and should be rotated in the Neon dashboard. Do not store or share the raw password in documentation.

## Original Connection String Shape

The original Neon URL included:

```text
postgresql://neondb_owner:<REDACTED_PASSWORD>@ep-aged-poetry-ailnj519-pooler.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require
```

Later, `channel_binding=require` was removed for testing.

## Backend DB Config

The backend uses `DATABASE_URL` when present:

```js
const poolConfig = hasConnectionString
  ? {
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 15000,
    }
  : {
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT || 5432,
      database: process.env.DB_NAME || 'krishokbazar_test',
      user: process.env.DB_USER || 'testuser',
      password: process.env.DB_PASSWORD || 'testpass123',
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    };
```

Because `DATABASE_URL` exists, the local `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, and `DB_PASSWORD` fallback values should not be used by the app.

## Tests Performed

### 1. TCP Port Test

Command:

```bash
nc -vz ep-aged-poetry-ailnj519-pooler.c-4.us-east-1.aws.neon.tech 5432
```

Result:

```text
Connection to ep-aged-poetry-ailnj519-pooler.c-4.us-east-1.aws.neon.tech (98.91.36.187) 5432 port [tcp/postgresql] succeeded!
```

Conclusion:

TCP port `5432` is not simply blocked on Link3 WiFi.

### 2. IPv4-First Node Test

Command:

```bash
NODE_OPTIONS=--dns-result-order=ipv4first npm run dev
```

Result:

```text
Database সংযোগ ব্যর্থ: ETIMEDOUT
```

Conclusion:

Forcing IPv4-first DNS order did not solve the app connection timeout.

### 3. Direct `psql` Test

Command:

```bash
psql "postgresql://neondb_owner:<REDACTED_PASSWORD>@ep-aged-poetry-ailnj519-pooler.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require"
```

Result:

```text
psql (18.3, server 17.8)
SSL connection (protocol: TLSv1.3, cipher: TLS_AES_256_GCM_SHA384, compression: off, ALPN: postgresql)
neondb=>
```

Conclusion:

The database, password, SSL, and Link3 network can work with `psql`.

This strongly suggests the issue is specific to the Node.js app / `pg` client / connection string behavior, not a total ISP block.

### 4. Standalone Node `pg` Test With Hostname

A standalone Node script was run using `pg` and the same `DATABASE_URL`.

Result from one diagnostic run:

```text
DATABASE_URL present: true
masked url: postgresql://neondb_owner:***@ep-aged-poetry-ailnj519-pooler.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require
host: ep-aged-poetry-ailnj519-pooler.c-4.us-east-1.aws.neon.tech
port: 5432
Node pg failed after 25 ms
message: getaddrinfo EAI_AGAIN ep-aged-poetry-ailnj519-pooler.c-4.us-east-1.aws.neon.tech
code: EAI_AGAIN
```

Conclusion:

At least once, Node failed during DNS resolution for the Neon hostname.

### 5. Standalone Node `pg` Test With Resolved IP

A standalone Node script was run using the resolved IP `98.91.36.187`, while setting the SSL server name to the original Neon hostname.

Result:

```text
Node pg IP connected in 2023 ms
```

Conclusion:

Node can connect to Neon when DNS is bypassed and SSL server name is handled correctly.

This pointed toward DNS, hostname resolution, SNI, or Neon endpoint routing behavior.

## DNS Change Attempt

The active WiFi connection was checked:

```bash
nmcli connection show --active
```

Result:

```text
NAME        TYPE  DEVICE
Sparrow_5G  wifi  wlp3s0
lo          loopback lo
```

Suggested DNS change:

```bash
sudo nmcli connection modify "Sparrow_5G" ipv4.dns "1.1.1.1 8.8.8.8" ipv4.ignore-auto-dns yes
sudo nmcli connection down "Sparrow_5G"
sudo nmcli connection up "Sparrow_5G"
```

Purpose:

Use Cloudflare and Google DNS instead of ISP DNS.

Result after retrying backend:

```text
Database সংযোগ ব্যর্থ: ETIMEDOUT
```

Conclusion:

Changing DNS did not solve the backend connection issue.

Undo command if needed:

```bash
sudo nmcli connection modify "Sparrow_5G" ipv4.ignore-auto-dns no ipv4.dns ""
sudo nmcli connection down "Sparrow_5G"
sudo nmcli connection up "Sparrow_5G"
```

## IP Workaround Attempt

The `DATABASE_URL` host was changed from the Neon hostname to the IP:

```text
98.91.36.187
```

Example shape:

```text
postgresql://neondb_owner:<REDACTED_PASSWORD>@98.91.36.187/neondb?sslmode=require
```

Result:

```text
Hostname/IP does not match certificate's altnames: Host: localhost. is not in the cert's altnames: DNS:*.c-4.us-east-1.aws.neon.tech
```

Conclusion:

Using the raw IP in `DATABASE_URL` is not a clean fix because Neon SSL certificates are issued for the Neon hostname, not the raw IP.

The standalone Node test worked with IP only because it explicitly supplied the SSL `servername` as the Neon hostname.

## Removing `sslmode=require`

The URL was changed to remove query parameters because `src/config/db.js` already sets SSL:

```text
postgresql://neondb_owner:<REDACTED_PASSWORD>@ep-aged-poetry-ailnj519-pooler.c-4.us-east-1.aws.neon.tech/neondb
```

Result:

```text
Endpoint ID is not specified. Either please upgrade the postgres client library (libpq) for SNI support or pass the endpoint ID (first part of the domain name) as a parameter: '?options=endpoint%3D<endpoint-id>'.
```

Conclusion:

Neon requires endpoint routing information for this connection. The app/driver was not sending enough SNI/endpoint information in that configuration.

## Current Recommended URL To Try

Try adding Neon endpoint options explicitly:

```text
postgresql://neondb_owner:<REDACTED_PASSWORD>@ep-aged-poetry-ailnj519-pooler.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require&options=endpoint%3Dep-aged-poetry-ailnj519
```

If that still gives the endpoint error, try the pooler endpoint id:

```text
postgresql://neondb_owner:<REDACTED_PASSWORD>@ep-aged-poetry-ailnj519-pooler.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require&options=endpoint%3Dep-aged-poetry-ailnj519-pooler
```

Then restart:

```bash
npm run dev
```

## Current Diagnosis

What is confirmed:

- Link3 WiFi can reach TCP port `5432`.
- `psql` can connect to the Neon database successfully.
- The app still fails with Node `pg`.
- DNS change to `1.1.1.1` and `8.8.8.8` did not fix the backend.
- A standalone Node test connected when using IP plus proper SSL server name.
- Raw IP in `DATABASE_URL` is not a proper fix because of Neon SSL/SNI behavior.
- Removing SSL query parameters produced a Neon endpoint ID error.

Most likely cause:

The issue is in the interaction between Node.js `pg`, the Neon pooler hostname, SSL/SNI, and endpoint routing options. It is no longer proven to be a simple ISP block.

## What To Tell ISP

Do not say port `5432` is fully blocked, because `nc` and `psql` succeeded.

Better message:

```text
PostgreSQL TCP port 5432 is reachable, and psql connects to Neon successfully.
However, Node.js pg connections to the Neon pooler hostname still time out or fail.
Please check DNS/routing/packet loss/TLS stability from my Link3 connection to:
ep-aged-poetry-ailnj519-pooler.c-4.us-east-1.aws.neon.tech
Resolved IP observed: 98.91.36.187
WiFi connection: Sparrow_5G
```

## Security Follow-Up

The database password was exposed during troubleshooting.

Required action:

1. Rotate the Neon database password in the Neon dashboard.
2. Update `backend/.env` with the new password.
3. Remove old commented `DATABASE_URL` lines containing real passwords.
4. Do not share full `DATABASE_URL` values publicly.

