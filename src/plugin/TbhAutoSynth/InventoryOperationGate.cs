using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

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
		get
		{
			lock (Gate)
			{
				return _clickGapSeconds;
			}
		}
	}

	internal static string ConfigurePacing(int seconds)
	{
		return "SUCCESS|gap_seconds=" + Math.Max(3, Math.Min(300, seconds));
	}

	internal static string ConfigureClickPacing(int seconds)
	{
		lock (Gate)
		{
			_clickGapSeconds = Math.Max(1, Math.Min(300, seconds));
		}
		return "SUCCESS|click_gap_seconds=" + _clickGapSeconds;
	}

	internal static string TryBeginHelperAction()
	{
		string text = Readiness();
		if (text != "READY")
		{
			return "THROTTLED|" + text;
		}
		lock (Gate)
		{
			string text2 = TimedReadinessLocked();
			if (text2 != "READY")
			{
				return "THROTTLED|" + text2;
			}
			_lastHelperActionAtUtc = (_lastChangedAtUtc = DateTime.UtcNow);
			return "READY";
		}
	}

	private static string TimedReadinessLocked()
	{
		if (_lastErrorCode != 0)
		{
			return "FAILED|code=" + _lastErrorCode + "|error_b64=" + Convert.ToBase64String(Encoding.UTF8.GetBytes(_lastError));
		}
		if (PendingBoxRequests.Count > 0)
		{
			return "BUSY|pending_boxes=" + PendingBoxRequests.Count;
		}
		double val = 15.0 - (DateTime.UtcNow - _lastChangedAtUtc).TotalSeconds;
		double val2 = (double)_clickGapSeconds - (DateTime.UtcNow - _lastHelperActionAtUtc).TotalSeconds;
		if (Math.Max(val, val2) > 0.0)
		{
			return "BUSY|wait_seconds=" + Math.Ceiling(Math.Max(val, val2)).ToString(CultureInfo.InvariantCulture);
		}
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
		AutoApiPlugin.Logger?.LogInfo("[库存同步] 开箱请求已提交，等待游戏服务器结果。");
	}

	internal static void BoxRequestFinished(int code, bool succeeded, string error)
	{
		lock (Gate)
		{
			if (PendingBoxRequests.Count > 0)
			{
				IntPtr item = IntPtr.Zero;
				using (HashSet<IntPtr>.Enumerator enumerator = PendingBoxRequests.GetEnumerator())
				{
					if (enumerator.MoveNext())
					{
						item = enumerator.Current;
					}
				}
				PendingBoxRequests.Remove(item);
			}
			_lastChangedAtUtc = DateTime.UtcNow;
			if (!succeeded)
			{
				_lastErrorCode = ((code != 0) ? code : (-1));
				_lastError = error ?? "";
			}
		}
		AutoApiPlugin.Logger?.LogInfo("[库存同步] 开箱结果已返回：Code=" + code + "，成功=" + succeeded);
	}

	internal static void MarkUiInventoryChange()
	{
		lock (Gate)
		{
			_lastChangedAtUtc = DateTime.UtcNow;
		}
	}

	internal static void MarkServerRequestStarted()
	{
		lock (Gate)
		{
			_lastHelperActionAtUtc = (_lastChangedAtUtc = DateTime.UtcNow);
		}
	}

	internal static void MarkServerFailure(int code, string error)
	{
		lock (Gate)
		{
			_lastErrorCode = ((code != 0) ? code : (-1));
			_lastError = error ?? "";
		}
	}

	internal static string Readiness()
	{
		RuntimeMonitor.GetCorrosionActionStatus();
		SynthesisActionMonitor.Status();
		if (RuntimeMonitor.IsCorrosionActionPending() || SynthesisActionMonitor.IsPending())
		{
			lock (Gate)
			{
				if (_lastErrorCode != 0)
				{
					return TimedReadinessLocked();
				}
			}
			return "BUSY|cube_pending=true";
		}
		lock (Gate)
		{
			return TimedReadinessLocked();
		}
	}
}
