# TBH助手启动入口

本机旧入口直接执行内置`javaw.exe`。该文件的进程描述为`Zulu Platform x64 Architecture`，任务管理器中因而显示运行库名称。

独立入口使用`TBH助手.exe`，文件描述和产品名均为`TBH助手`，带现有狗狗图标。它加载本地`jli.dll`，在自身进程内启动助手，不创建`javaw.exe`子进程。版本EXE的原生入口也替换为同一实现，因此通过快捷方式或直接双击版本EXE均使用助手的进程描述。

原有Zulu运行库和签名文件保持原样。程序用Windows已有的.NET Framework加载本地运行库；不需要新的网络服务。

实现参考：[OpenJDK启动入口](https://github.com/openjdk/jdk17u/blob/master/src/java.base/share/native/launcher/main.c)、[Windows运行库定位](https://github.com/openjdk/jdk17u/blob/master/src/java.base/windows/native/libjli/java_md.c)、[微软VERSIONINFO文档](https://learn.microsoft.com/en-us/windows/win32/menurc/versioninfo-resource)。

2026年10月2日已安装助手1.3.42。启动后的实际进程为`TBH助手.exe`，文件描述和产品名均为`TBH助手`，自身加载`jli.dll`和`jvm.dll`。快捷方式已指向独立入口，原签名运行库文件哈希保持完整。旧版1.3.41已归档。
