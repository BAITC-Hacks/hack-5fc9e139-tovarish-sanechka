"""Stdlib HTTP readiness check for the validated files of the current run."""
import csv
import hashlib
import io
import json
import os
from pathlib import Path
import sys
from urllib.request import urlopen


def check(base_url='http://127.0.0.1:8080', out_dir=Path('/app/out')):
    local = json.loads((out_dir/'ready.json').read_text())
    def fetch(name):
        with urlopen(f'{base_url}/{name}', timeout=5) as response:
            return response.read()
    remote = json.loads(fetch('ready.json'))
    if remote != local or not remote['run_id']:
        raise ValueError('Readiness manifest belongs to another run')
    required = {'index.html','analysis.json','nodes_roles.csv','clusters.csv','top_nodes.csv'}
    if not required <= set(remote['files']):
        raise ValueError('Readiness manifest is incomplete')
    contents = {}
    for name, digest in remote['files'].items():
        if name.startswith('/') or '..' in Path(name).parts:
            raise ValueError('Invalid manifest path')
        contents[name] = fetch(name)
        if hashlib.sha256(contents[name]).hexdigest() != digest:
            raise ValueError(f'Published file differs from validated result: {name}')
    data = json.loads(contents['analysis.json'])
    if data['schema_version'] != 1 or len(data['nodes']) != remote['n_nodes']:
        raise ValueError('Invalid analysis schema or count')
    schemas = {
        'nodes_roles.csv': {'gid','role','role_score','cluster_id','priority_score','evidence'},
        'clusters.csv': {'cluster_id','n_nodes','n_seed','sum_kzt_internal','top_gids','hypothesis'},
        'top_nodes.csv': {'rank','gid','role','priority_score','why'},
    }
    for name, columns in schemas.items():
        reader = csv.DictReader(io.StringIO(contents[name].decode('utf-8')))
        if not columns <= set(reader.fieldnames or []):
            raise ValueError(f'Missing CSV columns: {name}')
        rows = list(reader)
        if not rows or any(not row[column] for row in rows for column in columns):
            raise ValueError(f'Empty CSV values: {name}')
        expected = len(data['clusters']) if name=='clusters.csv' else len(data['nodes'])
        if len(rows) != expected:
            raise ValueError(f'CSV count mismatch: {name}')
    if b'<html' not in contents['index.html'] or b'/assets/' not in contents['index.html']:
        raise ValueError('UI missing')


if __name__ == '__main__':
    try:
        check(out_dir=Path(os.environ.get('APP_OUTPUT', '/app/out')))
    except (OSError, ValueError, KeyError, TypeError) as exc:
        print(f'Not ready: {exc}', file=sys.stderr)
        sys.exit(1)
