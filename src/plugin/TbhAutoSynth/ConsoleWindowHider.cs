using System;
using System.Runtime.InteropServices;

namespace TbhAutoSynth;

/// <summary>
/// BepInEx 会为游戏进程打开一个控制台窗口。桌面助手已提供完整日志，
/// 这里在插件加载时把该窗口隐藏，避免它长期浮在桌面上。
/// 仅隐藏窗口，不结束进程，日志仍照常写入 LogOutput.log。
/// </summary>
internal static class ConsoleWindowHider
{
    private const int SW_HIDE = 0;
    private const uint WM_CLOSE = 0x0010;

    [DllImport("kernel32.dll")]
    private static extern IntPtr GetConsoleWindow();

    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    internal static void Hide()
    {
        try
        {
            IntPtr window = GetConsoleWindow();
            if (window != IntPtr.Zero) ShowWindow(window, SW_HIDE);
        }
        catch (Exception)
        {
        }
    }
}
