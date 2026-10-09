using System;
using Il2CppSystem.Collections.Generic;
using TaskbarHero.Log;
using TaskbarHero.UI;
using UnityEngine;

namespace TbhAutoSynth;

internal static class SynthesisActionMonitor
{
	private static readonly object Gate = new object();

	private static bool _pending;

	private static bool _resultSeen;

	private static DateTime _resultAt;

	private static DateTime _quietSince;

	internal static bool IsPending()
	{
		lock (Gate)
		{
			return _pending;
		}
	}

	internal static void Begin()
	{
		lock (Gate)
		{
			_pending = true;
			_resultSeen = false;
			_resultAt = (_quietSince = DateTime.MinValue);
		}
	}

	internal static void ObserveLiveLog(LogData log)
	{
		if (log == null || log.TryCast<CubeSynthesisLog>() == null)
		{
			return;
		}
		InventoryOperationGate.MarkUiInventoryChange();
		lock (Gate)
		{
			if (!_pending || _resultSeen)
			{
				return;
			}
			_resultSeen = true;
			_resultAt = DateTime.UtcNow;
		}
		AutoApiPlugin.Logger?.LogInfo("[合成结果] 已收到游戏本次合成日志，继续等待动画和库存稳定。");
	}

	private static bool Playing(SpriteAnimation_Image effect)
	{
		if (effect != null && effect.isActiveAndEnabled && effect.gameObject.activeInHierarchy)
		{
			return effect.bcxb;
		}
		return false;
	}

	internal static void Poll()
	{
		lock (Gate)
		{
			if (!_pending)
			{
				return;
			}
		}
		bool flag = true;
		try
		{
			UI_Cube uI_Cube = UnityEngine.Object.FindObjectOfType<UI_Cube>(includeInactive: true);
			List<CubeInventorySlot> list = ((uI_Cube != null && uI_Cube.m_cubeSlotSetter != null) ? uI_Cube.m_cubeSlotSetter.m_cubeInventorySlots : null);
			if (list != null)
			{
				flag = false;
				for (int i = 0; i < list.Count; i++)
				{
					CubeInventorySlot cubeInventorySlot = list[i];
					if (cubeInventorySlot != null && (Playing(cubeInventorySlot.m_white_6FrameEffect) || Playing(cubeInventorySlot.m_white_11FrameEffect)))
					{
						flag = true;
						break;
					}
				}
			}
		}
		catch
		{
			flag = true;
		}
		lock (Gate)
		{
			if (_pending)
			{
				if (!_resultSeen | flag)
				{
					_quietSince = DateTime.MinValue;
				}
				else if (_quietSince == DateTime.MinValue)
				{
					_quietSince = DateTime.UtcNow;
				}
			}
		}
	}

	internal static string Status()
	{
		lock (Gate)
		{
			if (!_pending)
			{
				return _resultSeen ? "SUCCESS|COMPLETE" : "SUCCESS|IDLE";
			}
			if (!_resultSeen || _quietSince == DateTime.MinValue || (DateTime.UtcNow - _resultAt).TotalSeconds < 5.0 || (DateTime.UtcNow - _quietSince).TotalSeconds < 5.0)
			{
				return "SUCCESS|RUNNING";
			}
			_pending = false;
			return "SUCCESS|COMPLETE";
		}
	}
}
