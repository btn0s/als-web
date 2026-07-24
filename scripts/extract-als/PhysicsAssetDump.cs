using System.Security.Cryptography;
using System.Text;
using CUE4Parse.FileProvider;
using CUE4Parse.UE4.Assets.Exports;
using CUE4Parse.UE4.Versions;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

// Freezes PA_Als as an editor-free physics-content oracle. Unreal tagged
// properties only store values that differ from the native class/struct
// defaults, so every normalized field retains whether it was serialized. An
// absent value is never replaced with a guessed Chaos default.
public static class PhysicsAssetDump
{
    const string AssetName = "PA_Als";
    const string AssetPath = "/Content/ALS/Character/";
    const string ExpectedCanonicalSha256 =
        "2db11cf9bc20394bc9c03e2d9798f067e92bb907d12e73fbf2fb701132e2390f";

    static readonly string[] ExpectedBodyExports =
    [
        "SkeletalBodySetup_19",
        "SkeletalBodySetup_20",
        "SkeletalBodySetup_21",
        "SkeletalBodySetup_22",
        "SkeletalBodySetup_23",
        "SkeletalBodySetup_24",
        "SkeletalBodySetup_25",
        "SkeletalBodySetup_26",
        "SkeletalBodySetup_27",
        "SkeletalBodySetup_28",
        "SkeletalBodySetup_35",
        "SkeletalBodySetup_36",
        "SkeletalBodySetup_37",
        "SkeletalBodySetup_38",
        "SkeletalBodySetup_39",
        "SkeletalBodySetup_40",
        "SkeletalBodySetup_41",
        "SkeletalBodySetup_42",
        "SkeletalBodySetup_43",
        "SkeletalBodySetup_0",
        "SkeletalBodySetup_1",
    ];

    static readonly string[] ExpectedBodyBones =
    [
        "pelvis",
        "spine_01",
        "spine_02",
        "spine_03",
        "neck_01",
        "head",
        "thigh_l",
        "thigh_r",
        "calf_l",
        "calf_r",
        "clavicle_l",
        "clavicle_r",
        "upperarm_l",
        "upperarm_r",
        "lowerarm_l",
        "lowerarm_r",
        "hand_l",
        "hand_r",
        "root",
        "foot_l",
        "foot_r",
    ];

    static readonly string[] ExpectedConstraintExports =
    [
        "PhysicsConstraintTemplate_0",
        "PhysicsConstraintTemplate_3",
        "PhysicsConstraintTemplate_4",
        "PhysicsConstraintTemplate_5",
        "PhysicsConstraintTemplate_6",
        "PhysicsConstraintTemplate_7",
        "PhysicsConstraintTemplate_8",
        "PhysicsConstraintTemplate_9",
        "PhysicsConstraintTemplate_10",
        "PhysicsConstraintTemplate_17",
        "PhysicsConstraintTemplate_18",
        "PhysicsConstraintTemplate_19",
        "PhysicsConstraintTemplate_20",
        "PhysicsConstraintTemplate_21",
        "PhysicsConstraintTemplate_22",
        "PhysicsConstraintTemplate_23",
        "PhysicsConstraintTemplate_24",
        "PhysicsConstraintTemplate_25",
        "PhysicsConstraintTemplate_1",
        "PhysicsConstraintTemplate_2",
    ];

    static readonly string[] ExpectedConstraintPairs =
    [
        "spine_01|pelvis",
        "spine_02|spine_01",
        "spine_03|spine_02",
        "neck_01|spine_03",
        "head|neck_01",
        "thigh_l|pelvis",
        "thigh_r|pelvis",
        "calf_l|thigh_l",
        "calf_r|thigh_r",
        "clavicle_l|spine_03",
        "clavicle_r|spine_03",
        "upperarm_l|clavicle_l",
        "upperarm_r|clavicle_r",
        "lowerarm_l|upperarm_l",
        "lowerarm_r|upperarm_r",
        "hand_l|lowerarm_l",
        "hand_r|lowerarm_r",
        "pelvis|root",
        "foot_l|calf_l",
        "foot_r|calf_r",
    ];

    static readonly string[] ExpectedCollisionDisablePairs =
    [
        "0|1",
        "1|2",
        "1|3",
        "2|3",
        "3|4",
        "4|5",
        "0|6",
        "0|7",
        "6|8",
        "7|9",
        "3|10",
        "3|11",
        "10|11",
        "4|10",
        "4|11",
        "2|10",
        "2|11",
        "10|12",
        "11|13",
        "3|13",
        "3|12",
        "2|13",
        "2|12",
        "12|14",
        "13|15",
        "14|16",
        "15|17",
        "0|18",
        "9|18",
        "8|18",
        "6|18",
        "7|18",
        "1|18",
        "2|18",
        "3|18",
        "10|18",
        "12|18",
        "14|18",
        "16|18",
        "13|18",
        "15|18",
        "17|18",
        "11|18",
        "4|18",
        "5|18",
        "8|19",
        "9|20",
        "8|9",
        "6|7",
    ];

    static readonly int[] ExpectedBoundsBodies =
    [
        0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
        10, 11, 12, 13, 14, 15, 16, 17, 19, 20,
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

        var file = provider.Files.Values.SingleOrDefault(
                       candidate =>
                           candidate.NameWithoutExtension == AssetName
                           && candidate.Extension == "uasset"
                           && candidate.Path
                               .Replace('\\', '/')
                               .Contains(
                                   AssetPath,
                                   StringComparison.Ordinal))
                   ?? throw new Exception(
                       $"{AssetName}.uasset was not found exactly once below " +
                       AssetPath);
        var exports = provider.LoadPackage(file).GetExports().ToArray();
        var serializedExports = exports
            .Select(export => JObject.FromObject(export, Serializer))
            .ToArray();
        var physicsAsset = serializedExports.SingleOrDefault(
                               export =>
                                   export.Value<string>("Name") == AssetName
                                   && export.Value<string>("Type")
                                   == "PhysicsAsset")
                           ?? throw new Exception(
                               $"{AssetName} has no PhysicsAsset export");
        var assetProperties =
            physicsAsset["Properties"] as JObject
            ?? throw new Exception(
                $"{AssetName} has no serialized Properties");

        var bodyReferences = RequiredArray(
            assetProperties,
            "SkeletalBodySetups");
        var bodies = new JArray();
        foreach (var (reference, bodyIndex) in
                 bodyReferences.OfType<JObject>().Select(
                     (reference, index) => (reference, index)))
        {
            var bodyExport = ResolveExport(
                serializedExports,
                reference,
                "SkeletalBodySetup");
            bodies.Add(
                NormalizeBody(
                    bodyExport,
                    reference,
                    bodyIndex,
                    ExpectedBoundsBodies.Contains(bodyIndex)));
        }

        var constraintReferences = RequiredArray(
            assetProperties,
            "ConstraintSetup");
        var constraints = new JArray();
        foreach (var (reference, constraintIndex) in
                 constraintReferences.OfType<JObject>().Select(
                     (reference, index) => (reference, index)))
        {
            var constraintExport = ResolveExport(
                serializedExports,
                reference,
                "PhysicsConstraintTemplate");
            constraints.Add(
                NormalizeConstraint(
                    constraintExport,
                    reference,
                    constraintIndex));
        }

        var collisionDisablePairs = NormalizeCollisionDisablePairs(
            RequiredArray(physicsAsset, "CollisionDisableTable"),
            bodies);
        var payload = new JObject
        {
            ["schemaVersion"] = 1,
            ["source"] = new JObject
            {
                ["engineVersion"] = "UE5.5",
                ["referenceRelease"] = "ALS Refactored 4.15",
                ["physicsAssetPath"] = file.Path,
                ["asset"] = AssetName,
                ["typedReader"] =
                    "CUE4Parse UPhysicsAsset/USkeletalBodySetup",
                ["units"] = new JObject
                {
                    ["distance"] = "cm",
                    ["angle"] = "deg",
                    ["mass"] = "kg when an effective mass is available",
                },
            },
            ["serializationPolicy"] = new JObject
            {
                ["serialized"] =
                    "Exact tagged/native values present in PA_Als.uasset",
                ["inheritedDefault"] =
                    "Tag absent; UE5.5 class/struct default is not guessed",
                ["shapeOrder"] =
                    "FKAggregateGeom collection order, then authored element order",
                ["constraintOrder"] =
                    "UPhysicsAsset.ConstraintSetup authored array order",
                ["bodyOrder"] =
                    "UPhysicsAsset.SkeletalBodySetups authored array order",
            },
            ["asset"] = NormalizeAsset(
                physicsAsset,
                assetProperties,
                bodyReferences,
                constraintReferences),
            ["bodies"] = bodies,
            ["collisionDisablePairs"] = collisionDisablePairs,
            ["constraints"] = constraints,
            ["unavailableEngineDefaults"] =
                CreateUnavailableEngineDefaults(),
        };
        payload["canonicalSha256"] = ComputeCanonicalSha256(payload);
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
            $"dumped {bodies.Count} bodies, " +
            $"{constraints.Count} constraints, and " +
            $"{collisionDisablePairs.Count} disabled pairs -> {outJson} " +
            $"({new FileInfo(outJson).Length:N0} bytes)");
        return 0;
    }

    public static int Validate(string physicsAssetJson)
    {
        var payload = JObject.Parse(
            File.ReadAllText(physicsAssetJson));
        var validations = ValidatePayload(payload);
        PrintValidations(validations);
        ThrowOnValidationFailure(validations);
        Console.WriteLine($"validated {physicsAssetJson}");
        return 0;
    }

    static JObject ResolveExport(
        IEnumerable<JObject> exports,
        JObject reference,
        string requiredType)
    {
        var objectName =
            reference.Value<string>("ObjectName")
            ?? throw new Exception(
                $"{requiredType} reference has no ObjectName");
        var exportName = ReadObjectLeafName(objectName);
        var export = exports.SingleOrDefault(
                         candidate =>
                             candidate.Value<string>("Name") == exportName)
                     ?? throw new Exception(
                         $"{exportName} could not be resolved");
        if (export.Value<string>("Type") != requiredType)
        {
            throw new Exception(
                $"{exportName} is not a {requiredType} export");
        }
        return export;
    }

    static JObject NormalizeAsset(
        JObject physicsAsset,
        JObject properties,
        JArray bodyReferences,
        JArray constraintReferences)
    {
        return new JObject
        {
            ["name"] = AssetName,
            ["previewSkeletalMesh"] =
                properties["PreviewSkeletalMesh"]?.DeepClone()
                ?? JValue.CreateNull(),
            ["boundsBodyIndices"] =
                properties["BoundsBodies"]?.DeepClone()
                ?? new JArray(),
            ["bodyReferences"] = bodyReferences.DeepClone(),
            ["constraintReferences"] =
                constraintReferences.DeepClone(),
            ["settings"] = new JObject
            {
                ["bNotForDedicatedServer"] = FieldState(
                    properties,
                    "bNotForDedicatedServer",
                    "UPhysicsAsset"),
                ["physicalAnimationProfiles"] = FieldState(
                    properties,
                    "PhysicalAnimationProfiles",
                    "UPhysicsAsset"),
                ["constraintProfiles"] = FieldState(
                    properties,
                    "ConstraintProfiles",
                    "UPhysicsAsset"),
                ["solverType"] = FieldState(
                    properties,
                    "SolverType",
                    "UPhysicsAsset"),
                ["solverSettings"] = FieldState(
                    properties,
                    "SolverSettings",
                    "UPhysicsAsset"),
                ["solverIterations"] = FieldState(
                    properties,
                    "SolverIterations",
                    "UPhysicsAsset"),
            },
            ["serializedProperties"] = properties.DeepClone(),
            ["nativeSerialization"] = new JObject
            {
                ["collisionDisableTablePresent"] =
                    physicsAsset["CollisionDisableTable"] is JArray,
            },
        };
    }

    static JObject NormalizeBody(
        JObject bodyExport,
        JObject reference,
        int bodyIndex,
        bool includedInBounds)
    {
        var properties =
            bodyExport["Properties"] as JObject
            ?? throw new Exception(
                $"{bodyExport.Value<string>("Name")} has no Properties");
        var aggregateGeometry =
            properties["AggGeom"] as JObject
            ?? throw new Exception(
                $"{bodyExport.Value<string>("Name")} has no AggGeom");
        var shapes = NormalizeShapes(aggregateGeometry);
        var contributingShapeCount = shapes
            .OfType<JObject>()
            .Count(shape =>
                shape.SelectToken(
                        "collision.bContributeToMass.value")
                    ?.Value<bool?>()
                == true);
        return new JObject
        {
            ["index"] = bodyIndex,
            ["exportName"] = bodyExport.Value<string>("Name"),
            ["objectPath"] = reference.Value<string>("ObjectPath"),
            ["boneName"] = RequiredString(properties, "BoneName"),
            ["bodySetupGuid"] =
                bodyExport.Value<string>("BodySetupGuid"),
            ["includedInBounds"] = includedInBounds,
            ["shapes"] = shapes,
            ["collisionAndSimulation"] = new JObject
            {
                ["physicsType"] = FieldState(
                    properties,
                    "PhysicsType",
                    "USkeletalBodySetup"),
                ["collisionTraceFlag"] = FieldState(
                    properties,
                    "CollisionTraceFlag",
                    "USkeletalBodySetup"),
                // This spelling is the actual UE5.5 serialized property.
                ["collisionResponse"] = FieldState(
                    properties,
                    "CollisionReponse",
                    "USkeletalBodySetup"),
                ["considerForBounds"] = new JObject
                {
                    ["source"] =
                        "UPhysicsAsset.BoundsBodies authored index table",
                    ["value"] = includedInBounds,
                    ["serializedBodyOverride"] = FieldState(
                        properties,
                        "bConsiderForBounds",
                        "UBodySetup"),
                },
                ["skipScaleFromAnimation"] = FieldState(
                    properties,
                    "bSkipScaleFromAnimation",
                    "USkeletalBodySetup"),
                ["bodySetupFlags"] = NormalizeFields(
                    properties,
                    "UBodySetup",
                    [
                        "bDoubleSidedGeometry",
                        "bGenerateMirroredCollision",
                        "bGenerateNonMirroredCollision",
                        "bNeverNeedsCookedCollisionData",
                        "bSharedCookedData",
                        "bSupportUVsAndFaceRemap",
                        "WalkableSlopeOverride",
                    ]),
                ["defaultBodyInstance"] = FieldState(
                    properties,
                    "DefaultInstance",
                    "UBodySetup"),
                ["currentPhysicalAnimationProfile"] = FieldState(
                    properties,
                    "CurrentPhysicalAnimationProfile",
                    "USkeletalBodySetup"),
                ["physicalAnimation"] =
                    NormalizePhysicalAnimationProfile(
                        properties[
                            "CurrentPhysicalAnimationProfile"]
                        as JObject),
            },
            ["massAndMaterial"] = new JObject
            {
                ["contributingShapeCount"] =
                    contributingShapeCount,
                ["physicalMaterial"] = FieldState(
                    properties,
                    "PhysMaterial",
                    "UBodySetup"),
                ["buildScale3D"] = FieldState(
                    properties,
                    "BuildScale3D",
                    "UBodySetup"),
                ["defaultBodyInstance"] = FieldState(
                    properties,
                    "DefaultInstance",
                    "UBodySetup"),
                ["effectiveMassKg"] = new JObject
                {
                    ["source"] =
                        "unavailable UE5.5 runtime defaults/material density",
                    ["value"] = JValue.CreateNull(),
                },
            },
            ["serializedProperties"] = properties.DeepClone(),
            ["nativeSerialization"] = new JObject
            {
                ["BodySetupGuid"] =
                    bodyExport["BodySetupGuid"]?.DeepClone()
                    ?? JValue.CreateNull(),
                ["CookedFormatData"] =
                    bodyExport["CookedFormatData"]?.DeepClone()
                    ?? JValue.CreateNull(),
            },
        };
    }

    static JArray NormalizeShapes(JObject aggregateGeometry)
    {
        var shapes = new JArray();
        AddShapes(
            shapes,
            aggregateGeometry,
            "SphereElems",
            "FKSphereElem");
        AddShapes(
            shapes,
            aggregateGeometry,
            "BoxElems",
            "FKBoxElem");
        AddShapes(
            shapes,
            aggregateGeometry,
            "SphylElems",
            "FKSphylElem");
        AddShapes(
            shapes,
            aggregateGeometry,
            "ConvexElems",
            "FKConvexElem");
        AddShapes(
            shapes,
            aggregateGeometry,
            "TaperedCapsuleElems",
            "FKTaperedCapsuleElem");
        return shapes;
    }

    static void AddShapes(
        JArray output,
        JObject aggregateGeometry,
        string collectionName,
        string elementType)
    {
        if (aggregateGeometry[collectionName] is not JArray elements)
        {
            return;
        }
        foreach (var (serialized, collectionIndex) in
                 elements.OfType<JObject>().Select(
                     (element, index) => (element, index)))
        {
            output.Add(
                NormalizeShape(
                    serialized,
                    collectionName,
                    elementType,
                    collectionIndex));
        }
    }

    static JObject NormalizeShape(
        JObject serialized,
        string collectionName,
        string elementType,
        int collectionIndex)
    {
        var localTransform = elementType switch
        {
            "FKSphereElem" => new JObject
            {
                ["translationCm"] =
                    serialized["Center"]?.DeepClone()
                    ?? JValue.CreateNull(),
                ["rotationDegrees"] = JValue.CreateNull(),
                ["rotationMeaning"] =
                    "A sphere has no authored orientation",
            },
            "FKConvexElem" => new JObject
            {
                ["transform"] =
                    serialized["Transform"]?.DeepClone()
                    ?? JValue.CreateNull(),
            },
            _ => new JObject
            {
                ["translationCm"] =
                    serialized["Center"]?.DeepClone()
                    ?? JValue.CreateNull(),
                ["rotationDegrees"] =
                    serialized["Rotation"]?.DeepClone()
                    ?? JValue.CreateNull(),
            },
        };
        var dimensions = elementType switch
        {
            "FKSphereElem" => new JObject
            {
                ["radiusCm"] =
                    serialized["Radius"]?.DeepClone()
                    ?? JValue.CreateNull(),
            },
            "FKBoxElem" => new JObject
            {
                ["sizeCm"] = new JObject
                {
                    ["X"] = serialized["X"]?.DeepClone()
                            ?? JValue.CreateNull(),
                    ["Y"] = serialized["Y"]?.DeepClone()
                            ?? JValue.CreateNull(),
                    ["Z"] = serialized["Z"]?.DeepClone()
                            ?? JValue.CreateNull(),
                },
            },
            "FKSphylElem" => new JObject
            {
                ["radiusCm"] =
                    serialized["Radius"]?.DeepClone()
                    ?? JValue.CreateNull(),
                ["cylinderLengthCm"] =
                    serialized["Length"]?.DeepClone()
                    ?? JValue.CreateNull(),
            },
            "FKTaperedCapsuleElem" => new JObject
            {
                ["radius0Cm"] =
                    serialized["Radius0"]?.DeepClone()
                    ?? JValue.CreateNull(),
                ["radius1Cm"] =
                    serialized["Radius1"]?.DeepClone()
                    ?? JValue.CreateNull(),
                ["cylinderLengthCm"] =
                    serialized["Length"]?.DeepClone()
                    ?? JValue.CreateNull(),
            },
            "FKConvexElem" => new JObject
            {
                ["verticesCm"] =
                    serialized["VertexData"]?.DeepClone()
                    ?? new JArray(),
                ["indices"] =
                    serialized["IndexData"]?.DeepClone()
                    ?? new JArray(),
                ["boundsCm"] =
                    serialized["ElemBox"]?.DeepClone()
                    ?? JValue.CreateNull(),
            },
            _ => throw new Exception(
                $"unsupported aggregate shape {elementType}"),
        };
        return new JObject
        {
            ["type"] = elementType,
            ["aggregateCollection"] = collectionName,
            ["collectionIndex"] = collectionIndex,
            ["localTransform"] = localTransform,
            ["dimensions"] = dimensions,
            ["collision"] = new JObject
            {
                ["restOffsetCm"] = FieldState(
                    serialized,
                    "RestOffset",
                    elementType),
                ["name"] = FieldState(
                    serialized,
                    "Name",
                    elementType),
                ["bIsGenerated"] = FieldState(
                    serialized,
                    "bIsGenerated",
                    elementType),
                ["bContributeToMass"] = FieldState(
                    serialized,
                    "bContributeToMass",
                    elementType),
                ["collisionEnabled"] = FieldState(
                    serialized,
                    "CollisionEnabled",
                    elementType),
            },
            ["serialized"] = serialized.DeepClone(),
        };
    }

    static JArray NormalizeCollisionDisablePairs(
        JArray serializedPairs,
        JArray bodies)
    {
        var output = new JArray();
        foreach (var (serializedPair, order) in
                 serializedPairs.OfType<JObject>().Select(
                     (pair, index) => (pair, index)))
        {
            var indices =
                serializedPair.SelectToken("Key.Indices")
                as JArray
                ?? throw new Exception(
                    $"collision disable pair {order} has no indices");
            if (indices.Count != 2)
            {
                throw new Exception(
                    $"collision disable pair {order} is not a pair");
            }
            var firstIndex = indices[0]!.Value<int>();
            var secondIndex = indices[1]!.Value<int>();
            output.Add(
                new JObject
                {
                    ["order"] = order,
                    ["firstBodyIndex"] = firstIndex,
                    ["secondBodyIndex"] = secondIndex,
                    ["firstBone"] =
                        bodies[firstIndex]!.Value<string>("boneName"),
                    ["secondBone"] =
                        bodies[secondIndex]!.Value<string>("boneName"),
                    // UPhysicsAsset disables collision by map membership;
                    // preserve the serialized bool instead of reinterpreting it.
                    ["serializedValue"] =
                        serializedPair["Value"]?.DeepClone()
                        ?? JValue.CreateNull(),
                    ["serialized"] = serializedPair.DeepClone(),
                });
        }
        return output;
    }

    static JObject NormalizeConstraint(
        JObject constraintExport,
        JObject reference,
        int constraintIndex)
    {
        var properties =
            constraintExport["Properties"] as JObject
            ?? throw new Exception(
                $"{constraintExport.Value<string>("Name")} has no Properties");
        var instance =
            properties["DefaultInstance"] as JObject
            ?? throw new Exception(
                $"{constraintExport.Value<string>("Name")} has no DefaultInstance");
        var profile =
            instance["ProfileInstance"] as JObject
            ?? new JObject();
        return new JObject
        {
            ["index"] = constraintIndex,
            ["exportName"] =
                constraintExport.Value<string>("Name"),
            ["objectPath"] = reference.Value<string>("ObjectPath"),
            ["jointName"] = RequiredString(instance, "JointName"),
            ["body1"] = RequiredString(
                instance,
                "ConstraintBone1"),
            ["body2"] = RequiredString(
                instance,
                "ConstraintBone2"),
            ["frames"] = new JObject
            {
                ["body1"] = NormalizeConstraintFrame(
                    instance,
                    "Pos1",
                    "PriAxis1",
                    "SecAxis1"),
                ["body2"] = NormalizeConstraintFrame(
                    instance,
                    "Pos2",
                    "PriAxis2",
                    "SecAxis2"),
                ["angularRotationOffsetDegrees"] = FieldState(
                    instance,
                    "AngularRotationOffset",
                    "FConstraintInstance"),
                ["scaleLinearLimits"] = FieldState(
                    instance,
                    "bScaleLinearLimits",
                    "FConstraintInstance"),
            },
            ["limits"] = new JObject
            {
                ["linear"] = NormalizeLinearLimit(
                    profile["LinearLimit"] as JObject),
                ["cone"] = NormalizeConeLimit(
                    profile["ConeLimit"] as JObject),
                ["twist"] = NormalizeTwistLimit(
                    profile["TwistLimit"] as JObject),
            },
            ["drives"] = new JObject
            {
                ["linear"] = NormalizeLinearDrive(
                    profile["LinearDrive"] as JObject),
                ["angular"] = NormalizeAngularDrive(
                    profile["AngularDrive"] as JObject),
            },
            ["projectionBreakPlasticity"] =
                NormalizeProjectionBreakPlasticity(profile),
            ["flags"] = NormalizeConstraintFlags(profile),
            ["serializedDefaultInstance"] =
                instance.DeepClone(),
            ["serializedProperties"] = properties.DeepClone(),
        };
    }

    static JObject NormalizeConstraintFrame(
        JObject instance,
        string positionName,
        string primaryAxisName,
        string secondaryAxisName)
    {
        return new JObject
        {
            ["positionCm"] = FieldState(
                instance,
                positionName,
                "FConstraintInstance"),
            ["primaryAxis"] = FieldState(
                instance,
                primaryAxisName,
                "FConstraintInstance"),
            ["secondaryAxis"] = FieldState(
                instance,
                secondaryAxisName,
                "FConstraintInstance"),
        };
    }

    static JObject NormalizeLinearLimit(JObject? limit)
    {
        return NormalizeLimit(
            limit,
            "FLinearConstraint",
            [
                "Limit",
                "XMotion",
                "YMotion",
                "ZMotion",
                "Stiffness",
                "Damping",
                "Restitution",
                "ContactDistance",
                "bSoftConstraint",
            ]);
    }

    static JObject NormalizeConeLimit(JObject? limit)
    {
        return NormalizeLimit(
            limit,
            "FConeConstraint",
            [
                "Swing1LimitDegrees",
                "Swing2LimitDegrees",
                "Swing1Motion",
                "Swing2Motion",
                "Stiffness",
                "Damping",
                "Restitution",
                "ContactDistance",
                "bSoftConstraint",
            ]);
    }

    static JObject NormalizeTwistLimit(JObject? limit)
    {
        return NormalizeLimit(
            limit,
            "FTwistConstraint",
            [
                "TwistLimitDegrees",
                "TwistMotion",
                "Stiffness",
                "Damping",
                "Restitution",
                "ContactDistance",
                "bSoftConstraint",
            ]);
    }

    static JObject NormalizeLimit(
        JObject? serialized,
        string structName,
        IEnumerable<string> fields)
    {
        var owner = serialized ?? new JObject();
        var normalized = new JObject();
        foreach (var field in fields)
        {
            normalized[field] = FieldState(
                owner,
                field,
                structName);
        }
        normalized["serialized"] =
            serialized?.DeepClone() ?? JValue.CreateNull();
        return normalized;
    }

    static JObject NormalizeLinearDrive(JObject? drive)
    {
        var owner = drive ?? new JObject();
        return new JObject
        {
            ["PositionTarget"] = FieldState(
                owner,
                "PositionTarget",
                "FLinearDriveConstraint"),
            ["VelocityTarget"] = FieldState(
                owner,
                "VelocityTarget",
                "FLinearDriveConstraint"),
            ["XDrive"] = NormalizeDrive(
                owner["XDrive"] as JObject,
                "FConstraintDrive"),
            ["YDrive"] = NormalizeDrive(
                owner["YDrive"] as JObject,
                "FConstraintDrive"),
            ["ZDrive"] = NormalizeDrive(
                owner["ZDrive"] as JObject,
                "FConstraintDrive"),
            ["serialized"] =
                drive?.DeepClone() ?? JValue.CreateNull(),
        };
    }

    static JObject NormalizeAngularDrive(JObject? drive)
    {
        var owner = drive ?? new JObject();
        return new JObject
        {
            ["TwistDrive"] = NormalizeDrive(
                owner["TwistDrive"] as JObject,
                "FConstraintDrive"),
            ["SwingDrive"] = NormalizeDrive(
                owner["SwingDrive"] as JObject,
                "FConstraintDrive"),
            ["SlerpDrive"] = NormalizeDrive(
                owner["SlerpDrive"] as JObject,
                "FConstraintDrive"),
            ["OrientationTargetDegrees"] = FieldState(
                owner,
                "OrientationTarget",
                "FAngularDriveConstraint"),
            ["AngularVelocityTarget"] = FieldState(
                owner,
                "AngularVelocityTarget",
                "FAngularDriveConstraint"),
            ["AngularDriveMode"] = FieldState(
                owner,
                "AngularDriveMode",
                "FAngularDriveConstraint"),
            ["serialized"] =
                drive?.DeepClone() ?? JValue.CreateNull(),
        };
    }

    static JObject NormalizeDrive(
        JObject? drive,
        string structName)
    {
        var owner = drive ?? new JObject();
        return new JObject
        {
            ["Stiffness"] = FieldState(
                owner,
                "Stiffness",
                structName),
            ["Damping"] = FieldState(
                owner,
                "Damping",
                structName),
            ["MaxForce"] = FieldState(
                owner,
                "MaxForce",
                structName),
            ["bEnablePositionDrive"] = FieldState(
                owner,
                "bEnablePositionDrive",
                structName),
            ["bEnableVelocityDrive"] = FieldState(
                owner,
                "bEnableVelocityDrive",
                structName),
            ["serialized"] =
                drive?.DeepClone() ?? JValue.CreateNull(),
        };
    }

    static JObject NormalizeProjectionBreakPlasticity(
        JObject profile)
    {
        var output = new JObject();
        foreach (var field in new[]
                 {
                     "ProjectionLinearTolerance",
                     "ProjectionAngularTolerance",
                     "ProjectionLinearAlpha",
                     "ProjectionAngularAlpha",
                     "ShockPropagationAlpha",
                     "LinearBreakThreshold",
                     "LinearPlasticityThreshold",
                     "AngularBreakThreshold",
                     "AngularPlasticityThreshold",
                     "ContactTransferScale",
                     "LinearPlasticityType",
                 })
        {
            output[field] = FieldState(
                profile,
                field,
                "FConstraintProfileProperties");
        }
        return output;
    }

    static JObject NormalizePhysicalAnimationProfile(
        JObject? profile)
    {
        var owner = profile ?? new JObject();
        var physicalAnimationData =
            owner["PhysicalAnimationData"] as JObject
            ?? new JObject();
        return new JObject
        {
            ["ProfileName"] = FieldState(
                owner,
                "ProfileName",
                "FPhysicalAnimationProfile"),
            ["PhysicalAnimationData"] = NormalizeFields(
                physicalAnimationData,
                "FPhysicalAnimationData",
                [
                    "bIsLocalSimulation",
                    "OrientationStrength",
                    "AngularVelocityStrength",
                    "PositionStrength",
                    "VelocityStrength",
                    "MaxLinearForce",
                    "MaxAngularForce",
                ]),
            ["serialized"] =
                profile?.DeepClone() ?? JValue.CreateNull(),
        };
    }

    static JObject NormalizeConstraintFlags(JObject profile)
    {
        return NormalizeFields(
            profile,
            "FConstraintProfileProperties",
            [
                "bDisableCollision",
                "bParentDominates",
                "bEnableShockPropagation",
                "bEnableProjection",
                "bEnableMassConditioning",
                "bUseLinearJointSolver",
                "bAngularBreakable",
                "bAngularPlasticity",
                "bLinearBreakable",
                "bLinearPlasticity",
            ]);
    }

    static JObject NormalizeFields(
        JObject owner,
        string ownerType,
        IEnumerable<string> fields)
    {
        var output = new JObject();
        foreach (var field in fields)
        {
            output[field] = FieldState(
                owner,
                field,
                ownerType);
        }
        return output;
    }

    static JObject FieldState(
        JObject owner,
        string propertyName,
        string ownerType)
    {
        var serialized = owner.TryGetValue(
            propertyName,
            StringComparison.Ordinal,
            out var value);
        return new JObject
        {
            ["source"] = serialized
                ? "serialized"
                : "inherited-ue5.5-default-unavailable",
            ["ownerType"] = ownerType,
            ["propertyName"] = propertyName,
            ["value"] = serialized
                ? value!.DeepClone()
                : JValue.CreateNull(),
        };
    }

    static JArray CreateUnavailableEngineDefaults()
    {
        return new JArray
        {
            new JObject
            {
                ["status"] = "UNAVAILABLE",
                ["scope"] =
                    "UPhysicsAsset solver configuration",
                ["fields"] = new JArray(
                    "SolverType",
                    "SolverSettings",
                    "SolverIterations"),
                ["evidence"] =
                    "No corresponding tagged properties exist in PA_Als; " +
                    "CUE4Parse exposes no native fallback values.",
            },
            new JObject
            {
                ["status"] = "UNAVAILABLE",
                ["scope"] =
                    "UBodySetup mass, material, damping, and simulation defaults",
                ["fields"] = new JArray(
                    "DefaultInstance",
                    "PhysMaterial",
                    "BuildScale3D",
                    "bDoubleSidedGeometry",
                    "bGenerateMirroredCollision",
                    "bGenerateNonMirroredCollision",
                    "bNeverNeedsCookedCollisionData",
                    "bSharedCookedData",
                    "bSupportUVsAndFaceRemap",
                    "WalkableSlopeOverride",
                    "non-overridden FPhysicalAnimationData members"),
                ["evidence"] =
                    "All 21 body exports omit these tags. CUE4Parse 1.2.2 " +
                    "does not project FBodyInstance (its source marks it TODO), " +
                    "so effective mass/material/solver fields cannot be " +
                    "recovered from this uncooked asset alone.",
            },
            new JObject
            {
                ["status"] = "UNAVAILABLE",
                ["scope"] =
                    "Non-overridden FConstraintInstance members",
                ["fields"] = new JArray(
                    "Pos1",
                    "PriAxis1",
                    "SecAxis1",
                    "AngularRotationOffset",
                    "bScaleLinearLimits"),
                ["evidence"] =
                    "These members are absent from every tagged " +
                    "DefaultInstance. Their UE5.5 constructor defaults are " +
                    "not serialized in PA_Als and are intentionally not guessed.",
            },
            new JObject
            {
                ["status"] = "UNAVAILABLE",
                ["scope"] =
                    "Non-overridden FConstraintProfileProperties/drive/limit members",
                ["fields"] = new JArray(
                    "projection tolerances/alphas",
                    "shock propagation",
                    "break thresholds",
                    "plasticity",
                    "soft-limit stiffness/damping/restitution/contact distance",
                    "drive stiffness/damping/max force/velocity drive",
                    "bUseLinearJointSolver"),
                ["evidence"] =
                    "Only authored tagged overrides are present. Each " +
                    "normalized field records serialized versus inherited " +
                    "default status; absent Chaos defaults remain null.",
            },
        };
    }

    static JArray ValidatePayload(JObject payload)
    {
        return new JArray
        {
            ValidateInventory(payload),
            ValidateRequiredCoreBodies(payload),
            ValidatePrimitiveGeometry(payload),
            ValidateCollisionTopology(payload),
            ValidateConstraintTopology(payload),
            ValidateSerializedDefaultBoundary(payload),
            ValidateCanonicalDigest(payload),
        };
    }

    static JObject ValidateInventory(JObject payload)
    {
        var bodies = payload["bodies"] as JArray ?? new JArray();
        var constraints =
            payload["constraints"] as JArray ?? new JArray();
        var bodyExports = bodies
            .OfType<JObject>()
            .Select(body => body.Value<string>("exportName"))
            .ToArray();
        var bodyBones = bodies
            .OfType<JObject>()
            .Select(body => body.Value<string>("boneName"))
            .ToArray();
        var constraintExports = constraints
            .OfType<JObject>()
            .Select(
                constraint =>
                    constraint.Value<string>("exportName"))
            .ToArray();
        return Validation(
            "PA_Als-exact-authored-inventory",
            bodyExports.SequenceEqual(ExpectedBodyExports)
            && bodyBones.SequenceEqual(ExpectedBodyBones)
            && constraintExports.SequenceEqual(
                ExpectedConstraintExports),
            new JObject
            {
                ["bodyCount"] = bodies.Count,
                ["constraintCount"] = constraints.Count,
                ["bodyBones"] = new JArray(
                    bodyBones.Select(
                        name =>
                            name is null
                                ? JValue.CreateNull()
                                : new JValue(name))),
            });
    }

    static JObject ValidateRequiredCoreBodies(JObject payload)
    {
        var bodies = payload["bodies"] as JArray ?? new JArray();
        var pelvis = bodies
            .OfType<JObject>()
            .SingleOrDefault(
                body => body.Value<string>("boneName") == "pelvis");
        var spine03 = bodies
            .OfType<JObject>()
            .SingleOrDefault(
                body => body.Value<string>("boneName") == "spine_03");
        var pelvisShape =
            pelvis?.SelectToken("shapes[0]") as JObject;
        var spineShapes =
            spine03?["shapes"] as JArray;
        var pass =
            pelvis?.Value<int?>("index") == 0
            && pelvisShape?.Value<string>("type")
            == "FKSphylElem"
            && Nearly(
                pelvisShape
                    .SelectToken("dimensions.radiusCm")
                    ?.Value<double?>(),
                14)
            && Nearly(
                pelvisShape
                    .SelectToken(
                        "dimensions.cylinderLengthCm")
                    ?.Value<double?>(),
                7)
            && spine03?.Value<int?>("index") == 3
            && spineShapes?.Count == 2
            && spineShapes.All(
                shape =>
                    shape.Value<string>("type")
                    == "FKSphylElem");
        return Validation(
            "PA_Als-required-pelvis-and-spine_03-bodies",
            pass,
            new JObject
            {
                ["pelvis"] =
                    pelvis?.DeepClone() ?? JValue.CreateNull(),
                ["spine_03"] =
                    spine03?.DeepClone() ?? JValue.CreateNull(),
            });
    }

    static JObject ValidatePrimitiveGeometry(JObject payload)
    {
        var bodies = payload["bodies"] as JArray ?? new JArray();
        var shapes = bodies
            .OfType<JObject>()
            .SelectMany(
                body =>
                    (body["shapes"] as JArray
                     ?? new JArray()).OfType<JObject>())
            .ToArray();
        var typeCounts = shapes
            .GroupBy(
                shape => shape.Value<string>("type")
                         ?? "<missing>")
            .ToDictionary(
                group => group.Key,
                group => group.Count(),
                StringComparer.Ordinal);
        var supportedCollections = new HashSet<string>(
            [
                "SphereElems",
                "BoxElems",
                "SphylElems",
                "ConvexElems",
                "TaperedCapsuleElems",
            ],
            StringComparer.Ordinal);
        var serializedCollections = bodies
            .OfType<JObject>()
            .SelectMany(
                body =>
                    (body.SelectToken("serializedProperties.AggGeom")
                     as JObject
                     ?? new JObject()).Properties())
            .ToArray();
        var serializedShapeCount = serializedCollections.Sum(
            property =>
                property.Value is JArray array
                    ? array.Count
                    : 0);
        var unsupportedCollections = serializedCollections
            .Select(property => property.Name)
            .Where(name => !supportedCollections.Contains(name))
            .Distinct(StringComparer.Ordinal)
            .Order(StringComparer.Ordinal)
            .ToArray();
        var completeCollisionFields = shapes.All(
            shape =>
                shape.SelectToken(
                        "collision.bContributeToMass.source")
                    ?.Value<string>()
                == "serialized"
                && shape.SelectToken(
                        "collision.collisionEnabled.source")
                    ?.Value<string>()
                == "serialized"
                && shape.SelectToken(
                        "collision.bContributeToMass.value")
                    ?.Value<bool?>()
                == true
                && shape.SelectToken(
                        "collision.collisionEnabled.value")
                    ?.Value<string>()
                == "ECollisionEnabled::QueryAndPhysics");
        var pass =
            shapes.Length == 22
            && typeCounts.GetValueOrDefault("FKSphylElem") == 17
            && typeCounts.GetValueOrDefault("FKBoxElem") == 4
            && typeCounts.GetValueOrDefault("FKSphereElem") == 1
            && typeCounts.Count == 3
            && serializedShapeCount == shapes.Length
            && unsupportedCollections.Length == 0
            && completeCollisionFields;
        return Validation(
            "PA_Als-complete-primitive-geometry",
            pass,
            new JObject
            {
                ["shapeCount"] = shapes.Length,
                ["typeCounts"] = JObject.FromObject(typeCounts),
                ["serializedShapeCount"] =
                    serializedShapeCount,
                ["unsupportedAggregateCollections"] =
                    new JArray(unsupportedCollections),
                ["allShapesContributeToMass"] =
                    completeCollisionFields,
            });
    }

    static JObject ValidateCollisionTopology(JObject payload)
    {
        var pairs =
            payload["collisionDisablePairs"] as JArray
            ?? new JArray();
        var pairIndices = pairs
            .OfType<JObject>()
            .Select(
                pair =>
                    $"{pair.Value<int>("firstBodyIndex")}|" +
                    $"{pair.Value<int>("secondBodyIndex")}")
            .ToArray();
        var bounds =
            payload.SelectToken("asset.boundsBodyIndices")
            as JArray
            ?? new JArray();
        var pass =
            pairIndices.SequenceEqual(
                ExpectedCollisionDisablePairs)
            && pairs.All(
                pair =>
                    pair.Value<bool?>("serializedValue") == false)
            && bounds.Values<int>().SequenceEqual(
                ExpectedBoundsBodies);
        return Validation(
            "PA_Als-disabled-collision-and-bounds-topology",
            pass,
            new JObject
            {
                ["disabledPairCount"] = pairs.Count,
                ["disabledPairs"] = new JArray(pairIndices),
                ["boundsBodyIndices"] = bounds.DeepClone(),
            });
    }

    static JObject ValidateConstraintTopology(JObject payload)
    {
        var constraints =
            payload["constraints"] as JArray
            ?? new JArray();
        var pairs = constraints
            .OfType<JObject>()
            .Select(
                constraint =>
                    $"{constraint.Value<string>("body1")}|" +
                    $"{constraint.Value<string>("body2")}")
            .ToArray();
        var errors = new JArray();
        foreach (var constraint in constraints.OfType<JObject>())
        {
            var name = constraint.Value<string>("jointName");
            if (name != constraint.Value<string>("body1"))
            {
                errors.Add($"{name}: joint is not body1");
            }
            foreach (var field in new[]
                     {
                         "positionCm",
                         "primaryAxis",
                         "secondaryAxis",
                     })
            {
                if (constraint
                        .SelectToken($"frames.body2.{field}.source")
                        ?.Value<string>()
                    != "serialized")
                {
                    errors.Add(
                        $"{name}: body2 {field} not serialized");
                }
                if (constraint
                        .SelectToken($"frames.body1.{field}.source")
                        ?.Value<string>()
                    != "inherited-ue5.5-default-unavailable")
                {
                    errors.Add(
                        $"{name}: unexpected body1 {field}");
                }
            }
            var instance =
                constraint["serializedDefaultInstance"] as JObject
                ?? new JObject();
            var unexpectedInstanceFields = instance.Properties()
                .Select(property => property.Name)
                .Except(
                    [
                        "JointName",
                        "ConstraintBone1",
                        "ConstraintBone2",
                        "Pos1",
                        "PriAxis1",
                        "SecAxis1",
                        "Pos2",
                        "PriAxis2",
                        "SecAxis2",
                        "AngularRotationOffset",
                        "bScaleLinearLimits",
                        "ProfileInstance",
                    ],
                    StringComparer.Ordinal)
                .ToArray();
            if (unexpectedInstanceFields.Length > 0)
            {
                errors.Add(
                    $"{name}: unnormalized instance fields " +
                    string.Join(",", unexpectedInstanceFields));
            }
            var profile =
                instance["ProfileInstance"] as JObject
                ?? new JObject();
            var unexpectedProfileFields = profile.Properties()
                .Select(property => property.Name)
                .Except(
                    [
                        "LinearLimit",
                        "ConeLimit",
                        "TwistLimit",
                        "LinearDrive",
                        "AngularDrive",
                        "ProjectionLinearTolerance",
                        "ProjectionAngularTolerance",
                        "ProjectionLinearAlpha",
                        "ProjectionAngularAlpha",
                        "ShockPropagationAlpha",
                        "LinearBreakThreshold",
                        "LinearPlasticityThreshold",
                        "AngularBreakThreshold",
                        "AngularPlasticityThreshold",
                        "ContactTransferScale",
                        "LinearPlasticityType",
                        "bDisableCollision",
                        "bParentDominates",
                        "bEnableShockPropagation",
                        "bEnableProjection",
                        "bEnableMassConditioning",
                        "bUseLinearJointSolver",
                        "bAngularBreakable",
                        "bAngularPlasticity",
                        "bLinearBreakable",
                        "bLinearPlasticity",
                    ],
                    StringComparer.Ordinal)
                .ToArray();
            if (unexpectedProfileFields.Length > 0)
            {
                errors.Add(
                    $"{name}: unnormalized profile fields " +
                    string.Join(",", unexpectedProfileFields));
            }
        }
        var pelvisRoot = constraints
            .OfType<JObject>()
            .SingleOrDefault(
                constraint =>
                    constraint.Value<string>("jointName")
                    == "pelvis");
        var angularConstraints = constraints
            .OfType<JObject>()
            .Where(
                constraint =>
                    constraint.Value<string>("jointName")
                    != "pelvis")
            .ToArray();
        var angularPass = angularConstraints.All(
            constraint =>
                constraint.SelectToken(
                        "limits.cone.Swing1Motion.source")
                    ?.Value<string>()
                == "serialized"
                && constraint.SelectToken(
                        "limits.twist.TwistMotion.source")
                    ?.Value<string>()
                == "serialized"
                && constraint.SelectToken(
                        "drives.angular.TwistDrive." +
                        "bEnablePositionDrive.value")
                    ?.Value<bool?>()
                == true
                && constraint.SelectToken(
                        "drives.angular.SwingDrive." +
                        "bEnablePositionDrive.value")
                    ?.Value<bool?>()
                == true
                && constraint.SelectToken(
                        "drives.angular.AngularDriveMode.value")
                    ?.Value<string>()
                == "EAngularDriveMode::TwistAndSwing");
        var rootLinearPass =
            pelvisRoot?.SelectToken(
                    "limits.linear.XMotion.value")
                ?.Value<string>()
            == "LCM_Free"
            && pelvisRoot.SelectToken(
                    "limits.linear.YMotion.value")
                ?.Value<string>()
            == "LCM_Free"
            && pelvisRoot.SelectToken(
                    "limits.linear.ZMotion.value")
                ?.Value<string>()
            == "LCM_Free";
        return Validation(
            "PA_Als-exact-constraint-topology-and-authored-overrides",
            pairs.SequenceEqual(ExpectedConstraintPairs)
            && angularConstraints.Length == 19
            && angularPass
            && rootLinearPass
            && errors.Count == 0,
            new JObject
            {
                ["pairs"] = new JArray(pairs),
                ["errors"] = errors,
            });
    }

    static JObject ValidateSerializedDefaultBoundary(
        JObject payload)
    {
        var bodies = payload["bodies"] as JArray ?? new JArray();
        var root = bodies
            .OfType<JObject>()
            .SingleOrDefault(
                body => body.Value<string>("boneName") == "root");
        var allBodyDefaultsAbsent = bodies
            .OfType<JObject>()
            .All(
                body =>
                    body.SelectToken(
                            "collisionAndSimulation." +
                            "defaultBodyInstance.source")
                        ?.Value<string>()
                    == "inherited-ue5.5-default-unavailable"
                    && body.SelectToken(
                            "massAndMaterial." +
                            "physicalMaterial.source")
                        ?.Value<string>()
                    == "inherited-ue5.5-default-unavailable");
        var allBodySetupFlagsAbsent = bodies
            .OfType<JObject>()
            .All(
                body =>
                    (body.SelectToken(
                            "collisionAndSimulation.bodySetupFlags")
                        as JObject
                     ?? new JObject())
                    .Properties()
                    .All(
                        property =>
                            property.Value.Value<string>("source")
                            == "inherited-ue5.5-default-unavailable"));
        var physicalAnimationProfiles = bodies
            .OfType<JObject>()
            .Select(
                body =>
                    body.SelectToken(
                        "collisionAndSimulation.physicalAnimation"))
            .OfType<JObject>()
            .ToArray();
        var orientationOverrides = physicalAnimationProfiles
            .Count(
                profile =>
                    profile.SelectToken(
                            "PhysicalAnimationData." +
                            "OrientationStrength.source")
                        ?.Value<string>()
                    == "serialized"
                    && Nearly(
                        profile.SelectToken(
                                "PhysicalAnimationData." +
                                "OrientationStrength.value")
                            ?.Value<double?>(),
                        20000));
        var allProfilesNamedRagdoll =
            physicalAnimationProfiles.Length == 21
            && physicalAnimationProfiles.All(
                profile =>
                    profile.SelectToken("ProfileName.value")
                        ?.Value<string>()
                    == "Ragdoll");
        var unavailable =
            payload["unavailableEngineDefaults"] as JArray
            ?? new JArray();
        var pass =
            allBodyDefaultsAbsent
            && allBodySetupFlagsAbsent
            && allProfilesNamedRagdoll
            && orientationOverrides == 19
            && root?.SelectToken(
                    "collisionAndSimulation.physicsType.value")
                ?.Value<string>()
            == "PhysType_Kinematic"
            && root.SelectToken(
                    "collisionAndSimulation." +
                    "collisionResponse.value")
                ?.Value<string>()
            == "EBodyCollisionResponse::BodyCollision_Disabled"
            && root.SelectToken(
                    "collisionAndSimulation." +
                    "considerForBounds.value")
                ?.Value<bool?>()
            == false
            && unavailable.Count == 4
            && unavailable.All(
                item =>
                    item.Value<string>("status") == "UNAVAILABLE");
        return Validation(
            "PA_Als-serialized-versus-unavailable-default-boundary",
            pass,
            new JObject
            {
                ["allBodyDefaultInstancesAbsent"] =
                    allBodyDefaultsAbsent,
                ["allBodySetupFlagsAbsent"] =
                    allBodySetupFlagsAbsent,
                ["physicalAnimationProfileCount"] =
                    physicalAnimationProfiles.Length,
                ["orientationStrength20000OverrideCount"] =
                    orientationOverrides,
                ["unavailableEngineDefaultGroups"] =
                    unavailable.Count,
                ["root"] =
                    root?.SelectToken(
                            "collisionAndSimulation")
                        ?.DeepClone()
                    ?? JValue.CreateNull(),
            });
    }

    static JObject ValidateCanonicalDigest(JObject payload)
    {
        var actual = ComputeCanonicalSha256(payload);
        var embedded =
            payload.Value<string>("canonicalSha256");
        return Validation(
            "PA_Als-canonical-content-digest",
            embedded == actual
            && actual == ExpectedCanonicalSha256,
            new JObject
            {
                ["expected"] = ExpectedCanonicalSha256,
                ["embedded"] = embedded,
                ["actual"] = actual,
            });
    }

    static string ComputeCanonicalSha256(JObject payload)
    {
        var canonical = new JObject
        {
            ["source"] = payload["source"]?.DeepClone(),
            ["serializationPolicy"] =
                payload["serializationPolicy"]?.DeepClone(),
            ["asset"] = payload["asset"]?.DeepClone(),
            ["bodies"] = payload["bodies"]?.DeepClone(),
            ["collisionDisablePairs"] =
                payload["collisionDisablePairs"]?.DeepClone(),
            ["constraints"] =
                payload["constraints"]?.DeepClone(),
            ["unavailableEngineDefaults"] =
                payload["unavailableEngineDefaults"]?.DeepClone(),
        };
        return Convert.ToHexString(
                SHA256.HashData(
                    Encoding.UTF8.GetBytes(
                        canonical.ToString(Formatting.None))))
            .ToLowerInvariant();
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
                $"  [{(validation.Value<bool>("pass") ? "PASS" : "FAIL")}] " +
                validation.Value<string>("name"));
        }
    }

    static void ThrowOnValidationFailure(JArray validations)
    {
        var failures = validations
            .OfType<JObject>()
            .Where(
                validation =>
                    validation.Value<bool?>("pass") != true)
            .ToArray();
        if (failures.Length > 0)
        {
            throw new Exception(
                "physics asset validation failed:\n"
                + string.Join(
                    "\n",
                    failures.Select(
                        failure =>
                            failure.ToString(Formatting.Indented))));
        }
    }

    static JArray RequiredArray(
        JObject owner,
        string propertyName)
    {
        return owner[propertyName] as JArray
               ?? throw new Exception(
                   $"{propertyName} is missing or not an array");
    }

    static string RequiredString(
        JObject owner,
        string propertyName)
    {
        return owner.Value<string>(propertyName)
               ?? throw new Exception(
                   $"{propertyName} is missing or not a string");
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

    static bool Nearly(double? actual, double expected)
    {
        return actual is not null
               && Math.Abs(actual.Value - expected) <= 1e-5;
    }
}
