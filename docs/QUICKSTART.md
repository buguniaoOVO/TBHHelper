# TBH助手快速上手

## 首次安装

1. 下载 Windows x64 ZIP，完整解压。文件夹里双击 `TBH助手.exe` 即可启动，不需要命令行或额外安装 Java。
2. 先退出游戏，在助手“设置/setting”页点“一键部署”。它会写入后台环境与插件，需要时自动选择游戏目录。
3. 从 Steam 启动游戏，等待显示“游戏已连接”。首次安装 BepInEx 会生成接口程序集。
5. 先检查品质上限、包含仓库、排除项和地图目标，再点“一键开启”。F8 或“全部关闭”停止总任务。
6. 在设置页切换中文 / English，并选择关闭按钮的默认行为。

## 文件

| 文件 | 作用 |
| --- | --- |
| `TBH助手.exe` | 启动入口，双击即可运行，任务管理器显示 TBH助手 |
| `runtime` | 内置 Java 运行库，随包提供 |
| `TBH-Helper-v1.3.47.jar` | 助手界面与逻辑 |
| `TBHPlugin-自动腐蚀版.dll` | 游戏插件，一键部署时复制到游戏的 `BepInEx/plugins/TBHPlugin.dll` |
| `BepInExPackage` | 官方 IL2CPP 后台运行环境，一键部署时释放 |
| `settings.properties` | 你的助手配置 |
| `game-path.txt` | 助手记住的游戏目录 |

## 更新

退出游戏和助手，再解压新版。保留自己的 `settings.properties`、`game-path.txt`、`activity.tsv`、`stats.properties` 与缓存；替换程序、插件和运行文件。已加载的 DLL 需要在游戏关闭后替换，也可以直接对新的 `TBH助手.exe` 再点一次“一键部署”。

## 暂停与停用

F8 暂停自动任务；退出助手停止桌面任务。关闭按钮默认缩小至托盘，可在设置里改为每次询问或直接退出。停用游戏插件时，请退出游戏，在设置里点“停用本插件”，或手动将 `BepInEx/plugins/TBHPlugin.dll` 移出 plugins 文件夹。停用时保留其他插件和共享 BepInEx 运行环境。再次点“一键部署”会恢复本插件。

## 排查连接

确认游戏已经进入角色、插件加载日志包含 `TBH Auto API`，并且本机端口 19090 可用。日志位于游戏的 `BepInEx/LogOutput.log`。助手界面版本显示 `v1.3.47`。

首次部署遇到权限错误时，将助手解压到可写目录，并确认 Steam 游戏目录可以写入。游戏目录已有其他 `winhttp.dll` 时，一键部署会先备份被覆盖的文件再写入。

运行中遇到拒绝或结果未知时，先暂停并等待本次请求结算，再处理游戏连接。当前 20 秒统一间隔和 120 秒腐蚀间隔是程序保护值。

## 截图对应页面

[概览](images/01-overview.png) · [合成](images/02-synthesis.png) · [腐蚀](images/03-corrosion.png) · [仓库](images/04-warehouse.png) · [统计](images/05-statistics.png) · [掉落](images/06-drops.png)
