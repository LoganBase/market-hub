"""
Buffett Indicator Seeder
Seeds quarterly US Market Cap / GDP ratio into Cloudflare D1.

Source: FRED API (free key required — https://fred.stlouisfed.org/docs/api/api_key.html)
  NCBEILQ027S — Nonfinancial corporate equities (Fed Z.1, billions, quarterly)
  GDP          — US nominal GDP (billions, SAAR, quarterly)

Note: NCBEILQ027S covers nonfinancial sector only. The ratio will run roughly
20-30 percentage points below commonly cited "Buffett Indicator" values which
include financial-sector equities (banks, insurance, etc.). Historical trend
and percentile rank are accurate. Add FRED series BOGZ1LM793064105Q (financial
equities) and sum the two market_cap values for the full picture.

Setup:
  Add FRED_API_KEY=your_key to seed/.env
  Uses existing CF_ACCOUNT_ID, CF_API_TOKEN, CF_D1_DB_ID from seed/.env
"""

import os, sys, time
import requests
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '.env'))

CF_ACCOUNT_ID = os.environ.get('CF_ACCOUNT_ID', '').strip()
CF_API_TOKEN  = os.environ.get('CF_API_TOKEN',  '').strip()
CF_D1_DB_ID   = os.environ.get('CF_D1_DB_ID',   '').strip()
FRED_API_KEY  = os.environ.get('FRED_API_KEY',  '').strip()

FRED_BASE  = 'https://api.stlouisfed.org/fred/series/observations'
D1_MAX_VARS = 95

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
    """Return {date_str: float} for all non-missing observations."""
    r = requests.get(FRED_BASE, params={
        'series_id':         series_id,
        'api_key':           FRED_API_KEY,
        'file_type':         'json',
        'sort_order':        'asc',
        'observation_start': '1950-01-01',
    }, timeout=30)
    r.raise_for_status()
    out = {}
    for obs in r.json().get('observations', []):
        if obs['value'] != '.':
            out[obs['date']] = float(obs['value'])
    return out

# ── SCHEMA ────────────────────────────────────────────────────────────────────

def init_schema():
    print('Creating buffett_data table...')
    d1_exec('''
        CREATE TABLE IF NOT EXISTS buffett_data (
            date       TEXT PRIMARY KEY,   -- YYYY-MM-DD (quarter start)
            market_cap REAL,               -- billions USD (nonfinancial equities, Z.1)
            gdp        REAL,               -- billions USD (SAAR)
            ratio      REAL                -- market_cap / gdp * 100 (%)
        )
    ''')
    d1_exec('CREATE INDEX IF NOT EXISTS idx_buffett_date ON buffett_data (date DESC)')
    print('Schema ready.\n')

# ── UPLOAD ────────────────────────────────────────────────────────────────────

def upload(rows):
    batch_size = max(1, D1_MAX_VARS // 4)
    total, inserted = len(rows), 0
    for i in range(0, total, batch_size):
        batch  = rows[i:i + batch_size]
        ph     = ','.join(['(?,?,?,?)'] * len(batch))
        sql    = f'INSERT OR REPLACE INTO buffett_data (date, market_cap, gdp, ratio) VALUES {ph}'
        params = [v for row in batch for v in row]
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
        'FRED_API_KEY':  FRED_API_KEY,
    }.items() if not v]
    if missing:
        print(f'ERROR: Missing env vars: {", ".join(missing)}')
        print('Add FRED_API_KEY to seed/.env — free key at fred.stlouisfed.org')
        sys.exit(1)

    print('─' * 55)
    print('  Buffett Indicator Seeder')
    print('─' * 55 + '\n')

    init_schema()

    print('Fetching NCBEILQ027S (nonfinancial corporate equities)...')
    mkt = fred_fetch('NCBEILQ027S')
    print(f'  {len(mkt):,} observations  ({min(mkt)} → {max(mkt)})')

    print('Fetching GDP...')
    gdp = fred_fetch('GDP')
    print(f'  {len(gdp):,} observations  ({min(gdp)} → {max(gdp)})\n')

    # Inner join on date — both are quarterly, dates align on quarter-start
    common = sorted(set(mkt) & set(gdp))
    rows   = []
    for date in common:
        m, g = mkt[date], gdp[date]
        if m > 0 and g > 0:
            rows.append((date, round(m / 1000, 2), round(g, 2), round(m / 1000 / g * 100, 2)))

    if not rows:
        print('ERROR: No overlapping quarterly dates found.')
        sys.exit(1)

    print(f'  {len(rows):,} quarterly rows  ({rows[0][0]} → {rows[-1][0]})')
    print(f'  Latest ratio : {rows[-1][3]}%  (nonfinancial equities only)\n')

    upload(rows)

    print(f'\n  Done. {len(rows):,} rows in buffett_data.')
    print('─' * 55)

if __name__ == '__main__':
    main()
