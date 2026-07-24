using System.Globalization;
using System.Text.RegularExpressions;
using CUE4Parse.FileProvider;
using CUE4Parse.UE4.Assets.Exports;
using CUE4Parse.UE4.Assets.Objects;
using CUE4Parse.UE4.Assets.Objects.Properties;
using CUE4Parse.UE4.Versions;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

// Freezes ALS Refactored's camera data asset, scalar AnimGraph, and authored
// transition curves into a compact deterministic oracle. The camera AnimBP has
// no animation players: its reference poses carry camera curves into the C++
// solver, so preserving the curve graph is preserving the authored camera.
public static class CameraContentDump
{
    const string CameraContentPath = "/Content/ALSCamera/";
    const string CharacterContentPath = "/Content/ALS/Character/";
    const string AnimationContentPath = "/Content/ALS/Animations/";
    const string SettingsAsset = "CS_Als_Default";
    const string CameraBlueprintAsset = "AB_Als_Camera";
    const string CameraComponentAsset = "B_Als_CameraComponent";
    const string CameraShakeAsset = "B_Als_CameraShake_Sprint";
    const string SkeletonAsset = "SK_Als";
    const string SettingsHeader = "Source/ALSCamera/Public/AlsCameraSettings.h";
    const string ComponentHeader = "Source/ALSCamera/Public/AlsCameraComponent.h";
    const string ConstantsHeader = "Source/ALSCamera/Public/Utility/AlsCameraConstants.h";
    const string AlsConstantsHeader = "Source/ALS/Public/Utility/AlsConstants.h";
    const string SolverSource = "Source/ALSCamera/Private/AlsCameraComponent.cpp";
    const string AnimationInstanceSource =
        "Source/ALSCamera/Private/AlsCameraAnimationInstance.cpp";
    const string CameraShakeNotifyHeader =
        "Source/ALSCamera/Public/Notifies/AlsAnimNotify_CameraShake.h";
    const string CameraShakeNotifySource =
        "Source/ALSCamera/Private/Notifies/AlsAnimNotify_CameraShake.cpp";

    static readonly string[] ExpectedCurveNames =
    [
        "CameraOffsetX",
        "CameraOffsetY",
        "CameraOffsetZ",
        "FovOffset",
        "PivotOffsetX",
        "PivotOffsetY",
        "PivotOffsetZ",
        "LocationLagX",
        "LocationLagY",
        "LocationLagZ",
        "RotationLag",
        "FirstPersonOverride",
        "TraceOverride",
    ];

    static readonly IReadOnlyDictionary<string, string> CurveNameFunctions =
        new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["CameraOffsetX"] = "CameraOffsetXCurveName",
            ["CameraOffsetY"] = "CameraOffsetYCurveName",
            ["CameraOffsetZ"] = "CameraOffsetZCurveName",
            ["FovOffset"] = "FovOffsetCurveName",
            ["PivotOffsetX"] = "PivotOffsetXCurveName",
            ["PivotOffsetY"] = "PivotOffsetYCurveName",
            ["PivotOffsetZ"] = "PivotOffsetZCurveName",
            ["LocationLagX"] = "LocationLagXCurveName",
            ["LocationLagY"] = "LocationLagYCurveName",
            ["LocationLagZ"] = "LocationLagZCurveName",
            ["RotationLag"] = "RotationLagCurveName",
            ["FirstPersonOverride"] = "FirstPersonOverrideCurveName",
            ["TraceOverride"] = "TraceOverrideCurveName",
        };

    static readonly string[] BlendCurveAssets =
    [
        "CF_Als_CameraBlend_Quick",
        "CF_Als_CameraBlend_Smooth",
    ];

    static readonly string[] CameraShakeSequenceAssets =
    [
        "A_Als_Sprint",
        "A_Als_Sprint_Acceleration",
        "A_Als_Roll",
    ];

    static readonly string[] ExpectedCameraSockets =
    [
        "FirstPersonCamera",
        "ThirdPersonTraceShoulderLeft",
        "ThirdPersonTraceShoulderRight",
    ];

    static readonly JsonSerializer Serializer = JsonSerializer.Create(
        new JsonSerializerSettings
        {
            ReferenceLoopHandling = ReferenceLoopHandling.Ignore,
        });

    sealed record SourceDocument(string Path, string Text);

    sealed record CameraNode(
        int Index,
        string Property,
        string Type,
        JObject Parameters);

    sealed record PoseLink(string Path, int LinkId, int SourceLinkId);

    sealed record ExpectedProfile(
        int Node,
        double[] CameraAndLag);

    sealed record ExpectedStance(
        int PivotNode,
        double PivotZ,
        int GaitNode,
        double[] GaitTimes,
        ExpectedProfile[] Profiles);

    sealed record ExpectedLookState(
        string Name,
        int ResultNode,
        int FinalNode,
        string[] FinalCurveNames,
        double[] FinalValues,
        int StanceNode,
        double StanceTime,
        ExpectedStance Standing,
        ExpectedStance Crouching);

    public static int Run(string srcDir, string outJson)
    {
        var provider = new DefaultFileProvider(
            srcDir,
            SearchOption.AllDirectories,
            new VersionContainer(EGame.GAME_UE5_5));
        provider.Initialize();
        provider.Mount();

        var (settingsAssetPath, settingsExports) =
            LoadPackageExports(provider, SettingsAsset);
        var settingsExport = SameNamedExport(settingsExports, SettingsAsset);
        if (settingsExport.ExportType != "AlsCameraSettings")
            throw new Exception($"{SettingsAsset} is not an AlsCameraSettings export");

        var serializedSettingsOverrides = new JArray(
            settingsExport.Properties
                .Select(property => property.Name.Text)
                .Order(StringComparer.Ordinal));

        var (componentAssetPath, componentExports) =
            LoadPackageExports(provider, CameraComponentAsset);
        var componentCdo = componentExports.Single(
            export => export.Flags.HasFlag(EObjectFlags.RF_ClassDefaultObject));
        var componentSerializedProperties = new JArray(
            componentCdo.Properties
                .Select(property => property.Name.Text)
                .Order(StringComparer.Ordinal));

        var settings = ReadCameraDefaults(srcDir);
        var componentDefaults = ReadCameraComponentDefaults(srcDir);
        var curveNames = ReadCurveNames(srcDir);

        var blendCurves = new JObject();
        foreach (var curveAsset in BlendCurveAssets)
        {
            var (assetPath, exports) = LoadPackageExports(provider, curveAsset);
            blendCurves[curveAsset] =
                NormalizeFloatCurve(assetPath, SameNamedExport(exports, curveAsset));
        }

        var (cameraBlueprintPath, cameraExports) =
            LoadPackageExports(provider, CameraBlueprintAsset);
        var cameraCdo = cameraExports.Single(
            export => export.Flags.HasFlag(EObjectFlags.RF_ClassDefaultObject));
        var generatedClass = cameraExports.Single(
            export => export.ExportType == "AnimBlueprintGeneratedClass");
        var nodes = ReadNodes(cameraCdo);
        var compiledNodeCount =
            (SerializeProperty(generatedClass, "AnimNodeData") as JArray)?.Count
            ?? throw new Exception($"{CameraBlueprintAsset} has no AnimNodeData");
        var compactNodes = new JArray(nodes.Select(CompactNode));
        var nodeMap = compactNodes
            .OfType<JObject>()
            .ToDictionary(node => node.Value<int>("index"));
        var stateMachine = NormalizeStateMachine(generatedClass, nodes);
        var bindings = ReadPropertyBindings(cameraExports);
        var transitionRuleGraphs = ReadTransitionRuleGraphs(cameraExports);
        var branches = BuildBranches(nodeMap);
        var (skeletonAssetPath, skeletonExports) = LoadPackageExports(
            provider,
            SkeletonAsset,
            CharacterContentPath);
        var sockets = NormalizeCameraSockets(skeletonExports);
        var (cameraShakeAssetPath, cameraShakeExports) =
            LoadPackageExports(provider, CameraShakeAsset);
        var cameraShakeSequences = CameraShakeSequenceAssets.Select(
                sequence =>
                {
                    var loaded = LoadPackageExports(
                        provider,
                        sequence,
                        AnimationContentPath);
                    return (Name: sequence, loaded.AssetPath, loaded.Exports);
                })
            .ToArray();
        var cameraShake = NormalizeCameraShake(
            srcDir,
            cameraShakeAssetPath,
            cameraShakeExports,
            cameraShakeSequences);

        var payload = new JObject
        {
            ["schemaVersion"] = 1,
            ["source"] = new JObject
            {
                ["engineVersion"] = "UE5.5",
                ["referenceRelease"] = "ALS Refactored 4.15",
                ["settingsAssetPath"] = settingsAssetPath,
                ["cameraComponentAssetPath"] = componentAssetPath,
                ["cameraBlueprintAssetPath"] = cameraBlueprintPath,
                ["cameraShakeAssetPath"] = cameraShakeAssetPath,
                ["cameraShakeSequenceAssetPaths"] = new JArray(
                    cameraShakeSequences.Select(sequence => sequence.AssetPath)),
                ["skeletonAssetPath"] = skeletonAssetPath,
                ["cpp"] = new JObject
                {
                    ["settingsDefaults"] = SettingsHeader,
                    ["componentDefaults"] = ComponentHeader,
                    ["boneNames"] = AlsConstantsHeader,
                    ["curveNames"] = ConstantsHeader,
                    ["solver"] = SolverSource,
                    ["stateInputs"] = AnimationInstanceSource,
                    ["cameraShakeNotify"] = CameraShakeNotifySource,
                },
            },
            ["settings"] = new JObject
            {
                ["asset"] = SettingsAsset,
                ["serializedOverrides"] = serializedSettingsOverrides,
                ["defaults"] = settings,
            },
            ["component"] = new JObject
            {
                ["asset"] = CameraComponentAsset,
                ["serializedProperties"] = componentSerializedProperties,
                ["defaults"] = componentDefaults,
            },
            ["curveNames"] = curveNames,
            ["blendCurves"] = blendCurves,
            ["sockets"] = sockets,
            ["cameraShake"] = cameraShake,
            ["animGraph"] = new JObject
            {
                ["asset"] = CameraBlueprintAsset,
                ["compiledNodeCount"] = compiledNodeCount,
                ["serializedNodeCount"] = nodes.Count,
                ["playerNodeCount"] = stateMachine
                    .SelectTokens("$.states[*].playerNodeIndices[*]")
                    .Count(),
                ["nodes"] = compactNodes,
                ["propertyBindings"] = bindings,
                ["transitionRuleEditorGraphs"] = transitionRuleGraphs,
                ["stateMachine"] = stateMachine,
                ["branches"] = branches,
            },
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
            $"dumped ALS camera settings, {curveNames.Count} curve names, " +
            $"{blendCurves.Count} blend curves, " +
            $"{cameraShake.SelectToken("notifies")?.Count() ?? 0} camera-shake notifies, " +
            $"and {nodes.Count} graph nodes " +
            $"-> {outJson} ({new FileInfo(outJson).Length:N0} bytes)");
        return 0;
    }

    public static int Validate(string cameraJson)
    {
        var payload = JObject.Parse(File.ReadAllText(cameraJson));
        var validations = ValidatePayload(payload);
        PrintValidations(validations);
        ThrowOnValidationFailure(validations);
        Console.WriteLine($"validated {cameraJson}");
        return 0;
    }

    static (string AssetPath, UObject[] Exports) LoadPackageExports(
        DefaultFileProvider provider,
        string assetName,
        string contentPath = CameraContentPath)
    {
        var file = provider.Files.Values.SingleOrDefault(
                       candidate =>
                           candidate.NameWithoutExtension == assetName
                           && candidate.Extension == "uasset"
                           && candidate.Path
                               .Replace('\\', '/')
                               .Contains(contentPath, StringComparison.Ordinal))
                   ?? throw new Exception(
                       $"{assetName}.uasset was not found exactly once below " +
                       contentPath);
        return (file.Path, provider.LoadPackage(file).GetExports().ToArray());
    }

    static UObject SameNamedExport(IEnumerable<UObject> exports, string assetName)
    {
        return exports.SingleOrDefault(export => export.Name == assetName)
               ?? throw new Exception($"{assetName} has no same-named export");
    }

    static JObject ReadCameraDefaults(string srcDir)
    {
        var source = ReadSource(srcDir, SettingsHeader);
        var firstPerson = ExtractBlock(source, "FAlsFirstPersonCameraSettings");
        var smoothing = ExtractBlock(
            source,
            "FAlsTraceDistanceSmoothingSettings");
        var thirdPerson = ExtractBlock(source, "FAlsThirdPersonCameraSettings");
        var settingsClass = ExtractBlock(source, "UAlsCameraSettings");

        return new JObject
        {
            ["bIgnoreTimeDilation"] = ReadBoolDefault(
                source,
                settingsClass,
                "bIgnoreTimeDilation"),
            ["TeleportDistanceThreshold"] = ReadNumberDefault(
                source,
                settingsClass,
                "TeleportDistanceThreshold",
                "cm"),
            ["FirstPerson"] = new JObject
            {
                ["FieldOfView"] = ReadNumberDefault(
                    source,
                    firstPerson,
                    "FieldOfView",
                    "deg"),
                ["CameraSocketName"] = ReadTextViewDefault(
                    source,
                    firstPerson,
                    "CameraSocketName"),
            },
            ["ThirdPerson"] = new JObject
            {
                ["FieldOfView"] = ReadNumberDefault(
                    source,
                    thirdPerson,
                    "FieldOfView",
                    "deg"),
                ["FirstPivotSocketName"] = ReadResolvedNameDefault(
                    srcDir,
                    source,
                    thirdPerson,
                    "FirstPivotSocketName",
                    "RootBoneName"),
                ["SecondPivotSocketName"] = ReadResolvedNameDefault(
                    srcDir,
                    source,
                    thirdPerson,
                    "SecondPivotSocketName",
                    "HeadBoneName"),
                ["TraceRadius"] = ReadNumberDefault(
                    source,
                    thirdPerson,
                    "TraceRadius",
                    "cm"),
                ["TraceChannel"] = ReadEnumDefault(
                    source,
                    thirdPerson,
                    "TraceChannel"),
                ["TraceShoulderLeftSocketName"] = ReadTextViewDefault(
                    source,
                    thirdPerson,
                    "TraceShoulderLeftSocketName"),
                ["TraceShoulderRightSocketName"] = ReadTextViewDefault(
                    source,
                    thirdPerson,
                    "TraceShoulderRightSocketName"),
                ["TraceOverrideOffset"] = ReadVectorDefault(
                    source,
                    thirdPerson,
                    "TraceOverrideOffset",
                    "cm"),
                ["bEnableTraceDistanceSmoothing"] = ReadBoolDefault(
                    source,
                    thirdPerson,
                    "bEnableTraceDistanceSmoothing"),
                ["TraceDistanceSmoothing"] = new JObject
                {
                    ["InterpolationSpeed"] = ReadNumberDefault(
                        source,
                        smoothing,
                        "InterpolationSpeed",
                        "rate"),
                },
            },
            ["PostProcess"] = ReadDefaultConstructedSetting(
                source,
                settingsClass,
                "FPostProcessSettings",
                "PostProcess"),
        };
    }

    static JObject ReadCameraComponentDefaults(string srcDir)
    {
        var source = ReadSource(srcDir, ComponentHeader);
        var cameraClass = ExtractBlock(source, "UAlsCameraComponent");
        return new JObject
        {
            ["bOverrideFieldOfView"] = ReadBoolDefault(
                source,
                cameraClass,
                "bOverrideFieldOfView"),
            ["FieldOfViewOverride"] = ReadNumberDefault(
                source,
                cameraClass,
                "FieldOfViewOverride",
                "deg"),
            ["PostProcessWeight"] = ReadNumberDefault(
                source,
                cameraClass,
                "PostProcessWeight",
                "normalized"),
            ["bRightShoulder"] = ReadBoolDefault(
                source,
                cameraClass,
                "bRightShoulder"),
        };
    }

    static JArray ReadCurveNames(string srcDir)
    {
        var source = ReadSource(srcDir, ConstantsHeader);
        var names = new JArray();
        foreach (var expectedName in ExpectedCurveNames)
        {
            var functionName = CurveNameFunctions[expectedName];
            var function = ExtractBlock(
                source,
                $"UAlsCameraConstants::{functionName}");
            var match = RequiredMatch(
                function.Text,
                @"TEXTVIEW\(""(?<value>[^""]+)""\)",
                $"{functionName} TEXTVIEW name");
            var name = match.Groups["value"].Value;
            names.Add(
                new JObject
                {
                    ["name"] = name,
                    ["source"] = SourceReference(
                        source,
                        function.Start + match.Index,
                        "cppConstant"),
                });
        }
        return names;
    }

    static JObject NormalizeFloatCurve(string assetPath, UObject curveExport)
    {
        if (curveExport.ExportType != "CurveFloat")
            throw new Exception($"{assetPath} is not a CurveFloat");
        var serialized = JObject.FromObject(curveExport, Serializer);
        var keys = serialized.SelectToken("Properties.FloatCurve.Keys") as JArray
                   ?? throw new Exception($"{assetPath} has no FloatCurve.Keys");
        return new JObject
        {
            ["assetPath"] = assetPath,
            ["keys"] = new JArray(keys.OfType<JObject>().Select(NormalizeRichCurveKey)),
        };
    }

    static JArray NormalizeCameraSockets(IEnumerable<UObject> skeletonExports)
    {
        var skeleton = SameNamedExport(skeletonExports, SkeletonAsset);
        if (skeleton.ExportType != "Skeleton")
            throw new Exception($"{SkeletonAsset} is not a Skeleton export");
        var serializedSkeleton = JObject.FromObject(skeleton, Serializer);
        var referencedSocketNames = (
                serializedSkeleton.SelectToken("Properties.Sockets") as JArray)
            ?.OfType<JObject>()
            .Select(reference => reference.Value<string>("ObjectName"))
            .Where(name => name is not null)
            .Select(name => name!)
            .ToHashSet(StringComparer.Ordinal)
            ?? throw new Exception($"{SkeletonAsset} has no Sockets property");

        var sockets = new List<JObject>();
        foreach (var socketExport in skeletonExports
                     .Where(export => export.ExportType == "SkeletalMeshSocket"))
        {
            var serialized = JObject.FromObject(socketExport, Serializer);
            var properties = serialized["Properties"] as JObject
                             ?? throw new Exception(
                                 $"{socketExport.Name} has no socket properties");
            var socketName = properties.Value<string>("SocketName");
            if (socketName is null
                || !ExpectedCameraSockets.Contains(socketName, StringComparer.Ordinal))
            {
                continue;
            }

            var ownPath = serialized.SelectToken("Outer.ObjectPath")?.Value<string>();
            // CUE4Parse exposes the socket export's outer path, while Skeleton.Sockets
            // exposes each socket's object path. The stable export identity is also
            // retained explicitly so the validator can reject a detached socket.
            var skeletonReferencesExport = referencedSocketNames.Contains(
                $"SkeletalMeshSocket'{SkeletonAsset}:{socketExport.Name}'");
            var location = properties["RelativeLocation"] as JObject
                           ?? throw new Exception(
                               $"{socketName} has no RelativeLocation");
            var rotation = properties["RelativeRotation"] as JObject;
            var scale = properties["RelativeScale"] as JObject;
            sockets.Add(
                new JObject
                {
                    ["name"] = socketName,
                    ["export"] = socketExport.Name,
                    ["parentBone"] = RequiredString(properties, "BoneName"),
                    ["referencedBySkeleton"] = skeletonReferencesExport,
                    ["outer"] = ownPath,
                    ["relativeTransformUnreal"] = new JObject
                    {
                        ["translationCm"] = new JObject
                        {
                            ["value"] = VectorXYZ(location, 0),
                            ["source"] = "serialized SK_Als socket property",
                        },
                        ["rotationDegrees"] = new JObject
                        {
                            ["value"] = RotatorPitchYawRoll(rotation),
                            ["source"] = rotation is null
                                ? "unserialized USkeletalMeshSocket identity default"
                                : "serialized SK_Als socket property",
                        },
                        ["scale"] = new JObject
                        {
                            ["value"] = VectorXYZ(scale, 1),
                            ["source"] = scale is null
                                ? "unserialized USkeletalMeshSocket unit-scale default"
                                : "serialized SK_Als socket property",
                        },
                    },
                });
        }

        return new JArray(
            sockets.OrderBy(socket => socket.Value<string>("name"),
                StringComparer.Ordinal));
    }

    static JObject NormalizeCameraShake(
        string srcDir,
        string cameraShakeAssetPath,
        IEnumerable<UObject> cameraShakeExports,
        IEnumerable<(string Name, string AssetPath, UObject[] Exports)> sequences)
    {
        var shakeExports = cameraShakeExports.ToArray();
        var cameraShakeCdo = shakeExports.Single(
            export => export.Flags.HasFlag(EObjectFlags.RF_ClassDefaultObject));
        var serializedCdo = JObject.FromObject(cameraShakeCdo, Serializer);
        var rootPatternReference =
            serializedCdo.SelectToken("Properties.RootShakePattern.ObjectName")
                ?.Value<string>()
            ?? throw new Exception(
                $"{CameraShakeAsset} has no RootShakePattern reference");
        var rootPattern = shakeExports.Single(
            export => export.ExportType == "WaveOscillatorCameraShakePattern");
        if (ObjectLeafName(rootPatternReference) != rootPattern.Name)
        {
            throw new Exception(
                $"{CameraShakeAsset} RootShakePattern does not reference " +
                rootPattern.Name);
        }

        var serializedPattern = JObject.FromObject(rootPattern, Serializer);
        var patternProperties = serializedPattern["Properties"] as JObject
                                ?? throw new Exception(
                                    $"{CameraShakeAsset} root pattern has no properties");
        var notifyDefaults = ReadCameraShakeNotifyDefaults(srcDir);
        var defaultScale = notifyDefaults.SelectToken("CameraShakeScale.value")
                               ?.Value<double>()
                           ?? throw new Exception(
                               "AlsAnimNotify_CameraShake has no scale default");
        var notifies = new JArray();

        foreach (var sequence in sequences)
        {
            var sequenceExport = SameNamedExport(sequence.Exports, sequence.Name);
            if (sequenceExport.ExportType != "AnimSequence")
                throw new Exception($"{sequence.Name} is not an AnimSequence");
            var serializedSequence = JObject.FromObject(sequenceExport, Serializer);
            var sequenceProperties = serializedSequence["Properties"] as JObject
                                     ?? throw new Exception(
                                         $"{sequence.Name} has no properties");
            var sequenceNotifies = sequenceProperties["Notifies"] as JArray
                                   ?? throw new Exception(
                                       $"{sequence.Name} has no Notifies");
            var exportsByName = sequence.Exports.ToDictionary(
                export => export.Name,
                StringComparer.Ordinal);

            foreach (var notifyEvent in sequenceNotifies.OfType<JObject>()
                         .Where(
                             notify =>
                                 notify.Value<string>("NotifyName")
                                 == "AlsCameraShake"))
            {
                var notifyReference =
                    notifyEvent.SelectToken("Notify.ObjectName")?.Value<string>()
                    ?? throw new Exception(
                        $"{sequence.Name} camera shake has no notify object");
                var notifyName = ObjectLeafName(notifyReference);
                if (!exportsByName.TryGetValue(notifyName, out var notifyExport)
                    || notifyExport.ExportType != "AlsAnimNotify_CameraShake")
                {
                    throw new Exception(
                        $"{sequence.Name} camera shake references invalid export " +
                        notifyName);
                }

                var serializedNotify = JObject.FromObject(notifyExport, Serializer);
                var notifyProperties = serializedNotify["Properties"] as JObject
                                       ?? new JObject();
                var classReference =
                    notifyProperties.SelectToken("CameraShakeClass.ObjectName")
                        ?.Value<string>()
                    ?? throw new Exception(
                        $"{sequence.Name}:{notifyName} has no CameraShakeClass");
                var scaleWasSerialized =
                    notifyProperties["CameraShakeScale"]?.Type
                    is JTokenType.Float or JTokenType.Integer;
                var scale = scaleWasSerialized
                    ? notifyProperties.Value<double>("CameraShakeScale")
                    : defaultScale;

                notifies.Add(
                    new JObject
                    {
                        ["sequence"] = sequence.Name,
                        ["assetPath"] = sequence.AssetPath,
                        ["sequenceLength"] =
                            RequiredNumber(sequenceProperties, "SequenceLength"),
                        ["loop"] = sequenceProperties.Value<bool?>("bLoop") ?? false,
                        ["notifyName"] =
                            RequiredString(notifyEvent, "NotifyName"),
                        ["notifyExport"] = notifyName,
                        ["time"] = RequiredNumber(notifyEvent, "LinkValue"),
                        ["triggerWeightThreshold"] = RequiredNumber(
                            notifyEvent,
                            "TriggerWeightThreshold"),
                        ["montageTickType"] =
                            RequiredString(notifyEvent, "MontageTickType"),
                        ["notifyTriggerChance"] = RequiredNumber(
                            notifyEvent,
                            "NotifyTriggerChance"),
                        ["notifyFilterType"] =
                            RequiredString(notifyEvent, "NotifyFilterType"),
                        ["notifyFilterLod"] =
                            notifyEvent.Value<int>("NotifyFilterLOD"),
                        ["triggerOnDedicatedServer"] =
                            notifyEvent.Value<bool>("bTriggerOnDedicatedServer"),
                        ["triggerOnFollower"] =
                            notifyEvent.Value<bool>("bTriggerOnFollower"),
                        ["cameraShakeClass"] = new JObject
                        {
                            ["value"] = ReferenceName(classReference),
                            ["source"] = new JObject
                            {
                                ["kind"] = "serializedAsset",
                                ["path"] = sequence.AssetPath,
                                ["export"] = notifyName,
                            },
                        },
                        ["cameraShakeScale"] = scaleWasSerialized
                            ? new JObject
                            {
                                ["value"] = scale,
                                ["source"] = new JObject
                                {
                                    ["kind"] = "serializedAsset",
                                    ["path"] = sequence.AssetPath,
                                    ["export"] = notifyName,
                                },
                            }
                            : notifyDefaults["CameraShakeScale"]!.DeepClone(),
                        ["serializedProperties"] = new JArray(
                            notifyProperties.Properties()
                                .Select(property => property.Name)
                                .Order(StringComparer.Ordinal)),
                    });
            }
        }

        return new JObject
        {
            ["asset"] = CameraShakeAsset,
            ["assetPath"] = cameraShakeAssetPath,
            ["rootPattern"] = new JObject
            {
                ["type"] = rootPattern.ExportType,
                ["export"] = rootPattern.Name,
                ["serializedProperties"] = new JArray(
                    patternProperties.Properties()
                        .Select(property => property.Name)
                        .Order(StringComparer.Ordinal)),
                ["values"] = patternProperties.DeepClone(),
            },
            ["notifyDefaults"] = notifyDefaults,
            ["notifies"] = notifies,
        };
    }

    static JObject ReadCameraShakeNotifyDefaults(string srcDir)
    {
        var source = ReadSource(srcDir, CameraShakeNotifyHeader);
        var notifyClass = ExtractBlock(source, "UAlsAnimNotify_CameraShake");
        return new JObject
        {
            ["CameraShakeScale"] = ReadNumberDefault(
                source,
                notifyClass,
                "CameraShakeScale",
                "x"),
        };
    }

    static JObject NormalizeRichCurveKey(JObject key)
    {
        return new JObject
        {
            ["InterpMode"] = RequiredString(key, "InterpMode"),
            ["TangentMode"] = RequiredString(key, "TangentMode"),
            ["TangentWeightMode"] = RequiredString(key, "TangentWeightMode"),
            ["Time"] = RequiredNumber(key, "Time"),
            ["Value"] = RequiredNumber(key, "Value"),
            ["ArriveTangent"] = RequiredNumber(key, "ArriveTangent"),
            ["ArriveTangentWeight"] = RequiredNumber(key, "ArriveTangentWeight"),
            ["LeaveTangent"] = RequiredNumber(key, "LeaveTangent"),
            ["LeaveTangentWeight"] = RequiredNumber(key, "LeaveTangentWeight"),
        };
    }

    static List<CameraNode> ReadNodes(UObject cdo)
    {
        var nodes = new List<CameraNode>();
        foreach (var property in cdo.Properties.Where(IsAnimNodeProperty))
        {
            var structProperty = (StructProperty)property.Tag!;
            var tagData = JObject.FromObject(property.TagData!, Serializer);
            var structType = tagData.Value<string>("StructType")
                             ?? throw new Exception(
                                 $"{property.Name.Text} has no StructType");
            var parameters = JToken.FromObject(structProperty, Serializer) as JObject
                             ?? throw new Exception(
                                 $"{property.Name.Text} did not serialize as an object");
            nodes.Add(
                new CameraNode(
                    nodes.Count,
                    property.Name.Text,
                    structType.StartsWith('F') ? structType : $"F{structType}",
                    parameters));
        }
        return nodes;
    }

    static bool IsAnimNodeProperty(FPropertyTag property)
    {
        if (property.Tag is not StructProperty || property.TagData is null)
            return false;
        var tagData = JObject.FromObject(property.TagData, Serializer);
        var structType = tagData.Value<string>("StructType");
        return structType?.Contains("AnimNode_", StringComparison.Ordinal) == true;
    }

    static JObject CompactNode(CameraNode node)
    {
        var compact = new JObject
        {
            ["index"] = node.Index,
            ["property"] = node.Property,
            ["type"] = node.Type,
            ["poseLinks"] = new JArray(
                FindPoseLinks(node.Parameters)
                    .Select(
                        link => new JObject
                        {
                            ["input"] = link.Path,
                            ["sourceNodeIndex"] = link.LinkId,
                            ["targetNodeIndex"] = link.SourceLinkId,
                        })),
        };

        CopyOptional(compact, node.Parameters, "CurveNames");
        CopyOptional(compact, node.Parameters, "CurveValues");
        CopyOptional(compact, node.Parameters, "Alpha");
        CopyOptional(compact, node.Parameters, "ApplyMode");
        if (node.Parameters["Tags"] is JArray tags)
        {
            compact["Tags"] = new JArray(
                tags.OfType<JObject>()
                    .Select(
                        tag => tag.SelectToken("TagName")?.Value<string>()
                               ?? throw new Exception(
                                   $"{node.Property} has a tag without TagName")));
        }
        CopyOptional(compact, node.Parameters, "BlendTime");
        CopyOptional(compact, node.Parameters, "TransitionType");
        CopyOptional(compact, node.Parameters, "BlendType");
        CopyOptional(compact, node.Parameters, "bResetChildOnActivation");
        if (node.Parameters.SelectToken("CustomBlendCurve.ObjectName")
                ?.Value<string>() is string customCurve)
        {
            compact["CustomBlendCurve"] = ReferenceName(customCurve);
        }
        CopyOptional(compact, node.Parameters, "CachePoseName");
        CopyOptional(compact, node.Parameters, "Name");
        CopyOptional(compact, node.Parameters, "StateIndex");
        CopyOptional(compact, node.Parameters, "RefPoseType");
        CopyOptional(compact, node.Parameters, "StateMachineIndexInClass");
        CopyOptional(compact, node.Parameters, "MaxTransitionsPerFrame");
        CopyOptional(compact, node.Parameters, "MaxTransitionsRequests");
        CopyOptional(compact, node.Parameters, "bSkipFirstUpdateTransition");
        CopyOptional(compact, node.Parameters, "bReinitializeOnBecomingRelevant");
        return compact;
    }

    static JObject NormalizeStateMachine(
        UObject generatedClass,
        IReadOnlyList<CameraNode> nodes)
    {
        var machines = SerializeProperty(generatedClass, "BakedStateMachines") as JArray
                       ?? throw new Exception(
                           $"{CameraBlueprintAsset} has no BakedStateMachines");
        if (machines.Count != 1 || machines[0] is not JObject machine)
            throw new Exception(
                $"{CameraBlueprintAsset} must have exactly one state machine");
        var rawStates = machine["States"] as JArray
                        ?? throw new Exception("Look States has no states");
        var stateNames = rawStates
            .OfType<JObject>()
            .Select(state => RequiredString(state, "StateName"))
            .ToArray();
        var rawTransitions = machine["Transitions"] as JArray
                             ?? throw new Exception("Look States has no transitions");

        var states = new JArray();
        foreach (var rawState in rawStates.OfType<JObject>())
        {
            var transitions = new JArray();
            foreach (var rawStateTransition in
                     rawState["Transitions"]?.OfType<JObject>() ?? [])
            {
                var transitionIndex =
                    rawStateTransition.Value<int>("TransitionIndex");
                var rawTransition =
                    (JObject)rawTransitions[transitionIndex]!;
                var nextState = rawTransition.Value<int>("NextState");
                var delegateBaked =
                    rawStateTransition.Value<int>("CanTakeDelegateIndex");
                var targetName = stateNames[nextState];
                transitions.Add(
                    new JObject
                    {
                        ["transitionIndex"] = transitionIndex,
                        ["ruleBakedNodeIndex"] = delegateBaked,
                        ["ruleCompiledNodeIndex"] =
                            BakedToCompiled(delegateBaked, nodes.Count),
                        ["targetState"] = targetName,
                        ["expression"] = new JObject
                        {
                            ["property"] = "RotationMode",
                            ["operator"] = "Equals",
                            ["value"] = RotationModeTag(targetName),
                            ["acceptsInvalidTag"] =
                                targetName == "Velocity Direction",
                            ["source"] =
                                "AB_Als_Camera transition editor graph and baked shared-rule topology",
                        },
                    });
            }

            var rootBaked = rawState.Value<int>("StateRootNodeIndex");
            states.Add(
                new JObject
                {
                    ["name"] = RequiredString(rawState, "StateName"),
                    ["rootBakedNodeIndex"] = rootBaked,
                    ["rootCompiledNodeIndex"] =
                        BakedToCompiled(rootBaked, nodes.Count),
                    ["playerNodeIndices"] = new JArray(
                        rawState["PlayerNodeIndices"]?.Values<int>()
                            .Select(index => BakedToCompiled(index, nodes.Count))
                        ?? []),
                    ["transitions"] = transitions,
                });
        }

        var transitionsNormalized = new JArray();
        foreach (var rawTransition in rawTransitions.OfType<JObject>())
        {
            var previous = rawTransition.Value<int>("PreviousState");
            var next = rawTransition.Value<int>("NextState");
            transitionsNormalized.Add(
                new JObject
                {
                    ["previousState"] = stateNames[previous],
                    ["nextState"] = stateNames[next],
                    ["duration"] = RequiredNumber(
                        rawTransition,
                        "CrossfadeDuration"),
                    ["blendMode"] = RequiredString(rawTransition, "BlendMode"),
                    ["customCurve"] = ReferenceName(
                        rawTransition.SelectToken("CustomCurve.ObjectName")
                            ?.Value<string>()
                        ?? throw new Exception(
                            $"transition {previous}->{next} has no custom curve")),
                });
        }

        return new JObject
        {
            ["name"] = RequiredString(machine, "MachineName"),
            ["initialState"] = stateNames[machine.Value<int>("InitialState")],
            ["states"] = states,
            ["transitions"] = transitionsNormalized,
        };
    }

    static JArray ReadPropertyBindings(IEnumerable<UObject> exports)
    {
        var bindings = new List<JObject>();
        foreach (var export in exports)
        {
            var serialized = JObject.FromObject(export, Serializer);
            if (serialized.SelectToken("Properties.PropertyBindings") is not JArray
                propertyBindings)
            {
                continue;
            }

            var outer = serialized.SelectToken("Outer.ObjectName")?.Value<string>()
                        ?? throw new Exception(
                            $"{export.Name} property-binding node has no outer");
            foreach (var binding in propertyBindings.OfType<JObject>())
            {
                bindings.Add(
                    new JObject
                    {
                        ["graph"] = GraphName(outer),
                        ["editorNode"] = export.Name,
                        ["nodeType"] = export.ExportType,
                        ["targetProperty"] =
                            RequiredString(binding, "Key"),
                        ["sourceProperty"] =
                            binding.SelectToken("Value.PropertyPath[0]")
                                ?.Value<string>()
                            ?? throw new Exception(
                                $"{export.Name} binding has no PropertyPath"),
                    });
            }
        }

        return new JArray(
            bindings.OrderBy(binding => binding.Value<string>("graph"),
                    StringComparer.Ordinal)
                .ThenBy(binding => binding.Value<string>("editorNode"),
                    StringComparer.Ordinal));
    }

    static JArray ReadTransitionRuleGraphs(IEnumerable<UObject> exports)
    {
        var ruleNodes = exports
            .Where(
                export => export.ExportType is "K2Node_CallFunction"
                    or "K2Node_PromotableOperator"
                    or "K2Node_CommutativeAssociativeBinaryOperator"
                    or "K2Node_PropertyAccess")
            .Select(export => JObject.FromObject(export, Serializer))
            .Where(
                node => node.SelectToken("Outer.ObjectName")?.Value<string>()
                    ?.Contains("AnimationTransitionGraph", StringComparison.Ordinal)
                    == true)
            .ToArray();

        var groups = new JArray();
        foreach (var group in ruleNodes.GroupBy(
                     node => node.SelectToken("Outer.ObjectName")!.Value<string>()!,
                     StringComparer.Ordinal)
                 .OrderBy(group => group.Key, StringComparer.Ordinal))
        {
            var operations = group
                .Select(
                    node =>
                        node.SelectToken("Properties.FunctionReference.MemberName")
                            ?.Value<string>())
                .Where(name => name is not null)
                .Select(name => name!)
                .Order(StringComparer.Ordinal)
                .ToArray();
            var paths = group
                .SelectMany(
                    node => node.SelectToken("Properties.Path")?.Values<string>()
                            ?? [])
                .Where(path => path is not null)
                .Select(path => path!)
                .Distinct(StringComparer.Ordinal)
                .Order(StringComparer.Ordinal)
                .ToArray();
            groups.Add(
                new JObject
                {
                    ["graph"] = group.Key,
                    ["propertyPaths"] = new JArray(paths),
                    ["operations"] = new JArray(operations),
                    ["acceptsInvalidTag"] =
                        operations.Contains(
                            "IsGameplayTagValid",
                            StringComparer.Ordinal)
                        && operations.Contains(
                            "BooleanOR",
                            StringComparer.Ordinal)
                        && operations.Contains(
                            "Not_PreBool",
                            StringComparer.Ordinal),
                });
        }
        return groups;
    }

    static JObject BuildBranches(IReadOnlyDictionary<int, JObject> nodes)
    {
        return new JObject
        {
            ["lookStates"] = new JObject
            {
                ["stateMachineNodeIndex"] = 66,
                ["VelocityDirection"] = DescribeLookState(
                    nodes,
                    65,
                    63,
                    47),
                ["ViewDirection"] = DescribeLookState(
                    nodes,
                    46,
                    44,
                    30),
                ["Aiming"] = DescribeLookState(
                    nodes,
                    27,
                    25,
                    9),
            },
            ["viewMode"] = new JObject
            {
                ["blend"] = DescribeBlend(nodes[68]),
                ["ThirdPerson"] = DescribeModifier(nodes[5]),
                ["FirstPerson"] = DescribeModifier(nodes[4]),
            },
            ["shoulder"] = new JObject
            {
                ["cacheNodeIndex"] = 1,
                ["blend"] = DescribeBlend(nodes[76]),
                ["branches"] = new JArray(
                    DescribeModifier(nodes[2]),
                    DescribeModifier(nodes[3])),
            },
            ["locomotionAction"] = new JObject
            {
                ["blend"] = DescribeBlend(nodes[70]),
                ["Default"] = new JObject
                {
                    ["nodeIndex"] = 75,
                    ["sourceNodeIndex"] = SingleSource(nodes[75]),
                    ["kind"] = "cachedPose",
                },
                ["Mantling"] = DescribeModifier(nodes[74]),
                ["Rolling"] = DescribeModifier(nodes[77]),
                ["Ragdolling"] = DescribeModifier(nodes[78]),
            },
        };
    }

    static JObject DescribeLookState(
        IReadOnlyDictionary<int, JObject> nodes,
        int resultNode,
        int finalNode,
        int stanceBlendNode)
    {
        var stance = nodes[stanceBlendNode];
        var stanceLinks = SourceNodes(stance);
        if (stanceLinks.Length != 2)
            throw new Exception(
                $"stance blend {stanceBlendNode} must have two inputs");
        return new JObject
        {
            ["resultNodeIndex"] = resultNode,
            ["finalModifier"] = DescribeModifier(nodes[finalNode]),
            ["stanceBlend"] = DescribeBlend(stance),
            ["Standing"] = DescribeStance(nodes, stanceLinks[0]),
            ["Crouching"] = DescribeStance(nodes, stanceLinks[1]),
        };
    }

    static JObject DescribeStance(
        IReadOnlyDictionary<int, JObject> nodes,
        int pivotNode)
    {
        var pivot = nodes[pivotNode];
        var gaitNodeIndex = SingleSource(pivot);
        var gait = nodes[gaitNodeIndex];
        var profileNodes = SourceNodes(gait);
        return new JObject
        {
            ["pivotModifier"] = DescribeModifier(pivot),
            ["gaitBlend"] = DescribeBlend(gait),
            ["profiles"] = new JArray(
                profileNodes.Select(profileNode => DescribeModifier(nodes[profileNode]))),
        };
    }

    static JObject DescribeModifier(JObject node)
    {
        return new JObject
        {
            ["nodeIndex"] = node.Value<int>("index"),
            ["sourceNodeIndex"] = SingleSource(node),
            ["curveNames"] = node["CurveNames"]?.DeepClone() ?? new JArray(),
            ["values"] = node["CurveValues"]?.DeepClone() ?? new JArray(),
            ["applyMode"] = node.Value<string>("ApplyMode"),
        };
    }

    static JObject DescribeBlend(JObject node)
    {
        return new JObject
        {
            ["nodeIndex"] = node.Value<int>("index"),
            ["sourceNodeIndices"] = new JArray(SourceNodes(node)),
            ["tags"] = node["Tags"]?.DeepClone() ?? new JArray(),
            ["blendTimes"] = node["BlendTime"]?.DeepClone() ?? new JArray(),
            ["blendType"] = node.Value<string>("BlendType"),
            ["customCurve"] =
                node["CustomBlendCurve"]?.DeepClone() ?? JValue.CreateNull(),
            ["resetChildOnActivation"] =
                node.Value<bool?>("bResetChildOnActivation"),
        };
    }

    static int SingleSource(JObject node)
    {
        var sources = SourceNodes(node);
        if (sources.Length != 1)
            throw new Exception(
                $"node {node.Value<int>("index")} must have one source, got " +
                sources.Length);
        return sources[0];
    }

    static int[] SourceNodes(JObject node)
    {
        return (node["poseLinks"] as JArray)?.OfType<JObject>()
                   .Select(link => link.Value<int>("sourceNodeIndex"))
                   .ToArray()
               ?? [];
    }

    static JArray ValidatePayload(JObject payload)
    {
        var validations = new JArray
        {
            ValidateDefaults(payload),
            ValidateCurveContract(payload),
            ValidateCameraSockets(payload),
            ValidateCameraShake(payload),
            ValidateBlendCurves(payload),
            ValidateGraphTopology(payload),
            ValidateLookProfiles(payload),
            ValidateOuterBranches(payload),
        };
        return validations;
    }

    static JObject ValidateDefaults(JObject payload)
    {
        var errors = new JArray();
        if (payload.Value<int?>("schemaVersion") != 1)
            errors.Add("schemaVersion must be 1");
        var overrides =
            payload.SelectToken("settings.serializedOverrides") as JArray;
        if (overrides is null || overrides.Count != 0)
            errors.Add("CS_Als_Default must have no serialized setting overrides");
        ExpectValue(
            errors,
            payload,
            "settings.defaults.bIgnoreTimeDilation.value",
            true);
        ExpectNumber(
            errors,
            payload,
            "settings.defaults.TeleportDistanceThreshold.value",
            200);
        ExpectNumber(
            errors,
            payload,
            "settings.defaults.FirstPerson.FieldOfView.value",
            90);
        ExpectValue(
            errors,
            payload,
            "settings.defaults.FirstPerson.CameraSocketName.value",
            "FirstPersonCamera");
        ExpectNumber(
            errors,
            payload,
            "settings.defaults.ThirdPerson.FieldOfView.value",
            90);
        ExpectValue(
            errors,
            payload,
            "settings.defaults.ThirdPerson.FirstPivotSocketName.value",
            "root");
        ExpectValue(
            errors,
            payload,
            "settings.defaults.ThirdPerson.SecondPivotSocketName.value",
            "head");
        ExpectNumber(
            errors,
            payload,
            "settings.defaults.ThirdPerson.TraceRadius.value",
            15);
        ExpectValue(
            errors,
            payload,
            "settings.defaults.ThirdPerson.TraceChannel.value",
            "ECC_Visibility");
        ExpectValue(
            errors,
            payload,
            "settings.defaults.ThirdPerson.TraceShoulderLeftSocketName.value",
            "ThirdPersonTraceShoulderLeft");
        ExpectValue(
            errors,
            payload,
            "settings.defaults.ThirdPerson.TraceShoulderRightSocketName.value",
            "ThirdPersonTraceShoulderRight");
        ExpectArray(
            errors,
            payload,
            "settings.defaults.ThirdPerson.TraceOverrideOffset.value",
            [0, 0, 40]);
        ExpectValue(
            errors,
            payload,
            "settings.defaults.ThirdPerson.bEnableTraceDistanceSmoothing.value",
            true);
        ExpectNumber(
            errors,
            payload,
            "settings.defaults.ThirdPerson.TraceDistanceSmoothing.InterpolationSpeed.value",
            3);
        ExpectValue(
            errors,
            payload,
            "component.defaults.bOverrideFieldOfView.value",
            false);
        ExpectNumber(
            errors,
            payload,
            "component.defaults.FieldOfViewOverride.value",
            90);
        ExpectNumber(
            errors,
            payload,
            "component.defaults.PostProcessWeight.value",
            0);
        ExpectValue(
            errors,
            payload,
            "component.defaults.bRightShoulder.value",
            true);
        var componentProperties =
            payload.SelectToken("component.serializedProperties")?.Values<string>()
                .ToArray()
            ?? [];
        var expectedComponentProperties = new[]
        {
            "AnimClass",
            "Settings",
            "SkeletalMesh",
            "SkeletalMeshAsset",
            "SkinnedAsset",
        };
        if (!componentProperties.SequenceEqual(expectedComponentProperties))
        {
            errors.Add(
                "B_Als_CameraComponent serialized properties changed: " +
                string.Join(", ", componentProperties));
        }
        return Validation("camera defaults and absent data-asset overrides", errors);
    }

    static JObject ValidateCurveContract(JObject payload)
    {
        var errors = new JArray();
        var curveNameEntries =
            (payload["curveNames"] as JArray)?.OfType<JObject>().ToArray() ?? [];
        var names = curveNameEntries
                        .Select(name => name.Value<string>("name"))
                        .ToArray();
        if (!names.SequenceEqual(ExpectedCurveNames))
        {
            errors.Add(
                "camera curve-name contract changed: " +
                string.Join(", ", names.Select(name => name ?? "<missing>")));
        }
        foreach (var entry in curveNameEntries)
        {
            if (entry.SelectToken("source.kind")?.Value<string>() != "cppConstant")
                errors.Add($"{entry.Value<string>("name")} has no C++ provenance");
        }
        return Validation("13 camera curve names", errors);
    }

    static JObject ValidateCameraSockets(JObject payload)
    {
        var errors = new JArray();
        var sockets =
            (payload["sockets"] as JArray)?.OfType<JObject>().ToArray() ?? [];
        var names = sockets.Select(socket => socket.Value<string>("name")).ToArray();
        if (!names.SequenceEqual(ExpectedCameraSockets))
        {
            errors.Add(
                "camera socket inventory changed: " +
                string.Join(", ", names.Select(name => name ?? "<missing>")));
            return Validation("authored camera skeleton sockets", errors);
        }

        var expected = new Dictionary<string, double[]>(StringComparer.Ordinal)
        {
            ["FirstPersonCamera"] = [4, 14, 0],
            ["ThirdPersonTraceShoulderLeft"] = [5, 0, -20],
            ["ThirdPersonTraceShoulderRight"] = [5, 0, 20],
        };
        foreach (var socket in sockets)
        {
            var name = socket.Value<string>("name")!;
            if (socket.Value<string>("parentBone") != "head")
                errors.Add($"{name} parent bone must be head");
            if (!socket.Value<bool>("referencedBySkeleton"))
                errors.Add($"{name} is not referenced by SK_Als.Sockets");
            ExpectArray(
                errors,
                socket,
                "relativeTransformUnreal.translationCm.value",
                expected[name]);
            ExpectArray(
                errors,
                socket,
                "relativeTransformUnreal.rotationDegrees.value",
                [0, 0, 0]);
            ExpectArray(
                errors,
                socket,
                "relativeTransformUnreal.scale.value",
                [1, 1, 1]);
            ExpectValue(
                errors,
                socket,
                "relativeTransformUnreal.rotationDegrees.source",
                "unserialized USkeletalMeshSocket identity default");
            ExpectValue(
                errors,
                socket,
                "relativeTransformUnreal.scale.source",
                "unserialized USkeletalMeshSocket unit-scale default");
        }
        return Validation("authored camera skeleton sockets", errors);
    }

    static JObject ValidateCameraShake(JObject payload)
    {
        var errors = new JArray();
        ExpectValue(
            errors,
            payload,
            "cameraShake.asset",
            CameraShakeAsset);
        ExpectValue(
            errors,
            payload,
            "cameraShake.rootPattern.type",
            "WaveOscillatorCameraShakePattern");
        ExpectArray(
            errors,
            payload,
            "cameraShake.rootPattern.serializedProperties",
            [
                "BlendInTime",
                "BlendOutTime",
                "Duration",
                "Pitch",
                "Roll",
                "RotationAmplitudeMultiplier",
                "Yaw",
            ]);
        ExpectNumber(
            errors,
            payload,
            "cameraShake.rootPattern.values.RotationAmplitudeMultiplier",
            1);
        foreach (var axis in new[] { "Pitch", "Yaw", "Roll" })
        {
            ExpectNumber(
                errors,
                payload,
                $"cameraShake.rootPattern.values.{axis}.Amplitude",
                0.1);
            ExpectNumber(
                errors,
                payload,
                $"cameraShake.rootPattern.values.{axis}.Frequency",
                0.1);
        }
        ExpectNumber(
            errors,
            payload,
            "cameraShake.rootPattern.values.Duration",
            0.2);
        ExpectNumber(
            errors,
            payload,
            "cameraShake.rootPattern.values.BlendInTime",
            0.1);
        ExpectNumber(
            errors,
            payload,
            "cameraShake.rootPattern.values.BlendOutTime",
            0.1);
        ExpectNumber(
            errors,
            payload,
            "cameraShake.notifyDefaults.CameraShakeScale.value",
            1);
        ExpectValue(
            errors,
            payload,
            "cameraShake.notifyDefaults.CameraShakeScale.source.path",
            CameraShakeNotifyHeader);

        var notifies =
            (payload.SelectToken("cameraShake.notifies") as JArray)
                ?.OfType<JObject>()
                .ToArray()
            ?? [];
        var expected = new[]
        {
            (
                Sequence: "A_Als_Sprint",
                Length: 0.6,
                Loop: true,
                Time: 0.06666667,
                Threshold: 0.5,
                Scale: 0.5,
                SerializedScale: true),
            (
                Sequence: "A_Als_Sprint",
                Length: 0.6,
                Loop: true,
                Time: 0.36666667,
                Threshold: 0.5,
                Scale: 0.5,
                SerializedScale: true),
            (
                Sequence: "A_Als_Sprint_Acceleration",
                Length: 0.6,
                Loop: true,
                Time: 0.06666667,
                Threshold: 0.5,
                Scale: 1.25,
                SerializedScale: true),
            (
                Sequence: "A_Als_Sprint_Acceleration",
                Length: 0.6,
                Loop: true,
                Time: 0.36666667,
                Threshold: 0.5,
                Scale: 1.25,
                SerializedScale: true),
            (
                Sequence: "A_Als_Roll",
                Length: 1.5,
                Loop: false,
                Time: 0.10000001,
                Threshold: 0.00001,
                Scale: 1.0,
                SerializedScale: false),
            (
                Sequence: "A_Als_Roll",
                Length: 1.5,
                Loop: false,
                Time: 0.4666667,
                Threshold: 0.00001,
                Scale: 2.0,
                SerializedScale: true),
        };
        if (notifies.Length != expected.Length)
        {
            errors.Add(
                $"camera shake notify count is {notifies.Length}, expected " +
                expected.Length);
        }
        else
        {
            for (var index = 0; index < expected.Length; index++)
            {
                var actual = notifies[index];
                var item = expected[index];
                if (actual.Value<string>("sequence") != item.Sequence
                    || !NearlyEqual(
                        actual.Value<double>("sequenceLength"),
                        item.Length)
                    || actual.Value<bool>("loop") != item.Loop
                    || !NearlyEqual(actual.Value<double>("time"), item.Time)
                    || !NearlyEqual(
                        actual.Value<double>("triggerWeightThreshold"),
                        item.Threshold)
                    || !NearlyEqual(
                        actual.SelectToken("cameraShakeScale.value")!
                            .Value<double>(),
                        item.Scale))
                {
                    errors.Add(
                        $"camera shake notify {index} changed: " +
                        actual.ToString(Formatting.None));
                }

                var serializedProperties =
                    actual["serializedProperties"]?.Values<string>().ToArray()
                    ?? [];
                var expectedProperties = item.SerializedScale
                    ? new[] { "CameraShakeClass", "CameraShakeScale" }
                    : new[] { "CameraShakeClass" };
                if (!serializedProperties.SequenceEqual(expectedProperties))
                {
                    errors.Add(
                        $"camera shake notify {index} serialized properties " +
                        $"changed: {string.Join(", ", serializedProperties)}");
                }
                if (actual.Value<string>("notifyName") != "AlsCameraShake"
                    || actual.SelectToken("cameraShakeClass.value")?.Value<string>()
                    != "B_Als_CameraShake_Sprint_C"
                    || actual.Value<string>("montageTickType")
                    != "EMontageNotifyTickType::Queued"
                    || !NearlyEqual(
                        actual.Value<double>("notifyTriggerChance"),
                        1)
                    || actual.Value<string>("notifyFilterType")
                    != "ENotifyFilterType::NoFiltering"
                    || actual.Value<int>("notifyFilterLod") != 0
                    || actual.Value<bool>("triggerOnDedicatedServer")
                    || actual.Value<bool>("triggerOnFollower"))
                {
                    errors.Add(
                        $"camera shake notify {index} firing contract changed");
                }
            }
        }

        return Validation(
            "authored camera shake pattern and six notify payloads",
            errors);
    }

    static JObject ValidateBlendCurves(JObject payload)
    {
        var errors = new JArray();
        ValidateRichCurve(
            errors,
            payload.SelectToken(
                "blendCurves.CF_Als_CameraBlend_Quick.keys") as JArray,
            [
                (0, 0, "RCIM_Cubic", "RCTM_Auto", 0),
                (0.175, 0.20000002, "RCIM_Cubic", "RCTM_User", 2.985797),
                (1, 1, "RCIM_Linear", "RCTM_Auto", 0),
            ],
            "Quick");
        ValidateRichCurve(
            errors,
            payload.SelectToken(
                "blendCurves.CF_Als_CameraBlend_Smooth.keys") as JArray,
            [
                (0, 0, "RCIM_Cubic", "RCTM_Auto", 0),
                (0.3, 0.25, "RCIM_Cubic", "RCTM_User", 2.2001958),
                (1, 1, "RCIM_Linear", "RCTM_Auto", 0),
            ],
            "Smooth");
        return Validation("authored Quick and Smooth rich curves", errors);
    }

    static JObject ValidateGraphTopology(JObject payload)
    {
        var errors = new JArray();
        if (payload.SelectToken("animGraph.compiledNodeCount")?.Value<int>() != 83
            || payload.SelectToken("animGraph.serializedNodeCount")?.Value<int>()
            != 83)
        {
            errors.Add("AB_Als_Camera must have exactly 83 compiled/serialized nodes");
        }
        if (payload.SelectToken("animGraph.playerNodeCount")?.Value<int>() != 0)
            errors.Add("AB_Als_Camera must have no animation player nodes");

        var nodes = (payload.SelectToken("animGraph.nodes") as JArray)
                        ?.OfType<JObject>()
                        .ToDictionary(node => node.Value<int>("index"))
                    ?? new Dictionary<int, JObject>();
        if (nodes.Count != 83)
        {
            errors.Add($"normalized node count is {nodes.Count}, expected 83");
            return Validation("camera graph topology and bindings", errors);
        }

        foreach (var node in nodes.Values)
        {
            var index = node.Value<int>("index");
            var targetIndices =
                (node["poseLinks"] as JArray)?.OfType<JObject>()
                    .Select(link => link.Value<int>("targetNodeIndex"))
                    .Distinct()
                    .ToArray()
                ?? [];
            if (targetIndices.Length > 0
                && (targetIndices.Length != 1 || targetIndices[0] != index))
            {
                errors.Add(
                    $"node {index} SourceLinkID anchors are " +
                    string.Join(",", targetIndices));
            }
        }

        ExpectNodeType(errors, nodes, 0, "FAnimNode_Root");
        ExpectNodeType(errors, nodes, 66, "FAnimNode_StateMachine");
        ExpectNodeType(errors, nodes, 68, "FAlsAnimNode_GameplayTagsBlend");
        ExpectNodeType(errors, nodes, 70, "FAlsAnimNode_GameplayTagsBlend");
        ExpectNodeType(errors, nodes, 76, "FAnimNode_BlendListByBool");
        ExpectNodeType(errors, nodes, 78, "FAnimNode_ModifyCurve");

        var modifiedCurves = nodes.Values
            .SelectMany(node => node["CurveNames"]?.Values<string>() ?? [])
            .Distinct(StringComparer.Ordinal)
            .Order(StringComparer.Ordinal)
            .ToArray();
        var expectedModifiedCurves = new[]
        {
            "CameraOffsetX",
            "CameraOffsetY",
            "CameraOffsetZ",
            "FirstPersonOverride",
            "LocationLagX",
            "LocationLagY",
            "LocationLagZ",
            "PivotOffsetZ",
            "RotationLag",
            "TraceOverride",
        };
        if (!modifiedCurves.SequenceEqual(expectedModifiedCurves))
        {
            errors.Add(
                "AB_Als_Camera modified-curve set changed: " +
                string.Join(", ", modifiedCurves));
        }

        var bindings =
            (payload.SelectToken("animGraph.propertyBindings") as JArray)
                ?.OfType<JObject>()
                .Select(
                    binding =>
                        $"{binding.Value<string>("graph")}:" +
                        $"{binding.Value<string>("sourceProperty")}")
                .ToArray()
            ?? [];
        var expectedBindings = new[]
        {
            "Aiming:Stance",
            "Aiming:Gait",
            "Aiming:Gait",
            "AnimGraph:ViewMode",
            "AnimGraph:LocomotionAction",
            "AnimGraph:bRightShoulder",
            "Velocity Direction:Stance",
            "Velocity Direction:Gait",
            "Velocity Direction:Gait",
            "View Direction:Stance",
            "View Direction:Gait",
            "View Direction:Gait",
        };
        if (!bindings.SequenceEqual(expectedBindings))
        {
            errors.Add(
                "camera property bindings changed: " +
                string.Join(", ", bindings));
        }

        var ruleGraphs =
            (payload.SelectToken("animGraph.transitionRuleEditorGraphs") as JArray)
                ?.OfType<JObject>()
                .ToArray()
            ?? [];
        if (ruleGraphs.Length != 3
            || ruleGraphs.Count(
                graph => graph.Value<bool>("acceptsInvalidTag")) != 1
            || ruleGraphs.Any(
                graph => !graph["propertyPaths"]!.Values<string>()
                    .SequenceEqual(["RotationMode"])))
        {
            errors.Add(
                "transition editor graphs must be three RotationMode rules " +
                "with one invalid-tag fallback");
        }

        ValidateStateMachine(errors, payload);

        var rebuiltBranches = BuildBranches(nodes);
        if (!JsonEquivalent(
                rebuiltBranches,
                payload.SelectToken("animGraph.branches")))
        {
            errors.Add(
                "semantic branches do not match normalized graph nodes: " +
                FirstJsonDifference(
                    rebuiltBranches,
                    payload.SelectToken("animGraph.branches"),
                    "$"));
        }
        return Validation("camera graph topology and bindings", errors);
    }

    static JObject ValidateLookProfiles(JObject payload)
    {
        var errors = new JArray();
        var expected = new[]
        {
            new ExpectedLookState(
                "VelocityDirection",
                65,
                63,
                ["RotationLag", "TraceOverride"],
                [20, 1],
                47,
                2,
                new ExpectedStance(
                    62,
                    50,
                    48,
                    [1, 1, 1],
                    [
                        new ExpectedProfile(58, [-325, 0, 20, 5, 5, 15]),
                        new ExpectedProfile(57, [-325, 0, 20, 5, 5, 15]),
                        new ExpectedProfile(56, [-325, 0, 20, 5, 5, 15]),
                    ]),
                new ExpectedStance(
                    64,
                    30,
                    49,
                    [1, 1, 1],
                    [
                        new ExpectedProfile(61, [-325, 0, 20, 5, 5, 15]),
                        new ExpectedProfile(60, [-325, 0, 20, 5, 5, 15]),
                        new ExpectedProfile(59, [-325, 0, 20, 5, 5, 15]),
                    ])),
            new ExpectedLookState(
                "ViewDirection",
                46,
                44,
                ["RotationLag"],
                [20],
                30,
                1.75,
                new ExpectedStance(
                    43,
                    40,
                    29,
                    [1.5, 2, 0.35],
                    [
                        new ExpectedProfile(42, [-280, 70, 35, 8, 8, 15]),
                        new ExpectedProfile(41, [-275, 75, 35, 4, 6, 15]),
                        new ExpectedProfile(40, [-250, 70, 5, 10, 5, 15]),
                    ]),
                new ExpectedStance(
                    45,
                    25,
                    28,
                    [1.5, 1.5, 1.5],
                    [
                        new ExpectedProfile(39, [-250, 55, 35, 5, 5, 15]),
                        new ExpectedProfile(38, [-250, 55, 35, 5, 5, 15]),
                        new ExpectedProfile(37, [-250, 55, 35, 10, 5, 15]),
                    ])),
            new ExpectedLookState(
                "Aiming",
                27,
                25,
                ["RotationLag"],
                [45],
                9,
                1,
                new ExpectedStance(
                    24,
                    50,
                    11,
                    [1, 1, 0.35],
                    [
                        new ExpectedProfile(23, [-200, 70, 20, 15, 15, 15]),
                        new ExpectedProfile(22, [-200, 70, 20, 15, 15, 15]),
                        new ExpectedProfile(21, [-200, 70, 5, 10, 5, 15]),
                    ]),
                new ExpectedStance(
                    26,
                    30,
                    10,
                    [1, 1, 1],
                    [
                        new ExpectedProfile(20, [-200, 60, 35, 15, 15, 15]),
                        new ExpectedProfile(19, [-200, 60, 35, 15, 15, 15]),
                        new ExpectedProfile(18, [-200, 60, 35, 15, 15, 15]),
                    ])),
        };

        foreach (var state in expected)
            ValidateLookState(errors, payload, state);
        return Validation("rotation-mode, stance, and gait camera profiles", errors);
    }

    static JObject ValidateOuterBranches(JObject payload)
    {
        var errors = new JArray();
        var basePath = "animGraph.branches";
        ExpectArray(
            errors,
            payload,
            $"{basePath}.viewMode.blend.tags",
            ["Als.ViewMode.FirstPerson"]);
        ExpectArray(
            errors,
            payload,
            $"{basePath}.viewMode.blend.blendTimes",
            [0.1, 0.1]);
        ExpectValue(
            errors,
            payload,
            $"{basePath}.viewMode.blend.blendType",
            "EAlphaBlendOption::HermiteCubic");
        ValidateModifier(
            errors,
            payload,
            $"{basePath}.viewMode.ThirdPerson",
            5,
            ["FirstPersonOverride"],
            [0]);
        ValidateModifier(
            errors,
            payload,
            $"{basePath}.viewMode.FirstPerson",
            4,
            ["FirstPersonOverride", "TraceOverride"],
            [1, 1]);

        ExpectValue(
            errors,
            payload,
            $"{basePath}.shoulder.blend.nodeIndex",
            76);
        ExpectArray(
            errors,
            payload,
            $"{basePath}.shoulder.blend.sourceNodeIndices",
            [2, 3]);
        ExpectArray(
            errors,
            payload,
            $"{basePath}.shoulder.blend.blendTimes",
            [0.5, 0.5]);
        ExpectValue(
            errors,
            payload,
            $"{basePath}.shoulder.blend.customCurve",
            "CF_Als_CameraBlend_Quick");
        ValidateModifier(
            errors,
            payload,
            $"{basePath}.shoulder.branches[0]",
            2,
            ["CameraOffsetY"],
            [1],
            "EModifyCurveApplyMode::Scale");
        ValidateModifier(
            errors,
            payload,
            $"{basePath}.shoulder.branches[1]",
            3,
            ["CameraOffsetY"],
            [-1],
            "EModifyCurveApplyMode::Scale");

        ExpectArray(
            errors,
            payload,
            $"{basePath}.locomotionAction.blend.tags",
            [
                "Als.LocomotionAction.Mantling",
                "Als.LocomotionAction.Rolling",
                "Als.LocomotionAction.Ragdolling",
            ]);
        ExpectArray(
            errors,
            payload,
            $"{basePath}.locomotionAction.blend.blendTimes",
            [0.4, 0.2, 0.2, 1]);
        ValidateModifier(
            errors,
            payload,
            $"{basePath}.locomotionAction.Mantling",
            74,
            ["LocationLagX", "LocationLagY", "LocationLagZ"],
            [5, 5, 3]);
        ValidateModifier(
            errors,
            payload,
            $"{basePath}.locomotionAction.Rolling",
            77,
            ["LocationLagX", "LocationLagY", "LocationLagZ", "TraceOverride"],
            [5, 5, 5, 1]);
        ValidateModifier(
            errors,
            payload,
            $"{basePath}.locomotionAction.Ragdolling",
            78,
            [
                "CameraOffsetX",
                "CameraOffsetY",
                "CameraOffsetZ",
                "PivotOffsetZ",
                "LocationLagX",
                "LocationLagY",
                "LocationLagZ",
                "RotationLag",
                "TraceOverride",
            ],
            [-320, 0, 50, 25, 5, 5, 15, 20, 1]);
        return Validation("view, shoulder, and action camera branches", errors);
    }

    static void ValidateLookState(
        JArray errors,
        JObject payload,
        ExpectedLookState expected)
    {
        var path =
            $"animGraph.branches.lookStates.{expected.Name}";
        ExpectValue(
            errors,
            payload,
            $"{path}.resultNodeIndex",
            expected.ResultNode);
        ValidateModifier(
            errors,
            payload,
            $"{path}.finalModifier",
            expected.FinalNode,
            expected.FinalCurveNames,
            expected.FinalValues);
        ExpectValue(
            errors,
            payload,
            $"{path}.stanceBlend.nodeIndex",
            expected.StanceNode);
        ExpectArray(
            errors,
            payload,
            $"{path}.stanceBlend.tags",
            ["Als.Stance.Crouching"]);
        ExpectArray(
            errors,
            payload,
            $"{path}.stanceBlend.blendTimes",
            [expected.StanceTime, expected.StanceTime]);
        ValidateStance(errors, payload, $"{path}.Standing", expected.Standing);
        ValidateStance(errors, payload, $"{path}.Crouching", expected.Crouching);
    }

    static void ValidateStance(
        JArray errors,
        JObject payload,
        string path,
        ExpectedStance expected)
    {
        ValidateModifier(
            errors,
            payload,
            $"{path}.pivotModifier",
            expected.PivotNode,
            ["PivotOffsetZ"],
            [expected.PivotZ]);
        ExpectValue(
            errors,
            payload,
            $"{path}.gaitBlend.nodeIndex",
            expected.GaitNode);
        ExpectArray(
            errors,
            payload,
            $"{path}.gaitBlend.tags",
            ["Als.Gait.Running", "Als.Gait.Sprinting"]);
        ExpectArray(
            errors,
            payload,
            $"{path}.gaitBlend.blendTimes",
            expected.GaitTimes);
        for (var index = 0; index < expected.Profiles.Length; index++)
        {
            ValidateModifier(
                errors,
                payload,
                $"{path}.profiles[{index}]",
                expected.Profiles[index].Node,
                [
                    "CameraOffsetX",
                    "CameraOffsetY",
                    "CameraOffsetZ",
                    "LocationLagX",
                    "LocationLagY",
                    "LocationLagZ",
                ],
                expected.Profiles[index].CameraAndLag);
        }
    }

    static void ValidateModifier(
        JArray errors,
        JObject payload,
        string path,
        int node,
        IEnumerable<string> curveNames,
        IEnumerable<double> values,
        string applyMode = "EModifyCurveApplyMode::Blend")
    {
        ExpectValue(errors, payload, $"{path}.nodeIndex", node);
        ExpectArray(errors, payload, $"{path}.curveNames", curveNames);
        ExpectArray(errors, payload, $"{path}.values", values);
        ExpectValue(
            errors,
            payload,
            $"{path}.applyMode",
            applyMode);
    }

    static void ValidateStateMachine(JArray errors, JObject payload)
    {
        var machine = payload.SelectToken("animGraph.stateMachine") as JObject;
        if (machine is null)
        {
            errors.Add("Look States state machine is missing");
            return;
        }
        if (machine.Value<string>("name") != "Look States"
            || machine.Value<string>("initialState") != "Velocity Direction")
        {
            errors.Add("Look States name or initial state changed");
        }
        var states =
            (machine["states"] as JArray)?.OfType<JObject>().ToArray() ?? [];
        var expectedStates = new[]
        {
            ("Velocity Direction", 65),
            ("View Direction", 46),
            ("Aiming", 27),
        };
        if (states.Length != expectedStates.Length)
        {
            errors.Add($"Look States has {states.Length} states, expected 3");
        }
        for (var index = 0;
             index < Math.Min(states.Length, expectedStates.Length);
             index++)
        {
            if (states[index].Value<string>("name") != expectedStates[index].Item1
                || states[index].Value<int>("rootCompiledNodeIndex")
                != expectedStates[index].Item2)
            {
                errors.Add($"Look States state {index} identity/root changed");
            }
            if (states[index]["playerNodeIndices"]?.Any() == true)
                errors.Add($"{expectedStates[index].Item1} unexpectedly has players");
        }

        var expectedTransitions = new[]
        {
            ("Velocity Direction", "View Direction", 1.0, "CF_Als_CameraBlend_Smooth"),
            ("Velocity Direction", "Aiming", 0.35, "CF_Als_CameraBlend_Quick"),
            ("View Direction", "Aiming", 0.35, "CF_Als_CameraBlend_Quick"),
            ("View Direction", "Velocity Direction", 1.0, "CF_Als_CameraBlend_Smooth"),
            ("Aiming", "Velocity Direction", 1.0, "CF_Als_CameraBlend_Smooth"),
            ("Aiming", "View Direction", 1.0, "CF_Als_CameraBlend_Smooth"),
        };
        var transitions =
            (machine["transitions"] as JArray)?.OfType<JObject>().ToArray() ?? [];
        if (transitions.Length != expectedTransitions.Length)
        {
            errors.Add(
                $"Look States has {transitions.Length} transitions, expected 6");
        }
        for (var index = 0;
             index < Math.Min(transitions.Length, expectedTransitions.Length);
             index++)
        {
            var actual = transitions[index];
            var expected = expectedTransitions[index];
            if (actual.Value<string>("previousState") != expected.Item1
                || actual.Value<string>("nextState") != expected.Item2
                || !NearlyEqual(actual.Value<double>("duration"), expected.Item3)
                || actual.Value<string>("customCurve") != expected.Item4
                || actual.Value<string>("blendMode")
                != "EAlphaBlendOption::Custom")
            {
                errors.Add($"Look States transition {index} changed");
            }
        }

        var expressions = states
            .SelectMany(
                state => (state["transitions"] as JArray)?.OfType<JObject>()
                         ?? [])
            .Select(transition => transition["expression"] as JObject)
            .Where(expression => expression is not null)
            .Select(expression => expression!)
            .ToArray();
        if (expressions.Length != 6
            || expressions.Count(
                expression => expression.Value<bool>("acceptsInvalidTag")) != 2)
        {
            // The shared VelocityDirection rule is referenced by two incoming
            // transitions, so its invalid-tag fallback appears twice here.
            errors.Add("RotationMode transition expressions changed");
        }
    }

    static void ValidateRichCurve(
        JArray errors,
        JArray? keys,
        (double Time, double Value, string Interp, string Tangent, double Slope)[]
            expected,
        string name)
    {
        if (keys is null || keys.Count != expected.Length)
        {
            errors.Add(
                $"{name} has {keys?.Count ?? 0} keys, expected {expected.Length}");
            return;
        }
        for (var index = 0; index < expected.Length; index++)
        {
            var key = (JObject)keys[index]!;
            var sentinel = expected[index];
            if (!NearlyEqual(key.Value<double>("Time"), sentinel.Time)
                || !NearlyEqual(key.Value<double>("Value"), sentinel.Value)
                || key.Value<string>("InterpMode") != sentinel.Interp
                || key.Value<string>("TangentMode") != sentinel.Tangent
                || !NearlyEqual(
                    key.Value<double>("ArriveTangent"),
                    sentinel.Slope)
                || !NearlyEqual(
                    key.Value<double>("LeaveTangent"),
                    sentinel.Slope))
            {
                errors.Add($"{name} key {index} changed");
            }
        }
    }

    static void ExpectNodeType(
        JArray errors,
        IReadOnlyDictionary<int, JObject> nodes,
        int index,
        string type)
    {
        if (!nodes.TryGetValue(index, out var node)
            || node.Value<string>("type") != type)
        {
            errors.Add($"node {index} must be {type}");
        }
    }

    static void ExpectValue(
        JArray errors,
        JObject payload,
        string path,
        object? expected)
    {
        var actual = payload.SelectToken(path);
        var expectedToken = expected is null
            ? JValue.CreateNull()
            : JToken.FromObject(expected);
        if (actual is null || !JToken.DeepEquals(actual, expectedToken))
        {
            errors.Add(
                $"{path}: expected {expectedToken.ToString(Formatting.None)}, got " +
                $"{actual?.ToString(Formatting.None) ?? "<missing>"}");
        }
    }

    static void ExpectNumber(
        JArray errors,
        JObject payload,
        string path,
        double expected)
    {
        var actual = payload.SelectToken(path)?.Value<double?>();
        if (actual is null || !NearlyEqual(actual.Value, expected))
            errors.Add($"{path}: expected {expected}, got {actual?.ToString() ?? "<missing>"}");
    }

    static void ExpectArray<T>(
        JArray errors,
        JObject payload,
        string path,
        IEnumerable<T> expected)
    {
        var actual = payload.SelectToken(path) as JArray;
        var expectedArray = new JArray(expected);
        var equal = actual is not null
                    && actual.Count == expectedArray.Count
                    && actual.Zip(expectedArray).All(
                        pair =>
                            pair.First.Type is JTokenType.Float
                                or JTokenType.Integer
                            && pair.Second.Type is JTokenType.Float
                                or JTokenType.Integer
                                ? NearlyEqual(
                                    pair.First.Value<double>(),
                                    pair.Second.Value<double>())
                                : JToken.DeepEquals(pair.First, pair.Second));
        if (!equal)
        {
            errors.Add(
                $"{path}: expected {expectedArray.ToString(Formatting.None)}, got " +
                $"{actual?.ToString(Formatting.None) ?? "<missing>"}");
        }
    }

    static JObject Validation(string name, JArray errors)
    {
        return new JObject
        {
            ["name"] = name,
            ["status"] = errors.Count == 0 ? "pass" : "fail",
            ["errors"] = errors,
        };
    }

    static void PrintValidations(JArray validations)
    {
        foreach (var validation in validations.OfType<JObject>())
        {
            Console.WriteLine(
                $"[{validation.Value<string>("status")}] " +
                validation.Value<string>("name"));
            foreach (var error in validation["errors"]?.Values<string>() ?? [])
                Console.WriteLine($"  - {error}");
        }
    }

    static void ThrowOnValidationFailure(JArray validations)
    {
        if (validations.OfType<JObject>()
            .Any(validation => validation.Value<string>("status") != "pass"))
        {
            throw new Exception("camera content validation failed");
        }
    }

    static SourceDocument ReadSource(string srcDir, string sourcePath)
    {
        var stagedPath = Path.Combine(srcDir, "ALS", sourcePath);
        var directPath = Path.Combine(srcDir, sourcePath);
        var fullPath = File.Exists(stagedPath)
            ? stagedPath
            : File.Exists(directPath)
                ? directPath
                : throw new Exception(
                    $"{sourcePath} was not found below {Path.GetFullPath(srcDir)}");
        return new SourceDocument(sourcePath, File.ReadAllText(fullPath));
    }

    static (string Text, int Start) ExtractBlock(
        SourceDocument source,
        string declaration)
    {
        var declarationIndex = source.Text.IndexOf(
            declaration,
            StringComparison.Ordinal);
        if (declarationIndex < 0)
            throw new Exception($"{declaration} was not found in {source.Path}");
        var openBrace = source.Text.IndexOf('{', declarationIndex);
        if (openBrace < 0)
            throw new Exception($"{declaration} has no body in {source.Path}");
        var depth = 0;
        for (var index = openBrace; index < source.Text.Length; index++)
        {
            if (source.Text[index] == '{')
                depth++;
            else if (source.Text[index] == '}')
                depth--;
            if (depth == 0)
            {
                return (
                    source.Text[declarationIndex..(index + 1)],
                    declarationIndex);
            }
        }
        throw new Exception($"{declaration} has an unterminated body in {source.Path}");
    }

    static JObject ReadNumberDefault(
        SourceDocument source,
        (string Text, int Start) block,
        string property,
        string unit)
    {
        const string number =
            @"[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?";
        var match = RequiredMatch(
            block.Text,
            $@"\b{Regex.Escape(property)}\s*\{{\s*" +
            $@"(?<value>{number})[fF]?\s*\}}",
            $"{property} numeric default");
        var value = double.Parse(
            match.Groups["value"].Value,
            NumberStyles.Float,
            CultureInfo.InvariantCulture);
        return SourceValue(
            value,
            source,
            block.Start + match.Index,
            "cppDefault",
            unit);
    }

    static JObject ReadBoolDefault(
        SourceDocument source,
        (string Text, int Start) block,
        string property)
    {
        var match = RequiredMatch(
            block.Text,
            $@"\b{Regex.Escape(property)}(?:\s*:\s*1)?\s*" +
            @"\{\s*(?<value>true|false)\s*\}",
            $"{property} bool default");
        return SourceValue(
            bool.Parse(match.Groups["value"].Value),
            source,
            block.Start + match.Index,
            "cppDefault");
    }

    static JObject ReadTextViewDefault(
        SourceDocument source,
        (string Text, int Start) block,
        string property)
    {
        var match = RequiredMatch(
            block.Text,
            $@"\b{Regex.Escape(property)}\s*\{{\s*" +
            @"TEXTVIEW\(""(?<value>[^""]+)""\)\s*\}",
            $"{property} FName default");
        return SourceValue(
            match.Groups["value"].Value,
            source,
            block.Start + match.Index,
            "cppDefault");
    }

    static JObject ReadResolvedNameDefault(
        string srcDir,
        SourceDocument source,
        (string Text, int Start) block,
        string property,
        string function)
    {
        var match = RequiredMatch(
            block.Text,
            $@"\b{Regex.Escape(property)}\s*\{{\s*" +
            $@"UAlsConstants::{Regex.Escape(function)}\(\)\s*\}}",
            $"{property} resolved FName default");
        var constants = ReadSource(srcDir, AlsConstantsHeader);
        var functionBlock = ExtractBlock(
            constants,
            $"UAlsConstants::{function}");
        var valueMatch = RequiredMatch(
            functionBlock.Text,
            @"TEXTVIEW\(""(?<value>[^""]+)""\)",
            $"{function} FName value");
        var result = SourceValue(
            valueMatch.Groups["value"].Value,
            source,
            block.Start + match.Index,
            "cppDefaultResolvedConstant");
        result["resolvedSource"] = SourceReference(
            constants,
            functionBlock.Start + valueMatch.Index,
            "cppConstant");
        return result;
    }

    static JObject ReadEnumDefault(
        SourceDocument source,
        (string Text, int Start) block,
        string property)
    {
        var match = RequiredMatch(
            block.Text,
            $@"\b{Regex.Escape(property)}\s*\{{\s*" +
            @"(?<value>[A-Za-z_][A-Za-z0-9_:]*)\s*\}",
            $"{property} enum default");
        return SourceValue(
            match.Groups["value"].Value,
            source,
            block.Start + match.Index,
            "cppDefault");
    }

    static JObject ReadVectorDefault(
        SourceDocument source,
        (string Text, int Start) block,
        string property,
        string unit)
    {
        const string number =
            @"[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?";
        var match = RequiredMatch(
            block.Text,
            $@"\b{Regex.Escape(property)}\s*\{{\s*" +
            $@"(?<x>{number})[fF]?\s*,\s*(?<y>{number})[fF]?\s*,\s*" +
            $@"(?<z>{number})[fF]?\s*\}}",
            $"{property} vector default");
        var values = new JArray(
            double.Parse(
                match.Groups["x"].Value,
                NumberStyles.Float,
                CultureInfo.InvariantCulture),
            double.Parse(
                match.Groups["y"].Value,
                NumberStyles.Float,
                CultureInfo.InvariantCulture),
            double.Parse(
                match.Groups["z"].Value,
                NumberStyles.Float,
                CultureInfo.InvariantCulture));
        return SourceValue(
            values,
            source,
            block.Start + match.Index,
            "cppDefault",
            unit);
    }

    static JObject ReadDefaultConstructedSetting(
        SourceDocument source,
        (string Text, int Start) block,
        string type,
        string property)
    {
        var match = RequiredMatch(
            block.Text,
            $@"\b{Regex.Escape(type)}\s+{Regex.Escape(property)}\s*;",
            $"{property} default construction");
        return SourceValue(
            $"{type} default constructor",
            source,
            block.Start + match.Index,
            "cppDefaultConstructor");
    }

    static JObject SourceValue(
        object value,
        SourceDocument source,
        int sourceIndex,
        string kind,
        string? unit = null)
    {
        var result = new JObject
        {
            ["value"] = value is JToken token
                ? token
                : JToken.FromObject(value),
            ["source"] = SourceReference(source, sourceIndex, kind),
        };
        if (unit is not null)
            result["unit"] = unit;
        return result;
    }

    static JObject SourceReference(
        SourceDocument source,
        int sourceIndex,
        string kind)
    {
        return new JObject
        {
            ["kind"] = kind,
            ["path"] = source.Path,
            ["line"] = 1 + source.Text.Take(sourceIndex).Count(character => character == '\n'),
        };
    }

    static Match RequiredMatch(string text, string pattern, string description)
    {
        var matches = Regex.Matches(
            text,
            pattern,
            RegexOptions.CultureInvariant);
        return matches.Count == 1
            ? matches[0]
            : throw new Exception(
                $"{description} matched {matches.Count} times, expected exactly once");
    }

    static string GraphName(string outer)
    {
        var quote = outer.LastIndexOf('\'');
        var end = quote >= 0 ? quote : outer.Length;
        var colon = outer.LastIndexOf(':', end - 1);
        var dot = outer.LastIndexOf('.', end - 1);
        var separator = Math.Max(colon, dot);
        return outer[(separator + 1)..end];
    }

    static string RotationModeTag(string stateName)
    {
        return stateName switch
        {
            "Velocity Direction" => "Als.RotationMode.VelocityDirection",
            "View Direction" => "Als.RotationMode.ViewDirection",
            "Aiming" => "Als.RotationMode.Aiming",
            _ => throw new Exception($"{stateName} has no ALS RotationMode tag"),
        };
    }

    static int BakedToCompiled(int bakedIndex, int nodeCount)
    {
        var compiledIndex = nodeCount - 1 - bakedIndex;
        if (compiledIndex < 0 || compiledIndex >= nodeCount)
            throw new Exception(
                $"baked node index {bakedIndex} is outside {nodeCount} nodes");
        return compiledIndex;
    }

    static string ReferenceName(string objectName)
    {
        var firstQuote = objectName.IndexOf('\'');
        var lastQuote = objectName.LastIndexOf('\'');
        return firstQuote >= 0 && lastQuote > firstQuote
            ? objectName[(firstQuote + 1)..lastQuote]
            : objectName;
    }

    static string ObjectLeafName(string objectName)
    {
        var referenceName = ReferenceName(objectName);
        var separator = Math.Max(
            referenceName.LastIndexOf(':'),
            referenceName.LastIndexOf('.'));
        return separator >= 0 ? referenceName[(separator + 1)..] : referenceName;
    }

    static void CopyOptional(JObject target, JObject source, string property)
    {
        if (source[property] is JToken value)
            target[property] = value.DeepClone();
    }

    static JToken? SerializeProperty(UObject export, string name)
    {
        var property = export.Properties.FirstOrDefault(
            candidate => candidate.Name.Text == name);
        return property?.Tag is null
            ? null
            : JToken.FromObject(property.Tag, Serializer);
    }

    static IEnumerable<PoseLink> FindPoseLinks(JToken token)
    {
        return FindPoseLinks(token, "");
    }

    static IEnumerable<PoseLink> FindPoseLinks(JToken token, string path)
    {
        if (token is JObject obj)
        {
            if (obj["LinkID"]?.Type == JTokenType.Integer
                && obj["SourceLinkID"]?.Type == JTokenType.Integer)
            {
                yield return new PoseLink(
                    path,
                    obj.Value<int>("LinkID"),
                    obj.Value<int>("SourceLinkID"));
                yield break;
            }
            foreach (var property in obj.Properties())
            {
                var childPath = string.IsNullOrEmpty(path)
                    ? property.Name
                    : $"{path}.{property.Name}";
                foreach (var link in FindPoseLinks(property.Value, childPath))
                    yield return link;
            }
        }
        else if (token is JArray array)
        {
            for (var index = 0; index < array.Count; index++)
            {
                foreach (var link in FindPoseLinks(array[index], $"{path}[{index}]"))
                    yield return link;
            }
        }
    }

    static JArray VectorXYZ(JObject? vector, double defaultValue)
    {
        return vector is null
            ? new JArray(defaultValue, defaultValue, defaultValue)
            : new JArray(
                vector.Value<double?>("X") ?? defaultValue,
                vector.Value<double?>("Y") ?? defaultValue,
                vector.Value<double?>("Z") ?? defaultValue);
    }

    static JArray RotatorPitchYawRoll(JObject? rotation)
    {
        return rotation is null
            ? new JArray(0.0, 0.0, 0.0)
            : new JArray(
                rotation.Value<double?>("Pitch") ?? 0,
                rotation.Value<double?>("Yaw") ?? 0,
                rotation.Value<double?>("Roll") ?? 0);
    }

    static string RequiredString(JObject obj, string property)
    {
        return obj.Value<string>(property)
               ?? throw new Exception($"{property} is missing or not a string");
    }

    static double RequiredNumber(JObject obj, string property)
    {
        return obj[property]?.Type is JTokenType.Float or JTokenType.Integer
            ? obj.Value<double>(property)
            : throw new Exception($"{property} is missing or not numeric");
    }

    static bool NearlyEqual(double actual, double expected)
    {
        return Math.Abs(actual - expected) <= 1e-6;
    }

    static bool JsonEquivalent(JToken? left, JToken? right)
    {
        if (left is null || right is null)
            return left is null && right is null;
        if (left.Type == JTokenType.Null && right.Type == JTokenType.Null)
            return true;
        if (left.Type is JTokenType.Float or JTokenType.Integer
            && right.Type is JTokenType.Float or JTokenType.Integer)
        {
            return NearlyEqual(left.Value<double>(), right.Value<double>());
        }
        if (left is JObject leftObject && right is JObject rightObject)
        {
            var leftNames = leftObject.Properties()
                .Select(property => property.Name)
                .Order(StringComparer.Ordinal)
                .ToArray();
            var rightNames = rightObject.Properties()
                .Select(property => property.Name)
                .Order(StringComparer.Ordinal)
                .ToArray();
            return leftNames.SequenceEqual(rightNames)
                   && leftNames.All(
                       name => JsonEquivalent(leftObject[name], rightObject[name]));
        }
        if (left is JArray leftArray && right is JArray rightArray)
        {
            return leftArray.Count == rightArray.Count
                   && leftArray.Zip(rightArray)
                       .All(pair => JsonEquivalent(pair.First, pair.Second));
        }
        return JToken.DeepEquals(left, right);
    }

    static string FirstJsonDifference(
        JToken? left,
        JToken? right,
        string path)
    {
        if (left is null || right is null)
        {
            return $"{path} is {left?.Type.ToString() ?? "<missing>"} vs " +
                   $"{right?.Type.ToString() ?? "<missing>"}";
        }
        if (left.Type == JTokenType.Null && right.Type == JTokenType.Null)
            return "<none>";
        if (left.Type is JTokenType.Float or JTokenType.Integer
            && right.Type is JTokenType.Float or JTokenType.Integer)
        {
            return NearlyEqual(left.Value<double>(), right.Value<double>())
                ? "<none>"
                : $"{path} is {left} vs {right}";
        }
        if (left is JObject leftObject && right is JObject rightObject)
        {
            var names = leftObject.Properties()
                .Select(property => property.Name)
                .Union(
                    rightObject.Properties().Select(property => property.Name),
                    StringComparer.Ordinal)
                .Order(StringComparer.Ordinal);
            foreach (var name in names)
            {
                if (!JsonEquivalent(leftObject[name], rightObject[name]))
                {
                    return FirstJsonDifference(
                        leftObject[name],
                        rightObject[name],
                        $"{path}.{name}");
                }
            }
        }
        else if (left is JArray leftArray && right is JArray rightArray)
        {
            if (leftArray.Count != rightArray.Count)
                return $"{path} count is {leftArray.Count} vs {rightArray.Count}";
            for (var index = 0; index < leftArray.Count; index++)
            {
                if (!JsonEquivalent(leftArray[index], rightArray[index]))
                {
                    return FirstJsonDifference(
                        leftArray[index],
                        rightArray[index],
                        $"{path}[{index}]");
                }
            }
        }
        else if (!JToken.DeepEquals(left, right))
        {
            return $"{path} is {left.ToString(Formatting.None)} ({left.Type}) vs " +
                   $"{right.ToString(Formatting.None)} ({right.Type})";
        }
        return "<none>";
    }
}
