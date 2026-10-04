using System;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Net.Http;
using TbhAutoSynth;

static class PluginPolicyChecks
{
    static void Check(bool value, string description) { if (!value) throw new Exception(description); }
    static void Main(string[] args)
    {
        foreach (string name in new[] { "毒草", "蜘蛛丝", "猴牙", "雕刻材料", "Carving Material" })
            Check(!CubeBatchPolicy.TryGetCorrosionExclusion(name, true, true, out _), "Carving material excluded: " + name);
        Check(CubeBatchPolicy.TryGetCorrosionExclusion("不朽铭文卷轴", true, false, out _), "Scroll not protected");
        Check(CubeBatchPolicy.TryGetCorrosionExclusion("王国一周年纪念币", false, true, out _), "Coin not protected");
        Check(!CubeBatchPolicy.TryGetCorrosionExclusion("王国一周年纪念币", true, false, out _), "Coin toggle ignored");
        Check(!CubeBatchPolicy.TryGetCorrosionExclusion("不朽铭文卷轴", false, true, out _), "Scroll toggle ignored");
        Check(CubeBatchPolicy.IsValidCount("corrosion", 4), "Partial corrosion rejected");
        Check(!CubeBatchPolicy.IsValidCount("synthesis", 4), "Synthesis count weakened");
        for (int box = 0; box < 3; box++) foreach (bool plague in new[] { false, true })
        {
            string kind = ChestSelectionPolicy.Kind(box, plague);
            Check(ChestSelectionPolicy.Matches(box == 0 ? "white" : "blue", kind), "Missing chest variant: " + kind);
            Check(ChestSelectionPolicy.Matches(kind, kind), "Exact chest selection failed");
            Check(!ChestSelectionPolicy.Matches(box == 0 ? "blue" : "white", kind), "Chest group crossed");
        }
        using (var file = new StreamWriter(args[0]))
            for (int count = 0; count <= 10; count++) file.WriteLine(count + "\t" + CubeBatchPolicy.CorrosionFillStatus(count));
        var occupied = new TcpListener(IPAddress.Loopback, 0);
        occupied.Server.ExclusiveAddressUse = true;
        occupied.Start();
        int occupiedPort = ((IPEndPoint)occupied.LocalEndpoint).Port;
        using (var server = new LoopbackApiServer(path => new LocalApiResponse(200, "SUCCESS|中文响应"), occupiedPort))
        {
            Check(server.Port != occupiedPort, "Occupied port was reused");
            using var http = new HttpClient();
            string response = http.GetStringAsync("http://127.0.0.1:" + server.Port + "/api/game/status").GetAwaiter().GetResult();
            Check(response == "SUCCESS|中文响应", "Loopback HTTP response failed");
            string discovery = ApiDiscoveryFile.Publish(1234, server.Port, server.InstanceId, new string('a', 64), "1.3.58", 4,
                Path.Combine(Path.GetDirectoryName(args[0]), "discovery-test"));
            File.Copy(discovery, args[0] + ".bridge.properties", overwrite: true);
            ApiDiscoveryFile.RemoveOwned(discovery, "another-instance");
            Check(File.Exists(discovery), "Another instance removed active discovery data");
            ApiDiscoveryFile.RemoveOwned(discovery, server.InstanceId);
            Check(!File.Exists(discovery), "Owned discovery data was not removed");
        }
        occupied.Stop();
        Console.WriteLine("Plugin policies: carving retained, exclusions independent, six chest variants covered.");
        Console.WriteLine("Loopback server: occupied port fallback, UTF-8 HTTP and owned endpoint discovery passed.");
    }
}
