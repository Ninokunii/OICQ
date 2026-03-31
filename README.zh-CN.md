# OICQ

简体中文 | [English](./README.md)

> OfCourse I Code the Quintessence

OICQ 是一个先讲冷笑话、再认真干活的 `claude` / `codex` 包装器。

默认模式下，它会强制用户亲手实现一个很小的函数，然后大家一起一本正经地默认“当然最核心的部分是我手写的”。

![OICQ 截图](./20260331-175753.jpg)

## 下载

- macOS（Apple Silicon）：[oicq-mac-arm64.zip](https://github.com/Ninokunii/OICQ/releases/download/v1.0.0/oicq-mac-arm64.zip)
- Windows（x64）：[oicq-win-x64.zip](https://github.com/Ninokunii/OICQ/releases/download/v1.0.0/oicq-win-x64.zip)
- 所有版本：[GitHub Releases](https://github.com/Ninokunii/OICQ/releases)

## 项目做什么

- 启动真正的 `claude` 或 `codex` CLI，而不是模拟终端。
- 对每一个会改代码的请求，强制插入一次“必须由用户手写”的交接步骤。
- 默认模式保留项目的幽默核心：真正交给用户的是很小的函数，但表达方式会显得这一步很关键。
- 支持 `--real` 模式，把交接改成一个真正困难、而且更接近仓库核心的函数。

## 前置依赖

### 使用 Release 包

- macOS Apple Silicon 或 Windows x64
- 机器上已经安装好 `claude` 或 `codex`，并且它们在 `PATH` 里可直接调用

### 从源码运行

- Node.js `>= 20`
- `npm`
- 机器上已经安装好 `claude` 或 `codex`，并且它们在 `PATH` 里可直接调用

## 快速开始

### 使用 Release 包

打包后的桌面版本固定使用 desktop editor 模式。

macOS：

```bash
./oicq.app/Contents/MacOS/oicq --provider claude --cwd /absolute/path/to/repo
```

Windows：

```powershell
.\oicq.exe --provider claude --cwd C:\absolute\path\to\repo
```

### 从源码运行

```bash
npm install
npm run build
npm link
oicq --provider claude --editor web --cwd /absolute/path/to/repo
```

## 用法

```bash
oicq [--provider claude|codex] [--editor desktop|web|tui] [--cwd PATH] [-real|--real] [--extra-prompt TEXT] [-- PROVIDER_ARGS...]
oicq launch [--provider claude|codex] [--editor desktop|web|tui] [--cwd PATH] [-real|--real] [--extra-prompt TEXT] [-- PROVIDER_ARGS...]
oicq editor --session-dir PATH
oicq web-editor --session-dir PATH
oicq mcp-server --session-dir PATH
```

示例：

```bash
oicq --provider claude --editor web --cwd /absolute/path/to/repo
oicq --provider codex --editor tui --cwd /absolute/path/to/repo
oicq --provider claude --editor desktop --cwd /absolute/path/to/repo -- --dangerously-skip-permissions
oicq --provider codex --editor web --cwd /absolute/path/to/repo --real
```

## Real 模式

默认模式是这个项目的笑点本体：

- 用户手写的是一个很小的函数
- 但整个交接会被表述成一个很重要的实现点

`--real` 会把行为切换过来：

- 用户手写的会变成一个真正困难、而且更核心的函数
- 不再故意把工作拆成一个象征性的“小 helper”交给用户

## 工作方式

1. OICQ 在 `.oicq-runtime/` 下创建会话目录。
2. 它把自己的 MCP server 接到 `claude` 或 `codex` 上。
3. agent 先完成除“用户必须手写”的最后一块之外的所有工作。
4. 编辑器等待这个交接点，用户提交后把改动写回磁盘，并把 diff 返回给 agent。

## 构建 Release

```bash
npm install
npm run release:mac
npm run release:win
```

生成物在 `./release/` 目录下。

## 说明

- 当前桌面 release 包没有正式签名，macOS 和 Windows 第一次启动时可能会弹系统安全提示。
- macOS 版本目前是 ad-hoc 签名，没有 notarization。
