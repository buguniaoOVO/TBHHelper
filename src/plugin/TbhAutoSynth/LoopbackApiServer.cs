using System;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading.Tasks;

namespace TbhAutoSynth;

internal sealed class LocalApiResponse
{
    internal readonly int Status;
    internal readonly string Body;
    internal LocalApiResponse(int status, string body) { Status = status; Body = body ?? ""; }
}

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
        _ = Task.Run(AcceptLoop);
    }

    private static TcpListener BindAvailable(int preferredPort)
    {
        var candidates = new System.Collections.Generic.List<int>();
        if (preferredPort >= 1024 && preferredPort <= 65535) candidates.Add(preferredPort);
        for (int port = 19090; port <= 19110; port++) if (!candidates.Contains(port)) candidates.Add(port);
        candidates.Add(0);
        SocketException last = null;
        foreach (int port in candidates)
        {
            var listener = new TcpListener(IPAddress.Loopback, port);
            listener.Server.ExclusiveAddressUse = true;
            try { listener.Start(32); return listener; }
            catch (SocketException ex) { last = ex; listener.Stop(); }
        }
        throw last ?? new SocketException();
    }

    private void AcceptLoop()
    {
        while (_running)
        {
            try { var client = _listener.AcceptTcpClient(); _ = Task.Run(() => Serve(client)); }
            catch (SocketException) { if (!_running) return; }
            catch (ObjectDisposedException) { return; }
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
                using var stream = client.GetStream();
                using var reader = new StreamReader(stream, Encoding.ASCII, false, 1024, leaveOpen: true);
                string first = reader.ReadLine() ?? "";
                int headerLength = first.Length;
                bool completedHeaders = false;
                for (int line = 0; line < 64; line++)
                {
                    string header = reader.ReadLine();
                    if (header == null) break;
                    if (header.Length == 0) { completedHeaders = true; break; }
                    headerLength += header.Length;
                    if (headerLength > 16384) break;
                }
                string[] request = first.Split(' ');
                LocalApiResponse response;
                if (!completedHeaders || request.Length != 3 || request[0] != "GET")
                    response = new LocalApiResponse(400, "INVALID_REQUEST");
                else if (!request[1].StartsWith("/api/", StringComparison.Ordinal))
                    response = new LocalApiResponse(404, "NOT_FOUND");
                else response = _handler(request[1].Split('?')[0]);
                byte[] body = Encoding.UTF8.GetBytes(response.Body);
                byte[] headers = Encoding.ASCII.GetBytes("HTTP/1.1 " + response.Status + " Result\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: "
                    + body.Length + "\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n");
                stream.Write(headers, 0, headers.Length);
                stream.Write(body, 0, body.Length);
            }
            catch (Exception) { }
        }
    }

    public void Dispose() { _running = false; _listener.Stop(); }
}

internal static class ApiDiscoveryFile
{
    internal static string PathFor(int processId, string localAppData) =>
        Path.Combine(localAppData, "TBHHelper", "bridge", "game-" + processId + ".properties");

    internal static string Publish(int processId, int port, string instanceId, string hash, string version, int protocol,
        string localAppData)
    {
        string path = PathFor(processId, localAppData);
        Directory.CreateDirectory(Path.GetDirectoryName(path));
        string temp = path + "." + instanceId + ".tmp";
        File.WriteAllText(temp, "game_pid=" + processId + "\nport=" + port + "\ninstance_id=" + instanceId
            + "\nplugin_sha256=" + hash + "\nplugin_version=" + version + "\napi_protocol=" + protocol + "\n", new UTF8Encoding(false));
        File.Move(temp, path, overwrite: true);
        return path;
    }

    internal static void RemoveOwned(string path, string instanceId)
    {
        try { if (File.Exists(path) && File.ReadAllText(path).Contains("instance_id=" + instanceId + "\n")) File.Delete(path); }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
    }
}
