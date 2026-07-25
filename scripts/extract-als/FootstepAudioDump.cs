using CUE4Parse.FileProvider;
using CUE4Parse.UE4.Assets.Exports;
using CUE4Parse.UE4.Versions;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

// Content oracle for ALS's complete footstep route. This deliberately preserves
// notify defaults explicitly: UE omits values equal to the C++ initializer.
public static class FootstepAudioDump
{
    const string FootstepSettings = "FES_Als_Default";
    const string MetaSound = "MS_Als_Footstep";
    const string Attenuation = "SA_Als_Footstep";
    const int ExpectedNotifyCount = 154;
    static readonly JsonSerializer Serializer = JsonSerializer.Create(new JsonSerializerSettings
    {
        ReferenceLoopHandling = ReferenceLoopHandling.Ignore,
    });

    sealed record Asset(string Path, JArray Exports, JObject Export);

    public static int Run(string srcDir, string manifestPath, string outJson)
    {
        var provider = Provider(srcDir);
        var manifest = File.ReadLines(manifestPath)
            .Select(line => line.Split('|')[0].Trim())
            .Where(name => name.Length > 0 && !name.StartsWith('#'))
            .Distinct(StringComparer.Ordinal)
            .OrderBy(name => name, StringComparer.Ordinal)
            .ToArray();
        var fes = Load(provider, FootstepSettings, "Data/Footstep", "AlsFootstepEffectsSettings");
        var ms = Load(provider, MetaSound, "Audio/Footsteps", "MetaSoundSource");
        var sa = Load(provider, Attenuation, "Audio/Footsteps", "SoundAttenuation");
        var notifies = new JArray();
        foreach (var clip in manifest)
        {
            var asset = TryLoad(provider, clip, "AnimSequence");
            if (asset is null) continue;
            var objects = asset.Exports.Children<JObject>()
                .Where(export => export.Value<string>("Type") == "AlsAnimNotify_FootstepEffects")
                .ToDictionary(export => export.Value<string>("Name")!, StringComparer.Ordinal);
            var events = asset.Export.SelectToken("Properties.Notifies") as JArray ?? [];
            for (var eventIndex = 0; eventIndex < events.Count; eventIndex++)
            {
                var ev = events[eventIndex];
                var objectName = ev.SelectToken("Notify.ObjectName")?.Value<string>();
                var notifyName = objectName?.Split(':').Last().TrimEnd('\'');
                if (notifyName is null || !objects.TryGetValue(notifyName, out var notify)) continue;
                var rawNotifyName = ev.Value<string>("NotifyName");
                if (string.IsNullOrWhiteSpace(rawNotifyName)) throw new Exception($"{clip}:{notifyName} has no raw NotifyName");
                var props = (JObject?)notify["Properties"] ?? new JObject();
                if (props.SelectToken("FootstepEffectsSettings.ObjectPath")?.Value<string>() != "/ALS/ALS/Data/Footstep/FES_Als_Default")
                    throw new Exception($"{clip}:{notifyName} does not use {FootstepSettings}");
                notifies.Add(new JObject
                {
                    ["clip"] = clip,
                    ["time"] = ev.Value<double>("LinkValue"),
                    ["notifyName"] = rawNotifyName,
                    ["eventIndex"] = eventIndex,
                    ["footBone"] = Value(props, "FootBone", "EAlsFootBone::Left"),
                    ["bSpawnSound"] = Value(props, "bSpawnSound", true),
                    ["volume"] = Value(props, "SoundVolumeMultiplier", 1.0),
                    ["pitch"] = Value(props, "SoundPitchMultiplier", 1.0),
                    ["soundType"] = Value(props, "SoundType", "EAlsFootstepSoundType::Step"),
                    ["bIgnoreFootstepSoundBlockCurve"] = Value(props, "bIgnoreFootstepSoundBlockCurve", false),
                    ["bSkipEffectsWhenInAir"] = Value(props, "bSkipEffectsWhenInAir", false),
                    ["triggerWeightThreshold"] = ev.Value<double>("TriggerWeightThreshold"),
                    ["montageTickType"] = ev.Value<string>("MontageTickType"),
                    ["notifyTriggerChance"] = ev.Value<double>("NotifyTriggerChance"),
                    ["notifyFilterType"] = ev.Value<string>("NotifyFilterType"),
                    ["notifyFilterLod"] = ev.Value<int>("NotifyFilterLOD"),
                    ["triggerOnDedicatedServer"] = ev.Value<bool>("bTriggerOnDedicatedServer"),
                    ["triggerOnFollower"] = ev.Value<bool>("bTriggerOnFollower"),
                });
            }
        }
        var variables = FindObjects(ms.Export, "Variables").SelectMany(token => token as JArray ?? []).OfType<JObject>()
            .Where(variable => variable["Name"] is not null)
            .ToDictionary(variable => variable.Value<string>("Name")!, StringComparer.Ordinal);
        var payload = new JObject
        {
            ["schemaVersion"] = 1,
            ["source"] = new JObject { ["engineVersion"] = "UE5.5", ["referenceRelease"] = "ALS Refactored 4.15", ["clipsManifest"] = Path.GetFileName(manifestPath) },
            ["footstepEffectsSettings"] = new JObject { ["assetPath"] = UnrealPath(fes.Path), ["effects"] = fes.Export.SelectToken("Properties.Effects")?.DeepClone() },
            ["metaSound"] = new JObject {
                ["assetPath"] = UnrealPath(ms.Path),
                ["outputFormat"] = ms.Export.SelectToken("Properties.OutputFormat")?.DeepClone(),
                ["sampleRate"] = ms.Export.SelectToken("Properties.SampleRate")?.DeepClone(),
                ["maxDistance"] = ms.Export.SelectToken("Properties.MaxDistance")?.DeepClone(),
                ["attenuationAssetPath"] = ms.Export.SelectToken("Properties.AttenuationSettings.ObjectPath")?.DeepClone(),
                ["waveArrays"] = new JObject { ["StepWaves"] = WaveArray(variables, "StepWaves"), ["WalkWaves"] = WaveArray(variables, "WalkWaves"), ["LandWaves"] = WaveArray(variables, "LandWaves") },
                ["defaults"] = new JObject { ["footstepType"] = 0, ["minPitchShift"] = 0, ["maxPitchShift"] = 0, ["minVolume"] = 1, ["maxVolume"] = 1, ["noRepeats"] = 1 },
            },
            ["attenuation"] = new JObject { ["assetPath"] = UnrealPath(sa.Path), ["settings"] = sa.Export.SelectToken("Properties.Attenuation")?.DeepClone() },
            // EventIndex is the serialized FAnimNotifyEvent order. It is the tie breaker
            // for the intentionally same-time left/right landing rows.
            ["notifies"] = new JArray(notifies.OrderBy(row => row.Value<string>("clip"), StringComparer.Ordinal).ThenBy(row => row.Value<double>("time")).ThenBy(row => row.Value<int>("eventIndex"))),
        };
        payload["validations"] = ValidatePayload(payload);
        Write(outJson, payload);
        Validate(outJson);
        return 0;
    }

    public static int Validate(string jsonPath)
    {
        var checks = ValidatePayload(JObject.Parse(File.ReadAllText(jsonPath)));
        foreach (var check in checks.Children<JObject>()) Console.WriteLine($"{check["name"]}: {check["ok"]}");
        if (checks.Any(check => !check.Value<bool>("ok"))) throw new Exception("footstep audio validation failed");
        return 0;
    }

    static DefaultFileProvider Provider(string srcDir)
    {
        var provider = new DefaultFileProvider(srcDir, SearchOption.AllDirectories, new VersionContainer(EGame.GAME_UE5_5));
        provider.Initialize(); provider.Mount(); return provider;
    }
    static Asset Load(DefaultFileProvider provider, string name, string path, string type) => TryLoad(provider, name, type, path) ?? throw new Exception($"missing {name}");
    static Asset? TryLoad(DefaultFileProvider provider, string name, string type, string? requiredPath = null)
    {
        var file = provider.Files.Values.SingleOrDefault(file => file.NameWithoutExtension == name && file.Extension == "uasset" && (requiredPath is null || file.Path.Replace('\\', '/').Contains(requiredPath, StringComparison.Ordinal)));
        if (file is null) return null;
        var exports = new JArray(provider.LoadPackage(file).GetExports().Select(export => JObject.FromObject(export, Serializer)));
        var selected = exports.Children<JObject>().SingleOrDefault(export => export.Value<string>("Name") == name && export.Value<string>("Type") == type) ?? throw new Exception($"{name} is not {type}");
        return new Asset(file.Path, exports, selected);
    }
    static IEnumerable<JToken> FindObjects(JToken root, string property)
    {
        var objects = root is JObject self
            ? new[] { self }.Concat(((JContainer)self).Descendants().OfType<JObject>())
            : root is JContainer container
                ? container.Descendants().OfType<JObject>()
                : Enumerable.Empty<JObject>();
        return objects.Where(obj => obj[property] is not null).Select(obj => obj[property]!);
    }
    static JArray WaveArray(IReadOnlyDictionary<string, JObject> variables, string name) => (variables[name].SelectToken("Literal.AsUObject")?.DeepClone() as JArray) ?? throw new Exception($"MetaSound lacks {name}");
    static JToken Value(JObject obj, string name, object fallback) => obj[name]?.DeepClone() ?? JToken.FromObject(fallback);
    static string UnrealPath(string providerPath) => providerPath.Replace("ALS/Content", "/ALS", StringComparison.Ordinal).Replace('\\', '/').Replace(".uasset", "", StringComparison.Ordinal);
    static void Write(string outJson, JObject payload) { Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(outJson))!); File.WriteAllText(outJson, payload.ToString(Formatting.Indented) + "\n"); }
    static JArray ValidatePayload(JObject payload) => new()
    {
        Check("schema", payload.Value<int>("schemaVersion") == 1),
        Check("notify-count", payload["notifies"] is JArray rows && rows.Count == ExpectedNotifyCount, $"expected {ExpectedNotifyCount}"),
        Check("notify-names", payload["notifies"] is JArray named && named.Children<JObject>().All(row => !string.IsNullOrWhiteSpace(row.Value<string>("notifyName")) && row.Value<int?>("eventIndex") is not null)),
        Check("notify-firing-policy", payload["notifies"] is JArray policy && policy.Children<JObject>().All(row =>
            row.Value<string>("montageTickType") == "EMontageNotifyTickType::Queued"
            && row.Value<double>("notifyTriggerChance") == 1.0
            && row.Value<string>("notifyFilterType") == "ENotifyFilterType::NoFiltering"
            && row.Value<int>("notifyFilterLod") == 0
            && !row.Value<bool>("triggerOnDedicatedServer")
            && !row.Value<bool>("triggerOnFollower"))),
        Check("wave-arrays", payload.SelectToken("metaSound.waveArrays.StepWaves") is JArray step && step.Count == 3 && payload.SelectToken("metaSound.waveArrays.WalkWaves") is JArray walk && walk.Count == 5 && payload.SelectToken("metaSound.waveArrays.LandWaves") is JArray land && land.Count == 2),
        Check("attenuation", payload.SelectToken("attenuation.settings.DistanceAlgorithm")?.Value<string>() == "EAttenuationDistanceModel::Logarithmic" && payload.SelectToken("attenuation.settings.FalloffDistance")?.Value<double>() == 2000),
    };
    static JObject Check(string name, bool ok, string? detail = null) => new() { ["name"] = name, ["ok"] = ok, ["detail"] = detail };
}
