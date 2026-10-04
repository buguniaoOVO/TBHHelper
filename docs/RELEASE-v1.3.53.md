# TBH助手 v1.3.53 · 接口端口显示与外部部署诊断

## 对“外部电脑无法连接”的核对

- v1.3.47 发行 ZIP 的 BepInExPackage 与官方 `BepInEx-Unity.IL2CPP-win-x64-6.0.0-be.785.zip` 文件清单和内容逐项一致，包含 `winhttp.dll`、`doorstop_config.ini`、`dotnet/coreclr.dll` 和 BepInEx core。打包时不是从本机游戏目录复制 BepInEx 环境。
- BepInEx IL2CPP 首次运行会为目标游戏生成本机配置、日志和 interop 数据；发行包不预置某个玩家的 interop。助手部署会保留目标电脑生成的 interop，之后必须从 Steam 启动游戏完成初始化。
- TBHPlugin.dll 是针对发布时 TaskBarHero 游戏接口构建。若玩家安装的游戏版本或 interop 接口不同，插件加载也可能失败；BepInEx/LogOutput.log 会包含加载错误。
- 助手与插件两端地址都是 `127.0.0.1:19090`。这代表各自在本机通信，不需要玩家主机单独配置不同端口。此机当前端口 19090 正在监听，助手连接正常。
- 外部玩家的 `Connection refused` 表示连接时本机端口没有 API 监听，不能证明端口号需要适配。常见原因包括：部署后没有重启游戏、BepInEx/插件未加载、HTTP.sys URL ACL 拒绝注册，或端口/URL 前缀冲突。仅凭助手侧截图无法确定是哪一种。

## 改动

- 概览和设置页显示接口 `127.0.0.1:19090`；连接失败日志也显示访问端点。
- 插件监听启动失败时，`BepInEx/LogOutput.log` 记录 URL、Windows 错误码和权限/端口冲突提示。
- 发布审计现在将完整 BepInExPackage 与官方来源 ZIP 逐文件对照，缺文件或内容不同都会阻断打包。

## 测试包

助手 v1.3.53 x64、插件 v1.3.45。编译和发布包审计通过。未更改运行中的游戏，也未上传 GitHub，等待测试确认后发布。
