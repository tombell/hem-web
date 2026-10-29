# Apple Container deployment

This is an opt-in deployment, not a production cutover script. Native
`scripts/start-launchd.sh` remains unchanged for rollback. The site's private
migration handoff holds production-specific configuration and transfer evidence;
never put it, a database, or an env file in the build context.

## Build and checks

Requires Apple `container` 1.6.1 on Apple Silicon. The image pins Linux ARM64
Node 24.22.2 by digest and pnpm 11.8.0. Frozen lockfile installs compile
better-sqlite3 in Linux. The runtime copies production dependencies only, not the
compiler, test tools, pnpm store, or host node_modules. Debian compiler packages
come from Bookworm repositories during the build: this is not a promise of
bit-for-bit reproducibility across future apt repository changes. Preserve the
verified release digest instead of rebuilding during promotion.

```sh
container build --platform linux/arm64 --cpus 2 --memory 2G \
  --target checks --progress plain -t hem-web-checks:release .
container build --platform linux/arm64 --cpus 2 --memory 2G \
  --target runtime --progress plain -t hem-web:release .
# Audit the filtered context independently; destination must be new/private.
container build --platform linux/arm64 --cpus 2 --memory 2G \
  --target context-audit --output type=local,dest=/private/release/context .
container image inspect hem-web:release
```

`checks` executes `pnpm test`, `pnpm typecheck`, `pnpm lint`, and
`pnpm fmt:check`. The tests include fake-runtime watchdog refusal/recovery tests.
Select `runtime` explicitly when building the release. Use a release-specific tag
and record its digest plus working-tree hashes; do not overwrite a tested release
tag.

## Runtime boundary

Create a private directory (0700) outside the repo with `umask 077`, and an
owner-only (0600) literal `KEY=value` runtime env file. It is **not** a shell script.
Include the required `HERMES_HEALTH_BEARER_TOKEN` and preserve the effective
`HERMES_HEALTH_PUBLIC_URL`, limits and token. Native launcher precedence is
external env, then project `.env`; do not assume the external token is effective.
Do not print env files, raw runtime inspect output, or authenticated requests.
Runtime administrators can read injected env through inspect; host trust is still
required. Never use build args for secrets.

Set `IMAGE` to the exact preserved release reference and `ENV_FILE` to that file.
For disposable tests use only a random synthetic token, container `hem-web-test`,
volume `hem-web-test-data`, port `13000`, and a separate watchdog state directory.
Never import production data into tests. Check names, volume and port are unused
first; collisions are not permission to delete existing resources.

```sh
umask 077
container volume create -s 4G hem-web-data
# One-shot root helper; the application itself always runs as 1000:1000.
container run --rm --name hem-web-init --user 0:0 \
  --mount type=volume,source=hem-web-data,target=/data \
  --entrypoint /bin/sh "$IMAGE" -c 'chown 1000:1000 /data; chmod 700 /data'
# Only after a consistent production snapshot has been imported and verified:
container run --detach --name hem-web --platform linux/arm64 \
  --cpus 1 --memory 512M --network default,mtu=1280 \
  --user 1000:1000 --read-only --cap-drop ALL \
  --tmpfs /tmp:size=64M,mode=1777 \
  --mount type=volume,source=hem-web-data,target=/data \
  --publish 127.0.0.1:3000:3000 --env-file "$ENV_FILE" \
  --env HOST=0.0.0.0 --env PORT=3000 \
  --env HERMES_HEALTH_DB_PATH=/data/hem.sqlite "$IMAGE"
```

The entrypoint sets umask 077 and execs Node directly. SIGTERM closes Fastify and
SQLite. The root filesystem is read-only, capabilities are dropped, and only the
named `/data` volume and bounded `/tmp` tmpfs are writable. No home, repository,
runtime socket or secret-file mount is needed. Mount the **directory**, not one
SQLite file (WAL/SHM must remain together). Verify UID/GID 1000, directory 0700,
SQLite/WAL/SHM 0600, actual loopback host listener and both internal/host `/ready`.
An all-interface bind inside the VM is intentional; an all-interface host
publisher is not. Preserve the existing reverse proxy and advertised URL.

Verify unauthenticated rejection, authenticated API, synthetic import/query and
deduplication, and persistence across stop/start **and recreation** before
promotion. Inspect layers/context for secrets/data; inspect logs without exposing
health records. Remove only owned test containers/volume/listeners. Retain the
release image.

## Narrow login-session recovery

The CLI has no restart policy. `scripts/container-watchdog.py` is a one-shot
watchdog for an **existing** `hem-web` container, not a runtime manager or an
installer. It never creates/deletes containers, changes images/volumes, starts the
shared runtime, changes Serve, or touches Executor. It refuses unexpected user,
mounts, capabilities, sockets or publication. It locks its owner-only state
directory to serialize manual and launchd invocation.

- A `maintenance` file in the state directory suppresses all action.
- A stopped container is started and host readiness is awaited.
- A running container requires three consecutive host readiness failures. If
  internal readiness succeeds, forwarding is reported and no restart occurs.
- If the internal app also fails, only Hem is stopped/started, with a five-minute
  cooldown. Missing container/runtime/config fails closed for operator attention.
- Logs contain generic state only, not inspect output, requests or credentials.

At an authorized cutover, generate a separate plist with label
`io.hem.web.container`, `RunAtLoad=true`, `StartInterval=30` (no KeepAlive), and
`ProgramArguments` containing the verified absolute Python path, absolute script
path, `--name hem-web --port 3000 --state-dir /private/release/watchdog` as separate
arguments. Use owner-only logs outside the repo and validate with `plutil -lint`.
Install/bootstrap only this label, **not** the shared Container LaunchAgent.
Test against the isolated name/port before enabling production. Recovery is
user-login-session only, not guaranteed before login/FileVault unlock or when the
shared runtime is broken. The next tick retries runtime availability without
restarting it. A successful launchctl operation is not proof of app readiness.

For maintenance, create the marker first, wait for any current watchdog to exit
(the lock is released at exit), then bootout the exact new job before manual
container operations. Remove the marker and bootstrap the same plist when safe.
Do not assume a manual `container stop` will stay stopped while watchdog is enabled.

## Cutover and rollback gates

Production cutover needs separate approval. Keep native plist, launcher, Node and
node_modules intact. Back up configuration privately and preserve Serve unchanged.

1. Stage and verify the immutable image and effective runtime config first.
2. Suppress the new watchdog. Quiesce native Hem **only** and verify no writer or
   listener remains. Never run both authoritative DB copies concurrently.
3. Use SQLite `.backup`, not `cp` on a live main file. Keep the original main/WAL/
   SHM together for rollback. Check snapshot integrity, foreign keys, schema
   version 5 and all six table counts; a `/ready` response is not a transfer proof.
4. Import the self-contained snapshot through stdin with a one-shot helper into
   a new named volume, no host mounts. Refuse an existing destination file. Set
   ownership 1000:1000 and modes 0700/0600; verify imported counts before start.
5. Start on `127.0.0.1:3000`, check local and both existing HTTPS routes, auth,
   advertised OpenAPI origin and data invariants, then enable only the new job.

Before any container writes, rollback can stop/suppress the new job/container and
bootstrap the unchanged native plist after verifying port 3000 is free. After
**any possible accepted write**, first stop the container, export a fresh
consistent backup from its volume through stdout with progress disabled, verify
schema/native compatibility, integrity and all table counts, then restore into a
clean original native path with both services stopped. Preserve old native
main/WAL/SHM together; never mix stale sidecars with the restored snapshot. Verify
native readiness/auth/HTTPS after restart. Do not discard post-cutover imports
merely because a health check failed. Keep both histories and backup evidence.

The private migration `operations.md` provides the site-specific executable
transfer/export/rollback commands; it is not a public artifact. No command in this
document authorizes a cutover by itself.
