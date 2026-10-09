using System;
using HarmonyLib;
using TaskbarHero;

namespace TbhAutoSynth;

[HarmonyPatch(typeof(InventoryInitResult), "Initialize")]
internal static class InventoryInitPollutionPatch
{
	[HarmonyPostfix]
	private static void Postfix(InventoryInitResult __instance)
	{
		try
		{
			if (__instance != null && __instance.IsSuccess)
			{
				RuntimeMonitor.Capture(__instance.PollutionValue, __instance.PollutionUpdateAt.ToString(), "inventory-init", __instance.Plaguelands);
			}
		}
		catch (Exception ex)
		{
			AutoApiPlugin.Logger?.LogWarning("[监控] 读取库存初始化污染度失败：" + ex.Message);
		}
	}
}
