using CUE4Parse.FileProvider;
using CUE4Parse.UE4.Assets.Exports;
using CUE4Parse.UE4.Versions;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

// Extracts the authored BlendSpace topology referenced by the compiled ALS
// AnimBlueprints. A BlendSpace is graph data, not an AnimationClip, so its axes,
// samples, interpolation, and serialized triangulation live beside the GLB.
public static class BlendSpaceDump
{
    sealed record ExpectedBlendSpace(
        string ClassName,
        string[] Samples,
        string? PreviewBasePose,
        string[] AxisNames);

    static readonly IReadOnlyDictionary<string, ExpectedBlendSpace> Expected =
        new Dictionary<string, ExpectedBlendSpace>(StringComparer.Ordinal)
        {
            ["BS_Als_Air_Lean"] = new(
                "BlendSpace",
                [
                    "A_Als_Air_Lean",
                    "A_Als_Air_Lean_Forward",
                    "A_Als_Air_Lean_Backward",
                    "A_Als_Air_Lean_Left",
                    "A_Als_Air_Lean_Right",
                ],
                "A_Als_Fall",
                ["Lean Right Amount", "Lean Forward Amount"]),
            ["BS_Als_Lean"] = new(
                "BlendSpace",
                [
                    "A_Als_Lean",
                    "A_Als_Lean_Forward",
                    "A_Als_Lean_Backward",
                    "A_Als_Lean_Left",
                    "A_Als_Lean_Right",
                ],
                "A_Als_Run_Forward_Pose",
                ["Lean Right Amount", "Lean Forward Amount"]),
            ["BS_Als_Look"] = new(
                "BlendSpace1D",
                ["A_Als_Look_Forward", "A_Als_Look_Down", "A_Als_Look_Up"],
                "A_Als_Stand_Pose",
                ["Pitch Angle"]),
            ["BS_Als_WalkRun_Backward"] = WalkRun(
                "A_Als_Walk_Backward",
                "A_Als_Walk_Forward_Pose",
                "A_Als_Run_Backward",
                "A_Als_Run_Forward_Pose"),
            ["BS_Als_WalkRun_Forward"] = WalkRun(
                "A_Als_Walk_Forward",
                "A_Als_Walk_Forward_Pose",
                "A_Als_Run_Forward",
                "A_Als_Run_Forward_Pose"),
            ["BS_Als_WalkRun_Left_Backward"] = WalkRun(
                "A_Als_Walk_Left_Backward",
                "A_Als_Walk_Right_Pose",
                "A_Als_Run_Left_Backward",
                "A_Als_Run_Right_Pose"),
            ["BS_Als_WalkRun_Left_Forward"] = WalkRun(
                "A_Als_Walk_Left_Forward",
                "A_Als_Walk_Left_Pose",
                "A_Als_Run_Left_Forward",
                "A_Als_Run_Left_Pose"),
            ["BS_Als_WalkRun_Right_Backward"] = WalkRun(
                "A_Als_Walk_Right_Backward",
                "A_Als_Walk_Left_Pose",
                "A_Als_Run_Right_Backward",
                "A_Als_Run_Left_Pose"),
            ["BS_Als_WalkRun_Right_Forward"] = WalkRun(
                "A_Als_Walk_Right_Forward",
                "A_Als_Walk_Right_Pose",
                "A_Als_Run_Right_Forward",
                "A_Als_Run_Right_Pose"),
        };

    static readonly JsonSerializer Serializer = JsonSerializer.Create(
        new JsonSerializerSettings
        {
            ReferenceLoopHandling = ReferenceLoopHandling.Ignore,
        });

    public static int Run(string srcDir, string outJson)
    {
        var provider = CreateProvider(srcDir);
        var blendSpaces = new JObject();

        foreach (var (name, expected) in Expected)
        {
            var file = provider.Files.Values.SingleOrDefault(
                           candidate =>
                               candidate.NameWithoutExtension == name &&
                               candidate.Extension == "uasset")
                       ?? throw new Exception($"{name}.uasset not found");
            var export = provider.LoadPackage(file).GetExports().Single(
                candidate => candidate.Name == name);
            if (export.ExportType != expected.ClassName)
                throw new Exception(
                    $"{name} is {export.ExportType}, expected {expected.ClassName}");

            var properties = JObject.FromObject(export, Serializer)["Properties"] as JObject
                             ?? throw new Exception($"{name} has no serialized Properties");
            blendSpaces[name] = DumpBlendSpace(file.Path, export, properties);
        }

        var payload = new JObject
        {
            ["schemaVersion"] = 1,
            ["source"] = new JObject
            {
                ["release"] = "ALS-Refactored 4.15",
                ["engineVersion"] = "UE5.5",
                ["mount"] = "/ALS",
            },
            ["blendSpaces"] = blendSpaces,
        };
        payload["validations"] = ValidatePayload(payload);

        Directory.CreateDirectory(
            Path.GetDirectoryName(Path.GetFullPath(outJson))
            ?? throw new Exception($"invalid output path {outJson}"));
        File.WriteAllText(outJson, payload.ToString(Formatting.Indented) + "\n");
        ThrowOnValidationFailure((JArray)payload["validations"]!);
        Console.WriteLine(
            $"dumped {blendSpaces.Count} authored BlendSpaces -> {outJson}");
        return 0;
    }

    public static int Validate(string inputJson)
    {
        var payload = JObject.Parse(File.ReadAllText(inputJson));
        var validations = ValidatePayload(payload);
        ThrowOnValidationFailure(validations);
        Console.WriteLine($"validated {inputJson}");
        return 0;
    }

    static JObject DumpBlendSpace(
        string filePath,
        UObject export,
        JObject properties)
    {
        var axes = ReadNumberedProperties(properties, "BlendParameters");
        var interpolation = ReadNumberedProperties(properties, "InterpolationParam");
        var samples = new JArray(
            (properties["SampleData"] as JArray ?? [])
            .OfType<JObject>()
            .Select(
                sample => new JObject
                {
                    ["animation"] = AssetReference(sample["Animation"]),
                    ["sampleValue"] = sample["SampleValue"]?.DeepClone(),
                    ["rateScale"] = sample.Value<double?>("RateScale") ?? 1.0,
                }));

        return new JObject
        {
            ["assetPath"] = filePath,
            ["className"] = export.ExportType,
            // UBlendSpaceBase defaults to looping. False is serialized explicitly
            // by ALS's pose-style Lean/Look spaces.
            ["loop"] = properties.Value<bool?>("bLoop") ?? true,
            ["containsRotationOffsetMeshSpaceSamples"] =
                properties.Value<bool?>("bContainsRotationOffsetMeshSpaceSamples") ?? false,
            ["animLengthSeconds"] = properties.Value<double?>("AnimLength"),
            ["sampleIndexWithMarkers"] = properties.Value<int?>("SampleIndexWithMarkers"),
            ["previewBasePose"] = AssetReference(properties["PreviewBasePose"]),
            ["axes"] = new JArray(
                axes.Select(
                    (axis, index) => new JObject
                    {
                        ["index"] = index,
                        ["serialized"] = axis,
                    })),
            ["interpolationParameters"] = new JArray(
                interpolation.Select(
                    (parameter, index) => new JObject
                    {
                        ["index"] = index,
                        ["serialized"] = parameter,
                    })),
            ["samples"] = samples,
            // Preserve UE's authored segment/triangle or grid ordering exactly.
            // Right-backward alone opts into grid interpolation in ALS 4.15.
            // Rebuilding either representation downstream would create a second
            // source of truth.
            ["topology"] = new JObject
            {
                ["interpolateUsingGrid"] =
                    properties.Value<bool?>("bInterpolateUsingGrid") ?? false,
                ["blendSpaceData"] = properties["BlendSpaceData"]?.DeepClone(),
                ["gridSamples"] =
                    properties["GridSamples"]?.DeepClone() ?? new JArray(),
            },
        };
    }

    static JObject? AssetReference(JToken? token)
    {
        if (token is not JObject obj)
            return null;
        var objectName = obj.Value<string>("ObjectName") ?? "";
        var firstQuote = objectName.IndexOf('\'');
        var lastQuote = objectName.LastIndexOf('\'');
        var name = firstQuote >= 0 && lastQuote > firstQuote
            ? objectName[(firstQuote + 1)..lastQuote]
            : objectName;
        return new JObject
        {
            ["name"] = name,
            ["objectPath"] = obj.Value<string>("ObjectPath"),
        };
    }

    static JToken[] ReadNumberedProperties(JObject properties, string baseName)
    {
        var result = new List<JToken>();
        if (properties[baseName] is { } first)
            result.Add(first.DeepClone());
        for (var index = 1; properties[$"{baseName}[{index}]"] is { } value; index++)
            result.Add(value.DeepClone());
        return result.ToArray();
    }

    static JArray ValidatePayload(JObject payload)
    {
        var errors = new JArray();
        var actual = payload["blendSpaces"] as JObject ?? new JObject();
        var missing = Expected.Keys.Except(actual.Properties().Select(p => p.Name)).ToArray();
        var unexpected = actual.Properties().Select(p => p.Name).Except(Expected.Keys).ToArray();
        foreach (var name in missing)
            errors.Add($"missing BlendSpace {name}");
        foreach (var name in unexpected)
            errors.Add($"unexpected BlendSpace {name}");

        foreach (var (name, expected) in Expected)
        {
            if (actual[name] is not JObject blendSpace)
                continue;
            if (blendSpace.Value<string>("className") != expected.ClassName)
                errors.Add($"{name} class mismatch");

            var samples = blendSpace["samples"]?.Values<JObject>()
                              .Select(sample => sample!.SelectToken("animation.name")?.Value<string>())
                              .ToArray()
                          ?? [];
            if (!samples.SequenceEqual(expected.Samples))
                errors.Add(
                    $"{name} samples [{string.Join(", ", samples)}], expected " +
                    $"[{string.Join(", ", expected.Samples)}]");

            var preview = blendSpace.SelectToken("previewBasePose.name")?.Value<string>();
            if (preview != expected.PreviewBasePose)
                errors.Add(
                    $"{name} preview base {preview ?? "<none>"}, expected " +
                    $"{expected.PreviewBasePose ?? "<none>"}");

            var axes = blendSpace["axes"]?.Values<JObject>()
                           .Select(axis => axis!.SelectToken("serialized.DisplayName")?.Value<string>())
                           .ToArray()
                       ?? [];
            if (!axes.SequenceEqual(expected.AxisNames))
                errors.Add(
                    $"{name} axes [{string.Join(", ", axes)}], expected " +
                    $"[{string.Join(", ", expected.AxisNames)}]");
            if (blendSpace["topology"] is not JObject topology
                || (topology["blendSpaceData"] is not JObject
                    && !(topology["gridSamples"] is JArray { Count: > 0 })))
                errors.Add($"{name} has no serialized topology");
        }

        return
        [
            new JObject
            {
                ["id"] = "als-4.15-blend-space-content",
                ["passed"] = errors.Count == 0,
                ["details"] = new JObject
                {
                    ["expectedCount"] = Expected.Count,
                    ["actualCount"] = actual.Count,
                    ["errors"] = errors,
                },
            },
        ];
    }

    static void ThrowOnValidationFailure(JArray validations)
    {
        foreach (var validation in validations.OfType<JObject>())
        {
            var passed = validation.Value<bool>("passed");
            Console.WriteLine(
                $"{(passed ? "PASS" : "FAIL")} {validation.Value<string>("id")}");
            if (!passed)
                throw new Exception(validation["details"]?.ToString(Formatting.None));
        }
    }

    static DefaultFileProvider CreateProvider(string srcDir)
    {
        var provider = new DefaultFileProvider(
            srcDir,
            SearchOption.AllDirectories,
            new VersionContainer(EGame.GAME_UE5_5));
        provider.Initialize();
        provider.Mount();
        return provider;
    }

    static ExpectedBlendSpace WalkRun(params string[] samples) =>
        new(
            "BlendSpace",
            samples,
            null,
            ["Stride Amount", "Walk Run Amount"]);
}
