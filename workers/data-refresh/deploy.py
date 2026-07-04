"""
Deploy market-hub-data-refresh Worker via Cloudflare REST API.
Avoids wrangler CLI entirely (not supported on Windows ARM64).

This Worker calls /api/refresh on the Cloudflare Pages site every
weekday at 22:00 UTC (6 PM ET), keeping D1 current with the latest
trading-day prices and indicators for all 70 symbols.

Setup:
  Add these two lines to seed/.env before running:
    HUB_TOKEN=<value from Cloudflare Pages → Settings → Environment Variables>
    CRON_SECRET=<any secret you choose for the manual /run endpoint>

Usage:
  python workers/data-refresh/deploy.py
"""

import os, sys, json, requests
from pathlib import Path

# Load seed/.env
env_path = Path(__file__).parent.parent.parent / 'seed' / '.env'
if env_path.exists():
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith('#') and '=' in line:
            k, _, v = line.partition('=')
            os.environ.setdefault(k.strip(), v.strip())

CF_ACCOUNT_ID = os.environ.get('CF_ACCOUNT_ID', '').strip()
CF_API_TOKEN  = os.environ.get('CF_API_TOKEN',  '').strip()
HUB_TOKEN     = os.environ.get('HUB_TOKEN',     '').strip()
CRON_SECRET   = os.environ.get('CRON_SECRET',   '').strip()
SITE_URL      = os.environ.get('SITE_URL', 'https://market.loganbase.com').strip()

WORKER_NAME   = 'market-hub-data-refresh'
SCRIPT_PATH   = Path(__file__).parent / 'index.js'
CRON_SCHEDULE = '0 22 * * 1-5'   # Mon–Fri 22:00 UTC = 6 PM ET

BASE    = f'https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT_ID}/workers/scripts/{WORKER_NAME}'
HEADERS = {'Authorization': f'Bearer {CF_API_TOKEN}'}


def check_env():
    missing = [k for k, v in {
        'CF_ACCOUNT_ID': CF_ACCOUNT_ID,
        'CF_API_TOKEN':  CF_API_TOKEN,
        'HUB_TOKEN':     HUB_TOKEN,
    }.items() if not v]
    if missing:
        print(f'ERROR: Missing env vars: {", ".join(missing)}')
        print('Add them to seed/.env — see comments at top of this file.')
        sys.exit(1)


def upload_worker():
    print('Uploading worker script...')
    code = SCRIPT_PATH.read_text(encoding='utf-8')
    metadata = {
        'main_module': 'index.js',
        'compatibility_date': '2024-09-23',
        'bindings': [
            {'type': 'plain_text', 'name': 'SITE_URL', 'text': SITE_URL},
        ],
    }
    files = {
        'metadata': (None, json.dumps(metadata), 'application/json'),
        'index.js': ('index.js', code, 'application/javascript+module'),
    }
    res  = requests.put(BASE, headers=HEADERS, files=files, timeout=30)
    data = res.json()
    if not data.get('success'):
        print(f'ERROR uploading script: {data.get("errors", data)}')
        sys.exit(1)
    print('  Script uploaded.\n')


def set_secret(name, value):
    if not value:
        print(f'  Skipping secret {name} (not set in .env)')
        return
    print(f'  Setting secret: {name}')
    res = requests.put(
        f'{BASE}/secrets',
        headers={**HEADERS, 'Content-Type': 'application/json'},
        json={'name': name, 'text': value, 'type': 'secret_text'},
        timeout=30,
    )
    data = res.json()
    if not data.get('success'):
        print(f'  ERROR setting {name}: {data.get("errors", data)}')
    else:
        print(f'  {name} set.\n')


def set_cron():
    print(f'Setting cron trigger: {CRON_SCHEDULE}')
    res = requests.put(
        f'{BASE}/schedules',
        headers={**HEADERS, 'Content-Type': 'application/json'},
        json=[{'cron': CRON_SCHEDULE}],
        timeout=30,
    )
    data = res.json()
    if not data.get('success'):
        print(f'ERROR setting cron: {data.get("errors", data)}')
        sys.exit(1)
    print(f'  Cron set: {CRON_SCHEDULE}\n')


def main():
    check_env()
    print('-' * 55)
    print('  Deploy: market-hub-data-refresh')
    print('-' * 55 + '\n')
    upload_worker()
    print('Setting secrets...')
    set_secret('HUB_TOKEN', HUB_TOKEN)
    set_secret('CRON_SECRET', CRON_SECRET)
    set_cron()
    print('Done.')
    print(f'\n  Cron fires : {CRON_SCHEDULE} (Mon–Fri 22:00 UTC = 6 PM ET)')
    print(f'  Manual run : curl https://{WORKER_NAME}.shane-logan.workers.dev/run')
    print(f'               -H "Authorization: Bearer <CRON_SECRET>"')
    print('-' * 55)


if __name__ == '__main__':
    main()
