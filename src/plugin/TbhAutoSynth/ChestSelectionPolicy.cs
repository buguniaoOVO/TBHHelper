namespace TbhAutoSynth;

internal static class ChestSelectionPolicy
{
	internal static string Kind(int boxType, bool plague)
	{
		string text = boxType switch
		{
			2 => "actboss",
			1 => "boss",
			0 => "normal",
			_ => "",
		};
		if (text.Length != 0)
		{
			return (plague ? "plague-" : "") + text;
		}
		return "";
	}

	internal static bool Matches(string expected, string kind)
	{
		if (string.IsNullOrEmpty(kind))
		{
			return false;
		}
		if (expected == "white")
		{
			if (!(kind == "normal"))
			{
				return kind == "plague-normal";
			}
			return true;
		}
		if (expected == "blue")
		{
			switch (kind)
			{
			default:
				return kind == "plague-actboss";
			case "boss":
			case "plague-boss":
			case "actboss":
				return true;
			}
		}
		return expected == kind;
	}
}
