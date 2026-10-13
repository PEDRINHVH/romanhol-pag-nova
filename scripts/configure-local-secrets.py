"""Store local runtime credentials without terminal echo or shell arguments."""
import getpass
import json
import os
from pathlib import Path

values = json.loads(getpass.getpass('Runtime configuration JSON (hidden): '))
target = Path(__file__).resolve().parents[1] / '.env.local'
fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
with os.fdopen(fd, 'w') as handle:
    for key, value in values.items():
        if not key.replace('_', '').isalnum() or '\n' in str(value):
            raise ValueError('Invalid environment entry')
        handle.write(f'{key}={value}\n')
print('Local runtime configuration saved.')
