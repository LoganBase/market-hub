"""
FRED Series Seeder
Backfills daily FRED macro series into Cloudflare D1 `fred_series`.

Series (feed the horizon scores in /api/scores):
  DFII10          — 10-year TIPS real yield (%)          → Macro Anchor
  BAMLH0A0HYM2 — US High-Yield OAS credit spread (%)  → Trend Compass credit
  DFEDTARU        — Federal funds target rate, upper (%)  → Macro Anchor direction

Backfills ~3 years so a 200-day SMA on the OAS series is valid on day one.
Idempotent (INSERT OR REPLACE); the nightly /api/fred-refresh appends new days.

Setup:
  Add FRED_API_KEY to seed/.env  (free key at fred.stlouisfed.org)
  Uses existing CF_ACCOUNT_ID, CF_API_TOKEN, CF_D1_DB_ID from seed/.env

Usage:
  python seed/seed_fred_series.py
"""

import os, sys, time
from datetime import date, timedelta
import requests
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '.env'))

CF_ACCOUNT_ID = os.environ.get('CF_ACCOUNT_ID', '').strip()
CF_API_TOKEN  = os.environ.get('CF_API_TOKEN',  '').strip()
CF_D1_DB_ID   = os.environ.get('CF_D1_DB_ID',   '').strip()
FRED_API_KEY  = os.environ.get('FRED_API_KEY',  '').strip()

FRED_BASE   = 'https://api.stlouisfed.org/fred/series/observations'
D1_MAX_VARS = 90
SERIES      = ['DFII10', 'BAMLH0A0HYM2', 'DFEDTARU']
START_DATE  = (date.today() - timedelta(days=3 * 365 + 30)).isoformat()

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

# ── FRED ──────────────────────────────────────────────────────────────────────

def fred_fetch(series_id):
    """Return [(date_str, float), ...] for all non-missing observations since START_DATE."""
    r = requests.get(FRED_BASE, params={
        'series_id':         series_id,
        'api_key':           FRED_API_KEY,
        'file_type':         'json',
        'sort_order':        'asc',
        'observation_start': START_DATE,
    }, timeout=30)
    r.raise_for_status()
    out = []
    for obs in r.json().get('observations', []):
        if obs['value'] != '.':
            out.append((obs['date'], float(obs['value'])))
    return out

# ── SCHEMA ────────────────────────────────────────────────────────────────────

def init_schema():
    print('Creating fred_series table...')
    d1_exec('''
        CREATE TABLE IF NOT EXISTS fred_series (
            series_id TEXT NOT NULL,
            date      TEXT NOT NULL,
            value     REAL,
            PRIMARY KEY (series_id, date)
        )
    ''')
    d1_exec('CREATE INDEX IF NOT EXISTS idx_fred_series ON fred_series (series_id, date DESC)')
    print('Schema ready.\n')

# ── UPLOAD ────────────────────────────────────────────────────────────────────

def upload(series_id, rows):
    batch_size = max(1, D1_MAX_VARS // 3)   # 3 columns per row
    total, inserted = len(rows), 0
    for i in range(0, total, batch_size):
        batch  = rows[i:i + batch_size]
        ph     = ','.join(['(?,?,?)'] * len(batch))
        sql    = f'INSERT OR REPLACE INTO fred_series (series_id, date, value) VALUES {ph}'
        params = [v for (d, val) in batch for v in (series_id, d, val)]
        d1_exec(sql, params)
        inserted += len(batch)
        print(f'  {series_id}: uploaded {inserted:,}/{total:,}...', end='\r', flush=True)
        time.sleep(0.1)
    print()

# ── MAIN ──────────────────────────────────────────────────────────────────────

def main():
    missing = [k for k, v in {
        'CF_ACCOUNT_ID': CF_ACCOUNT_ID,
        'CF_API_TOKEN':  CF_API_TOKEN,
        'CF_D1_DB_ID':   CF_D1_DB_ID,
        'FRED_API_KEY':  FRED_API_KEY,
    }.items() if not v]
    if missing:
        print(f'ERROR: Missing env vars: {", ".join(missing)}')
        print('Add FRED_API_KEY to seed/.env — free key at fred.stlouisfed.org')
        sys.exit(1)

    print('─' * 55)
    print('  FRED Series Seeder')
    print(f'  Since {START_DATE}')
    print('─' * 55 + '\n')

    init_schema()

    for series_id in SERIES:
        print(f'Fetching {series_id}...')
        rows = fred_fetch(series_id)
        if not rows:
            print(f'  WARNING: no observations for {series_id}, skipping\n')
            continue
        print(f'  {len(rows):,} observations  ({rows[0][0]} → {rows[-1][0]})  latest={rows[-1][1]}')
        upload(series_id, rows)
        print()

    print('  Done.')
    print('─' * 55)

if __name__ == '__main__':
    main()
