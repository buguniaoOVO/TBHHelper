using System;
using System.Reflection;
using HarmonyLib;
using TaskbarHero.Log;

namespace TbhAutoSynth;

internal static class NativeLogStatisticsPatch
{
	internal static void Install(Harmony harmony)
	{
		MethodInfo methodInfo = AccessTools.Method(typeof(LogManager), "lgi", new Type[1] { typeof(LogData) });
		MethodInfo methodInfo2 = AccessTools.Method(typeof(NativeLogStatisticsPatch), "Postfix");
		if (methodInfo == null || methodInfo2 == null)
		{
			throw new MissingMethodException("LogManager.lgi(LogData)");
		}
		harmony.Patch(methodInfo, null, new HarmonyMethod(methodInfo2));
	}

	private static void Postfix(LogData __0)
	{
		try
		{
			SynthesisActionMonitor.ObserveLiveLog(__0);
		}
		catch (Exception ex)
		{
			AutoApiPlugin.Logger?.LogWarning("[合成结果] 日志监听失败：" + ex.Message);
		}
		RuntimeMonitor.CaptureNativeGameLog(__0);
	}
}
