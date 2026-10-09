using System;
using System.Reflection;
using HarmonyLib;
using TaskbarHero;

namespace TbhAutoSynth;

internal static class StageStartStatisticsPatch
{
	internal static void Install(Harmony harmony)
	{
		MethodInfo methodInfo = AccessTools.Method(typeof(UI_Stage), "igz", new Type[2]
		{
			typeof(wh.StageCache),
			typeof(bool)
		});
		MethodInfo methodInfo2 = AccessTools.Method(typeof(StageStartStatisticsPatch), "Prefix");
		if (methodInfo == null || methodInfo2 == null)
		{
			throw new MissingMethodException("UI_Stage.igz");
		}
		harmony.Patch(methodInfo, new HarmonyMethod(methodInfo2));
	}

	private static void Prefix(wh.StageCache __0)
	{
		RuntimeMonitor.RecordStageStart(__0);
	}
}
