# Migration off Turso - runbook

Date: 2026-07-03. Reason: Turso free-tier read quota exhausted, reads blocked for the
org. Root cause: embedded-replica mode bills server-side rows read for every sync,
and two replicas (laptop + EC2) syncing a 330MB bar-heavy DB with daily write crons
burned the quota. (Side observation from the migration, unrelated to Turso: stored
15m bars stop at 2026-06-25 because `ALPACA_ENABLED` is unset on prod - the
intraday auto-trade cron, which owns 15m ingestion, never starts; prod logs confirm
"Alpaca disabled ... Intraday auto-trade cron not started". Live trading runs on
the DAILY paths: `AUTO_TRADE_TIMEFRAME=1d` + `DAILY_AUTO_TRADE_ENABLED=1`.)

Target architecture (no new services, no payment details anywhere):

- Prod EC2 runs plain local SQLite (`client.ts` already has this mode - the
  `else` branch in `getDb()`, WAL mode, activated by unsetting
  `TURSO_DATABASE_URL`). Prod is the single writer and the source of truth.
- Backup + laptop sync are the same mechanism: `scripts/pull-prod-db.sh`
  (`npm run pull-prod-db`) makes a consistent snapshot on the box via
  `VACUUM INTO` and scp's it down over the existing SSH key. The laptop copy IS
  the offsite backup. Run it after anything important and at least weekly.
- Optional belt-and-braces: a daily on-box snapshot cron (Part 2) keeps 3 local
  rolling copies on the EC2 disk - protects against file corruption, not
  instance loss (the laptop pull covers that).
- Laptop runs plain local SQLite on the pulled snapshot, `LOCAL_DEV_MODE=1` as
  before. Local never writes to prod data.
- Manual actions against live prod data: use prod's own UI (SSH tunnel:
  `ssh -i <key> -L 3000:localhost:3000 <host>`, then http://localhost:3000) -
  not a second writer to the same file.

(A Cloudflare R2 + Litestream design was considered and dropped: R2's free tier
is $0 but requires a payment method on file. SSH pull needs nothing new.)

Status checklist:

- [x] Local laptop migrated (2026-07-03): `.env` Turso vars commented out,
      `DB_PATH=./data/quantdesk.db` rebuilt from the replica via `VACUUM INTO`,
      verified 2,360,839 bars / 12 paper trades / API serving.
- [x] Prod EC2 migrated (2026-07-03): replica converted via `VACUUM INTO`
      (integrity ok, 2,360,899 bars, 12 trades), `.env` flipped (backup at
      `.env.bak-turso`), app restarted, bars API + crons verified. Old replica
      kept at `data/turso-replica-retired.db` for one week.
- [x] First `npm run pull-prod-db` verified end-to-end (2026-07-03: snapshot on
      box, scp, integrity ok, 2,360,899 bars / 12 trades, swapped into place)
- [ ] Turso org/database deleted (last step, after a week of stable operation)

---

## Part 1 - Prod EC2 migration

No code deploy needed - the plain-SQLite path already ships (`src/core/db/client.ts`
lines 57-63). This is an env flip plus a file conversion. Market note: 2026-07-03 is
the observed July-4 holiday (July 4 is a Saturday), US market closed - safe window.

Run on the EC2 box (SSM session or `aws ssm send-command`), as ec2-user:

```bash
cd /home/ec2-user/quantdesk

# 0. Confirm current state - note the replica path (DB_PATH; default data/quantdesk.db)
grep -n "TURSO\|DB_PATH" .env

# 1. Stop the app (also stops all node-cron jobs inside it)
~/.nvm/versions/node/v22.23.0/bin/pm2 stop quantdesk

# 2. Convert the replica cache into a clean standalone DB.
#    REPLICA below = the DB_PATH value from step 0 (default data/quantdesk.db).
#    If DB_PATH already equals data/quantdesk.db, move it aside first:
REPLICA=data/quantdesk.db   # <- adjust to the step-0 value
sqlite3 "$REPLICA" "PRAGMA integrity_check;"          # must print: ok
mv "$REPLICA" data/turso-replica-retired.db
mv "$REPLICA-info" data/turso-replica-retired.db-info 2>/dev/null || true
sqlite3 data/turso-replica-retired.db "VACUUM INTO 'data/quantdesk.db'"

# 3. Verify the standalone copy
sqlite3 data/quantdesk.db "PRAGMA integrity_check;
  SELECT 'bars', COUNT(*) FROM bars;
  SELECT 'paper_trades', COUNT(*) FROM paper_trades;
  SELECT MAX(time) FROM bars WHERE timeframe='1d';"
# Expect: ok; bars ~2.36M; paper_trades 12; 1d max 2026-07-02 or 03.
# If paper_trades < 12 the prod replica is staler than the laptop's copy -
# STOP and compare with the laptop's data/quantdesk.db before proceeding.

# 4. Env flip - comment out both Turso lines, keep/set DB_PATH:
#      # TURSO_DATABASE_URL=...
#      # TURSO_AUTH_TOKEN=...
#      DB_PATH=./data/quantdesk.db
vi .env

# 5. Restart and verify
~/.nvm/versions/node/v22.23.0/bin/pm2 restart quantdesk --update-env
sleep 10
curl -s "http://localhost:3000/api/bars?symbol=AAPL&timeframe=1d&limit=2"   # bars JSON
~/.nvm/versions/node/v22.23.0/bin/pm2 logs quantdesk --lines 30 --nostream  # no libsql/Turso errors
```

Post-restart checks:

- 15m bars will NOT resume on their own: the intraday cron is off by config
  (`ALPACA_ENABLED` unset), which is fine while live trading runs the daily
  paths. If/when the intraday path is re-enabled, `ingestIntraday`'s rolling
  `LOOKBACK_DAYS = 21` window (`src/core/data/intraday-ingest.ts`) backfills up
  to 21 days - a longer gap needs a manual backfill.
- Check no paper trade writes were lost during the blocked window: writes between
  the block and the migration failed loudly (they went to the blocked primary).
  Compare open positions in the UI against the last Telegram alerts.

Rollback (if anything looks wrong): uncomment the two Turso lines in `.env`, set
`DB_PATH` back to the replica path, move `data/turso-replica-retired.db` back, and
`pm2 restart quantdesk --update-env`. Nothing is deleted by this runbook.

Cleanup after a week of stable operation: delete `data/turso-replica-retired.db*`,
then delete the Turso database/org so no one re-enables it by accident.
*(Update 2026-07-04: the prod-side backup files were deleted a week EARLY, with
user approval - the 8GB root disk hit 91% and `npm ci` failed mid-deploy,
leaving `node_modules` without the `next` binary. The laptop's verified pull
remains the safety copy. The deploy workflow now refuses to run `npm ci` with
under 2GB free. Remaining cleanup: delete the Turso org, and the laptop's
`data/quantdesk.db.pre-migration-bak` / `.prev` when comfortable.)*

## Part 2 - Optional on-box snapshot cron (corruption protection, $0)

Keeps 3 rolling daily snapshots on the EC2 disk. Protects against DB-file
corruption; the laptop pull (Part 3) protects against losing the instance.

```bash
# On EC2, as ec2-user:
mkdir -p /home/ec2-user/quantdesk/data/backups
crontab -l 2>/dev/null | { cat; echo '15 3 * * * sqlite3 /home/ec2-user/quantdesk/data/quantdesk.db "VACUUM INTO '"'"'/home/ec2-user/quantdesk/data/backups/quantdesk-$(date +\%u).db.tmp'"'"'" && mv /home/ec2-user/quantdesk/data/backups/quantdesk-$(date +\%u).db.tmp /home/ec2-user/quantdesk/data/backups/quantdesk-$(date +\%u).db'; } | crontab -
```

(`%u` = day of week, so files rotate over the week; ~310MB each - check disk
headroom with `df -h` first, prune to fewer days if tight.)

## Part 3 - Laptop pulls a fresh snapshot (also the offsite backup)

`scripts/pull-prod-db.sh` (`npm run pull-prod-db`): makes a `VACUUM INTO` snapshot
on the box over SSH (safe while the app runs - WAL mode keeps writers unblocked),
scp's it down, verifies integrity + row counts, and swaps it into
`data/quantdesk.db` (previous copy kept at `data/quantdesk.db.prev`). SSH key path
and host default to the known values; override with `EC2_SSH_KEY` / `EC2_HOST` in
`.env` if they change. Run whenever fresh prod data is wanted and at least weekly -
each pull IS the offsite backup.

```bash
npm run pull-prod-db
```

---

Research tool. Not financial advice. All results are hypothetical.
