"""
Market Hub — Breadth History Seeder
Parses TradingView CSV exports for MMTH and MMFI and uploads to D1 market_breadth table.

Files expected (TradingView 1D export format):
  time,open,high,low,close
  <unix_timestamp_seconds>,<o>,<h>,<l>,<close_value>

Usage:
  python seed/seed_breadth_history.py --mmth /path/to/INDEX_MMTH.csv --mmfi /path/to/INDEX_MMFI.csv
  python seed/seed_breadth_history.py  # uses MMTH_CSV / MMFI_CSV env vars
"""

import os, sys, time, argparse
import pandas as pd
import requests
from datetime import datetime, timezone
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '.env'))

CF_ACCOUNT_ID = os.environ.get('CF_ACCOUNT_ID', '').strip()
CF_API_TOKEN  = os.environ.get('CF_API_TOKEN',  '').strip()
CF_D1_DB_ID   = os.environ.get('CF_D1_DB_ID',   '').strip()

def _resolve_csv_paths():
    parser = argparse.ArgumentParser(description='Seed market breadth history from TradingView CSV exports')
    parser.add_argument('--mmth', default=os.environ.get('MMTH_CSV', ''), help='Path to INDEX_MMTH 1D CSV')
    parser.add_argument('--mmfi', default=os.environ.get('MMFI_CSV', ''), help='Path to INDEX_MMFI 1D CSV')
    args = parser.parse_args()
    if not args.mmth or not args.mmfi:
        print('ERROR: Provide --mmth and --mmfi paths, or set MMTH_CSV / MMFI_CSV env vars.')
        sys.exit(1)
    return args.mmth, args.mmfi

D1_QUERY_URL = f'https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT_ID}/d1/database/{CF_D1_DB_ID}/query'
D1_BATCH_URL = f'https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT_ID}/d1/database/{CF_D1_DB_ID}/batch'
D1_HDR       = {'Authorization': f'Bearer {CF_API_TOKEN}', 'Content-Type': 'application/json'}


def d1_insert_many(rows):
    """Single multi-value INSERT — matches seed.py pattern. Max 31 rows (95 params / 3 cols)."""
    placeholders = ','.join(['(?,?,?)'] * len(rows))
    sql    = f'''
        INSERT INTO market_breadth (date, pct_above_200d, pct_above_50d)
        VALUES {placeholders}
        ON CONFLICT(date) DO UPDATE SET
            pct_above_200d = COALESCE(excluded.pct_above_200d, market_breadth.pct_above_200d),
            pct_above_50d  = COALESCE(excluded.pct_above_50d,  market_breadth.pct_above_50d)
    '''
    params = [v for row in rows for v in row]
    res    = requests.post(D1_QUERY_URL, headers=D1_HDR,
                           json={'sql': sql, 'params': params}, timeout=30)
    data   = res.json()
    if not data.get('success'):
        raise RuntimeError(f'D1 error: {data.get("errors", data)}')
    return data


def load_csv(path, label):
    df = pd.read_csv(path)
    df['date'] = df['time'].apply(
        lambda ts: datetime.fromtimestamp(ts, tz=timezone.utc).strftime('%Y-%m-%d')
    )
    df = df[['date', 'close']].dropna()
    df = df.drop_duplicates(subset='date', keep='last')
    df = df.sort_values('date')
    print(f'  {label}: {len(df)} rows ({df["date"].iloc[0]} → {df["date"].iloc[-1]})')
    return df


def upload(df_mmth, df_mmfi):
    # Merge on date — outer join so we get all dates from both series
    merged = pd.merge(df_mmth.rename(columns={'close': 'pct_above_200d'}),
                      df_mmfi.rename(columns={'close': 'pct_above_50d'}),
                      on='date', how='outer').sort_values('date')

    print(f'\n  Merged: {len(merged)} rows')

    BATCH = 31  # 3 columns × 31 rows = 93 params — under D1's 95-param limit
    rows  = list(merged.itertuples(index=False))
    total = 0

    for i in range(0, len(rows), BATCH):
        chunk = rows[i:i + BATCH]
        params = []
        for row in chunk:
            v200 = round(float(row.pct_above_200d), 2) if pd.notna(row.pct_above_200d) else None
            v50  = round(float(row.pct_above_50d),  2) if pd.notna(row.pct_above_50d)  else None
            params.append((row.date, v200, v50))
        d1_insert_many(params)
        total += len(chunk)
        print(f'    Uploaded {total}/{len(rows)}')
        time.sleep(0.2)

    return total


def main():
    for key in ('CF_ACCOUNT_ID', 'CF_API_TOKEN', 'CF_D1_DB_ID'):
        if not os.environ.get(key):
            raise SystemExit(f'ERROR: {key} not set in seed/.env')

    mmth_path, mmfi_path = _resolve_csv_paths()

    print('── Breadth History Seeder ────────────────────────────')
    print('\n[1] Loading CSV files...')
    df_mmth = load_csv(mmth_path, 'MMTH (200d)')
    df_mmfi = load_csv(mmfi_path, 'MMFI (50d)')

    print('\n[2] Uploading to D1...')
    total = upload(df_mmth, df_mmfi)

    print(f'\n✓ Done — {total} rows upserted into market_breadth.')
    print('─' * 55)


if __name__ == '__main__':
    main()
