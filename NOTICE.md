# 来源与许可说明

本项目从既有 TBH助手的本地维护工程整理，Java 的 `com.lulu` 命名空间和既有代码来源标记予以保留。新增界面、统计、库存保护、插件维护及发布整理署名 by Awan。既有代码权利归原作者，本仓库发布不表示取得游戏或原助手的全部版权。

新增原创维护代码使用 LICENSE 中的 MIT 条款。该条款仅覆盖 Awan 有权授权的新增代码；既有代码、依赖、游戏道具图像和第三方内容遵循各自的版权与许可。

| 组件 / 内容 | 来源 |
| --- | --- |
| BepInEx IL2CPP | 官方 be.785 Windows x64 构建，包内保留许可文件；https://builds.bepinex.dev/projects/bepinex_be |
| Java 17 运行库 | Azul Zulu OpenJDK，保留原运行库说明与许可；https://www.azul.com/downloads/ |
| ECJ | Eclipse Java 编译器，工具 JAR 内保留许可；https://www.eclipse.org/jdt/ |
| FlatLaf、JNA、Gson、OpenCV 等 | 既有助手依赖，JAR 内保留相关 LICENSE / NOTICE |
| 游戏接口程序集 | 从用户安装的游戏与 BepInEx 引用，源码仓库不分发这些 DLL |
| 道具名称与像素图像 | TaskBarHero 游戏内容，用于道具识别与展示，权利归对应权利人 |
| 市场参考数据 | TBHIndex 公开接口；https://tbhindex.com/ |
| 美元兑人民币参考汇率 | ExchangeRate-API 公开接口；https://www.exchangerate-api.com/docs/free |
| 狗狗拉弓与 Star 图 | 使用内置 imagegen 制作，说明见 docs/star-card-generation.md |

运行包使用干净官方 BepInEx 分发包，包含通用运行文件。个人配置、库存记录、完整游戏日志与开发机生成的 interop 文件均不包含在源码仓库和下载包内。
