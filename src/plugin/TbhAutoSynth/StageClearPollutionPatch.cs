using System;
using System.Reflection;
using HarmonyLib;
using TaskbarHero;

namespace TbhAutoSynth;

internal static class StageClearPollutionPatch
{
	internal static void Install(Harmony harmony)
	{
		MethodInfo methodInfo = AccessTools.Method(typeof(StageClearFunctionResult), "Initialize");
		MethodInfo methodInfo2 = AccessTools.Method(typeof(StageClearPollutionPatch), "Postfix");
		if (methodInfo == null || methodInfo2 == null)
		{
			throw new MissingMethodException("StageClearFunctionResult.Initialize");
		}
		harmony.Patch(methodInfo, null, new HarmonyMethod(methodInfo2));
	}

	private static void Postfix(StageClearFunctionResult __instance)
	{
		try
		{
			if (__instance != null && __instance.IsSuccess)
			{
				RuntimeMonitor.Capture(__instance.PollutionValue, __instance.PollutionUpdateAt.ToString(), "stage-clear");
				RuntimeMonitor.RecordStageClear(__instance);
			}
		}
		catch (Exception ex)
		{
			AutoApiPlugin.Logger?.LogWarning("[监控] 读取关卡结果污染度失败：" + ex.Message);
		}
	}
}
