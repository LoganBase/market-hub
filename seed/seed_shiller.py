"""
Shiller CAPE Seeder
Uploads S&P 500 monthly valuation data to Cloudflare D1.

Sources (in priority order):
  1. Local file path passed as argument:  python seed_shiller.py path/to/ie_data.xls
  2. Yale URL (may be stale):             python seed_shiller.py

Run once for initial seed (~1,800+ monthly rows from 1871).
Re-run when a newer file is available — INSERT OR REPLACE is idempotent.

For current data: download from https://shillerdata.com and pass the local path.

Setup:
  pip install xlrd   (for reading .xls files)
  Uses existing seed/.env credentials (CF_ACCOUNT_ID, CF_API_TOKEN, CF_D1_DB_ID)

File format:
  Sheet: Data, Header row: 8 (skiprows=7)
  Date format: YYYY.MM  (e.g. 1871.01 = January 1871, 2024.10 = October 2024)
  Columns: Date, P (price), D (dividend), E (earnings), CPI, ..., CAPE
"""

import os, sys, time, math
import pandas as pd
import requests
from io import BytesIO
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '.env'))

# Yale may not support HTTPS on this path — prefer passing a local file or using shillerdata.com
SHILLER_URL   = 'https://www.econ.yale.edu/~shiller/data/ie_data.xls'
CF_ACCOUNT_ID = os.environ.get('CF_ACCOUNT_ID', '').strip()
CF_API_TOKEN  = os.environ.get('CF_API_TOKEN',  '').strip()
CF_D1_DB_ID   = os.environ.get('CF_D1_DB_ID',   '').strip()
D1_MAX_VARS   = 95

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
    print('Creating shiller_data table...')
    d1_exec('''
        CREATE TABLE IF NOT EXISTS shiller_data (
            date     TEXT PRIMARY KEY,
            price    REAL,
            earnings REAL,
            dividend REAL,
            cape     REAL,
            cpi      REAL
        )
    ''')
    # Migration for tables created before the cpi column existed (activates
    # real forward-return bands in /api/scores once re-seeded).
    try:
        d1_exec('ALTER TABLE shiller_data ADD COLUMN cpi REAL')
    except Exception:
        pass  # column already exists
    d1_exec('CREATE INDEX IF NOT EXISTS idx_shiller_date ON shiller_data (date DESC)')
    print('Schema ready.\n')

# ── DATE PARSING ──────────────────────────────────────────────────────────────
def parse_shiller_date(date_val):
    """Convert Shiller YYYY.MM format to YYYY-MM-01 ISO string."""
    try:
        s     = f'{float(date_val):.2f}'   # e.g. '1871.01', '2024.10'
        parts = s.split('.')
        year  = int(parts[0])
        month = int(parts[1])              # '01' → 1, '10' → 10
        if year < 1800 or year > 2200 or month < 1 or month > 12:
            return None
        return f'{year:04d}-{month:02d}-01'
    except Exception:
        return None

# ── FETCH & PARSE ─────────────────────────────────────────────────────────────
def fetch_shiller(local_path=None):
    if local_path:
        print(f'Reading local file: {local_path}')
        df = pd.read_excel(local_path, sheet_name='Data', header=7, engine='xlrd')
    else:
        print(f'Downloading from Yale: {SHILLER_URL}')
        r = requests.get(SHILLER_URL, timeout=60)
        r.raise_for_status()
        print(f'  Downloaded {len(r.content) / 1024:.0f} KB')
        df = pd.read_excel(BytesIO(r.content), sheet_name='Data', header=7, engine='xlrd')

    # Locate CAPE column — try by name first, fall back to position 12
    cape_col_idx = 12
    for i, col in enumerate(df.columns):
        if 'cape' in str(col).lower():
            cape_col_idx = i
            break

    def safe_float(val):
        try:
            v = float(val)
            return None if math.isnan(v) else round(v, 4)
        except Exception:
            return None

    rows = []
    for _, row in df.iterrows():
        date_raw = row.iloc[0]
        if pd.isna(date_raw) or not isinstance(date_raw, (int, float)):
            continue

        date_iso = parse_shiller_date(date_raw)
        if not date_iso:
            continue

        price    = safe_float(row.iloc[1])   # P  — S&P 500 composite price
        dividend = safe_float(row.iloc[2])   # D  — trailing 12m dividends
        earnings = safe_float(row.iloc[3])   # E  — trailing 12m earnings
        cpi      = safe_float(row.iloc[4])   # CPI — for real-return deflation
        cape     = safe_float(row.iloc[cape_col_idx])

        if price is None:
            continue

        rows.append((date_iso, price, earnings, dividend, cape, cpi))

    return rows

# ── UPLOAD ────────────────────────────────────────────────────────────────────
def upload(rows):
    cols       = ['date', 'price', 'earnings', 'dividend', 'cape', 'cpi']
    batch_size = max(1, D1_MAX_VARS // len(cols))   # ~19 rows per API call
    total      = len(rows)
    inserted   = 0

    for i in range(0, total, batch_size):
        batch  = rows[i:i + batch_size]
        ph     = ','.join(['(' + ','.join(['?'] * len(cols)) + ')'] * len(batch))
        sql    = f'INSERT OR REPLACE INTO shiller_data ({",".join(cols)}) VALUES {ph}'
        params = [v for row in batch for v in row]
        d1_exec(sql, params)
        inserted += len(batch)
        print(f'  Uploaded {inserted:,}/{total:,}...', end='\r', flush=True)
        time.sleep(0.15)

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
        print('Ensure seed/.env is populated — see seed/.env.example')
        sys.exit(1)

    print('─' * 55)
    print('  Shiller CAPE Seeder — D1 Upload')
    print('─' * 55 + '\n')

    init_schema()

    local_path = sys.argv[1] if len(sys.argv) > 1 else None
    rows = fetch_shiller(local_path)
    if not rows:
        print('ERROR: No rows parsed from Shiller data.')
        sys.exit(1)

    print(f'  Parsed {len(rows):,} monthly rows')
    print(f'  Range : {rows[0][0]}  →  {rows[-1][0]}')
    latest_cape = next((r[4] for r in reversed(rows) if r[4]), None)
    print(f'  Latest CAPE: {latest_cape}\n')

    upload(rows)

    print(f'\n  Done. {len(rows):,} rows in shiller_data.')
    print('─' * 55)

if __name__ == '__main__':
    main()
