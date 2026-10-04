using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Globalization;
using HarmonyLib;
using System.Reflection;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using TaskbarHero;
using TaskbarHero.Data;
using TaskbarHero.Log;
using TaskbarHero.UI;
using UnityEngine;
using UnityEngine.Localization.Settings;
using UnityEngine.Localization.Tables;
using Object = UnityEngine.Object;

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

internal static class RuntimeMonitor
{
	private static readonly object Gate = new object();
	private static readonly object EventGate = new object();
	private static PollutionReading _pollution = new PollutionReading();
	private static readonly ConcurrentQueue<string> Events = new ConcurrentQueue<string>();
	private static readonly Dictionary<int, ItemInfoData> ItemInfoByKey = new Dictionary<int, ItemInfoData>();
	private static readonly Dictionary<string, ItemInfoData> ItemInfoByNameKey = new Dictionary<string, ItemInfoData>(StringComparer.Ordinal);
	private static readonly List<StringTable> LocalizationTables = new List<StringTable>();
	private static readonly HashSet<string> CapturedNativeLogKeys = new HashSet<string>();
	private static readonly Dictionary<string, LogData> CapturedNativeLogObjects = new Dictionary<string, LogData>();
	private static readonly Queue<string> NativeLogKeyOrder = new Queue<string>();
	private static readonly string EventSession = Guid.NewGuid().ToString("N");
	private static long _eventSequence;
	private static long _nativeChestEvents;
	private static long _nativeDropEvents;
	private static int _nativeLogCount;
	private static string _lastNativeLogType = "";
	private static string _lastNativeLogError = "";
	private static long _lastNativeEventAt;
	private static bool _itemInfoLoaded;
	private static DateTime _nextMissingItemInfoRefreshUtc;
	private static string _pendingExchangeBoxLabel = "";
	private static DateTime _pendingExchangeBoxAtUtc;
	private static bool _localizationTablesLoaded;
	private static DateTime _nextLocalizationRetryUtc;
	private static bool _wasInCombat;
	private static float _lastUiPoll;
	private static bool _nativeLogWarningLogged;
	private static bool _unmatchedBoxOpenWarningLogged;
	private static bool _nativeLogManagerFound;
	private static bool _nativeLogInitialScanComplete;
	private static DateTime _battleStartedAtUtc;
	private static string _currentStageName = "";
	private static bool? _currentIsPlague;
	private static int _currentPlagueLevel;
	private static string _lastBattleDrops = "";
	private static DateTime _pendingStageClearObservedAtUtc;
	private static long _pendingStageClearEventTime;
	private static string _pendingStageClearStage = "";
	private static string _pendingStageClearDuration = "";
	private static string _pendingStageClearDrops = "";
	private static long _lastRecordedClearTimeMillis;
	private static string _lastRecordedClearStage = "";
	private static DateTime _lastRecordedClearObservedAtUtc;
	private static bool _corrosionActionInProgress;
	private static bool _corrosionResultSeen;
	private static bool _corrosionResultSucceeded;
    private static int _corrosionResultCode;
    private static string _corrosionResultError = "";
	private static bool _corrosionAnimationActive;
	private static DateTime _corrosionActionStartedAtUtc;
	private static DateTime _corrosionResultAtUtc;
	private static DateTime _corrosionAnimationQuietSinceUtc;

	internal static void BeginCorrosionAction()
	{
		lock (Gate)
		{
			_corrosionActionInProgress = true;
			_corrosionResultSeen = false;
			_corrosionResultSucceeded = false;
            _corrosionResultCode = 0;
            _corrosionResultError = "";
			_corrosionAnimationActive = false;
			_corrosionActionStartedAtUtc = DateTime.UtcNow;
			_corrosionResultAtUtc = default(DateTime);
			_corrosionAnimationQuietSinceUtc = default(DateTime);
		}
	}

    internal static void MarkCorrosionActionResult(bool succeeded, int code, string error)
	{
		lock (Gate)
		{
			if (!_corrosionActionInProgress || _corrosionResultSeen) return;
			_corrosionResultSeen = true;
			_corrosionResultSucceeded = succeeded;
            _corrosionResultCode = code;
            _corrosionResultError = error ?? "";
			_corrosionResultAtUtc = DateTime.UtcNow;
			_corrosionAnimationQuietSinceUtc = default(DateTime);
		}
        InventoryOperationGate.MarkUiInventoryChange();
        if (!succeeded) InventoryOperationGate.MarkServerFailure(code, error);
	}

	internal static void PollCorrosionAnimation()
	{
		lock (Gate)
		{
			if (!_corrosionActionInProgress) return;
		}
		bool active = false;
		try
		{
			UI_Cube cube = Object.FindObjectOfType<UI_Cube>(true);
			Il2CppSystem.Collections.Generic.List<CubeInventorySlot> slots = cube != null && cube.m_cubeSlotSetter != null
				? cube.m_cubeSlotSetter.m_cubeInventorySlots : null;
			if (slots != null)
			{
				for (int i = 0; i < slots.Count; i++)
				{
					CubeInventorySlot slot = slots[i];
					SpriteAnimation_Image effect = slot != null ? slot.m_corrosionEffect : null;
					if (effect != null && effect.isActiveAndEnabled && ((Component)effect).gameObject.activeInHierarchy && effect.bcxb)
					{
						active = true;
						break;
					}
				}
			}
		}
		catch
		{
			// Keep waiting if the animation state cannot be read safely.
			active = true;
		}
		lock (Gate)
		{
			if (!_corrosionActionInProgress) return;
			_corrosionAnimationActive = active;
			if (!_corrosionResultSeen || active)
			{
				_corrosionAnimationQuietSinceUtc = default(DateTime);
			}
			else if (_corrosionAnimationQuietSinceUtc == default(DateTime))
			{
				_corrosionAnimationQuietSinceUtc = DateTime.UtcNow;
			}
		}
	}

    internal static bool IsCorrosionActionPending()
    {
        lock (Gate) return _corrosionActionInProgress;
    }

	internal static string GetCorrosionActionStatus()
	{
		lock (Gate)
		{
            if (_corrosionResultSeen && !_corrosionResultSucceeded)
                return "FAILED|COMPLETE|code=" + _corrosionResultCode
                    + "|error_b64=" + Convert.ToBase64String(Encoding.UTF8.GetBytes(_corrosionResultError));
            if (!_corrosionActionInProgress) return _corrosionResultSeen ? "SUCCESS|COMPLETE" : "SUCCESS|IDLE";
			if (!_corrosionResultSeen || _corrosionAnimationActive
				|| _corrosionAnimationQuietSinceUtc == default(DateTime)
				|| (DateTime.UtcNow - _corrosionResultAtUtc).TotalSeconds < 3d
				|| (DateTime.UtcNow - _corrosionAnimationQuietSinceUtc).TotalSeconds < 1d)
			{
				return "SUCCESS|RUNNING";
			}
			_corrosionActionInProgress = false;
            return _corrosionResultSucceeded ? "SUCCESS|COMPLETE" : "FAILED|COMPLETE|code=" + _corrosionResultCode
                + "|error_b64=" + Convert.ToBase64String(Encoding.UTF8.GetBytes(_corrosionResultError));
		}
	}

	internal static bool IsExcludedCorrosionItemKey(int itemKey, bool excludeInscriptionScrolls,
		bool excludeOfferingCoins, out string itemName, out string exclusion)
	{
		itemName = "";
		exclusion = "";
		if (!excludeInscriptionScrolls && !excludeOfferingCoins) return false;
		if (!TryGetItemInfoByKey(itemKey, out ItemInfoData info) || info == null) return false;
		itemName = ResolveItemName(info.NameKey);
		if (info.ITEMTYPE != EItemType.MATERIAL) return false;
		return CubeBatchPolicy.TryGetCorrosionExclusion(itemName, excludeInscriptionScrolls,
			excludeOfferingCoins, out exclusion);
	}

	internal static PollutionReading GetPollution()
	{
		lock (Gate)
		{
			return new PollutionReading
			{
				IsKnown = _pollution.IsKnown,
				Value = _pollution.Value,
				UpdatedAt = _pollution.UpdatedAt,
				Source = _pollution.Source,
				Max = _pollution.Max,
				ChargeSeconds = _pollution.ChargeSeconds,
				DrainSeconds = _pollution.DrainSeconds,
				EntryMinimum = _pollution.EntryMinimum,
				ObservedAtUtc = _pollution.ObservedAtUtc
			};
		}
	}

	internal static void Capture(long value, string updatedAt, string source, PlaguelandsInitData settings)
	{
		lock (Gate)
		{
			_pollution.IsKnown = true;
			_pollution.Value = Math.Max(0L, value);
			_pollution.UpdatedAt = updatedAt ?? "";
			_pollution.Source = source ?? "unknown";
			_pollution.ObservedAtUtc = DateTime.UtcNow;
			if (settings != null)
			{
				_pollution.Max = settings.PollutionMax;
				_pollution.ChargeSeconds = settings.PollutionChargeSec;
				_pollution.DrainSeconds = settings.PollutionDrainSec;
				_pollution.EntryMinimum = settings.PollutionEntryMin;
			}
		}
		AutoApiPlugin.Logger?.LogInfo((object)("[监控] 污染度更新：" + value + "，来源=" + source + "，服务端时间=" + updatedAt));
	}

	internal static void Capture(long value, string updatedAt, string source)
	{
		Capture(value, updatedAt, source, null);
	}

	internal static string SnapshotEvents(out int count)
	{
		StringBuilder response = new StringBuilder();
		count = 0;
		foreach (string item in Events)
		{
			if (count >= 256) break;
			if (response.Length > 0)
			{
				response.Append('\n');
			}
			response.Append(item);
			count++;
		}
		return response.Length == 0 ? "EMPTY" : response.ToString();
	}

	internal static bool AcknowledgeEvents(int count)
	{
		if (count < 0 || count > 256) return false;
		lock (EventGate)
		{
			for (int i = 0; i < count; i++)
			{
				if (!Events.TryDequeue(out _)) return false;
			}
		}
		return true;
	}

	internal static string GetCurrentStageName()
	{
		string cached;
		lock (Gate)
		{
			cached = _currentStageName;
		}
		if (!string.IsNullOrWhiteSpace(cached) && !cached.Contains('{') && !cached.Contains('}')) return cached;
		string visible = ReadVisibleStageName();
		if (string.IsNullOrWhiteSpace(visible)) return cached ?? "";
		lock (Gate)
		{
			_currentStageName = visible;
		}
		return visible;
	}

	internal static bool IsInCombat()
	{
		lock (Gate)
		{
			return _wasInCombat;
		}
	}

	private static string ReadVisibleStageName()
	{
		try
		{
			UI_Stage stageUi = Object.FindObjectOfType<UI_Stage>(true);
			if ((Object)(object)stageUi == (Object)null || !((Component)stageUi).gameObject.activeInHierarchy || stageUi.text_StageName == null)
			{
				return "";
			}
			string name = stageUi.text_StageName.text ?? "";
			if (string.IsNullOrWhiteSpace(name) || name.Contains('{') || name.Contains('}')) return "";
			name = name.Trim();
			string normalized = name.ToLowerInvariant();
			bool isPlague = ReadPlagueContentType(stageUi)
				?? (normalized.Contains("瘟疫") || normalized.Contains("plague") || normalized.Contains("污染"));
			int level = isPlague ? ParseStageLevel(name) : 0;
			return isPlague && level > 0 ? "瘟疫之地 " + level.ToString(CultureInfo.InvariantCulture) : name;
		}
		catch
		{
			return "";
		}
	}

	internal static void RecordStageStart(wh.StageCache cache)
	{
		try
		{
			StageInfoData stageInfo = cache?.bgqe;
			string stage = null;
			bool plague = false;
			int plagueLevel = 0;
			if (stageInfo != null && stageInfo.StageNo > 0)
			{
				plague = stageInfo.STAGETYPE == EStageType.PLAGUE;
				plagueLevel = plague ? stageInfo.StageNo : 0;
				stage = plague ? "瘟疫之地 " + stageInfo.StageNo
					: "关卡 " + stageInfo.Act + "-" + stageInfo.StageNo;
			}
			lock (Gate)
			{
				if (!string.IsNullOrWhiteSpace(stage)) _currentStageName = stage;
				_currentIsPlague = plague;
				_currentPlagueLevel = plagueLevel;
				_battleStartedAtUtc = DateTime.UtcNow;
				_lastBattleDrops = "";
			}
			AutoApiPlugin.Logger?.LogInfo((object)("[统计] 战斗开始：" + (stage ?? "等待地图名称")));
		}
		catch (Exception ex)
		{
			AutoApiPlugin.Logger?.LogWarning((object)("[统计] 战斗起点读取失败：" + ex.Message));
		}
	}

	internal static string GetGameStatus()
	{
		lock (Gate)
		{
			string stage = Convert.ToBase64String(Encoding.UTF8.GetBytes(_currentStageName ?? ""))
				.TrimEnd('=').Replace('+', '-').Replace('/', '_');
			string pollutionValue = _pollution.IsKnown ? _pollution.Value.ToString(CultureInfo.InvariantCulture) : "?";
			string entryMinimum = _pollution.EntryMinimum > 0 ? _pollution.EntryMinimum.ToString(CultureInfo.InvariantCulture) : "?";
			return "SUCCESS|stage_b64=" + stage
				+ "|is_plague=" + (_currentIsPlague.HasValue ? _currentIsPlague.Value.ToString().ToLowerInvariant() : "?")
				+ "|plague_level=" + _currentPlagueLevel.ToString(CultureInfo.InvariantCulture)
				+ "|pollution=" + pollutionValue
				+ "|pollution_entry_min=" + entryMinimum
				+ "|in_combat=" + _wasInCombat.ToString().ToLowerInvariant() + AutoApiPlugin.RuntimeSignature + AutoApiPlugin.BridgeSignature;
		}
	}

	internal static void PollGameUi()
	{
		if (Time.unscaledTime - _lastUiPoll < 1f)
		{
			return;
		}
		_lastUiPoll = Time.unscaledTime;
		try
		{
			UI_Stage stageUi = Object.FindObjectOfType<UI_Stage>(true);
			if ((Object)(object)stageUi == (Object)null || !((Component)stageUi).gameObject.activeInHierarchy)
			{
				lock (Gate)
				{
					_wasInCombat = false;
				}
				return;
			}
			string stageName = (stageUi.text_StageName != null ? stageUi.text_StageName.text : "") ?? "";
			bool inCombat = stageUi.HealthUI != null && stageUi.HealthUI.alpha > 0.1f;
			bool? contentIsPlague = ReadPlagueContentType(stageUi);
			if (!string.IsNullOrWhiteSpace(stageName) && !stageName.Contains('{') && !stageName.Contains('}'))
			{
				lock (Gate)
				{
					string observedStage = stageName.Trim();
					string normalizedStage = observedStage.ToLowerInvariant();
					bool isPlague = contentIsPlague ?? (normalizedStage.Contains("瘟疫") || normalizedStage.Contains("plague") || normalizedStage.Contains("污染"));
					int plagueLevel = isPlague ? ParseStageLevel(observedStage) : 0;
					_currentStageName = isPlague && plagueLevel > 0 ? "瘟疫之地 " + plagueLevel.ToString(CultureInfo.InvariantCulture) : observedStage;
					_currentIsPlague = isPlague;
					_currentPlagueLevel = plagueLevel;
				}
			}
			if (inCombat && !_wasInCombat)
			{
				if (_battleStartedAtUtc == default(DateTime)) _battleStartedAtUtc = DateTime.UtcNow;
				_lastBattleDrops = "";
			}
			_wasInCombat = inCombat;
		}
		catch (Exception ex)
		{
			AutoApiPlugin.Logger?.LogDebug((object)("[活动统计] 读取关卡界面失败：" + ex.Message));
		}
		finally
		{
			CaptureNativeGameLogs();
			FlushPendingStageClearFallback();
		}
	}

	internal static string GetEventCaptureStatus()
	{
		return "SUCCESS|capture=" + (_nativeLogInitialScanComplete ? "ready" : "waiting")
			+ "|logs=" + _nativeLogCount.ToString(CultureInfo.InvariantCulture)
			+ "|chests=" + Interlocked.Read(ref _nativeChestEvents).ToString(CultureInfo.InvariantCulture)
			+ "|drops=" + Interlocked.Read(ref _nativeDropEvents).ToString(CultureInfo.InvariantCulture)
			+ "|queued=" + Events.Count.ToString(CultureInfo.InvariantCulture)
			+ "|last_event=" + Interlocked.Read(ref _lastNativeEventAt).ToString(CultureInfo.InvariantCulture)
			+ "|last_type=" + _lastNativeLogType
			+ "|error_b64=" + Convert.ToBase64String(Encoding.UTF8.GetBytes(_lastNativeLogError));
	}

	private static void CaptureNativeGameLogs()
	{
		try
		{
			LogManager manager = LogManager.buca;
			Il2CppSystem.Collections.Generic.List<LogData> logs = manager != null ? manager.bhie : null;
			_nativeLogCount = logs != null ? logs.Count : 0;
			if (logs == null || logs.Count == 0)
			{
				if (!_nativeLogInitialScanComplete && manager != null && logs != null && HasBattleStart())
				{
					_nativeLogInitialScanComplete = true;
				}
				return;
			}
			if (!_nativeLogManagerFound)
			{
				_nativeLogManagerFound = true;
				AutoApiPlugin.Logger?.LogInfo((object)("[统计] 已连接游戏原生日志，当前记录数=" + logs.Count));
			}
			bool initialScan = !_nativeLogInitialScanComplete;
			int start = Math.Max(0, logs.Count - 512);
			for (int i = start; i < logs.Count; i++)
			{
				CaptureNativeLog(logs[i], initialScan);
			}
			_nativeLogInitialScanComplete = true;
		}
		catch (Exception ex)
		{
			if (!_nativeLogWarningLogged)
			{
				_nativeLogWarningLogged = true;
				AutoApiPlugin.Logger?.LogWarning((object)("[统计] 游戏原生日志暂不可用：" + ex.Message));
			}
		}
	}

	internal static string RefreshNativeGameLogSnapshot()
	{
		try
		{
			LogManager manager = LogManager.buca;
			Il2CppSystem.Collections.Generic.List<LogData> logs = manager != null ? manager.bhie : null;
			int recordCount = logs != null ? logs.Count : 0;
			int pendingBefore = Events.Count;
			CaptureNativeGameLogs();
			int pendingAfter = Events.Count;
			int newlyQueued = Math.Max(0, pendingAfter - pendingBefore);
			AutoApiPlugin.Logger?.LogInfo((object)("[统计] 手动重扫游戏原生日志：records=" + recordCount
				+ "，queued=" + pendingAfter + "，new=" + newlyQueued));
			return "SUCCESS|logs=" + recordCount.ToString(CultureInfo.InvariantCulture)
				+ "|queued=" + pendingAfter.ToString(CultureInfo.InvariantCulture)
				+ "|new=" + newlyQueued.ToString(CultureInfo.InvariantCulture);
		}
		catch (Exception ex)
		{
			AutoApiPlugin.Logger?.LogWarning((object)("[统计] 重扫游戏原生日志失败：" + ex.Message));
			return "FAILED";
		}
	}

	internal static void CaptureNativeGameLog(LogData log)
	{
		CaptureNativeLog(log, initialScan: !_nativeLogInitialScanComplete);
	}

	private static void CaptureNativeLog(LogData log, bool initialScan)
	{
		if (log is null)
		{
			return;
		}
		try
		{
			string key = log.Pointer.ToString("X");
			lock (CapturedNativeLogKeys)
			{
				if (CapturedNativeLogKeys.Contains(key)) return;
			}
			// IL2CPP collections return LogData wrappers; resolve their native type explicitly.
			GetBoxLog boxLog = log.TryCast<GetBoxLog>();
			BoxOpenLog itemLog = log.TryCast<BoxOpenLog>();
			StageClearLog clearLog = log.TryCast<StageClearLog>();
			StageFailedLog failedLog = log.TryCast<StageFailedLog>();
			string message = itemLog != null || clearLog != null || failedLog != null ? log.lfw() ?? "" : "";
			_lastNativeLogType = boxLog != null ? "GetBoxLog" : itemLog != null ? "BoxOpenLog"
				: clearLog != null ? "StageClearLog" : failedLog != null ? "StageFailedLog" : "Other";
			lock (CapturedNativeLogKeys)
			{
				if (!CapturedNativeLogKeys.Add(key))
				{
					return;
				}
				NativeLogKeyOrder.Enqueue(key);
				// Retain the wrapper while its pointer is a key, so native address reuse is safe.
				CapturedNativeLogObjects[key] = log;
				while (NativeLogKeyOrder.Count > 4096)
				{
					string oldest = NativeLogKeyOrder.Dequeue();
					CapturedNativeLogKeys.Remove(oldest);
					CapturedNativeLogObjects.Remove(oldest);
				}
			}
			// Seed the first snapshot, then process newly observed native log objects.
			if (initialScan)
			{
				return;
			}
			long eventTime = ParseNativeLogTime(log.bhib.ToString("O"));
			if (eventTime < DateTimeOffset.UtcNow.AddDays(-30).ToUnixTimeMilliseconds()
				|| eventTime > DateTimeOffset.UtcNow.AddDays(1).ToUnixTimeMilliseconds())
			{
				eventTime = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
			}
			if (boxLog != null)
			{
				RecordNativeChestBox(boxLog, eventTime);
			}
			else if (itemLog != null)
			{
				RecordNativeBoxOpen(itemLog, message, eventTime);
			}
			else if (clearLog != null)
			{
				RecordNativeStageClear(clearLog, message, eventTime);
			}
			else if (failedLog != null)
			{
				RecordNativeStageFailure(failedLog, message, eventTime);
			}
		}
		catch (Exception ex)
		{
			_lastNativeLogError = ex.Message;
			if (!_nativeLogWarningLogged)
			{
				_nativeLogWarningLogged = true;
				AutoApiPlugin.Logger?.LogWarning((object)("[统计] 读取游戏原生日志失败：" + ex.Message));
			}
		}
	}

	private static void RecordNativeChestBox(GetBoxLog log, long eventTime)
	{
		try
		{
			string category = ReadNativeChestCategory(log);
			if (string.IsNullOrEmpty(category)) return;
			string map = GetCurrentStageName();
			EnqueueAt("chest", eventTime, category, map, "1", log.bhhn ?? "", log.bhho ?? "");
			Interlocked.Increment(ref _nativeChestEvents);
			AutoApiPlugin.Logger?.LogInfo((object)("[统计] 原生宝箱日志：" + category + "，地图=" + (string.IsNullOrWhiteSpace(map) ? "待补全" : map)));
		}
		catch (Exception ex)
		{
			AutoApiPlugin.Logger?.LogDebug((object)("[统计] 读取原生宝箱日志失败：" + ex.Message));
		}
	}

	private static string ReadNativeChestCategory(GetBoxLog log)
	{
		switch (log.bhhp)
		{
			case EMonsterLogType.Monster:
				return "normal";
			case EMonsterLogType.Boss:
				return "rare";
			case EMonsterLogType.ActBoss:
				return "boss";
			default:
				return "";
		}
	}

	private static void RecordNativeBoxOpen(BoxOpenLog log, string message, long eventTime)
	{
		try
		{
			if (log == null || string.IsNullOrWhiteSpace(log.bhgh)) return;
			if (!TryGetRecentDropBoxLabel(out string boxType))
			{
				boxType = "来源未识别";
				if (!_unmatchedBoxOpenWarningLogged)
				{
					_unmatchedBoxOpenWarningLogged = true;
					AutoApiPlugin.Logger?.LogInfo((object)"[统计] 新道具日志已记录；当前开箱来源待补全。");
				}
			}
			EnsureItemInfo();
			ItemInfoData info = ItemInfoByNameKey.TryGetValue(log.bhgh, out ItemInfoData found) ? found : null;
			int grade = (int)log.bhgi;
			string[] grades = new string[] { "普通", "罕见", "稀有", "传说", "不朽", "至宝", "超凡", "天界", "神圣", "宇宙" };
			string quality = grade >= 0 && grade < grades.Length ? grades[grade] : "未知品质";
			string itemName = ResolveItemName(log.bhgh);
			string itemType = info == null ? "未知类型"
				: info.ITEMTYPE == EItemType.GEAR ? "装备"
				: info.ITEMTYPE == EItemType.MATERIAL ? "材料" : info.ITEMTYPE.ToString();
			string map = GetCurrentStageName();
			long count = ParseNativeItemCount(message);
			EnqueueAt("drop", eventTime, map, boxType, itemName, quality,
				grade.ToString(CultureInfo.InvariantCulture), itemType, count.ToString(CultureInfo.InvariantCulture));
			Interlocked.Increment(ref _nativeDropEvents);
			lock (Gate)
			{
				_lastBattleDrops = string.IsNullOrEmpty(_lastBattleDrops)
					? itemName + " ×" + count
					: _lastBattleDrops + "、" + itemName + " ×" + count;
			}
			AutoApiPlugin.Logger?.LogInfo((object)("[统计] 原生开箱掉落：" + itemName + "，品质=" + quality + "，来源=" + boxType));
		}
		catch (Exception ex)
		{
			AutoApiPlugin.Logger?.LogWarning((object)("[统计] 解析原生开箱掉落失败：" + ex.Message));
		}
	}

	private static long ParseNativeItemCount(string message)
	{
		Match match = Regex.Match(message ?? "", @"[×xX]\s*(\d{1,6})");
		return match.Success && long.TryParse(match.Groups[1].Value, NumberStyles.Integer,
			CultureInfo.InvariantCulture, out long count) ? Math.Max(1L, count) : 1L;
	}

	private static bool TryGetRecentDropBoxLabel(out string label)
	{
		lock (Gate)
		{
			if (!string.IsNullOrEmpty(_pendingExchangeBoxLabel)
				&& _pendingExchangeBoxAtUtc != default(DateTime)
				&& (DateTime.UtcNow - _pendingExchangeBoxAtUtc).TotalSeconds >= 0d
				&& (DateTime.UtcNow - _pendingExchangeBoxAtUtc).TotalSeconds <= 30d)
			{
				label = _pendingExchangeBoxLabel;
				return true;
			}
		}
		label = "";
		return false;
	}

	private static int ChestCategoryIndex(string category)
	{
		switch (category)
		{
			case "normal": return 0;
			case "rare": return 1;
			case "boss": return 2;
			default: return -1;
		}
	}

	private static long ParseNativeLogTime(string value)
	{
		try
		{
			if (DateTime.TryParse(value, CultureInfo.CurrentCulture, DateTimeStyles.AssumeLocal, out DateTime local))
			{
				return new DateTimeOffset(local).ToUnixTimeMilliseconds();
			}
			if (DateTime.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.AssumeLocal, out local))
			{
				return new DateTimeOffset(local).ToUnixTimeMilliseconds();
			}
		}
		catch
		{
		}
		return DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
	}

	private static string ParseNativeStageName(string message)
	{
		Match plague = Regex.Match(message ?? "", @"瘟疫之地\s*(\d+)");
		if (plague.Success)
		{
			return "瘟疫之地 " + plague.Groups[1].Value;
		}
		Match stage = Regex.Match(message ?? "", @"关卡\s*(\d+)\s*[-－—]\s*(\d+)");
		if (stage.Success)
		{
			return "关卡 " + stage.Groups[1].Value + "-" + stage.Groups[2].Value;
		}
		Match english = Regex.Match(message ?? "", @"Stage\s*(\d+)\s*[-－]\s*(\d+)", RegexOptions.IgnoreCase);
		return english.Success ? "关卡 " + english.Groups[1].Value + "-" + english.Groups[2].Value : "";
	}

	private static string ParseNativeFailedStageName(string message)
	{
		string stage = ParseNativeStageName(message);
		if (!string.IsNullOrWhiteSpace(stage))
		{
			return stage;
		}
		Match plague = Regex.Match(message ?? "", @"瘟疫之地\s*(\d+)");
		if (plague.Success)
		{
			return "瘟疫之地 " + plague.Groups[1].Value;
		}
		return GetCurrentStageName();
	}

	private static long ParseNativeClearSeconds(string message, float fallbackSeconds)
	{
		Match duration = Regex.Match(message ?? "", @"(?<!\d)(\d{1,6})\s*(?:秒|seconds?|sec\b|s\b)", RegexOptions.IgnoreCase);
		if (duration.Success && long.TryParse(duration.Groups[1].Value, NumberStyles.Integer, CultureInfo.InvariantCulture, out long parsed))
		{
			return parsed;
		}
		return fallbackSeconds > 0f ? Math.Max(0L, (long)Math.Round(fallbackSeconds, MidpointRounding.AwayFromZero)) : 0L;
	}

	private static void RecordNativeStageClear(StageClearLog log, string message, long eventTime)
	{
		string stage = ParseNativeStageName(message);
		if (string.IsNullOrWhiteSpace(stage))
		{
			stage = GetCurrentStageName();
		}
		long duration = ParseNativeClearSeconds(message, log.buxl);
		if (string.IsNullOrWhiteSpace(stage) || stage.Contains('{') || duration <= 0L)
		{
			AutoApiPlugin.Logger?.LogWarning((object)("[统计] 忽略缺少地图或原生耗时的通关日志：" + message));
			return;
		}
		string drops = "";
		lock (Gate)
		{
			// Do not turn the game's login-time replay of saved Records into a new
			// battle row. A clear must belong to a stage observed in this live session.
			if (_battleStartedAtUtc == default(DateTime))
			{
				return;
			}
			if (IsRecentClearDuplicateLocked(stage))
			{
				return;
			}
			if (_pendingStageClearObservedAtUtc != default(DateTime)
				&& string.Equals(stage, _pendingStageClearStage, StringComparison.Ordinal)
				&& (DateTime.UtcNow - _pendingStageClearObservedAtUtc).TotalSeconds <= 15d)
			{
				drops = _pendingStageClearDrops;
				ClearPendingStageClearLocked();
			}
			else if (_battleStartedAtUtc != default(DateTime)
				&& string.Equals(stage, _currentStageName, StringComparison.Ordinal))
			{
				drops = _lastBattleDrops;
				_battleStartedAtUtc = default(DateTime);
				_lastBattleDrops = "";
			}
			MarkClearRecordedLocked(stage, eventTime);
		}
		EnqueueAt("battle", eventTime, stage, duration.ToString(CultureInfo.InvariantCulture), "成功", drops);
		AutoApiPlugin.Logger?.LogInfo((object)("[统计] 原生日志通关：" + stage + "（" + duration + "秒）"));
	}

	private static bool IsRecentClearDuplicateLocked(string stage)
	{
		return string.Equals(stage, _lastRecordedClearStage, StringComparison.Ordinal)
			&& _lastRecordedClearObservedAtUtc != default(DateTime)
			&& (DateTime.UtcNow - _lastRecordedClearObservedAtUtc).TotalSeconds <= 15d;
	}

	private static void MarkClearRecordedLocked(string stage, long eventTime)
	{
		_lastRecordedClearStage = stage ?? "";
		_lastRecordedClearTimeMillis = eventTime;
		_lastRecordedClearObservedAtUtc = DateTime.UtcNow;
	}

	private static void ClearPendingStageClearLocked()
	{
		_pendingStageClearObservedAtUtc = default(DateTime);
		_pendingStageClearEventTime = 0L;
		_pendingStageClearStage = "";
		_pendingStageClearDuration = "";
		_pendingStageClearDrops = "";
	}

	private static void FlushPendingStageClearFallback()
	{
		string stage = "";
		string duration = "";
		string drops = "";
		long eventTime = 0L;
		lock (Gate)
		{
			if (_pendingStageClearObservedAtUtc == default(DateTime)
				|| (DateTime.UtcNow - _pendingStageClearObservedAtUtc).TotalSeconds < 2d)
			{
				return;
			}
			stage = _pendingStageClearStage;
			duration = _pendingStageClearDuration;
			drops = _pendingStageClearDrops;
			eventTime = _pendingStageClearEventTime;
			ClearPendingStageClearLocked();
			if (string.Equals(stage, _currentStageName, StringComparison.Ordinal))
			{
				_battleStartedAtUtc = default(DateTime);
				_lastBattleDrops = "";
			}
			if (IsRecentClearDuplicateLocked(stage))
			{
				return;
			}
			MarkClearRecordedLocked(stage, eventTime);
		}
		EnqueueAt("battle", eventTime, stage, duration, "成功", drops);
		AutoApiPlugin.Logger?.LogInfo((object)("[统计] 成功通关结果已记录（计时回退）：" + stage + "（" + duration + "秒）"));
	}

	private static void RecordNativeStageFailure(StageFailedLog log, string message, long eventTime)
	{
		if (eventTime <= 0L || DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - eventTime > 120000L)
		{
			return;
		}
		string stage = ParseNativeFailedStageName(message);
		long duration = 0L;
		string drops = "";
		lock (Gate)
		{
			if (_battleStartedAtUtc != default(DateTime))
			{
				duration = Math.Max(0L, (long)(DateTime.UtcNow - _battleStartedAtUtc).TotalSeconds);
				drops = _lastBattleDrops;
				_battleStartedAtUtc = default(DateTime);
				_lastBattleDrops = "";
			}
		}
		if (!string.IsNullOrWhiteSpace(stage) && !stage.Contains('{') && duration > 0L)
		{
			EnqueueAt("battle", eventTime, stage, duration.ToString(CultureInfo.InvariantCulture), "失败", drops);
			AutoApiPlugin.Logger?.LogInfo((object)("[统计] 原生日志失败：" + stage + "（" + duration + "秒）"));
		}
	}

	private static bool? ReadPlagueContentType(UI_Stage stageUi)
	{
		try
		{
			object nullableContent = stageUi.betv;
			if (nullableContent == null)
			{
				return null;
			}
			Type type = nullableContent.GetType();
			PropertyInfo hasValue = type.GetProperty("HasValue");
			PropertyInfo value = type.GetProperty("Value");
			if (hasValue == null || value == null || !Convert.ToBoolean(hasValue.GetValue(nullableContent)))
			{
				return null;
			}
			return Convert.ToInt32(value.GetValue(nullableContent)) == (int)EContentType.PLAGUE;
		}
		catch
		{
			return null;
		}
	}

	private static int ParseStageLevel(string stageName)
	{
		int parsed = 0;
		int current = 0;
		for (int i = 0; i < stageName.Length; i++)
		{
			if (char.IsDigit(stageName[i]))
			{
				parsed = parsed * 10 + (stageName[i] - '0');
				current++;
			}
			else if (current > 0)
			{
				if (parsed >= 1 && parsed <= 20) return parsed;
				parsed = 0;
				current = 0;
			}
		}
		return parsed >= 1 && parsed <= 20 ? parsed : 0;
	}

	private static bool HasBattleStart()
	{
		lock (Gate)
		{
			return _battleStartedAtUtc != default(DateTime);
		}
	}

	internal static void RecordInventoryBoxResult(InventoryProcessBoxResult result)
	{
		try
		{
			if (result == null || !result.IsSuccess) return;
			EnsureItemInfo();
			string boxLabel = ResolveBoxType(result.boxes);
			if ("宝箱".Equals(boxLabel, StringComparison.Ordinal)
				&& TryGetRecentDropBoxLabel(out string recentBoxLabel))
			{
				boxLabel = recentBoxLabel;
			}
			if ("宝箱".Equals(boxLabel, StringComparison.Ordinal))
			{
				AutoApiPlugin.Logger?.LogWarning((object)"[统计] 开箱结果没有识别来源宝箱，跳过掉落记录。");
				return;
			}
			RememberBoxSource(boxLabel);
			Il2CppInterop.Runtime.InteropTypes.Arrays.Il2CppReferenceArray<InventoryItemData> added = result.added;
			int addedCount = added != null ? added.Length : 0;
			if (addedCount == 0)
			{
				AutoApiPlugin.Logger?.LogInfo((object)("[统计] 开箱结果来源=" + boxLabel + "，added=0，游戏未返回新增物品。"));
				return;
			}
			string map = GetCurrentStageName();
			long eventTime = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
			string[] grades = new string[] { "普通", "罕见", "稀有", "传说", "不朽", "至宝", "超凡", "天界", "神圣", "宇宙" };
			int recorded = 0;
			for (int i = 0; i < addedCount; i++)
			{
				InventoryItemData item = added[i];
				if (item == null || item.Count <= 0) continue;
				ItemInfoData info = ItemInfoByKey.TryGetValue(item.ItemID, out ItemInfoData found) ? found : null;
				int grade = info == null ? -1 : (int)info.GRADE;
				string quality = grade >= 0 && grade < grades.Length ? grades[grade] : "未知品质";
				string itemName = info == null
					? "未知道具（" + item.ItemID.ToString(CultureInfo.InvariantCulture) + "）"
					: ResolveItemName(info.NameKey);
				string itemType = info == null ? "未知类型"
					: info.ITEMTYPE == EItemType.GEAR ? "装备"
					: info.ITEMTYPE == EItemType.MATERIAL ? "材料" : info.ITEMTYPE.ToString();
				long count = item.Count;
				EnqueueAt("drop", eventTime, map, boxLabel, itemName, quality,
					grade.ToString(CultureInfo.InvariantCulture), itemType, count.ToString(CultureInfo.InvariantCulture));
				lock (Gate)
				{
					_lastBattleDrops = string.IsNullOrEmpty(_lastBattleDrops)
						? itemName + " ×" + count
						: _lastBattleDrops + "、" + itemName + " ×" + count;
				}
				recorded++;
			}
			AutoApiPlugin.Logger?.LogInfo((object)("[统计] 开箱新增物品已入队：来源=" + boxLabel
				+ "，added=" + addedCount.ToString(CultureInfo.InvariantCulture)
				+ "，queued=" + recorded.ToString(CultureInfo.InvariantCulture)));
		}
		catch (Exception ex)
		{
			AutoApiPlugin.Logger?.LogWarning((object)("[统计] 读取开箱新增物品失败：" + ex.Message));
		}
	}

	private static void RememberBoxSource(string label)
	{
		if (string.IsNullOrWhiteSpace(label) || "宝箱".Equals(label, StringComparison.Ordinal)) return;
		lock (Gate)
		{
			_pendingExchangeBoxLabel = label;
			_pendingExchangeBoxAtUtc = DateTime.UtcNow;
		}
	}

	internal static void MarkStageBoxOpening(StageBox box)
	{
		try
		{
			string label = ResolveStageBoxLabel(box);
			RememberBoxSource(label);
			if (!string.IsNullOrWhiteSpace(label))
			{
				AutoApiPlugin.Logger?.LogInfo((object)("[统计] 检测到本次开箱入口：" + label));
			}
		}
		catch (Exception ex)
		{
			AutoApiPlugin.Logger?.LogDebug((object)("[统计] 读取开箱类型失败：" + ex.Message));
		}
	}

	private static string ResolveStageBoxLabel(StageBox box)
	{
		if ((Object)(object)box == (Object)null) return "";
		bool contaminated = box.m_contentType == EContentType.PLAGUE;
		lock (Gate)
		{
			contaminated = contaminated || _currentIsPlague == true;
		}
		switch (box.m_boxType)
		{
			case EBoxType.NORMAL: return contaminated ? "污染怪物宝箱" : "普通宝箱";
			case EBoxType.BOSS: return contaminated ? "污染BOSS宝箱" : "稀有宝箱";
			case EBoxType.ACTBOSS: return contaminated ? "污染章节BOSS宝箱" : "BOSS宝箱";
			default: return "";
		}
	}

	private static void EnsureItemInfo(bool refresh = false)
	{
		if (_itemInfoLoaded && !refresh)
		{
			return;
		}
		List<ItemInfoData> items = AutoApiBehaviour.ItemInfoList();
		if (items == null || items.Count == 0)
		{
			return;
		}
		for (int i = 0; i < items.Count; i++)
		{
			ItemInfoData item = items[i];
			if (item != null)
			{
				ItemInfoByKey[item.ItemKey] = item;
			}
			if (item != null && !string.IsNullOrWhiteSpace(item.NameKey))
			{
				ItemInfoByNameKey[item.NameKey] = item;
			}
		}
		_itemInfoLoaded = ItemInfoByKey.Count > 0;
	}

	private static bool TryGetItemInfoByKey(int itemKey, out ItemInfoData info)
	{
		EnsureItemInfo();
		if (ItemInfoByKey.TryGetValue(itemKey, out info) && info != null) return true;
		if (DateTime.UtcNow >= _nextMissingItemInfoRefreshUtc)
		{
			_nextMissingItemInfoRefreshUtc = DateTime.UtcNow.AddSeconds(2);
			EnsureItemInfo(refresh: true);
		}
		return ItemInfoByKey.TryGetValue(itemKey, out info) && info != null;
	}

	internal static string ResolveItemNameByKey(int itemKey)
	{
		return TryGetItemInfoByKey(itemKey, out ItemInfoData info) && info != null
			? ResolveItemName(info.NameKey) : "";
	}

	internal static string ResolveItemName(string nameKey)
	{
		if (string.IsNullOrWhiteSpace(nameKey))
		{
			return "未知道具";
		}
		try
		{
			EnsureLocalizationTables();
			for (int i = 0; i < LocalizationTables.Count; i++)
			{
				StringTableEntry entry = LocalizationTables[i].GetEntry(nameKey);
				if (entry == null)
				{
					continue;
				}
				string localized = entry.GetLocalizedString();
				if (!string.IsNullOrWhiteSpace(localized) && !string.Equals(localized, nameKey, StringComparison.Ordinal))
				{
					return localized;
				}
			}
		}
		catch
		{
		}
		return nameKey;
	}

	private static void EnsureLocalizationTables()
	{
		if (_localizationTablesLoaded || DateTime.UtcNow < _nextLocalizationRetryUtc)
		{
			return;
		}
		_nextLocalizationRetryUtc = DateTime.UtcNow.AddSeconds(30);
		try
		{
			var locale = LocalizationSettings.SelectedLocale;
			var database = LocalizationSettings.StringDatabase;
			if (locale == null || database == null)
			{
				return;
			}
			var tables = database.GetAllTables(locale).WaitForCompletion();
			if (tables == null)
			{
				return;
			}
			for (int i = 0; i < 128; i++)
			{
				StringTable table;
				try
				{
					table = tables[i];
				}
				catch (Exception)
				{
					break;
				}
				if (table != null) LocalizationTables.Add(table);
			}
			_localizationTablesLoaded = LocalizationTables.Count > 0;
			AutoApiPlugin.Logger.LogInfo((object)("[统计] 道具名称语言表已加载：" + LocalizationTables.Count + "张。"));
		}
		catch (Exception ex)
		{
			AutoApiPlugin.Logger.LogWarning((object)("[统计] 道具名称语言表读取失败：" + ex.Message));
		}
	}

	private static string ResolveBoxType(Il2CppInterop.Runtime.InteropTypes.Arrays.Il2CppReferenceArray<BoxData> boxes)
	{
		if (boxes != null)
		{
			EnsureItemInfo();
			for (int i = 0; i < boxes.Length; i++)
			{
				BoxData box = boxes[i];
				if (box != null && ItemInfoByKey.TryGetValue(box.ItemId, out ItemInfoData info))
				{
					string key = (info.NameKey ?? "").ToLowerInvariant();
					if (key.Contains("contamin") && key.Contains("act")) return "污染章节BOSS宝箱";
					if (key.Contains("contamin") && key.Contains("boss")) return "污染BOSS宝箱";
					if (key.Contains("contamin")) return "污染怪物宝箱";
					if (key.Contains("act") && key.Contains("boss")) return "BOSS宝箱";
					if (key.Contains("boss")) return "稀有宝箱";
					return "普通宝箱";
				}
			}
		}
		return "宝箱";
	}

	internal static void RecordStageClear(StageClearFunctionResult result)
	{
		try
		{
			if (result == null || !result.IsSuccess)
			{
				return;
			}
			if (result.PlagueStageKey > 0)
			{
				lock (Gate)
				{
					_currentIsPlague = true;
				}
			}
			string stage = GetCurrentStageName();
			if (string.IsNullOrWhiteSpace(stage) || stage.Contains('{') || stage.Contains('}'))
			{
				stage = ReadVisibleStageName();
			}
			long eventTime = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
			string drops;
			long durationSeconds;
			lock (Gate)
			{
				if (string.IsNullOrWhiteSpace(stage) || IsRecentClearDuplicateLocked(stage))
				{
					return;
				}
				if (_pendingStageClearObservedAtUtc != default(DateTime)
					&& string.Equals(stage, _pendingStageClearStage, StringComparison.Ordinal))
				{
					return;
				}
				if (_battleStartedAtUtc == default(DateTime))
				{
					AutoApiPlugin.Logger?.LogWarning((object)("[统计] 收到成功通关结果但没有战斗起点：" + stage));
					return;
				}
				durationSeconds = Math.Max(1L, (long)Math.Round((DateTime.UtcNow - _battleStartedAtUtc).TotalSeconds, MidpointRounding.AwayFromZero));
				drops = _lastBattleDrops;
				_pendingStageClearObservedAtUtc = DateTime.UtcNow;
				_pendingStageClearEventTime = eventTime;
				_pendingStageClearStage = stage;
				_pendingStageClearDuration = durationSeconds.ToString(CultureInfo.InvariantCulture);
				_pendingStageClearDrops = drops;
			}
			AutoApiPlugin.Logger?.LogInfo((object)("[统计] 收到成功通关结果，等待原生日志耗时：" + stage));
		}
		catch (Exception ex)
		{
			AutoApiPlugin.Logger?.LogWarning((object)("[活动统计] 记录战斗结果失败：" + ex.Message));
		}
	}

	private static void Enqueue(string type, params string[] fields)
	{
		EnqueueAt(type, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), fields);
	}

	private static void EnqueueAt(string type, long timestamp, params string[] fields)
	{
		StringBuilder line = new StringBuilder("E\t").Append(type).Append('\t')
			.Append(timestamp.ToString(CultureInfo.InvariantCulture));
		for (int i = 0; i < fields.Length; i++)
		{
			string encoded = Convert.ToBase64String(Encoding.UTF8.GetBytes(fields[i] ?? ""))
				.TrimEnd('=').Replace('+', '-').Replace('/', '_');
			line.Append('\t').Append(encoded);
		}
		string eventId = "evt:" + EventSession + ":" + Interlocked.Increment(ref _eventSequence).ToString(CultureInfo.InvariantCulture);
		line.Append('\t').Append(Convert.ToBase64String(Encoding.UTF8.GetBytes(eventId)).TrimEnd('=').Replace('+', '-').Replace('/', '_'));
		Events.Enqueue(line.ToString());
		Interlocked.Exchange(ref _lastNativeEventAt, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
	}
}

internal static class StageStartStatisticsPatch
{
	internal static void Install(Harmony harmony)
	{
		MethodInfo target = AccessTools.Method(typeof(UI_Stage), "igz", new Type[] { typeof(wh.StageCache), typeof(bool) });
		MethodInfo prefix = AccessTools.Method(typeof(StageStartStatisticsPatch), nameof(Prefix));
		if (target == null || prefix == null)
		{
			throw new MissingMethodException("UI_Stage.igz");
		}
		harmony.Patch(target, prefix: new HarmonyMethod(prefix));
	}

	private static void Prefix(wh.StageCache __0)
	{
		RuntimeMonitor.RecordStageStart(__0);
	}
}

internal static class NativeLogStatisticsPatch
{
	internal static void Install(Harmony harmony)
	{
		MethodInfo target = AccessTools.Method(typeof(LogManager), "lgi", new Type[] { typeof(LogData) });
		MethodInfo postfix = AccessTools.Method(typeof(NativeLogStatisticsPatch), nameof(Postfix));
		if (target == null || postfix == null)
		{
			throw new MissingMethodException("LogManager.lgi(LogData)");
		}
		harmony.Patch(target, postfix: new HarmonyMethod(postfix));
	}

	private static void Postfix(LogData __0)
	{
        try { SynthesisActionMonitor.ObserveLiveLog(__0); }
        catch (Exception ex) { AutoApiPlugin.Logger?.LogWarning((object)("[合成结果] 日志监听失败：" + ex.Message)); }
		RuntimeMonitor.CaptureNativeGameLog(__0);
	}
}

internal static class StageBoxOpenStatisticsPatch
{
	internal static void Install(Harmony harmony)
	{
		string[] methodNames = new string[] { "mpc", "mpl", "mpm", "mpp" };
		List<string> installedMethods = new List<string>();
		MethodInfo prefix = AccessTools.Method(typeof(StageBoxOpenStatisticsPatch), nameof(Prefix));
		int installed = 0;
		for (int i = 0; i < methodNames.Length; i++)
		{
			MethodInfo target = AccessTools.Method(typeof(StageBox), methodNames[i]);
			if (target == null) continue;
			harmony.Patch(target, prefix: new HarmonyMethod(prefix));
			installedMethods.Add(methodNames[i]);
			installed++;
		}
		if (installed == 0) throw new MissingMethodException("StageBox open methods");
		AutoApiPlugin.Logger?.LogInfo((object)("[统计] 宝箱开箱入口方法：" + string.Join(",", installedMethods)));
	}

	private static void Prefix(StageBox __instance)
	{
		RuntimeMonitor.MarkStageBoxOpening(__instance);
	}
}

[HarmonyPatch(typeof(InventoryInitResult), nameof(InventoryInitResult.Initialize))]
internal static class InventoryInitPollutionPatch
{
	[HarmonyPostfix]
	private static void Postfix(InventoryInitResult __instance)
	{
		try
		{
			if (__instance != null && __instance.IsSuccess)
			{
				RuntimeMonitor.Capture(__instance.PollutionValue, __instance.PollutionUpdateAt.ToString(), "inventory-init", __instance.Plaguelands);
			}
		}
		catch (Exception ex)
		{
			AutoApiPlugin.Logger?.LogWarning((object)("[监控] 读取库存初始化污染度失败：" + ex.Message));
		}
	}
}

[HarmonyPatch(typeof(CorrosionFunctionResult), nameof(CorrosionFunctionResult.Initialize))]
internal static class CorrosionPollutionPatch
{
	[HarmonyPostfix]
	private static void Postfix(CorrosionFunctionResult __instance)
	{
		try
		{
			if (__instance != null)
			{
				AutoApiPlugin.Logger?.LogInfo((object)("[腐蚀结果] Code=" + __instance.Code + "，IsSuccess=" + __instance.IsSuccess + "，Error=" + (__instance.Error ?? "")));
                RuntimeMonitor.MarkCorrosionActionResult(__instance.IsSuccess, __instance.Code, __instance.Error);
				if (__instance.IsSuccess)
				{
					RuntimeMonitor.Capture(__instance.PollutionValue, __instance.PollutionUpdateAt.ToString(), "corrosion-result");
				}
			}
		}
		catch (Exception ex)
		{
			AutoApiPlugin.Logger?.LogWarning((object)("[监控] 读取腐蚀结果污染度失败：" + ex.Message));
		}
	}
}

internal static class StageClearPollutionPatch
{
	internal static void Install(Harmony harmony)
	{
		MethodInfo target = AccessTools.Method(typeof(StageClearFunctionResult), nameof(StageClearFunctionResult.Initialize));
		MethodInfo postfix = AccessTools.Method(typeof(StageClearPollutionPatch), nameof(Postfix));
		if (target == null || postfix == null) throw new MissingMethodException("StageClearFunctionResult.Initialize");
		harmony.Patch(target, postfix: new HarmonyMethod(postfix));
	}

	private static void Postfix(StageClearFunctionResult __instance)
	{
		try
		{
			if (__instance != null && __instance.IsSuccess)
			{
				RuntimeMonitor.Capture(__instance.PollutionValue, __instance.PollutionUpdateAt.ToString(), "stage-clear");
				RuntimeMonitor.RecordStageClear(__instance);
			}
		}
		catch (Exception ex)
		{
			AutoApiPlugin.Logger?.LogWarning((object)("[监控] 读取关卡结果污染度失败：" + ex.Message));
		}
	}
}

[HarmonyPatch(typeof(InventoryProcessBoxResult), nameof(InventoryProcessBoxResult.Initialize))]
internal static class InventoryBoxPollutionPatch
{
	[HarmonyPostfix]
	private static void Postfix(InventoryProcessBoxResult __instance)
	{
		try
		{
			if (__instance != null && __instance.IsSuccess)
			{
				RuntimeMonitor.Capture(__instance.PollutionValue, __instance.PollutionUpdateAt.ToString(), "inventory-box");
			}
            if (__instance != null)
                InventoryOperationGate.BoxRequestFinished(__instance.Code, __instance.IsSuccess, __instance.Error);
		}
		catch (Exception ex)
		{
			AutoApiPlugin.Logger?.LogWarning((object)("[监控] 读取箱子结果污染度失败：" + ex.Message));
		}
	}
}

