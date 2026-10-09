using System;
using System.IO;
using System.Security.Cryptography;
using BepInEx;
using BepInEx.Logging;
using BepInEx.Unity.IL2CPP;
using HarmonyLib;
using Il2CppInterop.Runtime.Injection;

namespace TbhAutoSynth;

[BepInPlugin("com.pres.tbh.autosynth", "TBH Auto API", "1.3.63")]
public class AutoApiPlugin : BasePlugin
{
	public const string Version = "1.3.63";

	public const int ApiProtocol = 4;

	internal static string RuntimeSignature = "";

	internal static string RuntimeHash = "";

	internal static string BridgeSignature = "";

	internal static ManualLogSource Logger;

	private Harmony _harmony;

	public override void Load()
	{
		Logger = Log;
		string text = (RuntimeHash = Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(typeof(AutoApiPlugin).Assembly.Location))).ToLowerInvariant());
		RuntimeSignature = "|plugin_version=1.3.63|api_protocol=" + 4 + "|plugin_sha256=" + text;
		Logger.LogInfo("[插件版本] 1.3.63，协议=" + 4 + "，SHA256=" + text);
		ConsoleWindowHider.Hide();
		try
		{
			_harmony = new Harmony("com.pres.tbh.runtime-monitor");
			_harmony.PatchAll(typeof(AutoApiPlugin).Assembly);
			Logger.LogInfo("[监控] 库存、腐蚀和宝箱结果回调已安装。");
		}
		catch (Exception ex)
		{
			Logger.LogError("[监控] 污染度监听安装失败：" + ex.Message);
		}
		try
		{
			StageStartStatisticsPatch.Install(_harmony);
			Logger.LogInfo("[统计] 战斗起点监听已安装。");
		}
		catch (Exception ex2)
		{
			Logger.LogWarning("[统计] 战斗起点监听不可用：" + ex2.Message);
		}
		try
		{
			NativeLogStatisticsPatch.Install(_harmony);
			Logger.LogInfo("[统计] 游戏原生日志监听已安装。");
		}
		catch (Exception ex3)
		{
			Logger.LogWarning("[统计] 游戏原生日志监听不可用：" + ex3.Message);
		}
		try
		{
			StageBoxOpenStatisticsPatch.Install(_harmony);
			Logger.LogInfo("[统计] 宝箱开启来源监听已安装。");
		}
		catch (Exception ex4)
		{
			Logger.LogWarning("[统计] 宝箱开启来源监听不可用：" + ex4.Message);
		}
		try
		{
			StageClearPollutionPatch.Install(_harmony);
			Logger.LogInfo("[统计] 通关结果监听已安装。");
		}
		catch (Exception ex5)
		{
			Logger.LogWarning("[统计] 通关结果监听不可用：" + ex5.Message);
		}
		if (!ClassInjector.IsTypeRegisteredInIl2Cpp<AutoApiBehaviour>())
		{
			ClassInjector.RegisterTypeInIl2Cpp<AutoApiBehaviour>();
		}
		AddComponent<AutoApiBehaviour>();
		Logger.LogInfo(">>> [TBH Auto API] 核心已加载！无需 JS 文件，纯内存动态读取模式启动。");
	}
}
