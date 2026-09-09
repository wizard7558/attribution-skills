# Publication confidentiality checks

Run the scanner from the intended Git checkout. Python 3 is required. It reads file bytes without modifying files, staging changes, contacting services, or publishing anything.

```sh
python3 scripts/test-confidential.py
bash scripts/check-confidential.sh
bash scripts/check-confidential.sh --worktree
```

The default enumerates `git ls-files --cached -z` and scans the **current worktree bytes** of tracked paths, including staged additions and unstaged edits. It does not scan index blob contents: a safe staged version with an unsafe worktree version fails; an unsafe staged version with a safe worktree version passes. Consequently, review the final staged diff separately before publication. Deleted tracked files, unreadable files, symlinks, Git errors, and invalid scanner configuration fail closed.

`--worktree` enumerates `git ls-files --cached --others --exclude-standard -z`, deduplicates paths, and includes nonignored untracked files. Ignored untracked files remain excluded. Already tracked ignored files remain included. Neither scope establishes that ignored files or external packaging outputs are safe. A default pass alone is not a completed publication gate while intended new files remain untracked. Stage the reviewed intended publication files, repeat both scans against that intended checkout, review the final staged diff, and confirm the packaged tree corresponds to that review. This guide does not authorize staging or publication.

All selected regular-file bytes and filenames are checked, including the scanner, its tests, and its allowlist. Filename parsing is NUL-safe. Checks cover numeric GA4 dataset identifiers, the existing internal project literal, email tokens, concrete user-home and macOS private temporary paths, and optional private literal terms. Generic `/path/to/file` placeholders and `$HOME` variables remain valid. Findings show only category, escaped relative filename and line number. A filename that itself matches a detector is replaced by a stable SHA-256 identifier. Matched values, matching lines, and private terms are never printed. Repeated findings of the same category on one line are coalesced.

The existing optional local private denylist location is retained. An explicit isolated file can be selected without changing environment home variables:

```sh
bash scripts/check-confidential.sh --denylist /path/to/private-terms.txt
```

A missing explicit denylist or an unreadable existing default denylist is an error. An absent optional default denylist is permitted. Nonempty lines are literal case-insensitive byte matches, including punctuation; they are never treated as regular expressions. Tests use only a disposable explicit synthetic denylist and never access the real one.

Email matching evaluates every token independently. Only the exact reserved hosts `example.com`, `example.org`, `example.net`, `example.test`, and `example.invalid` are generically permitted, case-insensitively. Lookalike suffixes and other hosts under an invalid/testing top-level domain are not exceptions. Other permitted tokens are explicitly listed in `scripts/confidential-email-allowlist.json` with synthetic provenance and finite exact relative file paths. Token comparison is case-insensitive; no whole Gmail domain or line is allowed. The two reviewed malformed example tokens are permitted only in their original key fixtures and the allowlist itself. Each exception requires review of its complete token and exact source paths. The allowlist is itself scanned; inserting an unrelated address in its prose does not exempt it.

The disposable Git regression suite invokes the Bash entrypoint and exercises mixed email lines, unusual filenames, exact exceptions, index/worktree divergence, untracked/ignored behavior, file failures, private diagnostic redaction, and scanning of scanner/test/configuration files. CI runs these tests before its tracked-worktree scan, and the offline repository runner includes the regression suite. These concrete detectors reduce publication risk; they are not a claim to recognize every possible secret or private record.

## Reviewed public text and provenance derivatives

The allowlist configuration also has `public_text_exceptions`: finite exact tokens, exact relative paths, and public-source provenance. The single approved author product-brand token is allowed only in `README.md` and in the allowlist configuration that records that exception. Its source is the publicly verified repository README blob [`a9f342e1b5534ffc6955f3c9cbaa45c3eb5a018a`](https://api.github.com/repos/wizard7558/attribution-skills/git/blobs/a9f342e1b5534ffc6955f3c9cbaa45c3eb5a018a). This preserves already-public author branding; it does not exempt either file from scanning.

A public text exception applies only to a private-denylist term exactly equal to the approved token, case-insensitively, at an occurrence without adjacent ASCII letters, digits, or underscores. Other terms on the same line remain findings. Longer tokens, prefix matches, other paths, and filename matches are not exempt. Other detector categories are unaffected. Duplicate keys, duplicate tokens, wildcard paths, invalid configuration fields, and malformed exceptions fail closed. The additional attribution-audit fixture path is authorized only for the already-reviewed synthetic provider alias that its independent fixture derivation copies.

The funnel `eval-v2-provenance.json` is explicitly a public derivative. Its `public_redaction` metadata identifies the original SHA-256, the exclusive private archive basename, and every changed JSON pointer. The script's private absolute path becomes its basename; concrete repository and private evidence-directory prefixes within the operational log become `[repository]/` and `[private-evidence]/`. Remaining log text, artifact identities, scores, and request/result hashes are preserved. The byte-exact original is retained privately. This publication cleanup neither changes evaluated model context nor claims a new model or native execution.
