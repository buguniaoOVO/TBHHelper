# 构建说明

环境：Windows x64、Java 17 或更高、Python 3、Windows .NET Framework C# 编译器。编译游戏插件另需 .NET SDK，以及游戏首次加载 BepInEx 后生成的 interop 程序集。

从 Releases 解压公开包，使用其中的 JAR 作为依赖基线：

```powershell
./build.ps1 -BaseApp 'C:/TBHHelper/TBH-Helper-v1.3.44.jar' -JavaPath 'C:/TBHHelper/jre/bin/java.exe'
```

Python 不在 PATH 时，添加 `-PythonPath`。编译插件：

```powershell
./build.ps1 -BaseApp 'C:/TBHHelper/TBH-Helper-v1.3.44.jar' -JavaPath 'C:/TBHHelper/jre/bin/java.exe' -IncludePlugin -GameDir 'C:/Games/TaskbarHero'
```

产物：`dist/TBH-Helper-v1.3.44.jar`、`build/native/TBH助手.exe` 和插件项目的 Release 目录。独立启动器放到发布包的 `jre/bin`，保留发布包其他文件。

Java 构建使用 ECJ 编译维护模块，并将资源和编译类替换进基线 JAR。游戏 DLL 从安装目录引用，构建脚本不复制游戏文件到仓库。

BepInEx 包采用官方 [6.0.0-be.785 Windows x64 IL2CPP 构建](https://builds.bepinex.dev/projects/bepinex_be)。首次安装说明见 [官方文档](https://docs.bepinex.dev/master/articles/user_guide/installation/unity_il2cpp.html)。
