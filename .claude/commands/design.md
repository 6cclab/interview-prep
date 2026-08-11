Read `prompts/design.md` and follow it exactly.

Where a prompt says `{{candidate}}`, it means the `candidate_name` value in `local/config.yaml`, falling back to "the candidate" when that file or key is absent.

The prompts live outside `.claude/` because the voice server reads the same
files at runtime and because this repo is not Claude Code-specific. This file
is a pointer so the slash command keeps working; the content is there.
