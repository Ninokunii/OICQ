![OICQ 头图](./20260331-1838-generated.jpg)

# OICQ

简体中文 | [English](./README.md)

> OfCourse I Code the Quintessence

OICQ 是一款提倡古法编程的 IDE，在这个 vibe coding 横行的年代，用本 IDE，你能拍着胸脯自信地对领导说：“最核心的部分当然是我手写的！”

![OICQ 截图](./20260331-175753.jpg)

## 下载

- macOS（Apple Silicon）：[oicq-mac-arm64.zip](https://github.com/Ninokunii/OICQ/releases/download/v1.0.0/oicq-mac-arm64.zip)
- Windows（x64）：[oicq-win-x64.zip](https://github.com/Ninokunii/OICQ/releases/download/v1.0.0/oicq-win-x64.zip)
- 所有版本：[GitHub Releases](https://github.com/Ninokunii/OICQ/releases)

## 项目做什么

它在每一次顺滑的 vibe coding 中，都会故意留一个极为困难、AI 无法独立实现的函数交给用户亲自手写。（相信我，真的极为困难）

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

## Real模式

适合想寻求一点点挑战的用户，试试 `--real` 吧。

## 说明

- 当前桌面 release 包没有正式签名，macOS 和 Windows 第一次启动时可能会弹系统安全提示。
- macOS 版本目前是 ad-hoc 签名，没有 notarization。
