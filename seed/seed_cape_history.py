"""
Market Hub — Shiller CAPE History Seeder
Reads TradingView CSV export for MULTPL:SHILLER_PE_RATIO_MONTH and
upserts only the cape column into the shiller_data D1 table.

Existing price / earnings / dividend rows are preserved via ON CONFLICT.

File expected (TradingView 1D export format):
  time,open,high,low,close
  <unix_timestamp_seconds>,<o>,<h>,<l>,<cape_value>

Usage:
  python seed/seed_cape_history.py

Note: uses timedelta arithmetic for negative timestamps (pre-1970 data).
"""

import os, time
import pandas as pd
import requests
from datetime import datetime, timedelta, timezone
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '.env'))

CF_ACCOUNT_ID = os.environ.get('CF_ACCOUNT_ID', '').strip()
CF_API_TOKEN  = os.environ.get('CF_API_TOKEN',  '').strip()
CF_D1_DB_ID   = os.environ.get('CF_D1_DB_ID',   '').strip()

CAPE_CSV = r'C:\Users\shane\Downloads\MULTPL_SHILLER_PE_RATIO_MONTH, 1D.csv'

D1_QUERY_URL = (f'https://api.cloudflare.com/client/v4/accounts/'
                f'{CF_ACCOUNT_ID}/d1/database/{CF_D1_DB_ID}/query')
D1_HDR = {'Authorization': f'Bearer {CF_API_TOKEN}', 'Content-Type': 'application/json'}

EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)
BATCH = 47  # 2 cols × 47 rows = 94 params — under D1's 95-param limit


def ts_to_month(ts):
    """Convert Unix timestamp (seconds, may be negative) to YYYY-MM-01 string."""
    dt = EPOCH + timedelta(seconds=int(ts))
    return f'{dt.year:04d}-{dt.month:02d}-01'


def d1_insert_many(rows):
    """Single multi-value INSERT — upserts only the cape column."""
    placeholders = ','.join(['(?,?)'] * len(rows))
    sql = f'''
        INSERT INTO shiller_data (date, cape)
        VALUES {placeholders}
        ON CONFLICT(date) DO UPDATE SET cape = excluded.cape
    '''
    params = [v for row in rows for v in row]
    res  = requests.post(D1_QUERY_URL, headers=D1_HDR,
                         json={'sql': sql, 'params': params}, timeout=30)
    data = res.json()
    if not data.get('success'):
        raise RuntimeError(f'D1 error: {data.get("errors", data)}')
    return data


def load_csv():
    df = pd.read_csv(CAPE_CSV)
    df['date']  = df['time'].apply(ts_to_month)
    df['cape']  = pd.to_numeric(df['close'], errors='coerce')
    df = df[['date', 'cape']].dropna()
    df = df.drop_duplicates(subset='date', keep='last')
    df = df.sort_values('date')
    print(f'  Loaded {len(df)} rows  ({df["date"].iloc[0]} → {df["date"].iloc[-1]})')
    print(f'  CAPE range: {df["cape"].min():.2f} – {df["cape"].max():.2f}')
    return df


def upload(df):
    rows  = list(df.itertuples(index=False, name=None))
    total = 0
    for i in range(0, len(rows), BATCH):
        chunk = rows[i:i + BATCH]
        params = [(row[0], round(float(row[1]), 4)) for row in chunk]
        d1_insert_many(params)
        total += len(chunk)
        print(f'    Uploaded {total}/{len(rows)}')
        time.sleep(0.2)
    return total


def main():
    for key in ('CF_ACCOUNT_ID', 'CF_API_TOKEN', 'CF_D1_DB_ID'):
        if not os.environ.get(key):
            raise SystemExit(f'ERROR: {key} not set in seed/.env')

    print('── CAPE History Seeder ───────────────────────────────')
    print('\n[1] Loading CSV...')
    df = load_csv()

    print('\n[2] Uploading to D1...')
    total = upload(df)

    print(f'\n✓ Done — {total} rows upserted into shiller_data (cape column only).')
    print('─' * 55)


if __name__ == '__main__':
    main()
