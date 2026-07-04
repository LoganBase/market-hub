"""
Japan / Nikkei 225 P/E Seeder
Seeds historical Nikkei 225 TTM P/E ratio into Cloudflare D1.

Source: Macrotrends CSV download
  URL: https://www.macrotrends.net  → search "Nikkei 225 PE Ratio"
  Click "Download Historical Data" under the chart.

Usage:
  python seed_japan_pe.py <path-to-csv>

  e.g. python seed_japan_pe.py nikkei-225-pe-ratio.csv
"""

import os, sys, time, csv, re
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '.env'))

CF_ACCOUNT_ID = os.environ.get('CF_ACCOUNT_ID', '').strip()
CF_API_TOKEN  = os.environ.get('CF_API_TOKEN',  '').strip()
CF_D1_DB_ID   = os.environ.get('CF_D1_DB_ID',   '').strip()

D1_MAX_VARS = 95

# ── D1 REST API ───────────────────────────────────────────────────────────────

def d1_url():
    return (f'https://api.cloudflare.com/client/v4/accounts/'
            f'{CF_ACCOUNT_ID}/d1/database/{CF_D1_DB_ID}/query')

def d1_headers():
    return {'Authorization': f'Bearer {CF_API_TOKEN}', 'Content-Type': 'application/json'}

def d1_exec(sql, params=None, retries=4):
    import requests
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
        except Exception as e:
            if attempt == retries - 1:
                raise
            wait = 2 ** attempt
            print(f'\n  retrying in {wait}s... ({e})')
            time.sleep(wait)

# ── SCHEMA ────────────────────────────────────────────────────────────────────

def init_schema():
    print('Creating japan_pe_data table...')
    d1_exec('''
        CREATE TABLE IF NOT EXISTS japan_pe_data (
            date TEXT PRIMARY KEY,
            pe   REAL
        )
    ''')
    d1_exec('CREATE INDEX IF NOT EXISTS idx_japan_pe_date ON japan_pe_data (date DESC)')
    print('Schema ready.\n')

# ── CSV PARSE ─────────────────────────────────────────────────────────────────

def parse_macrotrends_csv(path):
    """
    Macrotrends CSV format (typical):
      Line 1-2: empty or comment rows
      Header:   date, value  (column name varies)
      Data:     2000-01-01, 25.39
    """
    rows = []

    with open(path, newline='', encoding='utf-8-sig') as f:
        lines = f.readlines()

    data_lines = []
    for line in lines:
        stripped = line.strip()
        if not stripped or stripped.startswith('<!') or stripped.startswith('<'):
            continue
        data_lines.append(line)

    reader = csv.DictReader(data_lines)
    headers = reader.fieldnames or []
    print(f'  CSV columns: {headers}')

    date_col = pe_col = None
    for h in headers:
        hl = h.lower()
        if 'date' in hl:
            date_col = h
        elif any(k in hl for k in ['pe', 'p/e', 'ratio', 'value', 'price']):
            pe_col = h

    if not date_col or not pe_col:
        print(f'  WARNING: Could not auto-detect columns. Found: {headers}')
        sys.exit(1)

    print(f'  Using date="{date_col}", pe="{pe_col}"')

    for row in reader:
        date_raw = row.get(date_col, '').strip()
        pe_raw   = row.get(pe_col, '').strip()
        if not date_raw or not pe_raw:
            continue
        # Handle both YYYY-MM-DD and MM/DD/YYYY
        m = re.match(r'(\d{4}-\d{2}-\d{2})', date_raw)
        if m:
            date = m.group(1)
        else:
            m2 = re.match(r'(\d{1,2})/(\d{1,2})/(\d{4})', date_raw)
            if not m2:
                continue
            date = f'{m2.group(3)}-{m2.group(1).zfill(2)}-{m2.group(2).zfill(2)}'
        try:
            pe = float(pe_raw.replace(',', ''))
        except ValueError:
            continue
        if pe <= 0 or pe > 500:   # Nikkei P/E spiked very high in 1987 bubble
            continue
        rows.append((date, round(pe, 2)))

    rows.sort(key=lambda r: r[0])
    return rows

# ── UPLOAD ────────────────────────────────────────────────────────────────────

def upload(rows):
    batch_size = max(1, D1_MAX_VARS // 2)
    total, inserted = len(rows), 0
    for i in range(0, total, batch_size):
        batch  = rows[i:i + batch_size]
        ph     = ','.join(['(?,?)'] * len(batch))
        sql    = f'INSERT OR REPLACE INTO japan_pe_data (date, pe) VALUES {ph}'
        params = [v for row in batch for v in row]
        d1_exec(sql, params)
        inserted += len(batch)
        print(f'  Uploaded {inserted:,}/{total:,}...', end='\r', flush=True)
        time.sleep(0.1)
    print()

# ── MAIN ──────────────────────────────────────────────────────────────────────

def main():
    if len(sys.argv) < 2:
        print('Usage: python seed_japan_pe.py <path-to-csv>')
        sys.exit(1)

    missing = [k for k, v in {
        'CF_ACCOUNT_ID': CF_ACCOUNT_ID,
        'CF_API_TOKEN':  CF_API_TOKEN,
        'CF_D1_DB_ID':   CF_D1_DB_ID,
    }.items() if not v]
    if missing:
        print(f'ERROR: Missing env vars: {", ".join(missing)}')
        sys.exit(1)

    csv_path = sys.argv[1]
    if not os.path.exists(csv_path):
        print(f'ERROR: File not found: {csv_path}')
        sys.exit(1)

    print('─' * 55)
    print('  Japan / Nikkei 225 P/E Seeder')
    print('─' * 55 + '\n')

    init_schema()

    print(f'Parsing {csv_path}...')
    rows = parse_macrotrends_csv(csv_path)
    if not rows:
        print('ERROR: No valid rows parsed. Check CSV format.')
        sys.exit(1)

    print(f'  {len(rows):,} rows  ({rows[0][0]} → {rows[-1][0]})')
    print(f'  Latest P/E: {rows[-1][1]}×\n')

    print('  Sample rows:')
    for r in rows[:3]:
        print(f'    {r[0]}  {r[1]}×')
    print()

    upload(rows)
    print(f'\n  Done. {len(rows):,} rows in japan_pe_data.')
    print('─' * 55)

if __name__ == '__main__':
    main()
