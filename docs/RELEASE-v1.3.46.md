# TBH助手 v1.3.46 · 托盘菜单与后台窗口

助手版本 1.3.46，游戏插件 1.3.43，Windows x64。

- 托盘右键菜单改用 Swing 菜单，不再受 Windows 原生菜单字体限制，中文菜单项不再显示成方块。
- 一键部署会关闭游戏目录下的 BepInEx 控制台窗口，游戏启动时不再弹出额外的黑色日志窗口，日志仍写入 LogOutput.log。
- 插件加载时会隐藏本进程的控制台窗口，已经部署过的旧环境也能挡住。
- 保留 1.3.45 的根目录 TBH助手.exe 双击启动、内置 runtime 运行库和一键部署。
- 设置页可切换简体中文与英文界面；关闭按钮可选每次询问、直接退出或缩小至托盘。

## 下载

TBHHelper-v1.3.46-win-x64.zip：完整程序与运行库。

TBHHelper-v1.3.46-forum-kit.zip：论坛介绍帖、六张界面截图、发电与 Star 图片。

SHA256SUMS.txt：下载包校验值。

## 使用

完整解压后双击 TBH助手.exe，在“设置/setting”页点“一键部署”，再从 Steam 启动游戏并等待已连接。配置规则后点“一键开启”，F8 停止。

## 验证范围

托盘菜单与后台窗口的修复已在本机运行中确认：托盘右键菜单中文正常显示，游戏进程的 ConsoleWindowClass 窗口在隐藏后处于不可见状态，BepInEx.cfg 中的 Logging.Console 已设为 Enabled = false。图标直启、一键部署和英文界面沿用 1.3.45 的验证结果。跨电脑首次部署尚未做完整实测。

[项目与截图](https://github.com/buguniaoOVO/TBHHelper) · [介绍帖](https://github.com/buguniaoOVO/TBHHelper/blob/main/docs/forum-post.md)
