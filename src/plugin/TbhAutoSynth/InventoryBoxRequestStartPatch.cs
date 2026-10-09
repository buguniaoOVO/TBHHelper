using System;
using HarmonyLib;
using TaskbarHero;

namespace TbhAutoSynth;

[HarmonyPatch(typeof(InventoryProcessBox), "GetParam")]
internal static class InventoryBoxRequestStartPatch
{
	[HarmonyPrefix]
	private static void Prefix(InventoryProcessBox __instance)
	{
		try
		{
			if (__instance != null)
			{
				InventoryOperationGate.BoxRequestStarted(__instance.Pointer);
			}
		}
		catch (Exception ex)
		{
			AutoApiPlugin.Logger?.LogWarning("[库存同步] 请求监听失败：" + ex.Message);
		}
	}
}
