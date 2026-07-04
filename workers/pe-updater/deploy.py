"""
Deploy market-hub-pe-updater Worker via Cloudflare REST API.
Avoids wrangler CLI entirely (not supported on Windows ARM64).

Usage (from any directory):
  python workers/pe-updater/deploy.py

Uses CF_ACCOUNT_ID and CF_API_TOKEN from seed/.env
"""

import os, sys, json, requests
from pathlib import Path

# Load .env from seed/
env_path = Path(__file__).parent.parent.parent / 'seed' / '.env'
if env_path.exists():
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith('#') and '=' in line:
            k, _, v = line.partition('=')
            os.environ.setdefault(k.strip(), v.strip())

CF_ACCOUNT_ID = os.environ.get('CF_ACCOUNT_ID', '').strip()
CF_API_TOKEN  = os.environ.get('CF_API_TOKEN',  '').strip()
CF_D1_DB_ID   = os.environ.get('CF_D1_DB_ID',   '').strip()

WORKER_NAME   = 'market-hub-pe-updater'
SCRIPT_PATH   = Path(__file__).parent / 'index.js'
CRON_SCHEDULE = '0 2 * * *'   # 02:00 UTC daily

BASE = f'https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT_ID}/workers/scripts/{WORKER_NAME}'
HEADERS = {'Authorization': f'Bearer {CF_API_TOKEN}'}

def check_env():
    missing = [k for k, v in {
        'CF_ACCOUNT_ID': CF_ACCOUNT_ID,
        'CF_API_TOKEN':  CF_API_TOKEN,
        'CF_D1_DB_ID':   CF_D1_DB_ID,
    }.items() if not v]
    if missing:
        print(f'ERROR: Missing env vars: {", ".join(missing)}')
        sys.exit(1)

def upload_worker():
    print('Uploading worker script...')
    code = SCRIPT_PATH.read_text(encoding='utf-8')

    metadata = {
        'main_module': 'index.js',
        'compatibility_date': '2024-09-23',
        'bindings': [
            {
                'type': 'd1',
                'name': 'DB',
                'id':   CF_D1_DB_ID,
            }
        ],
    }

    # Multipart upload — ESM module requires application/javascript+module
    files = {
        'metadata': (None, json.dumps(metadata), 'application/json'),
        'index.js': ('index.js', code, 'application/javascript+module'),
    }

    res = requests.put(BASE, headers=HEADERS, files=files, timeout=30)
    data = res.json()
    if not data.get('success'):
        print(f'ERROR uploading script: {data.get("errors", data)}')
        sys.exit(1)
    print('  Script uploaded.\n')

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
    print('─' * 55)
    print('  Deploy: market-hub-pe-updater')
    print('─' * 55 + '\n')
    upload_worker()
    set_cron()
    print('Done.')
    print(f'\n  Worker URL: https://{WORKER_NAME}.{CF_ACCOUNT_ID[:8]}.workers.dev')
    print(f'  Cron fires: {CRON_SCHEDULE} (02:00 UTC daily)')
    print('─' * 55)

if __name__ == '__main__':
    main()
