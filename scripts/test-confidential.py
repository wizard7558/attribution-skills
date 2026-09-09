#!/usr/bin/env python3
"""Disposable Git black-box regressions; never use the caller's private denylist."""
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
FILES = ['check-confidential.sh', 'check-confidential.py', 'confidential-email-allowlist.json']
BAD = 'not-a-fixture' + '@' + 'mail.invalid'
SAFE = 'safe@example.com'
ALIAS = 'test.user+tag' + '@' + 'gmail.com'
checks = 0


def check(condition, label):
    global checks
    checks += 1
    if not condition:
        raise AssertionError(label)


def command(args, cwd):
    return subprocess.run(args, cwd=cwd, capture_output=True, text=True)


with tempfile.TemporaryDirectory(prefix='confidential-regression-') as temporary:
    base = Path(temporary)
    deny = base / 'isolated-denylist.txt'
    deny.write_text('')
    repo = base / 'repo'
    repo.mkdir()
    command(['git', 'init', '-q'], repo)
    (repo / 'scripts').mkdir()
    for filename in FILES:
        shutil.copyfile(ROOT / 'scripts' / filename, repo / 'scripts' / filename)
    command(['git', 'add', '.'], repo)

    def scan(*flags, expected=0):
        result = command(['bash', 'scripts/check-confidential.sh', '--denylist', str(deny), *flags], repo)
        check(result.returncode == expected, 'scanner exit: ' + str(result.returncode) + ', expected ' + str(expected))
        check(BAD not in result.stdout + result.stderr, 'no confidential email in diagnostic')
        return result

    def put(name, body, tracked=True):
        path = repo / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(body)
        if tracked:
            command(['git', 'add', '--', name], repo)
        return path

    def remove(name):
        command(['git', 'rm', '--cached', '-f', '--', name], repo)
        path = repo / name
        if path.exists() or path.is_symlink():
            path.unlink()

    scan()
    for body in [SAFE + ' ' + BAD, BAD + ' ' + SAFE, SAFE + ' ' + BAD + ' second' + '@' + 'mail.invalid']:
        put('mixed.txt', body)
        scan(expected=1)
    remove('mixed.txt')
    for name in ['file with spaces.txt', 'file\ttab.txt', 'file\nnewline.txt', '-leading.txt', 'unicode-雪.txt']:
        put(name, BAD)
        scan(expected=1)
        remove(name)
    for host in ['example.com', 'EXAMPLE.ORG', 'example.net', 'example.test', 'example.invalid']:
        put('hosts.txt', 'safe@' + host)
        scan()
    for host in ['example.com.evil', 'notexample.com', 'other.invalid']:
        put('hosts.txt', 'safe@' + host)
        scan(expected=1)
    remove('hosts.txt')
    allowed = 'skills/capi-match-keys/references/payload-fixtures.json'
    put(allowed, ALIAS)
    scan()
    put(allowed, ALIAS.upper())
    scan()
    for token in ['longer.' + ALIAS, 'other' + '@' + 'gmail.com', ALIAS + '.evil']:
        put(allowed, token)
        scan(expected=1)
    remove(allowed)
    put('wrong-path.txt', ALIAS)
    scan(expected=1)
    remove('wrong-path.txt')
    malformed = 'a' + '@' + '.example.com'
    put('skills/capi-match-keys/references/key-fixtures.json', malformed)
    scan()
    remove('skills/capi-match-keys/references/key-fixtures.json')
    put('malformed.txt', malformed)
    scan(expected=1)
    remove('malformed.txt')
    path = put('divergence.txt', SAFE)
    path.write_text(BAD)
    scan(expected=1)
    command(['git', 'add', 'divergence.txt'], repo)
    path.write_text(SAFE)
    scan()
    remove('divergence.txt')
    put('untracked.txt', BAD, tracked=False)
    scan()
    scan('--worktree', expected=1)
    remove('untracked.txt')
    put('.gitignore', 'ignored.txt\n')
    put('ignored.txt', BAD, tracked=False)
    scan('--worktree')
    command(['git', 'add', '-f', 'ignored.txt'], repo)
    scan(expected=1)
    remove('ignored.txt')
    path = put('deleted.txt', SAFE)
    path.unlink()
    scan(expected=1)
    remove('deleted.txt')
    path = put('unreadable.txt', SAFE)
    path.chmod(0)
    scan(expected=1)
    path.chmod(0o600)
    remove('unreadable.txt')
    outside = base / 'outside.txt'
    outside.write_text(SAFE)
    (repo / 'link').symlink_to(outside)
    command(['git', 'add', 'link'], repo)
    scan(expected=1)
    remove('link')
    term = 'fixture-private' + '[.]' + 'literal'
    deny.write_text(term + '\n')
    put('deny.txt', term.upper())
    result = scan(expected=1)
    check(term.lower() not in (result.stdout + result.stderr).lower(), 'private literal redacted')
    put('deny.txt', 'fixture-privateXliteral')
    scan()
    remove('deny.txt')
    put(term + '.txt', SAFE)
    result = scan(expected=1)
    check('redacted-path-sha256' in result.stdout and term not in result.stdout, 'private filename redacted')
    remove(term + '.txt')
    # Only this public author-brand term and its exact approved paths may bypass a denylist hit.
    brand = 'Bella' + 'so'
    private = 'unapproved-' + 'fixture-term'
    deny.write_text(brand.lower() + '\n' + private + '\n')
    for spelling in [brand, brand.upper(), '(' + brand + ')']:
        put('README.md', spelling)
        scan()
    for text in [brand + ' ' + private, private + ' ' + brand, brand + 'Extra', 'prefix' + brand, brand + '_', brand + '7']:
        put('README.md', text)
        result = scan(expected=1)
        check(private not in result.stdout and brand not in result.stdout, 'public exception does not leak other terms')
    remove('README.md')
    for path in ['docs/README.md', 'README.md.extra', 'scripts/confidential-email-allowlist.json.extra']:
        put(path, brand)
        scan(expected=1)
        remove(path)
    # A shorter or longer denylist term is never covered by the approved exact token.
    for other in [brand[:-1], brand + 'Extra']:
        deny.write_text(other + '\n')
        put('README.md', brand + 'Extra')
        scan(expected=1)
    remove('README.md')
    deny.write_text(brand + '\n' + private + '\n')
    config_path = repo / 'scripts/confidential-email-allowlist.json'
    original_config = config_path.read_bytes()
    config = json.loads(original_config)
    config['public_text_exceptions'][0]['provenance'] += ' ' + private
    config_path.write_text(json.dumps(config))
    scan(expected=1)
    for invalid in [
        {'token': brand, 'paths': ['README*'], 'provenance': 'test'},
        {'token': brand + ' extra', 'paths': ['README.md'], 'provenance': 'test'},
        {'token': brand, 'paths': ['README.md'], 'provenance': ''},
        {'token': brand, 'paths': ['README.md'], 'provenance': 'test', 'extra': True},
    ]:
        config = json.loads(original_config)
        config['public_text_exceptions'] = [invalid]
        config_path.write_text(json.dumps(config))
        scan(expected=2)
    config = json.loads(original_config)
    config['public_text_exceptions'] *= 2
    config_path.write_text(json.dumps(config))
    scan(expected=2)
    config_path.write_bytes(original_config)
    scan()
    put('skills/attribution-audit/references/execution-fixtures.json', ALIAS)
    scan()
    put('skills/attribution-audit/references/execution-fixtures.json', 'other' + '@' + 'gmail.com')
    scan(expected=1)
    remove('skills/attribution-audit/references/execution-fixtures.json')
    deny.write_text('')
    put(BAD + '.txt', SAFE)
    result = scan(expected=1)
    check('redacted-path-sha256' in result.stdout, 'email filename redacted')
    remove(BAD + '.txt')
    spec = importlib.util.spec_from_file_location('scanner', ROOT / 'scripts/check-confidential.py')
    scanner = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(scanner)
    categories = [
        ('ga4_dataset', 'analytics_' + '123456'),
        ('internal_project', scanner.INTERNAL_PROJECT),
        ('private_home_path', '/' + 'Users/' + 'fixture-person/record'),
        ('private_home_path', '/' + 'home/' + 'fixture-person/record'),
        ('private_temp_path', '/' + 'var/' + 'folders/fixture/file'),
    ]
    for category, body in categories:
        put('category.txt', body)
        result = scan(expected=1)
        check(category in result.stdout and body not in result.stdout + result.stderr, 'category without value')
    remove('category.txt')
    put('placeholders.txt', '/path/to/file $HOME/records ${HOME}/records')
    scan()
    remove('placeholders.txt')
    for filename in ['scripts/check-confidential.sh', 'scripts/check-confidential.py', 'scripts/test-confidential.py']:
        original = (repo / filename).read_bytes() if (repo / filename).exists() else None
        put(filename, BAD)
        # Use an independent entrypoint copy when intentionally replacing the scanner itself.
        if filename in ['scripts/check-confidential.sh', 'scripts/check-confidential.py']:
            tools = base / 'entry'
            tools.mkdir(exist_ok=True)
            for f in FILES[:2]:
                shutil.copyfile(ROOT / 'scripts' / f, tools / f)
            result = command(['bash', str(tools / FILES[0]), '--denylist', str(deny)], repo)
            check(result.returncode == 1, 'scanner files are scanned')
        else:
            scan(expected=1)
        if original is None:
            remove(filename)
        else:
            (repo / filename).write_bytes(original)
    allowpath = repo / 'scripts/confidential-email-allowlist.json'
    original = allowpath.read_bytes()
    config = json.loads(original)
    config['entries'][0]['provenance'] += ' ' + BAD
    allowpath.write_text(json.dumps(config))
    scan(expected=1)
    for invalid in [{'version': True, 'entries': []}, {}, {'version': 1, 'entries': [{'token': SAFE, 'paths': ['../escape'], 'provenance': 'test'}]}, {'version': 1, 'entries': [False]}]:
        allowpath.write_text(json.dumps(invalid))
        scan(expected=2)
    allowpath.write_text('{"version":1,"version":1,"entries":[]}')
    scan(expected=2)
    allowpath.write_bytes(original)
    deny.unlink()
    scan(expected=2)
    deny.write_text('')
    scan()
    # Copy the actual test source too: no scanner/test exclusions are necessary.
    shutil.copyfile(Path(__file__), repo / 'scripts/test-confidential.py')
    command(['git', 'add', '.'], repo)
    scan('--worktree')
    result = command(['bash', str(ROOT / 'scripts/check-confidential.sh'), '--denylist', str(deny)], base)
    check(result.returncode == 2, 'non-Git invocation fails closed')

print(json.dumps({'status': 'passed', 'assertions': checks, 'disposable_repositories_removed': True, 'source_sha256': {name: hashlib.sha256((ROOT / 'scripts' / name).read_bytes()).hexdigest() for name in FILES}}, indent=2))
