"""
ADID Seeder
Backfills daily advance-decline difference into Cloudflare D1 market_breadth
from a TradingView CSV export of INDEX:ADDN (NYSE) or INDEX:ADDQ (Nasdaq).

The nightly TradingView webhook keeps it current after this one-time backfill.
Idempotent (upsert by date); values are signed daily net advancers − decliners.

Setup:
  Uses existing CF_ACCOUNT_ID, CF_API_TOKEN, CF_D1_DB_ID from seed/.env

Usage:
  python seed/seed_adid.py path/to/ADDN.csv --col adid_nyse
  python seed/seed_adid.py path/to/ADDQ.csv --col adid_nasdaq

CSV format (TradingView "Export chart data", Daily):
  Header row; auto-detects the date column ('time'/'date') and the value column
  ('close' preferred, else last numeric). Date may be ISO or Unix seconds.
"""

import os, sys, csv, time, argparse
from datetime import datetime, timezone
import requests
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '.env'))

CF_ACCOUNT_ID = os.environ.get('CF_ACCOUNT_ID', '').strip()
CF_API_TOKEN  = os.environ.get('CF_API_TOKEN',  '').strip()
CF_D1_DB_ID   = os.environ.get('CF_D1_DB_ID',   '').strip()

D1_MAX_VARS   = 90
ALLOWED_COLS  = ('adid_nyse', 'adid_nasdaq')

# ── D1 REST API ───────────────────────────────────────────────────────────────
def d1_url():
    return (f'https://api.cloudflare.com/client/v4/accounts/'
            f'{CF_ACCOUNT_ID}/d1/database/{CF_D1_DB_ID}/query')

def d1_headers():
    return {'Authorization': f'Bearer {CF_API_TOKEN}', 'Content-Type': 'application/json'}

def d1_exec(sql, params=None, retries=4):
    body = {'sql': sql}
    if params:
        body['params'] = params
    for attempt in range(retries):
        try:
            res  = requests.post(d1_url(), headers=d1_headers(), json=body, timeout=30)
            data = res.json()
            if not data.get('success'):
                raise RuntimeError(f"D1 error: {data.get('errors', data)}")
            return data
        except (requests.ConnectionError, requests.Timeout) as e:
            if attempt == retries - 1:
                raise
            wait = 2 ** attempt
            print(f'\n  connection error, retrying in {wait}s... ({e})')
            time.sleep(wait)

# ── PARSE CSV ─────────────────────────────────────────────────────────────────
def normalise_date(raw):
    """ISO string or Unix seconds -> YYYY-MM-DD (daily)."""
    raw = raw.strip().strip('"')
    try:
        n = float(raw)
        if n > 10_000:
            return datetime.fromtimestamp(n, tz=timezone.utc).strftime('%Y-%m-%d')
    except ValueError:
        pass
    s = raw.replace('Z', '+00:00')
    try:
        return datetime.fromisoformat(s).strftime('%Y-%m-%d')
    except ValueError:
        return raw[:10] if len(raw) >= 10 else None

def parse_csv(path):
    with open(path, newline='', encoding='utf-8-sig') as f:
        reader = csv.reader(f)
        header = next(reader)
        cols = [h.strip().lower() for h in header]
        date_idx = next((i for i, c in enumerate(cols) if c in ('time', 'date', 'datetime')), 0)
        val_idx  = cols.index('close') if 'close' in cols else len(cols) - 1
        print(f'  Columns: date="{header[date_idx]}" value="{header[val_idx]}"')
        rows = []
        for r in reader:
            if len(r) <= max(date_idx, val_idx):
                continue
            d = normalise_date(r[date_idx])
            try:
                v = round(float(r[val_idx].strip().strip('"')))   # ADID is an integer count (signed)
            except ValueError:
                continue
            if d and abs(v) <= 20000:
                rows.append((d, v))
    seen = {}
    for d, v in rows:
        seen[d] = v   # keep last per day
    return sorted(seen.items())

# ── UPLOAD ────────────────────────────────────────────────────────────────────
def upload(rows, col):
    batch_size = max(1, D1_MAX_VARS // 2)
    total, inserted = len(rows), 0
    for i in range(0, total, batch_size):
        batch  = rows[i:i + batch_size]
        # Upsert only this ADID column, preserving any existing breadth values for the date.
        ph     = ','.join(['(?,?)'] * len(batch))
        sql    = (f'INSERT INTO market_breadth (date, {col}) VALUES {ph} '
                  f'ON CONFLICT(date) DO UPDATE SET {col} = excluded.{col}')
        params = [v for (d, val) in batch for v in (d, val)]
        d1_exec(sql, params)
        inserted += len(batch)
        print(f'  Uploaded {inserted:,}/{total:,}...', end='\r', flush=True)
        time.sleep(0.1)
    print()

# ── MAIN ──────────────────────────────────────────────────────────────────────
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('csv', help='Path to the TradingView ADDN/ADDQ CSV export')
    ap.add_argument('--col', required=True, choices=ALLOWED_COLS, help='Target column')
    args = ap.parse_args()

    missing = [k for k, v in {
        'CF_ACCOUNT_ID': CF_ACCOUNT_ID, 'CF_API_TOKEN': CF_API_TOKEN, 'CF_D1_DB_ID': CF_D1_DB_ID,
    }.items() if not v]
    if missing:
        print(f'ERROR: Missing env vars: {", ".join(missing)}')
        sys.exit(1)
    if not os.path.exists(args.csv):
        print(f'ERROR: CSV not found: {args.csv}')
        sys.exit(1)

    print('-' * 55)
    print(f'  ADID Seeder -> market_breadth.{args.col}')
    print(f'  Source: {args.csv}')
    print('-' * 55 + '\n')

    rows = parse_csv(args.csv)
    if not rows:
        print('ERROR: No valid rows parsed from CSV.')
        sys.exit(1)

    print(f'  Parsed {len(rows):,} daily rows  ({rows[0][0]} -> {rows[-1][0]})')
    print(f'  Latest value: {rows[-1][1]}\n')

    upload(rows, args.col)

    print(f'\n  Done. {len(rows):,} rows upserted into market_breadth.{args.col}.')
    print('-' * 55)

if __name__ == '__main__':
    main()
