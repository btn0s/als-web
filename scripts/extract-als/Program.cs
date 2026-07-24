// Entry point for the ALS extraction tool — see Dump.cs (stage 1 rationale) and
// run.sh (the full chain). The stock CUE4Parse-Conversion exporters do not work
// on uncooked editor assets (no cooked render/compressed data), which is why this
// tool dumps editor-source properties to JSON instead of exporting directly.
if (args.Length >= 6 && args[0] == "dump")
    return Dump.Run(args[1], args[2], args[3], args[4], args[5], args[6..]);
if (args.Length == 4 && args[0] == "inspect") return Inspect.Run(args[1], args[2], args[3]);
Console.Error.WriteLine(
    "usage: dotnet run -- dump <stage-dir> <out.json> <SkeletonName> <MeshName> " +
    "<MaterialInstanceName> [AnimName...]");
Console.Error.WriteLine("       dotnet run -- inspect <stage-dir> <AssetName> <out.json>");
return 1;
