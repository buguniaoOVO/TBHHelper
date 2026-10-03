from pathlib import Path
import argparse, zipfile

args = argparse.ArgumentParser()
args.add_argument('--base', required=True)
options = args.parse_args()
root = Path(__file__).resolve().parent.parent
base = Path(options.base).resolve()
target = root / 'dist/TBH-Helper-v1.3.48.jar'
target.parent.mkdir(exist_ok=True)
patches = {p.relative_to(root / 'build/classes').as_posix(): p for p in (root / 'build/classes').rglob('*.class')}
for group in ('imgs', 'warehouse', 'i18n'):
    for path in (root / 'resources' / group).rglob('*'):
        if path.is_file(): patches[group + '/' + path.relative_to(root / 'resources' / group).as_posix()] = path

def keep(name):
    if name.startswith(('driver/mac/', 'driver/mac-arm64/', 'driver/linux/', 'driver/linux-arm64/',
                        'nu/pattern/opencv/linux/', 'nu/pattern/opencv/osx/', 'nu/pattern/opencv/windows/x86_32/')): return False
    return name != 'announcement.txt'

with zipfile.ZipFile(base) as original, zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as output:
    for item in original.infolist():
        if item.filename not in patches and keep(item.filename): output.writestr(item, original.read(item.filename))
    for name, path in patches.items(): output.write(path, name)
print(f'Created {target.name}: {target.stat().st_size:,} bytes (Windows x64 resources)')
