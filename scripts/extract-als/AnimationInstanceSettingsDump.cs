using System.Globalization;
using System.Text.RegularExpressions;
using CUE4Parse.FileProvider;
using CUE4Parse.UE4.Versions;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

// Freezes AIS_Als_Default's locomotion cadence and in-air curve inputs. Values
// remain in Unreal's native units so consumers choose the world-unit conversion
// at their boundary.
public static class AnimationInstanceSettingsDump
{
    const string SettingsAsset = "AIS_Als_Default";
    const string AnimationInstancePath = "/Content/ALS/Data/AnimationInstance/";
    const string StandingSettingsHeader =
        "Source/ALS/Public/Settings/AlsStandingSettings.h";
    const string CrouchingSettingsHeader =
        "Source/ALS/Public/Settings/AlsCrouchingSettings.h";
    const string CurveConsumptionSource =
        "Source/ALS/Private/AlsAnimationInstance.cpp";

    static readonly string[] ExpectedCurves =
    [
        "CF_Als_GroundPredictionAmount",
        "CF_Als_LeanAmount_Air",
        "CF_Als_StrideBlendAmount_Run",
        "CF_Als_StrideBlendAmount_Walk",
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
        if (settingsExport.Value<string>("Type") != "AlsAnimationInstanceSettings")
        {
            throw new Exception(
                $"{SettingsAsset} is not an AlsAnimationInstanceSettings export");
        }

        var serializedSettings = settingsExport["Properties"] as JObject
                                 ?? throw new Exception($"{SettingsAsset} has no properties");
        var standing = RequiredObject(serializedSettings, "Standing");
        var crouching = RequiredObject(serializedSettings, "Crouching");
        var inAir = RequiredObject(serializedSettings, "InAir");

        // AIS_Als_Default does not serialize these values because it uses the C++
        // struct defaults. Read the cited headers so the oracle follows the source
        // rather than duplicating an uncited magic number in the extractor.
        var animatedWalkSpeed = ReadCppFloatDefault(
            srcDir,
            StandingSettingsHeader,
            "AnimatedWalkSpeed");
        var animatedRunSpeed = ReadCppFloatDefault(
            srcDir,
            StandingSettingsHeader,
            "AnimatedRunSpeed");
        var animatedSprintSpeed = ReadCppFloatDefault(
            srcDir,
            StandingSettingsHeader,
            "AnimatedSprintSpeed");
        var animatedCrouchSpeed = ReadCppFloatDefault(
            srcDir,
            CrouchingSettingsHeader,
            "AnimatedCrouchSpeed");
        var strideBlendAmountWalkCurve =
            ReadReferenceName(standing, "StrideBlendAmountWalkCurve");
        var strideBlendAmountRunCurve =
            ReadReferenceName(standing, "StrideBlendAmountRunCurve");
        var crouchingStrideBlendAmountCurve =
            ReadReferenceName(crouching, "StrideBlendAmountCurve");
        var groundPredictionAmountCurve =
            ReadReferenceName(inAir, "GroundPredictionAmountCurve");
        var leanAmountCurve =
            ReadReferenceName(inAir, "LeanAmountCurve");

        var settings = new JObject
        {
            ["asset"] = SettingsAsset,
            ["nativeSpeedUnit"] = "cm/s",
            ["standing"] = new JObject
            {
                ["AnimatedWalkSpeed"] = animatedWalkSpeed,
                ["AnimatedRunSpeed"] = animatedRunSpeed,
                ["AnimatedSprintSpeed"] = animatedSprintSpeed,
                ["StrideBlendAmountWalkCurve"] = strideBlendAmountWalkCurve,
                ["StrideBlendAmountRunCurve"] = strideBlendAmountRunCurve,
            },
            ["crouching"] = new JObject
            {
                ["AnimatedCrouchSpeed"] = animatedCrouchSpeed,
                ["StrideBlendAmountCurve"] = crouchingStrideBlendAmountCurve,
            },
            ["inAir"] = new JObject
            {
                ["GroundPredictionAmountCurve"] = groundPredictionAmountCurve,
                ["LeanAmountCurve"] = leanAmountCurve,
            },
        };

        var referencedCurveNames = new[]
            {
                strideBlendAmountWalkCurve,
                strideBlendAmountRunCurve,
                crouchingStrideBlendAmountCurve,
                groundPredictionAmountCurve,
                leanAmountCurve,
            }
            .Distinct(StringComparer.Ordinal)
            .Order(StringComparer.Ordinal)
            .ToArray();
        var curves = new JObject();
        foreach (var curveName in referencedCurveNames)
        {
            var (assetPath, curveExport) = LoadExport(provider, curveName);
            curves[curveName] = NormalizeCurve(
                assetPath,
                curveExport,
                CurveChannelName(curveName));
        }

        var payload = new JObject
        {
            ["schemaVersion"] = 1,
            ["source"] = new JObject
            {
                ["engineVersion"] = "UE5.5",
                ["referenceRelease"] = "ALS Refactored 4.15",
                ["settingsAssetPath"] = settingsPath,
                ["cppDefaults"] = new JObject
                {
                    ["standing"] = StandingSettingsHeader,
                    ["crouching"] = CrouchingSettingsHeader,
                },
                ["curveConsumption"] = CurveConsumptionSource,
            },
            ["settings"] = settings,
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
            $"dumped AIS locomotion cadence settings and {curves.Count} animation curves " +
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
                               .Contains(
                                   AnimationInstancePath,
                                   StringComparison.Ordinal))
                   ?? throw new Exception(
                       $"{assetName}.uasset was not found exactly once below " +
                       AnimationInstancePath);
        var export = provider.LoadPackage(file)
                         .GetExports()
                         .FirstOrDefault(candidate => candidate.Name == assetName)
                     ?? throw new Exception($"{assetName} has no same-named export");
        return (file.Path, JObject.FromObject(export, Serializer));
    }

    static JObject RequiredObject(JObject parent, string propertyName)
    {
        return parent[propertyName] as JObject
               ?? throw new Exception(
                   $"{SettingsAsset}.{propertyName} is missing or not an object");
    }

    static string ReadReferenceName(JObject settings, string propertyName)
    {
        var objectName = settings.SelectToken($"{propertyName}.ObjectName")
            ?.Value<string>()
                         ?? throw new Exception($"{propertyName} has no ObjectName");
        var firstQuote = objectName.IndexOf('\'');
        var lastQuote = objectName.LastIndexOf('\'');
        if (firstQuote < 0 || lastQuote <= firstQuote + 1)
            throw new Exception($"{propertyName} has malformed ObjectName {objectName}");
        return objectName[(firstQuote + 1)..lastQuote];
    }

    static double ReadCppFloatDefault(
        string srcDir,
        string sourcePath,
        string propertyName)
    {
        var stagedPath = Path.Combine(srcDir, "ALS", sourcePath);
        var directPath = Path.Combine(srcDir, sourcePath);
        var fullPath = File.Exists(stagedPath)
            ? stagedPath
            : File.Exists(directPath)
                ? directPath
                : throw new Exception(
                    $"{sourcePath} was not found below {Path.GetFullPath(srcDir)}");
        var source = File.ReadAllText(fullPath);
        var numberPattern =
            @"[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?";
        var match = Regex.Match(
            source,
            $@"\b{Regex.Escape(propertyName)}\s*\{{\s*" +
            $@"(?<value>{numberPattern})[fF]?\s*\}}");
        if (!match.Success)
        {
            throw new Exception(
                $"{propertyName} has no float default initializer in {sourcePath}");
        }
        return double.Parse(
            match.Groups["value"].Value,
            NumberStyles.Float,
            CultureInfo.InvariantCulture);
    }

    static string CurveChannelName(string curveName)
    {
        return curveName switch
        {
            "CF_Als_GroundPredictionAmount" => "GroundPredictionAmount",
            "CF_Als_LeanAmount_Air" => "LeanAmount",
            "CF_Als_StrideBlendAmount_Run" => "StrideBlendAmount",
            "CF_Als_StrideBlendAmount_Walk" => "StrideBlendAmount",
            _ => throw new Exception($"{curveName} has no normalized channel name"),
        };
    }

    static JObject NormalizeCurve(
        string assetPath,
        JObject curveExport,
        string channelName)
    {
        var type = curveExport.Value<string>("Type")
                   ?? throw new Exception($"{assetPath} has no export type");
        if (type != "CurveFloat")
            throw new Exception($"{assetPath} has unsupported curve type {type}");
        var keys = curveExport.SelectToken("Properties.FloatCurve.Keys") as JArray
                   ?? throw new Exception($"{assetPath} has no rich-curve keys");
        return new JObject
        {
            ["assetPath"] = assetPath,
            ["type"] = type,
            ["channels"] = new JObject
            {
                [channelName] = new JObject
                {
                    ["sourceIndex"] = 0,
                    ["keys"] = keys.DeepClone(),
                },
            },
        };
    }

    static JArray ValidatePayload(JObject payload)
    {
        return
        [
            ValidateSettings(payload),
            ValidateCurves(payload),
        ];
    }

    static JObject ValidateSettings(JObject payload)
    {
        var errors = new JArray();
        ExpectString(
            errors,
            payload,
            "source.engineVersion",
            "UE5.5");
        ExpectString(
            errors,
            payload,
            "source.referenceRelease",
            "ALS Refactored 4.15");
        ExpectString(
            errors,
            payload,
            "source.settingsAssetPath",
            "ALS/Content/ALS/Data/AnimationInstance/AIS_Als_Default.uasset");
        ExpectString(
            errors,
            payload,
            "source.cppDefaults.standing",
            StandingSettingsHeader);
        ExpectString(
            errors,
            payload,
            "source.cppDefaults.crouching",
            CrouchingSettingsHeader);
        ExpectString(
            errors,
            payload,
            "source.curveConsumption",
            CurveConsumptionSource);
        ExpectString(errors, payload, "settings.asset", SettingsAsset);
        ExpectString(errors, payload, "settings.nativeSpeedUnit", "cm/s");

        ExpectNumber(
            errors,
            payload,
            "settings.standing.AnimatedWalkSpeed",
            150);
        ExpectNumber(
            errors,
            payload,
            "settings.standing.AnimatedRunSpeed",
            350);
        ExpectNumber(
            errors,
            payload,
            "settings.standing.AnimatedSprintSpeed",
            600);
        ExpectNumber(
            errors,
            payload,
            "settings.crouching.AnimatedCrouchSpeed",
            150);
        ExpectString(
            errors,
            payload,
            "settings.standing.StrideBlendAmountWalkCurve",
            "CF_Als_StrideBlendAmount_Walk");
        ExpectString(
            errors,
            payload,
            "settings.standing.StrideBlendAmountRunCurve",
            "CF_Als_StrideBlendAmount_Run");
        ExpectString(
            errors,
            payload,
            "settings.crouching.StrideBlendAmountCurve",
            "CF_Als_StrideBlendAmount_Walk");
        ExpectString(
            errors,
            payload,
            "settings.inAir.GroundPredictionAmountCurve",
            "CF_Als_GroundPredictionAmount");
        ExpectString(
            errors,
            payload,
            "settings.inAir.LeanAmountCurve",
            "CF_Als_LeanAmount_Air");

        return Validation(
            "ais-als-default-animation-settings-and-cpp-defaults",
            errors.Count == 0,
            new JObject
            {
                ["standingAnimatedSpeeds"] = new JArray(
                    ValueOrNull(
                        payload,
                        "settings.standing.AnimatedWalkSpeed"),
                    ValueOrNull(
                        payload,
                        "settings.standing.AnimatedRunSpeed"),
                    ValueOrNull(
                        payload,
                        "settings.standing.AnimatedSprintSpeed")),
                ["crouchingAnimatedSpeed"] =
                    ValueOrNull(
                        payload,
                        "settings.crouching.AnimatedCrouchSpeed"),
                ["errors"] = errors,
            });
    }

    static JObject ValidateCurves(JObject payload)
    {
        var errors = new JArray();
        var curves = payload["curves"] as JObject ?? new JObject();
        ValidateNameSet(
            errors,
            "stride curves",
            curves.Properties().Select(curve => curve.Name),
            ExpectedCurves);

        ValidateCurve(
            errors,
            curves,
            "CF_Als_StrideBlendAmount_Walk",
            "ALS/Content/ALS/Data/AnimationInstance/Grounded/" +
            "CF_Als_StrideBlendAmount_Walk.uasset",
            "StrideBlendAmount",
            [
                ExpectedKey("RCIM_Cubic", "RCTM_Auto", 0, 0.2, 0),
                ExpectedKey(
                    "RCIM_Cubic",
                    "RCTM_User",
                    58.3,
                    0.54999995,
                    0.012879322),
                ExpectedKey("RCIM_Linear", "RCTM_Auto", 150, 1, 0),
            ]);
        ValidateCurve(
            errors,
            curves,
            "CF_Als_StrideBlendAmount_Run",
            "ALS/Content/ALS/Data/AnimationInstance/Grounded/" +
            "CF_Als_StrideBlendAmount_Run.uasset",
            "StrideBlendAmount",
            [
                ExpectedKey("RCIM_Cubic", "RCTM_Auto", 0, 0.2, 0),
                ExpectedKey(
                    "RCIM_Cubic",
                    "RCTM_User",
                    166.9,
                    0.45000002,
                    0.0033657213),
                ExpectedKey("RCIM_Linear", "RCTM_Auto", 350, 1, 0),
            ]);
        ValidateCurve(
            errors,
            curves,
            "CF_Als_GroundPredictionAmount",
            "ALS/Content/ALS/Data/AnimationInstance/Air/" +
            "CF_Als_GroundPredictionAmount.uasset",
            "GroundPredictionAmount",
            [
                ExpectedKeyWithTangents(
                    "RCIM_Cubic",
                    "RCTM_User",
                    0,
                    1,
                    -2.066087,
                    -2.0660884),
                ExpectedKey("RCIM_Linear", "RCTM_Auto", 1, 0, 0),
            ]);
        ValidateCurve(
            errors,
            curves,
            "CF_Als_LeanAmount_Air",
            "ALS/Content/ALS/Data/AnimationInstance/Air/" +
            "CF_Als_LeanAmount_Air.uasset",
            "LeanAmount",
            [
                ExpectedKey("RCIM_Cubic", "RCTM_Auto", -4000, 0, 0),
                ExpectedKeyWithTangents(
                    "RCIM_Cubic",
                    "RCTM_Auto",
                    -3277.683,
                    -0.12285149,
                    -0.00053329713,
                    -0.00053329713),
                ExpectedKeyWithTangents(
                    "RCIM_Cubic",
                    "RCTM_User",
                    -2251.931,
                    -0.93224025,
                    -0.00046590986,
                    -0.00046631158),
                ExpectedKey(
                    "RCIM_Cubic",
                    "RCTM_Auto",
                    -1247.5488,
                    -0.7941916,
                    0.0008580371),
                ExpectedKey("RCIM_Linear", "RCTM_Auto", 0, 1, 0),
            ]);

        return Validation(
            "animation-instance-rich-curve-keys",
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

    static void ValidateCurve(
        JArray errors,
        JObject curves,
        string curveName,
        string expectedAssetPath,
        string expectedChannelName,
        JArray expectedKeys)
    {
        if (curves[curveName] is not JObject curve)
        {
            errors.Add($"{curveName}: curve is missing");
            return;
        }
        if (curve.Value<string>("assetPath") != expectedAssetPath)
            errors.Add($"{curveName}: asset path changed");
        if (curve.Value<string>("type") != "CurveFloat")
            errors.Add($"{curveName}: export type changed");
        var channels = curve["channels"] as JObject ?? new JObject();
        ValidateNameSet(
            errors,
            $"{curveName} channels",
            channels.Properties().Select(channel => channel.Name),
            [expectedChannelName]);
        var channel = channels[expectedChannelName] as JObject;
        if (channel?.Value<int?>("sourceIndex") != 0)
            errors.Add($"{curveName}: source channel index changed");
        var keys = channel?["keys"] as JArray;
        if (keys is null)
        {
            errors.Add($"{curveName}: rich-curve keys are missing");
            return;
        }
        // CUE4Parse supplies single-precision JValues while the standalone JSON
        // validator reads them back as doubles. Normalize through JSON text so
        // validation compares the persisted oracle, not CLR numeric subclasses.
        var persistedKeys = JArray.Parse(keys.ToString(Formatting.None));
        if (!JToken.DeepEquals(persistedKeys, expectedKeys))
            errors.Add($"{curveName}: exact rich-curve keys changed");
    }

    static JObject ExpectedKey(
        string interpolationMode,
        string tangentMode,
        double time,
        double value,
        double tangent)
    {
        return ExpectedKeyWithTangents(
            interpolationMode,
            tangentMode,
            time,
            value,
            tangent,
            tangent);
    }

    static JObject ExpectedKeyWithTangents(
        string interpolationMode,
        string tangentMode,
        double time,
        double value,
        double arriveTangent,
        double leaveTangent)
    {
        return new JObject
        {
            ["InterpMode"] = interpolationMode,
            ["TangentMode"] = tangentMode,
            ["TangentWeightMode"] = "RCTWM_WeightedNone",
            ["Time"] = time,
            ["Value"] = value,
            ["ArriveTangent"] = arriveTangent,
            ["ArriveTangentWeight"] = 0.0,
            ["LeaveTangent"] = leaveTangent,
            ["LeaveTangentWeight"] = 0.0,
        };
    }

    static void ExpectString(
        JArray errors,
        JObject payload,
        string path,
        string expected)
    {
        var actual = payload.SelectToken(path)?.Value<string>();
        if (actual != expected)
        {
            errors.Add(
                $"{path}: expected {expected}, got {actual ?? "<missing>"}");
        }
    }

    static void ExpectNumber(
        JArray errors,
        JObject payload,
        string path,
        double expected)
    {
        var actual = payload.SelectToken(path)?.Value<double?>();
        if (actual != expected)
        {
            errors.Add(
                $"{path}: expected {expected.ToString(CultureInfo.InvariantCulture)}, " +
                $"got {actual?.ToString(CultureInfo.InvariantCulture) ?? "<missing>"}");
        }
    }

    static JToken ValueOrNull(JObject payload, string path)
    {
        return payload.SelectToken(path)?.DeepClone() ?? JValue.CreateNull();
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
                "animation instance settings validation failed: " +
                string.Join(", ", failed));
        }
    }
}
