from __future__ import annotations

import runpy
import dis
import marshal
import subprocess
import sys
import tempfile
import zlib
from pathlib import Path

BUILD_VERSION = '1.3.82'


def main() -> int:
    if len(sys.argv) != 7:
        print(
            "Usage: build_feature_update.py <builder.py> <base.exe> <ui.py> "
            "<frida.js> <catalog.json> <output.exe>",
            file=sys.stderr,
        )
        return 2
    builder_path, base_path, ui_path, agent_path, catalog_path, output_path = map(Path, sys.argv[1:])
    builder = runpy.run_path(str(builder_path))
    original = base_path.read_bytes()
    base, _toc_offset, _py_version, _python_dll, entries = builder["parse_archive"](original)
    matches = [entry for entry in entries if entry.name == "auto_synthesis_controller" and entry.type_code == ord("s")]
    if len(matches) != 1:
        raise RuntimeError(f"Expected one auto_synthesis_controller script, found {len(matches)}")
    entry = matches[0]
    encoded = original[base + entry.offset:base + entry.offset + entry.compressed_size]
    raw_module = zlib.decompress(encoded) if entry.compressed else encoded
    patched_module = builder["patch_module"](raw_module, ui_path.read_text(encoding="utf-8"))
    root = marshal.loads(patched_module)
    instructions = list(dis.get_instructions(root))
    version_store = next(index for index, instruction in enumerate(instructions)
                         if instruction.opname == 'STORE_NAME' and instruction.argval == 'APP_VERSION')
    version_load = instructions[version_store - 1]
    if version_load.opname != 'LOAD_CONST' or not isinstance(version_load.argval, str):
        raise RuntimeError('APP_VERSION is not a literal string')
    constants = list(root.co_consts)
    constants[version_load.arg] = BUILD_VERSION
    patched_module = marshal.dumps(root.replace(co_consts=tuple(constants)))
    data_replacements = {
        "auto_synthesis_frida.js": agent_path.read_bytes(),
        "taskbarhero_items_i18n.json": catalog_path.read_bytes(),
        "imgs/brand-lockup.png": (Path(__file__).resolve().parent / "design" / "brand-lockup.png").read_bytes(),
    }
    rebuilt = builder["rebuild_executable"](
        original,
        patched_module,
        new_icon=(builder_path.parent / "tbh-brand.ico").read_bytes(),
        data_replacements=data_replacements,
    )
    # rcedit rewrites the PE and discards its PyInstaller overlay. Edit the
    # bootloader separately, then attach the unchanged archive to the new PE.
    archive_base, *_ = builder["parse_archive"](rebuilt)
    overlay = rebuilt[archive_base:]
    with tempfile.TemporaryDirectory(prefix="tbh-icon-") as folder:
        stub = Path(folder) / "bootloader.exe"
        stub.write_bytes(rebuilt[:archive_base])
        resource_command = [str(builder_path.parent / "rcedit-x64.exe"), str(stub),
                            "--set-icon", str(builder_path.parent / "tbh-brand.ico"),
                            "--set-file-version", BUILD_VERSION + '.0', "--set-product-version", BUILD_VERSION + '.0']
        for key, value in {"FileDescription": "TBH助手", "ProductName": "TBH助手",
                           "InternalName": "TBHHelper", "OriginalFilename": "TBH助手.exe",
                           "CompanyName": "阿丸AWan", "LegalCopyright": "by 阿丸AWan"}.items():
            resource_command.extend(("--set-version-string", key, value))
        subprocess.run(resource_command, check=True)
        rebuilt = stub.read_bytes() + overlay
    new_base, *_ = builder["parse_archive"](rebuilt)
    if rebuilt[new_base:] != overlay:
        raise RuntimeError("PE icon update changed the PyInstaller archive")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_bytes(rebuilt)
    print(f"controller: {len(raw_module):,} -> {len(patched_module):,} bytes")
    print(f"Frida agent: {len(data_replacements['auto_synthesis_frida.js']):,} bytes")
    print(f"item catalog: {len(data_replacements['taskbarhero_items_i18n.json']):,} bytes")
    print(f"output: {output_path} ({len(rebuilt):,} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
