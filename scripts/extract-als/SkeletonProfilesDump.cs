using CUE4Parse.FileProvider;
using CUE4Parse.UE4.Versions;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

// Freezes the authored SK_Als blend profiles into a compact, deterministic
// content oracle. Profile Mode is absent from the serialized ALS 4.15 tagged
// properties, so this dump deliberately preserves only the recoverable entries.
public static class SkeletonProfilesDump
{
    const string SkeletonAsset = "SK_Als";

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

        var profiles = new JObject();
        foreach (var profileExport in profileExports)
        {
            var properties =
                JObject.FromObject(profileExport, Serializer)["Properties"]
                    as JObject
                ?? throw new Exception(
                    $"{profileExport.Name} has no serialized Properties");
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
                ["entries"] = entries,
            };
        }

        var payload = new JObject
        {
            ["schemaVersion"] = 1,
            ["source"] = new JObject
            {
                ["release"] = "ALS-Refactored 4.15",
                ["engineVersion"] = "UE5.5",
                ["assetPath"] = file.Path,
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

    static JArray ValidatePayload(JObject payload)
    {
        var profiles = payload["profiles"] as JObject ?? new JObject();
        return
        [
            ValidateAllProfiles(profiles),
            ValidateMoveDirectionChange(profiles),
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
