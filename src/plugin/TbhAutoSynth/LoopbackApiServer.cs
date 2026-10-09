using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading.Tasks;

namespace TbhAutoSynth;

internal sealed class LoopbackApiServer : IDisposable
{
	private readonly TcpListener _listener;

	private readonly Func<string, LocalApiResponse> _handler;

	private volatile bool _running = true;

	internal int Port => ((IPEndPoint)_listener.LocalEndpoint).Port;

	internal string InstanceId { get; } = Guid.NewGuid().ToString("N");

	internal LoopbackApiServer(Func<string, LocalApiResponse> handler, int preferredPort = 19090)
	{
		_handler = handler;
		_listener = BindAvailable(preferredPort);
		Task.Run((Action)AcceptLoop);
	}

	private static TcpListener BindAvailable(int preferredPort)
	{
		List<int> list = new List<int>();
		if (preferredPort >= 1024 && preferredPort <= 65535)
		{
			list.Add(preferredPort);
		}
		for (int i = 19090; i <= 19110; i++)
		{
			if (!list.Contains(i))
			{
				list.Add(i);
			}
		}
		list.Add(0);
		SocketException ex = null;
		foreach (int item in list)
		{
			TcpListener tcpListener = new TcpListener(IPAddress.Loopback, item);
			tcpListener.Server.ExclusiveAddressUse = true;
			try
			{
				tcpListener.Start(32);
				return tcpListener;
			}
			catch (SocketException ex2)
			{
				ex = ex2;
				tcpListener.Stop();
			}
		}
		throw ex ?? new SocketException();
	}

	private void AcceptLoop()
	{
		while (_running)
		{
			try
			{
				TcpClient client = _listener.AcceptTcpClient();
				Task.Run(() =>
				{
					Serve(client);
				});
			}
			catch (SocketException)
			{
				if (!_running)
				{
					break;
				}
			}
			catch (ObjectDisposedException)
			{
				break;
			}
		}
	}

	private void Serve(TcpClient client)
	{
		using (client)
		{
			try
			{
				client.ReceiveTimeout = 8000;
				client.SendTimeout = 8000;
				client.NoDelay = true;
				using NetworkStream networkStream = client.GetStream();
				using StreamReader streamReader = new StreamReader(networkStream, Encoding.ASCII, detectEncodingFromByteOrderMarks: false, 1024, leaveOpen: true);
				string text = streamReader.ReadLine() ?? "";
				int num = text.Length;
				bool flag = false;
				for (int i = 0; i < 64; i++)
				{
					string text2 = streamReader.ReadLine();
					if (text2 == null)
					{
						break;
					}
					if (text2.Length == 0)
					{
						flag = true;
						break;
					}
					num += text2.Length;
					if (num > 16384)
					{
						break;
					}
				}
				string[] array = text.Split(' ');
				LocalApiResponse localApiResponse;
				if (!flag || array.Length != 3 || array[0] != "GET")
				{
					localApiResponse = new LocalApiResponse(400, "INVALID_REQUEST");
				}
				else
				{
					localApiResponse = (array[1].StartsWith("/api/", StringComparison.Ordinal) ? _handler(array[1].Split('?')[0]) : new LocalApiResponse(404, "NOT_FOUND"));
				}
				byte[] bytes = Encoding.UTF8.GetBytes(localApiResponse.Body);
				byte[] bytes2 = Encoding.ASCII.GetBytes("HTTP/1.1 " + localApiResponse.Status + " Result\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: " + bytes.Length + "\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n");
				networkStream.Write(bytes2, 0, bytes2.Length);
				networkStream.Write(bytes, 0, bytes.Length);
			}
			catch (Exception)
			{
			}
		}
	}

	public void Dispose()
	{
		_running = false;
		_listener.Stop();
	}
}
