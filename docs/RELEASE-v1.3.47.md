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

## 安装与部署

环境：Windows 10/11 64 位、Steam 版 TaskBarHero。下载包自带 Java 17 运行库与官方 BepInEx IL2CPP 后台环境。

1. 完整解压下载包到任意可写目录，双击文件夹里的 TBH助手.exe。
2. 先退出游戏，在“设置/setting”页点“一键部署”。助手按已保存路径、运行中的游戏、Steam 库定位游戏目录；都找不到时弹窗选择含 TaskBarHero.exe 的文件夹。
3. 部署写入后台环境与插件，被覆盖文件先备份到游戏目录下的 TBH-Backups，已有配置、其他插件与 interop 文件保留。
4. 从 Steam 重新启动游戏，等助手显示“游戏已连接”。首次部署必须重启游戏，插件才会加载。
5. 检查各项规则后点“一键开启”，F8 停止。

## 更新

设置页点“检测更新”，助手比对 GitHub 最新版本并显示结果；有新版本时确认后自动下载，在助手退出时替换程序并重新启动。点“打开发布页”可在浏览器查看说明和下载。更新保留 settings.properties、stats.properties、activity.tsv 和 game-path.txt。手工更新时退出游戏与助手，解压新版覆盖旧目录，再点一次“一键部署”并重启游戏。

## 验证范围

版本比较逻辑通过单元检查（v1.3.47 高于 v1.3.46、相同版本不算更新、跨大版本正确）。托盘菜单、后台窗口、一键部署和英文界面沿用之前版本的验证结果。更新下载与替换脚本已在本机走通，跨电脑首次更新尚未实测。

[项目与截图](https://github.com/buguniaoOVO/TBHHelper) · [介绍帖](https://github.com/buguniaoOVO/TBHHelper/blob/main/docs/forum-post.md)
