using CUE4Parse.FileProvider;
using CUE4Parse.UE4.Versions;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

// Freezes the authored SK_Als blend profiles into a compact, deterministic
// content oracle. Profile Mode is absent from the serialized ALS 4.15 SK_Als
// tagged properties. Its WeightFactor value comes from the exact editor asset
// and C++ utility that author those profiles, not from a profile-name inference.
public static class SkeletonProfilesDump
{
    const string SkeletonAsset = "SK_Als";
    const string AuthoringAsset = "B_Als_SkeletonAssetActions";
    const string AuthoringAssetPath =
        "ALS/Content/ALSExtras/Editor/B_Als_SkeletonAssetActions.uasset";
    const string AuthoringSourcePath =
        "Source/ALSEditor/Private/AlsSkeletonUtility.cpp";
    const string AuthoringFunction =
        "UAlsSkeletonUtility::AddOrReplaceWeightBlendProfile";
    const string AuthoringSetupGraph = "SetupAlsSkeleton";
    const string BlendProfileMode = "WeightFactor";
    const string BlendProfileModeSource = "authoringOracle";

    static readonly string[] MoveDirectionBones =
    [
        "thigh_l",
        "calf_l",
        "calf_twist_01_l",
        "foot_l",
        "ball_l",
        "thigh_twist_01_l",
        "thigh_r",
        "calf_r",
        "calf_twist_01_r",
        "foot_r",
        "ball_r",
        "thigh_twist_01_r",
        "ik_foot_root",
        "ik_foot_l",
        "ik_foot_r",
        "VB foot_root",
        "VB foot_l",
        "VB foot_r",
    ];

    static readonly IReadOnlyDictionary<string, ExpectedProfile> Expected =
        new Dictionary<string, ExpectedProfile>(StringComparer.Ordinal)
        {
            ["LookDirectionChange"] = new(
                ["neck_01", "head"],
                2.0),
            ["MoveDirectionChange"] = new(
                MoveDirectionBones,
                2.0),
            ["QuickFeetBlend"] = new(
                MoveDirectionBones,
                5.0),
        };

    static readonly JsonSerializer Serializer = JsonSerializer.Create(
        new JsonSerializerSettings
        {
            ReferenceLoopHandling = ReferenceLoopHandling.Ignore,
        });

    sealed record ExpectedProfile(string[] Bones, double BlendScale);

    sealed record ProfileEntry(string Bone, double BlendScale);

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
                           candidate.NameWithoutExtension == SkeletonAsset
                           && candidate.Extension == "uasset")
                   ?? throw new Exception(
                       $"{SkeletonAsset}.uasset was not found exactly once");
        var package = provider.LoadPackage(file);
        var profileExports = package.GetExports()
            .Where(export => export.ExportType == "BlendProfile")
            .OrderBy(export => export.Name, StringComparer.Ordinal)
            .ToArray();
        var authoringOracle = ReadAuthoringOracle(provider, srcDir);

        var profiles = new JObject();
        foreach (var profileExport in profileExports)
        {
            var properties =
                JObject.FromObject(profileExport, Serializer)["Properties"]
                    as JObject
                ?? throw new Exception(
                    $"{profileExport.Name} has no serialized Properties");
            if (properties.ContainsKey("Mode"))
                throw new Exception(
                    $"{profileExport.Name} unexpectedly serializes Mode; " +
                    "the authoring-oracle provenance must be revisited");
            var serializedEntries = properties["ProfileEntries"] as JArray
                                    ?? throw new Exception(
                                        $"{profileExport.Name} has no ProfileEntries");
            var entries = new JArray();
            foreach (var serializedEntry in serializedEntries.OfType<JObject>())
            {
                var bone = serializedEntry
                               .SelectToken("BoneReference.BoneName")
                               ?.Value<string>()
                           ?? throw new Exception(
                               $"{profileExport.Name} has an entry without a bone");
                var blendScale = serializedEntry.Value<double?>("BlendScale")
                                 ?? throw new Exception(
                                     $"{profileExport.Name}.{bone} has no BlendScale");
                entries.Add(
                    new JObject
                    {
                        ["bone"] = bone,
                        ["blendScale"] = blendScale,
                    });
            }

            profiles[profileExport.Name] = new JObject
            {
                ["mode"] = BlendProfileMode,
                ["modeSource"] = BlendProfileModeSource,
                ["entries"] = entries,
            };
        }

        var payload = new JObject
        {
            ["schemaVersion"] = 2,
            ["source"] = new JObject
            {
                ["release"] = "ALS-Refactored 4.15",
                ["engineVersion"] = "UE5.5",
                ["assetPath"] = file.Path,
                ["authoringOracle"] = authoringOracle,
            },
            ["profiles"] = profiles,
        };
        payload["validations"] = ValidatePayload(payload);

        Directory.CreateDirectory(
            Path.GetDirectoryName(Path.GetFullPath(outJson))
            ?? throw new Exception($"invalid output path {outJson}"));
        File.WriteAllText(outJson, payload.ToString(Formatting.Indented) + "\n");
        ThrowOnValidationFailure((JArray)payload["validations"]!);
        Console.WriteLine(
            $"dumped {profiles.Count} SK_Als blend profiles -> {outJson}");
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

    static JObject ReadAuthoringOracle(
        DefaultFileProvider provider,
        string srcDir)
    {
        var file = provider.Files.Values.SingleOrDefault(
                       candidate =>
                           candidate.NameWithoutExtension == AuthoringAsset
                           && candidate.Extension == "uasset")
                   ?? throw new Exception(
                       $"{AuthoringAsset}.uasset was not found exactly once");
        if (file.Path != AuthoringAssetPath)
            throw new Exception(
                $"{AuthoringAsset} path {file.Path}, expected " +
                AuthoringAssetPath);

        var exports = provider.LoadPackage(file).GetExports().ToArray();
        var serializedExports = exports
            .Select(export => JObject.FromObject(export, Serializer))
            .ToArray();
        var defaultObject = serializedExports.SingleOrDefault(
                                export =>
                                    export.Value<string>("Name")
                                    == $"Default__{AuthoringAsset}_C")
                            ?? throw new Exception(
                                $"{AuthoringAsset} has no default object");
        var serializedProfiles =
            defaultObject.SelectToken("Properties.BlendProfiles") as JArray
            ?? throw new Exception(
                $"{AuthoringAsset} default object has no BlendProfiles");
        var profileNames = serializedProfiles
            .OfType<JObject>()
            .Select(ReadAuthoringProfileName)
            .ToArray();
        if (!profileNames.SequenceEqual(Expected.Keys))
            throw new Exception(
                $"{AuthoringAsset} profiles " +
                $"[{string.Join(", ", profileNames)}], expected " +
                $"[{string.Join(", ", Expected.Keys)}]");

        var setupGraphObjectName =
            $"EdGraph'{AuthoringAsset}:{AuthoringSetupGraph}'";
        var setupGraphExports = serializedExports
            .Where(
                export =>
                    export.SelectToken("Outer.ObjectName")?.Value<string>()
                    == setupGraphObjectName)
            .ToArray();
        var authoringCallCount = setupGraphExports.Count(
            export =>
                export.Value<string>("Type") == "K2Node_CallFunction"
                && export.SelectToken(
                        "Properties.FunctionReference.MemberParent.ObjectPath")
                    ?.Value<string>() == "/Script/ALSEditor"
                && export.SelectToken(
                        "Properties.FunctionReference.MemberName")
                    ?.Value<string>()
                == "AddOrReplaceWeightBlendProfile");
        if (authoringCallCount != 1)
            throw new Exception(
                $"{AuthoringAsset}.{AuthoringSetupGraph} has " +
                $"{authoringCallCount} {AuthoringFunction} calls, expected 1");

        var profileVariableCount = setupGraphExports.Count(
            export =>
                export.Value<string>("Type") == "K2Node_VariableGet"
                && export.SelectToken(
                        "Properties.VariableReference.MemberName")
                    ?.Value<string>() == "BlendProfiles");
        if (profileVariableCount != 1)
            throw new Exception(
                $"{AuthoringAsset}.{AuthoringSetupGraph} has " +
                $"{profileVariableCount} BlendProfiles reads, expected 1");

        var profileLoopCount = setupGraphExports.Count(
            export =>
                export.Value<string>("Type") == "K2Node_MacroInstance"
                && export.SelectToken(
                        "Properties.ResolvedWildcardType." +
                        "PinSubCategoryObject.ObjectPath")
                    ?.Value<string>()
                == "/ALS/ALSExtras/Editor/F_Als_BlendProfile");
        if (profileLoopCount != 1)
            throw new Exception(
                $"{AuthoringAsset}.{AuthoringSetupGraph} has " +
                $"{profileLoopCount} F_Als_BlendProfile loops, expected 1");

        var sourceFile = Path.Combine(
            Path.GetFullPath(srcDir),
            "ALS",
            AuthoringSourcePath.Replace(
                '/',
                Path.DirectorySeparatorChar));
        if (!File.Exists(sourceFile))
            throw new Exception(
                $"authoring source not found at {sourceFile}");
        var functionBody = ReadFunctionBody(
            File.ReadAllText(sourceFile),
            AuthoringFunction);
        const string modeAssignmentPrefix = "BlendProfile->Mode";
        var modeAssignmentCount = functionBody
            .Split(modeAssignmentPrefix, StringSplitOptions.None)
            .Length - 1;
        if (modeAssignmentCount != 1)
            throw new Exception(
                $"{AuthoringFunction} has {modeAssignmentCount} Mode " +
                "assignments, expected 1");
        var compactFunctionBody = string.Concat(
            functionBody.Where(character => !char.IsWhiteSpace(character)));
        var expectedAssignment =
            $"{modeAssignmentPrefix}=EBlendProfileMode::{BlendProfileMode};";
        if (!compactFunctionBody.Contains(
                expectedAssignment,
                StringComparison.Ordinal))
        {
            throw new Exception(
                $"{AuthoringFunction} does not assign " +
                $"EBlendProfileMode::{BlendProfileMode}");
        }

        return new JObject
        {
            ["assetPath"] = file.Path,
            ["sourcePath"] = AuthoringSourcePath,
            ["setupGraph"] = AuthoringSetupGraph,
            ["function"] = AuthoringFunction,
            ["modeAssignment"] =
                $"EBlendProfileMode::{BlendProfileMode}",
            ["modeSerializedInSkeletonAsset"] = false,
            ["profileNames"] = JArray.FromObject(profileNames),
        };
    }

    static string ReadAuthoringProfileName(JObject serializedProfile)
    {
        var nameProperties = serializedProfile.Properties()
            .Where(
                property => property.Name.StartsWith(
                    "BlendProfileName_",
                    StringComparison.Ordinal))
            .ToArray();
        if (nameProperties.Length != 1)
            throw new Exception(
                $"authoring profile has {nameProperties.Length} name fields");
        return nameProperties[0].Value.Value<string>()
               ?? throw new Exception(
                   "authoring profile has an empty name");
    }

    static string ReadFunctionBody(string source, string qualifiedName)
    {
        var functionStart = source.IndexOf(
            $"void {qualifiedName}",
            StringComparison.Ordinal);
        if (functionStart < 0)
            throw new Exception($"{qualifiedName} definition not found");
        if (source.IndexOf(
                $"void {qualifiedName}",
                functionStart + 1,
                StringComparison.Ordinal) >= 0)
        {
            throw new Exception(
                $"{qualifiedName} has multiple definitions");
        }

        var bodyStart = source.IndexOf('{', functionStart);
        if (bodyStart < 0)
            throw new Exception($"{qualifiedName} body not found");
        var depth = 0;
        for (var index = bodyStart; index < source.Length; index++)
        {
            if (source[index] == '{')
                depth++;
            else if (source[index] == '}' && --depth == 0)
                return source[(bodyStart + 1)..index];
        }

        throw new Exception($"{qualifiedName} body is unterminated");
    }

    static JArray ValidatePayload(JObject payload)
    {
        var profiles = payload["profiles"] as JObject ?? new JObject();
        return
        [
            ValidateAllProfiles(profiles),
            ValidateMoveDirectionChange(profiles),
            ValidateWeightFactorAuthoringOracle(payload, profiles),
        ];
    }

    static JObject ValidateAllProfiles(JObject profiles)
    {
        var errors = new JArray();
        var actualNames = profiles.Properties()
            .Select(property => property.Name)
            .ToArray();
        foreach (var name in Expected.Keys.Except(actualNames))
            errors.Add($"missing blend profile {name}");
        foreach (var name in actualNames.Except(Expected.Keys))
            errors.Add($"unexpected blend profile {name}");

        foreach (var (name, expected) in Expected)
        {
            var actual = ReadEntries(profiles[name]);
            var expectedEntries = expected.Bones
                .Select(bone => new ProfileEntry(bone, expected.BlendScale))
                .ToArray();
            if (!actual.SequenceEqual(expectedEntries))
            {
                errors.Add(
                    $"{name} entries [{FormatEntries(actual)}], expected " +
                    $"[{FormatEntries(expectedEntries)}]");
            }
        }

        return new JObject
        {
            ["id"] = "als-4.15-skeleton-blend-profile-content",
            ["passed"] = errors.Count == 0,
            ["details"] = new JObject
            {
                ["expectedCount"] = Expected.Count,
                ["actualCount"] = profiles.Count,
                ["errors"] = errors,
            },
        };
    }

    static JObject ValidateMoveDirectionChange(JObject profiles)
    {
        var errors = new JArray();
        var entries = ReadEntries(profiles["MoveDirectionChange"]);
        var actualBones = entries.Select(entry => entry.Bone).ToArray();
        if (!actualBones.SequenceEqual(MoveDirectionBones))
        {
            errors.Add(
                $"bones [{string.Join(", ", actualBones)}], expected " +
                $"[{string.Join(", ", MoveDirectionBones)}]");
        }
        if (actualBones.Distinct(StringComparer.Ordinal).Count()
            != actualBones.Length)
        {
            errors.Add("duplicate MoveDirectionChange bone entries");
        }
        foreach (var entry in entries.Where(entry => entry.BlendScale != 2.0))
        {
            errors.Add(
                $"{entry.Bone} BlendScale {entry.BlendScale:R}, expected 2");
        }
        if (entries.Length != 18)
            errors.Add($"entry count {entries.Length}, expected 18");

        return new JObject
        {
            ["id"] = "als-4.15-move-direction-change-profile",
            ["passed"] = errors.Count == 0,
            ["details"] = new JObject
            {
                ["expectedEntryCount"] = 18,
                ["actualEntryCount"] = entries.Length,
                ["expectedBlendScale"] = 2.0,
                ["errors"] = errors,
            },
        };
    }

    static JObject ValidateWeightFactorAuthoringOracle(
        JObject payload,
        JObject profiles)
    {
        var errors = new JArray();
        var schemaVersion = payload.Value<int?>("schemaVersion");
        if (schemaVersion != 2)
            errors.Add($"schemaVersion {schemaVersion}, expected 2");

        var oracle = payload.SelectToken("source.authoringOracle") as JObject;
        if (oracle is null)
        {
            errors.Add("missing source.authoringOracle");
        }
        else
        {
            ValidateOracleString(
                oracle,
                "assetPath",
                AuthoringAssetPath,
                errors);
            ValidateOracleString(
                oracle,
                "sourcePath",
                AuthoringSourcePath,
                errors);
            ValidateOracleString(
                oracle,
                "setupGraph",
                AuthoringSetupGraph,
                errors);
            ValidateOracleString(
                oracle,
                "function",
                AuthoringFunction,
                errors);
            ValidateOracleString(
                oracle,
                "modeAssignment",
                $"EBlendProfileMode::{BlendProfileMode}",
                errors);
            if (oracle.Value<bool?>("modeSerializedInSkeletonAsset") is not false)
            {
                errors.Add(
                    "modeSerializedInSkeletonAsset must be false");
            }

            var actualProfileNames =
                oracle["profileNames"]?.Values<string>().ToArray() ?? [];
            if (!actualProfileNames.SequenceEqual(Expected.Keys))
            {
                errors.Add(
                    $"authoring profile names " +
                    $"[{string.Join(", ", actualProfileNames)}], expected " +
                    $"[{string.Join(", ", Expected.Keys)}]");
            }
        }

        foreach (var name in Expected.Keys)
        {
            var profile = profiles[name] as JObject;
            var mode = profile?.Value<string>("mode");
            if (mode != BlendProfileMode)
                errors.Add(
                    $"{name} mode {mode ?? "<missing>"}, expected " +
                    BlendProfileMode);
            var modeSource = profile?.Value<string>("modeSource");
            if (modeSource != BlendProfileModeSource)
            {
                errors.Add(
                    $"{name} modeSource {modeSource ?? "<missing>"}, " +
                    $"expected {BlendProfileModeSource}");
            }
        }

        return new JObject
        {
            ["id"] = "als-4.15-weight-blend-profile-authoring-oracle",
            ["passed"] = errors.Count == 0,
            ["details"] = new JObject
            {
                ["expectedAssetPath"] = AuthoringAssetPath,
                ["expectedSourcePath"] = AuthoringSourcePath,
                ["expectedFunction"] = AuthoringFunction,
                ["expectedMode"] = BlendProfileMode,
                ["expectedProfileNames"] = JArray.FromObject(Expected.Keys),
                ["errors"] = errors,
            },
        };
    }

    static void ValidateOracleString(
        JObject oracle,
        string propertyName,
        string expected,
        JArray errors)
    {
        var actual = oracle.Value<string>(propertyName);
        if (actual != expected)
        {
            errors.Add(
                $"{propertyName} {actual ?? "<missing>"}, expected " +
                expected);
        }
    }

    static ProfileEntry[] ReadEntries(JToken? profile)
    {
        return profile?["entries"]?.Values<JObject>()
                   .Select(
                       entry => new ProfileEntry(
                           entry!.Value<string>("bone") ?? "",
                           entry.Value<double?>("blendScale") ?? double.NaN))
                   .ToArray()
               ?? [];
    }

    static string FormatEntries(IEnumerable<ProfileEntry> entries) =>
        string.Join(
            ", ",
            entries.Select(
                entry => $"{entry.Bone}:{entry.BlendScale:R}"));

    static void ThrowOnValidationFailure(JArray validations)
    {
        foreach (var validation in validations.OfType<JObject>())
        {
            var passed = validation.Value<bool>("passed");
            Console.WriteLine(
                $"{(passed ? "PASS" : "FAIL")} " +
                $"{validation.Value<string>("id")}");
            if (!passed)
                throw new Exception(
                    validation["details"]?.ToString(Formatting.None));
        }
    }
}
