using System;
using HarmonyLib;
using TaskbarHero;

namespace TbhAutoSynth;

[HarmonyPatch(typeof(CorrosionFunctionResult), "Initialize")]
internal static class CorrosionPollutionPatch
{
	[HarmonyPostfix]
	private static void Postfix(CorrosionFunctionResult __instance)
	{
		try
		{
			if (__instance != null)
			{
				AutoApiPlugin.Logger?.LogInfo("[腐蚀结果] Code=" + __instance.Code + "，IsSuccess=" + __instance.IsSuccess + "，Error=" + __instance.Error);
				RuntimeMonitor.MarkCorrosionActionResult(__instance.IsSuccess, __instance.Code, __instance.Error);
				if (__instance.IsSuccess)
				{
					RuntimeMonitor.Capture(__instance.PollutionValue, __instance.PollutionUpdateAt.ToString(), "corrosion-result");
				}
			}
		}
		catch (Exception ex)
		{
			AutoApiPlugin.Logger?.LogWarning("[监控] 读取腐蚀结果污染度失败：" + ex.Message);
		}
	}
}
