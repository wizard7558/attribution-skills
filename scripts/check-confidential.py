#!/usr/bin/env python3
"""Scan Git-selected worktree bytes without disclosing matched values."""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import subprocess
import sys

INTERNAL_PROJECT = 'res-an' + 'alytics'
DEFAULT_DENYLIST_SUFFIX = '.config/attribution-skills/denylist.txt'
EMAIL = re.compile(rb"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
RESERVED = {b"example.com", b"example.org", b"example.net", b"example.test", b"example.invalid"}
PATTERNS = (
    ("ga4_dataset", re.compile(rb"analytics_[0-9]{6,}")),
    ("internal_project", re.compile(re.escape(INTERNAL_PROJECT.encode()))),
    ("private_home_path", re.compile(rb"/(?:Users|home)/[^/\s\x00]+/")),
    ("private_temp_path", re.compile(rb"/var/" + rb"folders/[^\s\x00]*")),
)
ALLOWLIST_PATH = "scripts/confidential-email-allowlist.json"

class ScanError(Exception):
    pass


def checked_read(path):
    # lstat each component: neither file nor directory symlinks may escape the tree.
    for component in [path, *path.parents]:
        if component.is_symlink():
            raise ScanError("symlink")
    info = path.stat()
    if not stat.S_ISREG(info.st_mode) or not info.st_mode & 0o444:
        raise ScanError("unreadable_file")
    return path.read_bytes()


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError()
        result[key] = value
    return result


def load_allowlist(root):
    try:
        data = json.loads(checked_read(root / ALLOWLIST_PATH), object_pairs_hook=unique_object)
        if not isinstance(data, dict) or set(data) != {"version", "entries", "public_text_exceptions"} or type(data["version"]) is not int or data["version"] != 1:
            raise ValueError()
        groups = []
        for key in ("entries", "public_text_exceptions"):
            entries = data[key]
            if not isinstance(entries, list):
                raise ValueError()
            result = {}
            for entry in entries:
                if not isinstance(entry, dict) or set(entry) != {"token", "paths", "provenance"}:
                    raise ValueError()
                token, paths, provenance = entry["token"], entry["paths"], entry["provenance"]
                if not isinstance(token, str) or not token.isascii() or not token:
                    raise ValueError()
                if key == "entries" and (EMAIL.fullmatch(token.encode()) is None or token != token.lower()):
                    raise ValueError()
                if key == "public_text_exceptions" and re.fullmatch(r"[A-Za-z][A-Za-z0-9_]*", token) is None:
                    raise ValueError()
                normalized = token.lower().encode()
                if normalized in result:
                    raise ValueError()
                if not isinstance(provenance, str) or not provenance.strip() or not isinstance(paths, list) or not paths or len(set(paths)) != len(paths):
                    raise ValueError()
                for path in paths:
                    if not isinstance(path, str) or not path or PurePosixPath(path).is_absolute() or any(p in (".", "..", "") for p in path.split("/")) or "\\" in path or any(c in path for c in "*?[]\x00\n\r"):
                        raise ValueError()
                result[normalized] = set(paths)
            groups.append(result)
        return tuple(groups)
    except (OSError, ValueError, TypeError, ScanError):
        raise ScanError("invalid_allowlist") from None


def findings(data, relative, allowlist, denylist, public_text_exceptions=None):
    for category, pattern in PATTERNS:
        for match in pattern.finditer(data):
            yield category, data.count(b"\n", 0, match.start()) + 1
    for match in EMAIL.finditer(data):
        token = match.group().lower()
        if token.rsplit(b"@", 1)[1] not in RESERVED and relative not in allowlist.get(token, set()):
            yield "email", data.count(b"\n", 0, match.start()) + 1
    lower = data.lower()
    for term in denylist:
        start = 0
        while (position := lower.find(term, start)) >= 0:
            end = position + len(term)
            approved_path = relative in (public_text_exceptions or {}).get(term, set())
            adjacent = lower[max(0, position - 1):position] + lower[end:end + 1]
            whole_word = re.search(rb"[a-z0-9_]", adjacent) is None
            if not (approved_path and whole_word):
                yield "private_denylist", data.count(b"\n", 0, position) + 1
            start = end


def safe_path(relative, denylist):
    raw = os.fsencode(relative)
    # Paths get no email exceptions, including fixture tokens.
    if list(findings(raw, "", {}, denylist)):
        return "[redacted-path-sha256:" + hashlib.sha256(raw).hexdigest() + "]"
    return json.dumps(relative, ensure_ascii=True)


def git(args):
    try:
        result = subprocess.run(["git", *args], stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
    except OSError:
        raise ScanError("git_error") from None
    if result.returncode:
        raise ScanError("git_error")
    return result.stdout


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--worktree", action="store_true", help="also scan nonignored untracked files")
    parser.add_argument("--denylist", type=Path, help="explicit private literal denylist; missing explicit files fail")
    args = parser.parse_args(argv)
    try:
        if args.denylist is not None:
            args.denylist = args.denylist.resolve()
        root = Path(os.fsdecode(git(["rev-parse", "--show-toplevel"]).rstrip(b"\n"))).resolve()
        os.chdir(root)
        deny_path = args.denylist
        explicit = deny_path is not None
        if deny_path is None:
            deny_path = Path.home() / DEFAULT_DENYLIST_SUFFIX
        denylist = []
        if explicit or deny_path.exists():
            try:
                denylist = [line.lower() for line in deny_path.read_bytes().splitlines() if line]
            except OSError:
                raise ScanError("denylist_read_error") from None
        allowlist, public_text_exceptions = load_allowlist(root)
        selection = ["ls-files", "--cached"]
        if args.worktree:
            selection += ["--others", "--exclude-standard"]
        paths = sorted(set(os.fsdecode(p) for p in git([*selection, "-z"]).split(b"\x00") if p))
        count = 0
        for relative in paths:
            label = safe_path(relative, denylist)
            # Also inspect filenames: a secret in a filename is still published data.
            issues = list(findings(os.fsencode(relative), "", {}, denylist))
            try:
                data = checked_read(root / relative)
                issues += list(findings(data, relative, allowlist, denylist, public_text_exceptions))
            except (OSError, ScanError) as exc:
                issues += [(str(exc) if isinstance(exc, ScanError) else "file_read_error", 0)]
            for category, line in sorted(set(issues)):
                count += 1
                print(f"{category}: {label}: line {line}")
        print(f"Confidentiality scan: {len(paths)} files, {count} findings, scope={'worktree' if args.worktree else 'tracked-worktree'}")
        return 1 if count else 0
    except ScanError as exc:
        print(f"Confidentiality scan error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
