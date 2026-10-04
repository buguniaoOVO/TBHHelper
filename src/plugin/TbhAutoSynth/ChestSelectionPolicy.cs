namespace TbhAutoSynth;

internal static class ChestSelectionPolicy
{
    internal static string Kind(int boxType, bool plague)
    {
        string type = boxType == 0 ? "normal" : boxType == 1 ? "boss" : boxType == 2 ? "actboss" : "";
        return type.Length == 0 ? "" : (plague ? "plague-" : "") + type;
    }

    internal static bool Matches(string expected, string kind)
    {
        if (string.IsNullOrEmpty(kind)) return false;
        if (expected == "white") return kind == "normal" || kind == "plague-normal";
        if (expected == "blue") return kind == "boss" || kind == "plague-boss"
            || kind == "actboss" || kind == "plague-actboss";
        return expected == kind;
    }
}
