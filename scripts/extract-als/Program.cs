// Entry point for the ALS extraction tool — see Dump.cs (stage 1 rationale) and
// run.sh (the full chain). The stock CUE4Parse-Conversion exporters do not work
// on uncooked editor assets (no cooked render/compressed data), which is why this
// tool dumps editor-source properties to JSON instead of exporting directly.
if (args.Length >= 6 && args[0] == "dump")
    return Dump.Run(args[1], args[2], args[3], args[4], args[5], args[6..]);
if (args.Length == 3 && args[0] == "dump-abp")
    return AbpDump.Run(args[1], args[2]);
if (args.Length == 2 && args[0] == "validate-abp")
    return AbpDump.Validate(args[1]);
if (args.Length == 3 && args[0] == "dump-movement-settings")
    return MovementSettingsDump.Run(args[1], args[2]);
if (args.Length == 2 && args[0] == "validate-movement-settings")
    return MovementSettingsDump.Validate(args[1]);
if (args.Length == 3 && args[0] == "dump-character-settings")
    return CharacterSettingsDump.Run(args[1], args[2]);
if (args.Length == 2 && args[0] == "validate-character-settings")
    return CharacterSettingsDump.Validate(args[1]);
if (args.Length == 3 && args[0] == "dump-animation-settings")
    return AnimationInstanceSettingsDump.Run(args[1], args[2]);
if (args.Length == 2 && args[0] == "validate-animation-settings")
    return AnimationInstanceSettingsDump.Validate(args[1]);
if (args.Length == 3 && args[0] == "dump-skeleton-profiles")
    return SkeletonProfilesDump.Run(args[1], args[2]);
if (args.Length == 2 && args[0] == "validate-skeleton-profiles")
    return SkeletonProfilesDump.Validate(args[1]);
if (args.Length == 3 && args[0] == "dump-blend-spaces")
    return BlendSpaceDump.Run(args[1], args[2]);
if (args.Length == 2 && args[0] == "validate-blend-spaces")
    return BlendSpaceDump.Validate(args[1]);
if (args.Length == 3 && args[0] == "dump-input-mappings")
    return InputMappingDump.Run(args[1], args[2]);
if (args.Length == 2 && args[0] == "validate-input-mappings")
    return InputMappingDump.Validate(args[1]);
if (args.Length == 3 && args[0] == "dump-camera-content")
    return CameraContentDump.Run(args[1], args[2]);
if (args.Length == 2 && args[0] == "validate-camera-content")
    return CameraContentDump.Validate(args[1]);
if (args.Length == 3 && args[0] == "dump-grid-level-content")
    return GridLevelContentDump.Run(args[1], args[2]);
if (args.Length == 2 && args[0] == "validate-grid-level-content")
    return GridLevelContentDump.Validate(args[1]);
if (args.Length == 3 && args[0] == "dump-mantling-content")
    return MantlingContentDump.Run(args[1], args[2]);
if (args.Length == 2 && args[0] == "validate-mantling-content")
    return MantlingContentDump.Validate(args[1]);
if (args.Length == 3 && args[0] == "dump-action-content")
    return ActionContentDump.Run(args[1], args[2]);
if (args.Length == 2 && args[0] == "validate-action-content")
    return ActionContentDump.Validate(args[1]);
if (args.Length == 3 && args[0] == "dump-physics-asset")
    return PhysicsAssetDump.Run(args[1], args[2]);
if (args.Length == 2 && args[0] == "validate-physics-asset")
    return PhysicsAssetDump.Validate(args[1]);
if (args.Length == 4 && args[0] == "dump-footstep-audio")
    return FootstepAudioDump.Run(args[1], args[2], args[3]);
if (args.Length == 2 && args[0] == "validate-footstep-audio")
    return FootstepAudioDump.Validate(args[1]);
if (args.Length == 4 && args[0] == "inspect") return Inspect.Run(args[1], args[2], args[3]);
if (args.Length == 3 && args[0] == "inspect-kismet")
    return KismetInspect.Run(args[1], args[2]);
Console.Error.WriteLine(
    "usage: dotnet run -- dump <stage-dir> <out.json> <SkeletonName> <MeshName> " +
    "<MaterialInstanceName> [AnimName...]");
Console.Error.WriteLine("       dotnet run -- inspect <stage-dir> <AssetName> <out.json>");
Console.Error.WriteLine("       dotnet run -- dump-abp <stage-dir> <abp-graph.json>");
Console.Error.WriteLine("       dotnet run -- validate-abp <abp-graph.json>");
Console.Error.WriteLine(
    "       dotnet run -- dump-movement-settings <stage-dir> <movement-settings.json>");
Console.Error.WriteLine(
    "       dotnet run -- validate-movement-settings <movement-settings.json>");
Console.Error.WriteLine(
    "       dotnet run -- dump-character-settings <stage-dir> <character-settings.json>");
Console.Error.WriteLine(
    "       dotnet run -- validate-character-settings <character-settings.json>");
Console.Error.WriteLine(
    "       dotnet run -- dump-animation-settings <stage-dir> <animation-settings.json>");
Console.Error.WriteLine(
    "       dotnet run -- validate-animation-settings <animation-settings.json>");
Console.Error.WriteLine(
    "       dotnet run -- dump-skeleton-profiles <stage-dir> <skeleton-profiles.json>");
Console.Error.WriteLine(
    "       dotnet run -- validate-skeleton-profiles <skeleton-profiles.json>");
Console.Error.WriteLine(
    "       dotnet run -- dump-blend-spaces <stage-dir> <blend-spaces.json>");
Console.Error.WriteLine(
    "       dotnet run -- validate-blend-spaces <blend-spaces.json>");
Console.Error.WriteLine(
    "       dotnet run -- dump-input-mappings <stage-dir> <input-mappings.json>");
Console.Error.WriteLine(
    "       dotnet run -- validate-input-mappings <input-mappings.json>");
Console.Error.WriteLine(
    "       dotnet run -- dump-camera-content <stage-dir> <camera-content.json>");
Console.Error.WriteLine(
    "       dotnet run -- validate-camera-content <camera-content.json>");
Console.Error.WriteLine(
    "       dotnet run -- dump-grid-level-content <stage-dir> <grid-level-content.json>");
Console.Error.WriteLine(
    "       dotnet run -- validate-grid-level-content <grid-level-content.json>");
Console.Error.WriteLine(
    "       dotnet run -- dump-mantling-content <stage-dir> <mantling-content.json>");
Console.Error.WriteLine(
    "       dotnet run -- validate-mantling-content <mantling-content.json>");
Console.Error.WriteLine(
    "       dotnet run -- dump-action-content <stage-dir> <action-content.json>");
Console.Error.WriteLine(
    "       dotnet run -- validate-action-content <action-content.json>");
Console.Error.WriteLine(
    "       dotnet run -- dump-physics-asset <stage-dir> <physics-asset.json>");
Console.Error.WriteLine(
    "       dotnet run -- validate-physics-asset <physics-asset.json>");
Console.Error.WriteLine(
    "       dotnet run -- dump-footstep-audio <stage-dir> <clips.manifest> <footstep-audio.json>");
Console.Error.WriteLine(
    "       dotnet run -- validate-footstep-audio <footstep-audio.json>");
Console.Error.WriteLine(
    "       dotnet run -- inspect-kismet <Asset.uasset> <out.json>");
return 1;
