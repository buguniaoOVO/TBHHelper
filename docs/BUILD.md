# 构建范围

## 当前直连版

v1.3.81 是 Python 3.14 与 Frida 直连维护版。maintenance/direct-connect 保存本次维护的界面、连接脚本和归档补丁工具，补丁构建需要对应的既有 PyInstaller 基线 EXE、物品字典、图标素材与 rcedit 工具。这些文件不构成可独立从零构建的完整工程；请通过 Releases 获取成品。

根目录 build.ps1 与 src/java、src/plugin 仍对应历史 Java 插件版，不生成当前直连版本。个人配置、账号信息、日志、市场缓存和测试快照均未纳入源码。

## 历史插件版构建记录

# 构建说明

环境：Windows x64、Java 17 或更高、Python 3、Windows .NET Framework C# 编译器。编译游戏插件另需 .NET SDK，以及游戏首次加载 BepInEx 后生成的 interop 程序集。

从 Releases 解压公开包，使用其中的 JAR 作为依赖基线：

```powershell
./build.ps1 -BaseApp 'C:/TBHHelper/TBH-Helper-v1.3.46.jar' -JavaPath 'C:/TBHHelper/runtime/bin/java.exe'
```

Python 不在 PATH 时，添加 `-PythonPath`。编译插件：

```powershell
./build.ps1 -BaseApp 'C:/TBHHelper/TBH-Helper-v1.3.46.jar' -JavaPath 'C:/TBHHelper/runtime/bin/java.exe' -IncludePlugin -GameDir 'C:/Games/TaskbarHero'
```

产物：`dist/TBH-Helper-v1.3.46.jar`、`build/native/TBH助手.exe` 和插件项目的 Release 目录。发布包把启动器放在根目录、内置运行库放在 `runtime`，打包脚本见仓库说明。

Java 构建使用 ECJ 编译维护模块，并将资源和编译类替换进基线 JAR。游戏 DLL 从安装目录引用，构建脚本不复制游戏文件到仓库。

BepInEx 包采用官方 [6.0.0-be.785 Windows x64 IL2CPP 构建](https://builds.bepinex.dev/projects/bepinex_be)。首次安装说明见 [官方文档](https://docs.bepinex.dev/master/articles/user_guide/installation/unity_il2cpp.html)。## 发布前校对

每次发布新版后，同步更新根目录 `README.md` 首页下载链接和“首次安装”步骤中的 Releases 链接，统一指向已经公开的新版本 tag。发布前先完成测试；发布后核对 README 首页、下载页与最新 Release 版本一致。