# 独立进程启动器

启动器位于发布包的 `jre/bin/TBH助手.exe`。文件描述与产品名为 TBH助手，使用狗狗图标，加载本地 jli.dll，在自身进程中启动 Java 界面。JAR 位于发布包根目录。

公开包启动时检测已保存目录、运行中的游戏和 Steam 库。找不到游戏时，用户可选择含 TaskBarHero.exe 的文件夹。目录保存在 game-path.txt，并同步到助手配置。

需要复制游戏 DLL 时要求游戏关闭；插件内容一致时跳过复制。缺少 BepInEx IL2CPP 环境时使用干净官方分发包，已有文件被覆盖前备份，配置、其他插件和生成的 interop 文件予以保留。

实现参考：[OpenJDK启动入口](https://github.com/openjdk/jdk17u/blob/master/src/java.base/share/native/launcher/main.c)、[Windows运行库定位](https://github.com/openjdk/jdk17u/blob/master/src/java.base/windows/native/libjli/java_md.c)、[微软VERSIONINFO文档](https://learn.microsoft.com/en-us/windows/win32/menurc/versioninfo-resource)。

启动器使用单实例锁。再次启动时提示从任务栏或托盘打开已有助手。
