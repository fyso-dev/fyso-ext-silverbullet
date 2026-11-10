# SilverBullet extension for Fyso

Shared Markdown knowledge base, a panel editor, per-bot filesystem MCP access,
and AI import of folders or zip files. Published from the framework's verified
SilverBullet extension (D53, D54, D58, D59).

## Install

Requires a generated Fyso project updated to framework commit
`de4ebe14f4aa6837e9a7889d7a298e73263dbb01` or a later release containing D59.
From that project:

```sh
mise run ext:add silverbullet -- --defaults
mise run doctor
```

Or install this release directly:

```sh
mise run ext:add gh:fyso-dev/fyso-ext-silverbullet -- --defaults --vcs-ref v0.1.0
```

Open **Conocimiento / Knowledge** in the panel. The editor and agents share
`project/wiki/`. Enable the `project-knowledge` skill per bot and review/apply
its permissions; installing does not grant bots access automatically.

**Import with AI** accepts files, folders and zip archives through Uppy and
tusd. The project's agent converts them into linked pages and a report. Existing
pages are preserved. Content goes to the project's configured AI provider only
when the person starts the import. Limits: 200 files, 4 MB of text, 1 GB per
uploaded file and 300 generated pages. No OCR. Codex/PDF import and Linux/Windows
runtime acceptance remain unverified.

## Updates and removal

```sh
mise run ext:update silverbullet -- --defaults
mise run doctor
```

For an existing bundled installation, first update the parent framework, then
migrate the extension's source explicitly (review and commit pending project
changes before updating):

```sh
mise run ext:add gh:fyso-dev/fyso-ext-silverbullet -- --defaults --overwrite --vcs-ref v0.1.0
```

This changes the extension answers to the tagged source so subsequent
`ext:update` calls work. Wiki pages live outside the extension payload.
Disable the skill on bots before `mise run ext:remove silverbullet` and restart
the project stack. Wiki and runtime data are retained.

## Panel theme

The embedded editor shares the panel's Gilroy typography, violet accents, neutral
surfaces, borders and light/dark mode. SilverBullet's native `SB_HEAD_HTML` loads
extension-owned assets through authenticated `/.kb/theme/` routes; wiki pages,
CONFIG and custom Space Style are not written or replaced.

Live mode/token updates use origin- and window-checked messages. The matching
framework change adds an opt-in SDK theme channel so changing the panel theme
keeps the editor, selection and upload picker in place. Install the companion
framework change before relying on switching modes without a reload. Plain HTML
extensions keep the existing query-string/reload behavior.

The full-window link opens in the panel's current mode. Subsequent native
SilverBullet theme changes take precedence there. A direct URL without `theme`
uses SilverBullet's own mode preference. Project Space Style remains available
and can override the extension's CSS. Code blocks retain native monospace fonts.

[Browser acceptance and screenshots](docs/evidence/panel-theme/README.md).

## Runtime and security

Pinned tools: SilverBullet 2.12.1, official filesystem MCP 2.2.0, tusd 2.10.1,
Uppy 6.0.7, locales 5.3.2, extract-zip 2.0.1 and pandoc 3.13.
The editor is behind Fyso web login, on loopback; shell, Runtime API, service
worker and SilverBullet revisions are disabled. The MCP is confined to the wiki.
Concurrent edits may race; read before writing. Markdown files are the source of
truth and use the project's existing snapshot and Git policy.

[Full contract and verification](https://github.com/fyso-dev/agentic-framework/blob/main/docs/silverbullet-extension.md).

## Development verification

```sh
node --test tests/import.test.cjs
```

The framework repository holds the real HTTP/MCP and authenticated browser
integration suites and their recorded evidence. No upstream runtime versions
were changed for this release.
