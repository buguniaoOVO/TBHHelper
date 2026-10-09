using System;
using HarmonyLib;
using TaskbarHero;

namespace TbhAutoSynth;

[HarmonyPatch(typeof(InventoryProcessBoxResult), "Initialize")]
internal static class InventoryBoxPollutionPatch
{
	[HarmonyPostfix]
	private static void Postfix(InventoryProcessBoxResult __instance)
	{
		try
		{
			if (__instance != null && __instance.IsSuccess)
			{
				RuntimeMonitor.Capture(__instance.PollutionValue, __instance.PollutionUpdateAt.ToString(), "inventory-box");
			}
			if (__instance != null)
			{
				InventoryOperationGate.BoxRequestFinished(__instance.Code, __instance.IsSuccess, __instance.Error);
			}
		}
		catch (Exception ex)
		{
			AutoApiPlugin.Logger?.LogWarning("[监控] 读取箱子结果污染度失败：" + ex.Message);
		}
	}
}
