using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Globalization;
using System.Net;
using System.Reflection;
using System.Text;
using System.Threading.Tasks;
using BepInEx.Core.Logging.Interpolation;
using BepInEx.Logging;
using CodeStage.AntiCheat.ObscuredTypes;
using Il2CppInterop.Runtime;
using Il2CppInterop.Runtime.InteropTypes;
using Il2CppInterop.Runtime.InteropTypes.Arrays;
using Il2CppSystem;
using Il2CppSystem.Collections.Generic;
using TMPro;
using TS;
using TaskbarHero;
using TaskbarHero.Data;
using TaskbarHero.UI;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.Events;
using UnityEngine.InputSystem;
using UnityEngine.InputSystem.Controls;
using UnityEngine.UI;
using Object = UnityEngine.Object;
using Exception = System.Exception;
using Type = System.Type;
using IntPtr = System.IntPtr;
using Activator = System.Activator;
using StringComparison = System.StringComparison;
using Math = System.Math;
using DateTime = System.DateTime;
using TimeSpan = System.TimeSpan;

namespace TbhAutoSynth;

public class AutoApiBehaviour : MonoBehaviour
{
	private sealed class WarehousePageSnapshot
	{
		public int PageNumber;
		public int PageKey;
		public int Used;
		public int Capacity;
	}

	private sealed class WarehouseSnapshot
	{
		public readonly System.Collections.Generic.List<WarehousePageSnapshot> Pages = new System.Collections.Generic.List<WarehousePageSnapshot>();
		public int Used;
		public int Capacity;
		public int PageTabs;
		public int OwnedPages;
		public int TabEntries;
		public string PageKeys = "";
		public bool IsComplete => PageTabs > 0 && Pages.Count == PageTabs && Capacity > 0;
		public double Percent => Capacity > 0 ? Used * 100.0 / Capacity : -1.0;
	}

	private class ApiTask
	{
		public string Command;

        private int _state;
        private readonly DateTime _deadline = DateTime.UtcNow.AddSeconds(24);
        public bool TryStart()
        {
            if (DateTime.UtcNow >= _deadline) { CancelBeforeStart(); return false; }
            return System.Threading.Interlocked.CompareExchange(ref _state, 1, 0) == 0;
        }
        public bool CancelBeforeStart()
        {
            if (System.Threading.Interlocked.CompareExchange(ref _state, 2, 0) != 0) return false;
            ResultTcs.TrySetResult("EXPIRED|NOT_EXECUTED");
            return true;
        }

		public TaskCompletionSource<string> ResultTcs = new TaskCompletionSource<string>();
	}

	private HttpListener _httpListener;

	private bool _isHttpServerRunning = false;

	private ConcurrentQueue<ApiTask> _apiTaskQueue = new ConcurrentQueue<ApiTask>();

	private ApiTask _pendingFillTask = null;

	private float _pendingFillTime = 0f;

	private float _pendingFillStartTime = 0f;
	private bool _pendingFillWaitingForStorage = false;
	private bool _pendingFillWaitingForItems = false;
	private bool _pendingFillTargetStorage = false;
	private bool _pendingFillExcludeInscriptionScrolls = false;
    private bool _pendingFillAllowPartial = false;
    private float _pendingFillCountStableSince;
	private bool _pendingFillCleaningExcluded = false;
	private System.Collections.Generic.List<int> _pendingExcludedSlotIndices = new System.Collections.Generic.List<int>();
	private int _pendingExcludedSlotCursor = 0;
	private float _pendingExcludedNextClickTime = 0f;
	private float _pendingExcludedSettleTime = 0f;
	private int _lastPendingFillCount = -1;
	private ApiTask _pendingSynthTypeTask = null;
	private int _pendingSynthTypeValue;
	private float _pendingSynthTypeStartTime;
	private float _pendingSynthTypeNextTime;
	private bool _pendingSynthTypeDropdownClickIssued;
	private bool _pendingSynthTypeWaitLogged;

	private ApiTask _pendingLevelTask = null;

	private float _pendingLevelTime = 0f;

	private string _pendingLevelTarget = "";

	private float _pendingLevelStartTime = 0f;

	private ApiTask _pendingOpenTask = null;

	private float _pendingOpenTime = 0f;

	private float _pendingOpenStartTime = 0f;
	private ApiTask _pendingPlagueRouteTask = null;
	private UI_Portal _pendingPlaguePortal = null;
	private int _pendingPlagueLevel;
	private int _pendingPlaguePhase;
	private bool _pendingPlagueDiagnosticLogged;
	private bool _pendingPlagueLevelDiagnosticLogged;
	private bool _pendingPlaguePortalClickIssued;
	private bool _pendingPlagueTabClickIssued;
	private float _pendingPlagueStartTime;
	private float _pendingPlagueNextTime;
	private int _offlineRewardPanelInstanceId;
	private int _offlineRewardCloseAttempts;
	private float _offlineRewardLastCloseAttempt;
	private float _offlineRewardNextScan;
	private bool _offlineRewardControlsLogged;
	private ApiTask _pendingOperationTask = null;

	private float _pendingOperationTime = 0f;

	private float _pendingOperationStartTime = 0f;

	private string _pendingOperationName = "";

	private string _lastOperationWaitLog = "";
	private bool _operationMenuOpenRequested = false;

	private const float MAX_PENDING_TIMEOUT = 8f;
	private const float MAX_PENDING_FILL_TIMEOUT = 12f;
	private const int REQUIRED_CUBE_ITEMS = 9;
	private const float MIN_SYNTH_ACTION_INTERVAL_SECONDS = 10f;
	private float _lastSynthActionTime = -1000f;

	private static bool _obfResolved;

	private static PropertyInfo _pRecipeType;

	private static PropertyInfo _pInnerButton;

	private static PropertyInfo _pIsOn;

	private static PropertyInfo _pCubeItemData;

	private static PropertyInfo _pItemInfoData;

	private static System.Type _dbType;
	private static string _lastWarehouseMonitorSignature = "";
	private static readonly System.Collections.Generic.Dictionary<int, string> _lastWarehouseRawDiagnostics = new System.Collections.Generic.Dictionary<int, string>();
	private static WarehouseSnapshot _cachedWarehouseSnapshot;
	private static float _nextWarehouseScanTime;

	private const BindingFlags DeclInstance = BindingFlags.DeclaredOnly | BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic;

	private static bool _stashObfResolved;

	private static PropertyInfo _pStashItemKey;

	private System.Collections.Generic.Dictionary<int, int> _gradeByItemKey;
	private string _lastLevelDiagnostic = null;

	public AutoApiBehaviour(System.IntPtr ptr)
		: base(ptr)
	{
	}

	private void Start()
	{
		StartHttpServer();
	}

	private void OnDestroy()
	{
		if (_httpListener != null)
		{
			_isHttpServerRunning = false;
			_httpListener.Stop();
			_httpListener.Close();
			AutoApiPlugin.Logger.LogInfo((object)">>> [TBH Auto API] HTTP 服务已安全关闭。");
		}
	}

	private void StartHttpServer()
	{
		try
		{
			_httpListener = new HttpListener();
			_httpListener.Prefixes.Add("http://127.0.0.1:19090/api/");
			_httpListener.Start();
			_isHttpServerRunning = true;
			AutoApiPlugin.Logger.LogInfo((object)">>> [TBH Auto API] 监听中: http://127.0.0.1:19090/api/ 等待 Java 客户端呼叫...");
			Task.Run(delegate
			{
				ListenForRequests();
			});
		}
		catch (Exception ex)
		{
			AutoApiPlugin.Logger.LogError((object)("HTTP 服务启动失败: " + ex.Message));
		}
	}

	private void ListenForRequests()
	{
		while (_isHttpServerRunning)
		{
			try
			{
				HttpListenerContext context = _httpListener.GetContext();
				_ = Task.Run(() => HandleRequest(context));
			}
			catch
			{
				if (!_isHttpServerRunning) return;
			}
		}
	}

	private void HandleRequest(HttpListenerContext context)
	{
		bool flag = default(bool);
		try
		{
				string text = context.Request.Url.AbsolutePath.ToLower();
				ManualLogSource logger = AutoApiPlugin.Logger;
				BepInExInfoLogInterpolatedStringHandler val = new BepInExInfoLogInterpolatedStringHandler(15, 1, out flag);
				if (flag)
				{
					((BepInExLogInterpolatedStringHandler)val).AppendLiteral("[API 请求接入] 路由: ");
					((BepInExLogInterpolatedStringHandler)val).AppendFormatted<string>(text);
				}
				logger.LogInfo(val);
				string text2 = "FAILED";
				switch (text)
				{
				case "/api/chest/white":
					text2 = DispatchToMainThreadAndWait("chest_white");
					break;
				case "/api/chest/blue":
					text2 = DispatchToMainThreadAndWait("chest_blue");
					break;
				case "/api/store/sort":
					text2 = DispatchToMainThreadAndWait("store_sort");
					break;
				case "/api/store/deposit":
					text2 = DispatchToMainThreadAndWait("store_deposit");
					break;
				case "/api/store/open":
					text2 = DispatchToMainThreadAndWait("store_open");
					break;
				case "/api/store/close":
					text2 = DispatchToMainThreadAndWait("store_close");
					break;
				case "/api/store/check_full":
					text2 = DispatchToMainThreadAndWait("store_check_full");
					break;
				case "/api/store/scan":
					text2 = DispatchToMainThreadAndWait("store_scan");
					break;
				case "/api/store/items":
					text2 = DispatchToMainThreadAndWait("store_items");
					break;
				case "/api/monitor/status":
					text2 = DispatchToMainThreadAndWait("monitor_status");
					break;
				case "/api/game/status":
					text2 = RuntimeMonitor.GetGameStatus();
					break;
				case "/api/events/poll":
					text2 = RuntimeMonitor.SnapshotEvents(out _);
					break;
				case "/api/events/status":
					text2 = RuntimeMonitor.GetEventCaptureStatus();
					break;
                case "/api/inventory/readiness":
                    text2 = HasPendingCubeUiTask() ? "BUSY|cube_ui_pending=true" : InventoryOperationGate.Readiness();
                    break;
				case "/api/events/refresh":
					text2 = DispatchToMainThreadAndWait("events_refresh");
					break;
				default:
					if (text.StartsWith("/api/automation/pacing/"))
                    {
                        text2 = int.TryParse(text.Replace("/api/automation/pacing/", ""), out int seconds)
                            ? InventoryOperationGate.ConfigurePacing(seconds) : "FAILED";
                    }
                    else if (text.StartsWith("/api/events/ack/"))
					{
						string countText = text.Replace("/api/events/ack/", "");
						text2 = int.TryParse(countText, out int count) && RuntimeMonitor.AcknowledgeEvents(count)
							? "SUCCESS" : "FAILED";
					}
					else if (text.StartsWith("/api/store/page/"))
					{
						text2 = DispatchToMainThreadAndWait("store_page_" + text.Replace("/api/store/page/", ""));
					}
					else if (text.StartsWith("/api/plague/route/"))
					{
						text2 = DispatchToMainThreadAndWait("plague_route_" + text.Replace("/api/plague/route/", ""));
					}
					else if (text.StartsWith("/api/synth/"))
					{
						string text3 = text.Replace("/api/synth/", "");
						switch (text3)
						{
						case "open":
							text2 = DispatchToMainThreadAndWait("synth_open");
							break;
						case "corrosion_status":
							text2 = RuntimeMonitor.GetCorrosionActionStatus();
							break;
                        case "synthesis_status":
                            text2 = SynthesisActionMonitor.Status();
                            break;
                        case "current_operation":
                            text2 = DispatchToMainThreadAndWait("synth_current_operation");
                            break;
						case "close":
							text2 = DispatchToMainThreadAndWait("synth_close");
							break;
						case "clear":
							text2 = DispatchToMainThreadAndWait("synth_clear");
							break;
                        case "purge_inscription":
                            text2 = DispatchToMainThreadAndWait("synth_purge_inscription");
                            break;
						default:
							if (text3.StartsWith("type/"))
							{
								text2 = DispatchToMainThreadAndWait("synth_type_" + text3.Replace("type/", ""));
							}
							else if (text3.StartsWith("operation/"))
							{
								text2 = DispatchToMainThreadAndWait("synth_operation_" + text3.Replace("operation/", ""));
							}
							else if (text3.StartsWith("level/"))
							{
								text2 = DispatchToMainThreadAndWait("synth_level_" + text3.Replace("level/", ""));
							}
							else if (text3.StartsWith("autofill/"))
							{
								text2 = DispatchToMainThreadAndWait("synth_autofill_" + text3.Replace("autofill/", ""));
							}
							else if (text3.StartsWith("execute/"))
							{
								text2 = DispatchToMainThreadAndWait("synth_execute_" + text3.Replace("execute/", ""));
							}
							else if (text3.StartsWith("validate/"))
							{
								text2 = DispatchToMainThreadAndWait("synth_validate_" + text3.Replace("validate/", ""));
							}
							else
							{
								context.Response.StatusCode = 404;
							}
							break;
						}
					}
					else
					{
						context.Response.StatusCode = 404;
					}
					break;
				}
				if (context.Response.StatusCode != 404)
				{
					bool flag2 = text2 == "SUCCESS" || text2 == "FULL" || text2 == "HAS_SPACE" || text2 == "EMPTY" || text2 == "READY"
						|| text2.StartsWith("SUCCESS|", StringComparison.Ordinal) || text2.StartsWith("BUSY|", StringComparison.Ordinal)
                        || text2.StartsWith("{\"status\":\"SUCCESS\"", StringComparison.Ordinal) || text2.StartsWith("E\t", StringComparison.Ordinal);
					context.Response.StatusCode = (flag2 ? 200 : 400);
					byte[] bytes = Encoding.UTF8.GetBytes(text2);
					context.Response.ContentLength64 = bytes.Length;
					using Stream stream = context.Response.OutputStream;
					stream.Write(bytes, 0, bytes.Length);
				}
				else
				{
					context.Response.Close();
				}
			}
			catch
			{
				try { context.Response.Close(); } catch { }
			}
	}

	private string DispatchToMainThreadAndWait(string cmd)
	{
		ApiTask apiTask = new ApiTask
		{
			Command = cmd
		};
		_apiTaskQueue.Enqueue(apiTask);
        int timeout = cmd.StartsWith("synth_autofill_") || cmd == "synth_purge_inscription" ? 55 : 25;
        if (!apiTask.ResultTcs.Task.Wait(TimeSpan.FromSeconds(timeout)))
            return apiTask.CancelBeforeStart() ? "EXPIRED|NOT_EXECUTED" : "PENDING|RESULT_UNKNOWN";
		return apiTask.ResultTcs.Task.Result;
	}

	private void Update()
	{
		//IL_08ac: Unknown result type (might be due to invalid IL or missing references)
		//IL_08b3: Expected O, but got Unknown
		//IL_07a2: Unknown result type (might be due to invalid IL or missing references)
		//IL_07a9: Expected O, but got Unknown
		//IL_07fc: Unknown result type (might be due to invalid IL or missing references)
		//IL_0803: Expected O, but got Unknown
		RuntimeMonitor.PollCorrosionAnimation();
        SynthesisActionMonitor.Poll();
		RuntimeMonitor.PollGameUi();
		ProcessOfflineRewardPopup();
		ProcessPendingPlagueRoute();
		ProcessPendingSynthType();
		try
		{
			Keyboard current = Keyboard.current;
			if (current != null && ((ButtonControl)current.f7Key).wasPressedThisFrame)
			{
				ExecuteStoreScan();
			}
		}
		catch
		{
		}
		if (_pendingOpenTask != null)
		{
			if (Time.unscaledTime - _pendingOpenStartTime > 3f)
			{
				_pendingOpenTask.ResultTcs.SetResult("FAILED");
				_pendingOpenTask = null;
				AutoApiPlugin.Logger.LogWarning((object)"[API 超时] 魔方打开超时，已自动终止");
			}
			else if (Time.unscaledTime >= _pendingOpenTime)
			{
				string text = "FAILED";
				try
				{
					UIManager manager = Object.FindObjectOfType<UIManager>(true);
					UI_Cube val = (Object)(object)manager != (Object)null ? manager.Ui_Cube : Object.FindObjectOfType<UI_Cube>(true);
					if ((Object)(object)val != (Object)null && ((Component)val).gameObject.activeInHierarchy
						&& (Object)(object)val.m_cubeSlotSetter != (Object)null && val.m_cubeSlotSetter.m_cubeInventorySlots != null
						&& val.m_cubeSlotSetter.m_cubeInventorySlots.Count >= REQUIRED_CUBE_ITEMS
						&& (Object)(object)val.m_synthesisItemTypeButton != (Object)null
						&& (Object)(object)val.m_synthesisAutoFillButton != (Object)null
						&& val.m_synthesisItemTypeButton.m_buttons != null && val.m_synthesisItemTypeButton.m_buttons.Count > 0)
					{
						text = "SUCCESS";
					}
					else
					{
						_pendingOpenTime = Time.unscaledTime + 0.2f;
					}
				}
				catch
				{
				}
				finally
				{
					if (text == "SUCCESS")
					{
						_pendingOpenTask.ResultTcs.SetResult(text);
						_pendingOpenTask = null;
					}
				}
			}
		}
		if (_pendingOperationTask != null)
		{
			if (Time.unscaledTime - _pendingOperationStartTime > MAX_PENDING_TIMEOUT)
			{
				_pendingOperationTask.ResultTcs.SetResult("FAILED");
				_pendingOperationTask = null;
				_pendingOperationName = "";
				_lastOperationWaitLog = "";
				_operationMenuOpenRequested = false;
				AutoApiPlugin.Logger.LogWarning((object)"[API 超时] 腐蚀菜单选项渲染超时，已自动终止");
			}
			else if (Time.unscaledTime >= _pendingOperationTime)
			{
				string result = "FAILED";
				bool needsSuspend = false;
				try
				{
					if (ExecuteSynthOperation(_pendingOperationName, out needsSuspend))
					{
						result = "SUCCESS";
					}
				}
				catch (Exception ex)
				{
					AutoApiPlugin.Logger.LogWarning((object)("[API] 腐蚀菜单选择异常: " + ex.Message));
				}
				if (result == "SUCCESS" || !needsSuspend)
				{
					_pendingOperationTask.ResultTcs.SetResult(result);
					_pendingOperationTask = null;
					_pendingOperationName = "";
					_lastOperationWaitLog = "";
				}
				else
				{
					_pendingOperationTime = Time.unscaledTime + 2f;
				}
			}
		}
		if (_pendingLevelTask != null)
		{
			if (Time.unscaledTime - _pendingLevelStartTime > 3f)
			{
				_pendingLevelTask.ResultTcs.SetResult("FAILED");
				_pendingLevelTask = null;
				AutoApiPlugin.Logger.LogWarning((object)"[API 超时] 配方等级选择超时，已自动终止");
			}
			else if (Time.unscaledTime >= _pendingLevelTime)
			{
				string result = "FAILED";
				bool needsSuspend = false;
				try
				{
					if (ExecuteSynthLevel(_pendingLevelTarget, out needsSuspend))
					{
						result = "SUCCESS";
					}
				}
				catch (Exception ex)
				{
					AutoApiPlugin.Logger.LogWarning((object)("[API] 配方等级选择异常: " + ex.Message));
				}
				if (result == "SUCCESS")
				{
					_pendingLevelTask.ResultTcs.SetResult(result);
					_pendingLevelTask = null;
				}
				else if (needsSuspend)
				{
					_pendingLevelTime = Time.unscaledTime + 0.2f;
				}
				else
				{
					_pendingLevelTask.ResultTcs.SetResult(result);
					_pendingLevelTask = null;
				}
			}
		}
		if (_pendingFillTask != null)
		{
			if (_pendingFillCleaningExcluded)
			{
				ProcessPendingExcludedScrollCleanup();
			}
			else if (Time.unscaledTime - _pendingFillStartTime > MAX_PENDING_FILL_TIMEOUT)
			{
				UI_Cube timedOutCube = Object.FindObjectOfType<UI_Cube>(true);
				int filledCount = ((Object)(object)timedOutCube != (Object)null) ? CountCubeItems(timedOutCube) : 0;
				if (_pendingFillWaitingForItems && _pendingFillExcludeInscriptionScrolls
					&& QueueExcludedScrollCleanup(timedOutCube))
				{
					// Keep this request pending while each excluded scroll is returned safely.
				}
				else if (_pendingFillWaitingForItems && filledCount >= REQUIRED_CUBE_ITEMS)
				{
					AutoApiPlugin.Logger.LogInfo((object)("[自动填充] 超时边界检查确认已填满 " + filledCount + "/" + REQUIRED_CUBE_ITEMS + " 格。"));
					CompletePendingFill(_pendingFillAllowPartial ? CubeBatchPolicy.CorrosionFillStatus(filledCount) : "SUCCESS");
				}
				else if (_pendingFillWaitingForItems)
				{
                    if (_pendingFillAllowPartial)
                    {
                        CompletePendingFill(CubeBatchPolicy.CorrosionFillStatus(filledCount));
                    }
                    else
                    {
					AutoApiPlugin.Logger.LogWarning((object)("[自动填充] 当前 " + filledCount + "/" + REQUIRED_CUBE_ITEMS + " 格；保留已填物品，供腐蚀尝试另一类别。"));
					CompletePendingFill("NOT_ENOUGH_" + filledCount.ToString(System.Globalization.CultureInfo.InvariantCulture));
                    }
				}
				else
				{
					AutoApiPlugin.Logger.LogWarning((object)"[自动填充] 仓库开关未能切换到设定状态；取消本轮腐蚀。");
					CompletePendingFill("FAILED");
				}
			}
			else if (Time.unscaledTime >= _pendingFillTime)
			{
				try
				{
					UI_Cube val2 = Object.FindObjectOfType<UI_Cube>(true);
					if ((Object)(object)val2 == (Object)null || !((Component)val2).gameObject.activeInHierarchy)
					{
						CompletePendingFill("FAILED");
					}
					else if (_pendingFillWaitingForStorage)
					{
						bool currentStorage = IsOn(val2.toggleButton_UseStorage);
						if (currentStorage == _pendingFillTargetStorage)
						{
							AutoApiPlugin.Logger.LogInfo((object)("[自动填充] 已确认包含仓库=" + currentStorage + "，开始填充物品。"));
							BeginPendingAutoFill(val2);
						}
						else
						{
							_pendingFillTime = Time.unscaledTime + 0.1f;
						}
					}
					else if (_pendingFillWaitingForItems)
					{
						int filledCount = CountCubeItems(val2);
                        if (_pendingFillAllowPartial)
                        {
                            if (filledCount != _lastPendingFillCount)
                            {
                                _lastPendingFillCount = filledCount;
                                _pendingFillCountStableSince = Time.unscaledTime;
                            }
                            if (Time.unscaledTime - _pendingFillCountStableSince >= 2f)
                            {
                                if (!_pendingFillExcludeInscriptionScrolls || !QueueExcludedScrollCleanup(val2))
                                    CompletePendingFill(CubeBatchPolicy.CorrosionFillStatus(filledCount));
                            }
                            else _pendingFillTime = Time.unscaledTime + 0.5f;
                        }
						else if (filledCount >= REQUIRED_CUBE_ITEMS)
						{
							if (_pendingFillExcludeInscriptionScrolls && QueueExcludedScrollCleanup(val2))
							{
								// The remaining eligible items will be supplemented from the other category.
							}
							else
							{
								AutoApiPlugin.Logger.LogInfo((object)("[自动填充] 已填满 " + filledCount + "/" + REQUIRED_CUBE_ITEMS + " 格。"));
								CompletePendingFill("SUCCESS");
							}
						}
						else
						{
							if (filledCount != _lastPendingFillCount)
							{
								_lastPendingFillCount = filledCount;
								AutoApiPlugin.Logger.LogInfo((object)("[自动填充] 当前 " + filledCount + "/" + REQUIRED_CUBE_ITEMS + " 格，继续等待。"));
							}
							_pendingFillTime = Time.unscaledTime + 0.5f;
						}
					}
				}
				catch (Exception ex)
				{
					AutoApiPlugin.Logger.LogWarning((object)("[自动填充] 等待异常：" + ex.Message));
					CompletePendingFill("FAILED");
				}
			}
		}
		if (!_apiTaskQueue.TryDequeue(out var result3))
		{
			return;
		}
        if (!result3.TryStart()) return;
        if (HasPendingCubeUiTask() && IsMutatingUiCommand(result3.Command))
        {
            result3.ResultTcs.TrySetResult("ACTION_PENDING");
            return;
        }
		string result4 = "FAILED";
		bool flag = false;
		bool flag4 = default(bool);
		try
		{
			if (result3.Command == "chest_white")
			{
				result4 = ExecuteClickChest("white");
			}
			else if (result3.Command == "chest_blue")
			{
				result4 = ExecuteClickChest("blue");
			}
			else if (result3.Command == "store_sort")
			{
                string permission = InventoryOperationGate.TryBeginHelperAction();
                result4 = permission == "READY" ? (ExecuteStoreSort() ? "SUCCESS" : "FAILED") : permission;
			}
			else if (result3.Command == "store_deposit")
			{
                string permission = InventoryOperationGate.TryBeginHelperAction();
                result4 = permission == "READY" ? (ExecuteStoreDeposit() ? "SUCCESS" : "FAILED") : permission;
                if (result4 == "SUCCESS") InventoryOperationGate.MarkUiInventoryChange();
			}
			else if (result3.Command == "store_open")
			{
				result4 = (ExecuteStoreOpen() ? "SUCCESS" : "FAILED");
			}
			else if (result3.Command == "store_close")
			{
				result4 = (ExecuteStoreClose() ? "SUCCESS" : "FAILED");
			}
			else if (result3.Command == "store_check_full")
			{
				result4 = (ExecuteStoreCheckFull() ? "FULL" : "HAS_SPACE");
			}
			else if (result3.Command == "store_scan")
			{
				result4 = (ExecuteStoreScan() ? "SUCCESS" : "FAILED");
			}
			else if (result3.Command == "monitor_status")
			{
				result4 = ExecuteMonitorStatus();
			}
			else if (result3.Command == "store_items")
			{
				result4 = ReadWarehouseItems();
			}
			else if (result3.Command == "events_refresh")
			{
				result4 = RuntimeMonitor.RefreshNativeGameLogSnapshot();
			}
			else if (result3.Command.StartsWith("plague_route_"))
			{
				if (int.TryParse(result3.Command.Replace("plague_route_", ""), out int plagueLevel))
				{
					result4 = BeginPlagueRoute(result3, plagueLevel);
					if (_pendingPlagueRouteTask == result3)
					{
						flag = true;
					}
				}
			}
			else if (result3.Command.StartsWith("store_page_"))
			{
				if (int.TryParse(result3.Command.Replace("store_page_", ""), out var result5))
				{
					result4 = (ExecuteStorePage(result5) ? "SUCCESS" : "FAILED");
				}
			}
			else if (result3.Command == "synth_open")
			{
				result4 = (ExecuteSynthOpen() ? "SUCCESS" : "FAILED");
			}
            else if (result3.Command == "synth_current_operation")
            {
                UI_Cube cube = Object.FindObjectOfType<UI_Cube>(true);
                result4 = "NO_UI";
                if (cube != null && cube.m_mainRecipeToggleBtn != null)
                    foreach (string operation in new[] { "synthesis", "corrosion" })
                    {
                        var selected = CorrosionRecipeSelector.Find(cube, cube.m_mainRecipeToggleBtn, operation);
                        if (selected != null && selected.m_isSelected) result4 = "SUCCESS|operation=" + operation;
                    }
            }
			else if (result3.Command == "synth_close")
			{
                result4 = RuntimeMonitor.IsCorrosionActionPending() || SynthesisActionMonitor.IsPending()
                    ? "ACTION_PENDING" : (ExecuteSynthClose() ? "SUCCESS" : "FAILED");
			}
			else if (result3.Command == "synth_clear")
			{
                result4 = RuntimeMonitor.IsCorrosionActionPending() || SynthesisActionMonitor.IsPending()
                    ? "ACTION_PENDING" : (ExecuteSynthClear() ? "SUCCESS" : "FAILED");
			}
            else if (result3.Command == "synth_purge_inscription")
            {
                UI_Cube cube = Object.FindObjectOfType<UI_Cube>(true);
                if (cube == null || RuntimeMonitor.IsCorrosionActionPending() || SynthesisActionMonitor.IsPending()) result4 = "ACTION_PENDING";
                else
                {
                    var selected = cube.m_mainRecipeToggleBtn != null ? CorrosionRecipeSelector.Find(cube, cube.m_mainRecipeToggleBtn) : null;
                    if (selected == null || !selected.m_isSelected) result4 = "WRONG_OPERATION";
                    else
                    {
                        _pendingFillTask = result3;
                        _pendingFillAllowPartial = true;
                        _pendingFillExcludeInscriptionScrolls = true;
                        if (QueueExcludedScrollCleanup(cube)) flag = true;
                        else CompletePendingFill(CubeBatchPolicy.CorrosionFillStatus(CountCubeItems(cube)));
                        flag = true;
                    }
                }
            }
			else if (result3.Command.StartsWith("synth_type_"))
			{
				if (int.TryParse(result3.Command.Replace("synth_type_", ""), out var result6))
				{
					_pendingSynthTypeTask = result3;
					_pendingSynthTypeValue = result6;
					_pendingSynthTypeStartTime = Time.unscaledTime;
					_pendingSynthTypeNextTime = Time.unscaledTime + 0.1f;
					_pendingSynthTypeDropdownClickIssued = false;
					_pendingSynthTypeWaitLogged = false;
					flag = true;
				}
			}
			else if (result3.Command.StartsWith("synth_operation_"))
			{
				string operation = result3.Command.Replace("synth_operation_", "");
				_operationMenuOpenRequested = false;
				_lastOperationWaitLog = "";
				bool needsSuspend3 = false;
				result4 = (ExecuteSynthOperation(operation, out needsSuspend3) ? "SUCCESS" : "FAILED");
				if (needsSuspend3)
				{
					_pendingOperationTask = result3;
					_pendingOperationName = operation;
					_pendingOperationTime = Time.unscaledTime + 2f;
					_pendingOperationStartTime = Time.unscaledTime;
					flag = true;
				}
			}
			else if (result3.Command.StartsWith("synth_execute_"))
			{
				string[] executeArgs = result3.Command.Replace("synth_execute_", "").Split('/');
				if (int.TryParse(executeArgs[0], out var result7))
				{
					bool excludeScrolls = executeArgs.Length > 1 && bool.TryParse(executeArgs[1], out bool parsedExclude) && parsedExclude;
					result4 = ExecuteSynthAction(result7, excludeScrolls, executeArgs.Length > 2 ? executeArgs[2] : "");
				}
			}
			else if (result3.Command.StartsWith("synth_validate_"))
			{
                string[] validationArgs = result3.Command.Replace("synth_validate_", "").Split('/');
				if (int.TryParse(validationArgs[0], out var result8))
				{
					result4 = ExecuteSynthValidation(result8, validationArgs.Length > 1 ? validationArgs[1] : "synthesis");
				}
			}
			else if (result3.Command.StartsWith("synth_level_"))
			{
				string text2 = result3.Command.Replace("synth_level_", "");
				result4 = (ExecuteSynthLevel(text2, out var needsSuspend2) ? "SUCCESS" : "FAILED");
				if (needsSuspend2)
				{
					_pendingLevelTask = result3;
					_pendingLevelTime = Time.unscaledTime + 0.5f;
					_pendingLevelTarget = text2;
					_pendingLevelStartTime = Time.unscaledTime;
					flag = true;
				}
			}
			else
			{
				if (!result3.Command.StartsWith("synth_autofill_"))
				{
					return;
				}
				string[] fillArgs = result3.Command.Replace("synth_autofill_", "").Split('/');
				bool flag2 = fillArgs.Length > 0 && bool.TryParse(fillArgs[0], out bool parsedStorage) && parsedStorage;
				bool excludeInscriptionScrolls = fillArgs.Length > 1 && bool.TryParse(fillArgs[1], out bool parsedScrollSetting) && parsedScrollSetting;
                bool allowPartial = fillArgs.Length > 2 && fillArgs[2] == "corrosion";
				UI_Cube val3 = Object.FindObjectOfType<UI_Cube>(true);
				if (!((Object)(object)val3 != (Object)null) || !((Component)val3).gameObject.activeInHierarchy)
				{
					return;
				}

                if (allowPartial)
                {
                    var selected = val3.m_mainRecipeToggleBtn != null ? CorrosionRecipeSelector.Find(val3, val3.m_mainRecipeToggleBtn) : null;
                    if (selected == null || !selected.m_isSelected) { result4 = "WRONG_OPERATION"; return; }
                }
                _pendingFillAllowPartial = allowPartial;
				if ((Object)(object)val3.toggleButton_UseStorage != (Object)null && ((Component)val3.toggleButton_UseStorage).gameObject.activeInHierarchy)
				{
					bool flag3 = IsOn(val3.toggleButton_UseStorage);
					if (flag3 != flag2)
					{
						AutoApiPlugin.Logger.LogInfo((object)("[自动填充] 请求包含仓库=" + flag2 + "（当前=" + flag3 + "）。"));
						ClickGameObject(((Component)val3.toggleButton_UseStorage).gameObject, "包含仓库开关 -> " + flag2);
						_pendingFillTask = result3;
						_pendingFillWaitingForStorage = true;
						_pendingFillWaitingForItems = false;
						_pendingFillTargetStorage = flag2;
						_pendingFillExcludeInscriptionScrolls = excludeInscriptionScrolls;
						_pendingFillTime = Time.unscaledTime + 0.1f;
						_pendingFillStartTime = Time.unscaledTime;
						_lastPendingFillCount = -1;
						flag = true;
					}
					else
					{
						_pendingFillTask = result3;
						_pendingFillWaitingForStorage = false;
						_pendingFillWaitingForItems = true;
						_pendingFillTargetStorage = flag2;
						_pendingFillExcludeInscriptionScrolls = excludeInscriptionScrolls;
						_pendingFillStartTime = Time.unscaledTime;
						_lastPendingFillCount = -1;
						BeginPendingAutoFill(val3);
						flag = true;
					}
				}
				else
				{
					AutoApiPlugin.Logger.LogWarning((object)"[自动填充] 仓库开关不可用，无法确认物品范围；取消填充。");
					result4 = "FAILED";
				}
			}
		}
		catch (Exception ex)
		{
			ManualLogSource logger2 = AutoApiPlugin.Logger;
			BepInExErrorLogInterpolatedStringHandler val7 = new BepInExErrorLogInterpolatedStringHandler(11, 1, out flag4);
			if (flag4)
			{
				((BepInExLogInterpolatedStringHandler)val7).AppendLiteral("API 运行时异常: ");
				((BepInExLogInterpolatedStringHandler)val7).AppendFormatted<Exception>(ex);
			}
			logger2.LogError(val7);
		}
		finally
		{
			if (!flag)
			{
				result3.ResultTcs.SetResult(result4);
			}
		}
	}

	private void ProcessOfflineRewardPopup()
	{
		if (Time.unscaledTime < _offlineRewardNextScan) return;
		_offlineRewardNextScan = Time.unscaledTime + 0.5f;
		try
		{
			UI_OfflineReward panel = Object.FindObjectOfType<UI_OfflineReward>(true);
			if ((Object)(object)panel == (Object)null || !((Component)panel).gameObject.activeInHierarchy
				|| (panel.m_parentCanvasGroup != null && panel.m_parentCanvasGroup.alpha <= 0.01f))
			{
				_offlineRewardPanelInstanceId = 0;
				_offlineRewardCloseAttempts = 0;
				_offlineRewardControlsLogged = false;
				return;
			}
			int instanceId = ((Object)panel).GetInstanceID();
			if (_offlineRewardPanelInstanceId != instanceId)
			{
				_offlineRewardPanelInstanceId = instanceId;
				_offlineRewardCloseAttempts = 0;
				_offlineRewardControlsLogged = false;
				_offlineRewardLastCloseAttempt = 0f;
			}
			if (_offlineRewardCloseAttempts >= 3
				|| (_offlineRewardCloseAttempts > 0 && Time.unscaledTime - _offlineRewardLastCloseAttempt < 1.25f))
			{
				return;
			}
			Button closeButton = FindOfflineRewardCloseButton(panel);
			if (closeButton != null && closeButton.onClick != null)
			{
				closeButton.onClick.Invoke();
				_offlineRewardCloseAttempts++;
				_offlineRewardLastCloseAttempt = Time.unscaledTime;
				AutoApiPlugin.Logger.LogInfo((object)("[离线收益] 检测到离线收益窗口，已点击关闭按钮：" + closeButton.gameObject.name));
				return;
			}
			NormalButton normalClose = FindOfflineRewardNormalCloseButton(panel);
			if (normalClose != null && normalClose.bubm != null)
			{
				normalClose.bubm.Invoke();
				_offlineRewardCloseAttempts++;
				_offlineRewardLastCloseAttempt = Time.unscaledTime;
				AutoApiPlugin.Logger.LogInfo((object)("[离线收益] 检测到离线收益窗口，已点击关闭控件：" + ((Component)normalClose).gameObject.name));
				return;
			}
			if (!_offlineRewardControlsLogged)
			{
				_offlineRewardControlsLogged = true;
				AutoApiPlugin.Logger.LogWarning((object)"[离线收益] 检测到窗口，但没有找到右上角关闭控件。");
			}
		}
		catch (Exception ex)
		{
			AutoApiPlugin.Logger.LogDebug((object)("[离线收益] 关闭窗口失败：" + ex.Message));
		}
	}

	private static Button FindOfflineRewardCloseButton(UI_OfflineReward panel)
	{
		Il2CppArrayBase<Button> buttons = panel.GetComponentsInChildren<Button>(true);
		Button topRight = null;
		float bestDistance = float.MaxValue;
		float targetX = float.MaxValue;
		float targetY = float.MaxValue;
		RectTransform rootRect = panel.GetComponent<RectTransform>();
		if (rootRect != null)
		{
			Vector3[] corners = new Vector3[4];
			rootRect.GetWorldCorners(corners);
			targetX = corners[2].x;
			targetY = corners[2].y;
		}
		for (int i = 0; buttons != null && i < buttons.Length; i++)
		{
			Button button = buttons[i];
			if ((Object)(object)button == (Object)null || !((Component)button).gameObject.activeInHierarchy || !button.interactable)
			{
				continue;
			}
			string name = button.gameObject.name ?? "";
			string normalized = name.ToLowerInvariant();
			if (normalized.Contains("close") || normalized.Contains("exit") || normalized.Contains("cancel")
				|| normalized == "x" || normalized.EndsWith("_x", StringComparison.Ordinal))
			{
				return button;
			}
			if (normalized.Contains("claim") || normalized.Contains("reward") || normalized.Contains("receive")
				|| normalized.Contains("collect") || normalized.Contains("get"))
			{
				continue;
			}
			Vector3 position = ((Component)button).transform.position;
			float dx = targetX == float.MaxValue ? -position.x : targetX - position.x;
			float dy = targetY == float.MaxValue ? -position.y : targetY - position.y;
			float distance = dx * dx + dy * dy;
			if (topRight == null || distance < bestDistance)
			{
				topRight = button;
				bestDistance = distance;
			}
		}
		return topRight;
	}

	private static NormalButton FindOfflineRewardNormalCloseButton(UI_OfflineReward panel)
	{
		Il2CppArrayBase<NormalButton> buttons = panel.GetComponentsInChildren<NormalButton>(true);
		NormalButton topRight = null;
		float bestDistance = float.MaxValue;
		float targetX = float.MaxValue;
		float targetY = float.MaxValue;
		RectTransform rootRect = panel.GetComponent<RectTransform>();
		if (rootRect != null)
		{
			Vector3[] corners = new Vector3[4];
			rootRect.GetWorldCorners(corners);
			targetX = corners[2].x;
			targetY = corners[2].y;
		}
		for (int i = 0; buttons != null && i < buttons.Length; i++)
		{
			NormalButton button = buttons[i];
			if ((Object)(object)button == (Object)null || button.bubm == null || !((Component)button).gameObject.activeInHierarchy)
			{
				continue;
			}
			string normalized = (((Component)button).gameObject.name ?? "").ToLowerInvariant();
			if (normalized.Contains("close") || normalized.Contains("exit") || normalized.Contains("cancel")
				|| normalized == "x" || normalized.EndsWith("_x", StringComparison.Ordinal))
			{
				return button;
			}
			if (normalized.Contains("claim") || normalized.Contains("reward") || normalized.Contains("receive")
				|| normalized.Contains("collect") || normalized.Contains("get"))
			{
				continue;
			}
			Vector3 position = ((Component)button).transform.position;
			float dx = targetX == float.MaxValue ? -position.x : targetX - position.x;
			float dy = targetY == float.MaxValue ? -position.y : targetY - position.y;
			float distance = dx * dx + dy * dy;
			if (topRight == null || distance < bestDistance)
			{
				topRight = button;
				bestDistance = distance;
			}
		}
		return topRight;
	}

	private static void ResolveStashInterop(object sampleItem)
	{
		if (_stashObfResolved || sampleItem == null)
		{
			return;
		}
		System.Type type = sampleItem.GetType();
		BindingFlags bindingAttr = BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic;
		PropertyInfo[] properties = type.GetProperties(bindingAttr);
		foreach (PropertyInfo propertyInfo in properties)
		{
			if (!propertyInfo.CanRead)
			{
				continue;
			}
			try
			{
				object value = propertyInfo.GetValue(sampleItem, null);
				if (value != null && _pStashItemKey == null && propertyInfo.PropertyType == typeof(int) && (int)value > 0)
				{
					_pStashItemKey = propertyInfo;
				}
			}
			catch
			{
			}
		}
		_stashObfResolved = true;
	}

	private static PropertyInfo OnlyProp(System.Type declaring, System.Type propType, bool readOnly)
	{
		PropertyInfo propertyInfo = null;
		PropertyInfo[] properties = declaring.GetProperties(BindingFlags.DeclaredOnly | BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);
		foreach (PropertyInfo propertyInfo2 in properties)
		{
			if (!(propertyInfo2.PropertyType != propType) && (!readOnly || !propertyInfo2.CanWrite))
			{
				if (propertyInfo != null)
				{
					break;
				}
				propertyInfo = propertyInfo2;
			}
		}
		return propertyInfo;
	}

	private static System.Type FindDbType()
	{
		System.Type[] types;
		try
		{
			types = typeof(UI_Cube).Assembly.GetTypes();
		}
		catch (ReflectionTypeLoadException ex)
		{
			types = ex.Types;
		}
		System.Type[] array = types;
		foreach (System.Type type in array)
		{
			if (!(type == null) && type.GetProperty("itemInfoData", BindingFlags.DeclaredOnly | BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic) != null && type.GetProperty("heroInfoData", BindingFlags.DeclaredOnly | BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic) != null)
			{
				return type;
			}
		}
		return null;
	}

	private static void ResolveInterop()
	{
		if (!_obfResolved)
		{
			_obfResolved = true;
			_pRecipeType = OnlyProp(typeof(SubRecipeComboBoxButton), typeof(ERecipeType), readOnly: false);
			_pInnerButton = OnlyProp(typeof(ButtonBase), typeof(Button), readOnly: true);
			_pIsOn = OnlyProp(typeof(ToggleButton), typeof(bool), readOnly: true);
			_pCubeItemData = OnlyProp(typeof(CubeInData), typeof(CubeItemData), readOnly: false);
			_dbType = FindDbType();
			_pItemInfoData = ((_dbType != null) ? _dbType.GetProperty("itemInfoData", BindingFlags.DeclaredOnly | BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic) : null);
			AutoApiPlugin.Logger.LogInfo((object)">>> [底层内存引擎] IL2CPP 混淆特征解析完成，游戏内存数据库映射成功！");
		}
	}

	private static ERecipeType RecipeTypeOf(SubRecipeComboBoxButton c)
	{
		//IL_0012: Unknown result type (might be due to invalid IL or missing references)
		//IL_0017: Unknown result type (might be due to invalid IL or missing references)
		//IL_001a: Unknown result type (might be due to invalid IL or missing references)
		ResolveInterop();
		return (ERecipeType)_pRecipeType.GetValue(c);
	}

	private static Button InnerButton(ButtonBase b)
	{
		//IL_0012: Unknown result type (might be due to invalid IL or missing references)
		//IL_0018: Expected O, but got Unknown
		ResolveInterop();
		return (Button)_pInnerButton.GetValue(b);
	}

	private static bool IsOn(ToggleButton b)
	{
		ResolveInterop();
		return (bool)_pIsOn.GetValue(b);
	}

	private static int CubeItemKey(CubeInData data)
	{
		//IL_0012: Unknown result type (might be due to invalid IL or missing references)
		//IL_0017: Unknown result type (might be due to invalid IL or missing references)
		//IL_0018: Unknown result type (might be due to invalid IL or missing references)
		//IL_0019: Unknown result type (might be due to invalid IL or missing references)
		ResolveInterop();
		CubeItemData val = (CubeItemData)_pCubeItemData.GetValue(data);
		return (int)val.ItemKey;
	}

	internal static System.Collections.Generic.List<ItemInfoData> ItemInfoList()
	{
		ResolveInterop();
		if (_dbType == null || _pItemInfoData == null)
		{
			return null;
		}
		Il2CppSystem.Type il2CppType = Il2CppType.From(_dbType);
		Il2CppReferenceArray<Object> resources = Resources.FindObjectsOfTypeAll(il2CppType);
		if (resources == null || ((Il2CppArrayBase<Object>)(object)resources).Length == 0)
		{
			AutoApiPlugin.Logger.LogWarning((object)("[安全锁] 未找到物品数据库对象：" + _dbType.FullName));
			return null;
		}
		System.Collections.Generic.List<ItemInfoData> result = new System.Collections.Generic.List<ItemInfoData>();
		for (int i = 0; i < ((Il2CppArrayBase<Object>)(object)resources).Length; i++)
		{
			try
			{
				Object resource = ((Il2CppArrayBase<Object>)(object)resources)[i];
				if ((Object)(object)resource == (Object)null)
				{
					continue;
				}
				object database = Activator.CreateInstance(_dbType, ((Il2CppObjectBase)resource).Pointer);
				object rawList = _pItemInfoData.GetValue(database, null);
				Il2CppSystem.Collections.Generic.List<ItemInfoData> il2CppList = rawList as Il2CppSystem.Collections.Generic.List<ItemInfoData>;
				if (il2CppList != null)
				{
					for (int j = 0; j < il2CppList.Count; j++)
					{
						ItemInfoData item = il2CppList[j];
						// ItemInfoData is an IL2CPP data wrapper, not a UnityEngine.Object.
						// Casting it to UnityEngine.Object throws and leaves the grade map empty.
						if (item != null)
						{
							result.Add(item);
						}
					}
					continue;
				}
				System.Collections.Generic.List<ItemInfoData> managedList = rawList as System.Collections.Generic.List<ItemInfoData>;
				if (managedList != null)
				{
					result.AddRange(managedList);
				}
			}
			catch (Exception ex)
			{
				AutoApiPlugin.Logger.LogWarning((object)("[安全锁] 读取物品品质表失败：" + ex.Message));
			}
		}
		AutoApiPlugin.Logger.LogInfo((object)("[安全锁] 从 " + ((Il2CppArrayBase<Object>)(object)resources).Length + " 个数据库对象读取到 " + result.Count + " 条物品品质数据。"));
		return result.Count == 0 ? null : result;
	}

	private bool ExecuteSynthOpen()
	{
		UIManager manager = Object.FindObjectOfType<UIManager>(true);
		UI_Cube val = (Object)(object)manager != (Object)null ? manager.Ui_Cube : Object.FindObjectOfType<UI_Cube>(true);
		if ((Object)(object)val == (Object)null)
		{
			return false;
		}
		if (!((Component)val).gameObject.activeInHierarchy)
		{
			if ((Object)(object)manager == (Object)null)
			{
				AutoApiPlugin.Logger.LogWarning((object)"[腐蚀] UIManager 不可用；拒绝直接强制显示未初始化的魔方界面。");
				return false;
			}
			AutoApiPlugin.Logger.LogInfo((object)"[腐蚀] 通过 UIManager 正常打开魔方，等待游戏初始化其内部状态。");
			manager.hor(val);
		}
		return true;
	}

	private bool ExecuteSynthClose()
	{
		UIManager manager = Object.FindObjectOfType<UIManager>(true);
		UI_Cube val = (Object)(object)manager != (Object)null ? manager.Ui_Cube : Object.FindObjectOfType<UI_Cube>(true);
		if ((Object)(object)val != (Object)null && ((Component)val).gameObject.activeInHierarchy)
		{
			if ((Object)(object)manager != (Object)null)
			{
				manager.hos(val);
			}
			if (((Component)val).gameObject.activeInHierarchy)
			{
				((Component)val).gameObject.SetActive(false);
			}
			return true;
		}
		return false;
	}

	private string ExecuteMonitorStatus()
	{
		PollutionReading pollution = RuntimeMonitor.GetPollution();
		WarehouseSnapshot warehouse = ScanWarehousePages();
		string result = (pollution.IsKnown && warehouse.IsComplete) ? "SUCCESS" : "UNKNOWN";
		string pollutionValue = pollution.IsKnown ? pollution.Value.ToString() : "?";
		string warehousePercent = warehouse.Percent >= 0.0 ? warehouse.Percent.ToString("0.0", System.Globalization.CultureInfo.InvariantCulture) : "?";
		System.Text.StringBuilder pages = new System.Text.StringBuilder();
		for (int i = 0; i < warehouse.Pages.Count; i++)
		{
			if (i > 0)
			{
				pages.Append(',');
			}
			WarehousePageSnapshot page = warehouse.Pages[i];
			pages.Append(page.PageNumber).Append(':').Append(page.Used).Append('/').Append(page.Capacity);
		}
		return result + "|pollution=" + pollutionValue
			+ "|pollution_entry_min=" + (pollution.EntryMinimum > 0 ? pollution.EntryMinimum.ToString(System.Globalization.CultureInfo.InvariantCulture) : "?")
			+ "|pollution_source=" + (pollution.Source ?? "unknown")
			+ "|pollution_at=" + (pollution.UpdatedAt ?? "")
			+ "|pollution_age_sec=" + (pollution.IsKnown ? Math.Max(0.0, (System.DateTime.UtcNow - pollution.ObservedAtUtc).TotalSeconds).ToString("0", System.Globalization.CultureInfo.InvariantCulture) : "?")
			+ "|warehouse_percent=" + warehousePercent
			+ "|warehouse_used=" + warehouse.Used
			+ "|warehouse_capacity=" + warehouse.Capacity
			+ "|pages_scanned=" + warehouse.Pages.Count
			+ "|page_tabs=" + warehouse.PageTabs
			+ "|warehouse_pages=" + warehouse.OwnedPages
			+ "|tab_entries=" + warehouse.TabEntries
			+ "|page_keys=" + warehouse.PageKeys
			+ "|pages=" + pages;
	}

	private string BeginPlagueRoute(ApiTask task, int targetLevel)
	{
		if (targetLevel < 1 || targetLevel > 20)
		{
			return "INVALID_LEVEL";
		}
		try
		{
			UI_Portal portal = Object.FindObjectOfType<UI_Portal>(true);
			_pendingPlagueRouteTask = task;
			_pendingPlaguePortal = portal;
			_pendingPlagueLevel = targetLevel;
			_pendingPlaguePhase = 0;
			_pendingPlagueDiagnosticLogged = false;
			_pendingPlagueLevelDiagnosticLogged = false;
			_pendingPlaguePortalClickIssued = false;
			_pendingPlagueTabClickIssued = false;
			_pendingPlagueStartTime = Time.unscaledTime;
			_pendingPlagueNextTime = Time.unscaledTime + 0.25f;
			AutoApiPlugin.Logger.LogInfo((object)("[瘟疫之地] 将按游戏界面点击传送门并选择强度 " + targetLevel + "。"));
			return "PENDING";
		}
		catch (Exception ex)
		{
			AutoApiPlugin.Logger.LogWarning((object)("[瘟疫之地] 自动选择异常：" + ex.Message));
			return "FAILED";
		}
	}

	private void ProcessPendingPlagueRoute()
	{
		ApiTask task = _pendingPlagueRouteTask;
		if (task == null || Time.unscaledTime < _pendingPlagueNextTime)
		{
			return;
		}
		if (Time.unscaledTime - _pendingPlagueStartTime > 20f)
		{
			AutoApiPlugin.Logger.LogWarning((object)("[瘟疫之地] 路由等待超时：阶段=" + _pendingPlaguePhase
				+ "，页签点击=" + _pendingPlagueTabClickIssued
				+ "，门户=" + ((Object)(object)_pendingPlaguePortal != (Object)null && ((Component)_pendingPlaguePortal).gameObject.activeInHierarchy)));
			CompletePendingPlagueRoute("PLAGUE_UI_TIMEOUT");
			return;
		}
		try
		{
			UI_Portal portal = _pendingPlaguePortal;
			if ((Object)(object)portal == (Object)null)
			{
				portal = Object.FindObjectOfType<UI_Portal>(true);
				_pendingPlaguePortal = portal;
			}
			if ((Object)(object)portal == (Object)null)
			{
				if (!_pendingPlaguePortalClickIssued)
				{
					UI_Main main = Object.FindObjectOfType<UI_Main>(true);
					if ((Object)(object)main == (Object)null || main.button_Portal == null
						|| main.button_Portal.toggleButton == null || main.button_Portal.toggleButton.bubm == null)
					{
						CompletePendingPlagueRoute("PORTAL_BUTTON_UNAVAILABLE");
						return;
					}
					main.button_Portal.toggleButton.bubm.Invoke();
					_pendingPlaguePortalClickIssued = true;
					AutoApiPlugin.Logger.LogInfo((object)"[瘟疫之地] 已模拟点击游戏内蓝色传送门图标。");
				}
				_pendingPlagueNextTime = Time.unscaledTime + 0.35f;
				return;
			}
			if (!((Component)portal).gameObject.activeInHierarchy)
			{
				if (!_pendingPlaguePortalClickIssued)
				{
					UI_Main main = Object.FindObjectOfType<UI_Main>(true);
					if ((Object)(object)main == (Object)null || main.button_Portal == null
						|| main.button_Portal.toggleButton == null || main.button_Portal.toggleButton.bubm == null)
					{
						CompletePendingPlagueRoute("PORTAL_BUTTON_UNAVAILABLE");
						return;
					}
					main.button_Portal.toggleButton.bubm.Invoke();
					_pendingPlaguePortalClickIssued = true;
					AutoApiPlugin.Logger.LogInfo((object)"[瘟疫之地] 已模拟点击游戏内蓝色传送门图标。");
				}
				_pendingPlagueNextTime = Time.unscaledTime + 0.35f;
				return;
			}
			UI_Plaguelands plagueUi = portal.plaguelandsUI;
			Slider plagueSlider = FindPlagueSlider(portal, plagueUi);
			if (plagueSlider == null)
			{
				if (!_pendingPlagueDiagnosticLogged)
				{
					_pendingPlagueDiagnosticLogged = true;
					AutoApiPlugin.Logger.LogWarning((object)("[瘟疫之地] 等待强度控件：UI_Plaguelands="
						+ ((Object)(object)plagueUi != (Object)null)
						+ "，地图面板=" + (portal.plaguelandsElements != null && portal.plaguelandsElements.activeInHierarchy)));
				}
				_pendingPlagueNextTime = Time.unscaledTime + 0.2f;
				return;
			}
			if (_pendingPlaguePhase == 0)
			{
				if (!IsPlaguePageVisible(portal, plagueUi, plagueSlider))
				{
					if (!_pendingPlagueTabClickIssued)
					{
						ActSlot plagueTab = null;
						if (portal.bibm != null)
						{
							foreach (ActSlot slot in portal.bibm.Values)
							{
								string tabName = slot != null && slot.text_ActName != null ? slot.text_ActName.text : "";
								if (tabName.Contains("瘟疫之地") || tabName.Contains("Plague"))
								{
									plagueTab = slot;
									break;
								}
							}
						}
						if (plagueTab == null)
						{
							_pendingPlagueNextTime = Time.unscaledTime + 0.25f;
							return;
						}
						if (plagueTab.btn != null && plagueTab.btn.onClick != null)
						{
							plagueTab.btn.onClick.Invoke();
						}
						else if (plagueTab.button_toggle != null && plagueTab.button_toggle.bubm != null)
						{
							plagueTab.button_toggle.bubm.Invoke();
						}
						else
						{
							CompletePendingPlagueRoute("PLAGUE_TAB_BUTTON_UNAVAILABLE");
							return;
						}
						_pendingPlagueTabClickIssued = true;
						AutoApiPlugin.Logger.LogInfo((object)"[瘟疫之地] 已模拟点击第三章右侧的“瘟疫之地”页签。");
					}
					_pendingPlagueNextTime = Time.unscaledTime + 0.35f;
					return;
				}
				_pendingPlaguePhase = 1;
				_pendingPlagueNextTime = Time.unscaledTime + 0.2f;
				AutoApiPlugin.Logger.LogInfo((object)"[瘟疫之地] 已确认瘟疫地图面板可见，开始调整难度。");
				return;
			}
			if (_pendingPlaguePhase == 1)
			{
				int currentLevel = ReadPlagueLevel(portal, plagueUi, plagueSlider);
				if (!_pendingPlagueLevelDiagnosticLogged)
				{
					_pendingPlagueLevelDiagnosticLogged = true;
					AutoApiPlugin.Logger.LogInfo((object)("[瘟疫之地] 当前显示强度=" + currentLevel
						+ "，Slider.value=" + plagueSlider.value
						+ "，目标=" + _pendingPlagueLevel));
				}
				if (currentLevel < 1 || currentLevel > 20)
				{
					CompletePendingPlagueRoute("PLAGUE_LEVEL_OUT_OF_RANGE:" + currentLevel);
					return;
				}
				if (currentLevel == _pendingPlagueLevel)
				{
					_pendingPlaguePhase = 2;
					_pendingPlagueNextTime = Time.unscaledTime + 0.4f;
					AutoApiPlugin.Logger.LogInfo((object)("[瘟疫之地] 界面强度已到第 " + currentLevel + " 级，准备点击绿色地图节点。"));
					return;
				}
				bool increase = currentLevel < _pendingPlagueLevel;
				NormalButton arrow = FindPlagueArrow(portal, plagueUi, plagueSlider, increase);
				if (arrow == null || arrow.bubm == null)
				{
					CompletePendingPlagueRoute("PLAGUE_DIFFICULTY_BUTTON_UNAVAILABLE");
					return;
				}
				arrow.bubm.Invoke();
				AutoApiPlugin.Logger.LogInfo((object)("[瘟疫之地] 点击强度" + (increase ? "右" : "左")
					+ "箭头；当前=" + currentLevel + "，目标=" + _pendingPlagueLevel + "，控件=" + ((Component)arrow).gameObject.name));
				_pendingPlagueNextTime = Time.unscaledTime + 0.3f;
				return;
			}
			if (_pendingPlaguePhase == 2)
			{
				if (ReadPlagueLevel(portal, plagueUi, plagueSlider) != _pendingPlagueLevel)
				{
					_pendingPlaguePhase = 1;
					_pendingPlagueNextTime = Time.unscaledTime + 0.2f;
					return;
				}
			}
			if (_pendingPlaguePhase == 3)
			{
				string gameStatus = RuntimeMonitor.GetGameStatus();
				string expectedLevel = "|plague_level=" + _pendingPlagueLevel.ToString(System.Globalization.CultureInfo.InvariantCulture) + "|";
				if (gameStatus.Contains("|is_plague=true|") && gameStatus.Contains(expectedLevel))
				{
					if (CloseConfirmedPlaguePortal(portal))
					{
						CompletePendingPlagueRoute("SUCCESS");
					}
					else
					{
						CompletePendingPlagueRoute("PORTAL_CLOSE_BUTTON_UNAVAILABLE");
					}
					return;
				}
				_pendingPlagueNextTime = Time.unscaledTime + 0.35f;
				return;
			}
			StageNode target = plagueUi != null ? plagueUi.biba : null;
			if ((Object)(object)target == (Object)null || target.button_Enter == null)
			{
				target = FindPlagueTarget(portal);
			}
			if ((Object)(object)target == (Object)null || target.button_Enter == null)
			{
				if (!_pendingPlagueDiagnosticLogged)
				{
					_pendingPlagueDiagnosticLogged = true;
					AutoApiPlugin.Logger.LogWarning((object)("[瘟疫之地] 目标节点尚未生成：滑块=" + plagueSlider.value
						+ "，StageNode=" + (((Object)(object)target != (Object)null).ToString())
						+ "，进入按钮=" + (target != null && target.button_Enter != null).ToString()));
				}
				_pendingPlagueNextTime = Time.unscaledTime + 0.2f;
				return;
			}
			if (plagueUi != null)
			{
				plagueUi.myb(target, portal.m_currentStageDifficulty);
			}
			if (target.m_occupiedIcon != null && target.m_occupiedIcon.activeInHierarchy)
			{
				AutoApiPlugin.Logger.LogInfo((object)("[瘟疫之地] 已确认第 " + _pendingPlagueLevel + " 级节点旗标为当前地图。"));
				CompletePendingPlagueRoute(CloseConfirmedPlaguePortal(portal) ? "SUCCESS" : "PORTAL_CLOSE_BUTTON_UNAVAILABLE");
				return;
			}
			if (!target.button_Enter.interactable)
			{
				AutoApiPlugin.Logger.LogWarning((object)("[瘟疫之地] 游戏绿色地图节点当前不可点击，强度=" + _pendingPlagueLevel));
				CompletePendingPlagueRoute("STAGE_LOCKED");
				return;
			}
			target.button_Enter.onClick.Invoke();
			AutoApiPlugin.Logger.LogInfo((object)("[瘟疫之地] 已通过强度滑块选择并请求进入第 " + _pendingPlagueLevel + " 级。"));
			_pendingPlaguePhase = 3;
			_pendingPlagueNextTime = Time.unscaledTime + 0.35f;
		}
		catch (Exception ex)
		{
			AutoApiPlugin.Logger.LogWarning((object)("[瘟疫之地] 等待地图控件时异常：" + ex.Message));
			CompletePendingPlagueRoute("FAILED");
		}
	}

	private static bool CloseConfirmedPlaguePortal(UI_Portal portal)
	{
		if ((Object)(object)portal == (Object)null || !((Component)portal).gameObject.activeInHierarchy)
		{
			return true;
		}
		if (portal.button_Close == null || portal.button_Close.onClick == null)
		{
			AutoApiPlugin.Logger.LogWarning((object)"[瘟疫之地] 地图已确认，但传送门右上角关闭按钮不可用。");
			return false;
		}
		portal.button_Close.onClick.Invoke();
		AutoApiPlugin.Logger.LogInfo((object)"[瘟疫之地] 已确认当前地图等级，模拟点击传送门右上角 X 关闭窗口。");
		return true;
	}

	private static bool IsPlaguePageVisible(UI_Portal portal, UI_Plaguelands plagueUi, Slider plagueSlider)
	{
		try
		{
			if ((Object)(object)portal != (Object)null)
			{
				if (portal.plaguelandsElements != null && portal.plaguelandsElements.activeInHierarchy)
				{
					return true;
				}
				if (portal.m_plaguelandsTitleText != null && portal.m_plaguelandsTitleText.gameObject.activeInHierarchy)
				{
					return true;
				}
			}
			if ((Object)(object)plagueUi != (Object)null)
			{
				if (((Component)plagueUi).gameObject.activeInHierarchy)
				{
					return true;
				}
				if (plagueUi.slider != null && plagueUi.slider.gameObject.activeInHierarchy)
				{
					return true;
				}
				if (plagueUi.intensityText != null && plagueUi.intensityText.gameObject.activeInHierarchy)
				{
					return true;
				}
			}
			if (plagueSlider != null && plagueSlider.gameObject.activeInHierarchy)
			{
				return true;
			}
		}
		catch (Exception ex)
		{
			AutoApiPlugin.Logger?.LogDebug((object)("[瘟疫之地] 检查页签可见状态失败：" + ex.Message));
		}
		return false;
	}

	private static Slider FindPlagueSlider(UI_Portal portal, UI_Plaguelands plagueUi)
	{
		if ((Object)(object)plagueUi != (Object)null && plagueUi.slider != null)
		{
			return plagueUi.slider;
		}
		if ((Object)(object)portal != (Object)null && portal.plaguelandsElements != null)
		{
			Il2CppArrayBase<Slider> sliders = portal.plaguelandsElements.GetComponentsInChildren<Slider>(true);
			TMP_Text levelText = FindPlagueLevelText(portal, plagueUi, null);
			if (sliders != null && sliders.Length > 0)
			{
				if (levelText == null)
				{
					return sliders[0];
				}
				Slider nearest = null;
				float nearestDistance = float.MaxValue;
				for (int i = 0; i < sliders.Length; i++)
				{
					Slider candidate = sliders[i];
					if ((Object)(object)candidate == (Object)null)
					{
						continue;
					}
					float distance = Vector3.Distance(candidate.transform.position, levelText.transform.position);
					if (distance < nearestDistance)
					{
						nearest = candidate;
						nearestDistance = distance;
					}
				}
				return nearest;
			}
		}
		return null;
	}

	private static int ReadPlagueLevel(UI_Portal portal, UI_Plaguelands plagueUi, Slider slider)
	{
		TMP_Text text = FindPlagueLevelText(portal, plagueUi, slider);
		if (text != null && int.TryParse((text.text ?? "").Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out int level)
			&& level >= 1 && level <= 20)
		{
			return level;
		}
		return slider != null ? Mathf.RoundToInt(slider.value) : 0;
	}

	private static TMP_Text FindPlagueLevelText(UI_Portal portal, UI_Plaguelands plagueUi, Slider slider)
	{
		if ((Object)(object)plagueUi != (Object)null && plagueUi.sliderText != null
			&& int.TryParse((plagueUi.sliderText.text ?? "").Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out int configuredLevel)
			&& configuredLevel >= 1 && configuredLevel <= 20)
		{
			return plagueUi.sliderText;
		}
		if ((Object)(object)portal == (Object)null || portal.plaguelandsElements == null)
		{
			return null;
		}
		Il2CppArrayBase<TMP_Text> labels = portal.plaguelandsElements.GetComponentsInChildren<TMP_Text>(true);
		TMP_Text nearest = null;
		float nearestDistance = float.MaxValue;
		for (int i = 0; i < labels.Length; i++)
		{
			TMP_Text label = labels[i];
			if ((Object)(object)label == (Object)null
				|| !int.TryParse((label.text ?? "").Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out int level)
				|| level < 1 || level > 20)
			{
				continue;
			}
			float distance = slider != null ? Vector3.Distance(slider.transform.position, label.transform.position) : 0f;
			if (nearest == null || distance < nearestDistance)
			{
				nearest = label;
				nearestDistance = distance;
			}
		}
		return nearest;
	}

	private static NormalButton FindPlagueArrow(UI_Portal portal, UI_Plaguelands plagueUi, Slider slider, bool increase)
	{
		if ((Object)(object)plagueUi != (Object)null)
		{
			NormalButton configured = increase ? plagueUi.add : plagueUi.sub;
			if ((Object)(object)configured != (Object)null && configured.bubm != null)
			{
				return configured;
			}
		}
		if ((Object)(object)portal == (Object)null || portal.plaguelandsElements == null || slider == null)
		{
			return null;
		}
		Il2CppArrayBase<NormalButton> buttons = portal.plaguelandsElements.GetComponentsInChildren<NormalButton>(true);
		NormalButton nearest = null;
		float nearestDistance = float.MaxValue;
		float centerX = slider.transform.position.x;
		float centerY = slider.transform.position.y;
		for (int i = 0; i < buttons.Length; i++)
		{
			NormalButton button = buttons[i];
			if ((Object)(object)button == (Object)null || button.bubm == null || !((Component)button).gameObject.activeInHierarchy)
			{
				continue;
			}
			Vector3 position = ((Component)button).transform.position;
			float horizontal = position.x - centerX;
			if ((increase && horizontal <= 0.01f) || (!increase && horizontal >= -0.01f)
				|| Math.Abs(position.y - centerY) > 100f)
			{
				continue;
			}
			float distance = Math.Abs(horizontal) + Math.Abs(position.y - centerY) * 2f;
			if (distance < nearestDistance)
			{
				nearest = button;
				nearestDistance = distance;
			}
		}
		return nearest;
	}

	private static StageNode FindPlagueTarget(UI_Portal portal)
	{
		if ((Object)(object)portal == (Object)null || portal.plaguelandsElements == null)
		{
			return null;
		}
		Il2CppArrayBase<StageNode> nodes = portal.plaguelandsElements.GetComponentsInChildren<StageNode>(true);
		StageNode fallback = null;
		for (int i = 0; i < nodes.Length; i++)
		{
			StageNode node = nodes[i];
			if ((Object)(object)node == (Object)null || node.button_Enter == null)
			{
				continue;
			}
			if (fallback == null)
			{
				fallback = node;
			}
			string label = node.m_stageText != null ? node.m_stageText.text : "";
			if (label.Contains("瘟疫") || label.Contains("Plague") || label.Contains("折磨"))
			{
				return node;
			}
		}
		return fallback;
	}

	private void CompletePendingPlagueRoute(string result)
	{
		ApiTask task = _pendingPlagueRouteTask;
		_pendingPlagueRouteTask = null;
		_pendingPlaguePortal = null;
		_pendingPlaguePhase = 0;
		_pendingPlagueDiagnosticLogged = false;
			_pendingPlaguePortalClickIssued = false;
			_pendingPlagueTabClickIssued = false;
		_pendingPlagueLevelDiagnosticLogged = false;
		if (task != null && !task.ResultTcs.Task.IsCompleted)
		{
			task.ResultTcs.SetResult(result);
		}
	}

	private static System.Type FindStashModelType()
	{
		try
		{
			System.Type[] types = typeof(UI_Cube).Assembly.GetTypes();
			for (int i = 0; i < types.Length; i++)
			{
				if (types[i] != null && types[i].Name == "Stash" && types[i].DeclaringType != null && types[i].DeclaringType.Name == "wh")
				{
					return types[i];
				}
			}
		}
		catch (ReflectionTypeLoadException ex)
		{
			System.Type[] types = ex.Types;
			for (int i = 0; i < types.Length; i++)
			{
				if (types[i] != null && types[i].Name == "Stash" && types[i].DeclaringType != null && types[i].DeclaringType.Name == "wh")
				{
					return types[i];
				}
			}
		}
		return null;
	}

	private static object ReadMember(object target, string name)
	{
		if (target == null)
		{
			return null;
		}
		System.Type type = target.GetType();
		BindingFlags flags = BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic;
		PropertyInfo property = type.GetProperty(name, flags);
		if (property != null && property.GetIndexParameters().Length == 0)
		{
			return property.GetValue(target, null);
		}
		FieldInfo field = type.GetField(name, flags);
		return field != null ? field.GetValue(target) : null;
	}

	private static int CollectionCount(object collection)
	{
		object value = ReadMember(collection, "Count") ?? ReadMember(collection, "Length");
		return value == null ? 0 : System.Convert.ToInt32(value);
	}

	private static object CollectionItem(object collection, int index)
	{
		if (collection == null)
		{
			return null;
		}
		PropertyInfo property = collection.GetType().GetProperty("Item", BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);
		return property != null ? property.GetValue(collection, new object[1] { index }) : null;
	}

	private static void CountStashCaches(object cacheCollection, out int used, out int capacity, out string diagnostic)
	{
		used = 0;
		capacity = 0;
		int count = CollectionCount(cacheCollection);
		int saveDataCount = 0;
		int saveUnlockedCount = 0;
		int cacheItemCount = 0;
		System.Text.StringBuilder sample = new System.Text.StringBuilder();
		for (int i = 0; i < count; i++)
		{
			object cache = CollectionItem(cacheCollection, i);
			object saveData = ReadMember(cache, "bgrr");
			if (saveData != null)
			{
				saveDataCount++;
			}
			object unlockedValue = ReadMember(saveData, "IsUnLock");
			if (unlockedValue != null && System.Convert.ToBoolean(unlockedValue))
			{
				saveUnlockedCount++;
				capacity++;
			}
			object savedId = ReadMember(saveData, "ItemUniqueId");
			object cacheId = ReadMember(cache, "burd");
			bool occupied = (savedId != null && System.Convert.ToUInt64(savedId) != 0UL)
				|| (cacheId != null && System.Convert.ToUInt64(cacheId) != 0UL);
			if (occupied)
			{
				cacheItemCount++;
				if (unlockedValue == null || System.Convert.ToBoolean(unlockedValue))
				{
					used++;
				}
			}
			if (i == 0)
			{
				sample.Append("saveUnlock=").Append(unlockedValue ?? "null")
					.Append(",saveId=").Append(savedId ?? "null")
					.Append(",cacheId=").Append(cacheId ?? "null")
					.Append(",flags=")
					.Append(ReadMember(cache, "bura") ?? "null").Append('/')
					.Append(ReadMember(cache, "burc") ?? "null").Append('/')
					.Append(ReadMember(cache, "bure") ?? "null").Append('/')
					.Append(ReadMember(cache, "buri") ?? "null");
			}
		}
		diagnostic = "slots=" + count + ",save=" + saveDataCount + ",unlocked=" + saveUnlockedCount + ",occupied=" + cacheItemCount + ",sample=" + sample;
	}

	private static WarehouseSnapshot ScanWarehousePages()
	{
		if (Time.unscaledTime < _nextWarehouseScanTime)
		{
			return _cachedWarehouseSnapshot ?? new WarehouseSnapshot();
		}
		_nextWarehouseScanTime = Time.unscaledTime + 5f;
		if (!RuntimeMonitor.GetPollution().IsKnown)
		{
			return _cachedWarehouseSnapshot ?? new WarehouseSnapshot();
		}
		WarehouseSnapshot snapshot = new WarehouseSnapshot();
		try
		{
			UIManager manager = Object.FindObjectOfType<UIManager>(true);
			UI_RemakeStash stashUi = ((Object)(object)manager != (Object)null) ? manager.Ui_NewStash : null;
			Il2CppSystem.Collections.Generic.List<StashTabButton> tabs = ((Object)(object)stashUi != (Object)null) ? stashUi.m_stashTabButtonList : null;
			System.Type stashType = FindStashModelType();
			MethodInfo pageMethod = stashType?.GetMethod("kcs", BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static, null, new System.Type[1] { typeof(int) }, null);
			if (pageMethod == null || tabs == null || tabs.Count == 0)
			{
				AutoApiPlugin.Logger.LogWarning((object)("[仓库监控] 无法读取用户仓库页：标签数=" + ((tabs != null) ? tabs.Count : 0) + ", 页面读取接口=" + (pageMethod != null)));
				return snapshot;
			}
			snapshot.TabEntries = tabs.Count;
			int firstTabKey = tabs[0].bhxp;
			System.Collections.Generic.List<StashTabButton> validTabs = new System.Collections.Generic.List<StashTabButton>();
			System.Collections.Generic.HashSet<int> uniqueTabKeys = new System.Collections.Generic.HashSet<int>();
			for (int i = 0; i < tabs.Count; i++)
			{
				StashTabButton tab = tabs[i];
				if ((Object)(object)tab == (Object)null)
				{
					continue;
				}
				int tabKey = tab.bhxp;
				if (tabKey < 0 || tabKey < firstTabKey || !uniqueTabKeys.Add(tabKey))
				{
					continue;
				}
				validTabs.Add(tab);
			}
			snapshot.PageTabs = validTabs.Count;
			if (validTabs.Count == 0)
			{
				AutoApiPlugin.Logger.LogWarning((object)("[仓库监控] 页签列表没有可读取的唯一页键（总项数=" + tabs.Count + "）。"));
				return snapshot;
			}
			firstTabKey = validTabs[0].bhxp;
			int pageKeyOffset = 0;
			System.Collections.Generic.HashSet<IntPtr> uniqueCachePointers = new System.Collections.Generic.HashSet<IntPtr>();
			System.Collections.Generic.HashSet<string> uniquePageContents = new System.Collections.Generic.HashSet<string>(System.StringComparer.Ordinal);
			System.Collections.Generic.List<int> scannedPageKeys = new System.Collections.Generic.List<int>();
			object firstPageProbe = pageMethod.Invoke(null, new object[1] { firstTabKey });
			if (CollectionCount(firstPageProbe) == 0 && CollectionCount(pageMethod.Invoke(null, new object[1] { firstTabKey + 1 })) > 0)
			{
				pageKeyOffset = 1;
			}
			for (int i = 0; i < validTabs.Count; i++)
			{
				StashTabButton tab = validTabs[i];
				int pageKey = tab.bhxp + pageKeyOffset;
				object pageCaches = pageMethod.Invoke(null, new object[1] { pageKey });
				if (CollectionCount(pageCaches) == 0)
				{
					AutoApiPlugin.Logger.LogWarning((object)("[仓库监控] 第 " + (i + 1) + " 页缓存为空（标签键=" + pageKey + "）。"));
					break;
				}
				bool duplicateCachePointer = pageCaches is Il2CppObjectBase cacheObject
					&& cacheObject.Pointer != IntPtr.Zero && !uniqueCachePointers.Add(cacheObject.Pointer);
				string pageContent = GetOccupiedPageSignature(pageCaches);
				bool duplicatePageContent = pageContent.Length > 0 && !uniquePageContents.Add(pageContent);
				if (duplicateCachePointer || duplicatePageContent)
				{
					snapshot.PageTabs--;
					AutoApiPlugin.Logger.LogInfo((object)("[仓库监控] 第 " + (i + 1) + " 页重复引用仓库数据，跳过（标签键=" + pageKey + "）。"));
					continue;
				}
				scannedPageKeys.Add(tab.bhxp);
				CountStashCaches(pageCaches, out var used, out var capacity, out var diagnostic);
				snapshot.Pages.Add(new WarehousePageSnapshot { PageNumber = i + 1, PageKey = pageKey, Used = used, Capacity = capacity });
				snapshot.Used += used;
				snapshot.Capacity += capacity;
				if (capacity > 0)
				{
					snapshot.OwnedPages++;
				}
				if (!_lastWarehouseRawDiagnostics.TryGetValue(i + 1, out var previousDiagnostic) || !string.Equals(diagnostic, previousDiagnostic, StringComparison.Ordinal))
				{
					_lastWarehouseRawDiagnostics[i + 1] = diagnostic;
					AutoApiPlugin.Logger.LogInfo((object)("[仓库监控原始值] 第 " + (i + 1) + " 页 " + diagnostic));
				}
			}
			snapshot.PageKeys = string.Join(",", scannedPageKeys);
			if (snapshot.Pages.Count == snapshot.PageTabs)
			{
				string signature = snapshot.Used + "/" + snapshot.Capacity;
				if (!string.Equals(signature, _lastWarehouseMonitorSignature, StringComparison.Ordinal))
				{
					_lastWarehouseMonitorSignature = signature;
					AutoApiPlugin.Logger.LogInfo((object)("[仓库监控] 唯一仓库页扫描完成（有效页键=" + snapshot.PageKeys + "）：" + snapshot.Used + "/" + snapshot.Capacity + " 格，负载=" + snapshot.Percent.ToString("0.0", System.Globalization.CultureInfo.InvariantCulture) + "%。"));
				}
			}
		}
		catch (Exception ex)
		{
			AutoApiPlugin.Logger.LogWarning((object)("[仓库监控] 扫描异常：" + ex.Message));
		}
		if (snapshot.IsComplete)
		{
			_cachedWarehouseSnapshot = snapshot;
		}
		return snapshot;
	}

	private static string ReadWarehouseItems()
	{
		WarehouseSnapshot snapshot = ScanWarehousePages();
		if (!snapshot.IsComplete)
		{
			return System.Text.Json.JsonSerializer.Serialize(new { status = "WAITING", message = "等待角色和仓库数据加载" });
		}
		var items = new System.Collections.Generic.List<object>();
		var diagnostics = new System.Collections.Generic.List<object>();
		int missing = 0;
		foreach (WarehousePageSnapshot page in snapshot.Pages)
		{
			var slots = wh.Stash.kcs(page.PageKey);
			if (slots == null) continue;
			for (int index = 0; index < slots.Count; index++)
			{
				try
				{
					wh.StashCache slot = slots[index];
					if (slot == null || slot.bgrr == null || !slot.bgrr.IsUnLock) continue;
					ulong uniqueId = slot.bgrr.ItemUniqueId != 0UL ? slot.bgrr.ItemUniqueId : slot.burd;
					if (uniqueId == 0UL) continue;
					wh.vc.va cache = null;
					var inventoryCaches = wh.vc.bglb;
					if (inventoryCaches != null) inventoryCaches.TryGetValue(uniqueId, out cache);
					ItemInfoData info = cache != null ? cache.bukr : null;
					if (info == null)
					{
						missing++;
						continue;
					}
					int quantity = slot.burg;
					bool quantityKnown = quantity > 0 && (info.MaxStack <= 0 || quantity <= info.MaxStack);
					if (info.ITEMTYPE == EItemType.GEAR && !quantityKnown)
					{
						quantity = 1;
						quantityKnown = true;
					}
					items.Add(new
					{
						item_key = info.ItemKey,
						name = RuntimeMonitor.ResolveItemName(info.NameKey),
						name_key = info.NameKey ?? "",
						icon_path = info.IconPath ?? "",
						grade = (int)info.GRADE,
						level = info.Level,
						type = info.ITEMTYPE.ToString(),
						quantity = quantityKnown ? quantity : 0,
						quantity_known = quantityKnown,
						marketable_definition = info.IsSteamItem && info.IsCanExchangeMarketable && !info.TemporaryBlockTradingStash,
						page = page.PageNumber,
						slot = index
					});
					if (diagnostics.Count < 6)
					{
						diagnostics.Add(new { key = info.ItemKey, kind = info.ITEMTYPE.ToString(), max_stack = info.MaxStack,
							slot_key = slot.burf, slot_count = slot.burg, slot_other = slot.burh,
							cache_key = cache.buks, cache_bulk = cache.bulk, cache_bulm = cache.bulm,
							cache_buln = cache.buln, cache_bulo = cache.bulo, cache_bulu = cache.bulu,
							cache_bulv = cache.bulv, cache_bulw = cache.bulw });
					}
				}
				catch (Exception ex)
				{
					missing++;
					if (missing <= 3) AutoApiPlugin.Logger.LogWarning((object)("[仓库道具] 道具读取失败：" + ex.Message));
				}
			}
		}
		return System.Text.Json.JsonSerializer.Serialize(new { status = "SUCCESS", read_at = System.DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
			used = snapshot.Used, capacity = snapshot.Capacity, pages = snapshot.OwnedPages, missing, items, diagnostics });
	}

	private static string GetOccupiedPageSignature(object cacheCollection)
	{
		System.Text.StringBuilder signature = new System.Text.StringBuilder();
		int count = CollectionCount(cacheCollection);
		for (int i = 0; i < count; i++)
		{
			object cache = CollectionItem(cacheCollection, i);
			object saveData = ReadMember(cache, "bgrr");
			object savedId = ReadMember(saveData, "ItemUniqueId");
			object cacheId = ReadMember(cache, "burd");
			ulong itemId = savedId != null ? System.Convert.ToUInt64(savedId) : 0UL;
			if (itemId == 0UL && cacheId != null)
			{
				itemId = System.Convert.ToUInt64(cacheId);
			}
			if (itemId != 0UL)
			{
				signature.Append(itemId.ToString(System.Globalization.CultureInfo.InvariantCulture)).Append(',');
			}
		}
		return signature.ToString();
	}

	private void ProcessPendingSynthType()
	{
		ApiTask task = _pendingSynthTypeTask;
		if (task == null || Time.unscaledTime < _pendingSynthTypeNextTime)
		{
			return;
		}
		if (Time.unscaledTime - _pendingSynthTypeStartTime > 4f)
		{
			AutoApiPlugin.Logger.LogWarning((object)("[腐蚀类别] 等待类别按钮渲染超时，目标类型=" + _pendingSynthTypeValue));
			CompletePendingSynthType("FAILED");
			return;
		}
		try
		{
			bool waiting;
			if (TryExecuteSynthType(_pendingSynthTypeValue, out waiting))
			{
				CompletePendingSynthType("SUCCESS");
			}
			else if (waiting)
			{
				_pendingSynthTypeNextTime = Time.unscaledTime + 0.2f;
			}
			else
			{
				CompletePendingSynthType("FAILED");
			}
		}
		catch (Exception ex)
		{
			AutoApiPlugin.Logger.LogWarning((object)("[腐蚀类别] 选择类别异常：" + ex));
			CompletePendingSynthType("FAILED");
		}
	}

	private void CompletePendingSynthType(string result)
	{
		ApiTask task = _pendingSynthTypeTask;
		_pendingSynthTypeTask = null;
		_pendingSynthTypeStartTime = 0f;
		_pendingSynthTypeNextTime = 0f;
		_pendingSynthTypeDropdownClickIssued = false;
		_pendingSynthTypeWaitLogged = false;
		if (task != null && !task.ResultTcs.Task.IsCompleted)
		{
			task.ResultTcs.SetResult(result);
		}
	}

	private bool TryExecuteSynthType(int typeInt, out bool waiting)
	{
		waiting = false;
		UI_Cube cube = Object.FindObjectOfType<UI_Cube>(true);
		if ((Object)(object)cube == (Object)null || !((Component)cube).gameObject.activeInHierarchy)
		{
			waiting = true;
			return false;
		}
		CubeSlotSetter cubeSlots = cube.m_cubeSlotSetter;
		if ((Object)(object)cubeSlots == (Object)null || cubeSlots.m_cubeInventorySlots == null
			|| cubeSlots.m_cubeInventorySlots.Count < REQUIRED_CUBE_ITEMS
			|| (Object)(object)cube.m_synthesisAutoFillButton == (Object)null)
		{
			LogSynthTypeWait(typeInt, "魔方内部数据/九个物品槽尚未初始化");
			waiting = true;
			return false;
		}
		SynthesisItemTypeComboBoxButton combo = cube.m_synthesisItemTypeButton;
		if ((Object)(object)combo == (Object)null)
		{
			waiting = true;
			return false;
		}
		Il2CppSystem.Collections.Generic.List<SynthesisItemTypeChangerButton> buttons = null;
		try
		{
			buttons = combo.m_buttons;
		}
		catch (Exception ex)
		{
			LogSynthTypeWait(typeInt, "读取类别列表暂不可用：" + ex.Message);
			waiting = true;
			return false;
		}
		int buttonCount = 0;
		try
		{
			buttonCount = buttons != null ? buttons.Count : 0;
		}
		catch (Exception ex)
		{
			LogSynthTypeWait(typeInt, "类别列表尚未初始化：" + ex.Message);
			waiting = true;
			return false;
		}
		if (buttons == null || buttonCount == 0)
		{
			if (!_pendingSynthTypeDropdownClickIssued)
			{
				try
				{
					if (combo.bubm != null)
					{
						combo.bubm.Invoke();
					}
					else
					{
						ClickGameObject(((Component)combo).gameObject, "等待类型列表渲染：展开类别下拉框");
					}
				}
				catch (Exception ex)
				{
					LogSynthTypeWait(typeInt, "打开类别列表异常：" + ex.Message);
				}
				_pendingSynthTypeDropdownClickIssued = true;
			}
			LogSynthTypeWait(typeInt, "类别列表尚未渲染");
			waiting = true;
			return false;
		}
		SynthesisItemTypeChangerButton target = null;
		for (int i = 0; i < buttonCount; i++)
		{
			SynthesisItemTypeChangerButton candidate = buttons[i];
			if ((Object)(object)candidate != (Object)null && (int)candidate.m_synthesisItemType == typeInt)
			{
				target = candidate;
				break;
			}
		}
		if ((Object)(object)target == (Object)null || (Object)(object)target.m_button == (Object)null)
		{
			LogSynthTypeWait(typeInt, "尚未找到对应类别按钮");
			waiting = true;
			return false;
		}
		Button.ButtonClickedEvent categoryClick = null;
		try
		{
			categoryClick = target.m_button.onClick;
		}
		catch (Exception ex)
		{
			LogSynthTypeWait(typeInt, "类别按钮尚未就绪：" + ex.Message);
			waiting = true;
			return false;
		}
		if (categoryClick == null)
		{
			LogSynthTypeWait(typeInt, "类别按钮点击事件尚未就绪");
			waiting = true;
			return false;
		}
		GameObject categoryButtonObject = ((Component)target.m_button).gameObject;
		if ((Object)(object)categoryButtonObject == (Object)null)
		{
			LogSynthTypeWait(typeInt, "类别按钮对象尚未初始化");
			waiting = true;
			return false;
		}
		categoryButtonObject.SetActive(true);
		try
		{
			categoryClick.Invoke();
		}
		catch (Exception ex)
		{
			AutoApiPlugin.Logger.LogWarning((object)("[腐蚀类别] 游戏原生切换回调失败，停止本轮以避免重复空引用：" + ex.Message));
			waiting = false;
			return false;
		}
		bool selected = false;
		try
		{
			selected = target.m_selectObject != null && target.m_selectObject.activeInHierarchy;
		}
		catch
		{
		}
		AutoApiPlugin.Logger.LogInfo((object)("[腐蚀类别] 已触发游戏类别按钮：" + target.m_synthesisItemType
			+ "；选中标记=" + selected));
		try
		{
			if (combo.m_comboBoxObject != null && combo.m_comboBoxObject.activeInHierarchy && combo.bubm != null)
			{
				combo.bubm.Invoke();
			}
		}
		catch (Exception ex)
		{
			AutoApiPlugin.Logger.LogDebug((object)("[腐蚀类别] 收起类别菜单时可忽略异常：" + ex.Message));
		}
		return true;
	}

	private void LogSynthTypeWait(int typeInt, string reason)
	{
		if (_pendingSynthTypeWaitLogged)
		{
			return;
		}
		_pendingSynthTypeWaitLogged = true;
		AutoApiPlugin.Logger.LogInfo((object)("[腐蚀类别] 等待界面就绪：目标类型=" + typeInt + "，" + reason));
	}

	private bool ExecuteSynthOperation(string operation, out bool needsSuspend)
	{
		needsSuspend = false;
		if (operation != "corrosion" && operation != "synthesis")
		{
			return false;
		}
		UI_Cube cube = Object.FindObjectOfType<UI_Cube>(true);
		if ((Object)(object)cube == (Object)null || !((Component)cube).gameObject.activeInHierarchy)
		{
			return false;
		}
		ComboBoxButton combo = cube.m_mainRecipeToggleBtn;
		if ((Object)(object)combo == (Object)null)
		{
			return false;
		}
		MainRecipeSlotButton corrosionButton = CorrosionRecipeSelector.Find(cube, combo, operation);
		if ((Object)(object)corrosionButton != (Object)null && corrosionButton.m_isSelected)
		{
			return true;
		}
		if ((Object)(object)corrosionButton == (Object)null)
		{
			GameObject dropdown = combo.m_comboBoxObject;
			bool expanded = (Object)(object)dropdown != (Object)null && dropdown.activeInHierarchy;
			if (!_operationMenuOpenRequested && !expanded)
			{
				ClickGameObject(((Component)combo).gameObject, "展开魔方操作下拉框");
				_operationMenuOpenRequested = true;
			}
			string waitState = expanded || _operationMenuOpenRequested
					? "操作菜单已展开，等待腐蚀选项渲染"
					: "等待魔方操作菜单渲染";
			if (waitState != _lastOperationWaitLog)
			{
				AutoApiPlugin.Logger.LogInfo((object)("[腐蚀] " + waitState));
				_lastOperationWaitLog = waitState;
			}
			needsSuspend = true;
			return false;
		}
		((Component)corrosionButton).gameObject.SetActive(true);
		if ((Object)(object)corrosionButton.m_clickButton == (Object)null)
		{
			return false;
		}
        ClickGameObject(((Component)corrosionButton.m_clickButton).gameObject, "选择魔方操作 -> " + operation);
        needsSuspend = true;
        return false;
	}

	private bool ExecuteSynthLevel(string targetLevel, out bool needsSuspend)
	{
		needsSuspend = false;
		UI_Cube cube = Object.FindObjectOfType<UI_Cube>(true);
		if ((Object)(object)cube == (Object)null || !((Component)cube).gameObject.activeInHierarchy)
		{
			return false;
		}
		string wanted = targetLevel.Replace("~", "-").Replace(" ", "").ToLowerInvariant();
		Il2CppArrayBase<SubRecipeComboBoxButton> combos = Object.FindObjectsOfType<SubRecipeComboBoxButton>(true);
		SubRecipeComboBoxButton expandable = null;
		System.Collections.Generic.List<string> observed = new System.Collections.Generic.List<string>();
		for (int i = 0; i < combos.Length; i++)
		{
			SubRecipeComboBoxButton combo = combos[i];
			if ((Object)(object)combo == (Object)null || !((Component)combo).gameObject.activeInHierarchy)
			{
				continue;
			}
			Il2CppSystem.Collections.Generic.List<SubRecipeSlotButton> slots = combo.m_subRecipeSlotButton;
			if (slots == null || slots.Count == 0)
			{
				continue;
			}
			if (expandable == null)
			{
				expandable = combo;
			}
			for (int j = 0; j < slots.Count; j++)
			{
				SubRecipeSlotButton slot = slots[j];
				if ((Object)(object)slot == (Object)null || (Object)(object)((RecipeSlotButton)slot).m_text == (Object)null)
				{
					continue;
				}
				string label = ((TMP_Text)((RecipeSlotButton)slot).m_text).text ?? "";
				string normalized = label.Replace("~", "-").Replace(" ", "").ToLowerInvariant();
				if (!observed.Contains(label))
				{
					observed.Add(label);
				}
				if (((RecipeSlotButton)slot).m_isSelected && normalized.Contains(wanted))
				{
					_lastLevelDiagnostic = null;
					return true;
				}
				if (!((RecipeSlotButton)slot).m_isLocked && normalized.Contains(wanted) && (Object)(object)((RecipeSlotButton)slot).m_clickButton != (Object)null)
				{
					ClickGameObject(((Component)((RecipeSlotButton)slot).m_clickButton).gameObject, "锁定配方等级 -> " + targetLevel);
					GameObject dropdownAfterSelect = combo.m_comboBoxObject;
					if ((Object)(object)dropdownAfterSelect != (Object)null && dropdownAfterSelect.activeInHierarchy)
					{
						ClickGameObject(((Component)combo).gameObject, "收起配方下拉框");
					}
					_lastLevelDiagnostic = null;
					return true;
				}
			}
		}
		if (expandable == null)
		{
			AutoApiPlugin.Logger.LogWarning((object)("[等级] 没有活动的等级下拉框，目标=" + targetLevel));
			return false;
		}
		GameObject dropdown = expandable.m_comboBoxObject;
		bool isExpanded = (Object)(object)dropdown != (Object)null && dropdown.activeInHierarchy;
		if (!isExpanded)
		{
			ClickGameObject(((Component)expandable).gameObject, "展开等级下拉框");
		}
		string diagnostic = "目标=" + targetLevel + "; 已展开=" + isExpanded + "; 当前选项=" + string.Join("|", observed);
		if (diagnostic != _lastLevelDiagnostic)
		{
			AutoApiPlugin.Logger.LogInfo((object)("[等级] 等待目标选项渲染；" + diagnostic));
			_lastLevelDiagnostic = diagnostic;
		}
		needsSuspend = true;
		return false;
	}

	private bool ExecuteSynthClear()
	{
		UI_Cube val = Object.FindObjectOfType<UI_Cube>(true);
		if ((Object)(object)val == (Object)null || !((Component)val).gameObject.activeInHierarchy)
		{
			return false;
		}
		if ((Object)(object)val.m_trashToggleBtn != (Object)null && (Object)(object)val.m_trashToggleBtn.m_button != (Object)null)
		{
			val.m_trashToggleBtn.m_button.onClick.Invoke();
			return true;
		}
		return false;
	}

	private void CompletePendingFill(string result)
	{
		ApiTask pendingFillTask = _pendingFillTask;
		_pendingFillTask = null;
		_pendingFillWaitingForStorage = false;
		_pendingFillWaitingForItems = false;
		_pendingFillExcludeInscriptionScrolls = false;
        _pendingFillAllowPartial = false;
        _pendingFillCountStableSince = 0f;
		_pendingFillCleaningExcluded = false;
		_pendingExcludedSlotIndices.Clear();
		_pendingExcludedSlotCursor = 0;
		_pendingExcludedNextClickTime = 0f;
		_pendingExcludedSettleTime = 0f;
		_pendingFillTime = 0f;
		_pendingFillStartTime = 0f;
		_lastPendingFillCount = -1;
		if (pendingFillTask != null)
		{
			pendingFillTask.ResultTcs.SetResult(result);
		}
	}

	private bool QueueExcludedScrollCleanup(UI_Cube cube)
	{
		if (!_pendingFillExcludeInscriptionScrolls || (Object)(object)cube == (Object)null
			|| (Object)(object)cube.m_cubeSlotSetter == (Object)null)
		{
			return false;
		}
		Il2CppSystem.Collections.Generic.List<CubeInventorySlot> slots = cube.m_cubeSlotSetter.m_cubeInventorySlots;
		if (slots == null) return false;
		_pendingExcludedSlotIndices.Clear();
		for (int i = 0; i < slots.Count; i++)
		{
			CubeInventorySlot slot = slots[i];
			if ((Object)(object)slot == (Object)null || slot._cubeData == null) continue;
			try
			{
				int key = CubeItemKey(slot._cubeData);
				if (key > 0 && IsProtectedCorrosionMaterial(slot._cubeData))
				{
					_pendingExcludedSlotIndices.Add(i);
				}
			}
			catch
			{
			}
		}
		if (_pendingExcludedSlotIndices.Count == 0) return false;
		_pendingFillCleaningExcluded = true;
		_pendingExcludedSlotCursor = 0;
		_pendingExcludedNextClickTime = Time.unscaledTime;
		_pendingExcludedSettleTime = 0f;
		AutoApiPlugin.Logger.LogInfo((object)("[腐蚀排除项] 检出 " + _pendingExcludedSlotIndices.Count
			+ " 个铭文/铭刻材料；逐个退回，间隔2秒，保留其他物品。"));
		return true;
	}

	private void ProcessPendingExcludedScrollCleanup()
    {
        if (Time.unscaledTime < _pendingExcludedNextClickTime) return;
        UI_Cube cube = Object.FindObjectOfType<UI_Cube>(true);
        if (cube == null || cube.m_cubeSlotSetter == null) { CompletePendingFill("EXCLUSION_NOT_READY"); return; }
        if (TryFindExcludedInscriptionScroll(cube, out int slotIndex, out int itemKey))
        {
            var slots = cube.m_cubeSlotSetter.m_cubeInventorySlots;
            var slot = slots != null && slotIndex >= 0 && slotIndex < slots.Count ? slots[slotIndex] : null;
            if (slot == null || _pendingExcludedSlotCursor >= 18)
            { CompletePendingFill("EXCLUSION_NOT_READY"); return; }
            try
            {
                ReturnProtectedCubeItem(slot);
                _pendingExcludedSlotCursor++;
                _pendingExcludedNextClickTime = _pendingExcludedSettleTime = Time.unscaledTime + 2f;
                AutoApiPlugin.Logger.LogInfo((object)("[腐蚀排除项] 已请求退回铭文/铭刻材料，当前槽位=" + slotIndex + "；其他物品保留。"));
            }
            catch (Exception ex)
            {
                AutoApiPlugin.Logger.LogWarning((object)("[腐蚀排除项] 退回尚未完成：" + ex.Message));
                CompletePendingFill("EXCLUSION_NOT_READY");
            }
            return;
        }
        if (Time.unscaledTime < _pendingExcludedSettleTime) return;
        int count = CountCubeItems(cube);
        AutoApiPlugin.Logger.LogInfo((object)("[腐蚀排除项] 已确认全部剔除，保留" + count + "件合格物品继续腐蚀。"));
        CompletePendingFill(_pendingFillAllowPartial ? CubeBatchPolicy.CorrosionFillStatus(count) : "NOT_ENOUGH_" + count);
    }

	private static void ReturnProtectedCubeItem(CubeInventorySlot slot)
    {
        int cubeIndex = slot._cubeData.InCubeIndex;
        if (cubeIndex < 0 || cubeIndex >= REQUIRED_CUBE_ITEMS)
            throw new System.InvalidOperationException("魔方格子编号尚未同步。");
        // 游戏拖出魔方的入口：CubeInventorySlot.ibc/ibe调用jac，jac保留游戏的退回检查。
        wh.Cube.jac(cubeIndex);
    }

    private bool HasPendingCubeUiTask()
    {
        return _pendingFillTask != null || _pendingSynthTypeTask != null
            || _pendingOperationTask != null || _pendingLevelTask != null;
    }

    private static bool IsMutatingUiCommand(string command)
    {
        return command.StartsWith("chest_") || command.StartsWith("plague_")
            || (command.StartsWith("store_") && command != "store_check_full")
            || (command.StartsWith("synth_") && command != "synth_current_operation"
                && !command.StartsWith("synth_validate_"));
    }

	private void BeginPendingAutoFill(UI_Cube cube)
	{
		if (_pendingFillTargetStorage)
		{
			WarehouseSnapshot warehouse = ScanWarehousePages();
			if (!warehouse.IsComplete)
			{
				AutoApiPlugin.Logger.LogWarning((object)("[自动填充] 仓库页扫描未完成（" + warehouse.Pages.Count + "/" + warehouse.PageTabs + "），取消本轮填充。"));
				CompletePendingFill("WAREHOUSE_SCAN_FAILED");
				return;
			}
			System.Text.StringBuilder pageSummary = new System.Text.StringBuilder();
			for (int i = 0; i < warehouse.Pages.Count; i++)
			{
				if (i > 0)
				{
					pageSummary.Append("；");
				}
				WarehousePageSnapshot page = warehouse.Pages[i];
				pageSummary.Append("第").Append(page.PageNumber).Append("页 ").Append(page.Used).Append('/').Append(page.Capacity);
			}
			AutoApiPlugin.Logger.LogInfo((object)("[自动填充] 已检查用户拥有的 " + warehouse.OwnedPages + " 页仓库：" + pageSummary + "；之后调用游戏内自动填充。"));
		}
		if ((Object)(object)cube.m_synthesisAutoFillButton == (Object)null)
		{
			CompletePendingFill("FAILED");
			return;
		}
		if (cube.m_synthesisAutoFillButton.bubm != null)
		{
			cube.m_synthesisAutoFillButton.bubm.Invoke();
			AutoApiPlugin.Logger.LogInfo((object)"[自动填充] 已直接触发游戏自动填充按钮事件。");
		}
		else
		{
			ClickGameObject(((Component)cube.m_synthesisAutoFillButton).gameObject, "自动填充");
		}
		_pendingFillWaitingForStorage = false;
		_pendingFillWaitingForItems = true;
        _lastPendingFillCount = -1;
        _pendingFillCountStableSince = Time.unscaledTime;
		_pendingFillTime = Time.unscaledTime + 0.5f;
	}

	private static int CountCubeItems(UI_Cube cube)
	{
		if ((Object)(object)cube == (Object)null || (Object)(object)cube.m_cubeSlotSetter == (Object)null)
		{
			return 0;
		}
		Il2CppSystem.Collections.Generic.List<CubeInventorySlot> slots = cube.m_cubeSlotSetter.m_cubeInventorySlots;
		if (slots == null)
		{
			return 0;
		}
		int count = 0;
		for (int i = 0; i < slots.Count; i++)
		{
			CubeInventorySlot slot = slots[i];
			if ((Object)(object)slot == (Object)null || slot._cubeData == null)
			{
				continue;
			}
			try
			{
				if (CubeItemKey(slot._cubeData) > 0)
				{
					count++;
				}
			}
			catch
			{
			}
		}
		return count;
	}

	private string ExecuteSynthValidation(int maxGrade, string expectedOperation)
	{
		if (maxGrade < 0 || maxGrade > 9)
		{
			return "INVALID_MAX_GRADE";
		}
		UI_Cube cube = Object.FindObjectOfType<UI_Cube>(true);
		if ((Object)(object)cube == (Object)null || !((Component)cube).gameObject.activeInHierarchy)
		{
			return "NO_UI";
		}
		if (!SlotsWithinGradeLimit(cube, maxGrade, out var offender, out var itemCount))
		{
			AutoApiPlugin.Logger.LogWarning((object)("[安全锁] 只读校验拒绝：" + offender + "；上限品质=" + maxGrade + "。"));
			return "EXCEED_MAX_GRADE";
		}
        if (!CubeBatchPolicy.IsValidCount(expectedOperation, itemCount))
		{
			AutoApiPlugin.Logger.LogWarning((object)("[安全锁] 只读校验未通过：" + itemCount + "/" + REQUIRED_CUBE_ITEMS + " 件。"));
			return "NOT_ENOUGH";
		}
		AutoApiPlugin.Logger.LogInfo((object)("[安全锁] 只读品质校验通过：" + itemCount + "/" + REQUIRED_CUBE_ITEMS + " 件，逐格品质均≤" + GradeLabel(maxGrade) + "；未执行腐蚀。"));
        if (expectedOperation == "corrosion")
        {
            Button trigger = cube.toggleButton_Trigger != null ? InnerButton(cube.toggleButton_Trigger) : null;
            return "QUALITY_OK|count=" + itemCount + "|game_ready=" + (trigger != null && trigger.interactable ? "true" : "false");
        }
        return "QUALITY_OK";
	}

	private static string GradeLabel(int grade)
	{
		string[] labels = new string[10] { "普通", "罕见", "稀有", "传说", "不朽", "至宝", "超凡", "天界", "神圣", "宇宙" };
		return grade >= 0 && grade < labels.Length ? labels[grade] + " (" + grade + ")" : "未知 (" + grade + ")";
	}

	private string ExecuteSynthAction(int maxGrade, bool excludeInscriptionScrolls, string expectedOperation)
	{
        if (RuntimeMonitor.IsCorrosionActionPending() || SynthesisActionMonitor.IsPending()) return "ACTION_PENDING";
        string inventoryReadiness = InventoryOperationGate.Readiness();
        if (inventoryReadiness != "READY")
        {
            AutoApiPlugin.Logger.LogWarning((object)("[腐蚀等待] 库存尚未结算，取消本轮提交：" + inventoryReadiness));
            return "INVENTORY_NOT_READY:" + inventoryReadiness;
        }
		//IL_0054: Unknown result type (might be due to invalid IL or missing references)
		//IL_005b: Expected O, but got Unknown
		//IL_00b0: Unknown result type (might be due to invalid IL or missing references)
		//IL_00b7: Expected O, but got Unknown
		UI_Cube val = Object.FindObjectOfType<UI_Cube>(true);
		if ((Object)(object)val == (Object)null || !((Component)val).gameObject.activeInHierarchy)
		{
			return "NO_UI";
		}
		if (maxGrade < 0 || maxGrade > 9)
		{
			AutoApiPlugin.Logger.LogWarning((object)("[安全锁] 拒绝执行：品质上限无效 " + maxGrade + "。"));
			return "INVALID_MAX_GRADE";
		}
        if (expectedOperation != "corrosion" && expectedOperation != "synthesis") return "OPERATION_REQUIRED";
        var operationButton = val.m_mainRecipeToggleBtn != null
            ? CorrosionRecipeSelector.Find(val, val.m_mainRecipeToggleBtn, expectedOperation) : null;
        if (operationButton == null || !operationButton.m_isSelected) return "WRONG_OPERATION";
		if (excludeInscriptionScrolls && TryFindExcludedInscriptionScroll(val, out int excludedSlot, out int excludedItemKey))
		{
			AutoApiPlugin.Logger.LogWarning((object)("[腐蚀排除项] 最终执行校验发现铭文卷轴，槽位="
				+ excludedSlot.ToString(CultureInfo.InvariantCulture) + "，ItemKey="
				+ excludedItemKey.ToString(CultureInfo.InvariantCulture) + "；先剔除后继续当前批次。"));
			return "NEEDS_EXCLUSION";
		}
		bool flag = default(bool);
		if (!SlotsWithinGradeLimit(val, maxGrade, out var offender, out var itemCount))
		{
			ManualLogSource logger = AutoApiPlugin.Logger;
			BepInExWarningLogInterpolatedStringHandler val2 = new BepInExWarningLogInterpolatedStringHandler(28, 1, out flag);
			if (flag)
			{
				((BepInExLogInterpolatedStringHandler)val2).AppendLiteral("⚠\ufe0f [安全锁拦截] 发现违规物品: ");
				((BepInExLogInterpolatedStringHandler)val2).AppendFormatted<string>(offender);
				((BepInExLogInterpolatedStringHandler)val2).AppendLiteral("！已终止本次合成。");
			}
			logger.LogWarning(val2);
			return "EXCEED_MAX_GRADE";
		}
        if (!CubeBatchPolicy.IsValidCount(expectedOperation, itemCount))
		{
			ManualLogSource logger2 = AutoApiPlugin.Logger;
			BepInExInfoLogInterpolatedStringHandler val3 = new BepInExInfoLogInterpolatedStringHandler(20, 1, out flag);
			if (flag)
			{
				((BepInExLogInterpolatedStringHandler)val3).AppendLiteral("[腐蚀] 物品格数不符，当前 ");
				((BepInExLogInterpolatedStringHandler)val3).AppendFormatted<int>(itemCount);
				((BepInExLogInterpolatedStringHandler)val3).AppendLiteral("/9，跳过执行");
			}
			logger2.LogInfo(val3);
			return "NOT_ENOUGH";
		}
		AutoApiPlugin.Logger.LogInfo((object)("[安全锁] 品质校验通过：" + itemCount + "/" + REQUIRED_CUBE_ITEMS + " 件，逐格品质均≤" + GradeLabel(maxGrade) + "；未知物品一律拦截。"));
		if ((Object)(object)val.toggleButton_Trigger != (Object)null)
		{
            Button trigger = InnerButton(val.toggleButton_Trigger);
            if (trigger == null || !trigger.interactable) return "GAME_NOT_READY";
            string permission = InventoryOperationGate.TryBeginHelperAction();
            if (permission != "READY") return permission;
			float secondsSinceLastAction = Time.unscaledTime - _lastSynthActionTime;
			if (secondsSinceLastAction < MIN_SYNTH_ACTION_INTERVAL_SECONDS)
			{
				AutoApiPlugin.Logger.LogWarning((object)("[腐蚀节流] 距上次魔方执行仅 " + secondsSinceLastAction.ToString("0.0") + " 秒；需要至少 " + MIN_SYNTH_ACTION_INTERVAL_SECONDS + " 秒，已拒绝重复请求。"));
				return "RATE_LIMITED";
			}
			_lastSynthActionTime = Time.unscaledTime;
            MainRecipeSlotButton selectedCorrosion = val.m_mainRecipeToggleBtn != null
                ? CorrosionRecipeSelector.Find(val, val.m_mainRecipeToggleBtn) : null;
            if (selectedCorrosion != null && selectedCorrosion.m_isSelected)
                RuntimeMonitor.BeginCorrosionAction();
            else SynthesisActionMonitor.Begin();
			ClickGameObject(((Component)val.toggleButton_Trigger).gameObject, "确认执行合成");
			AutoApiPlugin.Logger.LogInfo((object)"[腐蚀] 已触发魔方执行按钮。");
			return "SUCCESS";
		}
		return "FAILED";
	}

	private static bool TryFindExcludedInscriptionScroll(UI_Cube cube, out int slotIndex, out int itemKey)
	{
		slotIndex = -1;
		itemKey = 0;
		CubeSlotSetter setter = cube != null ? cube.m_cubeSlotSetter : null;
		Il2CppSystem.Collections.Generic.List<CubeInventorySlot> slots = setter != null ? setter.m_cubeInventorySlots : null;
		if (slots == null) return false;
		for (int i = 0; i < slots.Count; i++)
		{
			CubeInventorySlot slot = slots[i];
			if (slot == null || slot._cubeData == null) continue;
			int key;
			try { key = CubeItemKey(slot._cubeData); }
			catch { continue; }
			if (key > 0 && IsProtectedCorrosionMaterial(slot._cubeData))
			{
				slotIndex = i;
				itemKey = key;
				return true;
			}
		}
		return false;
	}

    private static bool IsProtectedCorrosionMaterial(CubeInData data)
    {
        int itemKey = CubeItemKey(data);
        if (RuntimeMonitor.IsInscriptionScrollItemKey(itemKey)) return true;
        try
        {
            CubeItemData item = (CubeItemData)_pCubeItemData.GetValue(data);
            var caches = wh.vc.bglb;
            if (caches != null && caches.TryGetValue((ulong)item.ItemUniqueId, out var cache)
                && cache != null && cache.bgjt != null)
            {
                EMaterialType subtype = cache.bgjt.bila;
                return subtype == EMaterialType.INSCRIPTION || subtype == EMaterialType.ENGRAVING;
            }
        }
        catch { }
        return false;
    }

    private void EnsureGradeMap()
	{
		//IL_002c: Unknown result type (might be due to invalid IL or missing references)
		//IL_0033: Expected O, but got Unknown
		//IL_00b1: Unknown result type (might be due to invalid IL or missing references)
		//IL_00bb: Expected I4, but got Unknown
		if (_gradeByItemKey != null)
		{
			return;
		}
		System.Collections.Generic.List<ItemInfoData> val = null;
		try
		{
			val = ItemInfoList();
		}
		catch (Exception ex)
		{
			ManualLogSource logger = AutoApiPlugin.Logger;
			bool flag = default(bool);
			BepInExWarningLogInterpolatedStringHandler val2 = new BepInExWarningLogInterpolatedStringHandler(12, 1, out flag);
			if (flag)
			{
				((BepInExLogInterpolatedStringHandler)val2).AppendLiteral("游戏内存数据读取失败: ");
				((BepInExLogInterpolatedStringHandler)val2).AppendFormatted<string>(ex.Message);
			}
			logger.LogWarning(val2);
		}
		if (val == null || val.Count == 0)
		{
			AutoApiPlugin.Logger.LogWarning((object)"[安全锁] 物品品质映射为空，未知物品仍会被拦截。");
			return;
		}
		_gradeByItemKey = new System.Collections.Generic.Dictionary<int, int>();
		for (int i = 0; i < val.Count; i++)
		{
			if (val[i] != null)
			{
				_gradeByItemKey[val[i].ItemKey] = (int)val[i].GRADE;
			}
		}
		AutoApiPlugin.Logger.LogInfo((object)("[安全锁] 已建立 " + _gradeByItemKey.Count + " 个物品品质映射。"));
	}

	private bool SlotsWithinGradeLimit(UI_Cube cube, int limitGrade, out string offender, out int itemCount)
	{
		offender = null;
		itemCount = 0;
		CubeSlotSetter cubeSlotSetter = cube.m_cubeSlotSetter;
		Il2CppSystem.Collections.Generic.List<CubeInventorySlot> val = (((Object)(object)cubeSlotSetter != (Object)null) ? cubeSlotSetter.m_cubeInventorySlots : null);
		if (val == null)
		{
			return true;
		}
		EnsureGradeMap();
		for (int i = 0; i < val.Count; i++)
		{
			CubeInventorySlot val2 = val[i];
			if ((Object)(object)val2 == (Object)null || val2._cubeData == null)
			{
				continue;
			}
			int num = 0;
			try
			{
				num = CubeItemKey(val2._cubeData);
			}
			catch
			{
				continue;
			}
			if (num > 0)
			{
				itemCount++;
				if (_gradeByItemKey == null || !_gradeByItemKey.TryGetValue(num, out var value))
				{
					offender = $"未知物品 (ID: {num})";
					return false;
				}
				if (value > limitGrade)
				{
					offender = $"ID {num} [品质 {value} > 设定上限 {limitGrade}]";
					return false;
				}
			}
		}
		return true;
	}

	private bool ExecuteStoreScan()
	{
		//IL_0186: Unknown result type (might be due to invalid IL or missing references)
		//IL_018d: Expected O, but got Unknown
		//IL_0085: Unknown result type (might be due to invalid IL or missing references)
		//IL_008c: Expected O, but got Unknown
		//IL_0268: Unknown result type (might be due to invalid IL or missing references)
		//IL_026f: Expected O, but got Unknown
		//IL_00fd: Unknown result type (might be due to invalid IL or missing references)
		//IL_0104: Expected O, but got Unknown
		UIManager val = Object.FindObjectOfType<UIManager>(true);
		if ((Object)(object)val == (Object)null || (Object)(object)val.Ui_NewStash == (Object)null || !((Component)val.Ui_NewStash).gameObject.activeInHierarchy)
		{
			AutoApiPlugin.Logger.LogWarning((object)"[深度探仓] 失败：仓库UI未打开！");
			return false;
		}
		Il2CppSystem.Collections.Generic.List<StashSlot> stashSlotList = val.Ui_NewStash.m_stashSlotList;
		if (stashSlotList == null || stashSlotList.Count == 0)
		{
			return false;
		}
		ManualLogSource logger = AutoApiPlugin.Logger;
		bool flag = default(bool);
		BepInExInfoLogInterpolatedStringHandler val2 = new BepInExInfoLogInterpolatedStringHandler(32, 1, out flag);
		if (flag)
		{
			((BepInExLogInterpolatedStringHandler)val2).AppendLiteral("\n====== 开始深度探仓 (当前页总槽位: ");
			((BepInExLogInterpolatedStringHandler)val2).AppendFormatted<int>(stashSlotList.Count);
			((BepInExLogInterpolatedStringHandler)val2).AppendLiteral(") ======");
		}
		logger.LogInfo(val2);
		for (int i = 0; i < Math.Min(3, stashSlotList.Count); i++)
		{
			StashSlot val3 = stashSlotList[i];
			if ((Object)(object)val3 == (Object)null)
			{
				continue;
			}
			System.Type type = ((object)val3).GetType();
			ManualLogSource logger2 = AutoApiPlugin.Logger;
			val2 = new BepInExInfoLogInterpolatedStringHandler(27, 2, out flag);
			if (flag)
			{
				((BepInExLogInterpolatedStringHandler)val2).AppendLiteral("\n>>> 正在剖析 槽位[");
				((BepInExLogInterpolatedStringHandler)val2).AppendFormatted<int>(i);
				((BepInExLogInterpolatedStringHandler)val2).AppendLiteral("] (脚本类型: ");
				((BepInExLogInterpolatedStringHandler)val2).AppendFormatted<string>(type.Name);
				((BepInExLogInterpolatedStringHandler)val2).AppendLiteral(") <<<");
			}
			logger2.LogInfo(val2);
			FieldInfo[] fields = type.GetFields(BindingFlags.DeclaredOnly | BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);
			foreach (FieldInfo fieldInfo in fields)
			{
				try
				{
					object value = fieldInfo.GetValue(val3);
					ManualLogSource logger3 = AutoApiPlugin.Logger;
					val2 = new BepInExInfoLogInterpolatedStringHandler(17, 3, out flag);
					if (flag)
					{
						((BepInExLogInterpolatedStringHandler)val2).AppendLiteral("  [字段] ");
						((BepInExLogInterpolatedStringHandler)val2).AppendFormatted<string>(fieldInfo.Name);
						((BepInExLogInterpolatedStringHandler)val2).AppendLiteral(" (类型: ");
						((BepInExLogInterpolatedStringHandler)val2).AppendFormatted<string>(fieldInfo.FieldType.Name);
						((BepInExLogInterpolatedStringHandler)val2).AppendLiteral(") = ");
						((BepInExLogInterpolatedStringHandler)val2).AppendFormatted<object>(value ?? "null");
					}
					logger3.LogInfo(val2);
				}
				catch
				{
				}
			}
			PropertyInfo[] properties = type.GetProperties(BindingFlags.DeclaredOnly | BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);
			foreach (PropertyInfo propertyInfo in properties)
			{
				try
				{
					if (propertyInfo.CanRead && propertyInfo.GetIndexParameters().Length == 0)
					{
						object value2 = propertyInfo.GetValue(val3, null);
						ManualLogSource logger4 = AutoApiPlugin.Logger;
						val2 = new BepInExInfoLogInterpolatedStringHandler(17, 3, out flag);
						if (flag)
						{
							((BepInExLogInterpolatedStringHandler)val2).AppendLiteral("  [属性] ");
							((BepInExLogInterpolatedStringHandler)val2).AppendFormatted<string>(propertyInfo.Name);
							((BepInExLogInterpolatedStringHandler)val2).AppendLiteral(" (类型: ");
							((BepInExLogInterpolatedStringHandler)val2).AppendFormatted<string>(propertyInfo.PropertyType.Name);
							((BepInExLogInterpolatedStringHandler)val2).AppendLiteral(") = ");
							((BepInExLogInterpolatedStringHandler)val2).AppendFormatted<object>(value2 ?? "null");
						}
						logger4.LogInfo(val2);
					}
				}
				catch
				{
				}
			}
		}
		AutoApiPlugin.Logger.LogInfo((object)"\n================ 探仓结束 ================\n");
		return true;
	}

	private bool ExecuteStoreSort()
	{
		UIManager val = Object.FindObjectOfType<UIManager>(true);
		if ((Object)(object)val != (Object)null && (Object)(object)val.Ui_NewStash != (Object)null && ((Component)val.Ui_NewStash).gameObject.activeInHierarchy)
		{
			Il2CppArrayBase<Button> componentsInChildren = ((Component)val.Ui_NewStash).GetComponentsInChildren<Button>(true);
			foreach (Button item in componentsInChildren)
			{
				string text = ((Object)item).name.ToLower();
				if (text.Contains("sort") || text.Contains("arrange") || text.Contains("clean"))
				{
					ClickGameObject(((Component)item).gameObject, "【整理】当前页面");
					return true;
				}
			}
		}
		return false;
	}

	private bool ExecuteStoreDeposit()
	{
		UIManager val = Object.FindObjectOfType<UIManager>(true);
		if ((Object)(object)val != (Object)null && (Object)(object)val.Ui_NewStash != (Object)null && ((Component)val.Ui_NewStash).gameObject.activeInHierarchy && (Object)(object)val.Ui_NewStash.toggleButton_InventoryToStash != (Object)null)
		{
			ClickGameObject(((Component)val.Ui_NewStash.toggleButton_InventoryToStash).gameObject, "【一键存入】物品");
			return true;
		}
		return false;
	}

	private bool ExecuteStorePage(int pageNum)
	{
		UIManager val = Object.FindObjectOfType<UIManager>(true);
		if ((Object)(object)val != (Object)null && (Object)(object)val.Ui_NewStash != (Object)null && ((Component)val.Ui_NewStash).gameObject.activeInHierarchy)
		{
			Transform val2 = ((Component)val.Ui_NewStash).transform.Find("StashTab");
			int num = pageNum - 1;
			if ((Object)(object)val2 != (Object)null && num >= 0 && num < val2.childCount)
			{
				ClickGameObject(((Component)val2.GetChild(num)).gameObject, $"切换仓库页 -> 第 {pageNum} 页");
				return true;
			}
		}
		return false;
	}

	private bool ExecuteStoreCheckFull()
	{
		//IL_016b: Unknown result type (might be due to invalid IL or missing references)
		//IL_0172: Expected O, but got Unknown
		UIManager val = Object.FindObjectOfType<UIManager>(true);
		if ((Object)(object)val != (Object)null && (Object)(object)val.Ui_NewStash != (Object)null && ((Component)val.Ui_NewStash).gameObject.activeInHierarchy)
		{
			Il2CppSystem.Collections.Generic.List<StashSlot> stashSlotList = val.Ui_NewStash.m_stashSlotList;
			if (stashSlotList == null || stashSlotList.Count == 0)
			{
				return false;
			}
			int num = 0;
			System.Type type = ((object)stashSlotList[0]).GetType();
			PropertyInfo propertyInfo = null;
			PropertyInfo[] properties = type.GetProperties(BindingFlags.DeclaredOnly | BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);
			foreach (PropertyInfo propertyInfo2 in properties)
			{
				System.Type propertyType = propertyInfo2.PropertyType;
				if (propertyType.IsClass && propertyType.Name.Length <= 5 && propertyInfo2.Name.Length <= 5)
				{
					propertyInfo = propertyInfo2;
					break;
				}
			}
			for (int j = 0; j < stashSlotList.Count; j++)
			{
				if (!((Object)(object)stashSlotList[j] != (Object)null))
				{
					continue;
				}
				bool flag = false;
				if (propertyInfo != null)
				{
					try
					{
						object value = propertyInfo.GetValue(stashSlotList[j], null);
						if (value != null)
						{
							flag = true;
						}
					}
					catch
					{
					}
				}
				if (!flag)
				{
					num++;
				}
			}
			ManualLogSource logger = AutoApiPlugin.Logger;
			bool flag2 = default(bool);
			BepInExInfoLogInterpolatedStringHandler val2 = new BepInExInfoLogInterpolatedStringHandler(20, 1, out flag2);
			if (flag2)
			{
				((BepInExLogInterpolatedStringHandler)val2).AppendLiteral("[仓库检测] 扫描完毕，当前剩余空位: ");
				((BepInExLogInterpolatedStringHandler)val2).AppendFormatted<int>(num);
			}
			logger.LogInfo(val2);
			return num == 0;
		}
		return false;
	}

	private bool ExecuteStoreOpen()
	{
		UIManager val = Object.FindObjectOfType<UIManager>(true);
		if ((Object)(object)val != (Object)null && (Object)(object)val.Ui_NewStash != (Object)null)
		{
			if (!((Component)val.Ui_NewStash).gameObject.activeInHierarchy)
			{
				((Component)val.Ui_NewStash).gameObject.SetActive(true);
			}
			return true;
		}
		return false;
	}

	private bool ExecuteStoreClose()
	{
		UIManager val = Object.FindObjectOfType<UIManager>(true);
		if ((Object)(object)val != (Object)null && (Object)(object)val.Ui_NewStash != (Object)null && ((Component)val.Ui_NewStash).gameObject.activeInHierarchy && (Object)(object)val.Ui_NewStash.button_Close != (Object)null)
		{
			ClickGameObject(((Component)val.Ui_NewStash.button_Close).gameObject, "关闭仓库UI");
			return true;
		}
		return false;
	}

	private string ExecuteClickChest(string expectedType)
	{
        if (RuntimeMonitor.IsCorrosionActionPending() || SynthesisActionMonitor.IsPending()) return "ACTION_PENDING";
		bool result = false;
		Il2CppArrayBase<Button> val = Object.FindObjectsOfType<Button>();
		foreach (Button item in val)
		{
			if (!((Object)(object)item != (Object)null) || !((Component)item).gameObject.activeInHierarchy || !(((Object)item).name == "InteractionButton"))
			{
				continue;
			}
			Transform parent = ((Component)item).transform.parent;
			if ((Object)(object)parent != (Object)null && (Object)(object)parent.parent != (Object)null)
			{
				string name = ((Object)parent.parent).name;
				if ((expectedType == "white" && name.Contains("ChestBubbleSlot_Normal") && !name.Contains("Boss")) || (expectedType == "blue" && name.Contains("ChestBubbleSlot_NormalBoss")))
				{
                    string permission = InventoryOperationGate.TryBeginHelperAction();
                    if (permission != "READY") return permission;
					ClickGameObject(((Component)item).gameObject, "拾取宝箱: " + expectedType);
					result = true;
                    break;
				}
			}
		}
		if (result) InventoryOperationGate.MarkUiInventoryChange();
		return result ? "SUCCESS" : "EMPTY";
	}

	private void ClickGameObject(GameObject go, string name)
	{
		//IL_0015: Unknown result type (might be due to invalid IL or missing references)
		//IL_001b: Expected O, but got Unknown
		if ((Object)(object)go == (Object)null)
		{
			return;
		}
		try
		{
			PointerEventData val = new PointerEventData(EventSystem.current);
			bool handled = ExecuteEvents.Execute<IPointerClickHandler>(go, (BaseEventData)(object)val, ExecuteEvents.pointerClickHandler);
			if (!handled)
			{
				Button component = go.GetComponent<Button>();
				if ((Object)(object)component != (Object)null && component.onClick != null)
				{
					((UnityEvent)component.onClick).Invoke();
				}
				else
				{
					Toggle component2 = go.GetComponent<Toggle>();
					if ((Object)(object)component2 != (Object)null)
					{
						component2.isOn = !component2.isOn;
					}
				}
			}
		}
		catch
		{
		}
}

}

internal static class CorrosionRecipeSelector
{
	internal static MainRecipeSlotButton Find(UI_Cube cube, ComboBoxButton combo, string operation = "corrosion")
	{
		MainRecipeSlotButton[] buttons = Object.FindObjectsOfType<MainRecipeSlotButton>(true);
		MainRecipeSlotButton relatedMatch = null;
		MainRecipeSlotButton onlyTextMatch = null;
		int textMatchCount = 0;
		GameObject dropdown = combo.m_comboBoxObject;
		Transform dropdownTransform = ((Object)(object)dropdown != (Object)null) ? dropdown.transform : null;
		Transform cubeTransform = ((Component)cube).transform;
		foreach (MainRecipeSlotButton item in buttons)
		{
            string label = item != null && item.m_text != null ? item.m_text.text ?? "" : "";
            bool matches = operation == "synthesis" ? label.Contains("合成") : label.Contains("腐蚀");
			if ((Object)(object)item == (Object)null || (Object)(object)item.m_text == (Object)null || !matches)
			{
				continue;
			}
			textMatchCount++;
			onlyTextMatch = item;
			MainRecipeComboBoxButton owner = item.bhqw;
			bool sameOwner = (Object)(object)owner != (Object)null && owner.Pointer == combo.Pointer;
			Transform itemTransform = ((Component)item).transform;
			bool inDropdown = dropdownTransform != null && (itemTransform == dropdownTransform || itemTransform.IsChildOf(dropdownTransform));
			bool inCube = itemTransform == cubeTransform || itemTransform.IsChildOf(cubeTransform);
			if (sameOwner || inDropdown || inCube)
			{
				if ((Object)(object)relatedMatch != (Object)null)
				{
					return null;
				}
				relatedMatch = item;
			}
		}
		if ((Object)(object)relatedMatch != (Object)null)
		{
			return relatedMatch;
		}
		return textMatchCount == 1 ? onlyTextMatch : null;
	}
}
