"""
Barchart API — Breadth Data Test
Tests whether Barchart serves NYSE breadth indicators via their OnDemand API.

Usage:
  Add BARCHART_API_KEY=<your_key> to seed/.env
  python seed/test_barchart.py
"""

import os, json
import requests
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '.env'))

API_KEY  = os.environ.get('BARCHART_API_KEY', '').strip()
BASE_URL = 'https://ondemand.websol.barchart.com'

# Breadth symbols to probe
# Barchart uses ! prefix for market internals
SYMBOLS = {
    '!MMTH': 'NYSE % above 200d SMA  (target)',
    '!MMFI': 'NYSE % above 50d SMA   (target)',
    '!SPXADP': 'S&P 500 % above 200d (alt)',
    '!GT200':  'NYSE stocks > 200d    (alt)',
    '!GT50':   'NYSE stocks > 50d     (alt)',
}


def get_quote(symbol):
    res = requests.get(
        f'{BASE_URL}/getQuote.json',
        params={'apikey': API_KEY, 'symbols': symbol},
        timeout=15,
    )
    return res.status_code, res.json() if res.ok else res.text[:200]


def get_history(symbol, start='2025-01-01'):
    res = requests.get(
        f'{BASE_URL}/getHistory.json',
        params={
            'apikey':     API_KEY,
            'symbol':     symbol,
            'type':       'daily',
            'startDate':  start.replace('-', ''),
            'maxRecords': 5,
        },
        timeout=15,
    )
    return res.status_code, res.json() if res.ok else res.text[:200]


def main():
    if not API_KEY:
        raise SystemExit('ERROR: BARCHART_API_KEY not set in seed/.env')

    print('── Barchart Breadth Test ─────────────────────────────')
    print(f'Key: {API_KEY[:6]}...\n')

    for symbol, label in SYMBOLS.items():
        print(f'  {symbol}  ({label})')

        # Quote (current value)
        code, data = get_quote(symbol)
        if code == 200 and isinstance(data, dict):
            results = data.get('results') or []
            if results:
                r = results[0]
                print(f'    Quote  ✓  lastPrice={r.get("lastPrice")}  tradeTime={r.get("tradeTimestamp","")[:10]}')
            else:
                err = data.get('status', {})
                print(f'    Quote  ✗  {err.get("message", "no results")}')
        else:
            print(f'    Quote  ✗  HTTP {code}')

        # History (can we get historical data?)
        code, data = get_history(symbol)
        if code == 200 and isinstance(data, dict):
            results = data.get('results') or []
            if results:
                dates = [r.get('tradingDay','') for r in results]
                vals  = [r.get('close') for r in results]
                print(f'    History✓  {len(results)} rows — dates: {dates[0]} → {dates[-1]}')
                print(f'    Values:   {vals}')
            else:
                err = data.get('status', {})
                print(f'    History✗  {err.get("message", "no results")}')
        else:
            print(f'    History✗  HTTP {code}')

        print()

    print('─' * 55)
    print('✓ = data available  ✗ = not served or not on your plan')


if __name__ == '__main__':
    main()
