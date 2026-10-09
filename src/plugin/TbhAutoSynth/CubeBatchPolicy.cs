using System;

namespace TbhAutoSynth;

internal static class CubeBatchPolicy
{
	internal static bool IsValidCount(string operation, int count)
	{
		if (!(operation == "corrosion"))
		{
			return count == 9;
		}
		if (count >= 1)
		{
			return count <= 9;
		}
		return false;
	}

	internal static string CorrosionFillStatus(int count)
	{
		if (count < 1 || count > 9)
		{
			if (count != 0)
			{
				return "INVALID_COUNT";
			}
			return "CORROSION_EMPTY|count=0";
		}
		return "CORROSION_READY|count=" + count;
	}

	internal static bool TryGetCorrosionExclusion(string name, bool excludeInscriptionScrolls, bool excludeOfferingCoins, out string exclusion)
	{
		string text = name ?? "";
		exclusion = "";
		if (excludeInscriptionScrolls && (text.Contains("铭文卷轴", StringComparison.Ordinal) || (Contains(text, "inscription") && Contains(text, "scroll"))))
		{
			exclusion = "铭文卷轴";
			return true;
		}
		if (excludeOfferingCoins && (text.Contains("纪念币", StringComparison.Ordinal) || (Contains(text, "anniversary") && Contains(text, "coin")) || (Contains(text, "commemorative") && Contains(text, "coin")) || (Contains(text, "offering") && Contains(text, "coin"))))
		{
			exclusion = "纪念币";
			return true;
		}
		return false;
	}

	private static bool Contains(string value, string token)
	{
		return value.IndexOf(token, StringComparison.OrdinalIgnoreCase) >= 0;
	}
}
