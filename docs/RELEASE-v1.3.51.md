# TBH助手 v1.3.51 · 一键部署环境校验

一键部署完成文件复制后，逐个检查以下内容是否存在，并与随包文件逐字节一致：

- `winhttp.dll`
- `BepInEx/core/BepInEx.Unity.IL2CPP.dll`
- `dotnet/coreclr.dll`
- `BepInEx/plugins/TBHPlugin.dll`
- `doorstop_config.ini`

另外解析 Doorstop 配置并检查 `[General] target_assembly` 指向 `BepInEx\\core\\BepInEx.Unity.IL2CPP.dll`，`[Il2Cpp] coreclr_path` 指向 `dotnet\\coreclr.dll`。日志逐项记录通过状态；缺失或不匹配时部署报错并指出具体路径或配置键。

本地 x64 测试包已编译并通过包结构审计。没有修改运行中的游戏目录，也没有上传 GitHub；按既有发布流程等待用户测试确认。
