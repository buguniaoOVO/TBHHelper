namespace TbhAutoSynth;

internal static class CubeBatchPolicy
{
    internal static bool IsValidCount(string operation, int count)
    {
        return operation == "corrosion" ? count >= 1 && count <= 9 : count == 9;
    }

    internal static string CorrosionFillStatus(int count)
    {
        return count >= 1 && count <= 9 ? "CORROSION_READY|count=" + count
            : count == 0 ? "CORROSION_EMPTY|count=0" : "INVALID_COUNT";
    }

    internal static bool TryGetCorrosionExclusion(string name, bool excludeInscriptionScrolls,
        bool excludeOfferingCoins, out string exclusion)
    {
        string label = name ?? "";
        exclusion = "";
        if (excludeInscriptionScrolls && (label.Contains("铭文卷轴", System.StringComparison.Ordinal)
            || (Contains(label, "inscription") && Contains(label, "scroll"))))
        {
            exclusion = "铭文卷轴";
            return true;
        }
        if (excludeOfferingCoins && (label.Contains("纪念币", System.StringComparison.Ordinal)
            || (Contains(label, "anniversary") && Contains(label, "coin"))
            || (Contains(label, "commemorative") && Contains(label, "coin"))
            || (Contains(label, "offering") && Contains(label, "coin"))))
        {
            exclusion = "纪念币";
            return true;
        }
        return false;
    }

    private static bool Contains(string value, string token) =>
        value.IndexOf(token, System.StringComparison.OrdinalIgnoreCase) >= 0;
}
