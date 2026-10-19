from pathlib import Path
import argparse, re, zipfile

args = argparse.ArgumentParser()
args.add_argument('--base', required=True)
options = args.parse_args()
root = Path(__file__).resolve().parent.parent
base = Path(options.base).resolve()
config_source = (root / 'src/java/com/lulu/config/Config.java').read_text(encoding='utf-8')
target_match = re.search(r'APP_VERSION\s*=\s*"v([0-9]+\.[0-9]+\.[0-9]+)"', config_source)
if not target_match:
    raise SystemExit('Could not read the target APP_VERSION from Config.java')
target_version = b'v' + target_match.group(1).encode('ascii')
target = root / f'dist/TBH-Helper-{target_version.decode("ascii")}.jar'
target.parent.mkdir(exist_ok=True)
patches = {p.relative_to(root / 'build/classes-incremental').as_posix(): p for p in (root / 'build/classes-incremental').rglob('*.class')}
for group in ('imgs', 'warehouse', 'i18n'):
    for path in (root / 'resources' / group).rglob('*'):
        if path.is_file(): patches[group + '/' + path.relative_to(root / 'resources' / group).as_posix()] = path

def keep(name):
    if name.startswith(('driver/mac/', 'driver/mac-arm64/', 'driver/linux/', 'driver/linux-arm64/',
                        'nu/pattern/opencv/linux/', 'nu/pattern/opencv/osx/', 'nu/pattern/opencv/windows/x86_32/')): return False
    return name != 'announcement.txt'

with zipfile.ZipFile(base) as original, zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as output:
    base_global = original.read('com/lulu/config/Config$Global.class')
    base_match = re.search(rb'v([0-9]+\.[0-9]+\.[0-9]+)', base_global)
    if not base_match:
        raise SystemExit('Could not read the base APP_VERSION from Config$Global.class')
    base_version = b'v' + base_match.group(1)
    for item in original.infolist():
        if item.filename not in patches and keep(item.filename):
            data = original.read(item.filename)
            if item.filename.endswith('.class'):
                data = data.replace(base_version, target_version)
            output.writestr(item, data)
    for name, path in patches.items():
        data = path.read_bytes().replace(base_version, target_version)
        output.writestr(name, data)
print(f'Created {target.name}: {target.stat().st_size:,} bytes (Windows x64 resources)')
