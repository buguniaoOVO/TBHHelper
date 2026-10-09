using System;
using HarmonyLib;
using TaskbarHero;

namespace TbhAutoSynth;

[HarmonyPatch(typeof(CorrosionFunction), "GetParam")]
internal static class CorrosionRequestStartPatch
{
	[HarmonyPrefix]
	private static void Prefix()
	{
		try
		{
			if (!RuntimeMonitor.IsCorrosionActionPending())
			{
				RuntimeMonitor.BeginCorrosionAction();
			}
			InventoryOperationGate.MarkServerRequestStarted();
			AutoApiPlugin.Logger?.LogInfo("[腐蚀服务器请求] 游戏开始提交，库存状态=" + InventoryOperationGate.Readiness());
		}
		catch (Exception ex)
		{
			AutoApiPlugin.Logger?.LogWarning("[腐蚀服务器请求] 监听失败：" + ex.Message);
		}
	}
}
