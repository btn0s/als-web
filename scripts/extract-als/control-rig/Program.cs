using System.Buffers.Binary;
using System.Security.Cryptography;
using System.Text;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using UAssetAPI;
using UAssetAPI.UnrealTypes;

// CR_Als is editor graph data, while some generated RigVM memory embedded in the
// same asset is stale. Extract the authored RigVMGraph exports deliberately
// instead of serializing the generated class/CDO as the reference.
var graphPaths = new[]
{
    "RigVMModel",
    "RigVMFunctionLibrary/RefreshDiagonalScaling/ContainedGraph",
    "RigVMFunctionLibrary/RefreshSpineRotation/ContainedGraph",
    "RigVMFunctionLibrary/TraceFootOffset/New Function_ContainedGraph",
    "RigVMFunctionLibrary/RefreshFootOffset/New Function_ContainedGraph",
    "RigVMFunctionLibrary/RefreshPelvisOffset/ContainedGraph",
    "RigVMFunctionLibrary/ApplyFootIk/New Function_ContainedGraph",
    "RigVMFunctionLibrary/RefreshFootIk/ContainedGraph",
};

if (args.Length is < 2 or > 3)
{
    PrintUsage();
    return 1;
}

try
{
    switch (args[0])
    {
        case "dump" when args.Length == 3:
            {
                var artifact = Extract(args[1], graphPaths);
                Validate(artifact, graphPaths);
                File.WriteAllText(
                    args[2],
                    artifact.ToString(Formatting.Indented) + Environment.NewLine);
                Console.WriteLine($"extracted and validated CR_Als foot-placement graph to {args[2]}");
                return 0;
            }
        case "validate" when args.Length == 2:
            {
                var artifact = JObject.Parse(File.ReadAllText(args[1]));
                Validate(artifact, graphPaths);
                Console.WriteLine($"validated {args[1]}");
                return 0;
            }
        case "verify" when args.Length == 3:
            {
                var expected = JObject.Parse(File.ReadAllText(args[2]));
                var actual = Extract(args[1], graphPaths);
                Validate(actual, graphPaths);
                if (!JToken.DeepEquals(expected, actual))
                {
                    throw new InvalidDataException(
                        $"{args[2]} does not match {args[1]}; regenerate it with the dump command");
                }

                Console.WriteLine($"verified {args[2]} against {args[1]}");
                return 0;
            }
        default:
            PrintUsage();
            return 1;
    }
}
catch (Exception exception)
{
    Console.Error.WriteLine(exception.Message);
    return 1;
}

static void PrintUsage()
{
    Console.Error.WriteLine(
        """
        usage:
          dotnet run --project scripts/extract-als/control-rig -- dump <CR_Als.uasset> <CR_Als.json>
          dotnet run --project scripts/extract-als/control-rig -- validate <CR_Als.json>
          dotnet run --project scripts/extract-als/control-rig -- verify <CR_Als.uasset> <CR_Als.json>
        """);
}

static JObject Extract(string assetPath, IReadOnlyList<string> graphPaths)
{
    var asset = new UAsset(assetPath, EngineVersion.VER_UE5_5);
    var serializedAsset = JObject.Parse(asset.SerializeJsonObject(asset, true));
    var exports = serializedAsset["Exports"] as JArray
        ?? throw new InvalidDataException("UAssetAPI serialization has no Exports array");
    var imports = serializedAsset["Imports"] as JArray
        ?? throw new InvalidDataException("UAssetAPI serialization has no Imports array");

    var pathCache = new Dictionary<int, string>();

    string ExportPath(int exportIndex)
    {
        if (pathCache.TryGetValue(exportIndex, out var cached))
        {
            return cached;
        }

        var export = RequireObject(exports, exportIndex);
        var name = RequireString(export, "ObjectName");
        var outerIndex = RequireInt(export, "OuterIndex");
        var path = outerIndex > 0
            ? $"{ExportPath(outerIndex - 1)}/{name}"
            : name;
        pathCache.Add(exportIndex, path);
        return path;
    }

    string ClassName(JObject export)
    {
        var classIndex = RequireInt(export, "ClassIndex");
        if (classIndex < 0)
        {
            return RequireString(RequireObject(imports, -classIndex - 1), "ObjectName");
        }

        return classIndex > 0
            ? RequireString(RequireObject(exports, classIndex - 1), "ObjectName")
            : "None";
    }

    string? NearestGraphPath(int exportIndex)
    {
        var currentIndex = exportIndex;
        while (currentIndex >= 0)
        {
            var current = RequireObject(exports, currentIndex);
            if (ClassName(current) == "RigVMGraph")
            {
                return StripAssetRoot(ExportPath(currentIndex));
            }

            var outerIndex = RequireInt(current, "OuterIndex");
            if (outerIndex <= 0)
            {
                return null;
            }

            currentIndex = outerIndex - 1;
        }

        return null;
    }

    var exportRecords = exports
        .OfType<JObject>()
        .Select((export, index) => new ExportRecord(
            index,
            export,
            ExportPath(index),
            ClassName(export),
            NearestGraphPath(index)))
        .ToArray();

    var defaults = ExtractControlRigDefaults(
        exportRecords.Single(record =>
            record.Path == "Default__CR_Als_C").Export);

    var extractedGraphs = new JArray();
    foreach (var graphPath in graphPaths)
    {
        var graphExport = exportRecords.SingleOrDefault(
            record =>
                record.ClassName == "RigVMGraph" &&
                StripAssetRoot(record.Path) == graphPath);
        if (graphExport is null)
        {
            throw new InvalidDataException($"missing authored RigVM graph {graphPath}");
        }

        var nodes = exportRecords
            .Where(record =>
                record.GraphPath == graphPath &&
                record.ClassName.EndsWith("Node", StringComparison.Ordinal))
            .Select(record => ExtractNode(record, graphExport.Path))
            .OrderBy(node => (string?)node["path"], StringComparer.Ordinal)
            .ToArray();

        var pins = exportRecords
            .Where(record =>
                record.GraphPath == graphPath &&
                record.ClassName == "RigVMPin")
            .Select(record => ExtractPin(record, graphExport.Path))
            .OrderBy(pin => (string?)pin["path"], StringComparer.Ordinal)
            .ToArray();

        var links = exportRecords
            .Where(record =>
                record.GraphPath == graphPath &&
                record.ClassName == "RigVMLink")
            .Select(record =>
            {
                var (source, target) = DecodeLink(record.Export["Data"]);
                return new JObject
                {
                    ["source"] = source,
                    ["target"] = target,
                };
            })
            .OrderBy(link => (string?)link["source"], StringComparer.Ordinal)
            .ThenBy(link => (string?)link["target"], StringComparer.Ordinal)
            .ToArray();

        extractedGraphs.Add(new JObject
        {
            ["path"] = graphPath,
            ["nodes"] = new JArray(nodes),
            ["pins"] = new JArray(pins),
            ["links"] = new JArray(links),
        });
    }

    return new JObject
    {
        ["schemaVersion"] = 1,
        ["asset"] = "CR_Als",
        ["sourceAsset"] = "Content/ALS/Character/CR_Als.uasset",
        ["sourceSha256"] = Convert.ToHexString(
            SHA256.HashData(File.ReadAllBytes(assetPath))).ToLowerInvariant(),
        ["engineVersion"] = "UE5_5",
        ["scope"] = "foot-placement",
        ["defaults"] = defaults,
        ["graphs"] = extractedGraphs,
    };
}

static JObject ExtractControlRigDefaults(JObject defaultObject)
{
    var properties = defaultObject["Data"] as JArray
        ?? throw new InvalidDataException("CR_Als default object has no properties");
    var spineRotationBonesProperty = properties
        .OfType<JObject>()
        .SingleOrDefault(property =>
            (string?)property["Name"] == "SpineRotationBones")
        ?? throw new InvalidDataException(
            "CR_Als default object has no SpineRotationBones");
    var serializedItems = spineRotationBonesProperty["Value"] as JArray
        ?? throw new InvalidDataException(
            "CR_Als SpineRotationBones is not an array");
    var spineRotationBones = new JArray();
    foreach (var serializedItem in serializedItems.OfType<JObject>())
    {
        var fields = serializedItem["Value"] as JArray
            ?? throw new InvalidDataException(
                "CR_Als SpineRotationBones item has no fields");
        spineRotationBones.Add(new JObject
        {
            ["type"] = RequireSerializedPropertyValue(fields, "Type"),
            ["name"] = RequireSerializedPropertyValue(fields, "Name"),
        });
    }

    return new JObject
    {
        ["spineRotationBones"] = spineRotationBones,
    };
}

static string RequireSerializedPropertyValue(
    JArray properties,
    string propertyName)
{
    return properties
               .OfType<JObject>()
               .SingleOrDefault(property =>
                   (string?)property["Name"] == propertyName)?["Value"]
               ?.Value<string>()
           ?? throw new InvalidDataException(
               $"serialized property {propertyName} is missing");
}

static JObject ExtractNode(ExportRecord record, string graphPath)
{
    var node = new JObject
    {
        ["path"] = RelativePath(record.Path, graphPath),
        ["class"] = record.ClassName,
    };
    CopyProperty(record.Export, node, "NodeTitle", "nodeTitle");
    CopyProperty(record.Export, node, "ResolvedFunctionName", "resolvedFunctionName");
    CopyProperty(record.Export, node, "TemplateNotation", "templateNotation");
    CopyProperty(record.Export, node, "VariableName", "variableName");
    CopyProperty(record.Export, node, "CPPType", "cppType");
    CopyProperty(record.Export, node, "MethodName", "methodName");
    return node;
}

static JObject ExtractPin(ExportRecord record, string graphPath)
{
    var pin = new JObject
    {
        ["path"] = RelativePath(record.Path, graphPath),
    };
    CopyProperty(record.Export, pin, "Direction", "direction");
    CopyProperty(record.Export, pin, "CPPType", "cppType");
    CopyProperty(record.Export, pin, "DefaultValue", "defaultValue");
    CopyProperty(record.Export, pin, "BoundVariablePath", "boundVariablePath");
    CopyProperty(record.Export, pin, "CustomWidgetName", "customWidgetName");
    return pin;
}

static void CopyProperty(
    JObject export,
    JObject destination,
    string sourceName,
    string destinationName)
{
    if (export["Data"] is not JArray properties)
    {
        return;
    }

    var property = properties
        .OfType<JObject>()
        .FirstOrDefault(candidate => (string?)candidate["Name"] == sourceName);
    if (property?["Value"] is { } value)
    {
        destination[destinationName] = value.DeepClone();
    }
}

static (string Source, string Target) DecodeLink(JToken? token)
{
    if (token?.Type != JTokenType.String)
    {
        throw new InvalidDataException("RigVMLink export does not contain raw serialized data");
    }

    var bytes = Convert.FromBase64String(token.Value<string>()!);
    var offset = 0;
    var source = ReadFString(bytes, ref offset);
    var target = ReadFString(bytes, ref offset);
    if (offset != bytes.Length)
    {
        throw new InvalidDataException("RigVMLink contains trailing serialized data");
    }

    return (source, target);
}

static string ReadFString(ReadOnlySpan<byte> bytes, ref int offset)
{
    if (bytes.Length - offset < sizeof(int))
    {
        throw new InvalidDataException("truncated FString length");
    }

    var serializedLength = BinaryPrimitives.ReadInt32LittleEndian(bytes[offset..]);
    offset += sizeof(int);
    if (serializedLength == 0)
    {
        return string.Empty;
    }

    var byteLength = serializedLength > 0
        ? serializedLength
        : checked(-serializedLength * sizeof(char));
    if (byteLength > bytes.Length - offset)
    {
        throw new InvalidDataException("truncated FString value");
    }

    string value;
    if (serializedLength > 0)
    {
        if (bytes[offset + byteLength - 1] != 0)
        {
            throw new InvalidDataException("UTF-8 FString is not null-terminated");
        }

        value = Encoding.UTF8.GetString(bytes.Slice(offset, byteLength - 1));
    }
    else
    {
        if (bytes[offset + byteLength - 1] != 0 ||
            bytes[offset + byteLength - 2] != 0)
        {
            throw new InvalidDataException("UTF-16 FString is not null-terminated");
        }

        value = Encoding.Unicode.GetString(bytes.Slice(offset, byteLength - sizeof(char)));
    }

    offset += byteLength;
    return value;
}

static void Validate(JObject artifact, IReadOnlyList<string> graphPaths)
{
    RequireValue(artifact, "schemaVersion", "1");
    RequireValue(artifact, "asset", "CR_Als");
    RequireValue(artifact, "sourceAsset", "Content/ALS/Character/CR_Als.uasset");
    RequireValue(artifact, "engineVersion", "UE5_5");
    RequireValue(artifact, "scope", "foot-placement");
    var sourceSha256 = RequireString(artifact, "sourceSha256");
    if (sourceSha256.Length != 64 ||
        sourceSha256.Any(character =>
            !Uri.IsHexDigit(character) || char.IsUpper(character)))
    {
        throw new InvalidDataException("sourceSha256 is not a lowercase SHA-256 digest");
    }
    var defaults = artifact["defaults"] as JObject
        ?? throw new InvalidDataException("artifact has no defaults object");
    var spineRotationBones = defaults["spineRotationBones"] as JArray
        ?? throw new InvalidDataException(
            "artifact has no SpineRotationBones defaults");
    var expectedSpineRotationBones = new[]
    {
        "pelvis",
        "spine_01",
        "spine_02",
        "spine_03",
    };
    var actualSpineRotationBones = spineRotationBones
        .OfType<JObject>()
        .Select(item =>
        {
            RequireValue(item, "type", "ERigElementType::Bone");
            return RequireString(item, "name");
        })
        .ToArray();
    if (!actualSpineRotationBones.SequenceEqual(
            expectedSpineRotationBones,
            StringComparer.Ordinal))
    {
        throw new InvalidDataException(
            "SpineRotationBones do not match the authored CR_Als CDO order");
    }

    var graphs = artifact["graphs"] as JArray
        ?? throw new InvalidDataException("artifact has no graphs array");
    var actualGraphPaths = graphs
        .OfType<JObject>()
        .Select(graph => RequireString(graph, "path"))
        .ToArray();
    if (!actualGraphPaths.SequenceEqual(graphPaths, StringComparer.Ordinal))
    {
        throw new InvalidDataException("artifact graph set or order does not match the CR_Als contract");
    }

    foreach (var graph in graphs.OfType<JObject>())
    {
        var nodes = graph["nodes"] as JArray
            ?? throw new InvalidDataException($"{graph["path"]} has no nodes array");
        var pins = graph["pins"] as JArray
            ?? throw new InvalidDataException($"{graph["path"]} has no pins array");
        var links = graph["links"] as JArray
            ?? throw new InvalidDataException($"{graph["path"]} has no links array");
        RequireSortedDistinct(nodes, "path", $"{graph["path"]} nodes");
        RequireSortedDistinct(pins, "path", $"{graph["path"]} pins");
        RequireSortedDistinctBy(
            links,
            link => $"{link["source"]}\0{link["target"]}",
            $"{graph["path"]} links");
    }

    ValidateConstruction(Graph(artifact, "RigVMModel"));
    ValidateDiagonalScaling(
        Graph(
            artifact,
            "RigVMFunctionLibrary/RefreshDiagonalScaling/ContainedGraph"));
    ValidateSpineRotation(
        Graph(
            artifact,
            "RigVMFunctionLibrary/RefreshSpineRotation/ContainedGraph"));
    ValidateTrace(
        Graph(
            artifact,
            "RigVMFunctionLibrary/TraceFootOffset/New Function_ContainedGraph"));
    ValidateFootOffset(
        Graph(
            artifact,
            "RigVMFunctionLibrary/RefreshFootOffset/New Function_ContainedGraph"));
    ValidatePelvisOffset(
        Graph(
            artifact,
            "RigVMFunctionLibrary/RefreshPelvisOffset/ContainedGraph"));
    ValidateApplyFootIk(
        Graph(
            artifact,
            "RigVMFunctionLibrary/ApplyFootIk/New Function_ContainedGraph"));
    ValidateRefreshFootIk(
        Graph(
            artifact,
            "RigVMFunctionLibrary/RefreshFootIk/ContainedGraph"));
}

static void ValidateConstruction(JObject graph)
{
    RequireNode(
        graph,
        "AlsRigUnit_ChainLength",
        "RigVMUnitNode",
        "FAlsRigUnit_ChainLength::Execute");
    RequireNode(
        graph,
        "GetTransform",
        "RigVMUnitNode",
        "FRigUnit_GetTransform::Execute");
    RequirePinDefault(graph, "If_2/True/Name", "ik_foot_root");
    RequirePinDefault(graph, "If_2/False/Name", "VB foot_root");
    RequirePinDefault(graph, "GetTransform/Item/Name", "foot_l");
    RequirePinDefault(graph, "GetTransform/Space", "GlobalSpace");
    RequirePinDefault(graph, "GetTransform/bInitial", "true");
    RequirePinDefault(graph, "AlsRigUnit_ChainLength/AncestorItem/Name", "thigh_l");
    RequirePinDefault(graph, "AlsRigUnit_ChainLength/DescendantItem/Name", "foot_l");
    RequirePinDefault(graph, "AlsRigUnit_ChainLength/bInitial", "true");
    RequirePinDefault(graph, "VariableNode_7/Variable", "FootRootBone");
    RequirePinDefault(graph, "VariableNode/Variable", "FootHeight");
    RequirePinDefault(graph, "VariableNode_2/Variable", "LegLength");

    RequireLink(graph, "VariableNode_8.Value.bUseFootIkBones", "If_2.Condition");
    RequireLink(graph, "If_2.Result", "VariableNode_7.Value");
    RequireLink(graph, "GetTransform.Transform.Translation.Z", "VariableNode.Value");
    RequireLink(graph, "AlsRigUnit_ChainLength.Length", "VariableNode_2.Value");

    // Forward solve order in CR_Als. Construction wiring is deliberately not
    // mistaken for this BeginExecution path.
    RequireLink(
        graph,
        "AlsRigVMFunction_IsGameWorld.True",
        "RefreshDiagonalScaling.Input");
    RequireLink(
        graph,
        "RefreshDiagonalScaling.Input",
        "RefreshSpineRotation.Input");
    RequireLink(
        graph,
        "RefreshSpineRotation.Input",
        "RefreshFootOffset.Input");
    RequireLink(
        graph,
        "RefreshFootOffset.Input",
        "RefreshPelvisOffset.Input");
    RequireLink(
        graph,
        "RefreshPelvisOffset.Input",
        "RefreshFootIk.Input");
    RequireLink(graph, "RefreshFootIk.Input", "RefreshHandIk.Input");
}

static void ValidateDiagonalScaling(JObject graph)
{
    RequirePinDefault(graph, "GetCurveValue_3_1_1/Curve", "PoseMoving");
    RequirePinDefault(graph, "MathVectorScale/Value/X", "0.400000");
    RequirePinDefault(graph, "MathVectorScale/Value/Y", "0.400000");
    RequirePinDefault(graph, "MathVectorScale/Value/Z", "0.000000");
    RequirePinDefault(graph, "Subtract/B", "0.500000");
    RequirePinDefault(graph, "Multiply/B", "2.000000");
    RequirePinDefault(graph, "Subtract_1/A", "1.000000");
    RequirePinDefault(graph, "SetScale/Space", "LocalSpace");
    RequirePinDefault(graph, "SetScale/bPropagateToChildren", "True");
    RequirePinDefault(
        graph,
        "GetTransform_2_2/Item/RigVMInjectionInfo_0/VariableNode/Variable",
        "FootRootBone");
    RequirePinDefault(
        graph,
        "SetScale/Item/RigVMInjectionInfo_0/VariableNode_1/Variable",
        "FootRootBone");
    RequireLink(
        graph,
        "VariableNode_8.Value.VelocityBlendForwardAmount",
        "MathFloatAdd_1_1.A");
    RequireLink(
        graph,
        "VariableNode_8.Value.VelocityBlendBackwardAmount",
        "MathFloatAdd_1_1.B");
    RequireLink(graph, "Subtract.Result", "Multiply.A");
    RequireLink(graph, "Multiply.Result", "Absolute.Value");
    RequireLink(graph, "Absolute.Result", "Subtract_1.B");
    RequireLink(graph, "Subtract_1.Result", "MathVectorScale.Factor");
    RequireLink(graph, "GetCurveValue_3_1_1.Value", "SetScale.Weight");
}

static void ValidateSpineRotation(JObject graph)
{
    RequireNode(
        graph,
        "AlsRigUnit_DistributeRotationSimple",
        "RigVMUnitNode",
        "FAlsRigUnit_DistributeRotationSimple::Execute");
    RequireNode(
        graph,
        "Cast",
        "RigVMUnitNode",
        "FRigVMFunction_MathQuaternionFromRotatorV2::Execute");
    RequirePinDefault(
        graph,
        "AlsRigUnit_DistributeRotationSimple/Items/RigVMInjectionInfo_0/VariableNode_1_1_1_1_1/Variable",
        "SpineRotationBones");
    RequireLink(
        graph,
        "VariableNode_8.Value.SpineYawAngle",
        "Cast.Value.Yaw");
    RequireLink(
        graph,
        "Cast.Result",
        "AlsRigUnit_DistributeRotationSimple.Rotation");
    RequireLink(
        graph,
        "Entry.Input",
        "AlsRigUnit_DistributeRotationSimple.ExecuteContext");
    RequireLink(
        graph,
        "AlsRigUnit_DistributeRotationSimple.ExecuteContext",
        "Return.Input");
}

static void ValidateTrace(JObject graph)
{
    RequireNode(
        graph,
        "AlsRigUnit_FootOffset",
        "RigVMUnitNode",
        "FAlsRigUnit_FootOffsetTrace::Execute");
    RequirePinDefault(
        graph,
        "AlsRigUnit_FootOffset/TraceChannel",
        "ECC_Visibility");
    RequirePinDefault(
        graph,
        "AlsRigUnit_FootOffset/TraceDistanceUpward",
        "50.000000");
    RequirePinDefault(
        graph,
        "AlsRigUnit_FootOffset/TraceDistanceDownward",
        "80.000000");
    RequirePinDefault(graph, "AlsRigUnit_FootOffset/bDrawDebug", "False");
    RequirePinDefault(graph, "LessEqual_1/B", "0.000100");
    RequirePinDefault(
        graph,
        "AlsRigUnit_FootOffset/FootHeight/RigVMInjectionInfo_0/VariableNode/Variable",
        "FootHeight");
    RequirePinDefault(
        graph,
        "LessEqual_1/A/RigVMInjectionInfo_0/VariableNode_2/Variable",
        "FootIkAmount");
    RequireLink(
        graph,
        "VariableNode_8.Value.bFootOffsetAllowed",
        "RigVMFunction_MathBoolOr.A");
    RequireLink(
        graph,
        "LessEqual_1.Result",
        "RigVMFunction_MathBoolOr.B");
    RequireLink(
        graph,
        "RigVMFunction_MathBoolOr.Result",
        "AlsRigUnit_FootOffset.bEnabled");
}

static void ValidateFootOffset(JObject graph)
{
    RequirePinDefault(graph, "GetCurveValue/Curve", "FootLeftIk");
    RequirePinDefault(graph, "GetCurveValue_1/Curve", "FootRightIk");
    RequireLink(graph, "Entry.Input", "TraceFootOffset.Input");
    RequireLink(
        graph,
        "VariableNode_8.Value.FootLeftLocation",
        "TraceFootOffset.FootTargetLocation");
    RequireLink(
        graph,
        "VariableNode_8_1.Value.FootRightLocation",
        "TraceFootOffset_1.FootTargetLocation");
    RequireLink(
        graph,
        "GetCurveValue.Value",
        "TraceFootOffset.FootIkAmount");
    RequireLink(
        graph,
        "GetCurveValue_1.Value",
        "TraceFootOffset_1.FootIkAmount");
    RequireLink(
        graph,
        "TraceFootOffset.Input",
        "VariableNode_6.ExecuteContext");
    RequireLink(
        graph,
        "VariableNode_6.ExecuteContext",
        "VariableNode.ExecuteContext");
    RequireLink(
        graph,
        "VariableNode.ExecuteContext",
        "TraceFootOffset_1.Input");
    RequireLink(
        graph,
        "TraceFootOffset_1.Input",
        "VariableNode_7.ExecuteContext");
}

static void ValidatePelvisOffset(JObject graph)
{
    RequireNode(
        graph,
        "SpringInterpV2_1_1",
        "RigVMUnitNode",
        "FRigUnit_SpringInterpV2::Execute");
    RequirePinDefault(graph, "GetCurveValue/Curve", "FootLeftIk");
    RequirePinDefault(graph, "GetCurveValue_1/Curve", "FootRightIk");
    RequirePinDefault(graph, "MathFloatMul_2/B", "0.500000");
    RequirePinDefault(graph, "Greater_1/B", "0.000100");
    RequirePinDefault(graph, "Clamp/Minimum", "-30.000000");
    RequirePinDefault(graph, "Clamp/Maximum", "40.000000");
    RequirePinDefault(graph, "SpringInterpV2_1_1/Strength", "2.000000");
    RequirePinDefault(
        graph,
        "SpringInterpV2_1_1/CriticalDamping",
        "1.000000");
    RequirePinDefault(
        graph,
        "SpringInterpV2_1_1/TargetVelocityAmount",
        "0.000000");
    RequirePinDefault(
        graph,
        "SpringInterpV2_1_1/bUseCurrentInput",
        "false");
    RequirePinDefault(
        graph,
        "SpringInterpV2_1_1/bInitializeFromTarget",
        "true");
    RequirePinDefault(graph, "SetTranslation_1/Item/Name", "pelvis");
    RequirePinDefault(graph, "SetTranslation_1/Space", "GlobalSpace");
    RequirePinDefault(
        graph,
        "SetTranslation_1/bPropagateToChildren",
        "True");
    RequirePinDefault(
        graph,
        "MathFloatMin_2_1_1/A/RigVMInjectionInfo_0/VariableNode_4_1_1_1_1_1_1_1/Variable",
        "FootLeftOffsetLocationZ");
    RequirePinDefault(
        graph,
        "MathFloatMin_2_1_1/B/RigVMInjectionInfo_0/VariableNode_5_1_1_1_1_1_1_1/Variable",
        "FootRightOffsetLocationZ");
    RequirePinDefault(
        graph,
        "SetTranslation_1/Weight/RigVMInjectionInfo_0/VariableNode_5_1_1_1_1/Variable",
        "PelvisOffsetAmount");

    RequireLink(graph, "GetCurveValue.Value", "MathFloatAdd.A");
    RequireLink(graph, "GetCurveValue_1.Value", "MathFloatAdd.B");
    RequireLink(graph, "MathFloatAdd.Result", "MathFloatMul_2.A");
    RequireLink(graph, "MathFloatMul_2.Result", "Greater_1.A");
    RequireLink(graph, "MathFloatMul_2.Result", "VariableNode_3.Value");
    RequireLink(graph, "MathFloatMin_2_1_1.Result", "Clamp.Value");
    RequireLink(graph, "Clamp.Result", "SpringInterpV2_1_1.Target");
    RequireLink(graph, "SpringInterpV2_1_1.Result", "VariableNode.Value");
    RequireLink(graph, "GetTransform_3.Transform.Translation.Z", "Add.A");
    RequireLink(graph, "VariableNode_1_1_1_1_1.Value", "Add.B");
    RequireLink(graph, "Add.Result", "SetTranslation_1.Value.Z");
    RequireLink(
        graph,
        "VariableNode_5_1_1_1_1.Value",
        "SetTranslation_1.Weight");
}

static void ValidateApplyFootIk(JObject graph)
{
    RequireNode(
        graph,
        "AlsRigUnit_ApplyFootOffsetLocation",
        "RigVMUnitNode",
        "FAlsRigUnit_ApplyFootOffsetLocation::Execute");
    RequireNode(
        graph,
        "AlsRigUnit_CalculatePoleVector",
        "RigVMUnitNode",
        "FAlsRigUnit_CalculatePoleVector::Execute");
    RequireNode(
        graph,
        "AlsRigUnit_ApplyFootOffsetRotation",
        "RigVMUnitNode",
        "FAlsRigUnit_ApplyFootOffsetRotation::Execute");
    RequireNode(
        graph,
        "TwoBoneIKSimplePerItem",
        "RigVMUnitNode",
        "FRigUnit_TwoBoneIKSimplePerItem::Execute");

    RequirePinDefault(
        graph,
        "AlsRigUnit_ApplyFootOffsetLocation/MinPelvisToFootDistanceZ",
        "50.000000");
    RequirePinDefault(
        graph,
        "AlsRigUnit_ApplyFootOffsetLocation/OffsetInterpolationFrequency",
        "0.400000");
    RequirePinDefault(
        graph,
        "AlsRigUnit_ApplyFootOffsetLocation/OffsetInterpolationDampingRatio",
        "4.000000");
    RequirePinDefault(
        graph,
        "AlsRigUnit_ApplyFootOffsetLocation/OffsetInterpolationTargetVelocityAmount",
        "1.000000");
    RequirePinDefault(
        graph,
        "AlsRigUnit_ApplyFootOffsetLocation/MaxLegStretchRatio",
        "0.990000");
    RequirePinDefault(graph, "MathVectorScale_2/Factor", "40.000000");
    RequirePinDefault(
        graph,
        "AlsRigVMFunction_ExponentialDecayVector/Lambda",
        "15.000000");

    RequirePinDefault(
        graph,
        "TwoBoneIKSimplePerItem/PoleVectorKind",
        "Location");
    RequirePinDefault(
        graph,
        "TwoBoneIKSimplePerItem/SecondaryAxisWeight",
        "1.000000");
    RequirePinDefault(
        graph,
        "TwoBoneIKSimplePerItem/bEnableStretch",
        "false");
    RequirePinDefault(
        graph,
        "TwoBoneIKSimplePerItem/bPropagateToChildren",
        "true");

    RequirePinDefault(
        graph,
        "AlsRigUnit_ApplyFootOffsetRotation/LimitOffset",
        "(X=0.001903,Y=-0.043578,Z=0.043578,W=0.998097)");
    RequirePinDefault(
        graph,
        "AlsRigUnit_ApplyFootOffsetRotation/OffsetInterpolationSpeed",
        "20.000000");
    RequirePinDefault(
        graph,
        "AlsRigUnit_ApplyFootOffsetRotation/Swing1LimitAngle",
        "25.000000");
    RequirePinDefault(
        graph,
        "AlsRigUnit_ApplyFootOffsetRotation/Swing2LimitAngle",
        "5.000000");
    RequirePinDefault(
        graph,
        "AlsRigUnit_ApplyFootOffsetRotation/TwistLimitAngle",
        "0.000000");
    RequirePinDefault(graph, "Set Transform/Space", "GlobalSpace");
    RequirePinDefault(graph, "Set Transform/bInitial", "False");
    RequirePinDefault(
        graph,
        "Set Transform/bPropagateToChildren",
        "True");

    RequireLink(
        graph,
        "Entry.Input",
        "AlsRigUnit_ApplyFootOffsetLocation.ExecuteContext");
    RequireLink(
        graph,
        "AlsRigUnit_ApplyFootOffsetLocation.ExecuteContext",
        "TwoBoneIKSimplePerItem.ExecuteContext");
    RequireLink(
        graph,
        "TwoBoneIKSimplePerItem.ExecuteContext",
        "AlsRigUnit_ApplyFootOffsetRotation.ExecuteContext");
    RequireLink(
        graph,
        "AlsRigUnit_ApplyFootOffsetRotation.ExecuteContext",
        "Set Transform.ExecuteContext");
    RequireLink(
        graph,
        "AlsRigUnit_ApplyFootOffsetLocation.FootLocation",
        "TwoBoneIKSimplePerItem.Effector.Translation");
    RequireLink(
        graph,
        "AlsRigUnit_CalculatePoleVector.PoleDirection",
        "MathVectorScale_2.Value");
    RequireLink(
        graph,
        "MathVectorAdd.Result",
        "AlsRigVMFunction_ExponentialDecayVector.Target");
    RequireLink(
        graph,
        "AlsRigVMFunction_ExponentialDecayVector.Current",
        "TwoBoneIKSimplePerItem.PoleVector");
    RequireLink(
        graph,
        "AlsRigUnit_ApplyFootOffsetRotation.FootRotation",
        "Set Transform.Value");
}

static void ValidateRefreshFootIk(JObject graph)
{
    RequirePinDefault(graph, "GetCurveValue_2/Curve", "FootLeftIk");
    RequirePinDefault(graph, "GetCurveValue_2_1/Curve", "FootRightIk");
    RequirePinDefault(graph, "ApplyFootIk/PelvisItem/Name", "pelvis");
    RequirePinDefault(graph, "ApplyFootIk/ThighItem/Name", "thigh_l");
    RequirePinDefault(graph, "ApplyFootIk/CalfItem/Name", "calf_l");
    RequirePinDefault(graph, "ApplyFootIk/FootItem/Name", "foot_l");
    RequirePinDefault(graph, "ApplyFootIk/PrimaryAxis/X", "-1.000000");
    RequirePinDefault(graph, "ApplyFootIk/SecondaryAxis/Y", "1.000000");
    RequirePinDefault(graph, "ApplyFootIk_1/PelvisItem/Name", "pelvis");
    RequirePinDefault(graph, "ApplyFootIk_1/ThighItem/Name", "thigh_r");
    RequirePinDefault(graph, "ApplyFootIk_1/CalfItem/Name", "calf_r");
    RequirePinDefault(graph, "ApplyFootIk_1/FootItem/Name", "foot_r");
    RequirePinDefault(graph, "ApplyFootIk_1/PrimaryAxis/X", "1.000000");
    RequirePinDefault(graph, "ApplyFootIk_1/SecondaryAxis/Y", "-1.000000");
    RequireLink(graph, "Entry.Input", "ApplyFootIk.Input");
    RequireLink(graph, "ApplyFootIk.Input", "ApplyFootIk_1.Input");
    RequireLink(graph, "ApplyFootIk_1.Input", "Return.Input");
    RequireLink(graph, "GetCurveValue_2.Value", "ApplyFootIk.Weight");
    RequireLink(graph, "GetCurveValue_2_1.Value", "ApplyFootIk_1.Weight");
    RequireLink(
        graph,
        "VariableNode_14_2_1_2.Value.FootLeftLocation",
        "ApplyFootIk.TargetLocation");
    RequireLink(
        graph,
        "VariableNode_14_2_1_2.Value.FootLeftRotation",
        "ApplyFootIk.TargetRotation");
    RequireLink(
        graph,
        "VariableNode_14_2_1_2_1.Value.FootRightLocation",
        "ApplyFootIk_1.TargetLocation");
    RequireLink(
        graph,
        "VariableNode_14_2_1_2_1.Value.FootRightRotation",
        "ApplyFootIk_1.TargetRotation");
}

static JObject Graph(JObject artifact, string path)
{
    return (artifact["graphs"] as JArray)?
        .OfType<JObject>()
        .SingleOrDefault(graph => (string?)graph["path"] == path)
        ?? throw new InvalidDataException($"missing graph {path}");
}

static void RequireNode(
    JObject graph,
    string path,
    string expectedClass,
    string expectedResolvedFunction)
{
    var node = (graph["nodes"] as JArray)?
        .OfType<JObject>()
        .SingleOrDefault(candidate => (string?)candidate["path"] == path)
        ?? throw new InvalidDataException($"{graph["path"]}: missing node {path}");
    RequireValue(node, "class", expectedClass);
    RequireValue(node, "resolvedFunctionName", expectedResolvedFunction);
}

static void RequirePinDefault(JObject graph, string path, string expected)
{
    var pin = (graph["pins"] as JArray)?
        .OfType<JObject>()
        .SingleOrDefault(candidate => (string?)candidate["path"] == path)
        ?? throw new InvalidDataException($"{graph["path"]}: missing pin {path}");
    var actual = (string?)pin["defaultValue"];
    if (actual != expected)
    {
        throw new InvalidDataException(
            $"{graph["path"]}/{path}: expected {expected}, extracted {actual ?? "<missing>"}");
    }
}

static void RequireLink(JObject graph, string source, string target)
{
    var exists = (graph["links"] as JArray)?
        .OfType<JObject>()
        .Any(link =>
            (string?)link["source"] == source &&
            (string?)link["target"] == target) == true;
    if (!exists)
    {
        throw new InvalidDataException(
            $"{graph["path"]}: missing link {source} -> {target}");
    }
}

static void RequireSortedDistinct(
    JArray values,
    string propertyName,
    string label)
{
    RequireSortedDistinctBy(
        values,
        value => value[propertyName]?.Value<string>()
            ?? throw new InvalidDataException($"{label}: missing {propertyName}"),
        label);
}

static void RequireSortedDistinctBy(
    JArray values,
    Func<JToken, string> key,
    string label)
{
    var actual = values.Select(key).ToArray();
    var expected = actual
        .Distinct(StringComparer.Ordinal)
        .OrderBy(value => value, StringComparer.Ordinal)
        .ToArray();
    if (!actual.SequenceEqual(expected, StringComparer.Ordinal))
    {
        throw new InvalidDataException($"{label} are not sorted and distinct");
    }
}

static void RequireValue(JObject value, string propertyName, string expected)
{
    var actual = value[propertyName]?.ToString();
    if (actual != expected)
    {
        throw new InvalidDataException(
            $"{propertyName}: expected {expected}, extracted {actual ?? "<missing>"}");
    }
}

static JObject RequireObject(JArray values, int index)
{
    if (index < 0 || index >= values.Count || values[index] is not JObject value)
    {
        throw new InvalidDataException($"invalid package index {index}");
    }

    return value;
}

static string RequireString(JObject value, string propertyName)
{
    return value[propertyName]?.Value<string>()
        ?? throw new InvalidDataException($"missing {propertyName}");
}

static int RequireInt(JObject value, string propertyName)
{
    return value[propertyName]?.Value<int>()
        ?? throw new InvalidDataException($"missing {propertyName}");
}

static string StripAssetRoot(string path)
{
    const string root = "CR_Als/";
    return path.StartsWith(root, StringComparison.Ordinal)
        ? path[root.Length..]
        : path;
}

static string RelativePath(string path, string graphPath)
{
    var prefix = $"{graphPath}/";
    if (!path.StartsWith(prefix, StringComparison.Ordinal))
    {
        throw new InvalidDataException($"{path} is not inside {graphPath}");
    }

    return path[prefix.Length..];
}

sealed record ExportRecord(
    int Index,
    JObject Export,
    string Path,
    string ClassName,
    string? GraphPath);
