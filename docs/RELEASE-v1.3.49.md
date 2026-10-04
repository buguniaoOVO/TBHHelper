# TBH助手 v1.3.49 · 完整清理游戏插件环境

## 本地测试包内容

- 设置页的“停用本插件”改为“清除完整环境”。
- 清理前会提示：游戏目录中的完整 BepInEx 环境会被移除，包括其他 BepInEx 插件、配置和生成文件。
- 清理时先将 `BepInExPackage` 对应的游戏目录内容整体移入 `TBH-Backups/removed-environment-时间戳`，再从游戏目录移除。失败时会尝试回滚已移动项目。
- 清理前要求 TaskBarHero 已退出，并自动停止助手的自动任务。

## 架构支持

本包仍为 Windows x64。Steam 对 TaskBarHero 标注的系统要求是 Windows 10/11 64 位；本机游戏可执行文件也是 PE x64。BepInEx IL2CPP 的官方安装文档要求按游戏可执行文件选择 x86 或 x64 版本。因此，单独将助手、BepInEx 与插件做成 x86，不能加载这个 x64 游戏。此包没有伪装成可用于 32 位 Windows 的版本。

- [TaskBarHero Steam 系统要求](https://store.steampowered.com/app/3678970/TBH_Task_Bar_Hero/)
- [BepInEx IL2CPP 安装说明](https://docs.bepinex.dev/master/articles/user_guide/installation/unity_il2cpp.html)

本版先供本机测试清理流程，验证通过后再发布 GitHub。
