from __future__ import annotations

import marshal
import struct
import sys
import zlib
from dataclasses import dataclass
from pathlib import Path
from types import CodeType


MAGIC = b"MEI\x0c\x0b\x0a\x0b\x0e"
COOKIE = struct.Struct(">8sIIII64s")
TOC_HEAD = struct.Struct(">iIIIBB")
SCRIPT_NAME = "auto_synthesis_controller"


@dataclass
class Entry:
    name: str
    name_field: bytes
    offset: int
    compressed_size: int
    uncompressed_size: int
    compressed: int
    type_code: int


def parse_archive(data: bytes):
    cookie_offset = data.rfind(MAGIC)
    if cookie_offset < 0 or cookie_offset + COOKIE.size != len(data):
        raise ValueError("PyInstaller cookie is missing or not at EOF")
    magic, package_length, toc_offset, toc_length, py_version, python_dll = COOKIE.unpack_from(data, cookie_offset)
    base = len(data) - package_length
    if base < 0 or base + toc_offset + toc_length != cookie_offset:
        raise ValueError("PyInstaller cookie offsets do not match the executable")
    toc_start = base + toc_offset
    toc_end = toc_start + toc_length
    entries = []
    position = toc_start
    while position < toc_end:
        entry_length, offset, compressed_size, uncompressed_size, compressed, type_code = TOC_HEAD.unpack_from(data, position)
        if entry_length < TOC_HEAD.size or position + entry_length > toc_end:
            raise ValueError("Invalid CArchive TOC entry")
        name_field = data[position + TOC_HEAD.size:position + entry_length]
        name = name_field.split(b"\0", 1)[0].decode("utf-8", "replace")
        entries.append(Entry(name, name_field, offset, compressed_size, uncompressed_size, compressed, type_code))
        position += entry_length
    if position != toc_end:
        raise ValueError("CArchive TOC was not consumed exactly")
    return base, toc_offset, py_version, python_dll, entries


def patch_module(raw_module: bytes, replacement_source: str) -> bytes:
    root = marshal.loads(raw_module)
    if not isinstance(root, CodeType):
        raise TypeError("Main archive entry is not a Python module code object")
    replacement_module = compile(replacement_source, "<ui-redesign>", "exec")
    replacement_functions = {
        obj.co_name: obj
        for obj in replacement_module.co_consts
        if isinstance(obj, CodeType)
    }
    required = {"_configure_theme", "_build_ui"}
    missing = required - replacement_functions.keys()
    if missing:
        raise ValueError("Replacement is missing: " + ", ".join(sorted(missing)))

    app_code = next((obj for obj in root.co_consts if isinstance(obj, CodeType) and obj.co_name == "App"), None)
    if app_code is None:
        raise ValueError("App class code object was not found")
    new_app_consts = list(app_code.co_consts)
    replaced = set()
    for index, obj in enumerate(new_app_consts):
        if isinstance(obj, CodeType) and obj.co_name in required:
            new_app_consts[index] = replacement_functions[obj.co_name]
            replaced.add(obj.co_name)
    if replaced != required:
        raise ValueError("Existing App methods not found: " + ", ".join(sorted(required - replaced)))
    new_app_code = app_code.replace(co_consts=tuple(new_app_consts))

    # _build_ui is recompiled and carries its own nested function code objects.
    # Preserve the original nested bytes for every helper that was not
    # explicitly replaced, otherwise its local references lose their cells.
    original_app_functions = {
        obj.co_name: obj for obj in app_code.co_consts if isinstance(obj, CodeType)
    }
    rebuilt_consts = []
    for value in new_app_code.co_consts:
        if isinstance(value, CodeType) and value.co_name in original_app_functions:
            original = original_app_functions[value.co_name]
            if value.co_name not in required:
                value = original
        rebuilt_consts.append(value)
    new_app_code = new_app_code.replace(co_consts=tuple(rebuilt_consts))

    new_root_consts = list(root.co_consts)
    original_main = next((obj for obj in root.co_consts
                          if isinstance(obj, CodeType) and obj.co_name == 'main'), None)
    if 'main' in replacement_functions:
        if original_main is None:
            raise ValueError('Original main entry point was not found')
        entry_main = original_main
        seen_main_codes = set()
        while {'SetCurrentProcessExplicitAppUserModelID', 'FunctionType'} <= set(original_main.co_names):
            if id(original_main) in seen_main_codes:
                raise ValueError('Startup wrapper contains a code-object cycle')
            seen_main_codes.add(id(original_main))
            inner = [value for value in original_main.co_consts
                     if isinstance(value, CodeType) and value.co_name == 'main']
            if len(inner) != 1:
                raise ValueError('Existing branding wrapper has no unique original entry point')
            original_main = inner[0]
        wrapper = replacement_functions['main']
        sentinel = '__TBH_ORIGINAL_MAIN_CODE__'
        if sentinel not in wrapper.co_consts:
            raise ValueError('Branding wrapper is missing its original-main placeholder')
        wrapper = wrapper.replace(co_consts=tuple(original_main if value == sentinel else value
                                                  for value in wrapper.co_consts))
        new_root_consts[new_root_consts.index(entry_main)] = wrapper
    for index, obj in enumerate(new_root_consts):
        if obj is app_code:
            new_root_consts[index] = new_app_code
            break
    else:
        raise ValueError("App code object was not present in the module constants")
    return marshal.dumps(root.replace(co_consts=tuple(new_root_consts)))


def rebuild_executable(original: bytes, new_module: bytes, new_icon: bytes | None = None,
                       data_replacements: dict[str, bytes] | None = None) -> bytes:
    base, old_toc_offset, py_version, python_dll, entries = parse_archive(original)
    data_replacements = data_replacements or {}
    prefix = original[:base]
    payload = bytearray()
    toc = bytearray()
    source_cursor = 0
    replacement_count = 0
    icon_replacement_count = 0
    data_replacement_counts = {name: 0 for name in data_replacements}

    for entry in entries:
        normalized_name = entry.name.replace("\\", "/")
        replacement_key = next((name for name in
                                (entry.name, normalized_name, "imgs/" + normalized_name)
                                if name in data_replacements), None)
        if entry.offset < source_cursor:
            raise ValueError("CArchive data entries are not in increasing offset order")
        if entry.offset > source_cursor:
            payload.extend(original[base + source_cursor:base + entry.offset])
        new_offset = len(payload)
        if entry.name == SCRIPT_NAME and entry.type_code == ord("s"):
            encoded = zlib.compress(new_module, 9)
            new_compressed_size = len(encoded)
            new_uncompressed_size = len(new_module)
            new_compressed_flag = 1
            payload.extend(encoded)
            replacement_count += 1
        elif entry.name.lower() == "app_icon.ico" and new_icon is not None:
            encoded = zlib.compress(new_icon, 9)
            new_compressed_size = len(encoded)
            new_uncompressed_size = len(new_icon)
            new_compressed_flag = 1
            payload.extend(encoded)
            icon_replacement_count += 1
        elif replacement_key is not None:
            replacement_data = data_replacements[replacement_key]
            encoded = zlib.compress(replacement_data, 9) if entry.compressed else replacement_data
            new_compressed_size = len(encoded)
            new_uncompressed_size = len(replacement_data)
            new_compressed_flag = 1 if entry.compressed else 0
            payload.extend(encoded)
            data_replacement_counts[replacement_key] += 1
        else:
            encoded = original[base + entry.offset:base + entry.offset + entry.compressed_size]
            new_compressed_size = entry.compressed_size
            new_uncompressed_size = entry.uncompressed_size
            new_compressed_flag = entry.compressed
            payload.extend(encoded)
        source_cursor = entry.offset + entry.compressed_size
        entry_bytes = TOC_HEAD.pack(
            TOC_HEAD.size + len(entry.name_field), new_offset,
            new_compressed_size, new_uncompressed_size,
            new_compressed_flag, entry.type_code,
        ) + entry.name_field
        toc.extend(entry_bytes)

    if replacement_count != 1:
        raise ValueError(f"Expected one {SCRIPT_NAME} script entry, found {replacement_count}")
    if new_icon is not None and icon_replacement_count != 1:
        raise ValueError(f"Expected one app_icon.ico entry, found {icon_replacement_count}")
    if source_cursor < old_toc_offset:
        payload.extend(original[base + source_cursor:base + old_toc_offset])

    # Add data files that did not exist in the base archive (new brand assets).
    for name, data in data_replacements.items():
        if data_replacement_counts.get(name, 0):
            continue
        encoded = zlib.compress(data, 9)
        new_offset = len(payload)
        payload.extend(encoded)
        # PyInstaller stores resource names with backslashes on Windows.
        entry_name = name.replace("/", "\\")
        name_field = entry_name.encode("utf-8") + b"\0"
        toc.extend(TOC_HEAD.pack(TOC_HEAD.size + len(name_field), new_offset,
            len(encoded), len(data), 1, ord("x")) + name_field)
        data_replacement_counts[name] = 1
    for name, count in data_replacement_counts.items():
        if count < 1:
            raise ValueError(f"Expected one {name} entry, found {count}")

    toc_offset = len(payload)
    package_length = len(payload) + len(toc) + COOKIE.size
    cookie = COOKIE.pack(MAGIC, package_length, toc_offset, len(toc), py_version, python_dll)
    return prefix + bytes(payload) + bytes(toc) + cookie


def main() -> int:
    if len(sys.argv) not in (5, 6):
        print("Usage: python build_ui_redesign.py <original.exe> <raw-module> <ui-replacement.py> <output.exe> [app-icon.ico]", file=sys.stderr)
        return 2
    executable_path, raw_path, replacement_path, output_path = map(Path, sys.argv[1:5])
    original = executable_path.read_bytes()
    raw_module = raw_path.read_bytes()
    replacement_source = replacement_path.read_text(encoding="utf-8")
    patched_module = patch_module(raw_module, replacement_source)
    icon_path = Path(sys.argv[5]) if len(sys.argv) == 6 else None
    new_icon = icon_path.read_bytes() if icon_path else None
    output = rebuild_executable(original, patched_module, new_icon)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_bytes(output)
    print(f"patched module: {len(raw_module):,} -> {len(patched_module):,} bytes")
    print(f"output: {output_path} ({len(output):,} bytes)")
    if icon_path:
        print(f"app icon replaced from: {icon_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
