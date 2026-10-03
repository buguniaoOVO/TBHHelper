# 独立进程启动器

启动器位于发布包根目录，文件名为 `TBH助手.exe`。文件描述与产品名为 TBH助手，使用狗狗图标，加载 `runtime` 里的 jli.dll，在自身进程中启动 Java 界面。JAR 与启动器同在根目录。

启动器只负责拉起助手界面，运行游戏时也能正常打开。游戏目录检测、运行环境与插件写入由设置页的“一键部署”完成：依次尝试已保存路径、运行中的游戏和 Steam 库，最后让用户选择含 TaskBarHero.exe 的文件夹，并把结果写入 `settings.properties`。

一键部署要求游戏关闭。它使用干净的官方 BepInEx IL2CPP 分发包释放运行环境，内容一致时跳过复制，已有文件先备份到游戏目录下的 `TBH-Backups`，配置、其他插件和生成的 interop 文件予以保留。

实现参考：[OpenJDK启动入口](https://github.com/openjdk/jdk17u/blob/master/src/java.base/share/native/launcher/main.c)、[Windows运行库定位](https://github.com/openjdk/jdk17u/blob/master/src/java.base/windows/native/libjli/java_md.c)、[微软VERSIONINFO文档](https://learn.microsoft.com/en-us/windows/win32/menurc/versioninfo-resource)。

启动器使用单实例锁。再次启动时提示从任务栏或托盘打开已有助手。
