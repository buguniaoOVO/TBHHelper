using System;
using System.Collections.Generic;
using System.Reflection;
using HarmonyLib;
using TaskbarHero.UI;

namespace TbhAutoSynth;

internal static class StageBoxOpenStatisticsPatch
{
	internal static void Install(Harmony harmony)
	{
		string[] array = new string[4] { "mpc", "mpl", "mpm", "mpp" };
		List<string> list = new List<string>();
		MethodInfo method = AccessTools.Method(typeof(StageBoxOpenStatisticsPatch), "Prefix");
		int num = 0;
		for (int i = 0; i < array.Length; i++)
		{
			MethodInfo methodInfo = AccessTools.Method(typeof(StageBox), array[i]);
			if (!(methodInfo == null))
			{
				harmony.Patch(methodInfo, new HarmonyMethod(method));
				list.Add(array[i]);
				num++;
			}
		}
		if (num == 0)
		{
			throw new MissingMethodException("StageBox open methods");
		}
		AutoApiPlugin.Logger?.LogInfo("[统计] 宝箱开箱入口方法：" + string.Join(",", list));
	}

	private static void Prefix(StageBox __instance)
	{
		RuntimeMonitor.MarkStageBoxOpening(__instance);
	}
}
