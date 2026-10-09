using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Globalization;
using System.Reflection;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using Il2CppInterop.Runtime.InteropTypes.Arrays;
using Il2CppSystem.Collections.Generic;
using TaskbarHero;
using TaskbarHero.Data;
using TaskbarHero.Log;
using TaskbarHero.UI;
using UnityEngine;
using UnityEngine.Localization;
using UnityEngine.Localization.Settings;
using UnityEngine.Localization.Tables;

namespace TbhAutoSynth;

internal static class RuntimeMonitor
{
	private static readonly object Gate = new object();

	private static readonly object EventGate = new object();

	private static PollutionReading _pollution = new PollutionReading();

	private static readonly ConcurrentQueue<string> Events = new ConcurrentQueue<string>();

	private static readonly System.Collections.Generic.Dictionary<int, ItemInfoData> ItemInfoByKey = new System.Collections.Generic.Dictionary<int, ItemInfoData>();

	private static readonly System.Collections.Generic.Dictionary<string, ItemInfoData> ItemInfoByNameKey = new System.Collections.Generic.Dictionary<string, ItemInfoData>(StringComparer.Ordinal);

	private static readonly System.Collections.Generic.List<StringTable> LocalizationTables = new System.Collections.Generic.List<StringTable>();

	private static readonly HashSet<string> CapturedNativeLogKeys = new HashSet<string>();

	private static readonly System.Collections.Generic.Dictionary<string, LogData> CapturedNativeLogObjects = new System.Collections.Generic.Dictionary<string, LogData>();

	private static readonly System.Collections.Generic.Queue<string> NativeLogKeyOrder = new System.Collections.Generic.Queue<string>();

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
			_corrosionResultAtUtc = default;
			_corrosionAnimationQuietSinceUtc = default;
		}
	}

	internal static void MarkCorrosionActionResult(bool succeeded, int code, string error)
	{
		lock (Gate)
		{
			if (!_corrosionActionInProgress || _corrosionResultSeen)
			{
				return;
			}
			_corrosionResultSeen = true;
			_corrosionResultSucceeded = succeeded;
			_corrosionResultCode = code;
			_corrosionResultError = error ?? "";
			_corrosionResultAtUtc = DateTime.UtcNow;
			_corrosionAnimationQuietSinceUtc = default;
		}
		InventoryOperationGate.MarkUiInventoryChange();
		if (!succeeded)
		{
			InventoryOperationGate.MarkServerFailure(code, error);
		}
	}

	internal static void PollCorrosionAnimation()
	{
		lock (Gate)
		{
			if (!_corrosionActionInProgress)
			{
				return;
			}
		}
		bool flag = false;
		try
		{
			UI_Cube uI_Cube = UnityEngine.Object.FindObjectOfType<UI_Cube>(includeInactive: true);
			Il2CppSystem.Collections.Generic.List<CubeInventorySlot> list = ((uI_Cube != null && uI_Cube.m_cubeSlotSetter != null) ? uI_Cube.m_cubeSlotSetter.m_cubeInventorySlots : null);
			if (list != null)
			{
				for (int i = 0; i < list.Count; i++)
				{
					CubeInventorySlot cubeInventorySlot = list[i];
					SpriteAnimation_Image spriteAnimation_Image = ((cubeInventorySlot != null) ? cubeInventorySlot.m_corrosionEffect : null);
					if (spriteAnimation_Image != null && spriteAnimation_Image.isActiveAndEnabled && spriteAnimation_Image.gameObject.activeInHierarchy && spriteAnimation_Image.bcxb)
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
			if (_corrosionActionInProgress)
			{
				_corrosionAnimationActive = flag;
				if (!_corrosionResultSeen | flag)
				{
					_corrosionAnimationQuietSinceUtc = default;
				}
				else if (_corrosionAnimationQuietSinceUtc == default(DateTime))
				{
					_corrosionAnimationQuietSinceUtc = DateTime.UtcNow;
				}
			}
		}
	}

	internal static bool IsCorrosionActionPending()
	{
		lock (Gate)
		{
			return _corrosionActionInProgress;
		}
	}

	internal static string GetCorrosionActionStatus()
	{
		lock (Gate)
		{
			if (_corrosionResultSeen && !_corrosionResultSucceeded)
			{
				return "FAILED|COMPLETE|code=" + _corrosionResultCode + "|error_b64=" + Convert.ToBase64String(Encoding.UTF8.GetBytes(_corrosionResultError));
			}
			if (!_corrosionActionInProgress)
			{
				return _corrosionResultSeen ? "SUCCESS|COMPLETE" : "SUCCESS|IDLE";
			}
			if (!_corrosionResultSeen || _corrosionAnimationActive || _corrosionAnimationQuietSinceUtc == default(DateTime) || (DateTime.UtcNow - _corrosionResultAtUtc).TotalSeconds < 3.0 || (DateTime.UtcNow - _corrosionAnimationQuietSinceUtc).TotalSeconds < 1.0)
			{
				return "SUCCESS|RUNNING";
			}
			_corrosionActionInProgress = false;
			return _corrosionResultSucceeded ? "SUCCESS|COMPLETE" : ("FAILED|COMPLETE|code=" + _corrosionResultCode + "|error_b64=" + Convert.ToBase64String(Encoding.UTF8.GetBytes(_corrosionResultError)));
		}
	}

	internal static bool IsExcludedCorrosionItemKey(int itemKey, bool excludeInscriptionScrolls, bool excludeOfferingCoins, out string itemName, out string exclusion)
	{
		itemName = "";
		exclusion = "";
		if (!excludeInscriptionScrolls && !excludeOfferingCoins)
		{
			return false;
		}
		if (!TryGetItemInfoByKey(itemKey, out var info) || info == null)
		{
			return false;
		}
		itemName = ResolveItemName(info.NameKey);
		if (info.ITEMTYPE != EItemType.MATERIAL)
		{
			return false;
		}
		return CubeBatchPolicy.TryGetCorrosionExclusion(itemName, excludeInscriptionScrolls, excludeOfferingCoins, out exclusion);
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
		AutoApiPlugin.Logger?.LogInfo("[监控] 污染度更新：" + value + "，来源=" + source + "，服务端时间=" + updatedAt);
	}

	internal static void Capture(long value, string updatedAt, string source)
	{
		Capture(value, updatedAt, source, null);
	}

	internal static string SnapshotEvents(out int count)
	{
		StringBuilder stringBuilder = new StringBuilder();
		count = 0;
		foreach (string @event in Events)
		{
			if (count >= 256)
			{
				break;
			}
			if (stringBuilder.Length > 0)
			{
				stringBuilder.Append('\n');
			}
			stringBuilder.Append(@event);
			count++;
		}
		if (stringBuilder.Length != 0)
		{
			return stringBuilder.ToString();
		}
		return "EMPTY";
	}

	internal static bool AcknowledgeEvents(int count)
	{
		if (count < 0 || count > 256)
		{
			return false;
		}
		lock (EventGate)
		{
			for (int i = 0; i < count; i++)
			{
				if (!Events.TryDequeue(out var _))
				{
					return false;
				}
			}
		}
		return true;
	}

	internal static string GetCurrentStageName()
	{
		string currentStageName;
		lock (Gate)
		{
			currentStageName = _currentStageName;
		}
		if (!string.IsNullOrWhiteSpace(currentStageName) && !currentStageName.Contains('{') && !currentStageName.Contains('}'))
		{
			return currentStageName;
		}
		string text = ReadVisibleStageName();
		if (string.IsNullOrWhiteSpace(text))
		{
			return currentStageName ?? "";
		}
		lock (Gate)
		{
			_currentStageName = text;
			return text;
		}
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
			UI_Stage uI_Stage = UnityEngine.Object.FindObjectOfType<UI_Stage>(includeInactive: true);
			if (uI_Stage == null || !uI_Stage.gameObject.activeInHierarchy || uI_Stage.text_StageName == null)
			{
				return "";
			}
			string text = uI_Stage.text_StageName.text ?? "";
			if (string.IsNullOrWhiteSpace(text) || text.Contains('{') || text.Contains('}'))
			{
				return "";
			}
			text = text.Trim();
			string text2 = text.ToLowerInvariant();
			bool? flag = ReadPlagueContentType(uI_Stage);
			int num;
			if (!flag.HasValue)
			{
				if (text2.Contains("瘟疫") || text2.Contains("plague"))
				{
					num = 1;
					goto IL_00cf;
				}
				num = (text2.Contains("污染") ? 1 : 0);
			}
			else
			{
				num = ((flag == true) ? 1 : 0);
			}
			if (num != 0)
			{
				goto IL_00cf;
			}
			int num2 = 0;
			goto IL_00d5;
			IL_00cf:
			num2 = ParseStageLevel(text);
			goto IL_00d5;
			IL_00d5:
			int num3 = num2;
			return (num != 0 && num3 > 0) ? ("瘟疫之地 " + num3.ToString(CultureInfo.InvariantCulture)) : text;
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
			StageInfoData stageInfoData = cache?.bgqe;
			string text = null;
			bool flag = false;
			int currentPlagueLevel = 0;
			if (stageInfoData != null && stageInfoData.StageNo > 0)
			{
				flag = stageInfoData.STAGETYPE == EStageType.PLAGUE;
				currentPlagueLevel = (flag ? stageInfoData.StageNo : 0);
				text = (flag ? ("瘟疫之地 " + stageInfoData.StageNo) : ("关卡 " + stageInfoData.Act + "-" + stageInfoData.StageNo));
			}
			lock (Gate)
			{
				if (!string.IsNullOrWhiteSpace(text))
				{
					_currentStageName = text;
				}
				_currentIsPlague = flag;
				_currentPlagueLevel = currentPlagueLevel;
				_battleStartedAtUtc = DateTime.UtcNow;
				_lastBattleDrops = "";
			}
			AutoApiPlugin.Logger?.LogInfo("[统计] 战斗开始：" + (text ?? "等待地图名称"));
		}
		catch (Exception ex)
		{
			AutoApiPlugin.Logger?.LogWarning("[统计] 战斗起点读取失败：" + ex.Message);
		}
	}

	internal static string GetGameStatus()
	{
		lock (Gate)
		{
			string text = Convert.ToBase64String(Encoding.UTF8.GetBytes(_currentStageName ?? "")).TrimEnd('=').Replace('+', '-')
				.Replace('/', '_');
			string text2 = (_pollution.IsKnown ? _pollution.Value.ToString(CultureInfo.InvariantCulture) : "?");
			string text3 = ((_pollution.EntryMinimum > 0) ? _pollution.EntryMinimum.ToString(CultureInfo.InvariantCulture) : "?");
			return "SUCCESS|stage_b64=" + text + "|is_plague=" + (_currentIsPlague.HasValue ? _currentIsPlague.Value.ToString().ToLowerInvariant() : "?") + "|plague_level=" + _currentPlagueLevel.ToString(CultureInfo.InvariantCulture) + "|pollution=" + text2 + "|pollution_entry_min=" + text3 + "|in_combat=" + _wasInCombat.ToString().ToLowerInvariant() + AutoApiPlugin.RuntimeSignature + AutoApiPlugin.BridgeSignature;
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
			UI_Stage uI_Stage = UnityEngine.Object.FindObjectOfType<UI_Stage>(includeInactive: true);
			if (uI_Stage == null || !uI_Stage.gameObject.activeInHierarchy)
			{
				lock (Gate)
				{
					_wasInCombat = false;
					return;
				}
			}
			string text = ((uI_Stage.text_StageName != null) ? uI_Stage.text_StageName.text : "") ?? "";
			bool flag = uI_Stage.HealthUI != null && uI_Stage.HealthUI.alpha > 0.1f;
			bool? flag2 = ReadPlagueContentType(uI_Stage);
			if (!string.IsNullOrWhiteSpace(text) && !text.Contains('{') && !text.Contains('}'))
			{
				lock (Gate)
				{
					string text2 = text.Trim();
					string text3 = text2.ToLowerInvariant();
					bool flag3 = flag2 ?? (text3.Contains("瘟疫") || text3.Contains("plague") || text3.Contains("污染"));
					int num = (flag3 ? ParseStageLevel(text2) : 0);
					_currentStageName = ((flag3 && num > 0) ? ("瘟疫之地 " + num.ToString(CultureInfo.InvariantCulture)) : text2);
					_currentIsPlague = flag3;
					_currentPlagueLevel = num;
				}
			}
			if (flag && !_wasInCombat)
			{
				if (_battleStartedAtUtc == default(DateTime))
				{
					_battleStartedAtUtc = DateTime.UtcNow;
				}
				_lastBattleDrops = "";
			}
			_wasInCombat = flag;
		}
		catch (Exception ex)
		{
			AutoApiPlugin.Logger?.LogDebug("[活动统计] 读取关卡界面失败：" + ex.Message);
		}
		finally
		{
			CaptureNativeGameLogs();
			FlushPendingStageClearFallback();
		}
	}

	internal static string GetEventCaptureStatus()
	{
		return "SUCCESS|capture=" + (_nativeLogInitialScanComplete ? "ready" : "waiting") + "|logs=" + _nativeLogCount.ToString(CultureInfo.InvariantCulture) + "|chests=" + Interlocked.Read(ref _nativeChestEvents).ToString(CultureInfo.InvariantCulture) + "|drops=" + Interlocked.Read(ref _nativeDropEvents).ToString(CultureInfo.InvariantCulture) + "|queued=" + Events.Count.ToString(CultureInfo.InvariantCulture) + "|last_event=" + Interlocked.Read(ref _lastNativeEventAt).ToString(CultureInfo.InvariantCulture) + "|last_type=" + _lastNativeLogType + "|error_b64=" + Convert.ToBase64String(Encoding.UTF8.GetBytes(_lastNativeLogError));
	}

	private static void CaptureNativeGameLogs()
	{
		try
		{
			LogManager logManager = ob<LogManager>.buca;
			Il2CppSystem.Collections.Generic.List<LogData> list = ((logManager != null) ? logManager.bhie : null);
			_nativeLogCount = list?.Count ?? 0;
			if (list == null || list.Count == 0)
			{
				if (!_nativeLogInitialScanComplete && logManager != null && list != null && HasBattleStart())
				{
					_nativeLogInitialScanComplete = true;
				}
				return;
			}
			if (!_nativeLogManagerFound)
			{
				_nativeLogManagerFound = true;
				AutoApiPlugin.Logger?.LogInfo("[统计] 已连接游戏原生日志，当前记录数=" + list.Count);
			}
			bool initialScan = !_nativeLogInitialScanComplete;
			for (int i = Math.Max(0, list.Count - 512); i < list.Count; i++)
			{
				CaptureNativeLog(list[i], initialScan);
			}
			_nativeLogInitialScanComplete = true;
		}
		catch (Exception ex)
		{
			if (!_nativeLogWarningLogged)
			{
				_nativeLogWarningLogged = true;
				AutoApiPlugin.Logger?.LogWarning("[统计] 游戏原生日志暂不可用：" + ex.Message);
			}
		}
	}

	internal static string RefreshNativeGameLogSnapshot()
	{
		try
		{
			LogManager logManager = ob<LogManager>.buca;
			int num = ((logManager != null) ? logManager.bhie : null)?.Count ?? 0;
			int count = Events.Count;
			CaptureNativeGameLogs();
			int count2 = Events.Count;
			int num2 = Math.Max(0, count2 - count);
			AutoApiPlugin.Logger?.LogInfo("[统计] 手动重扫游戏原生日志：records=" + num + "，queued=" + count2 + "，new=" + num2);
			return "SUCCESS|logs=" + num.ToString(CultureInfo.InvariantCulture) + "|queued=" + count2.ToString(CultureInfo.InvariantCulture) + "|new=" + num2.ToString(CultureInfo.InvariantCulture);
		}
		catch (Exception ex)
		{
			AutoApiPlugin.Logger?.LogWarning("[统计] 重扫游戏原生日志失败：" + ex.Message);
			return "FAILED";
		}
	}

	internal static void CaptureNativeGameLog(LogData log)
	{
		CaptureNativeLog(log, !_nativeLogInitialScanComplete);
	}

	private static void CaptureNativeLog(LogData log, bool initialScan)
	{
		if (log == null)
		{
			return;
		}
		try
		{
			string text = log.Pointer.ToString("X");
			lock (CapturedNativeLogKeys)
			{
				if (CapturedNativeLogKeys.Contains(text))
				{
					return;
				}
			}
			GetBoxLog getBoxLog = log.TryCast<GetBoxLog>();
			BoxOpenLog boxOpenLog = log.TryCast<BoxOpenLog>();
			StageClearLog stageClearLog = log.TryCast<StageClearLog>();
			StageFailedLog stageFailedLog = log.TryCast<StageFailedLog>();
			string message = ((boxOpenLog != null || stageClearLog != null || stageFailedLog != null) ? (log.lfw() ?? "") : "");
			string lastNativeLogType;
			if (getBoxLog != null)
			{
				lastNativeLogType = "GetBoxLog";
			}
			else if (boxOpenLog != null)
			{
				lastNativeLogType = "BoxOpenLog";
			}
			else if (stageClearLog != null)
			{
				lastNativeLogType = "StageClearLog";
			}
			else
			{
				lastNativeLogType = ((stageFailedLog != null) ? "StageFailedLog" : "Other");
			}
			_lastNativeLogType = lastNativeLogType;
			lock (CapturedNativeLogKeys)
			{
				if (!CapturedNativeLogKeys.Add(text))
				{
					return;
				}
				NativeLogKeyOrder.Enqueue(text);
				CapturedNativeLogObjects[text] = log;
				while (NativeLogKeyOrder.Count > 4096)
				{
					string text2 = NativeLogKeyOrder.Dequeue();
					CapturedNativeLogKeys.Remove(text2);
					CapturedNativeLogObjects.Remove(text2);
				}
			}
			if (!initialScan)
			{
				long num = ParseNativeLogTime(log.bhib.ToString("O"));
				if (num < DateTimeOffset.UtcNow.AddDays(-30.0).ToUnixTimeMilliseconds() || num > DateTimeOffset.UtcNow.AddDays(1.0).ToUnixTimeMilliseconds())
				{
					num = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
				}
				if (getBoxLog != null)
				{
					RecordNativeChestBox(getBoxLog, num);
				}
				else if (boxOpenLog != null)
				{
					RecordNativeBoxOpen(boxOpenLog, message, num);
				}
				else if (stageClearLog != null)
				{
					RecordNativeStageClear(stageClearLog, message, num);
				}
				else if (stageFailedLog != null)
				{
					RecordNativeStageFailure(stageFailedLog, message, num);
				}
			}
		}
		catch (Exception ex)
		{
			_lastNativeLogError = ex.Message;
			if (!_nativeLogWarningLogged)
			{
				_nativeLogWarningLogged = true;
				AutoApiPlugin.Logger?.LogWarning("[统计] 读取游戏原生日志失败：" + ex.Message);
			}
		}
	}

	private static void RecordNativeChestBox(GetBoxLog log, long eventTime)
	{
		try
		{
			string text = ReadNativeChestCategory(log);
			if (!string.IsNullOrEmpty(text))
			{
				string currentStageName = GetCurrentStageName();
				EnqueueAt("chest", eventTime, text, currentStageName, "1", log.bhhn ?? "", log.bhho ?? "");
				Interlocked.Increment(ref _nativeChestEvents);
				AutoApiPlugin.Logger?.LogInfo("[统计] 原生宝箱日志：" + text + "，地图=" + (string.IsNullOrWhiteSpace(currentStageName) ? "待补全" : currentStageName));
			}
		}
		catch (Exception ex)
		{
			AutoApiPlugin.Logger?.LogDebug("[统计] 读取原生宝箱日志失败：" + ex.Message);
		}
	}

	private static string ReadNativeChestCategory(GetBoxLog log)
	{
		return log.bhhp switch
		{
			EMonsterLogType.Monster => "normal",
			EMonsterLogType.Boss => "rare",
			EMonsterLogType.ActBoss => "boss",
			_ => "",
		};
	}

	private static void RecordNativeBoxOpen(BoxOpenLog log, string message, long eventTime)
	{
		try
		{
			if (log == null || string.IsNullOrWhiteSpace(log.bhgh))
			{
				return;
			}
			if (!TryGetRecentDropBoxLabel(out var label))
			{
				label = "来源未识别";
				if (!_unmatchedBoxOpenWarningLogged)
				{
					_unmatchedBoxOpenWarningLogged = true;
					AutoApiPlugin.Logger?.LogInfo("[统计] 新道具日志已记录；当前开箱来源待补全。");
				}
			}
			EnsureItemInfo();
			ItemInfoData itemInfoData = (ItemInfoByNameKey.TryGetValue(log.bhgh, out var value) ? value : null);
			int bhgi = (int)log.bhgi;
			string[] array = new string[10] { "普通", "罕见", "稀有", "传说", "不朽", "至宝", "超凡", "天界", "神圣", "宇宙" };
			string text = ((bhgi >= 0 && bhgi < array.Length) ? array[bhgi] : "未知品质");
			string text2 = ResolveItemName(log.bhgh);
			string text3;
			if (itemInfoData == null)
			{
				text3 = "未知类型";
			}
			else if (itemInfoData.ITEMTYPE == EItemType.GEAR)
			{
				text3 = "装备";
			}
			else
			{
				text3 = ((itemInfoData.ITEMTYPE == EItemType.MATERIAL) ? "材料" : itemInfoData.ITEMTYPE.ToString());
			}
			string currentStageName = GetCurrentStageName();
			long num = ParseNativeItemCount(message);
			EnqueueAt("drop", eventTime, currentStageName, label, text2, text, bhgi.ToString(CultureInfo.InvariantCulture), text3, num.ToString(CultureInfo.InvariantCulture));
			Interlocked.Increment(ref _nativeDropEvents);
			lock (Gate)
			{
				_lastBattleDrops = (string.IsNullOrEmpty(_lastBattleDrops) ? (text2 + " ×" + num) : (_lastBattleDrops + "、" + text2 + " ×" + num));
			}
			AutoApiPlugin.Logger?.LogInfo("[统计] 原生开箱掉落：" + text2 + "，品质=" + text + "，来源=" + label);
		}
		catch (Exception ex)
		{
			AutoApiPlugin.Logger?.LogWarning("[统计] 解析原生开箱掉落失败：" + ex.Message);
		}
	}

	private static long ParseNativeItemCount(string message)
	{
		Match match = Regex.Match(message ?? "", "[×xX]\\s*(\\d{1,6})");
		if (!match.Success || !long.TryParse(match.Groups[1].Value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var result))
		{
			return 1L;
		}
		return Math.Max(1L, result);
	}

	private static bool TryGetRecentDropBoxLabel(out string label)
	{
		lock (Gate)
		{
			if (!string.IsNullOrEmpty(_pendingExchangeBoxLabel) && _pendingExchangeBoxAtUtc != default(DateTime) && (DateTime.UtcNow - _pendingExchangeBoxAtUtc).TotalSeconds >= 0.0 && (DateTime.UtcNow - _pendingExchangeBoxAtUtc).TotalSeconds <= 30.0)
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
		return category switch
		{
			"normal" => 0,
			"rare" => 1,
			"boss" => 2,
			_ => -1,
		};
	}

	private static long ParseNativeLogTime(string value)
	{
		try
		{
			if (DateTime.TryParse(value, CultureInfo.CurrentCulture, DateTimeStyles.AssumeLocal, out var result))
			{
				return new DateTimeOffset(result).ToUnixTimeMilliseconds();
			}
			if (DateTime.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.AssumeLocal, out result))
			{
				return new DateTimeOffset(result).ToUnixTimeMilliseconds();
			}
		}
		catch
		{
		}
		return DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
	}

	private static string ParseNativeStageName(string message)
	{
		Match match = Regex.Match(message ?? "", "瘟疫之地\\s*(\\d+)");
		if (match.Success)
		{
			return "瘟疫之地 " + match.Groups[1].Value;
		}
		Match match2 = Regex.Match(message ?? "", "关卡\\s*(\\d+)\\s*[-－—]\\s*(\\d+)");
		if (match2.Success)
		{
			return "关卡 " + match2.Groups[1].Value + "-" + match2.Groups[2].Value;
		}
		Match match3 = Regex.Match(message ?? "", "Stage\\s*(\\d+)\\s*[-－]\\s*(\\d+)", RegexOptions.IgnoreCase);
		if (!match3.Success)
		{
			return "";
		}
		return "关卡 " + match3.Groups[1].Value + "-" + match3.Groups[2].Value;
	}

	private static string ParseNativeFailedStageName(string message)
	{
		string text = ParseNativeStageName(message);
		if (!string.IsNullOrWhiteSpace(text))
		{
			return text;
		}
		Match match = Regex.Match(message ?? "", "瘟疫之地\\s*(\\d+)");
		if (match.Success)
		{
			return "瘟疫之地 " + match.Groups[1].Value;
		}
		return GetCurrentStageName();
	}

	private static long ParseNativeClearSeconds(string message, float fallbackSeconds)
	{
		Match match = Regex.Match(message ?? "", "(?<!\\d)(\\d{1,6})\\s*(?:秒|seconds?|sec\\b|s\\b)", RegexOptions.IgnoreCase);
		if (match.Success && long.TryParse(match.Groups[1].Value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var result))
		{
			return result;
		}
		if (!(fallbackSeconds > 0f))
		{
			return 0L;
		}
		return Math.Max(0L, (long)Math.Round(fallbackSeconds, MidpointRounding.AwayFromZero));
	}

	private static void RecordNativeStageClear(StageClearLog log, string message, long eventTime)
	{
		string text = ParseNativeStageName(message);
		if (string.IsNullOrWhiteSpace(text))
		{
			text = GetCurrentStageName();
		}
		long num = ParseNativeClearSeconds(message, log.buxl);
		if (string.IsNullOrWhiteSpace(text) || text.Contains('{') || num <= 0)
		{
			AutoApiPlugin.Logger?.LogWarning("[统计] 忽略缺少地图或原生耗时的通关日志：" + message);
			return;
		}
		string text2 = "";
		lock (Gate)
		{
			if (_battleStartedAtUtc == default(DateTime) || IsRecentClearDuplicateLocked(text))
			{
				return;
			}
			if (_pendingStageClearObservedAtUtc != default(DateTime) && string.Equals(text, _pendingStageClearStage, StringComparison.Ordinal) && (DateTime.UtcNow - _pendingStageClearObservedAtUtc).TotalSeconds <= 15.0)
			{
				text2 = _pendingStageClearDrops;
				ClearPendingStageClearLocked();
			}
			else if (_battleStartedAtUtc != default(DateTime) && string.Equals(text, _currentStageName, StringComparison.Ordinal))
			{
				text2 = _lastBattleDrops;
				_battleStartedAtUtc = default;
				_lastBattleDrops = "";
			}
			MarkClearRecordedLocked(text, eventTime);
		}
		EnqueueAt("battle", eventTime, text, num.ToString(CultureInfo.InvariantCulture), "成功", text2);
		AutoApiPlugin.Logger?.LogInfo("[统计] 原生日志通关：" + text + "（" + num + "秒）");
	}

	private static bool IsRecentClearDuplicateLocked(string stage)
	{
		if (string.Equals(stage, _lastRecordedClearStage, StringComparison.Ordinal) && _lastRecordedClearObservedAtUtc != default(DateTime))
		{
			return (DateTime.UtcNow - _lastRecordedClearObservedAtUtc).TotalSeconds <= 15.0;
		}
		return false;
	}

	private static void MarkClearRecordedLocked(string stage, long eventTime)
	{
		_lastRecordedClearStage = stage ?? "";
		_lastRecordedClearTimeMillis = eventTime;
		_lastRecordedClearObservedAtUtc = DateTime.UtcNow;
	}

	private static void ClearPendingStageClearLocked()
	{
		_pendingStageClearObservedAtUtc = default;
		_pendingStageClearEventTime = 0L;
		_pendingStageClearStage = "";
		_pendingStageClearDuration = "";
		_pendingStageClearDrops = "";
	}

	private static void FlushPendingStageClearFallback()
	{
		string text = "";
		string text2 = "";
		string text3 = "";
		long num = 0L;
		lock (Gate)
		{
			if (_pendingStageClearObservedAtUtc == default(DateTime) || (DateTime.UtcNow - _pendingStageClearObservedAtUtc).TotalSeconds < 2.0)
			{
				return;
			}
			text = _pendingStageClearStage;
			text2 = _pendingStageClearDuration;
			text3 = _pendingStageClearDrops;
			num = _pendingStageClearEventTime;
			ClearPendingStageClearLocked();
			if (string.Equals(text, _currentStageName, StringComparison.Ordinal))
			{
				_battleStartedAtUtc = default;
				_lastBattleDrops = "";
			}
			if (IsRecentClearDuplicateLocked(text))
			{
				return;
			}
			MarkClearRecordedLocked(text, num);
		}
		EnqueueAt("battle", num, text, text2, "成功", text3);
		AutoApiPlugin.Logger?.LogInfo("[统计] 成功通关结果已记录（计时回退）：" + text + "（" + text2 + "秒）");
	}

	private static void RecordNativeStageFailure(StageFailedLog log, string message, long eventTime)
	{
		if (eventTime <= 0 || DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - eventTime > 120000)
		{
			return;
		}
		string text = ParseNativeFailedStageName(message);
		long num = 0L;
		string text2 = "";
		lock (Gate)
		{
			if (_battleStartedAtUtc != default(DateTime))
			{
				num = Math.Max(0L, (long)(DateTime.UtcNow - _battleStartedAtUtc).TotalSeconds);
				text2 = _lastBattleDrops;
				_battleStartedAtUtc = default;
				_lastBattleDrops = "";
			}
		}
		if (!string.IsNullOrWhiteSpace(text) && !text.Contains('{') && num > 0)
		{
			EnqueueAt("battle", eventTime, text, num.ToString(CultureInfo.InvariantCulture), "失败", text2);
			AutoApiPlugin.Logger?.LogInfo("[统计] 原生日志失败：" + text + "（" + num + "秒）");
		}
	}

	private static bool? ReadPlagueContentType(UI_Stage stageUi)
	{
		try
		{
			object betv = stageUi.betv;
			if (betv == null)
			{
				return null;
			}
			Type type = betv.GetType();
			PropertyInfo property = type.GetProperty("HasValue");
			PropertyInfo property2 = type.GetProperty("Value");
			if (property == null || property2 == null || !Convert.ToBoolean(property.GetValue(betv)))
			{
				return null;
			}
			return Convert.ToInt32(property2.GetValue(betv)) == 1;
		}
		catch
		{
			return null;
		}
	}

	private static int ParseStageLevel(string stageName)
	{
		int num = 0;
		int num2 = 0;
		for (int i = 0; i < stageName.Length; i++)
		{
			if (char.IsDigit(stageName[i]))
			{
				num = num * 10 + (stageName[i] - 48);
				num2++;
			}
			else if (num2 > 0)
			{
				if (num >= 1 && num <= 20)
				{
					return num;
				}
				num = 0;
				num2 = 0;
			}
		}
		if (num < 1 || num > 20)
		{
			return 0;
		}
		return num;
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
			if (result == null || !result.IsSuccess)
			{
				return;
			}
			EnsureItemInfo();
			string text = ResolveBoxType(result.boxes);
			if ("宝箱".Equals(text, StringComparison.Ordinal) && TryGetRecentDropBoxLabel(out var label))
			{
				text = label;
			}
			if ("宝箱".Equals(text, StringComparison.Ordinal))
			{
				AutoApiPlugin.Logger?.LogWarning("[统计] 开箱结果没有识别来源宝箱，跳过掉落记录。");
				return;
			}
			RememberBoxSource(text);
			Il2CppReferenceArray<InventoryItemData> added = result.added;
			int num = added?.Length ?? 0;
			if (num == 0)
			{
				AutoApiPlugin.Logger?.LogInfo("[统计] 开箱结果来源=" + text + "，added=0，游戏未返回新增物品。");
				return;
			}
			string currentStageName = GetCurrentStageName();
			long timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
			string[] array = new string[10] { "普通", "罕见", "稀有", "传说", "不朽", "至宝", "超凡", "天界", "神圣", "宇宙" };
			int num2 = 0;
			for (int i = 0; i < num; i++)
			{
				InventoryItemData inventoryItemData = added[i];
				if (inventoryItemData != null && inventoryItemData.Count > 0)
				{
					ItemInfoData itemInfoData = (ItemInfoByKey.TryGetValue(inventoryItemData.ItemID, out var value) ? value : null);
					int num3 = (int)(itemInfoData?.GRADE ?? ((EGradeType)(-1)));
					string text2 = ((num3 >= 0 && num3 < array.Length) ? array[num3] : "未知品质");
					string text3 = ((itemInfoData == null) ? ("未知道具（" + inventoryItemData.ItemID.ToString(CultureInfo.InvariantCulture) + "）") : ResolveItemName(itemInfoData.NameKey));
					string text4;
					if (itemInfoData == null)
					{
						text4 = "未知类型";
					}
					else if (itemInfoData.ITEMTYPE == EItemType.GEAR)
					{
						text4 = "装备";
					}
					else
					{
						text4 = ((itemInfoData.ITEMTYPE == EItemType.MATERIAL) ? "材料" : itemInfoData.ITEMTYPE.ToString());
					}
					long num4 = inventoryItemData.Count;
					EnqueueAt("drop", timestamp, currentStageName, text, text3, text2, num3.ToString(CultureInfo.InvariantCulture), text4, num4.ToString(CultureInfo.InvariantCulture));
					lock (Gate)
					{
						_lastBattleDrops = (string.IsNullOrEmpty(_lastBattleDrops) ? (text3 + " ×" + num4) : (_lastBattleDrops + "、" + text3 + " ×" + num4));
					}
					num2++;
				}
			}
			AutoApiPlugin.Logger?.LogInfo("[统计] 开箱新增物品已入队：来源=" + text + "，added=" + num.ToString(CultureInfo.InvariantCulture) + "，queued=" + num2.ToString(CultureInfo.InvariantCulture));
		}
		catch (Exception ex)
		{
			AutoApiPlugin.Logger?.LogWarning("[统计] 读取开箱新增物品失败：" + ex.Message);
		}
	}

	private static void RememberBoxSource(string label)
	{
		if (string.IsNullOrWhiteSpace(label) || "宝箱".Equals(label, StringComparison.Ordinal))
		{
			return;
		}
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
			string text = ResolveStageBoxLabel(box);
			RememberBoxSource(text);
			if (!string.IsNullOrWhiteSpace(text))
			{
				AutoApiPlugin.Logger?.LogInfo("[统计] 检测到本次开箱入口：" + text);
			}
		}
		catch (Exception ex)
		{
			AutoApiPlugin.Logger?.LogDebug("[统计] 读取开箱类型失败：" + ex.Message);
		}
	}

	private static string ResolveStageBoxLabel(StageBox box)
	{
		if (box == null)
		{
			return "";
		}
		bool flag = box.m_contentType == EContentType.PLAGUE;
		lock (Gate)
		{
			flag = flag || _currentIsPlague == true;
		}
		switch (box.m_boxType)
		{
		case EBoxType.NORMAL:
			if (!flag)
			{
				return "普通宝箱";
			}
			return "污染怪物宝箱";
		case EBoxType.BOSS:
			if (!flag)
			{
				return "稀有宝箱";
			}
			return "污染BOSS宝箱";
		case EBoxType.ACTBOSS:
			if (!flag)
			{
				return "BOSS宝箱";
			}
			return "污染章节BOSS宝箱";
		default:
			return "";
		}
	}

	private static void EnsureItemInfo(bool refresh = false)
	{
		if (_itemInfoLoaded && !refresh)
		{
			return;
		}
		System.Collections.Generic.List<ItemInfoData> list = AutoApiBehaviour.ItemInfoList();
		if (list == null || list.Count == 0)
		{
			return;
		}
		for (int i = 0; i < list.Count; i++)
		{
			ItemInfoData itemInfoData = list[i];
			if (itemInfoData != null)
			{
				ItemInfoByKey[itemInfoData.ItemKey] = itemInfoData;
			}
			if (itemInfoData != null && !string.IsNullOrWhiteSpace(itemInfoData.NameKey))
			{
				ItemInfoByNameKey[itemInfoData.NameKey] = itemInfoData;
			}
		}
		_itemInfoLoaded = ItemInfoByKey.Count > 0;
	}

	private static bool TryGetItemInfoByKey(int itemKey, out ItemInfoData info)
	{
		EnsureItemInfo();
		if (ItemInfoByKey.TryGetValue(itemKey, out info) && info != null)
		{
			return true;
		}
		if (DateTime.UtcNow >= _nextMissingItemInfoRefreshUtc)
		{
			_nextMissingItemInfoRefreshUtc = DateTime.UtcNow.AddSeconds(2.0);
			EnsureItemInfo(refresh: true);
		}
		if (ItemInfoByKey.TryGetValue(itemKey, out info))
		{
			return info != null;
		}
		return false;
	}

	internal static string ResolveItemNameByKey(int itemKey)
	{
		if (!TryGetItemInfoByKey(itemKey, out var info) || info == null)
		{
			return "";
		}
		return ResolveItemName(info.NameKey);
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
				if (entry != null)
				{
					string localizedString = entry.GetLocalizedString();
					if (!string.IsNullOrWhiteSpace(localizedString) && !string.Equals(localizedString, nameKey, StringComparison.Ordinal))
					{
						return localizedString;
					}
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
		_nextLocalizationRetryUtc = DateTime.UtcNow.AddSeconds(30.0);
		try
		{
			UnityEngine.Localization.Locale selectedLocale = LocalizationSettings.SelectedLocale;
			LocalizedStringDatabase stringDatabase = LocalizationSettings.StringDatabase;
			if (selectedLocale == null || stringDatabase == null)
			{
				return;
			}
			Il2CppSystem.Collections.Generic.IList<StringTable> list = stringDatabase.GetAllTables(selectedLocale).WaitForCompletion();
			if (list == null)
			{
				return;
			}
			for (int i = 0; i < 128; i++)
			{
				StringTable stringTable;
				try
				{
					stringTable = list[i];
				}
				catch (Exception)
				{
					break;
				}
				if (stringTable != null)
				{
					LocalizationTables.Add(stringTable);
				}
			}
			_localizationTablesLoaded = LocalizationTables.Count > 0;
			AutoApiPlugin.Logger.LogInfo("[统计] 道具名称语言表已加载：" + LocalizationTables.Count + "张。");
		}
		catch (Exception ex2)
		{
			AutoApiPlugin.Logger.LogWarning("[统计] 道具名称语言表读取失败：" + ex2.Message);
		}
	}

	private static string ResolveBoxType(Il2CppReferenceArray<BoxData> boxes)
	{
		if (boxes != null)
		{
			EnsureItemInfo();
			for (int i = 0; i < boxes.Length; i++)
			{
				BoxData boxData = boxes[i];
				if (boxData != null && ItemInfoByKey.TryGetValue(boxData.ItemId, out var value))
				{
					string text = (value.NameKey ?? "").ToLowerInvariant();
					if (text.Contains("contamin") && text.Contains("act"))
					{
						return "污染章节BOSS宝箱";
					}
					if (text.Contains("contamin") && text.Contains("boss"))
					{
						return "污染BOSS宝箱";
					}
					if (text.Contains("contamin"))
					{
						return "污染怪物宝箱";
					}
					if (text.Contains("act") && text.Contains("boss"))
					{
						return "BOSS宝箱";
					}
					if (text.Contains("boss"))
					{
						return "稀有宝箱";
					}
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
			string text = GetCurrentStageName();
			if (string.IsNullOrWhiteSpace(text) || text.Contains('{') || text.Contains('}'))
			{
				text = ReadVisibleStageName();
			}
			long pendingStageClearEventTime = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
			lock (Gate)
			{
				if (string.IsNullOrWhiteSpace(text) || IsRecentClearDuplicateLocked(text) || (_pendingStageClearObservedAtUtc != default(DateTime) && string.Equals(text, _pendingStageClearStage, StringComparison.Ordinal)))
				{
					return;
				}
				if (_battleStartedAtUtc == default(DateTime))
				{
					AutoApiPlugin.Logger?.LogWarning("[统计] 收到成功通关结果但没有战斗起点：" + text);
					return;
				}
				long num = Math.Max(1L, (long)Math.Round((DateTime.UtcNow - _battleStartedAtUtc).TotalSeconds, MidpointRounding.AwayFromZero));
				string lastBattleDrops = _lastBattleDrops;
				_pendingStageClearObservedAtUtc = DateTime.UtcNow;
				_pendingStageClearEventTime = pendingStageClearEventTime;
				_pendingStageClearStage = text;
				_pendingStageClearDuration = num.ToString(CultureInfo.InvariantCulture);
				_pendingStageClearDrops = lastBattleDrops;
			}
			AutoApiPlugin.Logger?.LogInfo("[统计] 收到成功通关结果，等待原生日志耗时：" + text);
		}
		catch (Exception ex)
		{
			AutoApiPlugin.Logger?.LogWarning("[活动统计] 记录战斗结果失败：" + ex.Message);
		}
	}

	private static void Enqueue(string type, params string[] fields)
	{
		EnqueueAt(type, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), fields);
	}

	private static void EnqueueAt(string type, long timestamp, params string[] fields)
	{
		StringBuilder stringBuilder = new StringBuilder("E\t").Append(type).Append('\t').Append(timestamp.ToString(CultureInfo.InvariantCulture));
		for (int i = 0; i < fields.Length; i++)
		{
			string value = Convert.ToBase64String(Encoding.UTF8.GetBytes(fields[i] ?? "")).TrimEnd('=').Replace('+', '-')
				.Replace('/', '_');
			stringBuilder.Append('\t').Append(value);
		}
		string s = "evt:" + EventSession + ":" + Interlocked.Increment(ref _eventSequence).ToString(CultureInfo.InvariantCulture);
		stringBuilder.Append('\t').Append(Convert.ToBase64String(Encoding.UTF8.GetBytes(s)).TrimEnd('=').Replace('+', '-')
			.Replace('/', '_'));
		Events.Enqueue(stringBuilder.ToString());
		Interlocked.Exchange(ref _lastNativeEventAt, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
	}
}
