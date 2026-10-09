namespace TbhAutoSynth;

internal sealed class LocalApiResponse
{
	internal readonly int Status;

	internal readonly string Body;

	internal LocalApiResponse(int status, string body)
	{
		Status = status;
		Body = body ?? "";
	}
}
