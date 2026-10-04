using System;
using System.Collections.Generic;
using System.Globalization;
using HarmonyLib;
using TaskbarHero;

namespace TbhAutoSynth;

internal static class InventoryOperationGate
{
    private static readonly object Gate = new object();
    private static readonly HashSet<IntPtr> PendingBoxRequests = new HashSet<IntPtr>();
    private static DateTime _lastChangedAtUtc = DateTime.MinValue;
    private static int _lastErrorCode;
    private static string _lastError = "";
    private static DateTime _lastHelperActionAtUtc = DateTime.MinValue;
    private static int _clickGapSeconds = 5;

    internal static int ClickGapSeconds
    {
        get { lock (Gate) return _clickGapSeconds; }
    }

    internal static string ConfigurePacing(int seconds)
    {
        int gap = Math.Max(3, Math.Min(300, seconds));
        return "SUCCESS|gap_seconds=" + gap;
    }

    internal static string ConfigureClickPacing(int seconds)
    {
        lock (Gate) _clickGapSeconds = Math.Max(1, Math.Min(300, seconds));
        return "SUCCESS|click_gap_seconds=" + _clickGapSeconds;
    }

    internal static string TryBeginHelperAction()
    {
        string readiness = Readiness();
        if (readiness != "READY") return "THROTTLED|" + readiness;
        lock (Gate)
        {
            string current = TimedReadinessLocked();
            if (current != "READY") return "THROTTLED|" + current;
            _lastHelperActionAtUtc = _lastChangedAtUtc = DateTime.UtcNow;
            return "READY";
        }
    }

    private static string TimedReadinessLocked()
    {
        if (_lastErrorCode != 0)
            return "FAILED|code=" + _lastErrorCode + "|error_b64="
                + Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(_lastError));
        if (PendingBoxRequests.Count > 0) return "BUSY|pending_boxes=" + PendingBoxRequests.Count;
        double settle = 15d - (DateTime.UtcNow - _lastChangedAtUtc).TotalSeconds;
        double gap = _clickGapSeconds - (DateTime.UtcNow - _lastHelperActionAtUtc).TotalSeconds;
        if (Math.Max(settle, gap) > 0)
            return "BUSY|wait_seconds=" + Math.Ceiling(Math.Max(settle, gap)).ToString(CultureInfo.InvariantCulture);
        return "READY";
    }

    internal static void BoxRequestStarted(IntPtr pointer)
    {
        lock (Gate)
        {
            PendingBoxRequests.Add(pointer);
            _lastChangedAtUtc = DateTime.UtcNow;
            _lastHelperActionAtUtc = DateTime.UtcNow;
        }
        AutoApiPlugin.Logger?.LogInfo((object)"[库存同步] 开箱请求已提交，等待游戏服务器结果。");
    }

    internal static void BoxRequestFinished(int code, bool succeeded, string error)
    {
        lock (Gate)
        {
            if (PendingBoxRequests.Count > 0)
            {
                IntPtr finished = IntPtr.Zero;
                foreach (IntPtr pointer in PendingBoxRequests) { finished = pointer; break; }
                PendingBoxRequests.Remove(finished);
            }
            _lastChangedAtUtc = DateTime.UtcNow;
            if (!succeeded) { _lastErrorCode = code != 0 ? code : -1; _lastError = error ?? ""; }
        }
        AutoApiPlugin.Logger?.LogInfo((object)("[库存同步] 开箱结果已返回：Code=" + code + "，成功=" + succeeded));
    }

    internal static void MarkUiInventoryChange()
    {
        lock (Gate) _lastChangedAtUtc = DateTime.UtcNow;
    }

    internal static void MarkServerRequestStarted()
    {
        lock (Gate) _lastHelperActionAtUtc = _lastChangedAtUtc = DateTime.UtcNow;
    }

    internal static void MarkServerFailure(int code, string error)
    {
        lock (Gate) { _lastErrorCode = code != 0 ? code : -1; _lastError = error ?? ""; }
    }

    internal static string Readiness()
    {
        RuntimeMonitor.GetCorrosionActionStatus();
        SynthesisActionMonitor.Status();
        if (RuntimeMonitor.IsCorrosionActionPending() || SynthesisActionMonitor.IsPending())
        {
            lock (Gate) { if (_lastErrorCode != 0) return TimedReadinessLocked(); }
            return "BUSY|cube_pending=true";
        }
        lock (Gate)
        {
            return TimedReadinessLocked();
        }
    }
}

[HarmonyPatch(typeof(InventoryProcessBox), nameof(InventoryProcessBox.GetParam))]
internal static class InventoryBoxRequestStartPatch
{
    [HarmonyPrefix]
    private static void Prefix(InventoryProcessBox __instance)
    {
        try { if (__instance != null) InventoryOperationGate.BoxRequestStarted(__instance.Pointer); }
        catch (Exception ex) { AutoApiPlugin.Logger?.LogWarning((object)("[库存同步] 请求监听失败：" + ex.Message)); }
    }
}

[HarmonyPatch(typeof(CorrosionFunctionRequest), nameof(CorrosionFunctionRequest.Initialize))]
internal static class CorrosionRequestDiagnosticPatch
{
    [HarmonyPostfix]
    private static void Postfix(CorrosionFunctionRequest __instance)
    {
        try
        {
            if (__instance == null) return;
            var boxes = __instance.useBoxKeyList;
            var items = __instance.items;
            AutoApiPlugin.Logger?.LogInfo((object)("[腐蚀请求参数] 物品组=" + (items != null ? items.Length : 0)
                + "，关联宝箱=" + (boxes != null ? boxes.Length : 0) + "，魔方等级=" + __instance.cubeLev));
            if (boxes != null)
                for (int i = 0; i < Math.Min(12, boxes.Length); i++)
                    AutoApiPlugin.Logger?.LogInfo((object)("[腐蚀关联宝箱] index=" + i + "，key=" + boxes[i]));
        }
        catch (Exception ex) { AutoApiPlugin.Logger?.LogWarning((object)("[腐蚀请求参数] 读取失败：" + ex.Message)); }
    }
}

[HarmonyPatch(typeof(CorrosionFunction), nameof(CorrosionFunction.GetParam))]
internal static class CorrosionRequestStartPatch
{
    [HarmonyPrefix]
    private static void Prefix()
    {
        try
        {
            if (!RuntimeMonitor.IsCorrosionActionPending()) RuntimeMonitor.BeginCorrosionAction();
            InventoryOperationGate.MarkServerRequestStarted();
            AutoApiPlugin.Logger?.LogInfo((object)("[腐蚀服务器请求] 游戏开始提交，库存状态=" + InventoryOperationGate.Readiness()));
        }
        catch (Exception ex) { AutoApiPlugin.Logger?.LogWarning((object)("[腐蚀服务器请求] 监听失败：" + ex.Message)); }
    }
}
