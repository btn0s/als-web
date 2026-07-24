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
// generated class default object. FPropertyTag.TagData retains the exact struct
// name even when CUE4Parse has to expose the value as FStructFallback. The
// generated class separately stores baked state-machine descriptions.
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
        var wiring = ReadWiring(nodes, exactIndexMap);
        var stateMachines = ReadStateMachines(generatedClass, exactIndexMap);
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
        foreach (var property in cdo.Properties.Where(
                     property => property.Name.Text.StartsWith(
                         "AnimGraphNode_",
                         StringComparison.Ordinal)))
        {
            if (property.Tag is null)
                continue;

            var tagData = JObject.FromObject(property.TagData!, Serializer);
            var structType = tagData.Value<string>("StructType") ?? "AnimNode_Unknown";
            var module = tagData.Value<string>("Module") ?? "";
            var parameters = JToken.FromObject(property.Tag, Serializer) as JObject
                             ?? new JObject
                             {
                                 ["value"] = JToken.FromObject(property.Tag, Serializer),
                             };
            var structValue = (property.Tag as StructProperty)?.Value?.StructType;
            nodes.Add(
                new NodeRecord
                {
                    SerializedOrder = nodes.Count,
                    PropertyName = property.Name.Text,
                    Type = structType.StartsWith('F') ? structType : $"F{structType}",
                    Module = module,
                    Serialization = structValue is FStructFallback
                        ? nameof(FStructFallback)
                        : structValue?.GetType().Name ?? property.Tag.GetType().Name,
                    Parameters = parameters,
                    CompiledIndexCandidates = [],
                });
        }

        return nodes;
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
        Dictionary<int, NodeRecord> exactIndexMap)
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
                var rootIndex = state.Value<int?>("StateRootNodeIndex");
                if (rootIndex is not null && exactIndexMap.TryGetValue(rootIndex.Value, out var root))
                {
                    state["StateRootNodeProperty"] = root.PropertyName;
                    state["StateRootNodeType"] = root.Type;
                }

                var playerProperties = new JArray();
                foreach (var playerIndex in state["PlayerNodeIndices"]?.Values<int>() ?? [])
                {
                    playerProperties.Add(
                        exactIndexMap.TryGetValue(playerIndex, out var player)
                            ? player.PropertyName
                            : null);
                }
                state["PlayerNodeProperties"] = playerProperties;

                foreach (var stateTransition in state["Transitions"]?.OfType<JObject>() ?? [])
                {
                    stateTransition["rule"] = new JObject
                    {
                        ["compiledDelegateIndex"] =
                            stateTransition.Value<int?>("CanTakeDelegateIndex"),
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
                        || rootIndex >= compiledNodeCount)
                    {
                        errors.Add(
                            $"{assetProperty.Name}.{machine.Value<string>("MachineName")}." +
                            $"{state.Value<string>("StateName")}: StateRootNodeIndex is invalid");
                    }
                    foreach (var playerIndex in state["PlayerNodeIndices"]?.Values<int>() ?? [])
                    {
                        if (playerIndex < 0 || playerIndex >= compiledNodeCount)
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
