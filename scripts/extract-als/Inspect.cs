using CUE4Parse.FileProvider;
using CUE4Parse.UE4.Versions;
using Newtonsoft.Json;

// Diagnostic companion for freezing otherwise opaque Blueprint/material facts
// into the extraction pipeline. It serializes every export CUE4Parse can decode;
// callers can then search the JSON without relying on unordered binary strings.
public static class Inspect
{
    public static int Run(string srcDir, string assetName, string outJson)
    {
        var provider = new DefaultFileProvider(
            srcDir,
            SearchOption.AllDirectories,
            new VersionContainer(EGame.GAME_UE5_5));
        provider.Initialize();
        provider.Mount();

        var file = provider.Files.Values.FirstOrDefault(
                       candidate =>
                           candidate.NameWithoutExtension == assetName &&
                           candidate.Extension == "uasset")
                   ?? throw new Exception($"{assetName}.uasset not found");
        var exports = provider.LoadPackage(file).GetExports().ToArray();
        File.WriteAllText(
            outJson,
            JsonConvert.SerializeObject(
                exports,
                Formatting.Indented,
                new JsonSerializerSettings
                {
                    ReferenceLoopHandling = ReferenceLoopHandling.Ignore,
                }));
        Console.WriteLine($"inspected {exports.Length} exports from {file.Path} -> {outJson}");
        return 0;
    }
}
