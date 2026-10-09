using System;
using HarmonyLib;
using Il2CppInterop.Runtime.InteropTypes.Arrays;
using TaskbarHero;

namespace TbhAutoSynth;

[HarmonyPatch(typeof(CorrosionFunctionRequest), "Initialize")]
internal static class CorrosionRequestDiagnosticPatch
{
	[HarmonyPostfix]
	private static void Postfix(CorrosionFunctionRequest __instance)
	{
		try
		{
			if (__instance == null)
			{
				return;
			}
			Il2CppStructArray<ulong> useBoxKeyList = __instance.useBoxKeyList;
			Il2CppReferenceArray<InventoryConsumeItem> items = __instance.items;
			AutoApiPlugin.Logger?.LogInfo("[腐蚀请求参数] 物品组=" + (items?.Length ?? 0) + "，关联宝箱=" + (useBoxKeyList?.Length ?? 0) + "，魔方等级=" + __instance.cubeLev);
			if (useBoxKeyList != null)
			{
				for (int i = 0; i < Math.Min(12, useBoxKeyList.Length); i++)
				{
					AutoApiPlugin.Logger?.LogInfo("[腐蚀关联宝箱] index=" + i + "，key=" + useBoxKeyList[i]);
				}
			}
		}
		catch (Exception ex)
		{
			AutoApiPlugin.Logger?.LogWarning("[腐蚀请求参数] 读取失败：" + ex.Message);
		}
	}
}
