using System;
using System.Runtime.InteropServices;

namespace TbhAutoSynth;

internal static class ConsoleWindowHider
{
	private const int SW_HIDE = 0;

	private const uint WM_CLOSE = 16u;

	[DllImport("kernel32.dll")]
	private static extern IntPtr GetConsoleWindow();

	[DllImport("user32.dll")]
	private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

	internal static void Hide()
	{
		try
		{
			IntPtr consoleWindow = GetConsoleWindow();
			if (consoleWindow != IntPtr.Zero)
			{
				ShowWindow(consoleWindow, 0);
			}
		}
		catch (Exception)
		{
		}
	}
}
