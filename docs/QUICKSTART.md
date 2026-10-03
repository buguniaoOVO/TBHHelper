# TBH助手快速上手

## 首次安装

1. 下载 Windows x64 ZIP，完整解压，保持 `jre`、`BepInExPackage`、JAR 与插件在同一文件夹。
2. 退出游戏和旧助手，双击 `启动TBH助手.cmd`。
3. 自动检测 Steam 目录失败时，选择含有 `TaskBarHero.exe` 的文件夹。
4. 从 Steam 启动游戏，等待显示“已连接”。首次安装 BepInEx 会生成接口程序集。
5. 先检查品质上限、包含仓库、排除项和地图目标，再点“一键开启”。F8 或“全部关闭”停止总任务。

## 文件

| 文件 | 作用 |
| --- | --- |
| `启动TBH助手.cmd` | 常用启动入口 |
| `jre/bin/TBH助手.exe` | 独立进程启动器，任务管理器显示 TBH助手 |
| `TBH-Helper-v1.3.43.jar` | 助手界面与逻辑 |
| `TBHPlugin-自动腐蚀版.dll` | 游戏插件，启动器放到游戏的 `BepInEx/plugins/TBHPlugin.dll` |
| `BepInExPackage` | 官方 IL2CPP 运行环境，缺失时安装 |
| `settings.properties` | 你的助手配置 |
| `game-path.txt` | 启动器记住的游戏目录 |

## 更新

退出游戏和助手，再解压新版。保留自己的 `settings.properties`、`game-path.txt`、`activity.tsv`、`stats.properties` 与缓存；替换程序、插件和运行文件。已加载的 DLL 需要在游戏关闭后替换。

## 暂停与停用

F8 暂停自动任务；退出助手停止桌面任务。停用游戏插件时，请退出游戏，在设置里点“停用本插件”，或手动将 `BepInEx/plugins/TBHPlugin.dll` 移出 plugins 文件夹。停用时保留其他插件和共享 BepInEx 运行环境。启动器再次打开时会部署本包插件。

## 排查连接

确认游戏已经进入角色、插件加载日志包含 `TBH Auto API 1.3.43`，并且本机端口 19090 可用。日志位于游戏的 `BepInEx/LogOutput.log`。

首次部署遇到权限错误时，将助手解压到可写目录，并确认 Steam 游戏目录可以写入。检测到已有其他 `winhttp.dll` 加载器时，启动器会停止自动覆盖，请先确认该环境的兼容性。

运行中遇到拒绝或结果未知时，先暂停并等待本次请求结算，再处理游戏连接。当前 20 秒统一间隔和 120 秒腐蚀间隔是程序保护值。

## 截图对应页面

[概览](images/01-overview.png) · [合成](images/02-synthesis.png) · [腐蚀](images/03-corrosion.png) · [仓库](images/04-warehouse.png) · [统计](images/05-statistics.png) · [掉落](images/06-drops.png)
