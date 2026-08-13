# DeepSeek Harness 系统拆解

这是对 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的独立、证据驱动、逐模块源码研究。

研究固定在上游 commit [`47f943859bef60e4160492346772ded9b24f765a`](https://github.com/deepseek-ai/deepseek-harness/tree/47f943859bef60e4160492346772ded9b24f765a)。DeepSeek Harness 尚处于 Developer Preview，后续上游变化不会静默改写本报告中的事实基线。

## 研究范围

报告将覆盖：设计哲学、Cordis 插件模型、启动与组合、Agent 生命周期、提示词与上下文、LLM 适配、会话事件模型、持久化与数据库、投影与 checkpoint、压缩与记忆、计划/目标/Todo、工具原语与工具全集、并行执行、权限与审批、沙箱、Shell/终端/作业、Skill/MCP/LSP/Web、Code Mode、自修改、多 Agent、工作流、重试与恢复、日志/可观测/重放、API/SDK/ACP、Web UI、安全与测试不变量。

每篇正文严格区分：

- **源码事实**：可由固定 commit 下的代码、配置、测试或官方文档直接证明；
- **机制推导**：由多处事实串成的控制流或语义结论；
- **设计评价**：作者对取舍、优势、代价和适用边界的判断。

## 本地查看

```bash
npm run build
npm run check
python3 -m http.server 8080 --directory docs
```

打开 `http://127.0.0.1:8080/`。站点是纯静态文件；每页的“我的学习体会”只保存在当前浏览器的 `localStorage`，不会提交到仓库或发送到服务器。

## 研究状态

这是持续分阶段提交的研究。网页首页展示各章节的实时状态；`queued` 章节只是研究清单，不代表结论已经完成。只有标记为 `verified` 的章节才经过逐条源码复核。

## 边界

本仓库只包含公开的 DeepSeek Harness 独立拆解，不包含任何非公开项目的实现、架构对比或内部结论。
