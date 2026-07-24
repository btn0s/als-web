using CUE4Parse.FileProvider;
using CUE4Parse.UE4.Versions;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

// Freezes ALS's movement data asset and every curve it references into one
// deterministic, editor-free content oracle. Values remain in Unreal's native
// units so consumers choose the world-unit conversion at their own boundary.
public static class MovementSettingsDump
{
    const string SettingsAsset = "MS_Als_Normal";
    const string MovementPath = "/Content/ALS/Data/Character/Movement/";

    static readonly string[] ExpectedRotationModes =
    [
        "Als.RotationMode.VelocityDirection",
        "Als.RotationMode.ViewDirection",
        "Als.RotationMode.Aiming",
    ];

    static readonly string[] ExpectedStances =
    [
        "Als.Stance.Standing",
        "Als.Stance.Crouching",
    ];

    static readonly string[] ExpectedCurves =
    [
        "CF_Als_RotationInterpolationSpeed_Normal",
        "CF_Als_RotationInterpolationSpeed_Responsive",
        "CV_Als_AccelerationAndDecelerationAndGroundFriction_Normal",
        "CV_Als_AccelerationAndDecelerationAndGroundFriction_Responsive",
    ];

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

        var (settingsPath, settingsExport) = LoadExport(provider, SettingsAsset);
        if (settingsExport.Value<string>("Type") != "AlsMovementSettings")
            throw new Exception($"{SettingsAsset} is not an AlsMovementSettings export");
        var serializedSettings = settingsExport["Properties"] as JObject
                                 ?? throw new Exception($"{SettingsAsset} has no properties");
        var rotationModes = NormalizeRotationModes(serializedSettings);

        var referencedCurveNames = rotationModes.Properties()
            .SelectMany(mode => ((JObject)mode.Value["stances"]!).Properties())
            .SelectMany(
                stance =>
                new string?[]
                {
                    stance.Value.Value<string>(
                        "AccelerationAndDecelerationAndGroundFrictionCurve"),
                    stance.Value.Value<string>("RotationInterpolationSpeedCurve"),
                })
            .Where(name => !string.IsNullOrEmpty(name))
            .Select(name => name!)
            .Distinct(StringComparer.Ordinal)
            .Order(StringComparer.Ordinal)
            .ToArray();

        var curves = new JObject();
        foreach (var curveName in referencedCurveNames)
        {
            var (assetPath, curveExport) = LoadExport(provider, curveName);
            curves[curveName] = NormalizeCurve(assetPath, curveExport);
        }

        var payload = new JObject
        {
            ["schemaVersion"] = 1,
            ["source"] = new JObject
            {
                ["engineVersion"] = "UE5.5",
                ["referenceRelease"] = "ALS Refactored 4.15",
                ["settingsAssetPath"] = settingsPath,
                ["cppDefaults"] =
                    "Source/ALS/Public/Settings/AlsMovementSettings.h",
                ["curveConsumption"] =
                    "Source/ALS/Private/AlsCharacterMovementComponent.cpp",
            },
            ["settings"] = new JObject
            {
                ["asset"] = SettingsAsset,
                ["nativeSpeedUnit"] = "cm/s",
                ["VelocityAngleToSpeedInterpolationRange"] = new JArray(100.0, 125.0),
                ["rotationModes"] = rotationModes,
            },
            ["curves"] = curves,
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
            $"dumped {rotationModes.Count} rotation modes and {curves.Count} movement curves " +
            $"-> {outJson} ({new FileInfo(outJson).Length:N0} bytes)");
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

    static (string AssetPath, JObject Export) LoadExport(
        DefaultFileProvider provider,
        string assetName)
    {
        var file = provider.Files.Values.SingleOrDefault(
                       candidate =>
                           candidate.NameWithoutExtension == assetName
                           && candidate.Extension == "uasset"
                           && candidate.Path
                               .Replace('\\', '/')
                               .Contains(MovementPath, StringComparison.Ordinal))
                   ?? throw new Exception(
                       $"{assetName}.uasset was not found exactly once below {MovementPath}");
        var export = provider.LoadPackage(file)
                         .GetExports()
                         .FirstOrDefault(candidate => candidate.Name == assetName)
                     ?? throw new Exception($"{assetName} has no same-named export");
        return (file.Path, JObject.FromObject(export, Serializer));
    }

    static JObject NormalizeRotationModes(JObject serializedSettings)
    {
        var serializedModes = serializedSettings["RotationModes"] as JArray
                              ?? throw new Exception(
                                  $"{SettingsAsset}.RotationModes is not an array");
        var rotationModes = new JObject();
        foreach (var serializedMode in serializedModes.OfType<JObject>())
        {
            var modeName = serializedMode.SelectToken("Key.TagName")?.Value<string>()
                           ?? throw new Exception("movement rotation mode has no gameplay tag");
            var serializedStances = serializedMode.SelectToken("Value.Stances") as JArray
                                    ?? throw new Exception(
                                        $"{modeName} has no serialized stances");
            var stances = new JObject();
            foreach (var serializedStance in serializedStances.OfType<JObject>())
            {
                var stanceName =
                    serializedStance.SelectToken("Key.TagName")?.Value<string>()
                    ?? throw new Exception($"{modeName} stance has no gameplay tag");
                var gait = serializedStance["Value"] as JObject
                           ?? throw new Exception($"{modeName}.{stanceName} has no gait settings");
                stances[stanceName] = new JObject
                {
                    // This default-valued bit is absent from the tagged asset and comes from
                    // FAlsMovementGaitSettings in AlsMovementSettings.h.
                    ["bAllowDirectionDependentMovementSpeed"] =
                        gait.Value<bool?>("bAllowDirectionDependentMovementSpeed") ?? false,
                    ["WalkForwardSpeed"] = RequiredNumber(gait, "WalkForwardSpeed"),
                    ["WalkBackwardSpeed"] = RequiredNumber(gait, "WalkBackwardSpeed"),
                    ["RunForwardSpeed"] = RequiredNumber(gait, "RunForwardSpeed"),
                    ["RunBackwardSpeed"] = RequiredNumber(gait, "RunBackwardSpeed"),
                    ["SprintSpeed"] = RequiredNumber(gait, "SprintSpeed"),
                    ["AccelerationAndDecelerationAndGroundFrictionCurve"] =
                        ReadReferenceName(
                            gait,
                            "AccelerationAndDecelerationAndGroundFrictionCurve"),
                    ["RotationInterpolationSpeedCurve"] =
                        ReadReferenceName(gait, "RotationInterpolationSpeedCurve"),
                };
            }
            rotationModes[modeName] = new JObject
            {
                ["stances"] = stances,
            };
        }

        return rotationModes;
    }

    static JValue RequiredNumber(JObject obj, string propertyName)
    {
        return obj[propertyName]?.Type is JTokenType.Float or JTokenType.Integer
            ? new JValue(obj.Value<double>(propertyName))
            : throw new Exception($"{propertyName} is missing or not numeric");
    }

    static string ReadReferenceName(JObject gait, string propertyName)
    {
        var objectName = gait.SelectToken($"{propertyName}.ObjectName")?.Value<string>()
                         ?? throw new Exception($"{propertyName} has no ObjectName");
        var firstQuote = objectName.IndexOf('\'');
        var lastQuote = objectName.LastIndexOf('\'');
        if (firstQuote < 0 || lastQuote <= firstQuote + 1)
            throw new Exception($"{propertyName} has malformed ObjectName {objectName}");
        return objectName[(firstQuote + 1)..lastQuote];
    }

    static JObject NormalizeCurve(string assetPath, JObject curveExport)
    {
        var type = curveExport.Value<string>("Type")
                   ?? throw new Exception($"{assetPath} has no export type");
        var properties = curveExport["Properties"] as JObject
                         ?? throw new Exception($"{assetPath} has no properties");
        var channels = new JObject();

        if (type == "CurveFloat")
        {
            channels["RotationInterpolationSpeed"] = NormalizeChannel(
                properties.SelectToken("FloatCurve.Keys") as JArray,
                0);
        }
        else if (type == "CurveVector")
        {
            channels["MaxAccelerationWalking"] =
                NormalizeChannel(
                    properties.SelectToken("FloatCurves.Keys") as JArray,
                    0);
            channels["BrakingDecelerationWalking"] =
                NormalizeChannel(
                    properties.SelectToken("['FloatCurves[1]'].Keys") as JArray,
                    1);
            channels["GroundFriction"] =
                NormalizeChannel(
                    properties.SelectToken("['FloatCurves[2]'].Keys") as JArray,
                    2);
        }
        else
        {
            throw new Exception($"{assetPath} has unsupported curve type {type}");
        }

        return new JObject
        {
            ["assetPath"] = assetPath,
            ["type"] = type,
            ["channels"] = channels,
        };
    }

    static JObject NormalizeChannel(JArray? keys, int sourceIndex)
    {
        if (keys is null)
            throw new Exception($"curve channel {sourceIndex} has no rich-curve keys");
        return new JObject
        {
            ["sourceIndex"] = sourceIndex,
            ["keys"] = keys.DeepClone(),
        };
    }

    static JArray ValidatePayload(JObject payload)
    {
        var validations = new JArray();
        validations.Add(ValidateSettings(payload));
        validations.Add(ValidateCurves(payload));
        return validations;
    }

    static JObject ValidateSettings(JObject payload)
    {
        var errors = new JArray();
        var rotationModes = payload.SelectToken("settings.rotationModes") as JObject
                            ?? new JObject();
        ValidateNameSet(
            errors,
            "rotation modes",
            rotationModes.Properties().Select(mode => mode.Name),
            ExpectedRotationModes);

        foreach (var rotationMode in ExpectedRotationModes)
        {
            var stances = rotationModes[rotationMode]?["stances"] as JObject ?? new JObject();
            ValidateNameSet(
                errors,
                $"{rotationMode} stances",
                stances.Properties().Select(stance => stance.Name),
                ExpectedStances);
            foreach (var stance in ExpectedStances)
            {
                if (stances[stance] is not JObject gait)
                {
                    errors.Add($"{rotationMode}.{stance}: gait settings are missing");
                    continue;
                }
                foreach (var speedName in new[]
                         {
                             "WalkForwardSpeed",
                             "WalkBackwardSpeed",
                             "RunForwardSpeed",
                             "RunBackwardSpeed",
                             "SprintSpeed",
                         })
                {
                    if (gait.Value<double?>(speedName) is not > 0)
                        errors.Add($"{rotationMode}.{stance}.{speedName}: speed is not positive");
                }
                foreach (var referenceName in new[]
                         {
                             "AccelerationAndDecelerationAndGroundFrictionCurve",
                             "RotationInterpolationSpeedCurve",
                         })
                {
                    var reference = gait.Value<string>(referenceName);
                    if (reference is null || !ExpectedCurves.Contains(reference))
                    {
                        errors.Add(
                            $"{rotationMode}.{stance}.{referenceName}: unexpected curve " +
                            $"{reference ?? "<missing>"}");
                    }
                }
            }
        }

        ValidateGait(
            errors,
            rotationModes,
            "Als.RotationMode.VelocityDirection",
            "Als.Stance.Standing",
            [175, 175, 375, 375, 650],
            "CV_Als_AccelerationAndDecelerationAndGroundFriction_Normal",
            "CF_Als_RotationInterpolationSpeed_Responsive");
        ValidateGait(
            errors,
            rotationModes,
            "Als.RotationMode.ViewDirection",
            "Als.Stance.Standing",
            [175, 175, 375, 375, 650],
            "CV_Als_AccelerationAndDecelerationAndGroundFriction_Normal",
            "CF_Als_RotationInterpolationSpeed_Normal");
        ValidateGait(
            errors,
            rotationModes,
            "Als.RotationMode.Aiming",
            "Als.Stance.Standing",
            [165, 165, 375, 375, 650],
            "CV_Als_AccelerationAndDecelerationAndGroundFriction_Normal",
            "CF_Als_RotationInterpolationSpeed_Normal");
        foreach (var rotationMode in ExpectedRotationModes)
        {
            ValidateGait(
                errors,
                rotationModes,
                rotationMode,
                "Als.Stance.Crouching",
                [150, 150, 200, 200, 300],
                "CV_Als_AccelerationAndDecelerationAndGroundFriction_Responsive",
                "CF_Als_RotationInterpolationSpeed_Normal");
        }

        var range = payload.SelectToken("settings.VelocityAngleToSpeedInterpolationRange")
            ?.Values<double>()
            .ToArray() ?? [];
        if (!range.SequenceEqual(new[] { 100.0, 125.0 }))
        {
            errors.Add(
                "VelocityAngleToSpeedInterpolationRange does not match " +
                "AlsMovementSettings.h");
        }

        return Validation(
            "ms-als-normal-rotation-mode-and-stance-settings",
            errors.Count == 0,
            new JObject
            {
                ["rotationModeCount"] = rotationModes.Count,
                ["gaitCount"] = rotationModes.Properties()
                    .Sum(mode => (mode.Value["stances"] as JObject)?.Count ?? 0),
                ["errors"] = errors,
            });
    }

    static void ValidateGait(
        JArray errors,
        JObject rotationModes,
        string rotationMode,
        string stance,
        double[] expectedSpeeds,
        string expectedMovementCurve,
        string expectedRotationCurve)
    {
        if (rotationModes[rotationMode]?["stances"]?[stance] is not JObject gait)
            return;
        var actualSpeeds = new[]
        {
            gait.Value<double>("WalkForwardSpeed"),
            gait.Value<double>("WalkBackwardSpeed"),
            gait.Value<double>("RunForwardSpeed"),
            gait.Value<double>("RunBackwardSpeed"),
            gait.Value<double>("SprintSpeed"),
        };
        if (!actualSpeeds.SequenceEqual(expectedSpeeds))
            errors.Add($"{rotationMode}.{stance}: authored speed tuple changed");
        if (gait.Value<string>(
                "AccelerationAndDecelerationAndGroundFrictionCurve")
            != expectedMovementCurve)
        {
            errors.Add($"{rotationMode}.{stance}: movement curve reference changed");
        }
        if (gait.Value<string>("RotationInterpolationSpeedCurve") != expectedRotationCurve)
            errors.Add($"{rotationMode}.{stance}: rotation curve reference changed");
    }

    static JObject ValidateCurves(JObject payload)
    {
        var errors = new JArray();
        var curves = payload["curves"] as JObject ?? new JObject();
        ValidateNameSet(
            errors,
            "movement curves",
            curves.Properties().Select(curve => curve.Name),
            ExpectedCurves);

        ValidateCurveValues(
            errors,
            curves,
            "CF_Als_RotationInterpolationSpeed_Normal",
            "RotationInterpolationSpeed",
            [0.5, 4, 5, 20]);
        ValidateCurveValues(
            errors,
            curves,
            "CF_Als_RotationInterpolationSpeed_Responsive",
            "RotationInterpolationSpeed",
            [5, 8, 12, 20]);
        ValidateCurveValues(
            errors,
            curves,
            "CV_Als_AccelerationAndDecelerationAndGroundFriction_Normal",
            "MaxAccelerationWalking",
            [2000, 2000, 2000, 750]);
        ValidateCurveValues(
            errors,
            curves,
            "CV_Als_AccelerationAndDecelerationAndGroundFriction_Normal",
            "BrakingDecelerationWalking",
            [1500, 1500, 1250, 500]);
        ValidateCurveValues(
            errors,
            curves,
            "CV_Als_AccelerationAndDecelerationAndGroundFriction_Normal",
            "GroundFriction",
            [5, 5, 4, 0.5]);
        ValidateCurveValues(
            errors,
            curves,
            "CV_Als_AccelerationAndDecelerationAndGroundFriction_Responsive",
            "MaxAccelerationWalking",
            [2500, 2500, 2500, 500]);
        ValidateCurveValues(
            errors,
            curves,
            "CV_Als_AccelerationAndDecelerationAndGroundFriction_Responsive",
            "BrakingDecelerationWalking",
            [2000, 2000, 2000, 800]);
        ValidateCurveValues(
            errors,
            curves,
            "CV_Als_AccelerationAndDecelerationAndGroundFriction_Responsive",
            "GroundFriction",
            [10, 10, 10, 5]);

        return Validation(
            "movement-rich-curve-keys",
            errors.Count == 0,
            new JObject
            {
                ["curveCount"] = curves.Count,
                ["channelCount"] = curves.Properties()
                    .Sum(curve => (curve.Value["channels"] as JObject)?.Count ?? 0),
                ["keyCount"] = curves.SelectTokens("..channels.*.keys[*]").Count(),
                ["errors"] = errors,
            });
    }

    static void ValidateCurveValues(
        JArray errors,
        JObject curves,
        string curveName,
        string channelName,
        double[] expectedValues)
    {
        var keys = curves[curveName]?["channels"]?[channelName]?["keys"] as JArray;
        if (keys is null)
        {
            errors.Add($"{curveName}.{channelName}: keys are missing");
            return;
        }

        var actualTimes = keys.OfType<JObject>()
            .Select(key => key.Value<double>("Time"))
            .ToArray();
        var actualValues = keys.OfType<JObject>()
            .Select(key => key.Value<double>("Value"))
            .ToArray();
        if (!actualTimes.SequenceEqual(new[] { 0.0, 1.0, 2.0, 3.0 }))
            errors.Add($"{curveName}.{channelName}: key times changed");
        if (!actualValues.SequenceEqual(expectedValues))
            errors.Add($"{curveName}.{channelName}: key values changed");

        foreach (var key in keys.OfType<JObject>())
        {
            foreach (var property in new[]
                     {
                         "InterpMode",
                         "TangentMode",
                         "TangentWeightMode",
                         "Time",
                         "Value",
                         "ArriveTangent",
                         "ArriveTangentWeight",
                         "LeaveTangent",
                         "LeaveTangentWeight",
                     })
            {
                if (key[property] is null)
                    errors.Add($"{curveName}.{channelName}: key is missing {property}");
            }
        }
    }

    static void ValidateNameSet(
        JArray errors,
        string label,
        IEnumerable<string> actual,
        IEnumerable<string> expected)
    {
        var actualNames = actual.Order(StringComparer.Ordinal).ToArray();
        var expectedNames = expected.Order(StringComparer.Ordinal).ToArray();
        if (!actualNames.SequenceEqual(expectedNames))
        {
            errors.Add(
                $"{label}: expected [{string.Join(", ", expectedNames)}], got " +
                $"[{string.Join(", ", actualNames)}]");
        }
    }

    static JObject Validation(string id, bool passed, JToken values)
    {
        return new JObject
        {
            ["id"] = id,
            ["passed"] = passed,
            ["values"] = values,
        };
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
                $"movement settings validation failed: {string.Join(", ", failed)}");
        }
    }
}
