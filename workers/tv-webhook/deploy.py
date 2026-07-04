"""
Deploy market-hub-tv-webhook Worker via Cloudflare REST API.
Avoids wrangler CLI entirely (not supported on Windows ARM64).

Usage:
  python workers/tv-webhook/deploy.py

Requires in seed/.env:
  CF_ACCOUNT_ID, CF_API_TOKEN, CF_D1_DB_ID, TV_SECRET
"""

import os, sys, json, secrets, requests
from pathlib import Path

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
TV_SECRET     = os.environ.get('TV_SECRET',      '').strip()

WORKER_NAME = 'market-hub-tv-webhook'
SCRIPT_PATH = Path(__file__).parent / 'index.js'

BASE    = f'https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT_ID}/workers/scripts/{WORKER_NAME}'
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

    global TV_SECRET
    if not TV_SECRET:
        TV_SECRET = secrets.token_urlsafe(32)
        print(f'\n  TV_SECRET not set — generated: {TV_SECRET}')
        print(f'  Add this to seed/.env:  TV_SECRET={TV_SECRET}')
        print(f'  Use this as your webhook URL secret.\n')


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
            },
            {
                'type': 'plain_text',
                'name': 'TV_SECRET',
                'text': TV_SECRET,
            },
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
    print('  Script uploaded.')

    # Enable workers.dev subdomain
    sub = requests.post(
        f'{BASE}/subdomain',
        headers={**HEADERS, 'Content-Type': 'application/json'},
        json={'enabled': True},
        timeout=15,
    )
    print('  workers.dev enabled.\n')


def main():
    check_env()
    print('─' * 55)
    print('  Deploy: market-hub-tv-webhook')
    print('─' * 55 + '\n')
    upload_worker()
    print('Done.')
    # Fetch actual workers.dev subdomain — it's account-specific, not the account ID prefix
    sub_res  = requests.get(
        f'https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT_ID}/workers/subdomain',
        headers=HEADERS, timeout=15,
    )
    subdomain = sub_res.json().get('result', {}).get('subdomain', CF_ACCOUNT_ID[:8])
    webhook_url = f'https://{WORKER_NAME}.{subdomain}.workers.dev/webhook?secret={TV_SECRET}'
    print(f'\n  Webhook URL:')
    print(f'  {webhook_url}')
    print(f'\n  Use this URL in TradingView alert → Webhook URL field.')
    print('─' * 55)


if __name__ == '__main__':
    main()
