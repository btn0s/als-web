using System.Globalization;
using System.Text.RegularExpressions;
using CUE4Parse.FileProvider;
using CUE4Parse.UE4.Assets;
using CUE4Parse.UE4.Assets.Exports;
using CUE4Parse.UE4.Assets.Exports.EdGraph;
using CUE4Parse.UE4.Versions;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

// Freezes the complete ALS mantling input used by the framework-free runtime:
// character defaults/overrides, the exact B_Als_Character selection graph,
// settings assets, montage clocks/notifies, and correction curves.
public static class MantlingContentDump
{
    const string CharacterSettingsAsset = "CS_Als_Default";
    const string CharacterBlueprintAsset = "B_Als_Character";
    const string CharacterSettingsPath = "/Content/ALS/Data/Character/";
    const string CharacterBlueprintPath = "/Content/ALS/Character/";
    const string MantlingPath = "/Content/ALS/Data/Character/Mantle/";
    const string MontagePath = "/Content/ALS/Animations/Actions/Mantle/";
    const string MantlingSettingsHeader =
        "Source/ALS/Public/Settings/AlsMantlingSettings.h";
    const string CharacterSettingsSource =
        "Source/ALS/Private/Settings/AlsCharacterSettings.cpp";
    const string CharacterActionsSource =
        "Source/ALS/Private/AlsCharacter_Actions.cpp";
    const string RootMotionSource =
        "Source/ALS/Private/RootMotionSources/AlsRootMotionSource_Mantling.cpp";

    static readonly string[] ExpectedSettings =
    [
        "MS_Als_High",
        "MS_Als_Low",
        "MS_Als_Low_BothHands",
        "MS_Als_Low_Box",
        "MS_Als_Low_Left",
        "MS_Als_Low_Right",
    ];

    static readonly string[] ExpectedCurves =
    [
        "CF_Als_Mantle_High_HorizontalCorrection",
        "CF_Als_Mantle_High_VerticalCorrection",
        "CF_Als_Mantle_Low_HorizontalCorrection",
        "CF_Als_Mantle_Low_VerticalCorrection",
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
        RegisterBlueprintNodeReaders();

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
        var general = NormalizeGeneralMantlingSettings(
            characterSettings.Export,
            cppDefaults);
        var selection = NormalizeBlueprintSelection(
            LoadAsset(
                provider,
                CharacterBlueprintAsset,
                CharacterBlueprintPath,
                "Blueprint"));

        var settings = new JObject();
        var montages = new JObject();
        var curves = new JObject();
        foreach (var settingsName in ExpectedSettings)
        {
            var settingsRecord = LoadAsset(
                provider,
                settingsName,
                MantlingPath,
                "AlsMantlingSettings");
            var normalizedSettings = NormalizeMantlingSettings(
                settingsRecord.Export,
                cppDefaults);
            settings[settingsName] = normalizedSettings;

            var montageName = normalizedSettings.Value<string>("Montage")
                              ?? throw new Exception(
                                  $"{settingsName} has no normalized Montage");
            if (montages[montageName] is null)
            {
                montages[montageName] = NormalizeMontage(
                    provider,
                    LoadAsset(
                        provider,
                        montageName,
                        MontagePath,
                        "AnimMontage"));
            }

            foreach (var propertyName in new[]
                     {
                         "HorizontalCorrectionCurve",
                         "VerticalCorrectionCurve",
                     })
            {
                var curveName = normalizedSettings.Value<string>(propertyName)
                                ?? throw new Exception(
                                    $"{settingsName}.{propertyName} is missing");
                if (curves[curveName] is null)
                {
                    curves[curveName] = NormalizeCurve(
                        LoadAsset(
                            provider,
                            curveName,
                            MantlingPath,
                            "CurveFloat"));
                }
            }
        }

        var payload = new JObject
        {
            ["schemaVersion"] = 2,
            ["source"] = new JObject
            {
                ["engineVersion"] = "UE5.5",
                ["referenceRelease"] = "ALS Refactored 4.15",
                ["characterSettingsAssetPath"] = characterSettings.Path,
                ["characterBlueprintAssetPath"] =
                    selection.Value<string>("assetPath"),
                ["cppDefaults"] = new JArray(
                    MantlingSettingsHeader,
                    CharacterSettingsSource),
                ["characterActions"] = CharacterActionsSource,
                ["rootMotionSource"] = RootMotionSource,
            },
            ["general"] = general,
            ["selection"] = selection,
            ["settings"] = settings,
            ["montages"] = montages,
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
            $"dumped {settings.Count} mantling settings, {montages.Count} montages, " +
            $"{curves.Count} correction curves -> {outJson} " +
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

    static void RegisterBlueprintNodeReaders()
    {
        // These concrete editor node classes otherwise fall back to UObject and
        // CUE4Parse skips their native UEdGraphPin arrays. Registering the common
        // UK2Node reader makes the SelectMantlingSettings links/default objects
        // independently queryable instead of relying on package strings.
        ObjectTypeRegistry.RegisterClass(
            "K2Node_FunctionEntry",
            typeof(UK2Node));
        ObjectTypeRegistry.RegisterClass(
            "K2Node_FunctionResult",
            typeof(UK2Node));
        ObjectTypeRegistry.RegisterClass(
            "K2Node_SwitchEnum",
            typeof(UK2Node));
        ObjectTypeRegistry.RegisterClass(
            "K2Node_VariableGet",
            typeof(UK2Node));
        ObjectTypeRegistry.RegisterClass(
            "GameplayTagsK2Node_SwitchGameplayTag",
            typeof(UK2Node));
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
                           && candidate.Path.Replace('\\', '/').Contains(
                               requiredPath,
                               StringComparison.Ordinal))
                   ?? throw new Exception(
                       $"{assetName}.uasset was not found exactly once below " +
                       requiredPath);
        var package = provider.LoadPackage(file);
        var exports = package.GetExports().ToArray();
        var exportObject = exports.FirstOrDefault(
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
        var header = ReadSource(srcDir, MantlingSettingsHeader);
        var settingsSource = ReadSource(srcDir, CharacterSettingsSource);
        var slopeThreshold = ReadFloatDefault(
            header,
            "SlopeAngleThreshold");
        var groundedTrace = new JObject
        {
            ["LedgeHeight"] = ReadVector2Default(header, "LedgeHeight"),
            ["ReachDistance"] = ReadFloatDefault(header, "ReachDistance"),
            ["TargetLocationOffset"] =
                ReadFloatDefault(header, "TargetLocationOffset"),
            ["StartLocationOffset"] =
                ReadFloatDefault(header, "StartLocationOffset"),
            ["bDrawFailedTraces"] =
                ReadBoolDefault(header, "bDrawFailedTraces"),
        };
        var inAirMatch = Regex.Match(
            header,
            @"\bInAirTrace\s*\{\s*\{\s*(?<min>[-+\d.]+)f?\s*,\s*" +
            @"(?<max>[-+\d.]+)f?\s*\}\s*,\s*(?<reach>[-+\d.]+)f?\s*\}");
        if (!inAirMatch.Success)
        {
            throw new Exception(
                $"{MantlingSettingsHeader} has no readable InAirTrace initializer");
        }
        var inAirTrace = (JObject)groundedTrace.DeepClone();
        inAirTrace["LedgeHeight"] = new JArray(
            ParseNumber(inAirMatch.Groups["min"].Value),
            ParseNumber(inAirMatch.Groups["max"].Value));
        inAirTrace["ReachDistance"] =
            ParseNumber(inAirMatch.Groups["reach"].Value);

        var responseMatch = Regex.Match(
            settingsSource,
            @"Mantling\.MantlingTraceResponseChannels\s*=\s*\{(?<body>[^}]*)\}",
            RegexOptions.Singleline);
        if (!responseMatch.Success)
        {
            throw new Exception(
                $"{CharacterSettingsSource} has no mantling response channels");
        }
        var responseChannels = Regex.Matches(
                responseMatch.Groups["body"].Value,
                @"ECC_(?<name>[A-Za-z0-9_]+)")
            .Select(match => match.Groups["name"].Value)
            .ToArray();

        return new JObject
        {
            ["bAllowMantling"] = ReadBoolDefault(header, "bAllowMantling"),
            ["TraceAngleThreshold"] =
                ReadFloatDefault(header, "TraceAngleThreshold"),
            ["MaxReachAngle"] = ReadFloatDefault(header, "MaxReachAngle"),
            ["SlopeAngleThreshold"] = slopeThreshold,
            ["SlopeAngleThresholdCos"] =
                Math.Cos(slopeThreshold * Math.PI / 180.0),
            ["TargetPrimitiveSpeedThreshold"] =
                ReadFloatDefault(header, "TargetPrimitiveSpeedThreshold"),
            ["MantlingHighHeightThreshold"] =
                ReadFloatDefault(header, "MantlingHighHeightThreshold"),
            ["GroundedTrace"] = groundedTrace,
            ["InAirTrace"] = inAirTrace,
            ["MantlingTraceChannel"] =
                ReadEnumDefault(header, "MantlingTraceChannel", "ECC_"),
            ["MantlingTraceResponseChannels"] =
                new JArray(responseChannels),
            ["BlendOutDuration"] =
                ReadFloatDefault(header, "BlendOutDuration"),
            ["bStartRagdollingOnTargetPrimitiveDestruction"] =
                ReadBoolDefault(
                    header,
                    "bStartRagdollingOnTargetPrimitiveDestruction"),
            ["bAutoCalculateStartTime"] =
                ReadBoolDefault(header, "bAutoCalculateStartTime"),
            ["StartTimeReferenceHeight"] =
                ReadVector2Default(header, "StartTimeReferenceHeight"),
            ["StartTime"] = ReadVector2Default(header, "StartTime"),
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

    static double ParseNumber(string value)
    {
        return double.Parse(
            value,
            NumberStyles.Float,
            CultureInfo.InvariantCulture);
    }

    static double ReadFloatDefault(string source, string propertyName)
    {
        var match = Regex.Match(
            source,
            $@"\b{Regex.Escape(propertyName)}\s*\{{\s*" +
            @"(?<value>[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?)" +
            @"[fF]?\s*\}");
        if (!match.Success)
        {
            throw new Exception(
                $"{propertyName} has no float default initializer in " +
                MantlingSettingsHeader);
        }
        return ParseNumber(match.Groups["value"].Value);
    }

    static bool ReadBoolDefault(string source, string propertyName)
    {
        var match = Regex.Match(
            source,
            $@"\b{Regex.Escape(propertyName)}\s*(?::\s*1\s*)?\{{\s*" +
            @"(?<value>true|false)\s*\}");
        if (!match.Success)
        {
            throw new Exception(
                $"{propertyName} has no bool default initializer in " +
                MantlingSettingsHeader);
        }
        return bool.Parse(match.Groups["value"].Value);
    }

    static JArray ReadVector2Default(string source, string propertyName)
    {
        var match = Regex.Match(
            source,
            $@"\b{Regex.Escape(propertyName)}\s*\{{\s*" +
            @"(?<x>[-+\d.]+)[fF]?\s*,\s*(?<y>[-+\d.]+)[fF]?\s*\}");
        if (!match.Success)
        {
            throw new Exception(
                $"{propertyName} has no FVector2f default initializer in " +
                MantlingSettingsHeader);
        }
        return new JArray(
            ParseNumber(match.Groups["x"].Value),
            ParseNumber(match.Groups["y"].Value));
    }

    static string ReadEnumDefault(
        string source,
        string propertyName,
        string prefix)
    {
        var match = Regex.Match(
            source,
            $@"\b{Regex.Escape(propertyName)}\s*\{{\s*" +
            $@"{Regex.Escape(prefix)}(?<value>[A-Za-z0-9_]+)\s*\}}");
        if (!match.Success)
        {
            throw new Exception(
                $"{propertyName} has no enum default initializer in " +
                MantlingSettingsHeader);
        }
        return match.Groups["value"].Value;
    }

    static JObject NormalizeGeneralMantlingSettings(
        JObject characterSettingsExport,
        JObject cppDefaults)
    {
        var general = new JObject();
        foreach (var property in cppDefaults.Properties()
                     .Where(property => property.Name is not
                         ("bAutoCalculateStartTime"
                         or "StartTimeReferenceHeight"
                         or "StartTime")))
        {
            general[property.Name] = property.Value.DeepClone();
        }

        var serialized = characterSettingsExport
            .SelectToken("Properties.Mantling") as JObject;
        if (serialized is not null)
        {
            MergeStruct(general, serialized);
        }
        general["asset"] = CharacterSettingsAsset;
        general["nativeDistanceUnit"] = "cm";
        general["nativeSpeedUnit"] = "cm/s";
        general["nativeAngleUnit"] = "deg";
        return general;
    }

    static void MergeStruct(JObject target, JObject serialized)
    {
        foreach (var property in serialized.Properties())
        {
            if (property.Value is JObject serializedObject
                && target[property.Name] is JObject targetObject)
            {
                MergeStruct(targetObject, serializedObject);
            }
            else
            {
                target[property.Name] = NormalizeStructValue(
                    property.Name,
                    property.Value);
            }
        }
    }

    static JToken NormalizeStructValue(string propertyName, JToken value)
    {
        if (propertyName == "LedgeHeight" && value is JObject vector)
        {
            return new JArray(
                RequiredNumber(vector, "X"),
                RequiredNumber(vector, "Y"));
        }
        return value.DeepClone();
    }

    static JObject NormalizeMantlingSettings(
        JObject settingsExport,
        JObject cppDefaults)
    {
        var assetName = settingsExport.Value<string>("Name")
                        ?? throw new Exception(
                            "mantling settings export has no name");
        var properties = settingsExport["Properties"] as JObject
                         ?? throw new Exception(
                             $"{assetName} has no properties");
        return new JObject
        {
            ["asset"] = assetName,
            ["nativeDistanceUnit"] = "cm",
            ["Montage"] = ReadReferenceName(properties, "Montage"),
            ["bAutoCalculateStartTime"] =
                properties.Value<bool?>("bAutoCalculateStartTime")
                ?? cppDefaults.Value<bool>("bAutoCalculateStartTime"),
            ["StartTimeReferenceHeight"] =
                ReadVector2(
                    properties["StartTimeReferenceHeight"],
                    (JArray)cppDefaults["StartTimeReferenceHeight"]!),
            ["StartTime"] =
                ReadVector2(
                    properties["StartTime"],
                    (JArray)cppDefaults["StartTime"]!),
            ["HorizontalCorrectionCurve"] =
                ReadReferenceName(properties, "HorizontalCorrectionCurve"),
            ["VerticalCorrectionCurve"] =
                ReadReferenceName(properties, "VerticalCorrectionCurve"),
        };
    }

    static JArray ReadVector2(JToken? serialized, JArray defaultValue)
    {
        if (serialized is not JObject vector)
        {
            return (JArray)defaultValue.DeepClone();
        }
        return new JArray(
            RequiredNumber(vector, "X"),
            RequiredNumber(vector, "Y"));
    }

    static JObject NormalizeBlueprintSelection(AssetRecord blueprint)
    {
        var nodes = blueprint.Exports
            .Where(
                export => JObject.FromObject(export, Serializer)
                    .SelectToken("Outer.ObjectName")
                    ?.Value<string>()
                    == "EdGraph'B_Als_Character:SelectMantlingSettings'")
            .ToDictionary(
                export => export.Name,
                export => JObject.FromObject(export, Serializer),
                StringComparer.Ordinal);
        var enumSwitch = RequiredNode(nodes, "K2Node_SwitchEnum_0");
        var overlaySwitch = RequiredNode(
            nodes,
            "GameplayTagsK2Node_SwitchGameplayTag_0");

        var highResult = FollowOutputNode(enumSwitch, "High");
        var inAirResult = FollowOutputNode(enumSwitch, "InAir");
        var lowSwitchNode = FollowOutputNode(enumSwitch, "Low");
        if (lowSwitchNode !=
            "GameplayTagsK2Node_SwitchGameplayTag_0")
        {
            throw new Exception(
                $"B_Als_Character Low branch targets {lowSwitchNode}");
        }
        var lowSelections = new JObject();
        var lowResultNodes = new JObject();
        foreach (var pin in overlaySwitch["Pins"]?.OfType<JObject>()
                     .Where(
                         candidate =>
                             candidate.Value<string>("Direction")
                             == "EGPD_Output"
                             && candidate["LinkedTo"] is JArray
                             {
                                 Count: 1
                             })
                     ?? [])
        {
            var pinName = pin.Value<string>("PinName")
                          ?? throw new Exception(
                              "low overlay switch output has no PinName");
            var resultNode = FollowOutputNode(overlaySwitch, pinName);
            lowSelections[pinName] =
                ReadResultDefaultObject(nodes, resultNode);
            lowResultNodes[pinName] = resultNode;
        }
        if (lowSelections.Count == 0)
        {
            throw new Exception(
                "B_Als_Character low overlay switch has no linked outputs");
        }

        return new JObject
        {
            ["asset"] = CharacterBlueprintAsset,
            ["assetPath"] = blueprint.Path,
            ["High"] = ReadResultDefaultObject(nodes, highResult),
            ["Low"] = lowSelections,
            ["InAir"] = ReadResultDefaultObject(nodes, inAirResult),
            ["evidence"] = new JObject
            {
                ["enumSwitchNode"] = "K2Node_SwitchEnum_0",
                ["lowOverlaySwitchNode"] =
                    "GameplayTagsK2Node_SwitchGameplayTag_0",
                ["lowResultNodes"] = lowResultNodes,
            },
        };
    }

    static JObject RequiredNode(
        IReadOnlyDictionary<string, JObject> nodes,
        string nodeName)
    {
        return nodes.TryGetValue(nodeName, out var node)
            ? node
            : throw new Exception(
                $"B_Als_Character SelectMantlingSettings has no {nodeName}");
    }

    static string FollowOutputNode(JObject node, string pinName)
    {
        var pin = node["Pins"]?.OfType<JObject>().SingleOrDefault(
                      candidate =>
                          candidate.Value<string>("PinName") == pinName
                          && candidate.Value<string>("Direction")
                          == "EGPD_Output")
                  ?? throw new Exception(
                      $"{node.Value<string>("Name")}.{pinName} output is missing");
        var linked = pin["LinkedTo"] as JArray
                     ?? throw new Exception(
                         $"{node.Value<string>("Name")}.{pinName} has no links");
        if (linked.Count != 1)
        {
            throw new Exception(
                $"{node.Value<string>("Name")}.{pinName} has {linked.Count} links");
        }
        return ReadObjectLeafName(
            linked[0]?.SelectToken("OwningNode.ObjectName")?.Value<string>()
            ?? throw new Exception(
                $"{node.Value<string>("Name")}.{pinName} link has no owner"));
    }

    static string ReadResultDefaultObject(
        IReadOnlyDictionary<string, JObject> nodes,
        string resultNodeName)
    {
        var result = RequiredNode(nodes, resultNodeName);
        var returnPin = result["Pins"]?.OfType<JObject>().SingleOrDefault(
                            candidate =>
                                candidate.Value<string>("PinName")
                                == "ReturnValue")
                        ?? throw new Exception(
                            $"{resultNodeName} has no ReturnValue pin");
        return ReadObjectLeafName(
            returnPin.SelectToken("DefaultObject.ObjectName")?.Value<string>()
            ?? throw new Exception(
                $"{resultNodeName}.ReturnValue has no DefaultObject"));
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
        return separator >= 0 ? qualified[(separator + 1)..] : qualified;
    }

    static JObject NormalizeMontage(
        DefaultFileProvider provider,
        AssetRecord montage)
    {
        var properties = montage.Export["Properties"] as JObject
                         ?? throw new Exception(
                             $"{montage.Export.Value<string>("Name")} has no properties");
        var sections = properties["CompositeSections"] as JArray
                       ?? throw new Exception("montage has no CompositeSections");
        var slotTracks = properties["SlotAnimTracks"] as JArray
                         ?? throw new Exception("montage has no SlotAnimTracks");
        if (sections.Count != 1 || slotTracks.Count != 1)
        {
            throw new Exception(
                $"{montage.Export.Value<string>("Name")} must have one section and slot track");
        }
        var section = (JObject)sections[0]!;
        var slotTrack = (JObject)slotTracks[0]!;
        var segments =
            slotTrack.SelectToken("AnimTrack.AnimSegments") as JArray
            ?? throw new Exception("montage slot has no AnimSegments");
        if (segments.Count != 1)
        {
            throw new Exception(
                $"{montage.Export.Value<string>("Name")} must have one segment");
        }
        var segment = (JObject)segments[0]!;
        var sequenceName = ReadReferenceName(segment, "AnimReference");
        var sequence = LoadAsset(
            provider,
            sequenceName,
            MontagePath,
            "AnimSequence");
        var sequenceProperties = sequence.Export["Properties"] as JObject
                                 ?? throw new Exception(
                                     $"{sequenceName} has no properties");

        var notifies = new JArray();
        foreach (var notify in properties["Notifies"]?.OfType<JObject>() ?? [])
        {
            var stateName = ReadObjectLeafName(
                notify.SelectToken("NotifyStateClass.ObjectName")
                    ?.Value<string>()
                ?? throw new Exception("montage notify has no state class"));
            var stateExport = montage.Exports.SingleOrDefault(
                                  export => export.Name == stateName)
                              ?? throw new Exception(
                                  $"{montage.Export.Value<string>("Name")} has no {stateName}");
            var state = JObject.FromObject(stateExport, Serializer);
            var startTime = RequiredNumber(notify, "LinkValue");
            var duration = RequiredNumber(notify, "Duration");
            notifies.Add(
                new JObject
                {
                    ["NotifyName"] =
                        notify.Value<string>("NotifyName"),
                    ["startTime"] = startTime,
                    ["duration"] = duration,
                    ["endTime"] = startTime + duration,
                    ["TriggerTimeOffset"] =
                        RequiredNumber(notify, "TriggerTimeOffset"),
                    ["EndTriggerTimeOffset"] =
                        RequiredNumber(notify, "EndTriggerTimeOffset"),
                    ["MontageTickType"] =
                        StripEnumPrefix(
                            notify.Value<string>("MontageTickType")),
                    ["TrackIndex"] =
                        notify.Value<int>("TrackIndex"),
                    ["stateClass"] = new JObject
                    {
                        ["name"] = stateName,
                        ["type"] = state.Value<string>("Type"),
                        ["properties"] =
                            state["Properties"]?.DeepClone()
                            ?? new JObject(),
                    },
                });
        }

        return new JObject
        {
            ["asset"] = montage.Export.Value<string>("Name"),
            ["assetPath"] = montage.Path,
            ["SequenceLength"] =
                RequiredNumber(properties, "SequenceLength"),
            ["RateScale"] = properties.Value<double?>("RateScale") ?? 1,
            ["SamplingFrameRate"] = new JObject
            {
                ["Numerator"] =
                    properties.SelectToken("CommonTargetFrameRate.Numerator")
                        ?.Value<int>()
                    ?? 30,
                ["Denominator"] =
                    properties.SelectToken("CommonTargetFrameRate.Denominator")
                        ?.Value<int>()
                    ?? 1,
            },
            ["BlendIn"] = NormalizeBlend(
                properties["BlendIn"] as JObject,
                "BlendIn"),
            ["BlendOut"] = NormalizeBlend(
                properties["BlendOut"] as JObject,
                "BlendOut"),
            ["BlendOutTriggerTime"] =
                RequiredNumber(properties, "BlendOutTriggerTime"),
            ["section"] = new JObject
            {
                ["SectionName"] = section.Value<string>("SectionName"),
                ["NextSectionName"] =
                    section.Value<string>("NextSectionName"),
                ["SlotIndex"] = section.Value<int>("SlotIndex"),
                ["SegmentIndex"] = section.Value<int>("SegmentIndex"),
                ["LinkMethod"] =
                    StripEnumPrefix(section.Value<string>("LinkMethod")),
                ["SegmentBeginTime"] =
                    RequiredNumber(section, "SegmentBeginTime"),
                ["SegmentLength"] =
                    RequiredNumber(section, "SegmentLength"),
                ["LinkValue"] = RequiredNumber(section, "LinkValue"),
            },
            ["slot"] = new JObject
            {
                ["SlotName"] = slotTrack.Value<string>("SlotName"),
                ["sequence"] = sequenceName,
                ["sequenceAssetPath"] = sequence.Path,
                ["SequenceLength"] =
                    RequiredNumber(sequenceProperties, "SequenceLength"),
                ["SequenceRateScale"] =
                    sequenceProperties.Value<double?>("RateScale") ?? 1,
                ["StartPos"] = RequiredNumber(segment, "StartPos"),
                ["AnimStartTime"] =
                    RequiredNumber(segment, "AnimStartTime"),
                ["AnimEndTime"] =
                    RequiredNumber(segment, "AnimEndTime"),
                ["AnimPlayRate"] =
                    RequiredNumber(segment, "AnimPlayRate"),
                ["LoopingCount"] =
                    segment.Value<int>("LoopingCount"),
            },
            ["notifies"] = notifies,
            ["branchingPointMarkers"] =
                new JArray(
                    properties["BranchingPointMarkers"]
                        ?.OfType<JObject>()
                        .Select(
                            marker =>
                                new JObject
                                {
                                    ["NotifyIndex"] =
                                        marker.Value<int>("NotifyIndex"),
                                    ["TriggerTime"] =
                                        RequiredNumber(
                                            marker,
                                            "TriggerTime"),
                                    ["NotifyEventType"] =
                                        StripEnumPrefix(
                                            marker.Value<string>(
                                                "NotifyEventType")),
                                })
                    ?? []),
        };
    }

    static JObject NormalizeBlend(JObject? blend, string propertyName)
    {
        if (blend is null)
        {
            throw new Exception($"montage has no {propertyName}");
        }
        return new JObject
        {
            ["BlendTime"] = RequiredNumber(blend, "BlendTime"),
            ["BlendOption"] =
                StripEnumPrefix(blend.Value<string>("BlendOption")),
        };
    }

    static string? StripEnumPrefix(string? value)
    {
        if (value is null)
        {
            return null;
        }
        var separator = value.LastIndexOf("::", StringComparison.Ordinal);
        return separator < 0 ? value : value[(separator + 2)..];
    }

    static JObject NormalizeCurve(AssetRecord curve)
    {
        var keys = curve.Export
            .SelectToken("Properties.FloatCurve.Keys") as JArray
            ?? throw new Exception(
                $"{curve.Export.Value<string>("Name")} has no rich-curve keys");
        return new JObject
        {
            ["asset"] = curve.Export.Value<string>("Name"),
            ["assetPath"] = curve.Path,
            ["keys"] = new JArray(
                keys.OfType<JObject>().Select(
                    key =>
                        new JObject
                        {
                            ["InterpMode"] =
                                key.Value<string>("InterpMode"),
                            ["TangentMode"] =
                                key.Value<string>("TangentMode"),
                            ["TangentWeightMode"] =
                                key.Value<string>("TangentWeightMode"),
                            ["Time"] = RequiredNumber(key, "Time"),
                            ["Value"] = RequiredNumber(key, "Value"),
                            ["ArriveTangent"] =
                                RequiredNumber(key, "ArriveTangent"),
                            ["ArriveTangentWeight"] =
                                RequiredNumber(
                                    key,
                                    "ArriveTangentWeight"),
                            ["LeaveTangent"] =
                                RequiredNumber(key, "LeaveTangent"),
                            ["LeaveTangentWeight"] =
                                RequiredNumber(
                                    key,
                                    "LeaveTangentWeight"),
                        })),
        };
    }

    static string ReadReferenceName(JObject parent, string propertyName)
    {
        return ReadObjectLeafName(
            parent.SelectToken($"{propertyName}.ObjectName")
                ?.Value<string>()
            ?? throw new Exception($"{propertyName} has no ObjectName"));
    }

    static double RequiredNumber(JObject obj, string propertyName)
    {
        return obj[propertyName]?.Type is
            JTokenType.Float or JTokenType.Integer
            ? obj.Value<double>(propertyName)
            : throw new Exception(
                $"{propertyName} is missing or not numeric");
    }

    static JArray ValidatePayload(JObject payload)
    {
        var validations = new JArray
        {
            ValidateInventory(payload),
            ValidateGeneralSettings(payload),
            ValidateSelection(payload),
            ValidateMantlingSettings(payload),
            ValidateMontages(payload),
            ValidateCorrectionCurves(payload),
        };
        return validations;
    }

    static JObject ValidateInventory(JObject payload)
    {
        var settings = payload["settings"] as JObject ?? new JObject();
        var curves = payload["curves"] as JObject ?? new JObject();
        var actualSettings = settings.Properties()
            .Select(property => property.Name)
            .Order(StringComparer.Ordinal)
            .ToArray();
        var actualCurves = curves.Properties()
            .Select(property => property.Name)
            .Order(StringComparer.Ordinal)
            .ToArray();
        return Validation(
            "mantling-content-inventory",
            actualSettings.SequenceEqual(
                ExpectedSettings.Order(StringComparer.Ordinal))
            && actualCurves.SequenceEqual(
                ExpectedCurves.Order(StringComparer.Ordinal)),
            new JObject
            {
                ["settings"] = new JArray(actualSettings),
                ["curves"] = new JArray(actualCurves),
            });
    }

    static JObject ValidateGeneralSettings(JObject payload)
    {
        var general = payload["general"] as JObject ?? new JObject();
        var grounded = general["GroundedTrace"] as JObject ?? new JObject();
        var inAir = general["InAirTrace"] as JObject ?? new JObject();
        var pass =
            general.Value<bool?>("bAllowMantling") == true
            && Nearly(general.Value<double?>("TraceAngleThreshold"), 110)
            && Nearly(general.Value<double?>("MaxReachAngle"), 50)
            && Nearly(general.Value<double?>("SlopeAngleThreshold"), 35)
            && Nearly(
                general.Value<double?>("SlopeAngleThresholdCos"),
                Math.Cos(35 * Math.PI / 180))
            && Nearly(
                general.Value<double?>("TargetPrimitiveSpeedThreshold"),
                10)
            && Nearly(
                general.Value<double?>("MantlingHighHeightThreshold"),
                125)
            && NumberArrayEquals(
                grounded["LedgeHeight"],
                [50, 225])
            && Nearly(grounded.Value<double?>("ReachDistance"), 75)
            && Nearly(
                grounded.Value<double?>("TargetLocationOffset"),
                15)
            && Nearly(
                grounded.Value<double?>("StartLocationOffset"),
                55)
            && grounded.Value<bool?>("bDrawFailedTraces") == true
            && NumberArrayEquals(inAir["LedgeHeight"], [50, 150])
            && Nearly(inAir.Value<double?>("ReachDistance"), 70)
            && Nearly(
                inAir.Value<double?>("TargetLocationOffset"),
                15)
            && Nearly(
                inAir.Value<double?>("StartLocationOffset"),
                55)
            && inAir.Value<bool?>("bDrawFailedTraces") == false
            && general.Value<string>("MantlingTraceChannel")
            == "Visibility"
            && TokenArrayEquals(
                general["MantlingTraceResponseChannels"],
                ["WorldStatic", "WorldDynamic", "Destructible"])
            && Nearly(general.Value<double?>("BlendOutDuration"), 0.3)
            && general.Value<bool?>(
                "bStartRagdollingOnTargetPrimitiveDestruction") == true;
        return Validation(
            "CS_Als_Default-general-mantling",
            pass,
            general.DeepClone());
    }

    static JObject ValidateSelection(JObject payload)
    {
        var selection = payload["selection"] as JObject ?? new JObject();
        var expectedLow = new Dictionary<string, string>(
            StringComparer.Ordinal)
        {
            ["Default"] = "MS_Als_Low",
            ["Als.OverlayMode.Injured"] = "MS_Als_Low_Left",
            ["Als.OverlayMode.HandsTied"] = "MS_Als_Low_BothHands",
            ["Als.OverlayMode.Rifle"] = "MS_Als_Low_Right",
            ["Als.OverlayMode.PistolOneHanded"] = "MS_Als_Low_Right",
            ["Als.OverlayMode.PistolTwoHanded"] = "MS_Als_Low_Right",
            ["Als.OverlayMode.Bow"] = "MS_Als_Low_Left",
            ["Als.OverlayMode.Torch"] = "MS_Als_Low_Left",
            ["Als.OverlayMode.Binoculars"] = "MS_Als_Low_Right",
            ["Als.OverlayMode.Box"] = "MS_Als_Low_Box",
            ["Als.OverlayMode.Barrel"] = "MS_Als_Low_Left",
        };
        var low = selection["Low"] as JObject;
        var pass =
            selection.Value<string>("High") == "MS_Als_High"
            && selection.Value<string>("InAir") == "MS_Als_High"
            && low is not null
            && low.Count == expectedLow.Count
            && expectedLow.All(
                pair => low.Value<string>(pair.Key) == pair.Value)
            && selection.SelectToken(
                    "evidence.lowResultNodes.Default")
                ?.Value<string>() == "K2Node_FunctionResult_5";
        return Validation(
            "B_Als_Character-mantling-selection",
            pass,
            selection.DeepClone());
    }

    static JObject ValidateMantlingSettings(JObject payload)
    {
        var settings = payload["settings"] as JObject ?? new JObject();
        var high = settings["MS_Als_High"] as JObject ?? new JObject();
        var low = settings["MS_Als_Low"] as JObject ?? new JObject();
        var expectedLowMontages = new Dictionary<string, string>(
            StringComparer.Ordinal)
        {
            ["MS_Als_Low"] = "AM_Als_Mantle_Low",
            ["MS_Als_Low_BothHands"] = "AM_Als_Mantle_Low_BothArms",
            ["MS_Als_Low_Box"] = "AM_Als_Mantle_Low_Box",
            ["MS_Als_Low_Left"] = "AM_Als_Mantle_Low_Left",
            ["MS_Als_Low_Right"] = "AM_Als_Mantle_Low_Right",
        };
        var pass =
            high.Value<string>("Montage") == "AM_Als_Mantle_High"
            && high.Value<bool?>("bAutoCalculateStartTime") == false
            && NumberArrayEquals(
                high["StartTimeReferenceHeight"],
                [125, 200])
            && NumberArrayEquals(high["StartTime"], [0.6, 0])
            && high.Value<string>("HorizontalCorrectionCurve")
            == "CF_Als_Mantle_High_HorizontalCorrection"
            && high.Value<string>("VerticalCorrectionCurve")
            == "CF_Als_Mantle_High_VerticalCorrection"
            && low.Value<string>("Montage") == "AM_Als_Mantle_Low"
            && low.Value<bool?>("bAutoCalculateStartTime") == false
            && NumberArrayEquals(
                low["StartTimeReferenceHeight"],
                [50, 100])
            && NumberArrayEquals(low["StartTime"], [0.5, 0])
            && low.Value<string>("HorizontalCorrectionCurve")
            == "CF_Als_Mantle_Low_HorizontalCorrection"
            && low.Value<string>("VerticalCorrectionCurve")
            == "CF_Als_Mantle_Low_VerticalCorrection"
            && expectedLowMontages.All(
                pair =>
                {
                    var entry = settings[pair.Key] as JObject;
                    return entry?.Value<string>("Montage") == pair.Value
                           && entry.Value<bool?>(
                               "bAutoCalculateStartTime") == false
                           && NumberArrayEquals(
                               entry["StartTimeReferenceHeight"],
                               [50, 100])
                           && NumberArrayEquals(
                               entry["StartTime"],
                               [0.5, 0])
                           && entry.Value<string>(
                               "HorizontalCorrectionCurve")
                           == "CF_Als_Mantle_Low_HorizontalCorrection"
                           && entry.Value<string>(
                               "VerticalCorrectionCurve")
                           == "CF_Als_Mantle_Low_VerticalCorrection";
                });
        return Validation(
            "mantling-settings-values",
            pass,
            settings.DeepClone());
    }

    static JObject ValidateMontages(JObject payload)
    {
        var montages = payload["montages"] as JObject ?? new JObject();
        var expected = new Dictionary<string, object[]>(
            StringComparer.Ordinal)
        {
            ["AM_Als_Mantle_High"] =
            [
                "A_Als_Mantle_High",
                2.6666667,
                1.2,
                "Cubic",
                2.0666666,
                2.1333334,
                0.5333333,
                0.4,
                "Absolute",
            ],
            ["AM_Als_Mantle_Low"] =
            [
                "A_Als_Mantle_Low_Right",
                1.5,
                1.0,
                "HermiteCubic",
                0.96666664,
                1.0,
                0.5,
                0.35,
                "Proportional",
            ],
            ["AM_Als_Mantle_Low_BothArms"] =
            [
                "A_Als_Mantle_Low_Right",
                1.5,
                1.0,
                "HermiteCubic",
                0.96666664,
                1.0,
                0.5,
                0.35,
                "Proportional",
            ],
            ["AM_Als_Mantle_Low_Box"] =
            [
                "A_Als_Mantle_Low_Right",
                1.5,
                1.0,
                "HermiteCubic",
                0.96666664,
                1.0,
                0.5,
                0.35,
                "Proportional",
            ],
            ["AM_Als_Mantle_Low_Left"] =
            [
                "A_Als_Mantle_Low_Left",
                1.5,
                1.0,
                "HermiteCubic",
                0.96666664,
                1.0,
                0.5,
                0.35,
                "Proportional",
            ],
            ["AM_Als_Mantle_Low_Right"] =
            [
                "A_Als_Mantle_Low_Right",
                1.5,
                1.0,
                "HermiteCubic",
                0.96666664,
                1.0,
                0.5,
                0.35,
                "Proportional",
            ],
        };
        var errors = new JArray();
        foreach (var (name, values) in expected)
        {
            var montage = montages[name] as JObject;
            var notifies = montage?["notifies"] as JArray;
            var markers = montage?["branchingPointMarkers"] as JArray;
            if (montage is null
                || montage.SelectToken("slot.sequence")?.Value<string>()
                != (string)values[0]
                || montage.SelectToken("slot.SlotName")?.Value<string>()
                != "PostLocomotion"
                || !Nearly(
                    montage.Value<double?>("SequenceLength"),
                    (double)values[1])
                || !Nearly(
                    montage.Value<double?>("RateScale"),
                    (double)values[2])
                || montage.SelectToken("SamplingFrameRate.Numerator")
                    ?.Value<int>() != 30
                || montage.SelectToken("SamplingFrameRate.Denominator")
                    ?.Value<int>() != 1
                || !Nearly(
                    montage.SelectToken("BlendIn.BlendTime")?.Value<double>(),
                    0.2)
                || montage.SelectToken("BlendIn.BlendOption")?.Value<string>()
                != "HermiteCubic"
                || !Nearly(
                    montage.SelectToken("BlendOut.BlendTime")?.Value<double>(),
                    0.2)
                || montage.SelectToken("BlendOut.BlendOption")?.Value<string>()
                != (string)values[3]
                || !Nearly(
                    montage.Value<double?>("BlendOutTriggerTime"),
                    0)
                || montage.SelectToken("section.SectionName")?.Value<string>()
                    != "Default"
                || montage.SelectToken("section.NextSectionName")
                    ?.Value<string>() != "None"
                || montage.SelectToken("section.LinkMethod")?.Value<string>()
                    != (string)values[8]
                || !Nearly(
                    montage.SelectToken("section.SegmentBeginTime")
                        ?.Value<double>(),
                    0)
                || !Nearly(
                    montage.SelectToken("section.SegmentLength")
                        ?.Value<double>(),
                    (double)values[1])
                || !Nearly(
                    montage.SelectToken("section.LinkValue")?.Value<double>(),
                    0)
                || !Nearly(
                    montage.SelectToken("slot.StartPos")?.Value<double>(),
                    0)
                || !Nearly(
                    montage.SelectToken("slot.AnimStartTime")?.Value<double>(),
                    0)
                || !Nearly(
                    montage.SelectToken("slot.AnimEndTime")?.Value<double>(),
                    (double)values[1])
                || !Nearly(
                    montage.SelectToken("slot.SequenceLength")?.Value<double>(),
                    (double)values[1])
                || !Nearly(
                    montage.SelectToken("slot.SequenceRateScale")
                        ?.Value<double>(),
                    1)
                || !Nearly(
                    montage.SelectToken("slot.AnimPlayRate")?.Value<double>(),
                    1)
                || montage.SelectToken("slot.LoopingCount")?.Value<int>()
                    != 1
                || notifies is null
                || notifies.Count != 2
                || notifies[0]?.Value<string>("NotifyName")
                    != "BMNotifyStateMovementAction"
                || !Nearly(notifies[0]?.Value<double>("startTime"), 0)
                || !Nearly(
                    notifies[0]?.Value<double>("duration"),
                    (double)values[4])
                || !Nearly(
                    notifies[0]?.Value<double>("endTime"),
                    (double)values[4])
                || !Nearly(
                    notifies[0]?.Value<double>("TriggerTimeOffset"),
                    -0.0001)
                || !Nearly(
                    notifies[0]?.Value<double>("EndTriggerTimeOffset"),
                    0)
                || notifies[0]?.Value<string>("MontageTickType") != "Queued"
                || notifies[0]?.Value<int>("TrackIndex") != 0
                || notifies[0]?.SelectToken("stateClass.type")
                    ?.Value<string>()
                    != "AlsAnimNotifyState_SetLocomotionAction"
                || notifies[0]?.SelectToken(
                    "stateClass.properties.LocomotionAction.TagName")
                    ?.Value<string>()
                    != "Als.LocomotionAction.Mantling"
                || notifies[1]?.Value<string>("NotifyName")
                    != "BMNotifyStateEarlyBlendOut"
                || !Nearly(
                    notifies[1]?.Value<double>("startTime"),
                    (double)values[5])
                || !Nearly(
                    notifies[1]?.Value<double>("duration"),
                    (double)values[6])
                || !Nearly(
                    notifies[1]?.Value<double>("endTime"),
                    (double)values[1])
                || !Nearly(
                    notifies[1]?.Value<double>("TriggerTimeOffset"),
                    0)
                || !Nearly(
                    notifies[1]?.Value<double>("EndTriggerTimeOffset"),
                    -0.0001)
                || notifies[1]?.Value<string>("MontageTickType") != "Queued"
                || notifies[1]?.Value<int>("TrackIndex") != 1
                || notifies[1]?.SelectToken("stateClass.type")
                    ?.Value<string>()
                    != "AlsAnimNotifyState_EarlyBlendOut"
                || !Nearly(
                    notifies[1]?.SelectToken(
                        "stateClass.properties.BlendOutDuration")
                        ?.Value<double>(),
                    (double)values[7])
                || markers is null
                || markers.Count != 4
                || markers[0]?.Value<int>("NotifyIndex") != 0
                || !Nearly(
                    markers[0]?.Value<double>("TriggerTime"),
                    -0.0001)
                || markers[0]?.Value<string>("NotifyEventType") != "Begin"
                || markers[1]?.Value<int>("NotifyIndex") != 0
                || !Nearly(
                    markers[1]?.Value<double>("TriggerTime"),
                    (double)values[4] - 0.0001)
                || markers[1]?.Value<string>("NotifyEventType") != "End"
                || markers[2]?.Value<int>("NotifyIndex") != 1
                || !Nearly(
                    markers[2]?.Value<double>("TriggerTime"),
                    (double)values[5])
                || markers[2]?.Value<string>("NotifyEventType") != "Begin"
                || markers[3]?.Value<int>("NotifyIndex") != 1
                || !Nearly(
                    markers[3]?.Value<double>("TriggerTime"),
                    (double)values[1] - 0.0001)
                || markers[3]?.Value<string>("NotifyEventType") != "End")
            {
                errors.Add(name);
            }
        }
        return Validation(
            "mantling-montage-timing",
            errors.Count == 0 && montages.Count == expected.Count,
            new JObject
            {
                ["montages"] = montages.DeepClone(),
                ["errors"] = errors,
            });
    }

    static JObject ValidateCorrectionCurves(JObject payload)
    {
        var curves = payload["curves"] as JObject ?? new JObject();
        var expected = new Dictionary<string, double[]>(
            StringComparer.Ordinal)
        {
            ["CF_Als_Mantle_High_HorizontalCorrection"] =
                [0, 0, 0.3, 1],
            ["CF_Als_Mantle_High_VerticalCorrection"] =
                [0.333, 0, 0.7, 1],
            ["CF_Als_Mantle_Low_HorizontalCorrection"] =
                [0.1, 0, 0.4, 1],
            ["CF_Als_Mantle_Low_VerticalCorrection"] =
                [0.3, 0, 0.6, 1],
        };
        var errors = new JArray();
        foreach (var (name, expectedValues) in expected)
        {
            var keys = curves[name]?["keys"] as JArray;
            if (keys is null
                || keys.Count != 2
                || !Nearly(keys[0]?.Value<double>("Time"), expectedValues[0])
                || !Nearly(keys[0]?.Value<double>("Value"), expectedValues[1])
                || keys[0]?.Value<string>("InterpMode") != "RCIM_Cubic"
                || keys[0]?.Value<string>("TangentMode") != "RCTM_User"
                || keys[0]?.Value<string>("TangentWeightMode")
                != "RCTWM_WeightedNone"
                || !Nearly(keys[0]?.Value<double>("ArriveTangent"), 0)
                || !Nearly(keys[0]?.Value<double>("LeaveTangent"), 0)
                || !Nearly(keys[1]?.Value<double>("Time"), expectedValues[2])
                || !Nearly(keys[1]?.Value<double>("Value"), expectedValues[3])
                || keys[1]?.Value<string>("InterpMode") != "RCIM_Linear"
                || keys[1]?.Value<string>("TangentMode") != "RCTM_Auto"
                || keys[1]?.Value<string>("TangentWeightMode")
                != "RCTWM_WeightedNone"
                || !Nearly(keys[1]?.Value<double>("ArriveTangent"), 0)
                || !Nearly(keys[1]?.Value<double>("LeaveTangent"), 0))
            {
                errors.Add(name);
            }
        }
        return Validation(
            "mantling-correction-curves",
            errors.Count == 0 && curves.Count == 4,
            new JObject
            {
                ["curves"] = curves.DeepClone(),
                ["errors"] = errors,
            });
    }

    static bool Nearly(double? value, double expected)
    {
        return value is not null
               && Math.Abs(value.Value - expected) <= 1e-6;
    }

    static bool TokenArrayEquals<T>(
        JToken? token,
        IReadOnlyList<T> expected)
    {
        return token is JArray actual
               && actual.Count == expected.Count
               && actual.Select(value => value.ToObject<T>()!)
                   .SequenceEqual(expected);
    }

    static bool NumberArrayEquals(
        JToken? token,
        IReadOnlyList<double> expected)
    {
        return token is JArray actual
               && actual.Count == expected.Count
               && actual
                   .Select((value, index) =>
                       Nearly(value.Value<double>(), expected[index]))
                   .All(pass => pass);
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
                "mantling content validation failed:\n" +
                string.Join("\n", failures));
        }
    }
}
