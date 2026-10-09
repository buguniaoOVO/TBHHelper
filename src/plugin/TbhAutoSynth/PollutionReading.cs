using System;

namespace TbhAutoSynth;

internal sealed class PollutionReading
{
	internal bool IsKnown;

	internal long Value;

	internal string UpdatedAt = "";

	internal string Source = "";

	internal int Max;

	internal int ChargeSeconds;

	internal int DrainSeconds;

	internal int EntryMinimum;

	internal DateTime ObservedAtUtc;
}
