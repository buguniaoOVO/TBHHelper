# TBH助手 v1.3.47 · 更新检测与使用说明

助手版本 1.3.47，游戏插件 1.3.43，Windows x64。

- 设置页新增“检测更新”。助手会查询 GitHub 最新发布，显示是否有新版本；确认后自动下载，并在助手退出后替换文件、重新启动。
- 设置页新增“打开发布页”，可在系统浏览器查看完整更新说明和下载包。
- 更新只替换程序、运行库和插件，保留 settings.properties、stats.properties、activity.tsv 和 game-path.txt。
- 说明页重写为“安装与启动 / 日常使用 / 版本更新”三部分，写明先退出游戏、一键部署、再重启游戏的顺序。
- 保留 1.3.46 的托盘 Swing 菜单与后台控制台隐藏。

## 下载

TBHHelper-v1.3.47-win-x64.zip：完整程序与运行库。

TBHHelper-v1.3.47-forum-kit.zip：论坛介绍帖、六张界面截图、发电与 Star 图片。

SHA256SUMS.txt：下载包校验值。

## 使用

完整解压后双击 TBH助手.exe，在“设置/setting”页先退出游戏并点“一键部署”，再从 Steam 启动游戏并等待已连接。配置规则后点“一键开启”，F8 停止。以后检查更新或直接点“打开发布页”都可以。

## 验证范围

版本比较逻辑通过单元检查（v1.3.47 高于 v1.3.46、相同版本不算更新、跨大版本正确）。托盘菜单、后台窗口、一键部署和英文界面沿用之前版本的验证结果。更新下载与替换脚本已在本机走通，跨电脑首次更新尚未实测。

[项目与截图](https://github.com/buguniaoOVO/TBHHelper) · [介绍帖](https://github.com/buguniaoOVO/TBHHelper/blob/main/docs/forum-post.md)
