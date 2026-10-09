using System;
using System.IO;
using System.Text;

namespace TbhAutoSynth;

internal static class ApiDiscoveryFile
{
	internal static string PathFor(int processId, string localAppData)
	{
		return Path.Combine(localAppData, "TBHHelper", "bridge", "game-" + processId + ".properties");
	}

	internal static string Publish(int processId, int port, string instanceId, string hash, string version, int protocol, string localAppData)
	{
		string text = PathFor(processId, localAppData);
		Directory.CreateDirectory(Path.GetDirectoryName(text));
		string text2 = text + "." + instanceId + ".tmp";
		File.WriteAllText(text2, "game_pid=" + processId + "\nport=" + port + "\ninstance_id=" + instanceId + "\nplugin_sha256=" + hash + "\nplugin_version=" + version + "\napi_protocol=" + protocol + "\n", new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));
		File.Move(text2, text, overwrite: true);
		return text;
	}

	internal static void RemoveOwned(string path, string instanceId)
	{
		try
		{
			if (File.Exists(path) && File.ReadAllText(path).Contains("instance_id=" + instanceId + "\n"))
			{
				File.Delete(path);
			}
		}
		catch (IOException)
		{
		}
		catch (UnauthorizedAccessException)
		{
		}
	}
}
