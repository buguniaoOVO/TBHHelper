using System;
using UnityEngine;
using TaskbarHero.UI;
using TS;

namespace TbhAutoSynth;

internal static class SynthesisActionMonitor
{
    private static readonly object Gate = new object();
    private static bool _pending;
    private static bool _resultSeen;
    private static DateTime _resultAt;
    private static DateTime _quietSince;

    internal static bool IsPending() { lock (Gate) return _pending; }

    internal static void Begin()
    {
        lock (Gate)
        {
            _pending = true;
            _resultSeen = false;
            _resultAt = _quietSince = DateTime.MinValue;
        }
    }

    internal static void ObserveLiveLog(TaskbarHero.Log.LogData log)
    {
        if (log == null || log.TryCast<TaskbarHero.Log.CubeSynthesisLog>() == null) return;
        InventoryOperationGate.MarkUiInventoryChange();
        lock (Gate)
        {
            if (!_pending || _resultSeen) return;
            _resultSeen = true;
            _resultAt = DateTime.UtcNow;
        }
        AutoApiPlugin.Logger?.LogInfo((object)"[合成结果] 已收到游戏本次合成日志，继续等待动画和库存稳定。");
    }

    private static bool Playing(SpriteAnimation_Image effect)
    {
        return effect != null && effect.isActiveAndEnabled && effect.gameObject.activeInHierarchy && effect.bcxb;
    }

    internal static void Poll()
    {
        lock (Gate) { if (!_pending) return; }
        bool active = true;
        try
        {
            UI_Cube cube = UnityEngine.Object.FindObjectOfType<UI_Cube>(true);
            var slots = cube != null && cube.m_cubeSlotSetter != null ? cube.m_cubeSlotSetter.m_cubeInventorySlots : null;
            if (slots != null)
            {
                active = false;
                for (int i = 0; i < slots.Count; i++)
                {
                    var slot = slots[i];
                    if (slot != null && (Playing(slot.m_white_6FrameEffect) || Playing(slot.m_white_11FrameEffect)))
                    { active = true; break; }
                }
            }
        }
        catch { active = true; }
        lock (Gate)
        {
            if (!_pending) return;
            if (!_resultSeen || active) _quietSince = DateTime.MinValue;
            else if (_quietSince == DateTime.MinValue) _quietSince = DateTime.UtcNow;
        }
    }

    internal static string Status()
    {
        lock (Gate)
        {
            if (!_pending) return _resultSeen ? "SUCCESS|COMPLETE" : "SUCCESS|IDLE";
            if (!_resultSeen || _quietSince == DateTime.MinValue
                || (DateTime.UtcNow - _resultAt).TotalSeconds < 5
                || (DateTime.UtcNow - _quietSince).TotalSeconds < 5)
                return "SUCCESS|RUNNING";
            _pending = false;
            return "SUCCESS|COMPLETE";
        }
    }
}
