using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using UAssetAPI.ExportTypes;

// Deterministic companion to Inspect for Blueprint values that only survive in compiled
// Kismet bytecode. UAssetAPI is accepted only when it can reproduce the source package
// byte-for-byte, matching the independent oracle used by AbpDump.
public static class KismetInspect
{
    public static int Run(string physicalPath, string outJson)
    {
        var asset = new UAssetAPI.UAsset(
            Path.GetFullPath(physicalPath),
            UAssetAPI.UnrealTypes.EngineVersion.VER_UE5_5);
        if (!asset.VerifyBinaryEquality())
            throw new Exception(
                $"{physicalPath} failed UAssetAPI binary-equality verification");

        var functions = new JObject();
        foreach (var function in asset.Exports
                     .OfType<FunctionExport>()
                     .OrderBy(
                         export => export.ObjectName.Value.Value,
                         StringComparer.Ordinal))
        {
            uint offset = 0;
            var expressions = new JArray();
            foreach (var expression in function.ScriptBytecode)
            {
                expressions.Add(new JObject
                {
                    ["offset"] = offset,
                    ["expression"] = JToken.Parse(
                        asset.SerializeJsonObject(
                            expression,
                            false)),
                });
                offset += expression.GetSize(asset);
            }
            functions[function.ObjectName.Value.Value] = expressions;
        }

        var payload = new JObject
        {
            ["schemaVersion"] = 1,
            ["source"] = new JObject
            {
                ["asset"] = Path.GetFileNameWithoutExtension(physicalPath),
                ["engineVersion"] = "UE5.5",
                ["parser"] = "UAssetAPI 1.1.0",
                ["binaryEqualityVerified"] = true,
            },
            ["functions"] = functions,
        };
        Directory.CreateDirectory(
            Path.GetDirectoryName(Path.GetFullPath(outJson))
            ?? throw new Exception($"invalid output path {outJson}"));
        File.WriteAllText(
            outJson,
            payload.ToString(Formatting.Indented) + "\n");
        Console.WriteLine(
            $"inspected {functions.Count} compiled functions from " +
            $"{physicalPath} -> {outJson}");
        return 0;
    }
}
