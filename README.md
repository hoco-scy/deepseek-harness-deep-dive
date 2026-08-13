# DeepSeek Harness: A Systems Dissection

[English](#english) · [中文](#中文)

<a id="english"></a>

## English

This repository is an independent, evidence-driven, module-by-module source study of [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

**Read the live report:** [English (default)](https://hoco-scy.github.io/dpsk-harness-analysis/) · [中文](https://hoco-scy.github.io/dpsk-harness-analysis/zh/)

The study is pinned to upstream commit [`47f943859bef60e4160492346772ded9b24f765a`](https://github.com/deepseek-ai/deepseek-harness/tree/47f943859bef60e4160492346772ded9b24f765a). DeepSeek Harness is still in Developer Preview, so later upstream changes will never silently rewrite the factual baseline of this report.

### Scope

The report covers design philosophy, the Cordis plugin model, boot and composition, the Agent lifecycle, prompt and context assembly, LLM adapters, the session event model, persistence and databases, projections and checkpoints, compaction and memory, plans/goals/todos, tool primitives and the complete tool catalog, parallel execution, permissions and approval, sandboxes, shell/terminal/jobs, Skill/MCP/LSP/Web capabilities, Code Mode, self-modification, multi-Agent orchestration, workflows, retry and recovery, logs/observability/replay, API/SDK/ACP, the Web UI, security, and runtime invariants.

Every chapter distinguishes three kinds of claims:

- **Source fact:** directly demonstrated by code, configuration, tests, or official documentation at the pinned commit.
- **Mechanism-level deduction:** a control-flow or semantic conclusion assembled from multiple source facts.
- **Design assessment:** the author's judgment about tradeoffs, strengths, costs, and operating boundaries.

The generated site is bilingual. English is the default at `/`; every page has a same-chapter switch to the Chinese edition under `/zh/`.

### Local preview

```bash
npm run build
npm run check
python3 -m http.server 8080 --directory docs
```

Open `http://127.0.0.1:8080/` for English or `http://127.0.0.1:8080/zh/` for Chinese. The site is fully static. “My Learning Notes” is saved only to this browser's `localStorage`; it is never committed or sent to a server.

### Research status

This is a staged, continuously published study. The home page shows the live status of every chapter. A `Queued` chapter is part of the research map, not a completed conclusion. Only chapters marked `Verified` have passed the source-level review gate described in the methodology.

### Boundary

This public repository contains only an independent analysis of publicly available DeepSeek Harness source. It contains no private implementation details, private architectural comparisons, or internal conclusions from any other project.

---

<a id="中文"></a>

## 中文

本仓库是对 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的独立、证据驱动、逐模块源码研究。

**在线阅读：**[English（默认）](https://hoco-scy.github.io/dpsk-harness-analysis/) · [中文](https://hoco-scy.github.io/dpsk-harness-analysis/zh/)

研究固定在上游 commit [`47f943859bef60e4160492346772ded9b24f765a`](https://github.com/deepseek-ai/deepseek-harness/tree/47f943859bef60e4160492346772ded9b24f765a)。DeepSeek Harness 尚处于 Developer Preview，后续上游变化不会静默改写本报告中的事实基线。

### 研究范围

报告覆盖：设计哲学、Cordis 插件模型、启动与组合、Agent 生命周期、提示词与上下文、LLM 适配、会话事件模型、持久化与数据库、投影与 checkpoint、压缩与记忆、计划/目标/Todo、工具原语与工具全集、并行执行、权限与审批、沙箱、Shell/终端/作业、Skill/MCP/LSP/Web、Code Mode、自修改、多 Agent、工作流、重试与恢复、日志/可观测/重放、API/SDK/ACP、Web UI、安全与运行时不变量。

每篇正文严格区分：

- **源码事实：**可由固定 commit 下的代码、配置、测试或官方文档直接证明。
- **机制推导：**由多处事实串成的控制流或语义结论。
- **设计评价：**作者对取舍、优势、代价和适用边界的判断。

生成站点提供完整双语版本。根路径默认显示英文；每一页都可以切换到 `/zh/` 下相同章节的中文版本。

### 本地查看

```bash
npm run build
npm run check
python3 -m http.server 8080 --directory docs
```

英文版打开 `http://127.0.0.1:8080/`，中文版打开 `http://127.0.0.1:8080/zh/`。站点是纯静态文件；每页的“我的学习体会”只保存在当前浏览器的 `localStorage`，不会提交到仓库或发送到服务器。

### 研究状态

这是持续分阶段发布的研究。网页首页展示各章节的实时状态；`待研究` 章节只是研究清单，不代表结论已经完成。只有标记为 `已复核` 的章节才经过方法论规定的源码复核门槛。

### 边界

本公开仓库只包含基于公开源码的 DeepSeek Harness 独立拆解，不包含任何其他项目的非公开实现、架构对比或内部结论。
