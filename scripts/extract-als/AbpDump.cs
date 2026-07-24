using CUE4Parse.FileProvider;
using CUE4Parse.UE4.Assets;
using CUE4Parse.UE4.Assets.Exports;
using CUE4Parse.UE4.Assets.Objects;
using CUE4Parse.UE4.Assets.Objects.Properties;
using CUE4Parse.UE4.Versions;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

// Dumps the compiled runtime representation of ALS animation blueprints.
//
// Unreal writes each FAnimNode_* instance as a tagged struct property on the
// generated class default object. The generated property name is not a reliable
// discriminator: engine nodes use AnimGraphNode_*, while ALS nodes use
// both AlsAnimGraphNode_* and AlsAnimationGraphNode_*. FPropertyTag.TagData
// retains the exact runtime struct and module even when CUE4Parse has to expose
// the value as FStructFallback. The generated class separately stores baked
// state-machine descriptions.
public static class AbpDump
{
    const string CharacterPath = "/Content/ALS/Character/";

    // ALS Refactored 4.15 is the extraction pipeline's pinned reference release.
    // Keep this inventory explicit: adding or losing an AnimBlueprint must be a
    // reviewed content change, not something a filename filter can hide.
    static readonly IReadOnlyDictionary<string, string> ExpectedTargets =
        new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["AB_Als"] = "AnimBlueprint",
            ["AB_Als_Monolithic"] = "AnimBlueprint",
            ["ALI_Overlay"] = "AnimLayerInterface",
            ["AB_Als_Grounded"] = "AnimBlueprint",
            ["AB_Als_Layering"] = "AnimBlueprint",
            ["AB_Als_Locomotion"] = "AnimBlueprint",
            ["AB_Als_Ragdolling"] = "AnimBlueprint",
            ["AB_Als_View"] = "AnimBlueprint",
            ["AB_Als_Barrel"] = "AnimBlueprint",
            ["AB_Als_Binoculars"] = "AnimBlueprint",
            ["AB_Als_Bow"] = "AnimBlueprint",
            ["AB_Als_Box"] = "AnimBlueprint",
            ["AB_Als_Default"] = "AnimBlueprint",
            ["AB_Als_Feminine"] = "AnimBlueprint",
            ["AB_Als_HandsTied"] = "AnimBlueprint",
            ["AB_Als_Injured"] = "AnimBlueprint",
            ["AB_Als_Masculine"] = "AnimBlueprint",
            ["AB_Als_PistolOneHanded"] = "AnimBlueprint",
            ["AB_Als_PistolTwoHanded"] = "AnimBlueprint",
            ["AB_Als_Rifle"] = "AnimBlueprint",
            ["AB_Als_Torch"] = "AnimBlueprint",
            ["AB_Als_Crouching"] = "AnimBlueprint",
            ["AB_Als_Standing"] = "AnimBlueprint",
        };

    static readonly JsonSerializer Serializer = JsonSerializer.Create(
        new JsonSerializerSettings
        {
            ReferenceLoopHandling = ReferenceLoopHandling.Ignore,
        });

    sealed class NodeRecord
    {
        public required int SerializedOrder { get; init; }
        public required string PropertyName { get; init; }
        public required string Type { get; init; }
        public required string Module { get; init; }
        public required string Serialization { get; init; }
        public required JObject Parameters { get; init; }
        public int? CompiledIndex { get; set; }
        public required List<int> CompiledIndexCandidates { get; init; }
    }

    sealed class AssetRecord
    {
        public required string Name { get; init; }
        public required JObject Json { get; init; }
        public required List<NodeRecord> Nodes { get; init; }
    }

    public static int Run(string srcDir, string outJson)
    {
        var provider = new DefaultFileProvider(
            srcDir,
            SearchOption.AllDirectories,
            new VersionContainer(EGame.GAME_UE5_5));
        provider.Initialize();
        provider.Mount();

        var files = provider.Files.Values
            .Where(file => IsTarget(file.Path, file.NameWithoutExtension, file.Extension))
            .OrderBy(file => file.Path, StringComparer.Ordinal)
            .ToArray();
        if (files.Length == 0)
            throw new Exception(
                $"no ALS AnimBlueprint targets found below {srcDir}; expected the staged /ALS Content tree");

        var assets = new JObject();
        var records = new Dictionary<string, AssetRecord>(StringComparer.Ordinal);
        foreach (var file in files)
        {
            var loadedPackage = provider.LoadPackage(file);
            var exports = loadedPackage.GetExports().ToArray();
            var package = (Package)loadedPackage;
            var record = DumpAsset(file.Path, package, exports);
            if (!records.TryAdd(record.Name, record))
                throw new Exception($"duplicate target asset name {record.Name}");
            assets.Add(record.Name, record.Json);
            Console.WriteLine(
                $"{record.Name}: {record.Json.Value<int>("serializedNodeCount")} serialized nodes, " +
                $"{record.Json.Value<int>("compiledNodeCount")} compiled indices, " +
                $"{((JArray)record.Json["stateMachines"]!).Count} state machines");
        }

        var payload = new JObject
        {
            ["schemaVersion"] = 1,
            ["source"] = new JObject
            {
                ["engineVersion"] = "UE5.5",
                ["mount"] = "/ALS",
                ["target"] = "Content/ALS/Character",
            },
            ["assets"] = assets,
            ["excludedTargets"] = new JArray
            {
                new JObject
                {
                    ["asset"] = "CR_Als",
                    ["status"] = "notDumped",
                    ["unrecoverable"] =
                        "CR_Als is a ControlRigBlueprint backed by RigVM graphs, not an " +
                        "AnimBlueprintGeneratedClass/CDO FAnimNode graph. Decoding RigVM bytecode " +
                        "is a distinct pipeline stage and is not tractable as part of dump-abp.",
                },
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
            $"dumped {records.Count} animation blueprints -> {outJson} " +
            $"({new FileInfo(outJson).Length:N0} bytes)");
        return 0;
    }

    public static int Validate(string graphJson)
    {
        var payload = JObject.Parse(File.ReadAllText(graphJson));
        var validations = ValidatePayload(payload);
        PrintValidations(validations);
        ThrowOnValidationFailure(validations);
        Console.WriteLine($"validated {graphJson}");
        return 0;
    }

    static bool IsTarget(string path, string name, string extension)
    {
        var normalized = path.Replace('\\', '/');
        return extension == "uasset"
               && normalized.Contains(CharacterPath, StringComparison.Ordinal)
               && (name.StartsWith("AB_Als", StringComparison.Ordinal)
                   || name.StartsWith("ALI_", StringComparison.Ordinal));
    }

    static AssetRecord DumpAsset(string filePath, Package package, UObject[] exports)
    {
        var assetName = Path.GetFileNameWithoutExtension(filePath);
        var cdo = exports.FirstOrDefault(
            export => export.Flags.HasFlag(EObjectFlags.RF_ClassDefaultObject));
        var generatedClass = exports.FirstOrDefault(
            export => export.ExportType == "AnimBlueprintGeneratedClass");
        var blueprint = exports.FirstOrDefault(
            export => export.ExportType is "AnimBlueprint" or "AnimLayerInterface");

        var nodes = cdo is null ? [] : ReadNodes(cdo);
        var compiledNodeCount = ReadCompiledNodeCount(generatedClass, nodes);
        RecoverCompiledIndices(nodes, compiledNodeCount);

        var nodeJson = new JArray(nodes.Select(NodeToJson));
        var exactIndexMap = nodes
            .Where(node => node.CompiledIndex is not null)
            .ToDictionary(node => node.CompiledIndex!.Value);
        var bakedIndexMap = BuildBakedNodeIndexMap(nodes);
        var wiring = ReadWiring(nodes, exactIndexMap);
        var stateMachines = ReadStateMachines(generatedClass, bakedIndexMap);
        var unresolvedIndices = Enumerable.Range(0, compiledNodeCount)
            .Where(index => !exactIndexMap.ContainsKey(index))
            .ToArray();

        var unrecoverable = new JArray();
        if (cdo is null)
            unrecoverable.Add("No generated-class CDO export was serialized.");
        if (generatedClass is null)
            unrecoverable.Add("No AnimBlueprintGeneratedClass export was serialized.");
        if (unresolvedIndices.Length > 0)
        {
            unrecoverable.Add(
                "Some compiled indices have no uniquely indexable tagged CDO property. They are " +
                "external/unserialized nodes or lie in a property-order gap; candidate indices " +
                "are retained per node and unresolved links keep their raw LinkID.");
        }
        if (stateMachines.Count > 0)
        {
            unrecoverable.Add(
                "Transition CanTakeDelegateIndex values and baked transition data are preserved, " +
                "but compiled transition-rule boolean expressions are not decompiled by CUE4Parse.");
        }

        var json = new JObject
        {
            ["assetPath"] = filePath,
            ["kind"] = assetName == "ALI_Overlay"
                ? "AnimLayerInterface"
                : "AnimBlueprint",
            ["generatedClass"] = generatedClass?.Name,
            ["serializedNodeCount"] = nodes.Count,
            ["compiledNodeCount"] = compiledNodeCount,
            ["bakedNodeCount"] = bakedIndexMap.Count,
            ["nodes"] = nodeJson,
            ["wiring"] = wiring,
            ["stateMachines"] = stateMachines,
            ["compiledClassMetadata"] = ReadCompiledClassMetadata(generatedClass),
            ["blueprintMetadata"] = ReadBlueprintMetadata(blueprint),
            ["imports"] = ReadImports(package),
            ["referencedAnimationAssets"] = ReadAnimationImports(package),
            ["unresolvedCompiledNodeIndices"] = new JArray(unresolvedIndices),
            ["unrecoverable"] = unrecoverable,
        };

        return new AssetRecord
        {
            Name = assetName,
            Json = json,
            Nodes = nodes,
        };
    }

    static List<NodeRecord> ReadNodes(UObject cdo)
    {
        var nodes = new List<NodeRecord>();
        foreach (var property in cdo.Properties.Where(IsAnimNodeProperty))
        {
            var structProperty = (StructProperty)property.Tag!;
            var tagData = JObject.FromObject(property.TagData!, Serializer);
            var structType = tagData.Value<string>("StructType") ?? "AnimNode_Unknown";
            var module = tagData.Value<string>("Module") ?? "";
            var parameters = JToken.FromObject(structProperty, Serializer) as JObject
                             ?? new JObject
                             {
                                 ["value"] = JToken.FromObject(structProperty, Serializer),
                             };
            var structValue = structProperty.Value?.StructType;
            nodes.Add(
                new NodeRecord
                {
                    SerializedOrder = nodes.Count,
                    PropertyName = property.Name.Text,
                    Type = structType.StartsWith('F') ? structType : $"F{structType}",
                    Module = module,
                    Serialization = structValue is FStructFallback
                        ? nameof(FStructFallback)
                        : structValue?.GetType().Name ?? structProperty.GetType().Name,
                    Parameters = parameters,
                    CompiledIndexCandidates = [],
                });
        }

        return nodes;
    }

    static bool IsAnimNodeProperty(FPropertyTag property)
    {
        if (property.Tag is not StructProperty || property.TagData is null)
            return false;

        var tagData = JObject.FromObject(property.TagData, Serializer);
        var structType = tagData.Value<string>("StructType");
        var module = tagData.Value<string>("Module");
        return structType?.Contains("AnimNode_", StringComparison.Ordinal) == true
               && module?.StartsWith("/Script/", StringComparison.Ordinal) == true;
    }

    static int ReadCompiledNodeCount(UObject? generatedClass, List<NodeRecord> nodes)
    {
        var animNodeData = SerializeProperty(generatedClass, "AnimNodeData") as JArray;
        if (animNodeData is not null)
            return animNodeData.Count;

        var maxLinkIndex = nodes
            .SelectMany(node => FindPoseLinks(node.Parameters))
            .SelectMany(link => new[] { link.LinkId, link.SourceLinkId })
            .Where(index => index >= 0)
            .DefaultIfEmpty(nodes.Count - 1)
            .Max();
        return Math.Max(nodes.Count, maxLinkIndex + 1);
    }

    static void RecoverCompiledIndices(List<NodeRecord> nodes, int compiledNodeCount)
    {
        foreach (var node in nodes)
        {
            var anchors = FindPoseLinks(node.Parameters)
                .Select(link => link.SourceLinkId)
                .Where(index => index >= 0)
                .Distinct()
                .ToArray();
            if (anchors.Length == 1)
            {
                node.CompiledIndex = anchors[0];
                node.CompiledIndexCandidates.Add(anchors[0]);
            }
        }

        var anchorsByOrder = nodes
            .Select((node, order) => (order, index: node.CompiledIndex))
            .Where(anchor => anchor.index is not null)
            .Select(anchor => (anchor.order, index: anchor.index!.Value))
            .ToArray();
        if (anchorsByOrder
            .Zip(anchorsByOrder.Skip(1))
            .Any(pair => pair.Second.index <= pair.First.index))
            throw new Exception("compiled node SourceLinkID anchors are not strictly increasing");

        var segmentStartOrder = 0;
        var segmentStartIndex = 0;
        foreach (var anchor in anchorsByOrder.Append(
                     (order: nodes.Count, index: compiledNodeCount)))
        {
            var segmentEndOrder = anchor.order - 1;
            var segmentEndIndex = anchor.index - 1;
            AssignCandidateSegment(
                nodes,
                segmentStartOrder,
                segmentEndOrder,
                segmentStartIndex,
                segmentEndIndex);
            segmentStartOrder = anchor.order + 1;
            segmentStartIndex = anchor.index + 1;
        }
    }

    static void AssignCandidateSegment(
        List<NodeRecord> nodes,
        int firstOrder,
        int lastOrder,
        int firstIndex,
        int lastIndex)
    {
        if (lastOrder < firstOrder)
            return;

        var nodeCount = lastOrder - firstOrder + 1;
        var availableCount = lastIndex - firstIndex + 1;
        if (availableCount < nodeCount)
            throw new Exception(
                $"not enough compiled indices {firstIndex}..{lastIndex} for " +
                $"{nodeCount} serialized node properties");

        for (var offset = 0; offset < nodeCount; offset++)
        {
            var node = nodes[firstOrder + offset];
            if (node.CompiledIndex is not null)
                continue;

            var min = firstIndex + offset;
            var max = lastIndex - (nodeCount - offset - 1);
            node.CompiledIndexCandidates.AddRange(Enumerable.Range(min, max - min + 1));
            if (min == max)
                node.CompiledIndex = min;
        }
    }

    static Dictionary<int, NodeRecord> BuildBakedNodeIndexMap(List<NodeRecord> nodes)
    {
        // Baked state-machine indices address UAnimBlueprintGeneratedClass::AnimNodeProperties.
        // Unreal builds that array in reverse generated-property order. Resolve through the
        // serialized property identity and its independently recovered compiled index instead
        // of assuming that either baked indices or CDO ordinals are compiled node indices.
        return nodes
            .OrderByDescending(node => node.SerializedOrder)
            .Select((node, bakedIndex) => (bakedIndex, node))
            .ToDictionary(entry => entry.bakedIndex, entry => entry.node);
    }

    static JObject NodeToJson(NodeRecord node)
    {
        return new JObject
        {
            ["serializedOrder"] = node.SerializedOrder,
            ["compiledIndex"] = node.CompiledIndex is int compiledIndex
                ? new JValue(compiledIndex)
                : JValue.CreateNull(),
            ["compiledIndexCandidates"] = new JArray(node.CompiledIndexCandidates),
            ["property"] = node.PropertyName,
            ["type"] = node.Type,
            ["module"] = node.Module,
            ["serialization"] = node.Serialization,
            ["parameters"] = node.Parameters,
        };
    }

    static JObject ReadWiring(
        List<NodeRecord> nodes,
        Dictionary<int, NodeRecord> exactIndexMap)
    {
        var links = new JArray();
        foreach (var node in nodes)
        {
            foreach (var link in FindPoseLinks(node.Parameters))
            {
                var status = link.LinkId < 0 || link.SourceLinkId < 0
                    ? "unlinked"
                    : exactIndexMap.ContainsKey(link.LinkId)
                        ? "recovered"
                        : "raw-index-only";
                links.Add(
                    new JObject
                    {
                        ["sourceNodeIndex"] = link.LinkId,
                        ["sourceNodeProperty"] = exactIndexMap.TryGetValue(
                            link.LinkId,
                            out var sourceNode)
                            ? sourceNode.PropertyName
                            : null,
                        ["targetNodeIndex"] = link.SourceLinkId,
                        ["targetNodeProperty"] = exactIndexMap.TryGetValue(
                            link.SourceLinkId,
                            out var targetNode)
                            ? targetNode.PropertyName
                            : node.PropertyName,
                        ["targetInput"] = link.Path,
                        ["status"] = status,
                    });
            }
        }

        return new JObject
        {
            ["indexRecovery"] =
                "SourceLinkID anchors the owning compiled node index. Untagged/external gaps " +
                "remain unresolved; LinkID is always retained verbatim.",
            ["poseLinks"] = links,
        };
    }

    static JArray ReadStateMachines(
        UObject? generatedClass,
        Dictionary<int, NodeRecord> bakedIndexMap)
    {
        var stateMachines = SerializeProperty(generatedClass, "BakedStateMachines") as JArray
                            ?? new JArray();
        foreach (var machine in stateMachines.OfType<JObject>())
        {
            var states = machine["States"] as JArray ?? new JArray();
            var stateNames = states
                .OfType<JObject>()
                .Select(state => state.Value<string>("StateName") ?? "")
                .ToArray();

            foreach (var state in states.OfType<JObject>())
            {
                var rootBakedIndex = state.Value<int?>("StateRootNodeIndex");
                if (rootBakedIndex is not null
                    && bakedIndexMap.TryGetValue(rootBakedIndex.Value, out var root))
                {
                    state["StateRootNodeCompiledIndex"] = root.CompiledIndex;
                    state["StateRootNodeProperty"] = root.PropertyName;
                    state["StateRootNodeType"] = root.Type;
                }
                else
                {
                    state["StateRootNodeCompiledIndex"] = null;
                    state["StateRootNodeProperty"] = null;
                    state["StateRootNodeType"] = null;
                }

                var playerCompiledIndices = new JArray();
                var playerProperties = new JArray();
                var playerTypes = new JArray();
                foreach (var playerBakedIndex in
                         state["PlayerNodeIndices"]?.Values<int>() ?? [])
                {
                    if (bakedIndexMap.TryGetValue(playerBakedIndex, out var player))
                    {
                        playerCompiledIndices.Add(player.CompiledIndex);
                        playerProperties.Add(player.PropertyName);
                        playerTypes.Add(player.Type);
                    }
                    else
                    {
                        playerCompiledIndices.Add(JValue.CreateNull());
                        playerProperties.Add(JValue.CreateNull());
                        playerTypes.Add(JValue.CreateNull());
                    }
                }
                state["PlayerNodeCompiledIndices"] = playerCompiledIndices;
                state["PlayerNodeProperties"] = playerProperties;
                state["PlayerNodeTypes"] = playerTypes;

                foreach (var stateTransition in state["Transitions"]?.OfType<JObject>() ?? [])
                {
                    var delegateBakedIndex =
                        stateTransition.Value<int?>("CanTakeDelegateIndex");
                    NodeRecord? delegateNode = null;
                    if (delegateBakedIndex is not null)
                    {
                        bakedIndexMap.TryGetValue(
                            delegateBakedIndex.Value,
                            out delegateNode);
                    }
                    stateTransition["rule"] = new JObject
                    {
                        ["bakedDelegateIndex"] = delegateBakedIndex,
                        ["compiledDelegateIndex"] =
                            delegateNode?.CompiledIndex is int compiledIndex
                                ? new JValue(compiledIndex)
                                : JValue.CreateNull(),
                        ["compiledDelegateProperty"] = delegateNode is null
                            ? JValue.CreateNull()
                            : new JValue(delegateNode.PropertyName),
                        ["compiledDelegateType"] = delegateNode is null
                            ? JValue.CreateNull()
                            : new JValue(delegateNode.Type),
                        ["expression"] = new JObject
                        {
                            ["unrecoverable"] =
                                "The baked class stores the delegate index but CUE4Parse does not " +
                                "decompile the transition-rule boolean expression.",
                        },
                    };
                }
            }

            foreach (var transition in machine["Transitions"]?.OfType<JObject>() ?? [])
            {
                var previous = transition.Value<int?>("PreviousState");
                var next = transition.Value<int?>("NextState");
                transition["PreviousStateName"] = previous is >= 0 && previous < stateNames.Length
                    ? stateNames[previous.Value]
                    : null;
                transition["NextStateName"] = next is >= 0 && next < stateNames.Length
                    ? stateNames[next.Value]
                    : null;
            }
        }

        return stateMachines;
    }

    static JObject ReadCompiledClassMetadata(UObject? generatedClass)
    {
        return new JObject
        {
            ["TargetSkeleton"] = SerializeProperty(generatedClass, "TargetSkeleton"),
            ["SyncGroupNames"] = SerializeProperty(generatedClass, "SyncGroupNames"),
            ["GraphAssetPlayerInformation"] =
                SerializeProperty(generatedClass, "GraphAssetPlayerInformation"),
            ["GraphBlendOptions"] = SerializeProperty(generatedClass, "GraphBlendOptions"),
            ["AnimNotifies"] = SerializeProperty(generatedClass, "AnimNotifies"),
            ["AnimBlueprintFunctions"] =
                SerializeProperty(generatedClass, "AnimBlueprintFunctions"),
        };
    }

    static JObject ReadBlueprintMetadata(UObject? blueprint)
    {
        return new JObject
        {
            ["TargetSkeleton"] = SerializeProperty(blueprint, "TargetSkeleton"),
            ["ParentClass"] = SerializeProperty(blueprint, "ParentClass"),
            ["ImplementedInterfaces"] = SerializeProperty(blueprint, "ImplementedInterfaces"),
            ["FunctionGraphs"] = SerializeProperty(blueprint, "FunctionGraphs"),
        };
    }

    static JToken ReadImports(Package package)
    {
        return new JArray(
            package.ImportMap.Select(
                (import, index) => new JObject
                {
                    ["index"] = index,
                    ["classPackage"] = import.ClassPackage.Text,
                    ["className"] = import.ClassName.Text,
                    ["packageName"] = import.PackageName.Text,
                    ["objectName"] = import.ObjectName.Text,
                    ["optional"] = import.ImportOptional,
                    ["outer"] = JToken.FromObject(import.OuterIndex!, Serializer),
                    ["resolved"] = JToken.FromObject(import, Serializer),
                }));
    }

    static JArray ReadAnimationImports(Package package)
    {
        var animationClasses = new HashSet<string>(
            [
                "AimOffsetBlendSpace",
                "AnimComposite",
                "AnimMontage",
                "AnimSequence",
                "BlendSpace",
                "BlendSpace1D",
                "PoseAsset",
            ],
            StringComparer.Ordinal);

        return new JArray(
            package.ImportMap
                .Where(import => animationClasses.Contains(import.ClassName.Text))
                .Select(
                    import =>
                    {
                        var resolved = JObject.FromObject(import, Serializer);
                        var outer = JObject.FromObject(import.OuterIndex!, Serializer);
                        return new JObject
                        {
                            ["className"] = import.ClassName.Text,
                            ["objectName"] = import.ObjectName.Text,
                            ["objectPath"] =
                                resolved.SelectToken("OuterIndex.ObjectPath")
                                ?? outer["ObjectPath"],
                        };
                    })
                .DistinctBy(reference => reference.ToString(Formatting.None)));
    }

    static JToken? SerializeProperty(UObject? export, string name)
    {
        var property = export?.Properties.FirstOrDefault(
            candidate => candidate.Name.Text == name);
        return property?.Tag is null
            ? null
            : JToken.FromObject(property.Tag, Serializer);
    }

    sealed record PoseLink(string Path, int LinkId, int SourceLinkId);

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

    static JArray ValidatePayload(JObject payload)
    {
        var validations = new JArray();
        validations.Add(ValidateTargetCoverage(payload));
        validations.Add(ValidateGraphStructure(payload));
        validations.Add(ValidateStateMachineNodeIndexMapping(payload));
        validations.Add(ValidateAlsCustomAnimNodes(payload));
        validations.Add(ValidateRifleExplicitTimes(payload));
        validations.Add(ValidateLayeringDynamicAdditive(payload));
        validations.Add(ValidateCrouchIdle(payload));
        validations.Add(ValidateBranchFilters(payload));
        return validations;
    }

    static JObject ValidateTargetCoverage(JObject payload)
    {
        var assets = payload["assets"] as JObject ?? new JObject();
        var actualNames = assets.Properties()
            .Select(asset => asset.Name)
            .Order(StringComparer.Ordinal)
            .ToArray();
        var expectedNames = ExpectedTargets.Keys.Order(StringComparer.Ordinal).ToArray();
        var missing = expectedNames.Except(actualNames, StringComparer.Ordinal).ToArray();
        var unexpected = actualNames.Except(expectedNames, StringComparer.Ordinal).ToArray();
        var kindMismatches = new JArray();

        foreach (var target in ExpectedTargets)
        {
            if (assets[target.Key] is not JObject asset)
                continue;
            var actualKind = asset.Value<string>("kind");
            if (actualKind == target.Value)
                continue;
            kindMismatches.Add(
                new JObject
                {
                    ["asset"] = target.Key,
                    ["expected"] = target.Value,
                    ["actual"] = actualKind,
                });
        }

        return Validation(
            "als-4.15-animation-blueprint-target-coverage",
            missing.Length == 0 && unexpected.Length == 0 && kindMismatches.Count == 0,
            new JObject
            {
                ["expectedCount"] = expectedNames.Length,
                ["actualCount"] = actualNames.Length,
                ["missing"] = new JArray(missing),
                ["unexpected"] = new JArray(unexpected),
                ["kindMismatches"] = kindMismatches,
            });
    }

    static JObject ValidateGraphStructure(JObject payload)
    {
        var assets = payload["assets"] as JObject ?? new JObject();
        var errors = new JArray();
        var summaries = new JArray();

        foreach (var assetProperty in assets.Properties())
        {
            if (assetProperty.Value is not JObject asset)
            {
                errors.Add($"{assetProperty.Name}: asset record is not an object");
                continue;
            }

            if (asset["nodes"] is not JArray nodes)
            {
                errors.Add($"{assetProperty.Name}: nodes is not an array");
                continue;
            }

            var serializedNodeCount = asset.Value<int?>("serializedNodeCount");
            var compiledNodeCount = asset.Value<int?>("compiledNodeCount");
            var bakedNodeCount = asset.Value<int?>("bakedNodeCount");
            if (serializedNodeCount != nodes.Count)
            {
                errors.Add(
                    $"{assetProperty.Name}: serializedNodeCount {serializedNodeCount} " +
                    $"does not match nodes length {nodes.Count}");
            }
            if (compiledNodeCount is null || compiledNodeCount < 0)
            {
                errors.Add($"{assetProperty.Name}: compiledNodeCount is missing or negative");
                continue;
            }
            if (bakedNodeCount != nodes.Count)
            {
                errors.Add(
                    $"{assetProperty.Name}: bakedNodeCount {bakedNodeCount} " +
                    $"does not match nodes length {nodes.Count}");
            }

            var exactIndices = new HashSet<int>();
            var discoveredLinks = new List<(JObject Node, PoseLink Link)>();
            foreach (var node in nodes.OfType<JObject>())
            {
                var propertyName = node.Value<string>("property") ?? "<unnamed>";
                var compiledIndex = node["compiledIndex"]?.Type == JTokenType.Integer
                    ? node.Value<int?>("compiledIndex")
                    : null;
                var candidates = node["compiledIndexCandidates"]?.Values<int>().ToArray()
                                 ?? [];

                if (candidates.Any(index => index < 0 || index >= compiledNodeCount))
                {
                    errors.Add(
                        $"{assetProperty.Name}.{propertyName}: compiled index candidate " +
                        "is outside compiledNodeCount");
                }
                if (compiledIndex is not null)
                {
                    if (compiledIndex < 0 || compiledIndex >= compiledNodeCount)
                    {
                        errors.Add(
                            $"{assetProperty.Name}.{propertyName}: compiledIndex " +
                            $"{compiledIndex} is outside compiledNodeCount");
                    }
                    if (!exactIndices.Add(compiledIndex.Value))
                    {
                        errors.Add(
                            $"{assetProperty.Name}: duplicate compiledIndex {compiledIndex}");
                    }
                    if (!candidates.Contains(compiledIndex.Value))
                    {
                        errors.Add(
                            $"{assetProperty.Name}.{propertyName}: exact compiledIndex is " +
                            "absent from compiledIndexCandidates");
                    }
                }

                if (node["parameters"] is not JToken parameters)
                    continue;
                foreach (var link in FindPoseLinks(parameters))
                {
                    discoveredLinks.Add((node, link));
                    if (link.LinkId < -1 || link.LinkId >= compiledNodeCount
                        || link.SourceLinkId < -1 || link.SourceLinkId >= compiledNodeCount)
                    {
                        errors.Add(
                            $"{assetProperty.Name}.{propertyName}.{link.Path}: pose-link index " +
                            "is outside compiledNodeCount");
                    }
                    if (compiledIndex is not null && link.SourceLinkId >= 0
                        && link.SourceLinkId != compiledIndex)
                    {
                        errors.Add(
                            $"{assetProperty.Name}.{propertyName}.{link.Path}: SourceLinkID " +
                            $"{link.SourceLinkId} does not match compiledIndex {compiledIndex}");
                    }
                }
            }

            var expectedUnresolved = Enumerable.Range(0, compiledNodeCount.Value)
                .Where(index => !exactIndices.Contains(index))
                .ToArray();
            var actualUnresolved =
                asset["unresolvedCompiledNodeIndices"]?.Values<int>().ToArray() ?? [];
            if (!expectedUnresolved.SequenceEqual(actualUnresolved))
            {
                errors.Add(
                    $"{assetProperty.Name}: unresolvedCompiledNodeIndices is not the exact " +
                    "complement of recovered compiled indices");
            }

            var emittedLinks = asset.SelectToken("wiring.poseLinks") as JArray ?? new JArray();
            if (emittedLinks.Count != discoveredLinks.Count)
            {
                errors.Add(
                    $"{assetProperty.Name}: emitted {emittedLinks.Count} wiring links for " +
                    $"{discoveredLinks.Count} serialized pose links");
            }
            for (var index = 0; index < Math.Min(emittedLinks.Count, discoveredLinks.Count); index++)
            {
                if (emittedLinks[index] is not JObject emitted)
                    continue;
                var discovered = discoveredLinks[index];
                var expectedStatus =
                    discovered.Link.LinkId < 0 || discovered.Link.SourceLinkId < 0
                        ? "unlinked"
                        : exactIndices.Contains(discovered.Link.LinkId)
                            ? "recovered"
                            : "raw-index-only";
                if (emitted.Value<int?>("sourceNodeIndex") != discovered.Link.LinkId
                    || emitted.Value<int?>("targetNodeIndex") != discovered.Link.SourceLinkId
                    || emitted.Value<string>("targetInput") != discovered.Link.Path
                    || emitted.Value<string>("status") != expectedStatus)
                {
                    errors.Add(
                        $"{assetProperty.Name}: wiring link {index} does not match its " +
                        "serialized pose link");
                }
            }

            var stateMachineCount = 0;
            var transitionCount = 0;
            foreach (var machine in asset["stateMachines"]?.OfType<JObject>() ?? [])
            {
                stateMachineCount++;
                var states = machine["States"] as JArray ?? new JArray();
                var initialState = machine.Value<int?>("InitialState");
                if (states.Count == 0 || initialState is null
                    || initialState < 0 || initialState >= states.Count)
                {
                    errors.Add(
                        $"{assetProperty.Name}.{machine.Value<string>("MachineName")}: " +
                        "InitialState is outside the baked state list");
                }

                foreach (var state in states.OfType<JObject>())
                {
                    var rootIndex = state.Value<int?>("StateRootNodeIndex");
                    var isConduit = state.Value<bool?>("bIsAConduit") ?? false;
                    if (rootIndex is null
                        || (rootIndex < 0 && !isConduit)
                        || rootIndex >= bakedNodeCount)
                    {
                        errors.Add(
                            $"{assetProperty.Name}.{machine.Value<string>("MachineName")}." +
                            $"{state.Value<string>("StateName")}: StateRootNodeIndex is invalid");
                    }
                    foreach (var playerIndex in state["PlayerNodeIndices"]?.Values<int>() ?? [])
                    {
                        if (playerIndex < 0 || playerIndex >= bakedNodeCount)
                        {
                            errors.Add(
                                $"{assetProperty.Name}.{machine.Value<string>("MachineName")}." +
                                $"{state.Value<string>("StateName")}: player index is invalid");
                        }
                    }
                }

                foreach (var transition in machine["Transitions"]?.OfType<JObject>() ?? [])
                {
                    transitionCount++;
                    var previous = transition.Value<int?>("PreviousState");
                    var next = transition.Value<int?>("NextState");
                    if (previous is null || previous < 0 || previous >= states.Count
                        || next is null || next < 0 || next >= states.Count)
                    {
                        errors.Add(
                            $"{assetProperty.Name}.{machine.Value<string>("MachineName")}: " +
                            "transition state index is invalid");
                    }
                    if (transition["CrossfadeDuration"]?.Type is not
                        (JTokenType.Float or JTokenType.Integer))
                    {
                        errors.Add(
                            $"{assetProperty.Name}.{machine.Value<string>("MachineName")}: " +
                            "transition is missing CrossfadeDuration");
                    }
                }
            }

            summaries.Add(
                new JObject
                {
                    ["asset"] = assetProperty.Name,
                    ["serializedNodes"] = nodes.Count,
                    ["compiledNodes"] = compiledNodeCount,
                    ["recoveredIndices"] = exactIndices.Count,
                    ["poseLinks"] = discoveredLinks.Count,
                    ["stateMachines"] = stateMachineCount,
                    ["transitions"] = transitionCount,
                });
        }

        return Validation(
            "compiled-animgraph-structural-integrity",
            errors.Count == 0,
            new JObject
            {
                ["assets"] = summaries,
                ["errors"] = errors,
            });
    }

    static JObject ValidateStateMachineNodeIndexMapping(JObject payload)
    {
        var assets = payload["assets"] as JObject ?? new JObject();
        var errors = new JArray();
        var summaries = new JArray();
        var exactPins = new JArray();
        var rootAnnotationCount = 0;
        var playerAnnotationCount = 0;
        var delegateAnnotationCount = 0;

        foreach (var assetProperty in assets.Properties())
        {
            if (assetProperty.Value is not JObject asset
                || asset["nodes"] is not JArray nodeArray)
            {
                continue;
            }

            var serializedNodes = nodeArray
                .OfType<JObject>()
                .OrderBy(node => node.Value<int>("serializedOrder"))
                .ToArray();
            if (!serializedNodes
                    .Select(node => node.Value<int>("serializedOrder"))
                    .SequenceEqual(Enumerable.Range(0, serializedNodes.Length)))
            {
                errors.Add(
                    $"{assetProperty.Name}: serialized animation-node property order is " +
                    "not contiguous");
                continue;
            }

            var bakedIndexMap = serializedNodes
                .Reverse()
                .Select((node, bakedIndex) => (bakedIndex, node))
                .ToDictionary(entry => entry.bakedIndex, entry => entry.node);
            var assetRootCount = 0;
            var assetPlayerCount = 0;
            var assetDelegateCount = 0;

            foreach (var machine in asset["stateMachines"]?.OfType<JObject>() ?? [])
            {
                var machineName = machine.Value<string>("MachineName") ?? "<unnamed>";
                foreach (var state in machine["States"]?.OfType<JObject>() ?? [])
                {
                    var stateName = state.Value<string>("StateName") ?? "<unnamed>";
                    var context = $"{assetProperty.Name}.{machineName}.{stateName}";
                    var rootBakedIndex = state.Value<int?>("StateRootNodeIndex");
                    if (rootBakedIndex is >= 0)
                    {
                        rootAnnotationCount++;
                        assetRootCount++;
                        if (!bakedIndexMap.TryGetValue(
                                rootBakedIndex.Value,
                                out var rootNode))
                        {
                            errors.Add(
                                $"{context}: baked root index {rootBakedIndex} is unresolved");
                        }
                        else
                        {
                            ValidateNodeAnnotation(
                                $"{context}.root",
                                rootNode,
                                state["StateRootNodeCompiledIndex"],
                                state["StateRootNodeProperty"],
                                state["StateRootNodeType"]);
                            if (rootNode.Value<string>("type") != "FAnimNode_StateResult"
                                || rootNode.SelectToken("parameters.Name")?.Value<string>()
                                != stateName)
                            {
                                errors.Add(
                                    $"{context}: baked root does not resolve to its named " +
                                    "FAnimNode_StateResult");
                            }
                        }
                    }
                    else if (state["StateRootNodeCompiledIndex"]?.Type != JTokenType.Null
                             || state["StateRootNodeProperty"]?.Type != JTokenType.Null
                             || state["StateRootNodeType"]?.Type != JTokenType.Null)
                    {
                        errors.Add($"{context}: conduit root annotations must be null");
                    }

                    var rawPlayerIndices =
                        state["PlayerNodeIndices"]?.Values<int>().ToArray() ?? [];
                    var compiledPlayerIndices =
                        state["PlayerNodeCompiledIndices"] as JArray ?? new JArray();
                    var playerProperties =
                        state["PlayerNodeProperties"] as JArray ?? new JArray();
                    var playerTypes =
                        state["PlayerNodeTypes"] as JArray ?? new JArray();
                    if (compiledPlayerIndices.Count != rawPlayerIndices.Length
                        || playerProperties.Count != rawPlayerIndices.Length
                        || playerTypes.Count != rawPlayerIndices.Length)
                    {
                        errors.Add(
                            $"{context}: player annotations do not align with raw baked indices");
                    }

                    for (var index = 0; index < rawPlayerIndices.Length; index++)
                    {
                        playerAnnotationCount++;
                        assetPlayerCount++;
                        var bakedIndex = rawPlayerIndices[index];
                        if (!bakedIndexMap.TryGetValue(bakedIndex, out var playerNode))
                        {
                            errors.Add(
                                $"{context}: baked player index {bakedIndex} is unresolved");
                            continue;
                        }

                        ValidateNodeAnnotation(
                            $"{context}.player[{index}]",
                            playerNode,
                            compiledPlayerIndices.ElementAtOrDefault(index),
                            playerProperties.ElementAtOrDefault(index),
                            playerTypes.ElementAtOrDefault(index));
                        if (playerNode.Value<string>("type") is not
                            ("FAnimNode_SequencePlayer"
                            or "FAnimNode_SequenceEvaluator"
                            or "FAnimNode_BlendSpaceEvaluator"))
                        {
                            errors.Add(
                                $"{context}: baked player index {bakedIndex} resolves to " +
                                $"{playerNode.Value<string>("type")}");
                        }
                    }

                    foreach (var transition in
                             state["Transitions"]?.OfType<JObject>() ?? [])
                    {
                        var delegateBakedIndex =
                            transition.Value<int?>("CanTakeDelegateIndex");
                        if (delegateBakedIndex is not >= 0)
                            continue;

                        delegateAnnotationCount++;
                        assetDelegateCount++;
                        if (!bakedIndexMap.TryGetValue(
                                delegateBakedIndex.Value,
                                out var delegateNode))
                        {
                            errors.Add(
                                $"{context}: baked delegate index {delegateBakedIndex} " +
                                "is unresolved");
                            continue;
                        }

                        var rule = transition["rule"] as JObject ?? new JObject();
                        if (rule.Value<int?>("bakedDelegateIndex") != delegateBakedIndex)
                        {
                            errors.Add(
                                $"{context}: rule does not preserve CanTakeDelegateIndex " +
                                $"{delegateBakedIndex}");
                        }
                        ValidateNodeAnnotation(
                            $"{context}.delegate[{delegateBakedIndex}]",
                            delegateNode,
                            rule["compiledDelegateIndex"],
                            rule["compiledDelegateProperty"],
                            rule["compiledDelegateType"]);
                        if (delegateNode.Value<string>("type")
                            != "FAnimNode_TransitionResult")
                        {
                            errors.Add(
                                $"{context}: baked delegate index {delegateBakedIndex} " +
                                "does not resolve to FAnimNode_TransitionResult");
                        }
                    }
                }
            }

            if (assetRootCount + assetPlayerCount + assetDelegateCount > 0)
            {
                summaries.Add(
                    new JObject
                    {
                        ["asset"] = assetProperty.Name,
                        ["roots"] = assetRootCount,
                        ["players"] = assetPlayerCount,
                        ["delegates"] = assetDelegateCount,
                    });
            }
        }

        AddExactPin(
            "locomotion-grounded-root-and-delegates",
            "AB_Als_Locomotion",
            "Locomotion States",
            "Grounded",
            1,
            75,
            "AnimGraphNode_StateResult",
            [],
            [],
            [],
            [61, 62],
            [15, 14],
            ["AnimGraphNode_TransitionResult_7", "AnimGraphNode_TransitionResult_8"]);
        AddExactPin(
            "locomotion-fall-root-and-players",
            "AB_Als_Locomotion",
            "Locomotion States",
            "Fall",
            3,
            73,
            "AnimGraphNode_StateResult_1",
            [5, 6, 7, 11, 12, 15],
            [71, 70, 69, 65, 64, 61],
            [
                "AnimGraphNode_SequencePlayer",
                "AnimGraphNode_SequencePlayer_1",
                "AnimGraphNode_SequencePlayer_2",
                "AnimGraphNode_SequenceEvaluator",
                "AnimGraphNode_SequenceEvaluator_1",
                "AnimGraphNode_BlendSpaceEvaluator",
            ],
            [63, 64],
            [13, 12],
            ["AnimGraphNode_TransitionResult_9", "AnimGraphNode_TransitionResult_10"]);
        AddExactPin(
            "standing-idle-root-player-and-delegates",
            "AB_Als_Standing",
            "Standing States",
            "Idle",
            139,
            64,
            "AnimGraphNode_StateResult_12",
            [142],
            [61],
            ["AnimGraphNode_SequenceEvaluator"],
            [195, 196, 197],
            [8, 7, 6],
            [
                "AnimGraphNode_TransitionResult_22",
                "AnimGraphNode_TransitionResult_23",
                "AnimGraphNode_TransitionResult_24",
            ]);
        AddExactPin(
            "standing-run-start-root-player-and-delegate",
            "AB_Als_Standing",
            "Movement Details States",
            "Run Start",
            117,
            86,
            "AnimGraphNode_StateResult_11",
            [119, 120, 121, 122],
            [84, 83, 82, 81],
            [
                "AnimGraphNode_SequencePlayer_14",
                "AnimGraphNode_SequencePlayer_15",
                "AnimGraphNode_SequencePlayer_16",
                "AnimGraphNode_SequencePlayer_17",
            ],
            [134],
            [69],
            ["AnimGraphNode_TransitionResult_17"]);

        var totalsMatch = rootAnnotationCount == 114
                          && playerAnnotationCount == 227
                          && delegateAnnotationCount == 304;
        var exactPinsMatch = exactPins
            .OfType<JObject>()
            .All(pin => pin.Value<bool>("passed"));
        return Validation(
            "baked-state-machine-node-index-mapping",
            errors.Count == 0 && totalsMatch && exactPinsMatch,
            new JObject
            {
                ["mapping"] =
                    "Baked indices address AnimNodeProperties in reverse serialized " +
                    "generated-class FAnimNode property order; compiled indices are recovered " +
                    "independently from pose-link SourceLinkID anchors.",
                ["expectedTotals"] = new JObject
                {
                    ["roots"] = 114,
                    ["players"] = 227,
                    ["delegates"] = 304,
                },
                ["actualTotals"] = new JObject
                {
                    ["roots"] = rootAnnotationCount,
                    ["players"] = playerAnnotationCount,
                    ["delegates"] = delegateAnnotationCount,
                },
                ["assets"] = summaries,
                ["exactPins"] = exactPins,
                ["errors"] = errors,
            });

        void ValidateNodeAnnotation(
            string context,
            JObject expectedNode,
            JToken? actualCompiledIndex,
            JToken? actualProperty,
            JToken? actualType)
        {
            var expectedCompiledIndex =
                expectedNode["compiledIndex"]?.Type == JTokenType.Integer
                    ? expectedNode.Value<int?>("compiledIndex")
                    : null;
            if (!NullableIntEquals(actualCompiledIndex, expectedCompiledIndex)
                || actualProperty?.Value<string>()
                != expectedNode.Value<string>("property")
                || actualType?.Value<string>() != expectedNode.Value<string>("type"))
            {
                errors.Add(
                    $"{context}: annotation does not match the reverse serialized-property " +
                    "mapping");
            }
        }

        void AddExactPin(
            string id,
            string assetName,
            string machineName,
            string stateName,
            int expectedRootBakedIndex,
            int expectedRootCompiledIndex,
            string expectedRootProperty,
            int[] expectedPlayerBakedIndices,
            int[] expectedPlayerCompiledIndices,
            string[] expectedPlayerProperties,
            int[] expectedDelegateBakedIndices,
            int[] expectedDelegateCompiledIndices,
            string[] expectedDelegateProperties)
        {
            var state = assets[assetName]?["stateMachines"]?
                .OfType<JObject>()
                .FirstOrDefault(machine =>
                    machine.Value<string>("MachineName") == machineName)?["States"]?
                .OfType<JObject>()
                .FirstOrDefault(candidate =>
                    candidate.Value<string>("StateName") == stateName);
            if (state is null)
            {
                exactPins.Add(
                    new JObject
                    {
                        ["id"] = id,
                        ["passed"] = false,
                        ["missing"] = $"{assetName}.{machineName}.{stateName}",
                    });
                return;
            }

            var actualPlayerBakedIndices =
                state["PlayerNodeIndices"]?.Values<int>().ToArray() ?? [];
            var actualPlayerCompiledIndices =
                state["PlayerNodeCompiledIndices"]?.Values<int>().ToArray() ?? [];
            var actualPlayerProperties =
                state["PlayerNodeProperties"]?.Values<string>().ToArray() ?? [];
            var transitions = state["Transitions"]?.OfType<JObject>().ToArray() ?? [];
            var actualDelegateBakedIndices = transitions
                .Select(transition => transition.Value<int>("CanTakeDelegateIndex"))
                .ToArray();
            var actualDelegateCompiledIndices = transitions
                .Select(transition =>
                    transition.SelectToken("rule.compiledDelegateIndex")!.Value<int>())
                .ToArray();
            var actualDelegateProperties = transitions
                .Select(transition =>
                    transition.SelectToken("rule.compiledDelegateProperty")!.Value<string>()!)
                .ToArray();

            var passed =
                state.Value<int?>("StateRootNodeIndex") == expectedRootBakedIndex
                && state.Value<int?>("StateRootNodeCompiledIndex")
                == expectedRootCompiledIndex
                && state.Value<string>("StateRootNodeProperty") == expectedRootProperty
                && actualPlayerBakedIndices.SequenceEqual(expectedPlayerBakedIndices)
                && actualPlayerCompiledIndices.SequenceEqual(expectedPlayerCompiledIndices)
                && actualPlayerProperties.SequenceEqual(expectedPlayerProperties)
                && actualDelegateBakedIndices.SequenceEqual(expectedDelegateBakedIndices)
                && actualDelegateCompiledIndices.SequenceEqual(
                    expectedDelegateCompiledIndices)
                && actualDelegateProperties.SequenceEqual(expectedDelegateProperties);
            exactPins.Add(
                new JObject
                {
                    ["id"] = id,
                    ["passed"] = passed,
                    ["root"] = new JObject
                    {
                        ["bakedIndex"] = state["StateRootNodeIndex"],
                        ["compiledIndex"] = state["StateRootNodeCompiledIndex"],
                        ["property"] = state["StateRootNodeProperty"],
                    },
                    ["players"] = new JObject
                    {
                        ["bakedIndices"] = new JArray(actualPlayerBakedIndices),
                        ["compiledIndices"] = new JArray(actualPlayerCompiledIndices),
                        ["properties"] = new JArray(
                            actualPlayerProperties.Select(
                                property => property is null
                                    ? JValue.CreateNull()
                                    : new JValue(property))),
                    },
                    ["delegates"] = new JObject
                    {
                        ["bakedIndices"] = new JArray(actualDelegateBakedIndices),
                        ["compiledIndices"] = new JArray(actualDelegateCompiledIndices),
                        ["properties"] = new JArray(actualDelegateProperties),
                    },
                });
        }

        static bool NullableIntEquals(JToken? actual, int? expected)
        {
            return expected is null
                ? actual is null || actual.Type is JTokenType.Null
                : actual?.Type == JTokenType.Integer && actual.Value<int>() == expected;
        }
    }

    static JObject ValidateAlsCustomAnimNodes(JObject payload)
    {
        var assets = payload["assets"] as JObject ?? new JObject();
        var customNodes = new JArray();
        var typeCounts = new Dictionary<string, int>(StringComparer.Ordinal);
        var unresolvedAssets = new JArray();

        foreach (var assetProperty in assets.Properties())
        {
            if (assetProperty.Value is not JObject asset)
                continue;

            var unresolved = asset["unresolvedCompiledNodeIndices"]?.Values<int>().ToArray()
                             ?? [];
            if (unresolved.Length > 0)
            {
                unresolvedAssets.Add(
                    new JObject
                    {
                        ["asset"] = assetProperty.Name,
                        ["indices"] = new JArray(unresolved),
                    });
            }

            foreach (var node in asset["nodes"]?.OfType<JObject>() ?? [])
            {
                var type = node.Value<string>("type") ?? "";
                if (!type.StartsWith("FAlsAnimNode_", StringComparison.Ordinal))
                    continue;

                typeCounts[type] = typeCounts.GetValueOrDefault(type) + 1;
                customNodes.Add(
                    new JObject
                    {
                        ["asset"] = assetProperty.Name,
                        ["compiledIndex"] = node["compiledIndex"],
                        ["property"] = node["property"],
                        ["type"] = type,
                        ["module"] = node["module"],
                    });
            }
        }

        var expectedTypeCounts = new Dictionary<string, int>(StringComparer.Ordinal)
        {
            ["FAlsAnimNode_CurvesBlend"] = 4,
            ["FAlsAnimNode_GameplayTagsBlend"] = 18,
        };
        var typeInventoryMatches = expectedTypeCounts.Count == typeCounts.Count
                                   && expectedTypeCounts.All(
                                       expected => typeCounts.TryGetValue(
                                           expected.Key,
                                           out var count)
                                                   && count == expected.Value);
        var modulesMatch = customNodes
            .OfType<JObject>()
            .All(node => node.Value<string>("module") == "/Script/ALS");

        var standingNodes = ExactIndexMap(GetNodes(payload, "AB_Als_Standing"));
        var standingCustomNode = standingNodes.GetValueOrDefault(144);
        var sprintSequence = standingNodes.GetValueOrDefault(129);
        var sprintAccelerationSequence = standingNodes.GetValueOrDefault(130);
        var sprintAccelerationBlend = standingNodes.GetValueOrDefault(131);
        var sprintBlockBlend = standingNodes.GetValueOrDefault(139);
        var moveForwardBaseA = standingNodes.GetValueOrDefault(140);
        var moveForwardBaseB = standingNodes.GetValueOrDefault(141);

        static bool NumberEquals(JToken? value, double expected)
        {
            return value?.Type is JTokenType.Float or JTokenType.Integer
                   && Math.Abs(value.Value<double>() - expected) < 1e-6;
        }

        var standingSprintMatches =
            standingCustomNode?.Value<string>("property")
            == "AlsAnimGraphNode_GameplayTagsBlend"
            && standingCustomNode.Value<string>("type")
            == "FAlsAnimNode_GameplayTagsBlend"
            && standingCustomNode.Value<string>("module") == "/Script/ALS"
            && standingCustomNode.SelectToken("parameters.Tags[0].TagName")?.Value<string>()
            == "Als.Gait.Sprinting"
            && standingCustomNode.SelectToken("parameters.BlendPose[0].LinkID")?.Value<int>()
            == 141
            && standingCustomNode.SelectToken("parameters.BlendPose[1].LinkID")?.Value<int>()
            == 131
            && NumberEquals(
                standingCustomNode.SelectToken("parameters.BlendTime[0]"),
                0.3)
            && NumberEquals(
                standingCustomNode.SelectToken("parameters.BlendTime[1]"),
                0.2)
            && standingCustomNode.SelectToken("parameters.TransitionType")?.Value<string>()
            == "EBlendListTransitionType::StandardBlend"
            && standingCustomNode.SelectToken("parameters.BlendType")?.Value<string>()
            == "EAlphaBlendOption::Cubic"
            && standingCustomNode.SelectToken("parameters.bResetChildOnActivation")
                ?.Value<bool>() == false
            && sprintSequence?.SelectToken("parameters.Sequence.ObjectName")?.Value<string>()
            == "AnimSequence'A_Als_Sprint'"
            && NumberEquals(
                sprintSequence.SelectToken("parameters.StartPosition"),
                0.166667)
            && NumberEquals(
                sprintSequence.SelectToken("parameters.PlayRateBasis"),
                1.0)
            && sprintAccelerationSequence?
                .SelectToken("parameters.Sequence.ObjectName")?.Value<string>()
            == "AnimSequence'A_Als_Sprint_Acceleration'"
            && NumberEquals(
                sprintAccelerationSequence.SelectToken("parameters.StartPosition"),
                0.166667)
            && NumberEquals(
                sprintAccelerationSequence.SelectToken("parameters.PlayRateBasis"),
                0.833333)
            && sprintAccelerationBlend?.SelectToken("parameters.A.LinkID")?.Value<int>() == 129
            && sprintAccelerationBlend.SelectToken("parameters.B.LinkID")?.Value<int>() == 130
            && sprintAccelerationBlend.SelectToken(
                    "parameters.AlphaScaleBiasClamp.bMapRange")
                ?.Value<bool>() == true
            && sprintAccelerationBlend.SelectToken(
                    "parameters.AlphaScaleBiasClamp.bInterpResult")
                ?.Value<bool>() == true
            && NumberEquals(
                sprintAccelerationBlend.SelectToken(
                    "parameters.AlphaScaleBiasClamp.InRange.Max"),
                0.25)
            && NumberEquals(
                sprintAccelerationBlend.SelectToken(
                    "parameters.AlphaScaleBiasClamp.InterpSpeedIncreasing"),
                20.0)
            && NumberEquals(
                sprintAccelerationBlend.SelectToken(
                    "parameters.AlphaScaleBiasClamp.InterpSpeedDecreasing"),
                4.0)
            && sprintBlockBlend?.SelectToken("parameters.A.LinkID")?.Value<int>() == 144
            && sprintBlockBlend.SelectToken("parameters.B.LinkID")?.Value<int>() == 140
            && moveForwardBaseA?.SelectToken("parameters.LinkToCachingNode.LinkID")?.Value<int>()
            == 137
            && moveForwardBaseB?.SelectToken("parameters.LinkToCachingNode.LinkID")?.Value<int>()
            == 137;

        return Validation(
            "als-custom-anim-node-coverage",
            typeInventoryMatches
            && modulesMatch
            && unresolvedAssets.Count == 0
            && standingSprintMatches,
            new JObject
            {
                ["expectedTypeCounts"] = JObject.FromObject(
                    expectedTypeCounts,
                    Serializer),
                ["actualTypeCounts"] = JObject.FromObject(typeCounts, Serializer),
                ["nodes"] = customNodes,
                ["unresolvedAssets"] = unresolvedAssets,
                ["standingSprintSubgraph"] = new JObject
                {
                    ["gameplayTagsBlendNodeIndex"] = 144,
                    ["sprintSequenceNodeIndex"] = 129,
                    ["sprintAccelerationSequenceNodeIndex"] = 130,
                    ["sprintAccelerationBlendNodeIndex"] = 131,
                    ["sprintBlockBlendNodeIndex"] = 139,
                    ["moveForwardBaseNodeIndices"] = new JArray(140, 141),
                    ["matchesAuthoredMetadata"] = standingSprintMatches,
                },
            });
    }

    static JObject ValidateRifleExplicitTimes(JObject payload)
    {
        var nodes = GetNodes(payload, "AB_Als_Rifle");
        var values = new JArray(
            nodes
                .Where(node => node.Value<string>("type") == "FAnimNode_SequenceEvaluator")
                .Where(node => node.SelectToken("parameters.ExplicitTime")?.Value<double>() > 0)
                .Select(
                    node => new JObject
                    {
                        ["node"] = node.Value<string>("property"),
                        ["compiledIndex"] = node["compiledIndex"],
                        ["sequence"] =
                            node.SelectToken("parameters.Sequence.ObjectName"),
                        ["explicitTime"] =
                            node.SelectToken("parameters.ExplicitTime"),
                    }));
        return Validation(
            "rifle-sequence-evaluator-explicit-times",
            values.Count > 0,
            values);
    }

    static JObject ValidateLayeringDynamicAdditive(JObject payload)
    {
        var nodes = GetNodes(payload, "AB_Als_Layering");
        var indexMap = ExactIndexMap(nodes);
        var values = new JArray();
        foreach (var node in nodes.Where(
                     node => node.Value<string>("type") == "FAnimNode_MakeDynamicAdditive"))
        {
            var baseIndex = node.SelectToken("parameters.Base.LinkID")?.Value<int>() ?? -1;
            var sequences = UpstreamSequences(indexMap, baseIndex);
            values.Add(
                new JObject
                {
                    ["node"] = node.Value<string>("property"),
                    ["compiledIndex"] = node["compiledIndex"],
                    ["meshSpaceAdditive"] =
                        node.SelectToken("parameters.bMeshSpaceAdditive"),
                    ["baseNodeIndex"] = baseIndex,
                    ["baseSequences"] = new JArray(sequences),
                });
        }

        var allSequences = values
            .SelectMany(value => value["baseSequences"]?.Values<string>() ?? [])
            .ToHashSet(StringComparer.Ordinal);
        var passed = values.Count > 0
                     && allSequences.Contains("AnimSequence'A_Als_Stand_Pose'")
                     && allSequences.Contains("AnimSequence'A_Als_Crouch_Pose'");
        return Validation("layering-make-dynamic-additive-base-poses", passed, values);
    }

    static JObject ValidateCrouchIdle(JObject payload)
    {
        var groundedNodes = GetNodes(payload, "AB_Als_Grounded");
        var hasGroundedCrouchingInput = groundedNodes.Any(
            node => node.Value<string>("type") == "FAnimNode_LinkedInputPose"
                    && node.SelectToken("parameters.Name")?.Value<string>()
                    == "Crouching Input");

        var crouchingNodes = GetNodes(payload, "AB_Als_Crouching");
        var crouchingIndexMap = ExactIndexMap(crouchingNodes);
        var idleOutput = crouchingNodes.FirstOrDefault(
            node => node.SelectToken("parameters.Name")?.Value<string>() == "Idle"
                    && node.SelectToken("parameters.Result.LinkID") is not null);
        var idleInputIndex = idleOutput?
            .SelectToken("parameters.Result.LinkID")?
            .Value<int>() ?? -1;
        var idleSequences = UpstreamSequences(crouchingIndexMap, idleInputIndex);
        var passed = hasGroundedCrouchingInput
                     && idleSequences.Contains(
                         "AnimSequence'A_Als_Crouch_Pose'",
                         StringComparer.Ordinal);
        var values = new JObject
        {
            ["groundedLinkedInput"] = "Crouching Input",
            ["groundedLinkedInputFound"] = hasGroundedCrouchingInput,
            ["implementationAsset"] = "AB_Als_Crouching",
            ["idleOutput"] = idleOutput?.Value<string>("property"),
            ["idleOutputInputNodeIndex"] = idleInputIndex,
            ["sequences"] = new JArray(idleSequences),
            ["resolvedCrouchIdleSequence"] = passed
                ? "AnimSequence'A_Als_Crouch_Pose'"
                : null,
        };
        return Validation("grounded-crouch-idle-sequence", passed, values);
    }

    static JObject ValidateBranchFilters(JObject payload)
    {
        var matches = new JArray();
        foreach (var asset in ((JObject)payload["assets"]!).Properties())
        {
            foreach (var node in ((JArray)asset.Value["nodes"]!).OfType<JObject>())
            {
                var bones = node
                    .SelectTokens("parameters..LayerSetup[*].BranchFilters[*].BoneName")
                    .Values<string>()
                    .Where(
                        bone => bone is not null
                                && (bone.StartsWith("spine_", StringComparison.Ordinal)
                                    || bone.StartsWith(
                                        "clavicle_",
                                        StringComparison.Ordinal)))
                    .Select(bone => bone!)
                    .Distinct(StringComparer.Ordinal)
                    .ToArray();
                if (bones.Length == 0)
                    continue;
                matches.Add(
                    new JObject
                    {
                        ["asset"] = asset.Name,
                        ["node"] = node.Value<string>("property"),
                        ["bones"] = JArray.FromObject(bones, Serializer),
                    });
            }
        }

        return Validation("layered-bone-blend-spine-clavicle-filters", matches.Count > 0, matches);
    }

    static JArray GetNodes(JObject payload, string assetName)
    {
        return payload.SelectToken($"assets.{assetName}.nodes") as JArray
               ?? throw new Exception($"{assetName} missing from ABP graph");
    }

    static Dictionary<int, JObject> ExactIndexMap(JArray nodes)
    {
        return nodes
            .OfType<JObject>()
            .Where(node => node["compiledIndex"]?.Type == JTokenType.Integer)
            .ToDictionary(node => node.Value<int>("compiledIndex"));
    }

    static string[] UpstreamSequences(
        Dictionary<int, JObject> indexMap,
        int startIndex)
    {
        var sequences = new HashSet<string>(StringComparer.Ordinal);
        var visited = new HashSet<int>();
        var pending = new Stack<int>();
        if (startIndex >= 0)
            pending.Push(startIndex);

        while (pending.TryPop(out var index))
        {
            if (!visited.Add(index) || !indexMap.TryGetValue(index, out var node))
                continue;

            var sequence = node.SelectToken("parameters.Sequence.ObjectName")?.Value<string>();
            if (!string.IsNullOrEmpty(sequence))
                sequences.Add(sequence);
            foreach (var link in FindPoseLinks(node["parameters"]!))
            {
                if (link.LinkId >= 0)
                    pending.Push(link.LinkId);
            }
        }

        return sequences.Order(StringComparer.Ordinal).ToArray();
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
            throw new Exception($"ABP graph validation failed: {string.Join(", ", failed)}");
    }
}
