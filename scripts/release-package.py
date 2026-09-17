#!/usr/bin/env python3
"""Build a source release with verified, prebuilt frontend assets."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import tarfile


def frontend_hashes(root):
    directory = root / 'frontend/dist'
    if not (directory / 'index.html').is_file():
        raise ValueError('Missing frontend/dist/index.html')
    files = {}
    for path in sorted(directory.rglob('*')):
        if path.is_symlink():
            raise ValueError('Frontend assets must not contain symbolic links')
        if path.is_file():
            files[path.relative_to(root).as_posix()] = hashlib.sha256(path.read_bytes()).hexdigest()
    return files


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, help='New .tar.gz file; existing files are never overwritten')
    parser.add_argument('--verify-frontend', type=Path, metavar='ROOT')
    args = parser.parse_args()
    if args.verify_frontend:
        root = args.verify_frontend.resolve()
        manifest = json.loads((root / 'frontend-release.json').read_text())
        if manifest != frontend_hashes(root):
            raise ValueError('Frontend release checksum mismatch')
        print('Frontend release checksums verified')
        return
    if not args.output:
        parser.error('--output or --verify-frontend is required')
    root = Path(__file__).resolve().parent.parent
    output = args.output.resolve()
    if output.exists():
        raise ValueError('Output already exists')
    subprocess.run(['npm', 'ci', '--no-audit', '--no-fund'], cwd=root / 'frontend', check=True)
    subprocess.run(['npm', 'run', 'build'], cwd=root / 'frontend', check=True)
    manifest = frontend_hashes(root)
    tracked = subprocess.check_output(['git', 'ls-files', '-z'], cwd=root).decode().split('\0')
    # Include newly authored source files without including ignored runtime data.
    untracked = subprocess.check_output(['git', 'ls-files', '--others', '--exclude-standard', '-z'], cwd=root).decode().split('\0')
    source_roots = {'backend', 'frontend', 'deploy', 'scripts', 'docs'}
    source_suffixes = {'.py', '.sh', '.vue', '.ts', '.css', '.json', '.md', '.png', '.svg', '.example'}
    tracked += [name for name in untracked if name and Path(name).parts[0] in source_roots
                and Path(name).suffix in source_suffixes]
    import io
    with tarfile.open(output, 'x:gz') as archive:
        for name in sorted(set(tracked)):
            if not name or name.startswith('.git'):
                continue
            path = root / name
            if path.is_symlink():
                raise ValueError('Release sources must not contain symbolic links')
            if path.is_file():
                archive.add(path, arcname=name, recursive=False)
        for name in manifest:
            archive.add(root / name, arcname=name, recursive=False)
        data = json.dumps(manifest, indent=2).encode()
        entry = tarfile.TarInfo('frontend-release.json')
        entry.size = len(data)
        entry.mode = 0o644
        archive.addfile(entry, io.BytesIO(data))
    print(f'Release: {output}')
    print(f'SHA256: {hashlib.sha256(output.read_bytes()).hexdigest()}')


if __name__ == '__main__':
    main()
