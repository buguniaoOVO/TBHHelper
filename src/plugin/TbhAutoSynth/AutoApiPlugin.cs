using System;
using BepInEx;
using BepInEx.Logging;
using BepInEx.Unity.IL2CPP;
using HarmonyLib;
using Il2CppInterop.Runtime.Injection;

namespace TbhAutoSynth;

[BepInPlugin("com.pres.tbh.autosynth", "TBH Auto API", AutoApiPlugin.Version)]
public class AutoApiPlugin : BasePlugin
{
	public const string Version = "1.3.60";
	public const int ApiProtocol = 4;
	internal static string RuntimeSignature = "";
	internal static string RuntimeHash = "";
	internal static string BridgeSignature = "";
	internal static ManualLogSource Logger;
	private Harmony _harmony;

	public override void Load()
	{
		Logger = ((BasePlugin)this).Log;
		string hash = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(
			System.IO.File.ReadAllBytes(typeof(AutoApiPlugin).Assembly.Location))).ToLowerInvariant();
		RuntimeHash = hash;
		RuntimeSignature = "|plugin_version=" + Version + "|api_protocol=" + ApiProtocol + "|plugin_sha256=" + hash;
		Logger.LogInfo((object)("[插件版本] " + Version + "，协议=" + ApiProtocol + "，SHA256=" + hash));
		ConsoleWindowHider.Hide();
		try
		{
			_harmony = new Harmony("com.pres.tbh.runtime-monitor");
			_harmony.PatchAll(typeof(AutoApiPlugin).Assembly);
			Logger.LogInfo((object)"[监控] 库存、腐蚀和宝箱结果回调已安装。");
		}
		catch (Exception ex)
		{
			Logger.LogError((object)("[监控] 污染度监听安装失败：" + ex.Message));
		}
		try
		{
			StageStartStatisticsPatch.Install(_harmony);
			Logger.LogInfo((object)"[统计] 战斗起点监听已安装。");
		}
		catch (Exception ex)
		{
			Logger.LogWarning((object)("[统计] 战斗起点监听不可用：" + ex.Message));
		}
		try
		{
			NativeLogStatisticsPatch.Install(_harmony);
			Logger.LogInfo((object)"[统计] 游戏原生日志监听已安装。");
		}
		catch (Exception ex)
		{
			Logger.LogWarning((object)("[统计] 游戏原生日志监听不可用：" + ex.Message));
		}
		try
		{
			StageBoxOpenStatisticsPatch.Install(_harmony);
			Logger.LogInfo((object)"[统计] 宝箱开启来源监听已安装。");
		}
		catch (Exception ex)
		{
			Logger.LogWarning((object)("[统计] 宝箱开启来源监听不可用：" + ex.Message));
		}
		try
		{
			StageClearPollutionPatch.Install(_harmony);
			Logger.LogInfo((object)"[统计] 通关结果监听已安装。");
		}
		catch (Exception ex)
		{
			Logger.LogWarning((object)("[统计] 通关结果监听不可用：" + ex.Message));
		}
		if (!ClassInjector.IsTypeRegisteredInIl2Cpp<AutoApiBehaviour>())
		{
			ClassInjector.RegisterTypeInIl2Cpp<AutoApiBehaviour>();
		}
		((BasePlugin)this).AddComponent<AutoApiBehaviour>();
		Logger.LogInfo((object)">>> [TBH Auto API] 核心已加载！无需 JS 文件，纯内存动态读取模式启动。");
	}
}
