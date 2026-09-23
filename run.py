"""Calculate results before serving; the output lock remains held while serving."""
import argparse
from functools import partial
import hashlib
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import shutil
import signal
import sys
import uuid

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / 'case/starter'))
from starter import analyze


class ResultHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        super().end_headers()

    def list_directory(self, path):
        self.send_error(403, 'Directory listing disabled')
        return None

    def translate_path(self, path):
        translated = Path(super().translate_path(path))
        root = Path(self.directory).resolve()
        if not translated.resolve().is_relative_to(root):
            return str(root / '.not-found')
        return str(translated)


def serve_results(result, out_dir, ui_dir, host, port):
    # Only produced UI assets are copied; never expose source code or Parquet.
    shutil.copytree(ui_dir, out_dir, dirs_exist_ok=True)
    run_id = str(uuid.uuid4())
    files = ['index.html', 'analysis.json', 'nodes_roles.csv', 'clusters.csv', 'top_nodes.csv']
    files.extend(str(path.relative_to(out_dir)) for path in sorted((out_dir/'assets').rglob('*')) if path.is_file())
    manifest = {'run_id': run_id, 'n_nodes': result['meta']['n_nodes'],
                'files': {name: hashlib.sha256((out_dir/name).read_bytes()).hexdigest() for name in files}}
    (out_dir/'ready.json').write_text(json.dumps(manifest), encoding='utf-8')
    handler = partial(ResultHandler, directory=str(out_dir))
    with ThreadingHTTPServer((host, port), handler) as server:
        def stop(signum, frame):
            raise KeyboardInterrupt
        previous = signal.signal(signal.SIGTERM, stop)
        print(f'Ready: http://{host}:{port} run_id={run_id}', flush=True)
        try:
            server.serve_forever(poll_interval=0.25)
        except KeyboardInterrupt:
            print('Server stopped', flush=True)
        finally:
            signal.signal(signal.SIGTERM, previous)
            (out_dir/'ready.json').unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--data', type=Path, default=ROOT/'case/data')
    parser.add_argument('--out', type=Path, default=ROOT/'out')
    parser.add_argument('--config', type=Path, default=ROOT/'config.toml')
    parser.add_argument('--ui', type=Path, default=ROOT/'web/dist')
    parser.add_argument('--serve', action='store_true')
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--port', type=int, default=8080)
    args = parser.parse_args()
    if args.serve and not (args.ui/'index.html').is_file():
        parser.error('UI build missing. Run npm --prefix web run build or use Docker Compose.')
    callback = partial(serve_results, out_dir=args.out.resolve(), ui_dir=args.ui.resolve(), host=args.host, port=args.port) if args.serve else None
    analyze(args.data, args.out, args.config, on_ready=callback)


if __name__ == '__main__':
    main()
