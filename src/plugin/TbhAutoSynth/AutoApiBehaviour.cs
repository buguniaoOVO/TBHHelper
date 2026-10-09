using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Globalization;
using System.Reflection;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using BepInEx.Core.Logging.Interpolation;
using BepInEx.Logging;
using Il2CppInterop.Runtime;
using Il2CppInterop.Runtime.Attributes;
using Il2CppInterop.Runtime.InteropTypes;
using Il2CppInterop.Runtime.InteropTypes.Arrays;
using Il2CppSystem.Collections.Generic;
using TMPro;
using TS;
using TaskbarHero;
using TaskbarHero.Data;
using TaskbarHero.UI;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.InputSystem;
using UnityEngine.UI;

namespace TbhAutoSynth;

public class AutoApiBehaviour(IntPtr ptr) : MonoBehaviour(ptr)
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

		public bool IsComplete
		{
			get
			{
				if (PageTabs > 0 && Pages.Count == PageTabs)
				{
					return Capacity > 0;
				}
				return false;
			}
		}

		public double Percent
		{
			get
			{
				if (Capacity <= 0)
				{
					return -1.0;
				}
				return (double)Used * 100.0 / (double)Capacity;
			}
		}
	}

	private class ApiTask
	{
		public string Command;

		private int _state;

		private readonly DateTime _deadline = DateTime.UtcNow.AddSeconds(24.0);

		public TaskCompletionSource<string> ResultTcs = new TaskCompletionSource<string>();

		public bool TryStart()
		{
			if (DateTime.UtcNow >= _deadline)
			{
				CancelBeforeStart();
				return false;
			}
			return Interlocked.CompareExchange(ref _state, 1, 0) == 0;
		}

		public bool CancelBeforeStart()
		{
			if (Interlocked.CompareExchange(ref _state, 2, 0) != 0)
			{
				return false;
			}
			ResultTcs.TrySetResult("EXPIRED|NOT_EXECUTED");
			return true;
		}
	}

	private const int PREFERRED_API_PORT = 19090;

	private LoopbackApiServer _localApiServer;

	private string _apiDiscoveryPath;

	private ConcurrentQueue<ApiTask> _apiTaskQueue = new ConcurrentQueue<ApiTask>();

	private ApiTask _pendingFillTask;

	private float _pendingFillTime;

	private float _pendingFillStartTime;

	private bool _pendingFillWaitingForStorage;

	private bool _pendingFillWaitingForItems;

	private bool _pendingFillTargetStorage;

	private bool _pendingFillExcludeInscriptionScrolls;

	private bool _pendingFillExcludeOfferingCoins;

	private bool _pendingFillAllowPartial;

	private float _pendingFillCountStableSince;

	private bool _pendingFillCleaningExcluded;

	private bool _pendingWarehouseLockAutoFillRequested;

	private System.Collections.Generic.List<int> _pendingExcludedSlotIndices = new System.Collections.Generic.List<int>();

	private int _pendingExcludedSlotCursor;

	private float _pendingExcludedNextClickTime;

	private float _pendingExcludedSettleTime;

	private int _lastPendingFillCount = -1;

	private ApiTask _pendingSynthTypeTask;

	private int _pendingSynthTypeValue;

	private float _pendingSynthTypeStartTime;

	private float _pendingSynthTypeNextTime;

	private bool _pendingSynthTypeDropdownClickIssued;

	private bool _pendingSynthTypeWaitLogged;

	private ApiTask _pendingLevelTask;

	private float _pendingLevelTime;

	private string _pendingLevelTarget = "";

	private float _pendingLevelStartTime;

	private ApiTask _pendingOpenTask;

	private float _pendingOpenTime;

	private float _pendingOpenStartTime;

	private ApiTask _pendingPlagueRouteTask;

	private UI_Portal _pendingPlaguePortal;

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

	private float _serverValidationNextScan;

	private float _serverValidationLastClick;

	private int _serverValidationAttempts;

	private bool _serverValidationWindowSeen;

	private ApiTask _pendingOperationTask;

	private float _pendingOperationTime;

	private float _pendingOperationStartTime;

	private string _pendingOperationName = "";

	private string _lastOperationWaitLog = "";

	private bool _operationMenuOpenRequested;

	private const float MAX_PENDING_TIMEOUT = 8f;

	private const float MAX_PENDING_FILL_TIMEOUT = 12f;

	private const int REQUIRED_CUBE_ITEMS = 9;

	private float _lastSynthActionTime = -1000f;

	private static bool _obfResolved;

	private static PropertyInfo _pRecipeType;

	private static PropertyInfo _pInnerButton;

	private static PropertyInfo _pIsOn;

	private static PropertyInfo _pCubeItemData;

	private static PropertyInfo _pItemInfoData;

	private static Type _dbType;

	private static string _lastWarehouseMonitorSignature = "";

	private static readonly System.Collections.Generic.Dictionary<int, string> _lastWarehouseRawDiagnostics = new System.Collections.Generic.Dictionary<int, string>();

	private static WarehouseSnapshot _cachedWarehouseSnapshot;

	private static float _nextWarehouseScanTime;

	private const BindingFlags DeclInstance = BindingFlags.DeclaredOnly | BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic;

	private static bool _stashObfResolved;

	private static PropertyInfo _pStashItemKey;

	private System.Collections.Generic.Dictionary<int, int> _gradeByItemKey;

	private string _lastLevelDiagnostic;

	private void Start()
	{
		StartHttpServer();
	}

	private void OnDestroy()
	{
		if (_localApiServer != null)
		{
			_localApiServer.Dispose();
			ApiDiscoveryFile.RemoveOwned(_apiDiscoveryPath, _localApiServer.InstanceId);
			AutoApiPlugin.Logger.LogInfo("[TBH Auto API] 本机接口已关闭。");
		}
	}

	private void StartHttpServer()
	{
		try
		{
			_localApiServer = new LoopbackApiServer(HandleRequest);
			int processId = Environment.ProcessId;
			AutoApiPlugin.BridgeSignature = "|game_pid=" + processId + "|instance_id=" + _localApiServer.InstanceId + "|api_port=" + _localApiServer.Port;
			_apiDiscoveryPath = ApiDiscoveryFile.Publish(processId, _localApiServer.Port, _localApiServer.InstanceId, AutoApiPlugin.RuntimeHash, "1.3.63", 4, Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData));
			AutoApiPlugin.Logger.LogInfo("[TBH Auto API] 监听中: http://127.0.0.1:" + _localApiServer.Port + "/api/；发现文件=" + _apiDiscoveryPath);
		}
		catch (Exception ex)
		{
			_localApiServer?.Dispose();
			AutoApiPlugin.Logger.LogError("本机接口初始化失败：" + ex.Message);
		}
	}

	[HideFromIl2Cpp]
	private LocalApiResponse HandleRequest(string requestPath)
	{
		bool isEnabled = false;
		try
		{
			string text = requestPath.ToLowerInvariant();
			int num = 200;
			ManualLogSource logger = AutoApiPlugin.Logger;
			BepInExInfoLogInterpolatedStringHandler bepInExInfoLogInterpolatedStringHandler = new BepInExInfoLogInterpolatedStringHandler(15, 1, out isEnabled);
			if (isEnabled)
			{
				bepInExInfoLogInterpolatedStringHandler.AppendLiteral("[API 请求接入] 路由: ");
				bepInExInfoLogInterpolatedStringHandler.AppendFormatted(text);
			}
			logger.LogInfo(bepInExInfoLogInterpolatedStringHandler);
			string text2 = "FAILED";
			switch (text)
			{
			case "/api/chest/white":
				text2 = DispatchToMainThreadAndWait("chest_white");
				break;
			case "/api/chest/blue":
				text2 = DispatchToMainThreadAndWait("chest_blue");
				break;
			case "/api/chest/catalog":
				text2 = DispatchToMainThreadAndWait("chest_catalog");
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
			{
				text2 = RuntimeMonitor.SnapshotEvents(out var _);
				break;
			}
			case "/api/events/status":
				text2 = RuntimeMonitor.GetEventCaptureStatus();
				break;
			case "/api/inventory/readiness":
				text2 = (HasPendingCubeUiTask() ? "BUSY|cube_ui_pending=true" : InventoryOperationGate.Readiness());
				break;
			case "/api/events/refresh":
				text2 = DispatchToMainThreadAndWait("events_refresh");
				break;
			default:
				if (text.StartsWith("/api/automation/pacing/"))
				{
					text2 = (int.TryParse(text.Replace("/api/automation/pacing/", ""), out var result) ? InventoryOperationGate.ConfigurePacing(result) : "FAILED");
				}
				else if (text.StartsWith("/api/automation/click_pacing/"))
				{
					text2 = (int.TryParse(text.Replace("/api/automation/click_pacing/", ""), out var result2) ? InventoryOperationGate.ConfigureClickPacing(result2) : "FAILED");
				}
				else if (text.StartsWith("/api/events/ack/"))
				{
					text2 = ((int.TryParse(text.Replace("/api/events/ack/", ""), out var result3) && RuntimeMonitor.AcknowledgeEvents(result3)) ? "SUCCESS" : "FAILED");
				}
				else if (text.StartsWith("/api/chest/open/"))
				{
					text2 = DispatchToMainThreadAndWait("chest_open_" + text.Replace("/api/chest/open/", ""));
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
					if (text3 != null)
					{
						int length = text3.Length;
						if (length <= 5)
						{
							if (length != 4)
							{
								if (length == 5)
								{
									char c2 = text3[2];
									if (c2 != 'e')
									{
										if (c2 == 'o' && text3 == "close")
										{
											text2 = DispatchToMainThreadAndWait("synth_close");
											break;
										}
									}
									else if (text3 == "clear")
									{
										text2 = DispatchToMainThreadAndWait("synth_clear");
										break;
									}
								}
							}
							else if (text3 == "open")
							{
								text2 = DispatchToMainThreadAndWait("synth_open");
								break;
							}
						}
						else if (length != 16)
						{
							if (length == 17)
							{
								char c2 = text3[0];
								if (c2 != 'c')
								{
									if (c2 == 'p' && text3 == "purge_inscription")
									{
										text2 = DispatchToMainThreadAndWait("synth_purge_inscription");
										break;
									}
								}
								else if (text3 == "current_operation")
								{
									text2 = DispatchToMainThreadAndWait("synth_current_operation");
									break;
								}
							}
						}
						else
						{
							char c2 = text3[0];
							if (c2 != 'c')
							{
								if (c2 == 's' && text3 == "synthesis_status")
								{
									text2 = SynthesisActionMonitor.Status();
									break;
								}
							}
							else if (text3 == "corrosion_status")
							{
								text2 = RuntimeMonitor.GetCorrosionActionStatus();
								break;
							}
						}
					}
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
					else if (text3.StartsWith("filtered_autofill/"))
					{
						text2 = DispatchToMainThreadAndWait("synth_filtered_autofill_" + text3.Replace("filtered_autofill/", ""));
					}
					else if (text3.StartsWith("purge_excluded/"))
					{
						text2 = DispatchToMainThreadAndWait("synth_purge_excluded_" + text3.Replace("purge_excluded/", ""));
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
						num = 404;
					}
				}
				else
				{
					num = 404;
				}
				break;
			}
			if (num == 404)
			{
				return new LocalApiResponse(404, "NOT_FOUND");
			}
			int status;
			switch (text2)
			{
			default:
				if (!text2.StartsWith("SUCCESS|", StringComparison.Ordinal) && !text2.StartsWith("BUSY|", StringComparison.Ordinal) && !text2.StartsWith("CORROSION_READY|", StringComparison.Ordinal) && !text2.StartsWith("CORROSION_EMPTY|", StringComparison.Ordinal) && !text2.StartsWith("{\"status\":\"SUCCESS\"", StringComparison.Ordinal) && !text2.StartsWith("E\t", StringComparison.Ordinal))
				{
					status = 400;
					break;
				}
				goto case "SUCCESS";
			case "SUCCESS":
			case "FULL":
			case "HAS_SPACE":
			case "EMPTY":
			case "READY":
				status = 200;
				break;
			}
			return new LocalApiResponse(status, text2);
		}
		catch (Exception ex)
		{
			AutoApiPlugin.Logger.LogWarning("[本机接口] 请求处理失败：" + ex.Message);
			return new LocalApiResponse(500, "FAILED|request_error");
		}
	}

	private string DispatchToMainThreadAndWait(string cmd)
	{
		ApiTask apiTask = new ApiTask
		{
			Command = cmd
		};
		_apiTaskQueue.Enqueue(apiTask);
		int num;
		if (cmd.StartsWith("synth_filtered_autofill_") || cmd.StartsWith("synth_purge_excluded_"))
		{
			num = 240;
		}
		else
		{
			num = ((cmd.StartsWith("synth_autofill_") || cmd == "synth_purge_inscription") ? 55 : 25);
		}
		if (!apiTask.ResultTcs.Task.Wait(TimeSpan.FromSeconds(num)))
		{
			if (!apiTask.CancelBeforeStart())
			{
				return "PENDING|RESULT_UNKNOWN";
			}
			return "EXPIRED|NOT_EXECUTED";
		}
		return apiTask.ResultTcs.Task.Result;
	}

	private void Update()
	{
		RuntimeMonitor.PollCorrosionAnimation();
		SynthesisActionMonitor.Poll();
		RuntimeMonitor.PollGameUi();
		ProcessOfflineRewardPopup();
		ProcessServerItemValidationPopup();
		ProcessPendingPlagueRoute();
		ProcessPendingSynthType();
		try
		{
			Keyboard current = Keyboard.current;
			if (current != null && current.f7Key.wasPressedThisFrame)
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
				AutoApiPlugin.Logger.LogWarning("[API 超时] 魔方打开超时，已自动终止");
			}
			else if (Time.unscaledTime >= _pendingOpenTime)
			{
				string text = "FAILED";
				try
				{
					UIManager uIManager = UnityEngine.Object.FindObjectOfType<UIManager>(includeInactive: true);
					UI_Cube uI_Cube = ((uIManager != null) ? uIManager.Ui_Cube : UnityEngine.Object.FindObjectOfType<UI_Cube>(includeInactive: true));
					if (uI_Cube != null && uI_Cube.gameObject.activeInHierarchy && uI_Cube.m_cubeSlotSetter != null && uI_Cube.m_cubeSlotSetter.m_cubeInventorySlots != null && uI_Cube.m_cubeSlotSetter.m_cubeInventorySlots.Count >= 9 && uI_Cube.m_synthesisItemTypeButton != null && uI_Cube.m_synthesisAutoFillButton != null && uI_Cube.m_synthesisItemTypeButton.m_buttons != null && uI_Cube.m_synthesisItemTypeButton.m_buttons.Count > 0)
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
			if (Time.unscaledTime - _pendingOperationStartTime > 8f)
			{
				_pendingOperationTask.ResultTcs.SetResult("FAILED");
				_pendingOperationTask = null;
				_pendingOperationName = "";
				_lastOperationWaitLog = "";
				_operationMenuOpenRequested = false;
				AutoApiPlugin.Logger.LogWarning("[API 超时] 腐蚀菜单选项渲染超时，已自动终止");
			}
			else if (Time.unscaledTime >= _pendingOperationTime)
			{
				string text2 = "FAILED";
				bool needsSuspend = false;
				try
				{
					if (ExecuteSynthOperation(_pendingOperationName, out needsSuspend))
					{
						text2 = "SUCCESS";
					}
				}
				catch (Exception ex)
				{
					AutoApiPlugin.Logger.LogWarning("[API] 腐蚀菜单选择异常: " + ex.Message);
				}
				if (text2 == "SUCCESS" || !needsSuspend)
				{
					_pendingOperationTask.ResultTcs.SetResult(text2);
					_pendingOperationTask = null;
					_pendingOperationName = "";
					_lastOperationWaitLog = "";
				}
				else
				{
					_pendingOperationTime = Time.unscaledTime + (float)InventoryOperationGate.ClickGapSeconds;
				}
			}
		}
		if (_pendingLevelTask != null)
		{
			if (Time.unscaledTime - _pendingLevelStartTime > 3f)
			{
				_pendingLevelTask.ResultTcs.SetResult("FAILED");
				_pendingLevelTask = null;
				AutoApiPlugin.Logger.LogWarning("[API 超时] 配方等级选择超时，已自动终止");
			}
			else if (Time.unscaledTime >= _pendingLevelTime)
			{
				string text3 = "FAILED";
				bool needsSuspend2 = false;
				try
				{
					if (ExecuteSynthLevel(_pendingLevelTarget, out needsSuspend2))
					{
						text3 = "SUCCESS";
					}
				}
				catch (Exception ex2)
				{
					AutoApiPlugin.Logger.LogWarning("[API] 配方等级选择异常: " + ex2.Message);
				}
				if (text3 == "SUCCESS")
				{
					_pendingLevelTask.ResultTcs.SetResult(text3);
					_pendingLevelTask = null;
				}
				else if (needsSuspend2)
				{
					_pendingLevelTime = Time.unscaledTime + 0.2f;
				}
				else
				{
					_pendingLevelTask.ResultTcs.SetResult(text3);
					_pendingLevelTask = null;
				}
			}
		}
		if (_pendingFillTask != null)
		{
			if (_pendingFillCleaningExcluded)
			{
				ProcessPendingExcludedMaterialCleanup();
			}
			else if (Time.unscaledTime - _pendingFillStartTime > 12f)
			{
				UI_Cube uI_Cube2 = UnityEngine.Object.FindObjectOfType<UI_Cube>(includeInactive: true);
				int num = ((uI_Cube2 != null) ? CountCubeItems(uI_Cube2) : 0);
				if (!_pendingFillWaitingForItems || (!_pendingFillExcludeInscriptionScrolls && !_pendingFillExcludeOfferingCoins) || !QueueExcludedMaterialCleanup(uI_Cube2))
				{
					if (_pendingFillWaitingForItems && num >= 9)
					{
						AutoApiPlugin.Logger.LogInfo("[自动填充] 超时边界检查确认已填满 " + num + "/" + 9 + " 格。");
						CompletePendingFill(_pendingFillAllowPartial ? CubeBatchPolicy.CorrosionFillStatus(num) : "SUCCESS");
					}
					else if (_pendingFillWaitingForItems)
					{
						if (_pendingFillAllowPartial)
						{
							CompletePendingFill(CubeBatchPolicy.CorrosionFillStatus(num));
						}
						else
						{
							AutoApiPlugin.Logger.LogWarning("[自动填充] 当前 " + num + "/" + 9 + " 格；保留已填物品，供腐蚀尝试另一类别。");
							CompletePendingFill("NOT_ENOUGH_" + num.ToString(CultureInfo.InvariantCulture));
						}
					}
					else
					{
						AutoApiPlugin.Logger.LogWarning("[自动填充] 仓库开关未能切换到设定状态；取消本轮腐蚀。");
						CompletePendingFill("FAILED");
					}
				}
			}
			else if (Time.unscaledTime >= _pendingFillTime)
			{
				try
				{
					UI_Cube uI_Cube3 = UnityEngine.Object.FindObjectOfType<UI_Cube>(includeInactive: true);
					if (uI_Cube3 == null || !uI_Cube3.gameObject.activeInHierarchy)
					{
						CompletePendingFill("FAILED");
					}
					else if (_pendingFillWaitingForStorage)
					{
						bool flag = IsOn(uI_Cube3.toggleButton_UseStorage);
						if (flag == _pendingFillTargetStorage)
						{
							AutoApiPlugin.Logger.LogInfo("[自动填充] 已确认包含仓库=" + flag + "，开始填充物品。");
							if (_pendingWarehouseLockAutoFillRequested)
							{
								BeginPendingAutoFillWithWarehouseLocks(uI_Cube3);
							}
							else
							{
								BeginPendingAutoFill(uI_Cube3);
							}
						}
						else
						{
							_pendingFillTime = Time.unscaledTime + 0.1f;
						}
					}
					else if (_pendingFillWaitingForItems)
					{
						int num2 = CountCubeItems(uI_Cube3);
						if (_pendingFillAllowPartial)
						{
							if (num2 != _lastPendingFillCount)
							{
								_lastPendingFillCount = num2;
								_pendingFillCountStableSince = Time.unscaledTime;
							}
							if (Time.unscaledTime - _pendingFillCountStableSince >= 2f)
							{
								if ((!_pendingFillExcludeInscriptionScrolls && !_pendingFillExcludeOfferingCoins) || !QueueExcludedMaterialCleanup(uI_Cube3))
								{
									CompletePendingFill(CubeBatchPolicy.CorrosionFillStatus(num2));
								}
							}
							else
							{
								_pendingFillTime = Time.unscaledTime + 0.5f;
							}
						}
						else if (num2 >= 9)
						{
							if ((!_pendingFillExcludeInscriptionScrolls && !_pendingFillExcludeOfferingCoins) || !QueueExcludedMaterialCleanup(uI_Cube3))
							{
								AutoApiPlugin.Logger.LogInfo("[自动填充] 已填满 " + num2 + "/" + 9 + " 格。");
								CompletePendingFill("SUCCESS");
							}
						}
						else
						{
							if (num2 != _lastPendingFillCount)
							{
								_lastPendingFillCount = num2;
								AutoApiPlugin.Logger.LogInfo("[自动填充] 当前 " + num2 + "/" + 9 + " 格，继续等待。");
							}
							_pendingFillTime = Time.unscaledTime + 0.5f;
						}
					}
				}
				catch (Exception ex3)
				{
					AutoApiPlugin.Logger.LogWarning("[自动填充] 等待异常：" + ex3.Message);
					CompletePendingFill("FAILED");
				}
			}
		}
		if (!_apiTaskQueue.TryDequeue(out var result) || !result.TryStart())
		{
			return;
		}
		if (HasPendingCubeUiTask() && IsMutatingUiCommand(result.Command))
		{
			result.ResultTcs.TrySetResult("ACTION_PENDING");
			return;
		}
		string text4 = "FAILED";
		bool flag2 = false;
		bool isEnabled = false;
		try
		{
			if (result.Command == "chest_white")
			{
				text4 = ExecuteClickChest("white");
			}
			else if (result.Command == "chest_blue")
			{
				text4 = ExecuteClickChest("blue");
			}
			else if (result.Command == "chest_catalog")
			{
				text4 = ReadChestCatalog();
			}
			else if (result.Command.StartsWith("chest_open_"))
			{
				text4 = ExecuteClickChest(result.Command.Substring("chest_open_".Length));
			}
			else if (result.Command == "store_sort")
			{
				string text5 = InventoryOperationGate.TryBeginHelperAction();
				if (text5 == "READY")
				{
					text4 = (ExecuteStoreSort() ? "SUCCESS" : "FAILED");
				}
				else
				{
					text4 = text5;
				}
			}
			else if (result.Command == "store_deposit")
			{
				string text6 = InventoryOperationGate.TryBeginHelperAction();
				if (text6 == "READY")
				{
					text4 = (ExecuteStoreDeposit() ? "SUCCESS" : "FAILED");
				}
				else
				{
					text4 = text6;
				}
				if (text4 == "SUCCESS")
				{
					InventoryOperationGate.MarkUiInventoryChange();
				}
			}
			else if (result.Command == "store_open")
			{
				text4 = (ExecuteStoreOpen() ? "SUCCESS" : "FAILED");
			}
			else if (result.Command == "store_close")
			{
				text4 = (ExecuteStoreClose() ? "SUCCESS" : "FAILED");
			}
			else if (result.Command == "store_check_full")
			{
				text4 = ExecuteStoreCheckFull();
			}
			else if (result.Command == "store_scan")
			{
				text4 = (ExecuteStoreScan() ? "SUCCESS" : "FAILED");
			}
			else if (result.Command == "monitor_status")
			{
				text4 = ExecuteMonitorStatus();
			}
			else if (result.Command == "store_items")
			{
				text4 = ReadWarehouseItems();
			}
			else if (result.Command == "events_refresh")
			{
				text4 = RuntimeMonitor.RefreshNativeGameLogSnapshot();
			}
			else if (result.Command.StartsWith("plague_route_"))
			{
				if (int.TryParse(result.Command.Replace("plague_route_", ""), out var result2))
				{
					text4 = BeginPlagueRoute(result, result2);
					if (_pendingPlagueRouteTask == result)
					{
						flag2 = true;
					}
				}
			}
			else if (result.Command.StartsWith("store_page_"))
			{
				if (int.TryParse(result.Command.Replace("store_page_", ""), out var result3))
				{
					text4 = (ExecuteStorePage(result3) ? "SUCCESS" : "FAILED");
				}
			}
			else if (result.Command == "synth_open")
			{
				text4 = (ExecuteSynthOpen() ? "SUCCESS" : "FAILED");
			}
			else if (result.Command == "synth_current_operation")
			{
				UI_Cube uI_Cube4 = UnityEngine.Object.FindObjectOfType<UI_Cube>(includeInactive: true);
				text4 = "NO_UI";
				if (!(uI_Cube4 != null) || !(uI_Cube4.m_mainRecipeToggleBtn != null))
				{
					return;
				}
				string[] array = new string[2] { "synthesis", "corrosion" };
				foreach (string text7 in array)
				{
					MainRecipeSlotButton mainRecipeSlotButton = CorrosionRecipeSelector.Find(uI_Cube4, uI_Cube4.m_mainRecipeToggleBtn, text7);
					if (mainRecipeSlotButton != null && mainRecipeSlotButton.m_isSelected)
					{
						text4 = "SUCCESS|operation=" + text7;
					}
				}
			}
			else if (result.Command == "synth_close")
			{
				if (RuntimeMonitor.IsCorrosionActionPending() || SynthesisActionMonitor.IsPending())
				{
					text4 = "ACTION_PENDING";
				}
				else
				{
					text4 = (ExecuteSynthClose() ? "SUCCESS" : "FAILED");
				}
			}
			else if (result.Command == "synth_clear")
			{
				if (RuntimeMonitor.IsCorrosionActionPending() || SynthesisActionMonitor.IsPending())
				{
					text4 = "ACTION_PENDING";
				}
				else
				{
					text4 = (ExecuteSynthClear() ? "SUCCESS" : "FAILED");
				}
			}
			else if (result.Command == "synth_purge_inscription")
			{
				UI_Cube uI_Cube5 = UnityEngine.Object.FindObjectOfType<UI_Cube>(includeInactive: true);
				if (uI_Cube5 == null || RuntimeMonitor.IsCorrosionActionPending() || SynthesisActionMonitor.IsPending())
				{
					text4 = "ACTION_PENDING";
					return;
				}
				MainRecipeSlotButton mainRecipeSlotButton2 = ((uI_Cube5.m_mainRecipeToggleBtn != null) ? CorrosionRecipeSelector.Find(uI_Cube5, uI_Cube5.m_mainRecipeToggleBtn) : null);
				if (mainRecipeSlotButton2 == null || !mainRecipeSlotButton2.m_isSelected)
				{
					text4 = "WRONG_OPERATION";
					return;
				}
				_pendingFillTask = result;
				_pendingFillAllowPartial = true;
				_pendingFillExcludeInscriptionScrolls = true;
				_pendingFillExcludeOfferingCoins = false;
				if (QueueExcludedMaterialCleanup(uI_Cube5))
				{
					flag2 = true;
				}
				else
				{
					CompletePendingFill(CubeBatchPolicy.CorrosionFillStatus(CountCubeItems(uI_Cube5)));
				}
				flag2 = true;
			}
			else if (result.Command.StartsWith("synth_purge_excluded_"))
			{
				string[] array2 = result.Command.Replace("synth_purge_excluded_", "").Split('/');
				bool result4 = default;
				bool pendingFillExcludeInscriptionScrolls = (array2.Length != 0 && bool.TryParse(array2[0], out result4)) & result4;
				bool result5 = default;
				bool pendingFillExcludeOfferingCoins = (array2.Length > 1 && bool.TryParse(array2[1], out result5)) & result5;
				UI_Cube uI_Cube6 = UnityEngine.Object.FindObjectOfType<UI_Cube>(includeInactive: true);
				if (uI_Cube6 == null || RuntimeMonitor.IsCorrosionActionPending() || SynthesisActionMonitor.IsPending())
				{
					text4 = "ACTION_PENDING";
					return;
				}
				MainRecipeSlotButton mainRecipeSlotButton3 = ((uI_Cube6.m_mainRecipeToggleBtn != null) ? CorrosionRecipeSelector.Find(uI_Cube6, uI_Cube6.m_mainRecipeToggleBtn) : null);
				if (mainRecipeSlotButton3 == null || !mainRecipeSlotButton3.m_isSelected)
				{
					text4 = "WRONG_OPERATION";
					return;
				}
				_pendingFillTask = result;
				_pendingFillAllowPartial = true;
				_pendingFillExcludeInscriptionScrolls = pendingFillExcludeInscriptionScrolls;
				_pendingFillExcludeOfferingCoins = pendingFillExcludeOfferingCoins;
				if (QueueExcludedMaterialCleanup(uI_Cube6))
				{
					flag2 = true;
				}
				else
				{
					CompletePendingFill(CubeBatchPolicy.CorrosionFillStatus(CountCubeItems(uI_Cube6)));
				}
				flag2 = true;
			}
			else if (result.Command.StartsWith("synth_type_"))
			{
				if (int.TryParse(result.Command.Replace("synth_type_", ""), out var result6))
				{
					_pendingSynthTypeTask = result;
					_pendingSynthTypeValue = result6;
					_pendingSynthTypeStartTime = Time.unscaledTime;
					_pendingSynthTypeNextTime = Time.unscaledTime + 0.1f;
					_pendingSynthTypeDropdownClickIssued = false;
					_pendingSynthTypeWaitLogged = false;
					flag2 = true;
				}
			}
			else if (result.Command.StartsWith("synth_operation_"))
			{
				string text8 = result.Command.Replace("synth_operation_", "");
				_operationMenuOpenRequested = false;
				_lastOperationWaitLog = "";
				bool needsSuspend3 = false;
				text4 = (ExecuteSynthOperation(text8, out needsSuspend3) ? "SUCCESS" : "FAILED");
				if (needsSuspend3)
				{
					_pendingOperationTask = result;
					_pendingOperationName = text8;
					_pendingOperationTime = Time.unscaledTime + (float)InventoryOperationGate.ClickGapSeconds;
					_pendingOperationStartTime = Time.unscaledTime;
					flag2 = true;
				}
			}
			else if (result.Command.StartsWith("synth_execute_"))
			{
				string[] array3 = result.Command.Replace("synth_execute_", "").Split('/');
				if (int.TryParse(array3[0], out var result7))
				{
					bool result8 = default;
					bool excludeInscriptionScrolls = (array3.Length > 1 && bool.TryParse(array3[1], out result8)) & result8;
					bool flag3 = array3.Length > 3;
					bool result9 = default;
					bool excludeOfferingCoins = (flag3 && bool.TryParse(array3[2], out result9)) & result9;
					string expectedOperation = ((array3.Length > (flag3 ? 3 : 2)) ? array3[flag3 ? 3 : 2] : "");
					text4 = ExecuteSynthAction(result7, excludeInscriptionScrolls, excludeOfferingCoins, expectedOperation);
				}
			}
			else if (result.Command.StartsWith("synth_validate_"))
			{
				string[] array4 = result.Command.Replace("synth_validate_", "").Split('/');
				if (int.TryParse(array4[0], out var result10))
				{
					text4 = ExecuteSynthValidation(result10, (array4.Length > 1) ? array4[1] : "synthesis");
				}
			}
			else if (result.Command.StartsWith("synth_level_"))
			{
				string text9 = result.Command.Replace("synth_level_", "");
				text4 = (ExecuteSynthLevel(text9, out var needsSuspend4) ? "SUCCESS" : "FAILED");
				if (needsSuspend4)
				{
					_pendingLevelTask = result;
					_pendingLevelTime = Time.unscaledTime + 0.5f;
					_pendingLevelTarget = text9;
					_pendingLevelStartTime = Time.unscaledTime;
					flag2 = true;
				}
			}
			else if (result.Command.StartsWith("synth_filtered_autofill_"))
			{
				string[] array5 = result.Command.Replace("synth_filtered_autofill_", "").Split('/');
				bool result11 = default;
				bool num3 = (array5.Length != 0 && bool.TryParse(array5[0], out result11)) & result11;
				bool result12 = default;
				bool pendingFillExcludeInscriptionScrolls2 = (array5.Length > 1 && bool.TryParse(array5[1], out result12)) & result12;
				bool result13 = default;
				bool pendingFillExcludeOfferingCoins2 = (array5.Length > 2 && bool.TryParse(array5[2], out result13)) & result13;
				if (!num3 || array5.Length < 4 || !int.TryParse(array5[3], NumberStyles.Integer, CultureInfo.InvariantCulture, out var result14) || result14 < 0 || result14 > 9)
				{
					text4 = "INVALID_FILTERED_FILL_ARGS";
					return;
				}
				UI_Cube uI_Cube7 = UnityEngine.Object.FindObjectOfType<UI_Cube>(includeInactive: true);
				MainRecipeSlotButton mainRecipeSlotButton4 = ((uI_Cube7 != null && uI_Cube7.m_mainRecipeToggleBtn != null) ? CorrosionRecipeSelector.Find(uI_Cube7, uI_Cube7.m_mainRecipeToggleBtn) : null);
				if (uI_Cube7 == null || !uI_Cube7.gameObject.activeInHierarchy)
				{
					text4 = "NO_UI";
					return;
				}
				if (RuntimeMonitor.IsCorrosionActionPending() || SynthesisActionMonitor.IsPending())
				{
					text4 = "ACTION_PENDING";
					return;
				}
				if (mainRecipeSlotButton4 == null || !mainRecipeSlotButton4.m_isSelected)
				{
					text4 = "WRONG_OPERATION";
					return;
				}
				if (uI_Cube7.toggleButton_UseStorage == null || !uI_Cube7.toggleButton_UseStorage.gameObject.activeInHierarchy)
				{
					text4 = "STORAGE_TOGGLE_UNAVAILABLE";
					return;
				}
				_pendingFillTask = result;
				_pendingFillAllowPartial = true;
				_pendingFillTargetStorage = true;
				_pendingFillExcludeInscriptionScrolls = pendingFillExcludeInscriptionScrolls2;
				_pendingFillExcludeOfferingCoins = pendingFillExcludeOfferingCoins2;
				_pendingFillStartTime = Time.unscaledTime;
				_pendingFillWaitingForItems = false;
				_pendingWarehouseLockAutoFillRequested = true;
				if (IsOn(uI_Cube7.toggleButton_UseStorage))
				{
					BeginPendingAutoFillWithWarehouseLocks(uI_Cube7);
				}
				else
				{
					ClickGameObject(uI_Cube7.toggleButton_UseStorage.gameObject, "包含仓库开关 -> true（腐蚀自动填充）");
					_pendingFillWaitingForStorage = true;
					_pendingFillTime = Time.unscaledTime + 0.1f;
				}
				flag2 = true;
			}
			else
			{
				if (!result.Command.StartsWith("synth_autofill_"))
				{
					return;
				}
				string[] array6 = result.Command.Replace("synth_autofill_", "").Split('/');
				bool result15 = default;
				bool flag4 = (array6.Length != 0 && bool.TryParse(array6[0], out result15)) & result15;
				bool result16 = default;
				bool pendingFillExcludeInscriptionScrolls3 = (array6.Length > 1 && bool.TryParse(array6[1], out result16)) & result16;
				bool flag5 = array6.Length > 2 && array6[^1] == "corrosion";
				bool result17 = default;
				bool pendingFillExcludeOfferingCoins3 = (flag5 && array6.Length > 3 && bool.TryParse(array6[2], out result17)) & result17;
				UI_Cube uI_Cube8 = UnityEngine.Object.FindObjectOfType<UI_Cube>(includeInactive: true);
				if (!(uI_Cube8 != null) || !uI_Cube8.gameObject.activeInHierarchy)
				{
					return;
				}
				if (flag5)
				{
					MainRecipeSlotButton mainRecipeSlotButton5 = ((uI_Cube8.m_mainRecipeToggleBtn != null) ? CorrosionRecipeSelector.Find(uI_Cube8, uI_Cube8.m_mainRecipeToggleBtn) : null);
					if (mainRecipeSlotButton5 == null || !mainRecipeSlotButton5.m_isSelected)
					{
						text4 = "WRONG_OPERATION";
						return;
					}
				}
				_pendingFillAllowPartial = flag5;
				if (uI_Cube8.toggleButton_UseStorage != null && uI_Cube8.toggleButton_UseStorage.gameObject.activeInHierarchy)
				{
					bool flag6 = IsOn(uI_Cube8.toggleButton_UseStorage);
					if (flag6 != flag4)
					{
						AutoApiPlugin.Logger.LogInfo("[自动填充] 请求包含仓库=" + flag4 + "（当前=" + flag6 + "）。");
						ClickGameObject(uI_Cube8.toggleButton_UseStorage.gameObject, "包含仓库开关 -> " + flag4);
						_pendingFillTask = result;
						_pendingFillWaitingForStorage = true;
						_pendingFillWaitingForItems = false;
						_pendingFillTargetStorage = flag4;
						_pendingFillExcludeInscriptionScrolls = pendingFillExcludeInscriptionScrolls3;
						_pendingFillExcludeOfferingCoins = pendingFillExcludeOfferingCoins3;
						_pendingFillTime = Time.unscaledTime + 0.1f;
						_pendingFillStartTime = Time.unscaledTime;
						_lastPendingFillCount = -1;
						flag2 = true;
					}
					else
					{
						_pendingFillTask = result;
						_pendingFillWaitingForStorage = false;
						_pendingFillWaitingForItems = true;
						_pendingFillTargetStorage = flag4;
						_pendingFillExcludeInscriptionScrolls = pendingFillExcludeInscriptionScrolls3;
						_pendingFillExcludeOfferingCoins = pendingFillExcludeOfferingCoins3;
						_pendingFillStartTime = Time.unscaledTime;
						_lastPendingFillCount = -1;
						BeginPendingAutoFill(uI_Cube8);
						flag2 = true;
					}
				}
				else
				{
					AutoApiPlugin.Logger.LogWarning("[自动填充] 仓库开关不可用，无法确认物品范围；取消填充。");
					text4 = "FAILED";
				}
			}
		}
		catch (Exception t)
		{
			ManualLogSource logger = AutoApiPlugin.Logger;
			BepInExErrorLogInterpolatedStringHandler bepInExErrorLogInterpolatedStringHandler = new BepInExErrorLogInterpolatedStringHandler(11, 1, out isEnabled);
			if (isEnabled)
			{
				bepInExErrorLogInterpolatedStringHandler.AppendLiteral("API 运行时异常: ");
				bepInExErrorLogInterpolatedStringHandler.AppendFormatted(t);
			}
			logger.LogError(bepInExErrorLogInterpolatedStringHandler);
		}
		finally
		{
			if (!flag2)
			{
				result.ResultTcs.SetResult(text4);
			}
		}
	}

	private void ProcessOfflineRewardPopup()
	{
		if (Time.unscaledTime < _offlineRewardNextScan)
		{
			return;
		}
		_offlineRewardNextScan = Time.unscaledTime + 0.5f;
		try
		{
			UI_OfflineReward uI_OfflineReward = UnityEngine.Object.FindObjectOfType<UI_OfflineReward>(includeInactive: true);
			if (uI_OfflineReward == null || !uI_OfflineReward.gameObject.activeInHierarchy || (uI_OfflineReward.m_parentCanvasGroup != null && uI_OfflineReward.m_parentCanvasGroup.alpha <= 0.01f))
			{
				_offlineRewardPanelInstanceId = 0;
				_offlineRewardCloseAttempts = 0;
				_offlineRewardControlsLogged = false;
				return;
			}
			int instanceID = uI_OfflineReward.GetInstanceID();
			if (_offlineRewardPanelInstanceId != instanceID)
			{
				_offlineRewardPanelInstanceId = instanceID;
				_offlineRewardCloseAttempts = 0;
				_offlineRewardControlsLogged = false;
				_offlineRewardLastCloseAttempt = 0f;
			}
			if (_offlineRewardCloseAttempts >= 12 || (_offlineRewardCloseAttempts > 0 && Time.unscaledTime - _offlineRewardLastCloseAttempt < 1f))
			{
				return;
			}
			Button button = FindOfflineRewardCloseButton(uI_OfflineReward);
			if (button != null && button.onClick != null)
			{
				button.onClick.Invoke();
				_offlineRewardCloseAttempts++;
				_offlineRewardLastCloseAttempt = Time.unscaledTime;
				AutoApiPlugin.Logger.LogInfo("[离线收益/服务器道具验证] 已点击确认按钮：" + button.gameObject.name);
				return;
			}
			NormalButton normalButton = FindOfflineRewardNormalCloseButton(uI_OfflineReward);
			if (normalButton != null && normalButton.bubm != null)
			{
				normalButton.bubm.Invoke();
				_offlineRewardCloseAttempts++;
				_offlineRewardLastCloseAttempt = Time.unscaledTime;
				AutoApiPlugin.Logger.LogInfo("[离线收益/服务器道具验证] 已点击确认控件：" + normalButton.gameObject.name);
			}
			else if (!_offlineRewardControlsLogged)
			{
				_offlineRewardControlsLogged = true;
				AutoApiPlugin.Logger.LogWarning("[离线收益/服务器道具验证] 检测到窗口，但暂未找到确认控件。");
			}
		}
		catch (Exception ex)
		{
			AutoApiPlugin.Logger.LogDebug("[离线收益] 关闭窗口失败：" + ex.Message);
		}
	}

	private static Button FindOfflineRewardCloseButton(UI_OfflineReward panel)
	{
		Il2CppArrayBase<Button> componentsInChildren = panel.GetComponentsInChildren<Button>(includeInactive: true);
		Button button = null;
		float num = float.MaxValue;
		float num2 = 0f;
		float num3 = 0f;
		RectTransform component = panel.GetComponent<RectTransform>();
		if (component != null)
		{
			Vector3[] array = new Vector3[4];
			component.GetWorldCorners(array);
			num2 = (array[0].x + array[2].x) * 0.5f;
			num3 = array[0].y;
		}
		int num4 = 0;
		while (componentsInChildren != null && num4 < componentsInChildren.Length)
		{
			Button button2 = componentsInChildren[num4];
			if (!(button2 == null) && button2.gameObject.activeInHierarchy && button2.interactable)
			{
				string label = (button2.gameObject.name + " " + ReadUiButtonText(button2.gameObject)).ToLowerInvariant();
				if (!IsRewardClaimLabel(label) && IsConfirmationLabel(label))
				{
					return button2;
				}
			}
			num4++;
		}
		int num5 = 0;
		while (componentsInChildren != null && num5 < componentsInChildren.Length)
		{
			Button button3 = componentsInChildren[num5];
			if (!(button3 == null) && button3.gameObject.activeInHierarchy && button3.interactable)
			{
				string label2 = (button3.gameObject.name + " " + ReadUiButtonText(button3.gameObject)).ToLowerInvariant();
				if (!IsRewardClaimLabel(label2) && IsConfirmationLabel(label2))
				{
					return button3;
				}
			}
			num5++;
		}
		int num6 = 0;
		while (componentsInChildren != null && num6 < componentsInChildren.Length)
		{
			Button button4 = componentsInChildren[num6];
			if (!(button4 == null) && button4.gameObject.activeInHierarchy && button4.interactable)
			{
				string text = (button4.gameObject.name + " " + ReadUiButtonText(button4.gameObject)).ToLowerInvariant();
				if (!IsRewardClaimLabel(text))
				{
					if (text.Contains("close") || text.Contains("exit") || text.Contains("cancel") || text == "x" || text.EndsWith("_x", StringComparison.Ordinal))
					{
						return button4;
					}
					Vector3 position = button4.transform.position;
					float num7 = num2 - position.x;
					float num8 = num3 - position.y;
					float num9 = num7 * num7 + num8 * num8;
					if (button == null || num9 < num)
					{
						button = button4;
						num = num9;
					}
				}
			}
			num6++;
		}
		return button;
	}

	private static NormalButton FindOfflineRewardNormalCloseButton(UI_OfflineReward panel)
	{
		Il2CppArrayBase<NormalButton> componentsInChildren = panel.GetComponentsInChildren<NormalButton>(includeInactive: true);
		NormalButton normalButton = null;
		float num = float.MaxValue;
		float num2 = 0f;
		float num3 = 0f;
		RectTransform component = panel.GetComponent<RectTransform>();
		if (component != null)
		{
			Vector3[] array = new Vector3[4];
			component.GetWorldCorners(array);
			num2 = (array[0].x + array[2].x) * 0.5f;
			num3 = array[0].y;
		}
		int num4 = 0;
		while (componentsInChildren != null && num4 < componentsInChildren.Length)
		{
			NormalButton normalButton2 = componentsInChildren[num4];
			if (!(normalButton2 == null) && normalButton2.bubm != null && normalButton2.gameObject.activeInHierarchy)
			{
				string text = (normalButton2.gameObject.name + " " + ReadUiButtonText(normalButton2.gameObject)).ToLowerInvariant();
				if (!IsRewardClaimLabel(text))
				{
					if (IsConfirmationLabel(text))
					{
						return normalButton2;
					}
					if (text.Contains("close") || text.Contains("exit") || text.Contains("cancel") || text == "x" || text.EndsWith("_x", StringComparison.Ordinal))
					{
						return normalButton2;
					}
					Vector3 position = normalButton2.transform.position;
					float num5 = num2 - position.x;
					float num6 = num3 - position.y;
					float num7 = num5 * num5 + num6 * num6;
					if (normalButton == null || num7 < num)
					{
						normalButton = normalButton2;
						num = num7;
					}
				}
			}
			num4++;
		}
		return normalButton;
	}

	private static string ReadUiButtonText(GameObject buttonObject)
	{
		if (buttonObject == null)
		{
			return "";
		}
		StringBuilder stringBuilder = new StringBuilder();
		try
		{
			Il2CppArrayBase<TMP_Text> componentsInChildren = buttonObject.GetComponentsInChildren<TMP_Text>(includeInactive: true);
			int num = 0;
			while (componentsInChildren != null && num < componentsInChildren.Length)
			{
				if (componentsInChildren[num] != null && !string.IsNullOrWhiteSpace(componentsInChildren[num].text))
				{
					stringBuilder.Append(' ').Append(componentsInChildren[num].text);
				}
				num++;
			}
		}
		catch
		{
		}
		try
		{
			Il2CppArrayBase<Text> componentsInChildren2 = buttonObject.GetComponentsInChildren<Text>(includeInactive: true);
			int num2 = 0;
			while (componentsInChildren2 != null && num2 < componentsInChildren2.Length)
			{
				if (componentsInChildren2[num2] != null && !string.IsNullOrWhiteSpace(componentsInChildren2[num2].text))
				{
					stringBuilder.Append(' ').Append(componentsInChildren2[num2].text);
				}
				num2++;
			}
		}
		catch
		{
		}
		return stringBuilder.ToString();
	}

	private void ProcessServerItemValidationPopup()
	{
		if (Time.unscaledTime < _serverValidationNextScan)
		{
			return;
		}
		_serverValidationNextScan = Time.unscaledTime + 0.5f;
		if (_offlineRewardPanelInstanceId != 0)
		{
			return;
		}
		try
		{
			Il2CppArrayBase<TMP_Text> il2CppArrayBase = UnityEngine.Object.FindObjectsOfType<TMP_Text>(includeInactive: true);
			TMP_Text tMP_Text = null;
			int num = 0;
			while (il2CppArrayBase != null && num < il2CppArrayBase.Length)
			{
				TMP_Text tMP_Text2 = il2CppArrayBase[num];
				if (!(tMP_Text2 == null) && tMP_Text2.gameObject.activeInHierarchy)
				{
					string text = tMP_Text2.text ?? "";
					if (text.Contains("服务器道具验证结果") || text.Contains("已从服务器恢复物品") || text.IndexOf("server item verification result", StringComparison.OrdinalIgnoreCase) >= 0 || text.IndexOf("items restored from the server", StringComparison.OrdinalIgnoreCase) >= 0)
					{
						tMP_Text = tMP_Text2;
						break;
					}
				}
				num++;
			}
			if (tMP_Text == null)
			{
				_serverValidationAttempts = 0;
				_serverValidationWindowSeen = false;
			}
			else
			{
				if (_serverValidationAttempts >= 12 || (_serverValidationAttempts > 0 && Time.unscaledTime - _serverValidationLastClick < 1f))
				{
					return;
				}
				Transform parent = ((Component)tMP_Text).transform;
				int num2 = 0;
				while (parent != null && num2 < 10)
				{
					GameObject root = parent.gameObject;
					Button button = FindExplicitConfirmButton(root);
					if (button != null && button.onClick != null)
					{
						button.onClick.Invoke();
						_serverValidationAttempts++;
						_serverValidationLastClick = Time.unscaledTime;
						_serverValidationWindowSeen = true;
						AutoApiPlugin.Logger.LogInfo("[服务器道具验证] 检测到恢复物品窗口，已点击确认按钮：" + button.gameObject.name);
						return;
					}
					NormalButton normalButton = FindExplicitConfirmNormalButton(root);
					if (normalButton != null && normalButton.bubm != null)
					{
						normalButton.bubm.Invoke();
						_serverValidationAttempts++;
						_serverValidationLastClick = Time.unscaledTime;
						_serverValidationWindowSeen = true;
						AutoApiPlugin.Logger.LogInfo("[服务器道具验证] 检测到恢复物品窗口，已点击确认控件：" + normalButton.gameObject.name);
						return;
					}
					num2++;
					parent = parent.parent;
				}
				if (!_serverValidationWindowSeen)
				{
					_serverValidationWindowSeen = true;
					AutoApiPlugin.Logger.LogWarning("[服务器道具验证] 检测到恢复物品窗口，但未找到文字为“确认”的按钮。");
				}
			}
		}
		catch (Exception ex)
		{
			AutoApiPlugin.Logger.LogDebug("[服务器道具验证] 自动确认失败：" + ex.Message);
		}
	}

	private static Button FindExplicitConfirmButton(GameObject root)
	{
		if (root == null)
		{
			return null;
		}
		Il2CppArrayBase<Button> componentsInChildren = root.GetComponentsInChildren<Button>(includeInactive: true);
		int num = 0;
		while (componentsInChildren != null && num < componentsInChildren.Length)
		{
			Button button = componentsInChildren[num];
			if (!(button == null) && button.interactable && button.gameObject.activeInHierarchy)
			{
				string label = (button.gameObject.name + " " + ReadUiButtonText(button.gameObject)).ToLowerInvariant();
				if (!IsRewardClaimLabel(label) && IsConfirmationLabel(label))
				{
					return button;
				}
			}
			num++;
		}
		return null;
	}

	private static NormalButton FindExplicitConfirmNormalButton(GameObject root)
	{
		if (root == null)
		{
			return null;
		}
		Il2CppArrayBase<NormalButton> componentsInChildren = root.GetComponentsInChildren<NormalButton>(includeInactive: true);
		int num = 0;
		while (componentsInChildren != null && num < componentsInChildren.Length)
		{
			NormalButton normalButton = componentsInChildren[num];
			if (!(normalButton == null) && normalButton.bubm != null && normalButton.gameObject.activeInHierarchy)
			{
				string label = (normalButton.gameObject.name + " " + ReadUiButtonText(normalButton.gameObject)).ToLowerInvariant();
				if (!IsRewardClaimLabel(label) && IsConfirmationLabel(label))
				{
					return normalButton;
				}
			}
			num++;
		}
		return null;
	}

	private static bool IsConfirmationLabel(string label)
	{
		if (!label.Contains("确认") && !label.Contains("確定") && !label.Contains("确定") && !label.Contains("confirm") && !label.Contains("confirmbutton") && !(label.Trim() == "ok") && !label.Contains("继续"))
		{
			return label.Contains("continue");
		}
		return true;
	}

	private static bool IsRewardClaimLabel(string label)
	{
		if (!label.Contains("claim") && !label.Contains("reward") && !label.Contains("receive") && !label.Contains("collect") && !label.Contains("领取") && !label.Contains("收取") && !label.Contains("恢复"))
		{
			return label.Contains("邮箱");
		}
		return true;
	}

	private static void ResolveStashInterop(object sampleItem)
	{
		if (_stashObfResolved || sampleItem == null)
		{
			return;
		}
		Type type = sampleItem.GetType();
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

	private static PropertyInfo OnlyProp(Type declaring, Type propType, bool readOnly)
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

	private static Type FindDbType()
	{
		Type[] types;
		try
		{
			types = typeof(UI_Cube).Assembly.GetTypes();
		}
		catch (ReflectionTypeLoadException ex)
		{
			types = ex.Types;
		}
		Type[] array = types;
		foreach (Type type in array)
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
			AutoApiPlugin.Logger.LogInfo(">>> [底层内存引擎] IL2CPP 混淆特征解析完成，游戏内存数据库映射成功！");
		}
	}

	private static ERecipeType RecipeTypeOf(SubRecipeComboBoxButton c)
	{
		ResolveInterop();
		return (ERecipeType)_pRecipeType.GetValue(c);
	}

	private static Button InnerButton(ButtonBase b)
	{
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
		ResolveInterop();
		return ((CubeItemData)_pCubeItemData.GetValue(data)).ItemKey;
	}

	internal static System.Collections.Generic.List<ItemInfoData> ItemInfoList()
	{
		ResolveInterop();
		if (_dbType == null || _pItemInfoData == null)
		{
			return null;
		}
		Il2CppReferenceArray<UnityEngine.Object> il2CppReferenceArray = Resources.FindObjectsOfTypeAll(Il2CppType.From(_dbType));
		if (il2CppReferenceArray == null || ((Il2CppArrayBase<UnityEngine.Object>)il2CppReferenceArray).Length == 0)
		{
			AutoApiPlugin.Logger.LogWarning("[安全锁] 未找到物品数据库对象：" + _dbType.FullName);
			return null;
		}
		System.Collections.Generic.List<ItemInfoData> list = new System.Collections.Generic.List<ItemInfoData>();
		for (int i = 0; i < ((Il2CppArrayBase<UnityEngine.Object>)il2CppReferenceArray).Length; i++)
		{
			try
			{
				UnityEngine.Object obj = ((Il2CppArrayBase<UnityEngine.Object>)il2CppReferenceArray)[i];
				if (obj == null)
				{
					continue;
				}
				object obj2 = Activator.CreateInstance(_dbType, obj.Pointer);
				object value = _pItemInfoData.GetValue(obj2, null);
				if (value is Il2CppSystem.Collections.Generic.List<ItemInfoData> list2)
				{
					for (int j = 0; j < list2.Count; j++)
					{
						ItemInfoData itemInfoData = list2[j];
						if (itemInfoData != null)
						{
							list.Add(itemInfoData);
						}
					}
				}
				else if (value is System.Collections.Generic.List<ItemInfoData> collection)
				{
					list.AddRange(collection);
				}
			}
			catch (Exception ex)
			{
				AutoApiPlugin.Logger.LogWarning("[安全锁] 读取物品品质表失败：" + ex.Message);
			}
		}
		AutoApiPlugin.Logger.LogInfo("[安全锁] 从 " + ((Il2CppArrayBase<UnityEngine.Object>)il2CppReferenceArray).Length + " 个数据库对象读取到 " + list.Count + " 条物品品质数据。");
		if (list.Count != 0)
		{
			return list;
		}
		return null;
	}

	private bool ExecuteSynthOpen()
	{
		UIManager uIManager = UnityEngine.Object.FindObjectOfType<UIManager>(includeInactive: true);
		UI_Cube uI_Cube = ((uIManager != null) ? uIManager.Ui_Cube : UnityEngine.Object.FindObjectOfType<UI_Cube>(includeInactive: true));
		if (uI_Cube == null)
		{
			return false;
		}
		if (!uI_Cube.gameObject.activeInHierarchy)
		{
			if (uIManager == null)
			{
				AutoApiPlugin.Logger.LogWarning("[腐蚀] UIManager 不可用；拒绝直接强制显示未初始化的魔方界面。");
				return false;
			}
			AutoApiPlugin.Logger.LogInfo("[腐蚀] 通过 UIManager 正常打开魔方，等待游戏初始化其内部状态。");
			uIManager.hor(uI_Cube);
		}
		return true;
	}

	private bool ExecuteSynthClose()
	{
		UIManager uIManager = UnityEngine.Object.FindObjectOfType<UIManager>(includeInactive: true);
		UI_Cube uI_Cube = ((uIManager != null) ? uIManager.Ui_Cube : UnityEngine.Object.FindObjectOfType<UI_Cube>(includeInactive: true));
		if (uI_Cube != null && uI_Cube.gameObject.activeInHierarchy)
		{
			if (uIManager != null)
			{
				uIManager.hos(uI_Cube);
			}
			if (uI_Cube.gameObject.activeInHierarchy)
			{
				uI_Cube.gameObject.SetActive(value: false);
			}
			return true;
		}
		return false;
	}

	private string ExecuteMonitorStatus()
	{
		PollutionReading pollution = RuntimeMonitor.GetPollution();
		WarehouseSnapshot warehouseSnapshot = ScanWarehousePages();
		string text = ((pollution.IsKnown && warehouseSnapshot.IsComplete) ? "SUCCESS" : "UNKNOWN");
		string text2 = (pollution.IsKnown ? pollution.Value.ToString() : "?");
		string text3 = ((warehouseSnapshot.Percent >= 0.0) ? warehouseSnapshot.Percent.ToString("0.0", CultureInfo.InvariantCulture) : "?");
		StringBuilder stringBuilder = new StringBuilder();
		for (int i = 0; i < warehouseSnapshot.Pages.Count; i++)
		{
			if (i > 0)
			{
				stringBuilder.Append(',');
			}
			WarehousePageSnapshot warehousePageSnapshot = warehouseSnapshot.Pages[i];
			stringBuilder.Append(warehousePageSnapshot.PageNumber).Append(':').Append(warehousePageSnapshot.Used)
				.Append('/')
				.Append(warehousePageSnapshot.Capacity);
		}
		return text + "|pollution=" + text2 + "|pollution_entry_min=" + ((pollution.EntryMinimum > 0) ? pollution.EntryMinimum.ToString(CultureInfo.InvariantCulture) : "?") + "|pollution_source=" + (pollution.Source ?? "unknown") + "|pollution_at=" + pollution.UpdatedAt + "|pollution_age_sec=" + (pollution.IsKnown ? Math.Max(0.0, (DateTime.UtcNow - pollution.ObservedAtUtc).TotalSeconds).ToString("0", CultureInfo.InvariantCulture) : "?") + "|warehouse_percent=" + text3 + "|warehouse_used=" + warehouseSnapshot.Used + "|warehouse_capacity=" + warehouseSnapshot.Capacity + "|pages_scanned=" + warehouseSnapshot.Pages.Count + "|page_tabs=" + warehouseSnapshot.PageTabs + "|warehouse_pages=" + warehouseSnapshot.OwnedPages + "|tab_entries=" + warehouseSnapshot.TabEntries + "|page_keys=" + warehouseSnapshot.PageKeys + "|pages=" + stringBuilder;
	}

	private string BeginPlagueRoute(ApiTask task, int targetLevel)
	{
		if (targetLevel < 1 || targetLevel > 20)
		{
			return "INVALID_LEVEL";
		}
		try
		{
			UI_Portal pendingPlaguePortal = UnityEngine.Object.FindObjectOfType<UI_Portal>(includeInactive: true);
			_pendingPlagueRouteTask = task;
			_pendingPlaguePortal = pendingPlaguePortal;
			_pendingPlagueLevel = targetLevel;
			_pendingPlaguePhase = 0;
			_pendingPlagueDiagnosticLogged = false;
			_pendingPlagueLevelDiagnosticLogged = false;
			_pendingPlaguePortalClickIssued = false;
			_pendingPlagueTabClickIssued = false;
			_pendingPlagueStartTime = Time.unscaledTime;
			_pendingPlagueNextTime = Time.unscaledTime + 0.25f;
			AutoApiPlugin.Logger.LogInfo("[瘟疫之地] 将按游戏界面点击传送门并选择强度 " + targetLevel + "。");
			return "PENDING";
		}
		catch (Exception ex)
		{
			AutoApiPlugin.Logger.LogWarning("[瘟疫之地] 自动选择异常：" + ex.Message);
			return "FAILED";
		}
	}

	private void ProcessPendingPlagueRoute()
	{
		if (_pendingPlagueRouteTask == null || Time.unscaledTime < _pendingPlagueNextTime)
		{
			return;
		}
		if (Time.unscaledTime - _pendingPlagueStartTime > 20f)
		{
			AutoApiPlugin.Logger.LogWarning("[瘟疫之地] 路由等待超时：阶段=" + _pendingPlaguePhase + "，页签点击=" + _pendingPlagueTabClickIssued + "，门户=" + (_pendingPlaguePortal != null && _pendingPlaguePortal.gameObject.activeInHierarchy));
			CompletePendingPlagueRoute("PLAGUE_UI_TIMEOUT");
			return;
		}
		try
		{
			UI_Portal uI_Portal = _pendingPlaguePortal;
			if (uI_Portal == null)
			{
				uI_Portal = (_pendingPlaguePortal = UnityEngine.Object.FindObjectOfType<UI_Portal>(includeInactive: true));
			}
			if (uI_Portal == null)
			{
				if (!_pendingPlaguePortalClickIssued)
				{
					UI_Main uI_Main = UnityEngine.Object.FindObjectOfType<UI_Main>(includeInactive: true);
					if (uI_Main == null || uI_Main.button_Portal == null || uI_Main.button_Portal.toggleButton == null || uI_Main.button_Portal.toggleButton.bubm == null)
					{
						CompletePendingPlagueRoute("PORTAL_BUTTON_UNAVAILABLE");
						return;
					}
					uI_Main.button_Portal.toggleButton.bubm.Invoke();
					_pendingPlaguePortalClickIssued = true;
					AutoApiPlugin.Logger.LogInfo("[瘟疫之地] 已模拟点击游戏内蓝色传送门图标。");
				}
				_pendingPlagueNextTime = Time.unscaledTime + 0.35f;
				return;
			}
			if (!uI_Portal.gameObject.activeInHierarchy)
			{
				if (!_pendingPlaguePortalClickIssued)
				{
					UI_Main uI_Main2 = UnityEngine.Object.FindObjectOfType<UI_Main>(includeInactive: true);
					if (uI_Main2 == null || uI_Main2.button_Portal == null || uI_Main2.button_Portal.toggleButton == null || uI_Main2.button_Portal.toggleButton.bubm == null)
					{
						CompletePendingPlagueRoute("PORTAL_BUTTON_UNAVAILABLE");
						return;
					}
					uI_Main2.button_Portal.toggleButton.bubm.Invoke();
					_pendingPlaguePortalClickIssued = true;
					AutoApiPlugin.Logger.LogInfo("[瘟疫之地] 已模拟点击游戏内蓝色传送门图标。");
				}
				_pendingPlagueNextTime = Time.unscaledTime + 0.35f;
				return;
			}
			UI_Plaguelands plaguelandsUI = uI_Portal.plaguelandsUI;
			Slider slider = FindPlagueSlider(uI_Portal, plaguelandsUI);
			if (slider == null)
			{
				if (!_pendingPlagueDiagnosticLogged)
				{
					_pendingPlagueDiagnosticLogged = true;
					AutoApiPlugin.Logger.LogWarning("[瘟疫之地] 等待强度控件：UI_Plaguelands=" + (plaguelandsUI != null) + "，地图面板=" + (uI_Portal.plaguelandsElements != null && uI_Portal.plaguelandsElements.activeInHierarchy));
				}
				_pendingPlagueNextTime = Time.unscaledTime + 0.2f;
				return;
			}
			if (_pendingPlaguePhase == 0)
			{
				if (!IsPlaguePageVisible(uI_Portal, plaguelandsUI, slider))
				{
					if (!_pendingPlagueTabClickIssued)
					{
						ActSlot actSlot = null;
						if (uI_Portal.bibm != null)
						{
							foreach (ActSlot value2 in uI_Portal.bibm.Values)
							{
								string text = ((value2 != null && value2.text_ActName != null) ? value2.text_ActName.text : "");
								if (text.Contains("瘟疫之地") || text.Contains("Plague"))
								{
									actSlot = value2;
									break;
								}
							}
						}
						if (actSlot == null)
						{
							_pendingPlagueNextTime = Time.unscaledTime + 0.25f;
							return;
						}
						if (actSlot.btn != null && actSlot.btn.onClick != null)
						{
							actSlot.btn.onClick.Invoke();
						}
						else
						{
							if (!(actSlot.button_toggle != null) || actSlot.button_toggle.bubm == null)
							{
								CompletePendingPlagueRoute("PLAGUE_TAB_BUTTON_UNAVAILABLE");
								return;
							}
							actSlot.button_toggle.bubm.Invoke();
						}
						_pendingPlagueTabClickIssued = true;
						AutoApiPlugin.Logger.LogInfo("[瘟疫之地] 已模拟点击第三章右侧的“瘟疫之地”页签。");
					}
					_pendingPlagueNextTime = Time.unscaledTime + 0.35f;
				}
				else
				{
					_pendingPlaguePhase = 1;
					_pendingPlagueNextTime = Time.unscaledTime + 0.2f;
					AutoApiPlugin.Logger.LogInfo("[瘟疫之地] 已确认瘟疫地图面板可见，开始调整难度。");
				}
				return;
			}
			if (_pendingPlaguePhase == 1)
			{
				int num = ReadPlagueLevel(uI_Portal, plaguelandsUI, slider);
				if (!_pendingPlagueLevelDiagnosticLogged)
				{
					_pendingPlagueLevelDiagnosticLogged = true;
					AutoApiPlugin.Logger.LogInfo("[瘟疫之地] 当前显示强度=" + num + "，Slider.value=" + slider.value + "，目标=" + _pendingPlagueLevel);
				}
				if (num < 1 || num > 20)
				{
					CompletePendingPlagueRoute("PLAGUE_LEVEL_OUT_OF_RANGE:" + num);
					return;
				}
				if (num == _pendingPlagueLevel)
				{
					_pendingPlaguePhase = 2;
					_pendingPlagueNextTime = Time.unscaledTime + 0.4f;
					AutoApiPlugin.Logger.LogInfo("[瘟疫之地] 界面强度已到第 " + num + " 级，准备点击绿色地图节点。");
					return;
				}
				bool flag = num < _pendingPlagueLevel;
				NormalButton normalButton = FindPlagueArrow(uI_Portal, plaguelandsUI, slider, flag);
				if (normalButton == null || normalButton.bubm == null)
				{
					CompletePendingPlagueRoute("PLAGUE_DIFFICULTY_BUTTON_UNAVAILABLE");
					return;
				}
				normalButton.bubm.Invoke();
				AutoApiPlugin.Logger.LogInfo("[瘟疫之地] 点击强度" + (flag ? "右" : "左") + "箭头；当前=" + num + "，目标=" + _pendingPlagueLevel + "，控件=" + normalButton.gameObject.name);
				_pendingPlagueNextTime = Time.unscaledTime + 0.3f;
				return;
			}
			if (_pendingPlaguePhase == 2 && ReadPlagueLevel(uI_Portal, plaguelandsUI, slider) != _pendingPlagueLevel)
			{
				_pendingPlaguePhase = 1;
				_pendingPlagueNextTime = Time.unscaledTime + 0.2f;
				return;
			}
			if (_pendingPlaguePhase == 3)
			{
				string gameStatus = RuntimeMonitor.GetGameStatus();
				string value = "|plague_level=" + _pendingPlagueLevel.ToString(CultureInfo.InvariantCulture) + "|";
				if (gameStatus.Contains("|is_plague=true|") && gameStatus.Contains(value))
				{
					if (CloseConfirmedPlaguePortal(uI_Portal))
					{
						CompletePendingPlagueRoute("SUCCESS");
					}
					else
					{
						CompletePendingPlagueRoute("PORTAL_CLOSE_BUTTON_UNAVAILABLE");
					}
				}
				else
				{
					_pendingPlagueNextTime = Time.unscaledTime + 0.35f;
				}
				return;
			}
			StageNode stageNode = ((plaguelandsUI != null) ? plaguelandsUI.biba : null);
			if (stageNode == null || stageNode.button_Enter == null)
			{
				stageNode = FindPlagueTarget(uI_Portal);
			}
			if (stageNode == null || stageNode.button_Enter == null)
			{
				if (!_pendingPlagueDiagnosticLogged)
				{
					_pendingPlagueDiagnosticLogged = true;
					AutoApiPlugin.Logger.LogWarning("[瘟疫之地] 目标节点尚未生成：滑块=" + slider.value + "，StageNode=" + (stageNode != null) + "，进入按钮=" + (stageNode != null && stageNode.button_Enter != null));
				}
				_pendingPlagueNextTime = Time.unscaledTime + 0.2f;
				return;
			}
			if (plaguelandsUI != null)
			{
				plaguelandsUI.myb(stageNode, uI_Portal.m_currentStageDifficulty);
			}
			if (stageNode.m_occupiedIcon != null && stageNode.m_occupiedIcon.activeInHierarchy)
			{
				AutoApiPlugin.Logger.LogInfo("[瘟疫之地] 已确认第 " + _pendingPlagueLevel + " 级节点旗标为当前地图。");
				CompletePendingPlagueRoute(CloseConfirmedPlaguePortal(uI_Portal) ? "SUCCESS" : "PORTAL_CLOSE_BUTTON_UNAVAILABLE");
				return;
			}
			if (!stageNode.button_Enter.interactable)
			{
				AutoApiPlugin.Logger.LogWarning("[瘟疫之地] 游戏绿色地图节点当前不可点击，强度=" + _pendingPlagueLevel);
				CompletePendingPlagueRoute("STAGE_LOCKED");
				return;
			}
			stageNode.button_Enter.onClick.Invoke();
			AutoApiPlugin.Logger.LogInfo("[瘟疫之地] 已通过强度滑块选择并请求进入第 " + _pendingPlagueLevel + " 级。");
			_pendingPlaguePhase = 3;
			_pendingPlagueNextTime = Time.unscaledTime + 0.35f;
		}
		catch (Exception ex)
		{
			AutoApiPlugin.Logger.LogWarning("[瘟疫之地] 等待地图控件时异常：" + ex.Message);
			CompletePendingPlagueRoute("FAILED");
		}
	}

	private static bool CloseConfirmedPlaguePortal(UI_Portal portal)
	{
		if (portal == null || !portal.gameObject.activeInHierarchy)
		{
			return true;
		}
		if (portal.button_Close == null || portal.button_Close.onClick == null)
		{
			AutoApiPlugin.Logger.LogWarning("[瘟疫之地] 地图已确认，但传送门右上角关闭按钮不可用。");
			return false;
		}
		portal.button_Close.onClick.Invoke();
		AutoApiPlugin.Logger.LogInfo("[瘟疫之地] 已确认当前地图等级，模拟点击传送门右上角 X 关闭窗口。");
		return true;
	}

	private static bool IsPlaguePageVisible(UI_Portal portal, UI_Plaguelands plagueUi, Slider plagueSlider)
	{
		try
		{
			if (portal != null)
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
			if (plagueUi != null)
			{
				if (plagueUi.gameObject.activeInHierarchy)
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
			AutoApiPlugin.Logger?.LogDebug("[瘟疫之地] 检查页签可见状态失败：" + ex.Message);
		}
		return false;
	}

	private static Slider FindPlagueSlider(UI_Portal portal, UI_Plaguelands plagueUi)
	{
		if (plagueUi != null && plagueUi.slider != null)
		{
			return plagueUi.slider;
		}
		if (portal != null && portal.plaguelandsElements != null)
		{
			Il2CppArrayBase<Slider> componentsInChildren = portal.plaguelandsElements.GetComponentsInChildren<Slider>(includeInactive: true);
			TMP_Text tMP_Text = FindPlagueLevelText(portal, plagueUi, null);
			if (componentsInChildren != null && componentsInChildren.Length > 0)
			{
				if (tMP_Text == null)
				{
					return componentsInChildren[0];
				}
				Slider result = null;
				float num = float.MaxValue;
				for (int i = 0; i < componentsInChildren.Length; i++)
				{
					Slider slider = componentsInChildren[i];
					if (!(slider == null))
					{
						float num2 = Vector3.Distance(slider.transform.position, tMP_Text.transform.position);
						if (num2 < num)
						{
							result = slider;
							num = num2;
						}
					}
				}
				return result;
			}
		}
		return null;
	}

	private static int ReadPlagueLevel(UI_Portal portal, UI_Plaguelands plagueUi, Slider slider)
	{
		TMP_Text tMP_Text = FindPlagueLevelText(portal, plagueUi, slider);
		if (tMP_Text != null && int.TryParse((tMP_Text.text ?? "").Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var result) && result >= 1 && result <= 20)
		{
			return result;
		}
		if (!(slider != null))
		{
			return 0;
		}
		return Mathf.RoundToInt(slider.value);
	}

	private static TMP_Text FindPlagueLevelText(UI_Portal portal, UI_Plaguelands plagueUi, Slider slider)
	{
		if (plagueUi != null && plagueUi.sliderText != null && int.TryParse((plagueUi.sliderText.text ?? "").Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var result) && result >= 1 && result <= 20)
		{
			return plagueUi.sliderText;
		}
		if (portal == null || portal.plaguelandsElements == null)
		{
			return null;
		}
		Il2CppArrayBase<TMP_Text> componentsInChildren = portal.plaguelandsElements.GetComponentsInChildren<TMP_Text>(includeInactive: true);
		TMP_Text tMP_Text = null;
		float num = float.MaxValue;
		for (int i = 0; i < componentsInChildren.Length; i++)
		{
			TMP_Text tMP_Text2 = componentsInChildren[i];
			if (!(tMP_Text2 == null) && int.TryParse((tMP_Text2.text ?? "").Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var result2) && result2 >= 1 && result2 <= 20)
			{
				float num2 = ((slider != null) ? Vector3.Distance(slider.transform.position, tMP_Text2.transform.position) : 0f);
				if (tMP_Text == null || num2 < num)
				{
					tMP_Text = tMP_Text2;
					num = num2;
				}
			}
		}
		return tMP_Text;
	}

	private static NormalButton FindPlagueArrow(UI_Portal portal, UI_Plaguelands plagueUi, Slider slider, bool increase)
	{
		if (plagueUi != null)
		{
			NormalButton normalButton = (increase ? plagueUi.add : plagueUi.sub);
			if (normalButton != null && normalButton.bubm != null)
			{
				return normalButton;
			}
		}
		if (portal == null || portal.plaguelandsElements == null || slider == null)
		{
			return null;
		}
		Il2CppArrayBase<NormalButton> componentsInChildren = portal.plaguelandsElements.GetComponentsInChildren<NormalButton>(includeInactive: true);
		NormalButton result = null;
		float num = float.MaxValue;
		float x = slider.transform.position.x;
		float y = slider.transform.position.y;
		for (int i = 0; i < componentsInChildren.Length; i++)
		{
			NormalButton normalButton2 = componentsInChildren[i];
			if (normalButton2 == null || normalButton2.bubm == null || !normalButton2.gameObject.activeInHierarchy)
			{
				continue;
			}
			Vector3 position = normalButton2.transform.position;
			float num2 = position.x - x;
			if ((!increase || !(num2 <= 0.01f)) && (increase || !(num2 >= -0.01f)) && !(Math.Abs(position.y - y) > 100f))
			{
				float num3 = Math.Abs(num2) + Math.Abs(position.y - y) * 2f;
				if (num3 < num)
				{
					result = normalButton2;
					num = num3;
				}
			}
		}
		return result;
	}

	private static StageNode FindPlagueTarget(UI_Portal portal)
	{
		if (portal == null || portal.plaguelandsElements == null)
		{
			return null;
		}
		Il2CppArrayBase<StageNode> componentsInChildren = portal.plaguelandsElements.GetComponentsInChildren<StageNode>(includeInactive: true);
		StageNode stageNode = null;
		for (int i = 0; i < componentsInChildren.Length; i++)
		{
			StageNode stageNode2 = componentsInChildren[i];
			if (!(stageNode2 == null) && !(stageNode2.button_Enter == null))
			{
				if (stageNode == null)
				{
					stageNode = stageNode2;
				}
				string text = ((stageNode2.m_stageText != null) ? stageNode2.m_stageText.text : "");
				if (text.Contains("瘟疫") || text.Contains("Plague") || text.Contains("折磨"))
				{
					return stageNode2;
				}
			}
		}
		return stageNode;
	}

	private void CompletePendingPlagueRoute(string result)
	{
		ApiTask pendingPlagueRouteTask = _pendingPlagueRouteTask;
		_pendingPlagueRouteTask = null;
		_pendingPlaguePortal = null;
		_pendingPlaguePhase = 0;
		_pendingPlagueDiagnosticLogged = false;
		_pendingPlaguePortalClickIssued = false;
		_pendingPlagueTabClickIssued = false;
		_pendingPlagueLevelDiagnosticLogged = false;
		if (pendingPlagueRouteTask != null && !pendingPlagueRouteTask.ResultTcs.Task.IsCompleted)
		{
			pendingPlagueRouteTask.ResultTcs.SetResult(result);
		}
	}

	private static Type FindStashModelType()
	{
		try
		{
			Type[] types = typeof(UI_Cube).Assembly.GetTypes();
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
			Type[] types2 = ex.Types;
			for (int j = 0; j < types2.Length; j++)
			{
				if (types2[j] != null && types2[j].Name == "Stash" && types2[j].DeclaringType != null && types2[j].DeclaringType.Name == "wh")
				{
					return types2[j];
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
		Type type = target.GetType();
		BindingFlags bindingAttr = BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic;
		PropertyInfo property = type.GetProperty(name, bindingAttr);
		if (property != null && property.GetIndexParameters().Length == 0)
		{
			return property.GetValue(target, null);
		}
		FieldInfo field = type.GetField(name, bindingAttr);
		if (!(field != null))
		{
			return null;
		}
		return field.GetValue(target);
	}

	private static int CollectionCount(object collection)
	{
		object obj = ReadMember(collection, "Count") ?? ReadMember(collection, "Length");
		if (obj != null)
		{
			return Convert.ToInt32(obj);
		}
		return 0;
	}

	private static object CollectionItem(object collection, int index)
	{
		if (collection == null)
		{
			return null;
		}
		PropertyInfo property = collection.GetType().GetProperty("Item", BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);
		if (!(property != null))
		{
			return null;
		}
		return property.GetValue(collection, new object[1] { index });
	}

	private static void CountStashCaches(object cacheCollection, out int used, out int capacity, out string diagnostic)
	{
		used = 0;
		capacity = 0;
		int num = CollectionCount(cacheCollection);
		int num2 = 0;
		int num3 = 0;
		int num4 = 0;
		StringBuilder stringBuilder = new StringBuilder();
		for (int i = 0; i < num; i++)
		{
			object target = CollectionItem(cacheCollection, i);
			object obj = ReadMember(target, "bgrr");
			if (obj != null)
			{
				num2++;
			}
			object obj2 = ReadMember(obj, "IsUnLock");
			if (obj2 != null && Convert.ToBoolean(obj2))
			{
				num3++;
				capacity++;
			}
			object obj3 = ReadMember(obj, "ItemUniqueId");
			object obj4 = ReadMember(target, "burd");
			if ((obj3 != null && Convert.ToUInt64(obj3) != 0L) || (obj4 != null && Convert.ToUInt64(obj4) != 0))
			{
				num4++;
				if (obj2 == null || Convert.ToBoolean(obj2))
				{
					used++;
				}
			}
			if (i == 0)
			{
				stringBuilder.Append("saveUnlock=").Append(obj2 ?? "null").Append(",saveId=")
					.Append(obj3 ?? "null")
					.Append(",cacheId=")
					.Append(obj4 ?? "null")
					.Append(",flags=")
					.Append(ReadMember(target, "bura") ?? "null")
					.Append('/')
					.Append(ReadMember(target, "burc") ?? "null")
					.Append('/')
					.Append(ReadMember(target, "bure") ?? "null")
					.Append('/')
					.Append(ReadMember(target, "buri") ?? "null");
			}
		}
		diagnostic = "slots=" + num + ",save=" + num2 + ",unlocked=" + num3 + ",occupied=" + num4 + ",sample=" + stringBuilder;
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
		WarehouseSnapshot warehouseSnapshot = new WarehouseSnapshot();
		try
		{
			UIManager uIManager = UnityEngine.Object.FindObjectOfType<UIManager>(includeInactive: true);
			UI_RemakeStash uI_RemakeStash = ((uIManager != null) ? uIManager.Ui_NewStash : null);
			Il2CppSystem.Collections.Generic.List<StashTabButton> list = ((uI_RemakeStash != null) ? uI_RemakeStash.m_stashTabButtonList : null);
			MethodInfo methodInfo = FindStashModelType()?.GetMethod("kcs", BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic, null, new Type[1] { typeof(int) }, null);
			if (methodInfo == null || list == null || list.Count == 0)
			{
				AutoApiPlugin.Logger.LogWarning("[仓库监控] 无法读取用户仓库页：标签数=" + (list?.Count ?? 0) + ", 页面读取接口=" + (methodInfo != null));
				return warehouseSnapshot;
			}
			warehouseSnapshot.TabEntries = list.Count;
			int bhxp = list[0].bhxp;
			System.Collections.Generic.List<StashTabButton> list2 = new System.Collections.Generic.List<StashTabButton>();
			HashSet<int> hashSet = new HashSet<int>();
			for (int i = 0; i < list.Count; i++)
			{
				StashTabButton stashTabButton = list[i];
				if (!(stashTabButton == null))
				{
					int bhxp2 = stashTabButton.bhxp;
					if (bhxp2 >= 0 && bhxp2 >= bhxp && hashSet.Add(bhxp2))
					{
						list2.Add(stashTabButton);
					}
				}
			}
			warehouseSnapshot.PageTabs = list2.Count;
			if (list2.Count == 0)
			{
				AutoApiPlugin.Logger.LogWarning("[仓库监控] 页签列表没有可读取的唯一页键（总项数=" + list.Count + "）。");
				return warehouseSnapshot;
			}
			bhxp = list2[0].bhxp;
			int num = 0;
			HashSet<IntPtr> hashSet2 = new HashSet<IntPtr>();
			HashSet<string> hashSet3 = new HashSet<string>(StringComparer.Ordinal);
			System.Collections.Generic.List<int> list3 = new System.Collections.Generic.List<int>();
			if (CollectionCount(methodInfo.Invoke(null, new object[1] { bhxp })) == 0 && CollectionCount(methodInfo.Invoke(null, new object[1] { bhxp + 1 })) > 0)
			{
				num = 1;
			}
			for (int j = 0; j < list2.Count; j++)
			{
				StashTabButton stashTabButton2 = list2[j];
				int num2 = stashTabButton2.bhxp + num;
				object obj = methodInfo.Invoke(null, new object[1] { num2 });
				if (CollectionCount(obj) == 0)
				{
					AutoApiPlugin.Logger.LogWarning("[仓库监控] 第 " + (j + 1) + " 页缓存为空（标签键=" + num2 + "）。");
					break;
				}
				bool num3 = obj is Il2CppObjectBase il2CppObjectBase && il2CppObjectBase.Pointer != IntPtr.Zero && !hashSet2.Add(il2CppObjectBase.Pointer);
				string occupiedPageSignature = GetOccupiedPageSignature(obj);
				bool flag = occupiedPageSignature.Length > 0 && !hashSet3.Add(occupiedPageSignature);
				if (num3 | flag)
				{
					warehouseSnapshot.PageTabs--;
					AutoApiPlugin.Logger.LogInfo("[仓库监控] 第 " + (j + 1) + " 页重复引用仓库数据，跳过（标签键=" + num2 + "）。");
					continue;
				}
				list3.Add(stashTabButton2.bhxp);
				CountStashCaches(obj, out var used, out var capacity, out var diagnostic);
				warehouseSnapshot.Pages.Add(new WarehousePageSnapshot
				{
					PageNumber = j + 1,
					PageKey = num2,
					Used = used,
					Capacity = capacity
				});
				warehouseSnapshot.Used += used;
				warehouseSnapshot.Capacity += capacity;
				if (capacity > 0)
				{
					warehouseSnapshot.OwnedPages++;
				}
				if (!_lastWarehouseRawDiagnostics.TryGetValue(j + 1, out var value) || !string.Equals(diagnostic, value, StringComparison.Ordinal))
				{
					_lastWarehouseRawDiagnostics[j + 1] = diagnostic;
					AutoApiPlugin.Logger.LogInfo("[仓库监控原始值] 第 " + (j + 1) + " 页 " + diagnostic);
				}
			}
			warehouseSnapshot.PageKeys = string.Join(",", list3);
			if (warehouseSnapshot.Pages.Count == warehouseSnapshot.PageTabs)
			{
				string text = warehouseSnapshot.Used + "/" + warehouseSnapshot.Capacity;
				if (!string.Equals(text, _lastWarehouseMonitorSignature, StringComparison.Ordinal))
				{
					_lastWarehouseMonitorSignature = text;
					AutoApiPlugin.Logger.LogInfo("[仓库监控] 唯一仓库页扫描完成（有效页键=" + warehouseSnapshot.PageKeys + "）：" + warehouseSnapshot.Used + "/" + warehouseSnapshot.Capacity + " 格，负载=" + warehouseSnapshot.Percent.ToString("0.0", CultureInfo.InvariantCulture) + "%。");
				}
			}
		}
		catch (Exception ex)
		{
			AutoApiPlugin.Logger.LogWarning("[仓库监控] 扫描异常：" + ex.Message);
		}
		if (warehouseSnapshot.IsComplete)
		{
			_cachedWarehouseSnapshot = warehouseSnapshot;
		}
		return warehouseSnapshot;
	}

	private static string ReadWarehouseItems()
	{
		WarehouseSnapshot warehouseSnapshot = ScanWarehousePages();
		if (!warehouseSnapshot.IsComplete)
		{
			return JsonSerializer.Serialize(new
			{
				status = "WAITING",
				message = "等待角色和仓库数据加载"
			});
		}
		System.Collections.Generic.List<object> list = new System.Collections.Generic.List<object>();
		System.Collections.Generic.List<object> list2 = new System.Collections.Generic.List<object>();
		int num = 0;
		foreach (WarehousePageSnapshot page in warehouseSnapshot.Pages)
		{
			Il2CppSystem.Collections.Generic.List<wh.StashCache> list3 = wh.Stash.kcs(page.PageKey);
			if (list3 == null)
			{
				continue;
			}
			for (int i = 0; i < list3.Count; i++)
			{
				try
				{
					wh.StashCache stashCache = list3[i];
					if (stashCache == null || stashCache.bgrr == null || !stashCache.bgrr.IsUnLock)
					{
						continue;
					}
					ulong num2 = ((stashCache.bgrr.ItemUniqueId != 0L) ? stashCache.bgrr.ItemUniqueId : stashCache.burd);
					if (num2 == 0L)
					{
						continue;
					}
					wh.vc.va value = null;
					wh.vc.bglb?.TryGetValue(num2, out value);
					ItemInfoData itemInfoData = value?.bukr;
					if (itemInfoData == null)
					{
						num++;
						continue;
					}
					int num3 = stashCache.burg;
					bool flag = num3 > 0 && (itemInfoData.MaxStack <= 0 || num3 <= itemInfoData.MaxStack);
					if (itemInfoData.ITEMTYPE == EItemType.GEAR && !flag)
					{
						num3 = 1;
						flag = true;
					}
					list.Add(new
					{
						item_key = itemInfoData.ItemKey,
						name = RuntimeMonitor.ResolveItemName(itemInfoData.NameKey),
						name_key = (itemInfoData.NameKey ?? ""),
						icon_path = (itemInfoData.IconPath ?? ""),
						grade = (int)itemInfoData.GRADE,
						level = itemInfoData.Level,
						type = itemInfoData.ITEMTYPE.ToString(),
						quantity = (flag ? num3 : 0),
						quantity_known = flag,
						marketable_definition = (itemInfoData.IsSteamItem && itemInfoData.IsCanExchangeMarketable && !itemInfoData.TemporaryBlockTradingStash),
						page = page.PageNumber,
						slot = i
					});
					if (list2.Count < 6)
					{
						list2.Add(new
						{
							key = itemInfoData.ItemKey,
							kind = itemInfoData.ITEMTYPE.ToString(),
							max_stack = itemInfoData.MaxStack,
							slot_key = stashCache.burf,
							slot_count = stashCache.burg,
							slot_other = stashCache.burh,
							cache_key = value.buks,
							cache_bulk = value.bulk,
							cache_bulm = value.bulm,
							cache_buln = value.buln,
							cache_bulo = value.bulo,
							cache_bulu = value.bulu,
							cache_bulv = value.bulv,
							cache_bulw = value.bulw
						});
					}
				}
				catch (Exception ex)
				{
					num++;
					if (num <= 3)
					{
						AutoApiPlugin.Logger.LogWarning("[仓库道具] 道具读取失败：" + ex.Message);
					}
				}
			}
		}
		return JsonSerializer.Serialize(new
		{
			status = "SUCCESS",
			read_at = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
			used = warehouseSnapshot.Used,
			capacity = warehouseSnapshot.Capacity,
			pages = warehouseSnapshot.OwnedPages,
			missing = num,
			items = list,
			diagnostics = list2
		});
	}

	private static string GetOccupiedPageSignature(object cacheCollection)
	{
		StringBuilder stringBuilder = new StringBuilder();
		int num = CollectionCount(cacheCollection);
		for (int i = 0; i < num; i++)
		{
			object target = CollectionItem(cacheCollection, i);
			object obj = ReadMember(ReadMember(target, "bgrr"), "ItemUniqueId");
			object obj2 = ReadMember(target, "burd");
			ulong num2 = ((obj != null) ? Convert.ToUInt64(obj) : 0);
			if (num2 == 0L && obj2 != null)
			{
				num2 = Convert.ToUInt64(obj2);
			}
			if (num2 != 0L)
			{
				stringBuilder.Append(num2.ToString(CultureInfo.InvariantCulture)).Append(',');
			}
		}
		return stringBuilder.ToString();
	}

	private void ProcessPendingSynthType()
	{
		if (_pendingSynthTypeTask == null || Time.unscaledTime < _pendingSynthTypeNextTime)
		{
			return;
		}
		if (Time.unscaledTime - _pendingSynthTypeStartTime > 4f)
		{
			AutoApiPlugin.Logger.LogWarning("[腐蚀类别] 等待类别按钮渲染超时，目标类型=" + _pendingSynthTypeValue);
			CompletePendingSynthType("FAILED");
			return;
		}
		try
		{
			if (TryExecuteSynthType(_pendingSynthTypeValue, out var waiting))
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
			AutoApiPlugin.Logger.LogWarning("[腐蚀类别] 选择类别异常：" + ex);
			CompletePendingSynthType("FAILED");
		}
	}

	private void CompletePendingSynthType(string result)
	{
		ApiTask pendingSynthTypeTask = _pendingSynthTypeTask;
		_pendingSynthTypeTask = null;
		_pendingSynthTypeStartTime = 0f;
		_pendingSynthTypeNextTime = 0f;
		_pendingSynthTypeDropdownClickIssued = false;
		_pendingSynthTypeWaitLogged = false;
		if (pendingSynthTypeTask != null && !pendingSynthTypeTask.ResultTcs.Task.IsCompleted)
		{
			pendingSynthTypeTask.ResultTcs.SetResult(result);
		}
	}

	private bool TryExecuteSynthType(int typeInt, out bool waiting)
	{
		waiting = false;
		UI_Cube uI_Cube = UnityEngine.Object.FindObjectOfType<UI_Cube>(includeInactive: true);
		if (uI_Cube == null || !uI_Cube.gameObject.activeInHierarchy)
		{
			waiting = true;
			return false;
		}
		CubeSlotSetter cubeSlotSetter = uI_Cube.m_cubeSlotSetter;
		if (cubeSlotSetter == null || cubeSlotSetter.m_cubeInventorySlots == null || cubeSlotSetter.m_cubeInventorySlots.Count < 9 || uI_Cube.m_synthesisAutoFillButton == null)
		{
			LogSynthTypeWait(typeInt, "魔方内部数据/九个物品槽尚未初始化");
			waiting = true;
			return false;
		}
		SynthesisItemTypeComboBoxButton synthesisItemTypeButton = uI_Cube.m_synthesisItemTypeButton;
		if (synthesisItemTypeButton == null)
		{
			waiting = true;
			return false;
		}
		Il2CppSystem.Collections.Generic.List<SynthesisItemTypeChangerButton> list = null;
		try
		{
			list = synthesisItemTypeButton.m_buttons;
		}
		catch (Exception ex)
		{
			LogSynthTypeWait(typeInt, "读取类别列表暂不可用：" + ex.Message);
			waiting = true;
			return false;
		}
		int num = 0;
		try
		{
			num = list?.Count ?? 0;
		}
		catch (Exception ex2)
		{
			LogSynthTypeWait(typeInt, "类别列表尚未初始化：" + ex2.Message);
			waiting = true;
			return false;
		}
		if (list == null || num == 0)
		{
			if (!_pendingSynthTypeDropdownClickIssued)
			{
				try
				{
					if (synthesisItemTypeButton.bubm != null)
					{
						synthesisItemTypeButton.bubm.Invoke();
					}
					else
					{
						ClickGameObject(synthesisItemTypeButton.gameObject, "等待类型列表渲染：展开类别下拉框");
					}
				}
				catch (Exception ex3)
				{
					LogSynthTypeWait(typeInt, "打开类别列表异常：" + ex3.Message);
				}
				_pendingSynthTypeDropdownClickIssued = true;
			}
			LogSynthTypeWait(typeInt, "类别列表尚未渲染");
			waiting = true;
			return false;
		}
		SynthesisItemTypeChangerButton synthesisItemTypeChangerButton = null;
		for (int i = 0; i < num; i++)
		{
			SynthesisItemTypeChangerButton synthesisItemTypeChangerButton2 = list[i];
			if (synthesisItemTypeChangerButton2 != null && synthesisItemTypeChangerButton2.m_synthesisItemType == (EItemSynthesisType)typeInt)
			{
				synthesisItemTypeChangerButton = synthesisItemTypeChangerButton2;
				break;
			}
		}
		if (synthesisItemTypeChangerButton == null || synthesisItemTypeChangerButton.m_button == null)
		{
			LogSynthTypeWait(typeInt, "尚未找到对应类别按钮");
			waiting = true;
			return false;
		}
		Button.ButtonClickedEvent buttonClickedEvent = null;
		try
		{
			buttonClickedEvent = synthesisItemTypeChangerButton.m_button.onClick;
		}
		catch (Exception ex4)
		{
			LogSynthTypeWait(typeInt, "类别按钮尚未就绪：" + ex4.Message);
			waiting = true;
			return false;
		}
		if (buttonClickedEvent == null)
		{
			LogSynthTypeWait(typeInt, "类别按钮点击事件尚未就绪");
			waiting = true;
			return false;
		}
		GameObject gameObject = synthesisItemTypeChangerButton.m_button.gameObject;
		if (gameObject == null)
		{
			LogSynthTypeWait(typeInt, "类别按钮对象尚未初始化");
			waiting = true;
			return false;
		}
		gameObject.SetActive(value: true);
		try
		{
			buttonClickedEvent.Invoke();
		}
		catch (Exception ex5)
		{
			AutoApiPlugin.Logger.LogWarning("[腐蚀类别] 游戏原生切换回调失败，停止本轮以避免重复空引用：" + ex5.Message);
			waiting = false;
			return false;
		}
		bool flag = false;
		try
		{
			flag = synthesisItemTypeChangerButton.m_selectObject != null && synthesisItemTypeChangerButton.m_selectObject.activeInHierarchy;
		}
		catch
		{
		}
		AutoApiPlugin.Logger.LogInfo("[腐蚀类别] 已触发游戏类别按钮：" + synthesisItemTypeChangerButton.m_synthesisItemType.ToString() + "；选中标记=" + flag);
		try
		{
			if (synthesisItemTypeButton.m_comboBoxObject != null && synthesisItemTypeButton.m_comboBoxObject.activeInHierarchy && synthesisItemTypeButton.bubm != null)
			{
				synthesisItemTypeButton.bubm.Invoke();
			}
		}
		catch (Exception ex6)
		{
			AutoApiPlugin.Logger.LogDebug("[腐蚀类别] 收起类别菜单时可忽略异常：" + ex6.Message);
		}
		return true;
	}

	private void LogSynthTypeWait(int typeInt, string reason)
	{
		if (!_pendingSynthTypeWaitLogged)
		{
			_pendingSynthTypeWaitLogged = true;
			AutoApiPlugin.Logger.LogInfo("[腐蚀类别] 等待界面就绪：目标类型=" + typeInt + "，" + reason);
		}
	}

	private bool ExecuteSynthOperation(string operation, out bool needsSuspend)
	{
		needsSuspend = false;
		if (operation != "corrosion" && operation != "synthesis")
		{
			return false;
		}
		UI_Cube uI_Cube = UnityEngine.Object.FindObjectOfType<UI_Cube>(includeInactive: true);
		if (uI_Cube == null || !uI_Cube.gameObject.activeInHierarchy)
		{
			return false;
		}
		ComboBoxButton mainRecipeToggleBtn = uI_Cube.m_mainRecipeToggleBtn;
		if (mainRecipeToggleBtn == null)
		{
			return false;
		}
		MainRecipeSlotButton mainRecipeSlotButton = CorrosionRecipeSelector.Find(uI_Cube, mainRecipeToggleBtn, operation);
		if (mainRecipeSlotButton != null && mainRecipeSlotButton.m_isSelected)
		{
			return true;
		}
		if (mainRecipeSlotButton == null)
		{
			GameObject comboBoxObject = mainRecipeToggleBtn.m_comboBoxObject;
			bool flag = comboBoxObject != null && comboBoxObject.activeInHierarchy;
			if (!_operationMenuOpenRequested && !flag)
			{
				ClickGameObject(mainRecipeToggleBtn.gameObject, "展开魔方操作下拉框");
				_operationMenuOpenRequested = true;
			}
			string text = ((flag || _operationMenuOpenRequested) ? "操作菜单已展开，等待腐蚀选项渲染" : "等待魔方操作菜单渲染");
			if (text != _lastOperationWaitLog)
			{
				AutoApiPlugin.Logger.LogInfo("[腐蚀] " + text);
				_lastOperationWaitLog = text;
			}
			needsSuspend = true;
			return false;
		}
		mainRecipeSlotButton.gameObject.SetActive(value: true);
		if (mainRecipeSlotButton.m_clickButton == null)
		{
			return false;
		}
		ClickGameObject(mainRecipeSlotButton.m_clickButton.gameObject, "选择魔方操作 -> " + operation);
		needsSuspend = true;
		return false;
	}

	private bool ExecuteSynthLevel(string targetLevel, out bool needsSuspend)
	{
		needsSuspend = false;
		UI_Cube uI_Cube = UnityEngine.Object.FindObjectOfType<UI_Cube>(includeInactive: true);
		if (uI_Cube == null || !uI_Cube.gameObject.activeInHierarchy)
		{
			return false;
		}
		string value = targetLevel.Replace("~", "-").Replace(" ", "").ToLowerInvariant();
		Il2CppArrayBase<SubRecipeComboBoxButton> il2CppArrayBase = UnityEngine.Object.FindObjectsOfType<SubRecipeComboBoxButton>(includeInactive: true);
		SubRecipeComboBoxButton subRecipeComboBoxButton = null;
		System.Collections.Generic.List<string> list = new System.Collections.Generic.List<string>();
		for (int i = 0; i < il2CppArrayBase.Length; i++)
		{
			SubRecipeComboBoxButton subRecipeComboBoxButton2 = il2CppArrayBase[i];
			if (subRecipeComboBoxButton2 == null || !subRecipeComboBoxButton2.gameObject.activeInHierarchy)
			{
				continue;
			}
			Il2CppSystem.Collections.Generic.List<SubRecipeSlotButton> subRecipeSlotButton = subRecipeComboBoxButton2.m_subRecipeSlotButton;
			if (subRecipeSlotButton == null || subRecipeSlotButton.Count == 0)
			{
				continue;
			}
			if (subRecipeComboBoxButton == null)
			{
				subRecipeComboBoxButton = subRecipeComboBoxButton2;
			}
			for (int j = 0; j < subRecipeSlotButton.Count; j++)
			{
				SubRecipeSlotButton subRecipeSlotButton2 = subRecipeSlotButton[j];
				if (subRecipeSlotButton2 == null || subRecipeSlotButton2.m_text == null)
				{
					continue;
				}
				string text = subRecipeSlotButton2.m_text.text ?? "";
				string text2 = text.Replace("~", "-").Replace(" ", "").ToLowerInvariant();
				if (!list.Contains(text))
				{
					list.Add(text);
				}
				if (subRecipeSlotButton2.m_isSelected && text2.Contains(value))
				{
					_lastLevelDiagnostic = null;
					return true;
				}
				if (!subRecipeSlotButton2.m_isLocked && text2.Contains(value) && subRecipeSlotButton2.m_clickButton != null)
				{
					ClickGameObject(subRecipeSlotButton2.m_clickButton.gameObject, "锁定配方等级 -> " + targetLevel);
					GameObject comboBoxObject = subRecipeComboBoxButton2.m_comboBoxObject;
					if (comboBoxObject != null && comboBoxObject.activeInHierarchy)
					{
						ClickGameObject(subRecipeComboBoxButton2.gameObject, "收起配方下拉框");
					}
					_lastLevelDiagnostic = null;
					return true;
				}
			}
		}
		if (subRecipeComboBoxButton == null)
		{
			AutoApiPlugin.Logger.LogWarning("[等级] 没有活动的等级下拉框，目标=" + targetLevel);
			return false;
		}
		GameObject comboBoxObject2 = subRecipeComboBoxButton.m_comboBoxObject;
		bool flag = comboBoxObject2 != null && comboBoxObject2.activeInHierarchy;
		if (!flag)
		{
			ClickGameObject(subRecipeComboBoxButton.gameObject, "展开等级下拉框");
		}
		string text3 = "目标=" + targetLevel + "; 已展开=" + flag + "; 当前选项=" + string.Join("|", list);
		if (text3 != _lastLevelDiagnostic)
		{
			AutoApiPlugin.Logger.LogInfo("[等级] 等待目标选项渲染；" + text3);
			_lastLevelDiagnostic = text3;
		}
		needsSuspend = true;
		return false;
	}

	private bool ExecuteSynthClear()
	{
		UI_Cube uI_Cube = UnityEngine.Object.FindObjectOfType<UI_Cube>(includeInactive: true);
		if (uI_Cube == null || !uI_Cube.gameObject.activeInHierarchy)
		{
			return false;
		}
		if (uI_Cube.m_trashToggleBtn != null && uI_Cube.m_trashToggleBtn.m_button != null)
		{
			uI_Cube.m_trashToggleBtn.m_button.onClick.Invoke();
			return true;
		}
		return false;
	}

	private void CompletePendingFill(string result)
	{
		ApiTask pendingFillTask = _pendingFillTask;
		_pendingFillTask = null;
		_pendingWarehouseLockAutoFillRequested = false;
		_pendingFillWaitingForStorage = false;
		_pendingFillWaitingForItems = false;
		_pendingFillExcludeInscriptionScrolls = false;
		_pendingFillExcludeOfferingCoins = false;
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
		pendingFillTask?.ResultTcs.SetResult(result);
	}

	private void BeginPendingAutoFillWithWarehouseLocks(UI_Cube cube)
	{
		_pendingWarehouseLockAutoFillRequested = false;
		if (cube == null || !cube.gameObject.activeInHierarchy)
		{
			CompletePendingFill("FAILED|auto_fill|CUBE_NOT_READY");
			return;
		}
		LockExcludedWarehouseItems();
		BeginPendingAutoFill(cube);
	}

	private void LockExcludedWarehouseItems()
	{
		if (!_pendingFillTargetStorage || (!_pendingFillExcludeInscriptionScrolls && !_pendingFillExcludeOfferingCoins))
		{
			return;
		}
		WarehouseSnapshot warehouse = ScanWarehousePages();
		if (!warehouse.IsComplete)
		{
			AutoApiPlugin.Logger.LogWarning("[腐蚀预锁] 仓库扫描未完成，继续使用自动填充后的排除项清理。");
			return;
		}
		int matched = 0;
		int locked = 0;
		int alreadyLocked = 0;
		int lockFailed = 0;
		foreach (WarehousePageSnapshot page in warehouse.Pages)
		{
			var slots = wh.Stash.kcs(page.PageKey);
			if (slots == null)
			{
				continue;
			}
			for (int i = 0; i < slots.Count; i++)
			{
				wh.StashCache slot = slots[i];
				if (slot == null || slot.bgrr == null || !slot.bgrr.IsUnLock)
				{
					continue;
				}
				ulong uniqueId = slot.bgrr.ItemUniqueId != 0UL ? slot.bgrr.ItemUniqueId : slot.burd;
				if (uniqueId == 0UL)
				{
					continue;
				}
				wh.vc.va cache = null;
				var inventoryCaches = wh.vc.bglb;
				if (inventoryCaches != null)
				{
					inventoryCaches.TryGetValue(uniqueId, out cache);
				}
				ItemInfoData info = cache != null ? cache.bukr : null;
				if (info == null || info.ItemKey <= 0 || !RuntimeMonitor.IsExcludedCorrosionItemKey(
					info.ItemKey, _pendingFillExcludeInscriptionScrolls, _pendingFillExcludeOfferingCoins,
					out string itemName, out string exclusion))
				{
					continue;
				}
				matched++;
				if (slot.buri)
				{
					alreadyLocked++;
					continue;
				}
				if (slot.kdk(true))
				{
					locked++;
					AutoApiPlugin.Logger.LogInfo("[腐蚀预锁] 已锁定" + exclusion + "：" + itemName
						+ "，仓库页=" + page.PageNumber + "，槽位=" + i.ToString(CultureInfo.InvariantCulture) + "。");
				}
				else
				{
					lockFailed++;
					AutoApiPlugin.Logger.LogWarning("[腐蚀预锁] 锁定失败" + exclusion + "：" + itemName
						+ "，仓库页=" + page.PageNumber + "，槽位=" + i.ToString(CultureInfo.InvariantCulture) + "；填充后仍会执行排除项清理。");
				}
			}
		}
		AutoApiPlugin.Logger.LogInfo("[腐蚀预锁] 仓库排除项匹配=" + matched.ToString(CultureInfo.InvariantCulture)
			+ "，新锁定=" + locked.ToString(CultureInfo.InvariantCulture)
			+ "，已锁定=" + alreadyLocked.ToString(CultureInfo.InvariantCulture)
			+ "，失败=" + lockFailed.ToString(CultureInfo.InvariantCulture) + "；随后调用游戏自动填充，已锁道具可在仓库按 Alt+左键解锁。");
	}

	private bool QueueExcludedMaterialCleanup(UI_Cube cube)
	{
		if ((!_pendingFillExcludeInscriptionScrolls && !_pendingFillExcludeOfferingCoins) || cube == null || cube.m_cubeSlotSetter == null)
		{
			return false;
		}
		Il2CppSystem.Collections.Generic.List<CubeInventorySlot> cubeInventorySlots = cube.m_cubeSlotSetter.m_cubeInventorySlots;
		if (cubeInventorySlots == null)
		{
			return false;
		}
		_pendingExcludedSlotIndices.Clear();
		for (int i = 0; i < cubeInventorySlots.Count; i++)
		{
			CubeInventorySlot cubeInventorySlot = cubeInventorySlots[i];
			if (cubeInventorySlot == null || cubeInventorySlot._cubeData == null)
			{
				continue;
			}
			try
			{
				int num = CubeItemKey(cubeInventorySlot._cubeData);
				string itemName = "";
				string exclusion = "";
				if (num > 0 && IsExcludedCorrosionMaterial(cubeInventorySlot._cubeData, _pendingFillExcludeInscriptionScrolls, _pendingFillExcludeOfferingCoins, out itemName, out exclusion))
				{
					_pendingExcludedSlotIndices.Add(i);
					AutoApiPlugin.Logger.LogInfo("[腐蚀排除项] 识别" + exclusion + "：" + itemName + "，ItemKey=" + num.ToString(CultureInfo.InvariantCulture) + "，槽位=" + i.ToString(CultureInfo.InvariantCulture) + "。");
				}
				else if (num > 0 && !string.IsNullOrWhiteSpace(itemName))
				{
					AutoApiPlugin.Logger.LogInfo("[腐蚀筛选] 保留道具：" + itemName + "，ItemKey=" + num.ToString(CultureInfo.InvariantCulture) + "，槽位=" + i.ToString(CultureInfo.InvariantCulture) + "。");
				}
				else if (num > 0)
				{
					AutoApiPlugin.Logger.LogWarning("[腐蚀筛选] ItemInfo 暂无 ItemKey=" + num.ToString(CultureInfo.InvariantCulture) + " 的名称；物品保留待品质安全锁检查。");
				}
			}
			catch
			{
			}
		}
		if (_pendingExcludedSlotIndices.Count == 0)
		{
			return false;
		}
		_pendingFillCleaningExcluded = true;
		_pendingExcludedSlotCursor = 0;
		_pendingExcludedNextClickTime = Time.unscaledTime;
		_pendingExcludedSettleTime = 0f;
		AutoApiPlugin.Logger.LogInfo("[腐蚀排除项] 检出 " + _pendingExcludedSlotIndices.Count + " 个指定排除物品；逐个退回，间隔" + InventoryOperationGate.ClickGapSeconds + "秒，保留其他道具和材料。");
		return true;
	}

	private void ProcessPendingExcludedMaterialCleanup()
	{
		if (Time.unscaledTime < _pendingExcludedNextClickTime)
		{
			return;
		}
		string text = InventoryOperationGate.Readiness();
		if (text != "READY")
		{
			if (text.StartsWith("FAILED|", StringComparison.Ordinal))
			{
				CompletePendingFill("FAILED|excluded_return|" + text);
			}
			else
			{
				_pendingExcludedNextClickTime = Time.unscaledTime + 0.5f;
			}
			return;
		}
		UI_Cube uI_Cube = UnityEngine.Object.FindObjectOfType<UI_Cube>(includeInactive: true);
		int slotIndex;
		int itemKey;
		string itemName;
		string exclusion;
		if (uI_Cube == null || uI_Cube.m_cubeSlotSetter == null)
		{
			CompletePendingFill("EXCLUSION_NOT_READY");
		}
		else if (TryFindExcludedCorrosionMaterial(uI_Cube, _pendingFillExcludeInscriptionScrolls, _pendingFillExcludeOfferingCoins, out slotIndex, out itemKey, out itemName, out exclusion))
		{
			Il2CppSystem.Collections.Generic.List<CubeInventorySlot> cubeInventorySlots = uI_Cube.m_cubeSlotSetter.m_cubeInventorySlots;
			CubeInventorySlot cubeInventorySlot = ((cubeInventorySlots != null && slotIndex >= 0 && slotIndex < cubeInventorySlots.Count) ? cubeInventorySlots[slotIndex] : null);
			if (!(cubeInventorySlot == null) && _pendingExcludedSlotCursor < 18)
			{
				try
				{
					string text2 = InventoryOperationGate.TryBeginHelperAction();
					if (text2 != "READY")
					{
						if (text2.StartsWith("FAILED|", StringComparison.Ordinal))
						{
							CompletePendingFill("FAILED|excluded_return|" + text2);
						}
						else
						{
							_pendingExcludedNextClickTime = Time.unscaledTime + 0.5f;
						}
					}
					else
					{
						ReturnProtectedCubeItem(cubeInventorySlot);
						InventoryOperationGate.MarkUiInventoryChange();
						_pendingExcludedSlotCursor++;
						_pendingExcludedNextClickTime = (_pendingExcludedSettleTime = Time.unscaledTime + 0.5f);
						AutoApiPlugin.Logger.LogInfo("[腐蚀排除项] 已请求退回" + exclusion + "：" + itemName + "，当前槽位=" + slotIndex.ToString(CultureInfo.InvariantCulture) + "；其他物品保留。");
					}
					return;
				}
				catch (Exception ex)
				{
					AutoApiPlugin.Logger.LogWarning("[腐蚀排除项] 退回尚未完成：" + ex.Message);
					CompletePendingFill("EXCLUSION_NOT_READY");
					return;
				}
			}
			CompletePendingFill("EXCLUSION_NOT_READY");
		}
		else if (!(Time.unscaledTime < _pendingExcludedSettleTime))
		{
			int count = CountCubeItems(uI_Cube);
			AutoApiPlugin.Logger.LogInfo("[腐蚀排除项] 已确认卷轴和纪念币均已处理，保留" + count + "件其他物品继续腐蚀。");
			CompletePendingFill(_pendingFillAllowPartial ? CubeBatchPolicy.CorrosionFillStatus(count) : ("NOT_ENOUGH_" + count));
		}
	}

	private static void ReturnProtectedCubeItem(CubeInventorySlot slot)
	{
		int inCubeIndex = slot._cubeData.InCubeIndex;
		if (inCubeIndex < 0 || inCubeIndex >= 9)
		{
			throw new InvalidOperationException("魔方格子编号尚未同步。");
		}
		wh.Cube.jac(inCubeIndex);
	}

	private bool HasPendingCubeUiTask()
	{
		if (_pendingFillTask == null && _pendingSynthTypeTask == null && _pendingOperationTask == null)
		{
			return _pendingLevelTask != null;
		}
		return true;
	}

	private static bool IsMutatingUiCommand(string command)
	{
		if ((!command.StartsWith("chest_") || !(command != "chest_catalog")) && !command.StartsWith("plague_") && (!command.StartsWith("store_") || !(command != "store_check_full")))
		{
			if (command.StartsWith("synth_") && command != "synth_current_operation")
			{
				return !command.StartsWith("synth_validate_");
			}
			return false;
		}
		return true;
	}

	private void BeginPendingAutoFill(UI_Cube cube)
	{
		if (_pendingFillTargetStorage)
		{
			WarehouseSnapshot warehouseSnapshot = ScanWarehousePages();
			if (!warehouseSnapshot.IsComplete)
			{
				AutoApiPlugin.Logger.LogWarning("[自动填充] 仓库页扫描未完成（" + warehouseSnapshot.Pages.Count + "/" + warehouseSnapshot.PageTabs + "），取消本轮填充。");
				CompletePendingFill("WAREHOUSE_SCAN_FAILED");
				return;
			}
			StringBuilder stringBuilder = new StringBuilder();
			for (int i = 0; i < warehouseSnapshot.Pages.Count; i++)
			{
				if (i > 0)
				{
					stringBuilder.Append("；");
				}
				WarehousePageSnapshot warehousePageSnapshot = warehouseSnapshot.Pages[i];
				stringBuilder.Append("第").Append(warehousePageSnapshot.PageNumber).Append("页 ")
					.Append(warehousePageSnapshot.Used)
					.Append('/')
					.Append(warehousePageSnapshot.Capacity);
			}
			AutoApiPlugin.Logger.LogInfo("[自动填充] 已检查用户拥有的 " + warehouseSnapshot.OwnedPages + " 页仓库：" + stringBuilder?.ToString() + "；之后调用游戏内自动填充。");
		}
		if (cube.m_synthesisAutoFillButton == null)
		{
			CompletePendingFill("FAILED");
			return;
		}
		if (cube.m_synthesisAutoFillButton.bubm != null)
		{
			cube.m_synthesisAutoFillButton.bubm.Invoke();
			AutoApiPlugin.Logger.LogInfo("[自动填充] 已直接触发游戏自动填充按钮事件。");
		}
		else
		{
			ClickGameObject(cube.m_synthesisAutoFillButton.gameObject, "自动填充");
		}
		_pendingFillWaitingForStorage = false;
		_pendingFillWaitingForItems = true;
		_lastPendingFillCount = -1;
		_pendingFillCountStableSince = Time.unscaledTime;
		_pendingFillTime = Time.unscaledTime + 0.5f;
	}

	private static int CountCubeItems(UI_Cube cube)
	{
		if (cube == null || cube.m_cubeSlotSetter == null)
		{
			return 0;
		}
		Il2CppSystem.Collections.Generic.List<CubeInventorySlot> cubeInventorySlots = cube.m_cubeSlotSetter.m_cubeInventorySlots;
		if (cubeInventorySlots == null)
		{
			return 0;
		}
		int num = 0;
		for (int i = 0; i < cubeInventorySlots.Count; i++)
		{
			CubeInventorySlot cubeInventorySlot = cubeInventorySlots[i];
			if (cubeInventorySlot == null || cubeInventorySlot._cubeData == null)
			{
				continue;
			}
			try
			{
				if (CubeItemKey(cubeInventorySlot._cubeData) > 0)
				{
					num++;
				}
			}
			catch
			{
			}
		}
		return num;
	}

	private string ExecuteSynthValidation(int maxGrade, string expectedOperation)
	{
		if (maxGrade < 0 || maxGrade > 9)
		{
			return "INVALID_MAX_GRADE";
		}
		UI_Cube uI_Cube = UnityEngine.Object.FindObjectOfType<UI_Cube>(includeInactive: true);
		if (uI_Cube == null || !uI_Cube.gameObject.activeInHierarchy)
		{
			return "NO_UI";
		}
		if (!SlotsWithinGradeLimit(uI_Cube, maxGrade, out var offender, out var itemCount))
		{
			AutoApiPlugin.Logger.LogWarning("[安全锁] 只读校验拒绝：" + offender + "；上限品质=" + maxGrade + "。");
			return "EXCEED_MAX_GRADE";
		}
		if (!CubeBatchPolicy.IsValidCount(expectedOperation, itemCount))
		{
			AutoApiPlugin.Logger.LogWarning("[安全锁] 只读校验未通过：" + itemCount + "/" + 9 + " 件。");
			return "NOT_ENOUGH";
		}
		AutoApiPlugin.Logger.LogInfo("[安全锁] 只读品质校验通过：" + itemCount + "/" + 9 + " 件，逐格品质均≤" + GradeLabel(maxGrade) + "；未执行腐蚀。");
		if (expectedOperation == "corrosion")
		{
			Button button = ((uI_Cube.toggleButton_Trigger != null) ? InnerButton(uI_Cube.toggleButton_Trigger) : null);
			return "QUALITY_OK|count=" + itemCount + "|game_ready=" + ((button != null && button.interactable) ? "true" : "false");
		}
		return "QUALITY_OK";
	}

	private static string GradeLabel(int grade)
	{
		string[] array = new string[10] { "普通", "罕见", "稀有", "传说", "不朽", "至宝", "超凡", "天界", "神圣", "宇宙" };
		if (grade < 0 || grade >= array.Length)
		{
			return "未知 (" + grade + ")";
		}
		return array[grade] + " (" + grade + ")";
	}

	private string ExecuteSynthAction(int maxGrade, bool excludeInscriptionScrolls, bool excludeOfferingCoins, string expectedOperation)
	{
		if (RuntimeMonitor.IsCorrosionActionPending() || SynthesisActionMonitor.IsPending())
		{
			return "ACTION_PENDING";
		}
		string text = InventoryOperationGate.Readiness();
		if (text != "READY")
		{
			AutoApiPlugin.Logger.LogWarning("[腐蚀等待] 库存尚未结算，取消本轮提交：" + text);
			return "INVENTORY_NOT_READY:" + text;
		}
		UI_Cube uI_Cube = UnityEngine.Object.FindObjectOfType<UI_Cube>(includeInactive: true);
		if (uI_Cube == null || !uI_Cube.gameObject.activeInHierarchy)
		{
			return "NO_UI";
		}
		if (maxGrade < 0 || maxGrade > 9)
		{
			AutoApiPlugin.Logger.LogWarning("[安全锁] 拒绝执行：品质上限无效 " + maxGrade + "。");
			return "INVALID_MAX_GRADE";
		}
		if (expectedOperation != "corrosion" && expectedOperation != "synthesis")
		{
			return "OPERATION_REQUIRED";
		}
		MainRecipeSlotButton mainRecipeSlotButton = ((uI_Cube.m_mainRecipeToggleBtn != null) ? CorrosionRecipeSelector.Find(uI_Cube, uI_Cube.m_mainRecipeToggleBtn, expectedOperation) : null);
		if (mainRecipeSlotButton == null || !mainRecipeSlotButton.m_isSelected)
		{
			return "WRONG_OPERATION";
		}
		if (expectedOperation == "corrosion" && TryFindExcludedCorrosionMaterial(uI_Cube, excludeInscriptionScrolls, excludeOfferingCoins, out var slotIndex, out var itemKey, out var itemName, out var exclusion))
		{
			AutoApiPlugin.Logger.LogWarning("[腐蚀排除项] 最终执行校验发现" + exclusion + "：" + itemName + "，槽位=" + slotIndex.ToString(CultureInfo.InvariantCulture) + "，ItemKey=" + itemKey.ToString(CultureInfo.InvariantCulture) + "；先退回后继续当前批次。");
			return "NEEDS_EXCLUSION";
		}
		bool isEnabled = false;
		if (!SlotsWithinGradeLimit(uI_Cube, maxGrade, out var offender, out var itemCount))
		{
			ManualLogSource logger = AutoApiPlugin.Logger;
			BepInExWarningLogInterpolatedStringHandler bepInExWarningLogInterpolatedStringHandler = new BepInExWarningLogInterpolatedStringHandler(28, 1, out isEnabled);
			if (isEnabled)
			{
				bepInExWarningLogInterpolatedStringHandler.AppendLiteral("⚠\ufe0f [安全锁拦截] 发现违规物品: ");
				bepInExWarningLogInterpolatedStringHandler.AppendFormatted(offender);
				bepInExWarningLogInterpolatedStringHandler.AppendLiteral("！已终止本次合成。");
			}
			logger.LogWarning(bepInExWarningLogInterpolatedStringHandler);
			return "EXCEED_MAX_GRADE";
		}
		if (!CubeBatchPolicy.IsValidCount(expectedOperation, itemCount))
		{
			ManualLogSource logger2 = AutoApiPlugin.Logger;
			BepInExInfoLogInterpolatedStringHandler bepInExInfoLogInterpolatedStringHandler = new BepInExInfoLogInterpolatedStringHandler(20, 1, out isEnabled);
			if (isEnabled)
			{
				bepInExInfoLogInterpolatedStringHandler.AppendLiteral("[腐蚀] 物品格数不符，当前 ");
				bepInExInfoLogInterpolatedStringHandler.AppendFormatted(itemCount);
				bepInExInfoLogInterpolatedStringHandler.AppendLiteral("/9，跳过执行");
			}
			logger2.LogInfo(bepInExInfoLogInterpolatedStringHandler);
			return "NOT_ENOUGH";
		}
		AutoApiPlugin.Logger.LogInfo("[安全锁] 品质校验通过：" + itemCount + "/" + 9 + " 件，逐格品质均≤" + GradeLabel(maxGrade) + "；未知物品一律拦截。");
		if (uI_Cube.toggleButton_Trigger != null)
		{
			Button button = InnerButton(uI_Cube.toggleButton_Trigger);
			if (button == null || !button.interactable)
			{
				return "GAME_NOT_READY";
			}
			string text2 = InventoryOperationGate.TryBeginHelperAction();
			if (text2 != "READY")
			{
				return text2;
			}
			float num = Time.unscaledTime - _lastSynthActionTime;
			float num2 = InventoryOperationGate.ClickGapSeconds;
			if (num < num2)
			{
				AutoApiPlugin.Logger.LogWarning("[腐蚀节流] 距上次魔方执行仅 " + num.ToString("0.0") + " 秒；需要至少 " + num2 + " 秒，已拒绝重复请求。");
				return "RATE_LIMITED";
			}
			_lastSynthActionTime = Time.unscaledTime;
			MainRecipeSlotButton mainRecipeSlotButton2 = ((uI_Cube.m_mainRecipeToggleBtn != null) ? CorrosionRecipeSelector.Find(uI_Cube, uI_Cube.m_mainRecipeToggleBtn) : null);
			if (mainRecipeSlotButton2 != null && mainRecipeSlotButton2.m_isSelected)
			{
				RuntimeMonitor.BeginCorrosionAction();
			}
			else
			{
				SynthesisActionMonitor.Begin();
			}
			ClickGameObject(uI_Cube.toggleButton_Trigger.gameObject, "确认执行合成");
			AutoApiPlugin.Logger.LogInfo("[腐蚀] 已触发魔方执行按钮。");
			return "SUCCESS";
		}
		return "FAILED";
	}

	private static bool TryFindExcludedCorrosionMaterial(UI_Cube cube, bool excludeInscriptionScrolls, bool excludeOfferingCoins, out int slotIndex, out int itemKey, out string itemName, out string exclusion)
	{
		slotIndex = -1;
		itemKey = 0;
		itemName = "";
		exclusion = "";
		CubeSlotSetter cubeSlotSetter = ((cube != null) ? cube.m_cubeSlotSetter : null);
		Il2CppSystem.Collections.Generic.List<CubeInventorySlot> list = ((cubeSlotSetter != null) ? cubeSlotSetter.m_cubeInventorySlots : null);
		if (list == null)
		{
			return false;
		}
		for (int i = 0; i < list.Count; i++)
		{
			CubeInventorySlot cubeInventorySlot = list[i];
			if (!(cubeInventorySlot == null) && cubeInventorySlot._cubeData != null)
			{
				int num;
				try
				{
					num = CubeItemKey(cubeInventorySlot._cubeData);
				}
				catch
				{
					continue;
				}
				if (num > 0 && IsExcludedCorrosionMaterial(cubeInventorySlot._cubeData, excludeInscriptionScrolls, excludeOfferingCoins, out var itemName2, out var exclusion2))
				{
					slotIndex = i;
					itemKey = num;
					itemName = itemName2;
					exclusion = exclusion2;
					return true;
				}
			}
		}
		return false;
	}

	private static bool IsExcludedCorrosionMaterial(CubeInData data, bool excludeInscriptionScrolls, bool excludeOfferingCoins, out string itemName, out string exclusion)
	{
		itemName = "";
		exclusion = "";
		if (data == null)
		{
			return false;
		}
		return RuntimeMonitor.IsExcludedCorrosionItemKey(CubeItemKey(data), excludeInscriptionScrolls, excludeOfferingCoins, out itemName, out exclusion);
	}

	private void EnsureGradeMap()
	{
		int num = ((_gradeByItemKey != null) ? _gradeByItemKey.Count : 0);
		System.Collections.Generic.List<ItemInfoData> list = null;
		try
		{
			list = ItemInfoList();
		}
		catch (Exception ex)
		{
			ManualLogSource logger = AutoApiPlugin.Logger;
			bool isEnabled = false;
			BepInExWarningLogInterpolatedStringHandler bepInExWarningLogInterpolatedStringHandler = new BepInExWarningLogInterpolatedStringHandler(12, 1, out isEnabled);
			if (isEnabled)
			{
				bepInExWarningLogInterpolatedStringHandler.AppendLiteral("游戏内存数据读取失败: ");
				bepInExWarningLogInterpolatedStringHandler.AppendFormatted(ex.Message);
			}
			logger.LogWarning(bepInExWarningLogInterpolatedStringHandler);
		}
		if (list == null || list.Count == 0)
		{
			if (_gradeByItemKey == null || _gradeByItemKey.Count == 0)
			{
				AutoApiPlugin.Logger.LogWarning("[安全锁] 物品品质映射为空，未知物品仍会被拦截。");
			}
			return;
		}
		if (_gradeByItemKey == null)
		{
			_gradeByItemKey = new System.Collections.Generic.Dictionary<int, int>();
		}
		for (int i = 0; i < list.Count; i++)
		{
			if (list[i] != null)
			{
				_gradeByItemKey[list[i].ItemKey] = (int)list[i].GRADE;
			}
		}
		if (_gradeByItemKey.Count > num)
		{
			AutoApiPlugin.Logger.LogInfo("[安全锁] 品质映射已补充：" + num + " -> " + _gradeByItemKey.Count + " 个 ItemKey。");
		}
	}

	private bool SlotsWithinGradeLimit(UI_Cube cube, int limitGrade, out string offender, out int itemCount)
	{
		offender = null;
		itemCount = 0;
		CubeSlotSetter cubeSlotSetter = cube.m_cubeSlotSetter;
		Il2CppSystem.Collections.Generic.List<CubeInventorySlot> list = ((cubeSlotSetter != null) ? cubeSlotSetter.m_cubeInventorySlots : null);
		if (list == null)
		{
			return true;
		}
		EnsureGradeMap();
		bool flag = false;
		for (int i = 0; i < list.Count; i++)
		{
			CubeInventorySlot cubeInventorySlot = list[i];
			if (cubeInventorySlot == null || cubeInventorySlot._cubeData == null)
			{
				continue;
			}
			int num = 0;
			try
			{
				num = CubeItemKey(cubeInventorySlot._cubeData);
			}
			catch
			{
				continue;
			}
			if (num <= 0)
			{
				continue;
			}
			itemCount++;
			if (_gradeByItemKey == null || !_gradeByItemKey.TryGetValue(num, out var value))
			{
				if (!flag)
				{
					EnsureGradeMap();
					flag = true;
				}
				if (_gradeByItemKey == null || !_gradeByItemKey.TryGetValue(num, out value))
				{
					string value2 = RuntimeMonitor.ResolveItemNameByKey(num);
					offender = (string.IsNullOrWhiteSpace(value2) ? $"未知物品 (ID: {num})" : $"{value2} (ID: {num}，品质映射缺失)");
					return false;
				}
				if (value > limitGrade)
				{
					string text = RuntimeMonitor.ResolveItemNameByKey(num);
					offender = $"{(string.IsNullOrWhiteSpace(text) ? "未知物品" : text)} (ID: {num}) [品质 {value} > 设定上限 {limitGrade}]";
					return false;
				}
			}
			else if (value > limitGrade)
			{
				string text2 = RuntimeMonitor.ResolveItemNameByKey(num);
				offender = $"{(string.IsNullOrWhiteSpace(text2) ? "未知物品" : text2)} (ID: {num}) [品质 {value} > 设定上限 {limitGrade}]";
				return false;
			}
		}
		return true;
	}

	private bool ExecuteStoreScan()
	{
		UIManager uIManager = UnityEngine.Object.FindObjectOfType<UIManager>(includeInactive: true);
		if (uIManager == null || uIManager.Ui_NewStash == null || !uIManager.Ui_NewStash.gameObject.activeInHierarchy)
		{
			AutoApiPlugin.Logger.LogWarning("[深度探仓] 失败：仓库UI未打开！");
			return false;
		}
		Il2CppSystem.Collections.Generic.List<StashSlot> stashSlotList = uIManager.Ui_NewStash.m_stashSlotList;
		if (stashSlotList == null || stashSlotList.Count == 0)
		{
			return false;
		}
		ManualLogSource logger = AutoApiPlugin.Logger;
		bool isEnabled = false;
		BepInExInfoLogInterpolatedStringHandler bepInExInfoLogInterpolatedStringHandler = new BepInExInfoLogInterpolatedStringHandler(32, 1, out isEnabled);
		if (isEnabled)
		{
			bepInExInfoLogInterpolatedStringHandler.AppendLiteral("\n====== 开始深度探仓 (当前页总槽位: ");
			bepInExInfoLogInterpolatedStringHandler.AppendFormatted(stashSlotList.Count);
			bepInExInfoLogInterpolatedStringHandler.AppendLiteral(") ======");
		}
		logger.LogInfo(bepInExInfoLogInterpolatedStringHandler);
		for (int i = 0; i < Math.Min(3, stashSlotList.Count); i++)
		{
			StashSlot stashSlot = stashSlotList[i];
			if (stashSlot == null)
			{
				continue;
			}
			Type type = stashSlot.GetType();
			ManualLogSource logger2 = AutoApiPlugin.Logger;
			bepInExInfoLogInterpolatedStringHandler = new BepInExInfoLogInterpolatedStringHandler(27, 2, out isEnabled);
			if (isEnabled)
			{
				bepInExInfoLogInterpolatedStringHandler.AppendLiteral("\n>>> 正在剖析 槽位[");
				bepInExInfoLogInterpolatedStringHandler.AppendFormatted(i);
				bepInExInfoLogInterpolatedStringHandler.AppendLiteral("] (脚本类型: ");
				bepInExInfoLogInterpolatedStringHandler.AppendFormatted(type.Name);
				bepInExInfoLogInterpolatedStringHandler.AppendLiteral(") <<<");
			}
			logger2.LogInfo(bepInExInfoLogInterpolatedStringHandler);
			FieldInfo[] fields = type.GetFields(BindingFlags.DeclaredOnly | BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);
			foreach (FieldInfo fieldInfo in fields)
			{
				try
				{
					object value = fieldInfo.GetValue(stashSlot);
					ManualLogSource logger3 = AutoApiPlugin.Logger;
					bepInExInfoLogInterpolatedStringHandler = new BepInExInfoLogInterpolatedStringHandler(17, 3, out isEnabled);
					if (isEnabled)
					{
						bepInExInfoLogInterpolatedStringHandler.AppendLiteral("  [字段] ");
						bepInExInfoLogInterpolatedStringHandler.AppendFormatted(fieldInfo.Name);
						bepInExInfoLogInterpolatedStringHandler.AppendLiteral(" (类型: ");
						bepInExInfoLogInterpolatedStringHandler.AppendFormatted(fieldInfo.FieldType.Name);
						bepInExInfoLogInterpolatedStringHandler.AppendLiteral(") = ");
						bepInExInfoLogInterpolatedStringHandler.AppendFormatted(value ?? "null");
					}
					logger3.LogInfo(bepInExInfoLogInterpolatedStringHandler);
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
						object value2 = propertyInfo.GetValue(stashSlot, null);
						ManualLogSource logger4 = AutoApiPlugin.Logger;
						bepInExInfoLogInterpolatedStringHandler = new BepInExInfoLogInterpolatedStringHandler(17, 3, out isEnabled);
						if (isEnabled)
						{
							bepInExInfoLogInterpolatedStringHandler.AppendLiteral("  [属性] ");
							bepInExInfoLogInterpolatedStringHandler.AppendFormatted(propertyInfo.Name);
							bepInExInfoLogInterpolatedStringHandler.AppendLiteral(" (类型: ");
							bepInExInfoLogInterpolatedStringHandler.AppendFormatted(propertyInfo.PropertyType.Name);
							bepInExInfoLogInterpolatedStringHandler.AppendLiteral(") = ");
							bepInExInfoLogInterpolatedStringHandler.AppendFormatted(value2 ?? "null");
						}
						logger4.LogInfo(bepInExInfoLogInterpolatedStringHandler);
					}
				}
				catch
				{
				}
			}
		}
		AutoApiPlugin.Logger.LogInfo("\n================ 探仓结束 ================\n");
		return true;
	}

	private bool ExecuteStoreSort()
	{
		UIManager uIManager = UnityEngine.Object.FindObjectOfType<UIManager>(includeInactive: true);
		if (uIManager != null && uIManager.Ui_NewStash != null && uIManager.Ui_NewStash.gameObject.activeInHierarchy)
		{
			foreach (Button componentsInChild in uIManager.Ui_NewStash.GetComponentsInChildren<Button>(includeInactive: true))
			{
				string text = componentsInChild.name.ToLower();
				if (text.Contains("sort") || text.Contains("arrange") || text.Contains("clean"))
				{
					ClickGameObject(componentsInChild.gameObject, "【整理】当前页面");
					return true;
				}
			}
		}
		return false;
	}

	private bool ExecuteStoreDeposit()
	{
		UIManager uIManager = UnityEngine.Object.FindObjectOfType<UIManager>(includeInactive: true);
		if (uIManager != null && uIManager.Ui_NewStash != null && uIManager.Ui_NewStash.gameObject.activeInHierarchy && uIManager.Ui_NewStash.toggleButton_InventoryToStash != null)
		{
			ClickGameObject(uIManager.Ui_NewStash.toggleButton_InventoryToStash.gameObject, "【一键存入】物品");
			return true;
		}
		return false;
	}

	private bool ExecuteStorePage(int pageNum)
	{
		UIManager uIManager = UnityEngine.Object.FindObjectOfType<UIManager>(includeInactive: true);
		if (uIManager != null && uIManager.Ui_NewStash != null && uIManager.Ui_NewStash.gameObject.activeInHierarchy)
		{
			Transform transform = uIManager.Ui_NewStash.transform.Find("StashTab");
			int num = pageNum - 1;
			if (transform != null && num >= 0 && num < transform.childCount)
			{
				ClickGameObject(transform.GetChild(num).gameObject, $"切换仓库页 -> 第 {pageNum} 页");
				return true;
			}
		}
		return false;
	}

	private string ExecuteStoreCheckFull()
	{
		UIManager uIManager = UnityEngine.Object.FindObjectOfType<UIManager>(includeInactive: true);
		if (uIManager != null && uIManager.Ui_NewStash != null && uIManager.Ui_NewStash.gameObject.activeInHierarchy)
		{
			Il2CppSystem.Collections.Generic.List<StashSlot> stashSlotList = uIManager.Ui_NewStash.m_stashSlotList;
			if (stashSlotList == null || stashSlotList.Count == 0)
			{
				return "FAILED|store_slots_unavailable";
			}
			int num = 0;
			Type type = stashSlotList[0].GetType();
			PropertyInfo propertyInfo = null;
			PropertyInfo[] properties = type.GetProperties(BindingFlags.DeclaredOnly | BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);
			foreach (PropertyInfo propertyInfo2 in properties)
			{
				Type propertyType = propertyInfo2.PropertyType;
				if (propertyType.IsClass && propertyType.Name.Length <= 5 && propertyInfo2.Name.Length <= 5)
				{
					propertyInfo = propertyInfo2;
					break;
				}
			}
			for (int j = 0; j < stashSlotList.Count; j++)
			{
				if (!(stashSlotList[j] != null))
				{
					continue;
				}
				bool flag = false;
				if (propertyInfo != null)
				{
					try
					{
						if (propertyInfo.GetValue(stashSlotList[j], null) != null)
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
			bool isEnabled = false;
			BepInExInfoLogInterpolatedStringHandler bepInExInfoLogInterpolatedStringHandler = new BepInExInfoLogInterpolatedStringHandler(20, 1, out isEnabled);
			if (isEnabled)
			{
				bepInExInfoLogInterpolatedStringHandler.AppendLiteral("[仓库检测] 扫描完毕，当前剩余空位: ");
				bepInExInfoLogInterpolatedStringHandler.AppendFormatted(num);
			}
			logger.LogInfo(bepInExInfoLogInterpolatedStringHandler);
			if (num != 0)
			{
				return "HAS_SPACE";
			}
			return "FULL";
		}
		return "FAILED|store_window_not_open";
	}

	private bool ExecuteStoreOpen()
	{
		UIManager uIManager = UnityEngine.Object.FindObjectOfType<UIManager>(includeInactive: true);
		if (uIManager != null && uIManager.Ui_NewStash != null)
		{
			if (!uIManager.Ui_NewStash.gameObject.activeInHierarchy)
			{
				uIManager.Ui_NewStash.gameObject.SetActive(value: true);
			}
			return true;
		}
		return false;
	}

	private bool ExecuteStoreClose()
	{
		UIManager uIManager = UnityEngine.Object.FindObjectOfType<UIManager>(includeInactive: true);
		if (uIManager != null && uIManager.Ui_NewStash != null && uIManager.Ui_NewStash.gameObject.activeInHierarchy && uIManager.Ui_NewStash.button_Close != null)
		{
			ClickGameObject(uIManager.Ui_NewStash.button_Close.gameObject, "关闭仓库UI");
			return true;
		}
		return false;
	}

	private static string ChestKind(StageBox box)
	{
		return ChestSelectionPolicy.Kind((int)box.m_boxType, box.m_contentType == EContentType.PLAGUE);
	}

	private static bool ChestHasItems(StageBox box)
	{
		if (box == null || !box.gameObject.activeInHierarchy || box.m_boxButton == null || !box.m_boxButton.gameObject.activeInHierarchy)
		{
			return false;
		}
		Match match = Regex.Match(Regex.Replace(((box.countText != null) ? box.countText.text : "") ?? "", "<[^>]*>", ""), "\\d+");
		if (match.Success && int.TryParse(match.Value, out var result))
		{
			return result > 0;
		}
		return true;
	}

	private static string ReadChestCatalog()
	{
		SortedSet<string> sortedSet = new SortedSet<string>(StringComparer.Ordinal);
		foreach (StageBox item in UnityEngine.Object.FindObjectsOfType<StageBox>())
		{
			if (ChestHasItems(item) && !string.IsNullOrEmpty(ChestKind(item)))
			{
				sortedSet.Add(ChestKind(item));
			}
		}
		return "SUCCESS|kinds=" + string.Join(",", sortedSet);
	}

	private string ExecuteClickChest(string expectedType)
	{
		if (RuntimeMonitor.IsCorrosionActionPending() || SynthesisActionMonitor.IsPending())
		{
			return "ACTION_PENDING";
		}
		foreach (StageBox item in UnityEngine.Object.FindObjectsOfType<StageBox>())
		{
			if (!ChestHasItems(item) || !ChestSelectionPolicy.Matches(expectedType, ChestKind(item)))
			{
				continue;
			}
			MethodInfo methodInfo = null;
			MethodInfo[] methods = typeof(StageBox).GetMethods(BindingFlags.DeclaredOnly | BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);
			foreach (MethodInfo methodInfo2 in methods)
			{
				ParameterInfo[] parameters = methodInfo2.GetParameters();
				if (!(methodInfo2.ReturnType != typeof(void)) && parameters.Length == 1 && !(parameters[0].ParameterType != typeof(PointerEventData.InputButton)))
				{
					if (methodInfo != null)
					{
						return "FAILED|ambiguous_right_click_handler";
					}
					methodInfo = methodInfo2;
				}
			}
			if (methodInfo == null)
			{
				return "FAILED|right_click_handler_missing";
			}
			string text = InventoryOperationGate.TryBeginHelperAction();
			if (text != "READY")
			{
				return text;
			}
			methodInfo.Invoke(item, new object[1] { PointerEventData.InputButton.Right });
			InventoryOperationGate.MarkUiInventoryChange();
			string text2 = ChestKind(item);
			AutoApiPlugin.Logger.LogInfo("[开箱] 已调用游戏右键批量开箱入口：" + text2 + "，BoxType=" + item.m_boxType.ToString() + "，ContentType=" + item.m_contentType);
			return "SUCCESS|kind=" + text2 + "|mode=right";
		}
		return "EMPTY";
	}

	private void ClickGameObject(GameObject go, string name)
	{
		if (go == null)
		{
			return;
		}
		try
		{
			PointerEventData pointerEventData = new PointerEventData(EventSystem.current);
			if (ExecuteEvents.Execute(go, pointerEventData, ExecuteEvents.pointerClickHandler))
			{
				return;
			}
			Button component = go.GetComponent<Button>();
			if (component != null && component.onClick != null)
			{
				component.onClick.Invoke();
				return;
			}
			Toggle component2 = go.GetComponent<Toggle>();
			if (component2 != null)
			{
				component2.isOn = !component2.isOn;
			}
		}
		catch
		{
		}
	}
}
