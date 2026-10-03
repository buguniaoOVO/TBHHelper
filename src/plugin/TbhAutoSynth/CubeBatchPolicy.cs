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

    internal static bool IsExcludedMaterialName(string nameKey, string name)
    {
        string key = (nameKey ?? "").ToLowerInvariant();
        string label = (name ?? "").ToLowerInvariant();
        return label.Contains("铭文") || label.Contains("铭刻")
            || key.Contains("inscription") || key.Contains("engraving") || key.Contains("engrave");
    }
}
