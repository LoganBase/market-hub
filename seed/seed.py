"""
Market Hub — Historical Data Seeder
Direct upload to Cloudflare D1 via REST API. No intermediate SQL file.

Modes:
  python seed.py           — full historical seed (20 years, specify SYMBOLS below)
  python seed.py --daily   — incremental daily update (all D1 symbols, last ~18 months,
                             uploads only the 5 most recent indicator rows per symbol
                             to avoid overwriting historical data with None-filled rows)

Setup:
  1. Create a seed/.env file (copy seed/.env.example and fill in values)
  2. pip install -r requirements.txt
  3. python seed.py

GitHub Actions runs seed.py --daily on a Mon–Fri schedule after market close.
Secrets required: CF_ACCOUNT_ID, CF_API_TOKEN, CF_D1_DB_ID
"""

import argparse
import os, sys, time
import pandas as pd
import requests
import yfinance as yf
from datetime import datetime, timedelta
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '.env'))

# ── CLI FLAGS ─────────────────────────────────────────────────────────────────
_parser = argparse.ArgumentParser(add_help=False)
_parser.add_argument('--daily', action='store_true')
_args, _ = _parser.parse_known_args()
DAILY_MODE = _args.daily

# ── CONFIG ────────────────────────────────────────────────────────────────────
# Daily mode: 540 calendar days (~385 trading days) — enough history to compute
# SMA200 (needs 200 trading days) with buffer. Only last 5 indicator rows are
# uploaded to avoid overwriting good historical data with None-valued early rows.
SEED_YEARS        = 20
DAILY_LOOKBACK    = 540   # calendar days downloaded in daily mode
DAILY_IND_ROWS    = 5     # indicator rows uploaded per symbol in daily mode

END = datetime.now().strftime('%Y-%m-%d')
START = (
    (datetime.now() - timedelta(days=DAILY_LOOKBACK)).strftime('%Y-%m-%d')
    if DAILY_MODE
    else (datetime.now() - timedelta(days=365 * SEED_YEARS)).strftime('%Y-%m-%d')
)

D1_MAX_VARS = 95   # D1 hard limit is 100 bound parameters per query

CF_ACCOUNT_ID = os.environ.get('CF_ACCOUNT_ID', '').strip()
CF_API_TOKEN  = os.environ.get('CF_API_TOKEN',  '').strip()
CF_D1_DB_ID   = os.environ.get('CF_D1_DB_ID',   '').strip()

# All symbols read from D1 by the scores API
DAILY_SYMBOLS = ['SPY', 'RSP', 'QQQ', 'QQEW', 'USCI', 'HYG', 'LQD', 'EMB', 'UUP', 'FXE', 'FXY']

SYMBOLS = DAILY_SYMBOLS if DAILY_MODE else [
    'UUP', 'FXE', 'FXY',  # set this list for manual full historical seeds
]

# ── D1 REST API ───────────────────────────────────────────────────────────────
def d1_url():
    return (
        f'https://api.cloudflare.com/client/v4/accounts/'
        f'{CF_ACCOUNT_ID}/d1/database/{CF_D1_DB_ID}/query'
    )

def d1_headers():
    return {
        'Authorization': f'Bearer {CF_API_TOKEN}',
        'Content-Type':  'application/json',
    }

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
            wait = 2 ** attempt   # 1s, 2s, 4s, 8s
            print(f'\n      connection error, retrying in {wait}s... ({e})')
            time.sleep(wait)

def d1_insert_many(table, columns, rows):
    """
    Insert many rows in one API call using a multi-value INSERT.
    Builds: INSERT OR REPLACE INTO table (cols) VALUES (?,?,...),(?,?,...)
    """
    ncols        = len(columns)
    placeholders = ','.join(['(' + ','.join(['?'] * ncols) + ')'] * len(rows))
    sql          = f'INSERT OR REPLACE INTO {table} ({",".join(columns)}) VALUES {placeholders}'
    params       = [v for row in rows for v in row]
    return d1_exec(sql, params)

# ── SCHEMA ────────────────────────────────────────────────────────────────────
def init_schema():
    print('Creating schema on D1...')
    for sql in [
        '''CREATE TABLE IF NOT EXISTS daily_prices (
            symbol TEXT NOT NULL, date TEXT NOT NULL,
            open REAL, high REAL, low REAL, close REAL, volume INTEGER,
            PRIMARY KEY (symbol, date)
        )''',
        '''CREATE TABLE IF NOT EXISTS indicators (
            symbol TEXT NOT NULL, date TEXT NOT NULL,
            sma50 REAL, sma200 REAL, rsi14 REAL, roc10 REAL,
            vs200_pct REAL, percentile REAL,
            PRIMARY KEY (symbol, date)
        )''',
        'CREATE INDEX IF NOT EXISTS idx_prices_sym_date ON daily_prices (symbol, date DESC)',
        'CREATE INDEX IF NOT EXISTS idx_ind_sym_date    ON indicators   (symbol, date DESC)',
    ]:
        d1_exec(sql)
    print('Schema ready.\n')

# ── INDICATORS ────────────────────────────────────────────────────────────────
def calc_rsi(closes, period=14):
    n      = len(closes)
    result = [None] * n
    if n < period + 1:
        return result
    gains  = [max(closes[i] - closes[i-1], 0) for i in range(1, n)]
    losses = [max(closes[i-1] - closes[i], 0) for i in range(1, n)]
    ag = sum(gains[:period])  / period
    al = sum(losses[:period]) / period
    result[period] = 100 - 100 / (1 + (ag / al if al else float('inf')))
    for i in range(period + 1, n):
        ag = (ag * (period - 1) + gains[i-1])  / period
        al = (al * (period - 1) + losses[i-1]) / period
        result[i] = 100 - 100 / (1 + (ag / al if al else float('inf')))
    return result

def compute_indicators(symbol, dates, closes):
    n          = len(closes)
    rsi_series = calc_rsi(closes)

    vs200_all = []
    for i in range(n):
        if i >= 199:
            s200 = sum(closes[i-199:i+1]) / 200
            vs200_all.append(((closes[i] - s200) / s200) * 100)
        else:
            vs200_all.append(None)

    rows = []
    for i in range(14, n):
        price  = closes[i]
        sma50  = sum(closes[max(0, i-49):i+1]) / min(i+1, 50) if i >= 49  else None
        sma200 = sum(closes[i-199:i+1]) / 200                  if i >= 199 else None
        vs200  = ((price - sma200) / sma200 * 100)             if sma200   else None
        rsi14  = rsi_series[i]
        roc10  = ((price / closes[i-10]) - 1) * 100            if i >= 10  else None
        pct    = None
        if vs200 is not None:
            valid = [v for v in vs200_all[:i+1] if v is not None]
            pct   = sum(1 for v in valid if v <= vs200) / len(valid) * 100 if valid else None
        rows.append((symbol, dates[i], sma50, sma200, rsi14, roc10, vs200, pct))
    return rows

# ── UPLOAD HELPERS ────────────────────────────────────────────────────────────
PRICE_COLS = ['symbol','date','open','high','low','close','volume']
IND_COLS   = ['symbol','date','sma50','sma200','rsi14','roc10','vs200_pct','percentile']

def upload_in_batches(table, columns, all_rows, label):
    batch_size = max(1, D1_MAX_VARS // len(columns))  # auto-size to stay under variable limit
    total      = len(all_rows)
    uploaded   = 0
    for i in range(0, total, batch_size):
        chunk = all_rows[i:i + batch_size]
        d1_insert_many(table, columns, chunk)
        uploaded += len(chunk)
        print(f'      {label}: {uploaded:,}/{total:,}', end='\r', flush=True)
        time.sleep(0.15)
    print()

# ── PER-SYMBOL SEED ───────────────────────────────────────────────────────────
def seed_symbol(symbol):
    print(f'  {symbol}', end=' ... ', flush=True)
    try:
        df = yf.download(symbol, start=START, end=END, auto_adjust=True, progress=False)
        if df.empty:
            print('no data')
            return 0

        # Flatten MultiIndex columns (newer yfinance returns ticker as second level)
        if isinstance(df.columns, pd.MultiIndex):
            df.columns = df.columns.get_level_values(0)

        dates  = [d.strftime('%Y-%m-%d') for d in df.index]
        opens  = [float(v) if pd.notna(v) else None for v in df['Open']]
        highs  = [float(v) if pd.notna(v) else None for v in df['High']]
        lows   = [float(v) if pd.notna(v) else None for v in df['Low']]
        closes = [float(v) if pd.notna(v) else None for v in df['Close']]
        vols   = [int(v)   if pd.notna(v) else None for v in df['Volume']]

        price_rows = list(zip([symbol]*len(dates), dates, opens, highs, lows, closes, vols))
        print(f'{len(price_rows):,} rows')

        upload_in_batches('daily_prices', PRICE_COLS, price_rows, 'prices')

        clean_pairs = [(d, c) for d, c in zip(dates, closes) if c is not None]
        if len(clean_pairs) >= 15:
            c_dates  = [p[0] for p in clean_pairs]
            c_closes = [p[1] for p in clean_pairs]
            ind_rows = compute_indicators(symbol, c_dates, c_closes)
            # Daily mode: only upload the most recent rows to avoid overwriting
            # good historical data with None-filled rows from the short window
            if DAILY_MODE:
                ind_rows = ind_rows[-DAILY_IND_ROWS:]
            upload_in_batches('indicators', IND_COLS, ind_rows, 'indicators')

        return len(price_rows)

    except Exception as e:
        print(f'ERROR: {e}')
        return 0

# ── MAIN ──────────────────────────────────────────────────────────────────────
def main():
    missing = [k for k, v in {
        'CF_ACCOUNT_ID': CF_ACCOUNT_ID,
        'CF_API_TOKEN':  CF_API_TOKEN,
        'CF_D1_DB_ID':   CF_D1_DB_ID,
    }.items() if not v]
    if missing:
        print(f'ERROR: Missing environment variables: {", ".join(missing)}')
        print('Create seed/.env — see seed/.env.example')
        sys.exit(1)

    mode_label = f'Daily ({DAILY_IND_ROWS} indicator rows/symbol)' if DAILY_MODE else 'Full historical'
    print('-' * 60)
    print(f'  Market Hub Seeder — Direct D1 Upload')
    print(f'  Mode   : {mode_label}')
    print(f'  Period : {START}  ->  {END}')
    print(f'  Symbols: {len(SYMBOLS)}  ({", ".join(SYMBOLS)})')
    print(f'  Batch  : auto (~{D1_MAX_VARS} vars/call)')
    print('-' * 60 + '\n')

    init_schema()

    total = 0
    for i, sym in enumerate(SYMBOLS, 1):
        print(f'[{i:02d}/{len(SYMBOLS)}] ', end='')
        total += seed_symbol(sym)

    print(f'\n{"-" * 60}')
    print(f'  Done. {total:,} price rows uploaded to D1.')
    print('-' * 60)

if __name__ == '__main__':
    main()
