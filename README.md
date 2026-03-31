# OICQ

[简体中文](./README.zh-CN.md) | English

> OfCourse I Code the Quintessence

OICQ is a joke-first wrapper around `claude` and `codex`.

In default mode, it makes the user hand-write exactly one very small function, then lets everyone keep a straight face about how the core part was, of course, written by hand.

![OICQ screenshot](./20260331-175753.jpg)

## Downloads

- macOS (Apple Silicon): [oicq-mac-arm64.zip](https://github.com/Ninokunii/OICQ/releases/download/v1.0.0/oicq-mac-arm64.zip)
- Windows (x64): [oicq-win-x64.zip](https://github.com/Ninokunii/OICQ/releases/download/v1.0.0/oicq-win-x64.zip)
- All releases: [GitHub Releases](https://github.com/Ninokunii/OICQ/releases)

## What It Does

- Launches the real `claude` or `codex` CLI in your current workflow.
- Forces one user-written handoff for each code-changing request.
- Keeps the default mode intentionally comedic: the user gets a tiny function, but the handoff is presented like an important implementation point.
- Supports a `--real` mode that flips the joke and hands the user a genuinely difficult, repo-central function instead.

## Prerequisites

### For Release Builds

- macOS Apple Silicon or Windows x64
- `claude` or `codex` installed and available in `PATH`

### For Running From Source

- Node.js `>= 20`
- `npm`
- `claude` or `codex` installed and available in `PATH`

## Quick Start

### Using A Release Build

The packaged desktop builds always run in desktop editor mode.

macOS:

```bash
./oicq.app/Contents/MacOS/oicq --provider claude --cwd /absolute/path/to/repo
```

Windows:

```powershell
.\oicq.exe --provider claude --cwd C:\absolute\path\to\repo
```

### Running From Source

```bash
npm install
npm run build
npm link
oicq --provider claude --editor web --cwd /absolute/path/to/repo
```

## Usage

```bash
oicq [--provider claude|codex] [--editor desktop|web|tui] [--cwd PATH] [-real|--real] [--extra-prompt TEXT] [-- PROVIDER_ARGS...]
oicq launch [--provider claude|codex] [--editor desktop|web|tui] [--cwd PATH] [-real|--real] [--extra-prompt TEXT] [-- PROVIDER_ARGS...]
oicq editor --session-dir PATH
oicq web-editor --session-dir PATH
oicq mcp-server --session-dir PATH
```

Examples:

```bash
oicq --provider claude --editor web --cwd /absolute/path/to/repo
oicq --provider codex --editor tui --cwd /absolute/path/to/repo
oicq --provider claude --editor desktop --cwd /absolute/path/to/repo -- --dangerously-skip-permissions
oicq --provider codex --editor web --cwd /absolute/path/to/repo --real
```

## Real Mode

Default mode is the joke:

- the user hand-writes one very small function
- the handoff is framed as if it were an important implementation point

`--real` changes that behavior:

- the user hand-writes a genuinely difficult, repo-central function
- the tool stops shielding the user behind a tiny ceremonial helper

## How It Works

1. OICQ creates a session under `.oicq-runtime/`.
2. It wires an MCP server into `claude` or `codex`.
3. The agent completes everything except one locked user handoff.
4. The editor waits for that handoff, writes the user change back to disk, and returns the diff to the agent.

## Building Releases

```bash
npm install
npm run release:mac
npm run release:win
```

Artifacts are generated into `./release/`.

## Notes

- The current desktop release builds are unsigned. macOS and Windows may show first-launch security warnings.
- The macOS build is ad-hoc signed and not notarized.
