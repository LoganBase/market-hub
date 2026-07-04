"""
S&P 500 EPS Seeder
Backfills S&P 500 trailing-12m EPS into Cloudflare D1 `sp500_eps` from a
TradingView CSV export of MULTPL:SP500_EARNINGS_MONTH (monthly chart).

The nightly TradingView webhook keeps it current after this one-time backfill.
Idempotent (INSERT OR REPLACE); dates are normalised to YYYY-MM-01.

Setup:
  Uses existing CF_ACCOUNT_ID, CF_API_TOKEN, CF_D1_DB_ID from seed/.env

Usage:
  python seed/seed_sp500_eps.py path/to/SP500_EARNINGS_MONTH.csv
  python seed/seed_sp500_eps.py                 # defaults to seed/SP500_EARNINGS_MONTH.csv

CSV format (TradingView "Export chart data"):
  Accepts a header row. Auto-detects the date column ('time' or 'date') and the
  value column ('close' preferred, else the last numeric column). Date may be
  ISO (2026-06-01T00:00:00Z) or a Unix timestamp in seconds.
"""

import os, sys, csv, time
from datetime import datetime, timezone
import requests
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '.env'))

CF_ACCOUNT_ID = os.environ.get('CF_ACCOUNT_ID', '').strip()
CF_API_TOKEN  = os.environ.get('CF_API_TOKEN',  '').strip()
CF_D1_DB_ID   = os.environ.get('CF_D1_DB_ID',   '').strip()

D1_MAX_VARS = 90

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

# ── SCHEMA ────────────────────────────────────────────────────────────────────
def init_schema():
    print('Creating sp500_eps table...')
    d1_exec('''
        CREATE TABLE IF NOT EXISTS sp500_eps (
            date TEXT PRIMARY KEY,
            eps  REAL
        )
    ''')
    d1_exec('CREATE INDEX IF NOT EXISTS idx_sp500_eps_date ON sp500_eps (date DESC)')
    print('Schema ready.\n')

# ── PARSE CSV ─────────────────────────────────────────────────────────────────
def normalise_date(raw):
    """ISO string or Unix seconds -> YYYY-MM-01 (month start)."""
    raw = raw.strip().strip('"')
    # Unix seconds?
    try:
        n = float(raw)
        if n > 10_000:  # not a small number like a price
            return datetime.fromtimestamp(n, tz=timezone.utc).strftime('%Y-%m-01')
    except ValueError:
        pass
    # ISO string
    s = raw.replace('Z', '+00:00')
    try:
        return datetime.fromisoformat(s).strftime('%Y-%m-01')
    except ValueError:
        # Last resort: first 7 chars YYYY-MM
        return raw[:7] + '-01' if len(raw) >= 7 else None

def parse_csv(path):
    with open(path, newline='', encoding='utf-8-sig') as f:
        reader = csv.reader(f)
        header = next(reader)
        cols = [h.strip().lower() for h in header]
        # date column
        date_idx = next((i for i, c in enumerate(cols) if c in ('time', 'date', 'datetime')), 0)
        # value column: prefer 'close', else last column
        if 'close' in cols:
            val_idx = cols.index('close')
        else:
            val_idx = len(cols) - 1
        print(f'  Columns: date="{header[date_idx]}" value="{header[val_idx]}"')

        rows = []
        for r in reader:
            if len(r) <= max(date_idx, val_idx):
                continue
            d = normalise_date(r[date_idx])
            try:
                v = round(float(r[val_idx].strip().strip('"')), 2)
            except ValueError:
                continue
            if d and v > 0:
                rows.append((d, v))
    # De-dup by month (keep last occurrence)
    seen = {}
    for d, v in rows:
        seen[d] = v
    return sorted(seen.items())

# ── UPLOAD ────────────────────────────────────────────────────────────────────
def upload(rows):
    batch_size = max(1, D1_MAX_VARS // 2)   # 2 columns per row
    total, inserted = len(rows), 0
    for i in range(0, total, batch_size):
        batch  = rows[i:i + batch_size]
        ph     = ','.join(['(?,?)'] * len(batch))
        sql    = f'INSERT OR REPLACE INTO sp500_eps (date, eps) VALUES {ph}'
        params = [v for (d, val) in batch for v in (d, val)]
        d1_exec(sql, params)
        inserted += len(batch)
        print(f'  Uploaded {inserted:,}/{total:,}...', end='\r', flush=True)
        time.sleep(0.1)
    print()

# ── MAIN ──────────────────────────────────────────────────────────────────────
def main():
    missing = [k for k, v in {
        'CF_ACCOUNT_ID': CF_ACCOUNT_ID,
        'CF_API_TOKEN':  CF_API_TOKEN,
        'CF_D1_DB_ID':   CF_D1_DB_ID,
    }.items() if not v]
    if missing:
        print(f'ERROR: Missing env vars: {", ".join(missing)}')
        sys.exit(1)

    path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), 'SP500_EARNINGS_MONTH.csv')
    if not os.path.exists(path):
        print(f'ERROR: CSV not found: {path}')
        print('Export MULTPL:SP500_EARNINGS_MONTH (monthly) from TradingView and pass the path.')
        sys.exit(1)

    print('─' * 55)
    print('  S&P 500 EPS Seeder')
    print(f'  Source: {path}')
    print('─' * 55 + '\n')

    init_schema()

    rows = parse_csv(path)
    if not rows:
        print('ERROR: No valid rows parsed from CSV.')
        sys.exit(1)

    print(f'  Parsed {len(rows):,} monthly rows  ({rows[0][0]} → {rows[-1][0]})')
    print(f'  Latest EPS: {rows[-1][1]}\n')

    upload(rows)

    print(f'\n  Done. {len(rows):,} rows in sp500_eps.')
    print('─' * 55)

if __name__ == '__main__':
    main()
