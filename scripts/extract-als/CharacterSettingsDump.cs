using CUE4Parse.FileProvider;
using CUE4Parse.UE4.Versions;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

// Freezes the shipped CS_Als_Default policy over UAlsCharacterSettings' C++ defaults. Tagged
// uassets omit default-valued fields, so both layers are required to reproduce the sample.
public static class CharacterSettingsDump
{
    const string SettingsAsset = "CS_Als_Default";
    const string CharacterSettingsPath = "/Content/ALS/Data/Character/";

    static readonly JsonSerializer Serializer = JsonSerializer.Create(
        new JsonSerializerSettings
        {
            ReferenceLoopHandling = ReferenceLoopHandling.Ignore,
        });

    public static int Run(string srcDir, string outJson)
    {
        var provider = new DefaultFileProvider(
            srcDir,
            SearchOption.AllDirectories,
            new VersionContainer(EGame.GAME_UE5_5));
        provider.Initialize();
        provider.Mount();

        var file = provider.Files.Values.SingleOrDefault(
                       candidate =>
                           candidate.NameWithoutExtension == SettingsAsset
                           && candidate.Extension == "uasset"
                           && candidate.Path
                               .Replace('\\', '/')
                               .Contains(
                                   CharacterSettingsPath,
                                   StringComparison.Ordinal))
                   ?? throw new Exception(
                       $"{SettingsAsset}.uasset was not found exactly once below " +
                       CharacterSettingsPath);
        var export = provider.LoadPackage(file)
                         .GetExports()
                         .SingleOrDefault(candidate => candidate.Name == SettingsAsset)
                     ?? throw new Exception($"{SettingsAsset} has no same-named export");
        var serializedExport = JObject.FromObject(export, Serializer);
        if (serializedExport.Value<string>("Type") != "AlsCharacterSettings")
            throw new Exception($"{SettingsAsset} is not an AlsCharacterSettings export");
        var overrides = serializedExport["Properties"] as JObject ?? new JObject();

        // Defaults are pinned to Source/ALS/Public/Settings/AlsCharacterSettings.h in 4.15.
        // Any non-default tagged value below is read directly from CS_Als_Default.
        var settings = new JObject
        {
            ["TeleportDistanceThreshold"] =
                overrides.Value<double?>("TeleportDistanceThreshold") ?? 50.0,
            ["MovingSpeedThreshold"] =
                overrides.Value<double?>("MovingSpeedThreshold") ?? 50.0,
            ["InAirRotationMode"] = NormalizeEnum(
                overrides.Value<string>("InAirRotationMode")
                ?? "EAlsInAirRotationMode::RotateToVelocityOnJump"),
            ["bAllowAimingWhenInAir"] =
                overrides.Value<bool?>("bAllowAimingWhenInAir") ?? true,
            ["bSprintHasPriorityOverAiming"] =
                overrides.Value<bool?>("bSprintHasPriorityOverAiming") ?? false,
            ["bRotateToVelocityWhenSprinting"] =
                overrides.Value<bool?>("bRotateToVelocityWhenSprinting") ?? false,
            ["bInheritMovementBaseRotationInVelocityDirectionRotationMode"] =
                overrides.Value<bool?>(
                    "bInheritMovementBaseRotationInVelocityDirectionRotationMode")
                ?? false,
            ["bRotateTowardsDesiredVelocityInVelocityDirectionRotationMode"] =
                overrides.Value<bool?>(
                    "bRotateTowardsDesiredVelocityInVelocityDirectionRotationMode")
                ?? true,
            ["bAutoRotateOnAnyInputWhileNotMovingInViewDirectionRotationMode"] =
                overrides.Value<bool?>(
                    "bAutoRotateOnAnyInputWhileNotMovingInViewDirectionRotationMode")
                ?? true,
        };

        var payload = new JObject
        {
            ["schemaVersion"] = 1,
            ["source"] = new JObject
            {
                ["engineVersion"] = "UE5.5",
                ["referenceRelease"] = "ALS Refactored 4.15",
                ["settingsAssetPath"] = file.Path,
                ["cppDefaults"] =
                    "Source/ALS/Public/Settings/AlsCharacterSettings.h",
                ["consumer"] = "Source/ALS/Private/AlsCharacter.cpp",
            },
            ["settings"] = settings,
            ["serializedOverrides"] = overrides.DeepClone(),
        };
        var validations = ValidatePayload(payload);
        payload["validations"] = validations;

        Directory.CreateDirectory(
            Path.GetDirectoryName(Path.GetFullPath(outJson))
            ?? throw new Exception($"invalid output path {outJson}"));
        File.WriteAllText(outJson, payload.ToString(Formatting.Indented) + "\n");

        PrintValidations(validations);
        ThrowOnValidationFailure(validations);
        Console.WriteLine(
            $"dumped {SettingsAsset} character policy -> {outJson} " +
            $"({new FileInfo(outJson).Length:N0} bytes)");
        return 0;
    }

    public static int Validate(string settingsJson)
    {
        var payload = JObject.Parse(File.ReadAllText(settingsJson));
        var validations = ValidatePayload(payload);
        PrintValidations(validations);
        ThrowOnValidationFailure(validations);
        Console.WriteLine($"validated {settingsJson}");
        return 0;
    }

    static string NormalizeEnum(string value)
    {
        var separator = value.LastIndexOf("::", StringComparison.Ordinal);
        return separator >= 0 ? value[(separator + 2)..] : value;
    }

    static JArray ValidatePayload(JObject payload)
    {
        var errors = new JArray();
        var settings = payload["settings"] as JObject ?? new JObject();
        ExpectNumber(errors, settings, "TeleportDistanceThreshold", 50);
        ExpectNumber(errors, settings, "MovingSpeedThreshold", 50);
        ExpectValue(errors, settings, "InAirRotationMode", "KeepRelativeRotation");
        ExpectValue(errors, settings, "bAllowAimingWhenInAir", true);
        ExpectValue(errors, settings, "bSprintHasPriorityOverAiming", true);
        ExpectValue(errors, settings, "bRotateToVelocityWhenSprinting", true);
        ExpectValue(
            errors,
            settings,
            "bInheritMovementBaseRotationInVelocityDirectionRotationMode",
            false);
        ExpectValue(
            errors,
            settings,
            "bRotateTowardsDesiredVelocityInVelocityDirectionRotationMode",
            true);
        ExpectValue(
            errors,
            settings,
            "bAutoRotateOnAnyInputWhileNotMovingInViewDirectionRotationMode",
            true);

        var overrides = payload["serializedOverrides"] as JObject ?? new JObject();
        ExpectValue(
            errors,
            overrides,
            "InAirRotationMode",
            "EAlsInAirRotationMode::KeepRelativeRotation");
        ExpectValue(errors, overrides, "bSprintHasPriorityOverAiming", true);
        ExpectValue(errors, overrides, "bRotateToVelocityWhenSprinting", true);
        if (overrides["TeleportDistanceThreshold"] is not null)
            errors.Add("TeleportDistanceThreshold must inherit its 50 cm C++ default");
        if (overrides["MovingSpeedThreshold"] is not null)
            errors.Add("MovingSpeedThreshold must inherit its 50 cm/s C++ default");

        return new JArray
        {
            new JObject
            {
                ["id"] = "cs-als-default-character-policy",
                ["passed"] = errors.Count == 0,
                ["values"] = new JObject
                {
                    ["settingCount"] = settings.Count,
                    ["serializedOverrideCount"] = overrides.Count,
                    ["errors"] = errors,
                },
            },
        };
    }

    static void ExpectNumber(
        JArray errors,
        JObject values,
        string name,
        double expected)
    {
        var actual = values.Value<double?>(name);
        if (actual != expected)
            errors.Add($"{name}: expected {expected}, got {actual?.ToString() ?? "<missing>"}");
    }

    static void ExpectValue<T>(
        JArray errors,
        JObject values,
        string name,
        T expected)
    {
        var token = values[name];
        if (token is null || !JToken.DeepEquals(token, JToken.FromObject(expected!)))
            errors.Add($"{name}: expected {expected}, got {token?.ToString() ?? "<missing>"}");
    }

    static void PrintValidations(JArray validations)
    {
        foreach (var validation in validations.OfType<JObject>())
        {
            Console.WriteLine(
                $"validation {(validation.Value<bool>("passed") ? "PASS" : "FAIL")}: " +
                validation.Value<string>("id"));
        }
    }

    static void ThrowOnValidationFailure(JArray validations)
    {
        var failed = validations
            .OfType<JObject>()
            .Where(validation => !validation.Value<bool>("passed"))
            .Select(validation => validation.Value<string>("id"))
            .ToArray();
        if (failed.Length > 0)
        {
            throw new Exception(
                $"character settings validation failed: {string.Join(", ", failed)}");
        }
    }
}
