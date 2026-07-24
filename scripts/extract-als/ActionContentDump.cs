using System.Globalization;
using System.Text.RegularExpressions;
using CUE4Parse.FileProvider;
using CUE4Parse.UE4.Assets;
using CUE4Parse.UE4.Assets.Exports;
using CUE4Parse.UE4.Versions;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

// Freezes the complete authored Rolling / GettingUp content contract:
// effective character settings, montage clocks and state windows, and the
// sequence-side root-motion / action notify data consumed by the live runtime.
public static class ActionContentDump
{
    const string CharacterSettingsAsset = "CS_Als_Default";
    const string CharacterSettingsPath = "/Content/ALS/Data/Character/";
    const string RollPath = "/Content/ALS/Animations/Actions/Roll/";
    const string GetUpPath = "/Content/ALS/Animations/Actions/GetUp/";
    const string RollingSettingsHeader =
        "Source/ALS/Public/Settings/AlsRollingSettings.h";
    const string RagdollingSettingsHeader =
        "Source/ALS/Public/Settings/AlsRagdollingSettings.h";
    const string CharacterActionsSource =
        "Source/ALS/Private/AlsCharacter_Actions.cpp";

    static readonly (string Montage, string ContentPath)[] ExpectedMontages =
    [
        ("AM_Als_Roll", RollPath),
        ("AM_Als_GetUp_Front", GetUpPath),
        ("AM_Als_GetUp_Back", GetUpPath),
    ];

    static readonly string[] ExpectedSequences =
    [
        "A_Als_Roll",
        "A_Als_GetUp_Front",
        "A_Als_GetUp_Back",
    ];

    static readonly JsonSerializer Serializer = JsonSerializer.Create(
        new JsonSerializerSettings
        {
            ReferenceLoopHandling = ReferenceLoopHandling.Ignore,
        });

    sealed record AssetRecord(
        string Path,
        UObject[] Exports,
        JObject Export);

    public static int Run(string srcDir, string outJson)
    {
        var provider = new DefaultFileProvider(
            srcDir,
            SearchOption.AllDirectories,
            new VersionContainer(EGame.GAME_UE5_5));
        provider.Initialize();
        provider.Mount();

        var cppDefaults = ReadCppDefaults(srcDir);
        var characterSettings = LoadAsset(
            provider,
            CharacterSettingsAsset,
            CharacterSettingsPath,
            "AlsCharacterSettings");
        var characterProperties =
            characterSettings.Export["Properties"] as JObject
            ?? new JObject();
        var serializedOverrides = new JObject
        {
            ["Rolling"] =
                characterProperties["Rolling"]?.DeepClone()
                ?? new JObject(),
            ["Ragdolling"] =
                characterProperties["Ragdolling"]?.DeepClone()
                ?? new JObject(),
        };
        var settings = NormalizeSettings(
            characterProperties,
            cppDefaults);

        var montages = new JObject();
        var sequences = new JObject();
        foreach (var (montageName, contentPath) in ExpectedMontages)
        {
            var montage = NormalizeMontage(
                LoadAsset(
                    provider,
                    montageName,
                    contentPath,
                    "AnimMontage"));
            montages[montageName] = montage;

            var sequenceName = montage
                                   .SelectToken("slot.sequence")
                                   ?.Value<string>()
                               ?? throw new Exception(
                                   $"{montageName} has no normalized sequence");
            if (sequences[sequenceName] is null)
            {
                sequences[sequenceName] = NormalizeSequence(
                    LoadAsset(
                        provider,
                        sequenceName,
                        contentPath,
                        "AnimSequence"));
            }
        }

        var payload = new JObject
        {
            ["schemaVersion"] = 1,
            ["source"] = new JObject
            {
                ["engineVersion"] = "UE5.5",
                ["referenceRelease"] = "ALS Refactored 4.15",
                ["characterSettingsAssetPath"] =
                    characterSettings.Path,
                ["cppDefaults"] = new JArray(
                    RollingSettingsHeader,
                    RagdollingSettingsHeader),
                ["consumer"] = CharacterActionsSource,
            },
            ["cppDefaults"] = cppDefaults,
            ["serializedOverrides"] = serializedOverrides,
            ["settings"] = settings,
            ["montages"] = montages,
            ["sequences"] = sequences,
        };
        var validations = ValidatePayload(payload);
        payload["validations"] = validations;

        Directory.CreateDirectory(
            Path.GetDirectoryName(Path.GetFullPath(outJson))
            ?? throw new Exception($"invalid output path {outJson}"));
        File.WriteAllText(
            outJson,
            payload.ToString(Formatting.Indented) + "\n");

        PrintValidations(validations);
        ThrowOnValidationFailure(validations);
        Console.WriteLine(
            $"dumped {montages.Count} action montages and " +
            $"{sequences.Count} sequences -> {outJson} " +
            $"({new FileInfo(outJson).Length:N0} bytes)");
        return 0;
    }

    public static int Validate(string contentJson)
    {
        var payload = JObject.Parse(File.ReadAllText(contentJson));
        var validations = ValidatePayload(payload);
        PrintValidations(validations);
        ThrowOnValidationFailure(validations);
        Console.WriteLine($"validated {contentJson}");
        return 0;
    }

    static AssetRecord LoadAsset(
        DefaultFileProvider provider,
        string assetName,
        string requiredPath,
        string requiredType)
    {
        var file = provider.Files.Values.SingleOrDefault(
                       candidate =>
                           candidate.NameWithoutExtension == assetName
                           && candidate.Extension == "uasset"
                           && candidate.Path
                               .Replace('\\', '/')
                               .Contains(
                                   requiredPath,
                                   StringComparison.Ordinal))
                   ?? throw new Exception(
                       $"{assetName}.uasset was not found exactly once below " +
                       requiredPath);
        var exports = provider.LoadPackage(file).GetExports().ToArray();
        var exportObject = exports.SingleOrDefault(
                               candidate => candidate.Name == assetName)
                           ?? throw new Exception(
                               $"{assetName} has no same-named export");
        var export = JObject.FromObject(exportObject, Serializer);
        if (export.Value<string>("Type") != requiredType)
        {
            throw new Exception(
                $"{assetName} is not a {requiredType} export");
        }
        return new AssetRecord(file.Path, exports, export);
    }

    static JObject ReadCppDefaults(string srcDir)
    {
        var rollingHeader = ReadSource(
            srcDir,
            RollingSettingsHeader);
        var ragdollingHeader = ReadSource(
            srcDir,
            RagdollingSettingsHeader);
        return new JObject
        {
            ["Rolling"] = new JObject
            {
                ["Montage"] = JValue.CreateNull(),
                ["bCrouchOnStart"] = ReadBoolDefault(
                    rollingHeader,
                    "bCrouchOnStart",
                    RollingSettingsHeader),
                ["bRotateToInputOnStart"] = ReadBoolDefault(
                    rollingHeader,
                    "bRotateToInputOnStart",
                    RollingSettingsHeader),
                ["RotationInterpolationSpeed"] = ReadFloatDefault(
                    rollingHeader,
                    "RotationInterpolationSpeed",
                    RollingSettingsHeader),
                ["bStartRollingOnLand"] = ReadBoolDefault(
                    rollingHeader,
                    "bStartRollingOnLand",
                    RollingSettingsHeader),
                ["RollingOnLandSpeedThreshold"] = ReadFloatDefault(
                    rollingHeader,
                    "RollingOnLandSpeedThreshold",
                    RollingSettingsHeader),
                ["bInterruptRollingWhenInAir"] = ReadBoolDefault(
                    rollingHeader,
                    "bInterruptRollingWhenInAir",
                    RollingSettingsHeader),
            },
            ["Ragdolling"] = new JObject
            {
                ["bStartRagdollingOnLand"] = ReadBoolDefault(
                    ragdollingHeader,
                    "bStartRagdollingOnLand",
                    RagdollingSettingsHeader),
                ["RagdollingOnLandSpeedThreshold"] = ReadFloatDefault(
                    ragdollingHeader,
                    "RagdollingOnLandSpeedThreshold",
                    RagdollingSettingsHeader),
                ["bLimitInitialRagdollSpeed"] = ReadBoolDefault(
                    ragdollingHeader,
                    "bLimitInitialRagdollSpeed",
                    RagdollingSettingsHeader),
                ["GetUpFrontMontage"] = JValue.CreateNull(),
                ["GetUpBackMontage"] = JValue.CreateNull(),
            },
        };
    }

    static string ReadSource(string srcDir, string sourcePath)
    {
        var stagedPath = Path.Combine(srcDir, "ALS", sourcePath);
        var directPath = Path.Combine(srcDir, sourcePath);
        var fullPath = File.Exists(stagedPath)
            ? stagedPath
            : File.Exists(directPath)
                ? directPath
                : throw new Exception(
                    $"{sourcePath} was not found below " +
                    Path.GetFullPath(srcDir));
        return File.ReadAllText(fullPath);
    }

    static bool ReadBoolDefault(
        string source,
        string propertyName,
        string sourcePath)
    {
        var match = Regex.Match(
            source,
            $@"\b{Regex.Escape(propertyName)}\s*(?::\s*1\s*)?" +
            @"\{\s*(?<value>true|false)\s*\}");
        if (!match.Success)
        {
            throw new Exception(
                $"{propertyName} has no bool initializer in {sourcePath}");
        }
        return bool.Parse(match.Groups["value"].Value);
    }

    static double ReadFloatDefault(
        string source,
        string propertyName,
        string sourcePath)
    {
        var match = Regex.Match(
            source,
            $@"\b{Regex.Escape(propertyName)}\s*\{{\s*" +
            @"(?<value>[-+]?(?:\d+(?:\.\d*)?|\.\d+)" +
            @"(?:[eE][-+]?\d+)?)[fF]?\s*\}");
        if (!match.Success)
        {
            throw new Exception(
                $"{propertyName} has no float initializer in {sourcePath}");
        }
        return double.Parse(
            match.Groups["value"].Value,
            NumberStyles.Float,
            CultureInfo.InvariantCulture);
    }

    static JObject NormalizeSettings(
        JObject characterProperties,
        JObject cppDefaults)
    {
        var rollingOverrides =
            characterProperties["Rolling"] as JObject
            ?? new JObject();
        var ragdollingOverrides =
            characterProperties["Ragdolling"] as JObject
            ?? new JObject();
        var rollingDefaults = (JObject)cppDefaults["Rolling"]!;
        var ragdollingDefaults =
            (JObject)cppDefaults["Ragdolling"]!;

        return new JObject
        {
            ["nativeSpeedUnit"] = "cm/s",
            ["nativeAngleUnit"] = "deg",
            ["Rolling"] = new JObject
            {
                ["Montage"] = ReadReferenceOverride(
                    rollingOverrides,
                    "Montage",
                    rollingDefaults["Montage"]),
                ["bCrouchOnStart"] = ReadValueOverride<bool>(
                    rollingOverrides,
                    rollingDefaults,
                    "bCrouchOnStart"),
                ["bRotateToInputOnStart"] = ReadValueOverride<bool>(
                    rollingOverrides,
                    rollingDefaults,
                    "bRotateToInputOnStart"),
                ["RotationInterpolationSpeed"] =
                    ReadValueOverride<double>(
                        rollingOverrides,
                        rollingDefaults,
                        "RotationInterpolationSpeed"),
                ["bStartRollingOnLand"] = ReadValueOverride<bool>(
                    rollingOverrides,
                    rollingDefaults,
                    "bStartRollingOnLand"),
                ["RollingOnLandSpeedThreshold"] =
                    ReadValueOverride<double>(
                        rollingOverrides,
                        rollingDefaults,
                        "RollingOnLandSpeedThreshold"),
                ["bInterruptRollingWhenInAir"] =
                    ReadValueOverride<bool>(
                        rollingOverrides,
                        rollingDefaults,
                        "bInterruptRollingWhenInAir"),
            },
            ["Ragdolling"] = new JObject
            {
                ["bStartRagdollingOnLand"] =
                    ReadValueOverride<bool>(
                        ragdollingOverrides,
                        ragdollingDefaults,
                        "bStartRagdollingOnLand"),
                ["RagdollingOnLandSpeedThreshold"] =
                    ReadValueOverride<double>(
                        ragdollingOverrides,
                        ragdollingDefaults,
                        "RagdollingOnLandSpeedThreshold"),
                ["bLimitInitialRagdollSpeed"] =
                    ReadValueOverride<bool>(
                        ragdollingOverrides,
                        ragdollingDefaults,
                        "bLimitInitialRagdollSpeed"),
                ["GetUpFrontMontage"] = ReadReferenceOverride(
                    ragdollingOverrides,
                    "GetUpFrontMontage",
                    ragdollingDefaults["GetUpFrontMontage"]),
                ["GetUpBackMontage"] = ReadReferenceOverride(
                    ragdollingOverrides,
                    "GetUpBackMontage",
                    ragdollingDefaults["GetUpBackMontage"]),
            },
        };
    }

    static JToken ReadReferenceOverride(
        JObject overrides,
        string propertyName,
        JToken? defaultValue)
    {
        var objectName = overrides
            .SelectToken($"{propertyName}.ObjectName")
            ?.Value<string>();
        return objectName is null
            ? defaultValue?.DeepClone() ?? JValue.CreateNull()
            : ReadObjectLeafName(objectName);
    }

    static T ReadValueOverride<T>(
        JObject overrides,
        JObject defaults,
        string propertyName)
    {
        return overrides[propertyName] is { } serialized
            ? serialized.Value<T>()!
            : defaults[propertyName] is { } cppDefault
                ? cppDefault.Value<T>()!
                : throw new Exception(
                    $"{propertyName} has neither serialized nor C++ value");
    }

    static JObject NormalizeMontage(AssetRecord montage)
    {
        var assetName = montage.Export.Value<string>("Name")
                        ?? throw new Exception(
                            "montage export has no name");
        var properties = montage.Export["Properties"] as JObject
                         ?? throw new Exception(
                             $"{assetName} has no properties");
        var sections = properties["CompositeSections"] as JArray
                       ?? throw new Exception(
                           $"{assetName} has no CompositeSections");
        var slotTracks = properties["SlotAnimTracks"] as JArray
                         ?? throw new Exception(
                             $"{assetName} has no SlotAnimTracks");
        if (sections.Count != 1 || slotTracks.Count != 1)
        {
            throw new Exception(
                $"{assetName} must have one section and slot track");
        }
        var section = (JObject)sections[0]!;
        var slotTrack = (JObject)slotTracks[0]!;
        var segments =
            slotTrack.SelectToken("AnimTrack.AnimSegments") as JArray
            ?? throw new Exception(
                $"{assetName} slot has no AnimSegments");
        if (segments.Count != 1)
        {
            throw new Exception(
                $"{assetName} must have one segment");
        }
        var segment = (JObject)segments[0]!;
        var sequenceName = ReadReferenceName(
            segment,
            "AnimReference");
        var sequenceLength = RequiredNumber(
            properties,
            "SequenceLength");
        var rateScale =
            properties.Value<double?>("RateScale") ?? 1.0;

        return new JObject
        {
            ["asset"] = assetName,
            ["assetPath"] = montage.Path,
            ["SequenceLength"] = sequenceLength,
            ["RateScale"] = rateScale,
            ["effectiveDurationSecondsAtPlayRateOne"] =
                sequenceLength / rateScale,
            ["SamplingFrameRate"] = new JObject
            {
                ["Numerator"] =
                    properties
                        .SelectToken("CommonTargetFrameRate.Numerator")
                        ?.Value<int>()
                    ?? 30,
                ["Denominator"] =
                    properties
                        .SelectToken("CommonTargetFrameRate.Denominator")
                        ?.Value<int>()
                    ?? 1,
            },
            ["BlendIn"] = NormalizeBlend(
                properties["BlendIn"] as JObject,
                "BlendIn"),
            ["BlendOut"] = NormalizeBlend(
                properties["BlendOut"] as JObject,
                "BlendOut"),
            // UAnimMontage's default is -1; action montages intentionally omit
            // this tag, unlike the mantling montages that explicitly serialize 0.
            ["BlendOutTriggerTime"] =
                properties.Value<double?>("BlendOutTriggerTime") ?? -1.0,
            ["section"] = new JObject
            {
                ["SectionName"] =
                    section.Value<string>("SectionName"),
                ["NextSectionName"] =
                    section.Value<string>("NextSectionName"),
                ["SlotIndex"] = section.Value<int>("SlotIndex"),
                ["SegmentIndex"] =
                    section.Value<int>("SegmentIndex"),
                ["LinkMethod"] = StripEnumPrefix(
                    section.Value<string>("LinkMethod")),
                ["SegmentBeginTime"] = RequiredNumber(
                    section,
                    "SegmentBeginTime"),
                ["SegmentLength"] = RequiredNumber(
                    section,
                    "SegmentLength"),
                ["LinkValue"] = RequiredNumber(
                    section,
                    "LinkValue"),
            },
            ["slot"] = new JObject
            {
                ["SlotName"] =
                    slotTrack.Value<string>("SlotName"),
                ["sequence"] = sequenceName,
                ["StartPos"] = RequiredNumber(
                    segment,
                    "StartPos"),
                ["AnimStartTime"] = RequiredNumber(
                    segment,
                    "AnimStartTime"),
                ["AnimEndTime"] = RequiredNumber(
                    segment,
                    "AnimEndTime"),
                ["AnimPlayRate"] = RequiredNumber(
                    segment,
                    "AnimPlayRate"),
                ["LoopingCount"] =
                    segment.Value<int>("LoopingCount"),
            },
            ["notifies"] = NormalizeNotifies(
                properties["Notifies"] as JArray,
                montage.Exports,
                assetName),
            ["branchingPointMarkers"] =
                NormalizeBranchingPointMarkers(properties),
            ["branchingPointStateNotifyIndices"] =
                new JArray(
                    properties["BranchingPointStateNotifyIndices"]
                        ?.Values<int>()
                    ?? []),
            ["serializedDefaults"] = new JObject
            {
                ["RateScale"] =
                    properties["RateScale"] is not null,
                ["BlendOutTriggerTime"] =
                    properties["BlendOutTriggerTime"] is not null,
                ["CommonTargetFrameRate"] =
                    properties["CommonTargetFrameRate"] is not null,
            },
        };
    }

    static JObject NormalizeSequence(AssetRecord sequence)
    {
        var assetName = sequence.Export.Value<string>("Name")
                        ?? throw new Exception(
                            "sequence export has no name");
        var properties = sequence.Export["Properties"] as JObject
                         ?? throw new Exception(
                             $"{assetName} has no properties");
        var sequenceLength = RequiredNumber(
            properties,
            "SequenceLength");
        var rateScale =
            properties.Value<double?>("RateScale") ?? 1.0;

        return new JObject
        {
            ["asset"] = assetName,
            ["assetPath"] = sequence.Path,
            ["SequenceLength"] = sequenceLength,
            ["RateScale"] = rateScale,
            ["effectiveDurationSecondsAtPlayRateOne"] =
                sequenceLength / rateScale,
            ["SamplingFrameRate"] = new JObject
            {
                ["Numerator"] =
                    properties
                        .SelectToken("SamplingFrameRate.Numerator")
                        ?.Value<int>()
                    ?? 30,
                ["Denominator"] =
                    properties
                        .SelectToken("SamplingFrameRate.Denominator")
                        ?.Value<int>()
                    ?? 1,
            },
            ["NumFrames"] =
                properties.Value<int>("NumFrames"),
            ["NumberOfKeys"] =
                properties.Value<int>("NumberOfKeys"),
            ["rootMotion"] = new JObject
            {
                ["bEnableRootMotion"] =
                    properties.Value<bool?>("bEnableRootMotion")
                    ?? false,
                ["bForceRootLock"] =
                    properties.Value<bool?>("bForceRootLock")
                    ?? false,
                // UAnimSequence's omitted enum value is RefPose.
                ["RootMotionRootLock"] = StripEnumPrefix(
                    properties.Value<string>("RootMotionRootLock"))
                    ?? "RefPose",
            },
            ["notifies"] = NormalizeNotifies(
                properties["Notifies"] as JArray,
                sequence.Exports,
                assetName),
            ["serializedDefaults"] = new JObject
            {
                ["RateScale"] =
                    properties["RateScale"] is not null,
                ["RootMotionRootLock"] =
                    properties["RootMotionRootLock"] is not null,
            },
        };
    }

    static JArray NormalizeNotifies(
        JArray? serializedNotifies,
        IReadOnlyList<UObject> packageExports,
        string assetName)
    {
        var notifies = new JArray();
        foreach (var notify in
                 serializedNotifies?.OfType<JObject>() ?? [])
        {
            var startTime = RequiredNumber(
                notify,
                "LinkValue");
            var duration = RequiredNumber(
                notify,
                "Duration");
            notifies.Add(
                new JObject
                {
                    ["NotifyName"] =
                        notify.Value<string>("NotifyName"),
                    ["startTime"] = startTime,
                    ["duration"] = duration,
                    ["endTime"] = startTime + duration,
                    ["TriggerTimeOffset"] = RequiredNumber(
                        notify,
                        "TriggerTimeOffset"),
                    ["EndTriggerTimeOffset"] = RequiredNumber(
                        notify,
                        "EndTriggerTimeOffset"),
                    ["TriggerWeightThreshold"] = RequiredNumber(
                        notify,
                        "TriggerWeightThreshold"),
                    ["MontageTickType"] = StripEnumPrefix(
                        notify.Value<string>("MontageTickType")),
                    ["NotifyTriggerChance"] = RequiredNumber(
                        notify,
                        "NotifyTriggerChance"),
                    ["NotifyFilterType"] = StripEnumPrefix(
                        notify.Value<string>("NotifyFilterType")),
                    ["NotifyFilterLOD"] =
                        notify.Value<int>("NotifyFilterLOD"),
                    ["bTriggerOnDedicatedServer"] =
                        notify.Value<bool>(
                            "bTriggerOnDedicatedServer"),
                    ["bTriggerOnFollower"] =
                        notify.Value<bool>("bTriggerOnFollower"),
                    ["TrackIndex"] =
                        notify.Value<int>("TrackIndex"),
                    ["LinkMethod"] = StripEnumPrefix(
                        notify.Value<string>("LinkMethod")),
                    ["SlotIndex"] =
                        notify.Value<int>("SlotIndex"),
                    ["SegmentIndex"] =
                        notify.Value<int>("SegmentIndex"),
                    ["linkedClass"] = NormalizeLinkedNotifyClass(
                        notify,
                        packageExports,
                        assetName),
                });
        }
        return notifies;
    }

    static JObject NormalizeLinkedNotifyClass(
        JObject notify,
        IReadOnlyList<UObject> packageExports,
        string assetName)
    {
        var propertyName =
            notify.SelectToken("NotifyStateClass.ObjectName")
                    ?.Value<string>() is not null
                ? "NotifyStateClass"
                : notify.SelectToken("Notify.ObjectName")
                      ?.Value<string>() is not null
                    ? "Notify"
                    : throw new Exception(
                        $"{assetName}.{notify.Value<string>("NotifyName")} " +
                        "has neither Notify nor NotifyStateClass");
        var objectName = notify
                             .SelectToken($"{propertyName}.ObjectName")
                             ?.Value<string>()
                         ?? throw new Exception(
                             $"{assetName} {propertyName} has no ObjectName");
        var exportName = ReadObjectLeafName(objectName);
        var exportObject = packageExports.SingleOrDefault(
                               candidate =>
                                   candidate.Name == exportName)
                           ?? throw new Exception(
                               $"{assetName} package has no {exportName}");
        var linkedClass = JObject.FromObject(
            exportObject,
            Serializer);
        return new JObject
        {
            ["kind"] = propertyName,
            ["name"] = exportName,
            ["type"] = linkedClass.Value<string>("Type"),
            ["properties"] =
                linkedClass["Properties"]?.DeepClone()
                ?? new JObject(),
        };
    }

    static JArray NormalizeBranchingPointMarkers(
        JObject montageProperties)
    {
        return new JArray(
            montageProperties["BranchingPointMarkers"]
                ?.OfType<JObject>()
                .Select(
                    marker =>
                        new JObject
                        {
                            ["NotifyIndex"] =
                                marker.Value<int>("NotifyIndex"),
                            ["TriggerTime"] = RequiredNumber(
                                marker,
                                "TriggerTime"),
                            ["NotifyEventType"] = StripEnumPrefix(
                                marker.Value<string>(
                                    "NotifyEventType")),
                        })
            ?? []);
    }

    static JObject NormalizeBlend(
        JObject? blend,
        string propertyName)
    {
        if (blend is null)
        {
            throw new Exception(
                $"montage has no {propertyName}");
        }
        return new JObject
        {
            ["BlendTime"] = RequiredNumber(
                blend,
                "BlendTime"),
            // FAlphaBlendArgs omits its default Linear enum.
            ["BlendOption"] = StripEnumPrefix(
                blend.Value<string>("BlendOption"))
                ?? "Linear",
            ["serializedBlendOption"] =
                blend["BlendOption"] is not null,
        };
    }

    static string ReadReferenceName(
        JObject parent,
        string propertyName)
    {
        return ReadObjectLeafName(
            parent.SelectToken($"{propertyName}.ObjectName")
                ?.Value<string>()
            ?? throw new Exception(
                $"{propertyName} has no ObjectName"));
    }

    static string ReadObjectLeafName(string objectName)
    {
        var firstQuote = objectName.IndexOf('\'');
        var lastQuote = objectName.LastIndexOf('\'');
        var qualified = firstQuote >= 0 && lastQuote > firstQuote
            ? objectName[(firstQuote + 1)..lastQuote]
            : objectName;
        var colon = qualified.LastIndexOf(':');
        var dot = qualified.LastIndexOf('.');
        var separator = Math.Max(colon, dot);
        return separator >= 0
            ? qualified[(separator + 1)..]
            : qualified;
    }

    static string? StripEnumPrefix(string? value)
    {
        if (value is null)
        {
            return null;
        }
        var separator = value.LastIndexOf(
            "::",
            StringComparison.Ordinal);
        return separator < 0
            ? value
            : value[(separator + 2)..];
    }

    static double RequiredNumber(
        JObject obj,
        string propertyName)
    {
        return obj[propertyName]?.Type is
            JTokenType.Float or JTokenType.Integer
            ? obj.Value<double>(propertyName)
            : throw new Exception(
                $"{propertyName} is missing or not numeric");
    }

    static JArray ValidatePayload(JObject payload)
    {
        return new JArray
        {
            ValidateInventory(payload),
            ValidateEffectiveSettings(payload),
            ValidateSerializedOverrides(payload),
            ValidateMontageClocks(payload),
            ValidateActionNotifyEndpoints(payload),
            ValidateSequenceActionContent(payload),
        };
    }

    static JObject ValidateInventory(JObject payload)
    {
        var montages = payload["montages"] as JObject
                       ?? new JObject();
        var sequences = payload["sequences"] as JObject
                        ?? new JObject();
        var actualMontages = montages.Properties()
            .Select(property => property.Name)
            .Order(StringComparer.Ordinal)
            .ToArray();
        var actualSequences = sequences.Properties()
            .Select(property => property.Name)
            .Order(StringComparer.Ordinal)
            .ToArray();
        var expectedMontages = ExpectedMontages
            .Select(entry => entry.Montage)
            .Order(StringComparer.Ordinal)
            .ToArray();
        return Validation(
            "action-content-exact-inventory",
            actualMontages.SequenceEqual(expectedMontages)
            && actualSequences.SequenceEqual(
                ExpectedSequences.Order(StringComparer.Ordinal)),
            new JObject
            {
                ["montages"] = new JArray(actualMontages),
                ["sequences"] = new JArray(actualSequences),
            });
    }

    static JObject ValidateEffectiveSettings(JObject payload)
    {
        var rolling = payload
                          .SelectToken("settings.Rolling")
                      as JObject
                      ?? new JObject();
        var ragdolling = payload
                             .SelectToken("settings.Ragdolling")
                         as JObject
                         ?? new JObject();
        var pass =
            rolling.Value<string>("Montage")
            == "AM_Als_Roll"
            && rolling.Value<bool?>("bCrouchOnStart") == true
            && rolling.Value<bool?>("bRotateToInputOnStart") == true
            && Nearly(
                rolling.Value<double?>(
                    "RotationInterpolationSpeed"),
                10)
            && rolling.Value<bool?>("bStartRollingOnLand") == true
            && Nearly(
                rolling.Value<double?>(
                    "RollingOnLandSpeedThreshold"),
                700)
            && rolling.Value<bool?>(
                "bInterruptRollingWhenInAir") == false
            && ragdolling.Value<bool?>(
                "bStartRagdollingOnLand") == true
            && Nearly(
                ragdolling.Value<double?>(
                    "RagdollingOnLandSpeedThreshold"),
                1000)
            && ragdolling.Value<bool?>(
                "bLimitInitialRagdollSpeed") == true
            && ragdolling.Value<string>("GetUpFrontMontage")
            == "AM_Als_GetUp_Front"
            && ragdolling.Value<string>("GetUpBackMontage")
            == "AM_Als_GetUp_Back";
        return Validation(
            "CS_Als_Default-effective-action-settings",
            pass,
            new JObject
            {
                ["Rolling"] = rolling.DeepClone(),
                ["Ragdolling"] = ragdolling.DeepClone(),
            });
    }

    static JObject ValidateSerializedOverrides(JObject payload)
    {
        var rolling = payload
                          .SelectToken("serializedOverrides.Rolling")
                      as JObject
                      ?? new JObject();
        var ragdolling = payload
                             .SelectToken(
                                 "serializedOverrides.Ragdolling")
                         as JObject
                         ?? new JObject();
        var pass =
            TokenSetEquals(
                rolling,
                ["Montage", "bInterruptRollingWhenInAir"])
            && ReadReferenceName(rolling, "Montage")
            == "AM_Als_Roll"
            && rolling.Value<bool?>(
                "bInterruptRollingWhenInAir") == false
            && TokenSetEquals(
                ragdolling,
                ["GetUpBackMontage", "GetUpFrontMontage"])
            && ReadReferenceName(
                ragdolling,
                "GetUpFrontMontage")
            == "AM_Als_GetUp_Front"
            && ReadReferenceName(
                ragdolling,
                "GetUpBackMontage")
            == "AM_Als_GetUp_Back";
        return Validation(
            "CS_Als_Default-action-overrides-only",
            pass,
            payload["serializedOverrides"]?.DeepClone()
            ?? new JObject());
    }

    static JObject ValidateMontageClocks(JObject payload)
    {
        var montages = payload["montages"] as JObject
                       ?? new JObject();
        var errors = new JArray();
        ValidateMontageClock(
            montages,
            errors,
            "AM_Als_Roll",
            "A_Als_Roll",
            1,
            0.1,
            "HermiteCubic",
            0.3,
            "HermiteCubic",
            1.5);
        ValidateMontageClock(
            montages,
            errors,
            "AM_Als_GetUp_Front",
            "A_Als_GetUp_Front",
            1.2,
            0,
            "Linear",
            0.3,
            "Cubic",
            1.25);
        ValidateMontageClock(
            montages,
            errors,
            "AM_Als_GetUp_Back",
            "A_Als_GetUp_Back",
            1.2,
            0,
            "Linear",
            0.3,
            "Cubic",
            1.25);
        return Validation(
            "action-montage-clocks-and-PostLocomotion-slot",
            errors.Count == 0,
            new JObject
            {
                ["errors"] = errors,
                ["montages"] = montages.DeepClone(),
            });
    }

    static void ValidateMontageClock(
        JObject montages,
        JArray errors,
        string montageName,
        string sequenceName,
        double rateScale,
        double blendInTime,
        string blendInOption,
        double blendOutTime,
        string blendOutOption,
        double effectiveDuration)
    {
        var montage = montages[montageName] as JObject;
        if (montage is null
            || !Nearly(
                montage.Value<double?>("SequenceLength"),
                1.5)
            || !Nearly(
                montage.Value<double?>("RateScale"),
                rateScale)
            || !Nearly(
                montage.Value<double?>(
                    "effectiveDurationSecondsAtPlayRateOne"),
                effectiveDuration)
            || montage
                   .SelectToken("SamplingFrameRate.Numerator")
                   ?.Value<int>() != 30
            || montage
                   .SelectToken("SamplingFrameRate.Denominator")
                   ?.Value<int>() != 1
            || !Nearly(
                montage
                    .SelectToken("BlendIn.BlendTime")
                    ?.Value<double>(),
                blendInTime)
            || montage
                   .SelectToken("BlendIn.BlendOption")
                   ?.Value<string>() != blendInOption
            || !Nearly(
                montage
                    .SelectToken("BlendOut.BlendTime")
                    ?.Value<double>(),
                blendOutTime)
            || montage
                   .SelectToken("BlendOut.BlendOption")
                   ?.Value<string>() != blendOutOption
            || !Nearly(
                montage.Value<double?>("BlendOutTriggerTime"),
                -1)
            || montage
                   .SelectToken("section.SectionName")
                   ?.Value<string>() != "Default"
            || montage
                   .SelectToken("section.NextSectionName")
                   ?.Value<string>() != "None"
            || montage
                   .SelectToken("section.LinkMethod")
                   ?.Value<string>() != "Absolute"
            || !Nearly(
                montage
                    .SelectToken("section.SegmentBeginTime")
                    ?.Value<double>(),
                0)
            || !Nearly(
                montage
                    .SelectToken("section.SegmentLength")
                    ?.Value<double>(),
                1.5)
            || !Nearly(
                montage
                    .SelectToken("section.LinkValue")
                    ?.Value<double>(),
                0)
            || montage
                   .SelectToken("slot.SlotName")
                   ?.Value<string>() != "PostLocomotion"
            || montage
                   .SelectToken("slot.sequence")
                   ?.Value<string>() != sequenceName
            || !Nearly(
                montage
                    .SelectToken("slot.StartPos")
                    ?.Value<double>(),
                0)
            || !Nearly(
                montage
                    .SelectToken("slot.AnimStartTime")
                    ?.Value<double>(),
                0)
            || !Nearly(
                montage
                    .SelectToken("slot.AnimEndTime")
                    ?.Value<double>(),
                1.5)
            || !Nearly(
                montage
                    .SelectToken("slot.AnimPlayRate")
                    ?.Value<double>(),
                1)
            || montage
                   .SelectToken("slot.LoopingCount")
                   ?.Value<int>() != 1)
        {
            errors.Add(montageName);
        }
    }

    static JObject ValidateActionNotifyEndpoints(JObject payload)
    {
        var montages = payload["montages"] as JObject
                       ?? new JObject();
        var errors = new JArray();
        ValidateActionNotify(
            montages,
            errors,
            "AM_Als_Roll",
            "Als.LocomotionAction.Rolling",
            0.933333,
            0.0001,
            0.0001,
            0.933433);
        ValidateActionNotify(
            montages,
            errors,
            "AM_Als_GetUp_Front",
            "Als.LocomotionAction.GettingUp",
            1.1666666,
            -0.0001,
            -0.0001,
            1.1665666);
        ValidateActionNotify(
            montages,
            errors,
            "AM_Als_GetUp_Back",
            "Als.LocomotionAction.GettingUp",
            1.1666666,
            -0.0001,
            -0.0001,
            1.1665666);
        return Validation(
            "action-notify-state-endpoints-and-branch-markers",
            errors.Count == 0,
            new JObject
            {
                ["errors"] = errors,
                ["montages"] = montages.DeepClone(),
            });
    }

    static void ValidateActionNotify(
        JObject montages,
        JArray errors,
        string montageName,
        string actionTag,
        double duration,
        double triggerOffset,
        double beginMarker,
        double endMarker)
    {
        var montage = montages[montageName] as JObject;
        var notifies = montage?["notifies"] as JArray;
        var markers =
            montage?["branchingPointMarkers"] as JArray;
        var indices =
            montage?["branchingPointStateNotifyIndices"] as JArray;
        var notify = notifies?.SingleOrDefault() as JObject;
        if (montage is null
            || notifies?.Count != 1
            || notify?.Value<string>("NotifyName")
            != "BMNotifyStateMovementAction"
            || !Nearly(
                notify?.Value<double>("startTime"),
                0)
            || !Nearly(
                notify?.Value<double>("duration"),
                duration)
            || !Nearly(
                notify?.Value<double>("endTime"),
                duration)
            || !Nearly(
                notify?.Value<double>("TriggerTimeOffset"),
                triggerOffset)
            || !Nearly(
                notify?.Value<double>("EndTriggerTimeOffset"),
                0)
            || notify?.Value<string>("MontageTickType")
            != "Queued"
            || notify
                   ?.SelectToken("linkedClass.kind")
                   ?.Value<string>() != "NotifyStateClass"
            || notify
                   ?.SelectToken("linkedClass.type")
                   ?.Value<string>()
            != "AlsAnimNotifyState_SetLocomotionAction"
            || notify
                   ?.SelectToken(
                       "linkedClass.properties.LocomotionAction.TagName")
                   ?.Value<string>() != actionTag
            || markers?.Count != 2
            || markers[0]?.Value<int>("NotifyIndex") != 0
            || !Nearly(
                markers[0]?.Value<double>("TriggerTime"),
                beginMarker)
            || markers[0]?.Value<string>("NotifyEventType")
            != "Begin"
            || markers[1]?.Value<int>("NotifyIndex") != 0
            || !Nearly(
                markers[1]?.Value<double>("TriggerTime"),
                endMarker)
            || markers[1]?.Value<string>("NotifyEventType")
            != "End"
            || indices?.Count != 1
            || indices[0]?.Value<int>() != 0)
        {
            errors.Add(montageName);
        }
    }

    static JObject ValidateSequenceActionContent(JObject payload)
    {
        var sequences = payload["sequences"] as JObject
                        ?? new JObject();
        var roll = sequences["A_Als_Roll"] as JObject;
        var front =
            sequences["A_Als_GetUp_Front"] as JObject;
        var back =
            sequences["A_Als_GetUp_Back"] as JObject;
        var rollNotifies = roll?["notifies"] as JArray;
        var rootScale = rollNotifies
            ?.OfType<JObject>()
            .SingleOrDefault(
                notify =>
                    notify
                        .SelectToken("linkedClass.type")
                        ?.Value<string>()
                    == "AlsAnimNotifyState_SetRootMotionScale");
        var fromRoll = rollNotifies
            ?.OfType<JObject>()
            .SingleOrDefault(
                notify =>
                    notify
                        .SelectToken("linkedClass.type")
                        ?.Value<string>()
                    == "AlsAnimNotify_SetGroundedEntryMode");
        var expectedRollNotifyNames = new[]
        {
            "AlsRootMotionScale",
            "AlsCameraShake",
            "AlsCameraShake",
            "AlsSetGroundedEntryMode",
            "AlsFootstepEffects",
            "AlsFootstepEffects",
            "AlsFootstepEffects",
        };
        var getUpSequences = new[] {front, back};
        var pass =
            roll is not null
            && Nearly(
                roll.Value<double?>("SequenceLength"),
                1.5)
            && Nearly(roll.Value<double?>("RateScale"), 1)
            && roll.SelectToken("rootMotion.bEnableRootMotion")
                   ?.Value<bool>() == true
            && roll.SelectToken("rootMotion.bForceRootLock")
                   ?.Value<bool>() == true
            && roll.SelectToken("rootMotion.RootMotionRootLock")
                   ?.Value<string>() == "RefPose"
            && rollNotifies is not null
            && rollNotifies
                .Select(
                    notify =>
                        notify?.Value<string>("NotifyName"))
                .SequenceEqual(expectedRollNotifyNames)
            && rootScale is not null
            && rootScale
                   .SelectToken("linkedClass.kind")
                   ?.Value<string>() == "NotifyStateClass"
            && Nearly(
                rootScale.Value<double?>("startTime"),
                0)
            && Nearly(
                rootScale.Value<double?>("duration"),
                1.5)
            && Nearly(
                rootScale.Value<double?>("endTime"),
                1.5)
            && Nearly(
                rootScale
                    .SelectToken(
                        "linkedClass.properties.TranslationScale")
                    ?.Value<double>(),
                1.3)
            && fromRoll is not null
            && fromRoll
                   .SelectToken("linkedClass.kind")
                   ?.Value<string>() == "Notify"
            && Nearly(
                fromRoll.Value<double?>("startTime"),
                0.93333334)
            && fromRoll
                   .SelectToken(
                       "linkedClass.properties.GroundedEntryMode.TagName")
                   ?.Value<string>()
            == "Als.GroundedEntryMode.FromRoll"
            && getUpSequences.All(
                sequence =>
                    sequence is not null
                    && Nearly(
                        sequence.Value<double?>("SequenceLength"),
                        1.5)
                    && Nearly(
                        sequence.Value<double?>("RateScale"),
                        1)
                    && sequence
                           .SelectToken(
                               "rootMotion.bEnableRootMotion")
                           ?.Value<bool>() == false
                    && sequence
                           .SelectToken(
                               "rootMotion.bForceRootLock")
                           ?.Value<bool>() == false
                    && sequence
                           .SelectToken(
                               "rootMotion.RootMotionRootLock")
                           ?.Value<string>() == "RefPose"
                    && sequence["notifies"] is JArray
                    {
                        Count: 2
                    } getUpNotifies
                    && getUpNotifies.All(
                        notify =>
                            notify?.Value<string>("NotifyName")
                            == "BMAnimNotifyFootstep"));
        return Validation(
            "roll-root-motion-scale-FromRoll-and-get-up-sequences",
            pass,
            new JObject
            {
                ["roll"] = roll?.DeepClone(),
                ["getUpFront"] = front?.DeepClone(),
                ["getUpBack"] = back?.DeepClone(),
            });
    }

    static bool TokenSetEquals(
        JObject actual,
        IReadOnlyList<string> expected)
    {
        return actual.Properties()
            .Select(property => property.Name)
            .Order(StringComparer.Ordinal)
            .SequenceEqual(expected.Order(StringComparer.Ordinal));
    }

    static bool Nearly(double? value, double expected)
    {
        return value is not null
               && Math.Abs(value.Value - expected) <= 1e-6;
    }

    static JObject Validation(
        string name,
        bool pass,
        JToken details)
    {
        return new JObject
        {
            ["name"] = name,
            ["pass"] = pass,
            ["details"] = details,
        };
    }

    static void PrintValidations(JArray validations)
    {
        foreach (var validation in validations.OfType<JObject>())
        {
            Console.WriteLine(
                $"{(validation.Value<bool>("pass") ? "PASS" : "FAIL")} " +
                validation.Value<string>("name"));
        }
    }

    static void ThrowOnValidationFailure(JArray validations)
    {
        var failures = validations.OfType<JObject>()
            .Where(validation => !validation.Value<bool>("pass"))
            .Select(
                validation =>
                    $"{validation.Value<string>("name")}: " +
                    validation["details"]?.ToString(Formatting.None))
            .ToArray();
        if (failures.Length > 0)
        {
            throw new Exception(
                "action content validation failed:\n" +
                string.Join("\n", failures));
        }
    }
}
