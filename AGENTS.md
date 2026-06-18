# AGENTS.md

本项目默认读取两个层级的协作准则：

1. 全局协作准则：`G:\Xiqiuqiu_space\All_Projects\week-review\docs\codex-experience-playbook.md`
2. 本项目经验包：`G:\Xiqiuqiu_space\All_Projects\KatelyaTVLocal\docs\codex-project-playbook.md`

后续 Codex 会话开始处理本项目任务前，应先读取全局准则，再读取本项目经验包。全局准则只提供跨项目协作底线；播放器、搜索、Cloudflare/D1、线路测速、AI 找片、播放历史等项目专属规则，以本项目经验包为准。

如果这些文档和用户当前明确指令冲突，以用户当前指令为准。

## Agent skills

### Issue tracker

Issues live in GitHub Issues for `xiqiuqiu/KatelyaTVLocal`. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the default Matt Pocock skills triage labels. See `docs/agents/triage-labels.md`.

### Domain docs

This repo uses a single-context domain docs layout: `CONTEXT.md` and `docs/adr/`. See `docs/agents/domain.md`.
