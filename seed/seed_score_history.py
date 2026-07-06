"""
Score History Backfill
Populates D1 `score_history` with the three horizon scores + matrix quadrant for
each historical trading date, by calling /api/scores?asOf=<date> (which recomputes
the horizons as-of that date via the same buildHorizons the live site uses).

Only the score columns are written; brief_* are left to the nightly /api/score-snapshot
(forward) and the weekly theme job, so an UPSERT here never clobbers them.

Idempotent + resumable: dates already in score_history are skipped.

Uses CF_ACCOUNT_ID, CF_API_TOKEN, CF_D1_DB_ID, HUB_TOKEN from seed/.env.

Usage:
  python seed/seed_score_history.py            # last 2 years
  python seed/seed_score_history.py --years 5  # deeper
  python seed/seed_score_history.py --from 2026-01-01
  python seed/seed_score_history.py --force    # recompute existing dates too
"""

import os, sys, argparse
from datetime import date, timedelta
from concurrent.futures import ThreadPoolExecutor
import requests
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '.env'))

CF_ACCOUNT_ID = os.environ.get('CF_ACCOUNT_ID', '').strip()
CF_API_TOKEN  = os.environ.get('CF_API_TOKEN',  '').strip()
CF_D1_DB_ID   = os.environ.get('CF_D1_DB_ID',   '').strip()
HUB_TOKEN     = os.environ.get('HUB_TOKEN',     '').strip()
SITE_URL      = os.environ.get('SITE_URL', 'https://market.loganbase.com').rstrip('/')

D1_MAX_VARS = 90            # 6 vars/row -> 15 rows per INSERT
WORKERS     = 8

def d1_exec(sql, params=None, retries=4):
    url  = f'https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT_ID}/d1/database/{CF_D1_DB_ID}/query'
    body = {'sql': sql}
    if params:
        body['params'] = params
    for attempt in range(retries):
        try:
            data = requests.post(url, headers={'Authorization': f'Bearer {CF_API_TOKEN}',
                                               'Content-Type': 'application/json'},
                                 json=body, timeout=30).json()
            if not data.get('success'):
                raise RuntimeError(f"D1 error: {data.get('errors', data)}")
            return data
        except (requests.ConnectionError, requests.Timeout):
            if attempt == retries - 1:
                raise

def d1_rows(sql, params=None):
    return d1_exec(sql, params)['result'][0].get('results', [])

def fetch_asof(d):
    """Return (date, [spd, cmp, anc, quadrant, sizing]) or (date, None)."""
    try:
        r = requests.get(f'{SITE_URL}/api/scores?asOf={d}',
                         headers={'X-Hub-Token': HUB_TOKEN}, timeout=40).json()
        h = r.get('horizons')
        if not h:
            return d, None
        spd = h.get('speedometer', {}).get('score')
        cmp = h.get('compass', {}).get('score')
        anc = h.get('anchor', {}).get('score')
        mx  = h.get('matrix', {})
        if spd is None or cmp is None or anc is None:
            return d, None
        rnd = lambda x: round(x, 1) if x is not None else None
        return d, [rnd(spd), rnd(cmp), rnd(anc), mx.get('quadrant'), mx.get('sizingFactor')]
    except Exception as e:
        print(f"  ! {d}: {e}")
        return d, None

def upsert(rows):
    cols = "(date, speedometer, compass, anchor, quadrant, sizing_factor)"
    for i in range(0, len(rows), D1_MAX_VARS // 6):
        chunk = rows[i:i + D1_MAX_VARS // 6]
        ph = ", ".join(["(?, ?, ?, ?, ?, ?)"] * len(chunk))
        params = [v for (d, vals) in chunk for v in ([d] + vals)]
        d1_exec(
            f"INSERT INTO score_history {cols} VALUES {ph} "
            f"ON CONFLICT(date) DO UPDATE SET "
            f"speedometer=excluded.speedometer, compass=excluded.compass, anchor=excluded.anchor, "
            f"quadrant=excluded.quadrant, sizing_factor=excluded.sizing_factor",
            params)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--years', type=int, default=2)
    ap.add_argument('--from', dest='frm', default=None)
    ap.add_argument('--force', action='store_true')
    args = ap.parse_args()

    if not all([CF_ACCOUNT_ID, CF_API_TOKEN, CF_D1_DB_ID, HUB_TOKEN]):
        sys.exit("Missing CF_ACCOUNT_ID / CF_API_TOKEN / CF_D1_DB_ID / HUB_TOKEN in seed/.env")

    start = args.frm or (date.today() - timedelta(days=args.years * 365)).isoformat()

    d1_exec("""CREATE TABLE IF NOT EXISTS score_history (
      date TEXT PRIMARY KEY, speedometer REAL, compass REAL, anchor REAL,
      quadrant TEXT, sizing_factor REAL, brief_sentiment INTEGER, brief_sector TEXT, brief_theme TEXT)""")

    dates = [r['date'] for r in d1_rows(
        "SELECT date FROM daily_prices WHERE symbol='SPY' AND date >= ? ORDER BY date", [start])]
    if not args.force:
        have = {r['date'] for r in d1_rows("SELECT date FROM score_history")}
        dates = [d for d in dates if d not in have]

    print(f"-----------------------------------------------------------")
    print(f"  Score History Backfill")
    print(f"  Range: {start} -> today   Site: {SITE_URL}")
    print(f"  Trading days to compute: {len(dates)}")
    print(f"-----------------------------------------------------------")
    if not dates:
        print("  Nothing to do."); return

    rows, done, skipped = [], 0, 0
    with ThreadPoolExecutor(max_workers=WORKERS) as ex:
        for d, vals in ex.map(fetch_asof, dates):
            done += 1
            if vals is None:
                skipped += 1
            else:
                rows.append((d, vals))
            if done % 25 == 0 or done == len(dates):
                print(f"  computed {done}/{len(dates)}  (stored {len(rows)}, skipped {skipped})")

    for i in range(0, len(rows), 150):
        upsert(rows[i:i + 150])
    print(f"-----------------------------------------------------------")
    print(f"  Done. Upserted {len(rows)} rows into score_history "
          f"({skipped} dates had insufficient data).")
    print(f"-----------------------------------------------------------")

if __name__ == '__main__':
    main()
